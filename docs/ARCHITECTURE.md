# Architecture & Phase 1 Plan

Status: **Phase 1 complete (2026-10-31).** The foundation tables are applied to the Neon `dev` branch only; the rest of the proposed schema arrives phase by phase.
Proposed schema: [proposed-schema.prisma](proposed-schema.prisma) (validated with Prisma 7.10).

## 1. Current repository state (inspected 2026-10-31)

A first Phase 1 pass already exists and is healthy:

| Area | State |
|---|---|
| Workspaces | npm workspaces `backend/`, `frontend/`; root Prisma config; `shared/types` empty |
| Backend | Express 5, Zod 4, Prisma 7 + `@prisma/adapter-pg`, pino, helmet, CORS allowlist, rate limit, central error handler, `{ data }` / `{ error }` envelopes |
| Auth | bcrypt; short-lived HS256 access JWT in memory; opaque refresh token (hashed in DB, HttpOnly cookie) with rotation and family revocation on reuse; no public sign-up; seed creates admin |
| RBAC | Roles `ADMIN`, `MANAGER`, `PSM`, `VIEWER`; role-check middleware; team-scoped data (manager → team, PSM → self) |
| Modules | auth, dashboard summary, teams/user provisioning, Google Sheets connections + tab/column mapping (metadata + header row only), Neon service health |
| Frontend | React 19, Vite 7, Tailwind 4, React Router 7, TanStack Query, RHF, Recharts, Lucide; shadcn-style `Button`/`Card`; app shell with sidebar; login, dashboard (partly labeled preview data), teams, sheets pages |
| Database | Neon, 2 migrations applied, schema up to date |
| Checks | backend + frontend `tsc` pass; 1 unit test passes |

Gaps against the target spec:

1. **Not a git repository.** `.gitignore` is correct, but nothing is versioned yet.
2. **Migrations run against the Neon `production` branch.** Development should use a separate Neon branch.
3. **Business logic lives in route files** (`teams.routes.ts`, `sheets.routes.ts`, `dashboard.routes.ts`): validation, authorization, Prisma queries and rules sit together. Needs controller / service / repository split before modules multiply.
4. shadcn/ui is hand-copied rather than initialised (`components.json` missing); no table, dialog, form, tabs, toast components.
5. No Redis/BullMQ, ExcelJS, CSV parser, file upload handling, or `shared/types` usage.
6. Permissions are role-only; no per-action permission map and no PII field filtering.
7. `SheetTabMapping.workflowStage` mixes internal stages (screening, assignment) with company rounds (Technical Round 1, HR) as free strings. The proposed import model separates these.
8. Leftovers: `backend/dist`, `frontend/dist`, and the demo Neon Function `hello.ts`.

## 2. Proposed architecture

**Modular monolith**: one deployable API process, one worker process (same codebase, different entrypoint), one SPA, one Postgres database. No microservices.

```
              ┌──────────── frontend (Vite SPA) ────────────┐
              │ features/* → services/api → TanStack Query  │
              └──────────────────────┬──────────────────────┘
                                     │ HTTPS /api (JWT + refresh cookie)
┌────────────────────────────────────▼─────────────────────────────────┐
│ backend: Express API                                                 │
│  middleware: helmet · cors · requestId · rateLimit · authenticate ·  │
│              authorize(permission) · validate(body/query/params) ·  │
│              idempotency · errorHandler                              │
│  modules/<feature>/                                                  │
│     *.routes.ts      → wiring only                                   │
│     *.controller.ts  → HTTP in/out, no rules                         │
│     *.service.ts     → business rules, transactions, audit           │
│     *.repository.ts  → Prisma queries, data-scope filters            │
│     *.validators.ts  → Zod schemas (shared with frontend via shared/)│
└───────────────┬───────────────────────────────┬──────────────────────┘
                │ Prisma (pooled DATABASE_URL)  │ BullMQ (REDIS_URL)
        ┌───────▼────────┐              ┌───────▼─────────┐
        │ Neon Postgres  │◄─────────────│ worker process  │ sheets sync, file parse,
        └────────────────┘   Prisma     │ (src/worker.ts) │ validation, import commit,
                                        └─────────────────┘ report export
```

Key design rules:

