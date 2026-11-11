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
| RBAC | Roles `ADMIN`, `MANAGER`, `STAKEHOLDER`, `EMPLOYEE`; role-check middleware; one shared workspace (manager → workspace, employee/stakeholder → self) |
| Modules | auth, dashboard summary, teams/user provisioning, Google Sheets connections + tab/column mapping (automatic header detection with headerless data support), Neon service health |
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
- **Sheet-driven stage status.** Stage decisions are maintained in Google Sheets. Imports update read-only candidate outcomes and stage completion status, with transitions logged in `StageCompletionRecord`; a stage marked not conducted requires a reason.
- **Google Sheets ingestion.** A mapped spreadsheet import produces an `ImportBatch` → `ImportSheetMapping` → `ImportStagingRecord` (raw + normalized) → `DataQualityIssue` → transactional commit. The dashboard reads Sheets and never writes shortlist decisions back to them.
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
| D1 | Candidate identity | Placement sheet imports use normalized mobile as their only candidate match key. Source UUID and email are ignored for matching; a missing or duplicate mobile is blocked for review. The source workbook still contains duplicate mobiles and needs cleanup (see [source-sheets-analysis.md](source-sheets-analysis.md)). | `Candidate.candidateCode` remains a unique internal database code. Mobile is indexed, and the importer rejects ambiguous matches rather than choosing a candidate. |
| D2 | Job ID & company data | PSMs enter the Job ID and company details manually. Later, company details will come from HubSpot via an API, keyed by an ID the PSM provides | `JobRequest.jobId` is a required, unique text field entered by the PSM. `Company.hubspotCompanyId` is optional and unique, reserved for the HubSpot integration |
| D3 | Company identity | No separate company code exists; the Job ID is the business key | Companies are not matched automatically on import. Job rows are matched by Job ID; new companies are picked or created by the PSM |
| D4 | PSM ownership | Ownership is per job request | `PSMAssignment` is job-level only (`companyId` removed, `jobRequestId` required, one open assignment per job). A company's PSMs are derived from its job requests. The dashboard company filter that uses company assignments changes accordingly |
| D5 | Nominations | No manager review of internal rejections or nominations; PSM decisions are trusted. PSMs record, for every company/job, which shortlisting method they followed | Approval fields and statuses removed from `CompanyNomination`. Internally rejected candidates cannot be nominated (no override). `InternalProcess.shortlistingNotes` stores the method; each stage keeps its own `remarks` |

| D6 | Internal sheet scope (2026-10-31) | Each job request has its own internal sheet. When a company returns with a new job request, profiles from an earlier drive may be reused, decided by the PSM | Two human-driven paths in the Phase 3 wizard: (a) **Add from a previous drive**: pick an earlier job request (same company by default), filter by its stage outcomes, tick candidates, and they get a new application linked to the old one (`sourceApplicationId`); (b) if an uploaded sheet's `Job Id` column belongs to a different job request, the dashboard says which one and the PSM confirms before rows are used. Each candidate keeps a separate history per job request, and their past outcomes are shown during review |

### Still open

Needed before Phase 3–4:

5. **Re-application.** Can a candidate apply to the same Job ID twice (e.g. after rejection)? The proposed schema says no.
6. **Stage flow.** Must a candidate be SELECTED at a stage to be considered at the next one? If a stage is NOT_CONDUCTED (e.g. no assignment), do the previous stage's selections carry forward automatically? Which candidates can be nominated: only those SELECTED at SP, or any candidate not rejected?
7. **"Partially Completed".** Purely a manual status, or does it mean "some candidates still PENDING"?
8. **Shortlisting notes.** Should a PSM have to fill in the shortlisting method before closing the internal process or nominating anyone?
9. **Offer data.** Should CTC / offer letter be stored? It is sensitive; it is left out for now.
9a. **Products per job.** Answered by the source sheets: applicants come from many products, so product belongs to the candidate and the application. Jobs can optionally list eligible products.

Needed before Phase 5–6:

10. **PII visibility.** Which roles can see candidate email, mobile and resume? Stakeholders currently see candidate records without write access or PII permission.
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

