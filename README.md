# Placement Intelligence & Operations Platform

A modular monolith: a React/Vite client, an Express API, and Neon PostgreSQL managed with Prisma ORM 7. Architecture, schema design and agreed business rules are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Workspace layout

- `frontend/` — React, TypeScript, Vite, Tailwind CSS, shadcn/ui, React Router, TanStack Query/Table.
- `backend/` — Express API. Each module in `src/modules/<name>/` is split into `*.routes.ts` (wiring), `*.controller.ts` (HTTP in/out), `*.service.ts` (business rules, transactions, audit), `*.repository.ts` (Prisma queries) and `*.validators.ts` (Zod).
- `shared/` — the `@placement/shared` package used by both apps: API envelope types and the role → permission map.
- `prisma/` — schema, migrations and the seed script.
- `docs/` — architecture, decisions and the proposed full schema.

## Local setup

1. Install Node.js 22 or newer and npm.
2. Copy `.env.example` to `.env`. Fill the database URLs for your **development** Neon branch (see below), generate two different random JWT secrets, and set `ADMIN_EMAIL`, `ADMIN_PASSWORD` (at least 12 characters) and `ADMIN_NAME`. Never commit `.env`.
3. `npm install`
4. `npm run db:generate`
5. `npm run db:deploy` to apply the committed migrations to the database in `.env`.
6. `npm run db:seed` creates the built-in roles and the initial administrator. It does not touch any external data.
7. `npm run dev` builds `shared/` and starts the shared watcher, the API (`http://localhost:3001`) and the UI (`http://localhost:5173`, which proxies `/api`).

Other scripts: `npm test` (backend tests), `npm run typecheck`, `npm run build`.

## Neon branches

- `production` — the default branch. Only apply reviewed migrations here, with `npm run db:deploy` against production URLs.
- `dev` — a persistent copy of production used for local development, migrations in progress and test data. The local `.env` points here (`NEON_BRANCH=dev`).

Get a branch's connection strings with `neon connection-string dev --pooled` (for `DATABASE_URL`) and `neon connection-string dev` (for `DATABASE_URL_UNPOOLED` / `DIRECT_URL`). The API uses the pooled URL; Prisma migrations prefer `DATABASE_URL_UNPOOLED` and fall back to `DIRECT_URL`.

Because `prisma migrate dev` needs an interactive terminal, new migrations can be generated with:

```
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o prisma/migrations/<timestamp>_<name>/migration.sql
```

then reviewed, edited if needed (for example partial indexes), and applied with `npm run db:deploy`.

`neon.ts` also declares Realtime, the private `assets` and `psmdata` buckets and the `hello` Function used by the admin-only `GET /api/integrations/neon/status` check. Those service variables in `.env` still point at the production branch.

## API conventions

- Responses are `{ "data": ..., "meta"?: { page, pageSize, total, totalPages } }`; errors are `{ "error": { code, message, details?, requestId? } }`.
- Every response carries an `X-Request-Id` header; server errors include the same ID so a report can be matched to logs.
- Mutating requests may send an `Idempotency-Key` header. The first successful response is stored for 24 hours and replayed for repeats; a repeat that arrives while the first is still running gets `409`; reusing a key with a different body gets `422`. The frontend sends a fresh key for each create action.
- Request bodies, query strings and route parameters are validated with Zod on the server.
- Multi-step writes run in one transaction together with their audit event. Audit metadata is stored with passwords, tokens, email and phone values redacted.

## Authentication and permissions

- There is no public registration. The seed creates the first administrator, who creates Manager and PSM accounts in the Teams console.
- Passwords are hashed with bcrypt. Access JWTs are short-lived and kept in memory. Refresh tokens are opaque, stored only as keyed hashes, sent in an HttpOnly cookie and rotated on every use. Presenting an already-used token revokes the whole session family.
- Roles (`ADMIN`, `MANAGER`, `PSM`, `VIEWER`) live in the database. What each role may do is defined once in `shared/src/permissions.ts` and enforced by `requirePermission(...)` on the API. The UI uses the same map to hide navigation.
- Data scope: administrators see everything; managers see job requests owned by the PSMs of the team they lead; PSMs and viewers see job requests they own. PSM ownership is per job request.

## Google Sheets

Enable the Google Sheets API for the service-account project, set the service-account JSON as base64 in `GOOGLE_SERVICE_ACCOUNT_BASE64` (PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes('service-account.json'))`), and share each private workbook with the displayed service-account email. The current setup reads spreadsheet metadata and one header row to save tab and column mappings; it does not import rows or write to Sheets. Imports arrive in Phase 5.

## Status

Phases 1–4 are complete: foundation; companies, job requests and PSM ownership; candidates and internal screening with the internal-sheet import wizard; and the company pipeline with the company-sheet import wizard. Other modules show what each later phase will deliver. Set `HUBSPOT_PORTAL_ID` in `.env` so companies and deals link back to HubSpot.