- **Two pipelines, one link.** Internal PSM screening (TA→RS→SC→AS→SP) and the company hiring pipeline are separate tables. The only link is `CompanyNomination`, created explicitly by the owning PSM. Nothing moves a candidate across automatically, and internally rejected candidates cannot be nominated.
- **Explicit stage status.** `InternalProcessStage.status` is only changed by an explicit action, logged in `StageCompletionRecord`. Supplying a rejection reason never changes it.
- **One ingestion pipeline.** Sheets sync and Excel/CSV upload both produce an `ImportBatch` → `ImportSheetMapping` → `ImportStagingRecord` (raw + normalized) → `DataQualityIssue` → human `ImportApproval` → transactional commit. Rows missing from a re-import are flagged, never deleted.
- **Reconciliation keys.** Job requests by `jobId`; candidates by `candidateCode` (email also unique); companies by `hubspotCompanyId` once available, otherwise by explicit user choice, never by name.
- **Metrics are computed**, from `InternalStageCandidate`, `CompanyNomination`, `CompanyStageHistory` etc. If dashboards get slow, add refreshed materialized views, not hand-maintained counters.
- **Integrity in the database.** Composite foreign keys (`[id, jobRequestId]`) make it impossible for a stage outcome, nomination or interview to reference an application from a different job request. Business history tables use `onDelete: Restrict`; entities are archived (`archivedAt`), not deleted.
- **Data scope** (organisation / team / self) is applied in repositories from one helper, so every list endpoint is scoped the same way as today's dashboard.

## 3. Target folder structure

Existing folders are kept; additions are marked `+`.

```
placementdashboard/
├─ docs/                         + architecture, decisions, runbooks
├─ prisma/  schema.prisma · migrations/ · seed.ts (+ seed-dev.ts: mock data, dev branch only)
├─ shared/types/                 + API envelope, enums, Zod schemas shared by both apps
├─ backend/src/
│  ├─ config/        env, logger, + redis
│  ├─ middleware/    authenticate, authorize, validate-*, error-handler, + request-id, + idempotency
│  ├─ modules/
│  │  ├─ auth/ teams/ dashboard/ sheets/ neon/          (existing → refactor to controller/service/repository)
│  │  ├─ + companies/ job-requests/ candidates/ applications/
│  │  ├─ + screening/ hiring-pipeline/ psm-ops/ rsa/
│  │  └─ + imports/ analytics/ audit/
│  ├─ queues/        + queue definitions
│  ├─ workers/       + job processors;  + worker.ts entrypoint
│  ├─ services/      cross-module services (auth, + audit, + permissions)
│  └─ utils/         api-error, refresh-token, + pagination, + scope
└─ frontend/src/
   ├─ components/ui/ shadcn components;  components/ shared composites (DataTable, KpiCard, EmptyState…)
   ├─ features/<module>/  api hooks, components, schemas per module
   ├─ layouts/  pages/  routes/  contexts/  services/  types/  utils/
```

## 4. Dependencies

Already installed: everything in the mandatory frontend list except shadcn/ui proper; Express, Zod, Prisma, jose, bcryptjs, pino, helmet, cors, express-rate-limit, google-auth-library on the backend.

| Add | Where | When | Why |
|---|---|---|---|
| shadcn CLI components (`@radix-ui/*`, `tw-animate-css`) | frontend | Phase 1 | dialog, dropdown, tabs, select, form, sheet, toast |
| `@tanstack/react-table` | frontend | Phase 1 | sortable/filterable/paginated tables |
| `sonner`, `date-fns` | frontend | Phase 1 | toasts, date handling |
| `supertest` (+ types) | backend dev | Phase 1 | HTTP-level tests of auth/RBAC |
| `bullmq`, `ioredis` | backend | Phase 5 | queues and scheduled sync |
| `exceljs`, `csv-parse`, `multer` | backend | Phase 5 | uploads and parsing |
| `@google/genai` or `openai` | backend | later | AI features (not scheduled) |

Testing stays on the built-in `node:test` runner already used by the backend.

`.env` naming: the repo uses `GOOGLE_SERVICE_ACCOUNT_BASE64` (one secret, avoids private-key newline escaping) instead of `GOOGLE_CLIENT_EMAIL` + `GOOGLE_PRIVATE_KEY`, and stores spreadsheet IDs per connection in the database instead of a single `GOOGLE_SHEET_ID`. Proposal: keep that. `REDIS_URL` and `GEMINI_API_KEY` are added to `.env.example` in the phase that uses them.

## 5. Entity relationships