## 9. Drive setup workflow (agreed direction, 2026-10-31)

For Google Sheets, the PSM selects the tabs to use; the dashboard detects headers, student identity, and relevant columns automatically. Mapping errors are surfaced before saving; company imports also show staged rows for review. Google Sheets remain the source of truth for candidate-stage decisions.

1. **Company.** Pick an existing company or create one: name plus HubSpot company ID or link, industry, location. The PSM owner enters it; HubSpot auto-fill comes later.
2. **Job request (drive).** Role, tech stack, openings, profiles required, timeline, proposed shortlisting mechanism, deadline, PSM owner (defaults to the creator).
3. **Internal sheet.** Connect a Google Sheets workbook and select the applications tab and any RS / SC / AS / SP tabs to include. Headers, student identity, product fields, decisions, and stage details are inferred automatically, including headerless tabs. A stage can instead be marked not conducted with a reason.
4. **Review.** Inspect stage counts, rows that match no applicant, duplicates and conflicts, then commit the import. The dashboard displays stage candidates and analytics without offering shortlist controls.
5. **Assessed pools.** Map Bucket, TR and Competency tabs by candidate ID to track each pool's applicant and stage outcomes.
6. **Company sheet.** Connect the company workbook and select the tabs for this job. Student identity, interview rounds, final status, and recognizable outcome values are inferred automatically.
7. **Refreshes** read the latest sheet data. Nothing is written back to Sheets.

Previously selected tabs are preselected for the next Google Sheets import of the same job. Other file imports continue to use column mapping.

### Revised phase order

| Phase | Scope |
|---|---|
| 2 | Companies and job requests (manual entry, HubSpot fields), PSM ownership, a job workspace page |
| 3 | Google Sheets mapping and import → candidates, products, applications and TA–SP outcomes; read-only stage analytics |
| 4 | Company Google Sheets mapping and import → rounds, profile matching, company outcomes, offers and joining |
| 5 | Scheduled Google Sheets re-sync and re-import differences |
| 6 | PSM tasks, contributions and incentives, RSA and homework, reports |
| 7 | Testing, security review, performance, deployment, backup and restore |

## 10. Phase 2 outcome (2026-10-31)

Done:

- **Job ID** is the UUID generated in HubSpot (stored lower-case, unique). A job request also stores its **HubSpot deal** (object `0-3`) and companies their **HubSpot company** (object `0-2`); PSMs paste a record link or ID and the dashboard links back using `HUBSPOT_PORTAL_ID`.
- **Products** are candidate programmes with a category (9 codes seeded). A job request lists the products eligible to apply instead of having one product.
- **Companies**: directory visible to everyone (open-job counts follow data scope), create / edit with HubSpot de-duplication, mark inactive (blocks new job requests), detail page with job requests and history.
- **Job requests**: create / edit / list with search, server paging and Active / Closed / All views; tech stack as normalised skills; eligible products; timeline, shortlisting mechanism, remarks, sheet links.
- **Status rules** (shared by API and UI): Draft → Open / Cancelled; Open → On hold / Filled / Closed / Cancelled; On hold → Open / Closed / Cancelled; Filled → Open / Closed; Closed → Open; Cancelled is final. A reason is required to put on hold, cancel or reopen. *Assumed — confirm with the PSM team.*
- **Ownership**: a PSM creates job requests for themselves; managers assign or reassign within their team, administrators anyone. Every change keeps the previous owner in the ownership history; the previous owner loses access.
- **Editing companies**: administrators and managers any; PSMs only companies they created or have job requests at.
- History tabs for companies and job requests from the audit log, with field-level changes.
- Prisma `relationJoins` enabled: related data loads in one query, which cut API response times by 2–3× (job detail ~1.4 s → ~0.56 s from India against the us-east-2 database).

Verified: 38 unit tests; 27 end-to-end API checks with admin, manager and PSM accounts on the dev branch; a browser walkthrough creating a job request through the form and changing its status.

Open:

- The database round trip from India to Neon's us-east-2 region is about 250 ms. In production the API should run in the same region as the database, and an Asia-Pacific region would suit users in India. A Neon project's region cannot be changed, so this needs deciding before go-live.
- Company activities and follow-ups move to Phase 6 (PSM operations).

## 11. Phases 3–4 outcome (2026-10-31)

Built on the dev branch (migration `20261031180000_candidates_screening_pipeline_imports`, additive only).

**Sheet imports (both phases use one pipeline).** Connect a Google Sheets workbook on a job request → select relevant tabs (previous selections are prefilled) → automatically infer headers and columns → validate with errors / warnings / notes → save. Company imports show staged rows for review before commit; internal Google Sheets imports are validated before their existing direct-save flow. Internal stage decisions remain in Sheets and are shown read-only in the dashboard. Nothing is written back to Sheets.

**Internal sheet (Phase 3).** Select the applications tab and any RS / SC / AS / SP tabs to import. Student details, product columns, candidate identity, and stage decisions are inferred, including headerless data. Placement imports now ignore source UUIDs and match candidates by normalized mobile only; duplicate or missing mobiles are excluded for review.

**Company-wise placement refresh (2026-11-04).** The internal Google Sheets flow now treats Applied Users as the application/profile base and derives TA from the job's distinct applications; RS / SC / AS / SP rows use their mapped shortlist statuses. Normalized mobile is the sole candidate match key across placement imports; source UUIDs and email are ignored for matching. Missing or shared mobiles are reported and excluded instead of being merged. SP does not require a manual stage or decision column: its row denotes final selection, while `Selection_Basis` and `Remarks` are saved on the stage outcome. `tool` analysis is stored in `CandidateResumeAssessment`; other supplemental tabs are saved as `CandidateAdditionalProfile` records classified independently from recruitment stages. The company dashboard shows job funnels, profile counts, candidate resume analysis, and SP selection-basis totals. Both profile tables retain the import-batch link; re-imports update the same candidate/job/source record.

**In the dashboard (Phase 3).** Job request → Internal screening: stage cards with counts and status, read-only candidate lists, product breakdowns, and Bucket / TR / Competency pool outcomes. Candidates list and profile show each job's internal and company history; contact details are hidden from roles without `candidate:pii:read`.

**Company pipeline (Phase 4).** Rounds configured per job (added by hand or from detected company-sheet columns), nominations (the owning PSM nominates; internally rejected candidates are refused), round results, and Selected → Offer released → Offer accepted → Joined (or declined / dropped) with dates and history. Company sheet import matches profiles by normalized mobile only and nominates profiles the company already has.

**Dashboard.** Live funnel from candidate records (applications, RS/SC/AS/SP selections, nominated, selected, offers, joined), following the date / product / tech-stack filters. Internal screening and Company pipeline pages show progress per active job; the Import centre lists each Google Sheets import.

**Rules assumed (please confirm):**

| Topic | Assumed rule |
|---|---|
| Stage flow | Being recorded at a later stage after a rejection at an earlier one is a **warning**, not a block. A stage tab without a decision column means everyone listed is selected. |
| Re-imports | A sheet only fills blank candidate fields; a different stored email / mobile is kept and reported. Decisions a PSM entered by hand are kept unless the PSM ticks "let the sheet replace". |
| Nominations | Any applicant never rejected at an internal stage can be nominated; final-shortlist candidates are offered first. |
| Company sheet | Being in the company's sheet means "in company process"; a rejected round means rejected unless the final-status column says otherwise; offers and joining recorded by a PSM are never overwritten by a sheet. |
| Pipeline moves | Not sent → In process → On hold / Rejected / Selected / Dropped; Selected → Offer released → Offer accepted / declined; Accepted → Joined / Dropped. Rejected, declined, joined and dropped are final. |
| Candidate category | Derived from the product (Academy plans → Academy, Intensive plans → Academy Intensive, External → External) when not set. |

**Verified:** 52 unit tests (import planners, matching, value meanings, normalisers, status rules); an end-to-end API run on the dev branch with fictional workbooks shaped like the real sheets (rows from another drive, hand-entered decisions vs re-imports, manual company-sheet match, offers to joining, re-use from an earlier drive, data scope); and a browser walkthrough of both wizards, screening, nominations, pipeline, dashboard and candidate history.