```
Team 1─* User *─* Role                        User 1─* RefreshToken
Company 1─* JobRequest *─1 Product            JobRequest *─* Skill (JobRequestSkill)
JobRequest 1─* PSMAssignment *─1 User         (ownership history; one open row per job)

Candidate *─0..1 Product                      Candidate *─* Skill (CandidateSkill)
Candidate 1─* CandidateClassificationHistory  (category / assessed pool / product changes)
Candidate 1─* Application *─1 JobRequest      unique (candidate, jobRequest)

JobRequest 1─0..1 InternalProcess 1─5 InternalProcessStage (TA RS SC AS SP)
InternalProcessStage 1─* InternalStageCandidate *─1 Application   (same jobRequest enforced by FK)
InternalProcessStage 1─* StageCompletionRecord (status transition log)

Application 1─0..1 CompanyNomination          (PSM nominates; no approval step)
JobRequest 1─* CompanyInterviewRound          (configurable, ordered by sequence)
CompanyNomination 1─* CompanyInterview *─1 CompanyInterviewRound
CompanyNomination 1─* CompanyStageHistory     (Selected → Offer Released → Accepted → Joined)

Company 1─* CompanyActivity 1─* ActivityParticipant (user | candidate | external contact)
FollowUp → owner User, optionally Company / JobRequest / Candidate / Activity

SheetConnection 1─* ImportBatch 1─* ImportSheetMapping 1─* ImportStagingRecord 1─* DataQualityIssue
ImportBatch 1─* ImportApproval;  committed rows point back via importBatchId

Candidate 1─* RSAAssessment 1─* RSASkillGap *─1 Skill
Candidate 1─* HomeworkAssignment 1─* HomeworkSubmission;  HomeworkAssignment 1─* MentorFeedback
AuditLog *─0..1 User (actor)
```

Notes on specific choices:

- `Application` is the unit of history. A candidate in three job requests has three applications, each with its own stage outcomes, nomination and interviews.
- `InternalStageCandidate` exists only for candidates actually considered at a stage, so the PSM can save one candidate at a time. "Manual selection" is a row with `source = MANUAL`.
- Offer and Joined are **not** interview rounds; they are milestones on `CompanyNomination` (`offerReleasedAt`, `offerAcceptedAt`, `joinedAt`) and in `CompanyStageHistory`, which keeps Selected / Offer Released / Offer Accepted / Joined distinct.
- `JobRequest.techStack String[]` stays until it is backfilled into `JobRequestSkill`, then dropped in a later migration.
- `PSMTask` (task ownership, delivery date, turnaround) is not modelled yet. Its shape depends on question 9 below and is designed in Phase 6.
- One raw-SQL addition is needed in the migration: a `CHECK` that exactly one of `userId / candidateId / externalName` is set on `ActivityParticipant`.

## 6. Business rules

### Decided (2026-10-31)

| # | Topic | Decision | Effect on the design |
|---|---|---|---|
| D1 | Candidate identity | Candidate ID is globally unique and stable; ~~email is unique too~~ **revision proposed:** the source data has emails and mobiles shared by several user IDs (see [source-sheets-analysis.md](source-sheets-analysis.md)), so email and mobile are indexed, not unique, and probable duplicates are flagged | `Candidate.candidateCode` and `Candidate.email` are both unique. An import row whose email matches a different Candidate ID is raised as a conflict for review |
| D2 | Job ID & company data | PSMs enter the Job ID and company details manually. Later, company details will come from HubSpot via an API, keyed by an ID the PSM provides | `JobRequest.jobId` is a required, unique text field entered by the PSM. `Company.hubspotCompanyId` is optional and unique, reserved for the HubSpot integration |
| D3 | Company identity | No separate company code exists; the Job ID is the business key | Companies are not matched automatically on import. Job rows are matched by Job ID; new companies are picked or created by the PSM |
| D4 | PSM ownership | Ownership is per job request | `PSMAssignment` is job-level only (`companyId` removed, `jobRequestId` required, one open assignment per job). A company's PSMs are derived from its job requests. The dashboard company filter that uses company assignments changes accordingly |
| D5 | Nominations | No manager review of internal rejections or nominations; PSM decisions are trusted. PSMs record, for every company/job, which shortlisting method they followed | Approval fields and statuses removed from `CompanyNomination`. Internally rejected candidates cannot be nominated (no override). `InternalProcess.shortlistingNotes` stores the method; each stage keeps its own `remarks` |

### Still open

Needed before Phase 3–4:

5. **Re-application.** Can a candidate apply to the same Job ID twice (e.g. after rejection)? The proposed schema says no.
6. **Stage flow.** Must a candidate be SELECTED at a stage to be considered at the next one? If a stage is NOT_CONDUCTED (e.g. no assignment), do the previous stage's selections carry forward automatically? Which candidates can be nominated: only those SELECTED at SP, or any candidate not rejected?
7. **"Partially Completed".** Purely a manual status, or does it mean "some candidates still PENDING"?
8. **Shortlisting notes.** Should a PSM have to fill in the shortlisting method before closing the internal process or nominating anyone?
9. **Offer data.** Should CTC / offer letter be stored? It is sensitive; it is left out for now.
9a. **Products per job.** Answered by the source sheets: applicants come from many products, so product belongs to the candidate and the application. Jobs can optionally list eligible products.

Needed before Phase 5–6:

10. **PII visibility.** Which roles can see candidate email, mobile and resume? Should VIEWER / leadership see only aggregates?
11. **Conflicting edits.** If a PSM edits a candidate's category or assessed-pool status and a later import says otherwise, which wins?
12. **Sheets sync.** Frequency? Strictly read-only (no write-back)? When a row disappears from the sheet, should it be flagged for review or ignored?
13. **RSA.** Score scales, who mentors (new `MENTOR` role?), what defines "improvement"?
14. **Retention.** Retention period for candidate PII and how a deletion request is handled. History tables restrict deletes, so the proposal is to anonymise the candidate instead.

## 7. Phase 1 implementation plan

Phase 1 already delivered setup, auth, base schema and the shell. Remaining work, in order:

| # | Task | Notes |
|---|---|---|
| 1 | `git init` and first commit | confirm `.env` is ignored before the first commit |
| 2 | Create a Neon `dev` branch; point local `.env` at it | migrations and mock seed never touch `production` again |
| 3 | Refactor existing modules to routes → controller → service → repository | auth, teams, sheets, dashboard; behaviour unchanged; add `validateQuery`/`validateParams` |
| 4 | Cross-cutting backend pieces | request ID, `{ data, meta }` pagination envelope, data-scope helper, audit service with PII redaction, idempotency-key middleware for POSTs |
| 5 | Permission map | permission codes (e.g. `company:write`, `candidate:pii:read`) mapped to roles in code; `authorize()` checks permissions; roles in the DB stay as they are |
| 6 | `shared/types` | API envelope, enums, shared Zod schemas used by both apps |
| 7 | Initialise shadcn/ui | `components.json`; add table, dialog, dropdown, tabs, select, form, badge, skeleton, toast; reusable `DataTable`, `KpiCard`, `EmptyState`, `ErrorState`, `ConfirmDialog` |
| 8 | Dashboard layout | sidebar entries for every module (placeholder pages with empty states), date / product / tech-stack filter bar wired to URL params, mock data clearly labeled and isolated in `features/*/mock.ts` |
| 9 | Migration 3 (foundation only) | `Skill`, `JobRequestSkill`, `Company.hubspotCompanyId/website/industry/location/archivedAt`, `JobRequest.archivedAt`, `AuditLog.requestId/ipAddress`, job-level `PSMAssignment` (table is empty today, so this is safe); module tables arrive with their phases |
| 10 | Tests | refresh-token rotation and reuse detection, permission checks, data-scope filters (supertest + `node:test`) |
| 11 | Clean-up | remove `dist/` folders; decide on `hello.ts` demo Function; update README |

Exit criteria: both apps build, tests pass, migrations apply cleanly to the dev branch, every existing feature still works, and no module contains Prisma calls in its routes or controllers.

## 8. Phase 1 outcome (2026-10-31)

Done:

- Git repository with `main` (baseline) and `phase-1/foundation` branches.
- Neon `dev` branch created from `production`; local `.env` points at it. Production was not migrated.
- Backend modules (auth, teams, sheets, dashboard, neon, new read-only catalog) split into routes → controller → service → repository → validators.
- `@placement/shared` package: API envelope types and the role → permission map, used by both apps.
- Permission-based authorization, a shared data-scope helper, an audit service with PII redaction, request IDs, idempotency keys, query/params validation, pagination helpers.
- Migration `20261031120000_foundation_job_ownership_skills_idempotency` (dev only): job-level `PSMAssignment` with one open owner per job, `Skill` / `JobRequestSkill`, company HubSpot ID and profile fields, archive timestamps, audit request context, `IdempotencyKey`.
- Dashboard summary accepts date, product and tech-stack filters; the UI filter bar keeps them in the URL.
- shadcn/ui set up with the existing palette; reusable `DataTable`, `KpiCard`, `EmptyState`, `ErrorState`, `ConfirmDialog`, `PageHeader`, `FilterBar`.
- Sidebar navigation for every module, filtered by permission, with route guards. Companies and Job requests use labelled preview data; later modules show placeholders.
- 26 backend tests: token rotation and reuse, login enumeration resistance, permissions, data scope, dashboard filters, idempotency hashing, pagination, audit redaction.

Behaviour changes from the previous code:

- A PSM's dashboard companies come only from job requests they own (decision D4), not from company-level assignments.
- Users without a team now get an empty sheet-connection list; previously the query used an invalid empty team ID.
- Login compares against a dummy hash for unknown emails, so response time no longer reveals whether an account exists.
- Invalid route parameters return `400 VALIDATION_ERROR` consistently.

Deferred:

- Redis/BullMQ, ExcelJS and CSV parsing (Phase 5).
- Route-level code splitting; the production bundle is about 500 kB and Vite warns (Phase 7).
- Removing the demo `hello` Neon Function, still used by the integration status check.
- Testing repositories against a disposable Neon branch in CI.