**Not yet:**

- Scheduled Google Sheets re-sync (Phase 5).
- Scheduled Google Sheets refresh still requires an explicit refresh/import action; background scheduling remains Phase 5.
- Uploaded files are stored in the database; move to object storage before volumes grow.
- Newer modules (applications, pipeline, candidates, imports service) query Prisma from their services for brevity; split into repositories when they grow.

## 12. Recruitment batches and sheets (2026-11-10)

**The job request owns the sheets.** `JobRequest.internalSheetUrl` / `companySheetUrl` are the workbooks every batch reads. `RecruitmentBatch.internalSheetUrl` / `companySheetUrl` are set only when a batch lives in a *different* workbook; links equal to the job's are stored as null, so editing the job's sheet applies to all batches that follow it. "Refresh from Google Sheets" reads the linked sheet (batch's own, else the job's) and falls back to the last imported sheet only when no link is set.

**Batch tabs.** Internal screening → Recruitment batches: add or edit a batch (name, openings, closed) and choose which tabs of the internal sheet are its TA / RS / SC / AS / SP (`RecruitmentBatch.internalTabs`). Tab names are suggested (`TA`, then `TA-1`, …). A new import for the batch starts from those tabs; the last approved mapping is reused only while it reads the same tabs. The tabs confirmed on the mapping screen are written back to the batch on save. Edge cases: one tab belongs to one batch per workbook (409 `TAB_IN_USE`); batch names are unique per job; a chosen tab missing from the sheet is flagged and that stage is mapped on import; without a TA tab the import detects tabs itself; a sheet not shared with the service account returns `SHEET_ACCESS_DENIED` with the email to share with.

**SP selection basis.** A `Selection_Basis` column is optional. Without one, the SP tab's Remarks are used as the selection basis (existing SP rows were backfilled), and the SP list shows the selection basis.

## Company status, guidance and stakeholder insights (2026-11-10)

Migration `20261110200000_guidance_company_process_skip_reason` (additive only).

- **Skipped screening.** When SC is marked not conducted, the PSM picks a reason (`InternalProcessStage.skipReason`: time constraint, company asked for profiles directly, repeat drive, profiles already assessed, too few applications, other) and writes a required note. Profiles go straight to SP; each student's `Selection_Basis` records the signals that were used. Only SC can be skipped.
- **Not shared with company.** A student selected at SP is *not shared* when the company does not have the profile: no nomination, a withdrawn nomination, or a nomination still `NOT_SUBMITTED`. The company sheet import is what creates nominations, so "not in the company sheet" means not shared. This status appears on the pipeline tab, the company page, My companies and Insights.
- **Company process status** (per job): Yet to share CVs → CVs shared → Hiring in progress → *round* yet to start / in progress (pointing at one of the job's configured rounds, e.g. "Yet to start TR1", "TR2 in progress") → On hold → Offers released → Process completed. Set by hand and logged in `CompanyProcessHistory`; it is separate from the job request's open/closed status.
- **Guidance.** `GuidanceSession` = a drive-level session; `CandidateGuidance` = one student guided individually. Any PSM with `pipeline:write` can open `/guidance/:jobId` for any live job (it shows student names, not contact details) and record guidance under their own name. Only the giver, or an administrator, can remove it. A student already guided by another PSM cannot be overwritten (409).
- **My companies** (`/my-work`): the PSM's jobs, with company status, TA, internal rejections, SP, shared / not shared, in process, company rejections, selects, offers / joined, and guidance. Administrators and managers can switch to another PSM in their scope.
- **Insights** (`/insights`, admin / manager / stakeholder): company-level, monthly (by job request month), category-level and student-level metrics. "Rejected internally" means rejected at RS, SC or AS. The page also shows Academy internal rejections, SC no-shows, drives with screening skipped (by reason), top rejection reasons, and active jobs by company status. **Stakeholders see the whole workspace here**; managers see their team and employees their own jobs, as elsewhere.
