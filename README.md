# Placement Intelligence & Operations Platform

Phase 1 foundation for a modular monolith: a React/Vite client, Express API, and Neon PostgreSQL database managed with Prisma ORM 7.

## Workspace layout

- `frontend/` — React, TypeScript, Vite, Tailwind CSS, routing, query state, and dashboard UI.
- `backend/` — Express API, authentication, validation, security middleware, and business modules.
- `prisma/` — relational schema, migrations, and explicit seed script.
- `shared/types/` — cross-workspace types as features are added.

## Local setup

1. Install Node.js 22 or newer and npm.
2. Copy `.env.example` to `.env`, run `neon env pull` after `neon login` to fetch the linked branch's service variables, and generate different random JWT secrets. Do not commit `.env`.
3. Install dependencies with `npm install`.
4. Generate the Prisma client with `npm run db:generate`.
5. Apply development migrations with `npm run db:migrate`.
6. Set `ADMIN_EMAIL`, `ADMIN_PASSWORD` (at least 12 characters), and `ADMIN_NAME` in `.env`, then run `npm run db:seed`. The seed command creates/upserts the built-in roles and the initial administrator; it does not connect to a real spreadsheet or modify any external data.
7. Start the frontend and API with `npm run dev`.

The UI is available at `http://localhost:5173`; the API listens on `http://localhost:3001`. The Vite development server proxies `/api` requests to the API. In production, set `FRONTEND_ORIGIN` to the exact trusted frontend origin and configure the deployment to serve the frontend and API over HTTPS.

## Neon services

The project is linked to the `production` branch in Neon. Its `neon.ts` declares Postgres, Realtime, the private `assets` and `psmdata` buckets, and the `hello` Function. After authenticating with `neon login`, apply service changes with `neon deploy`; `neon env pull` writes the branch's connection, Realtime, Function, and S3-compatible storage variables into `.env`. Keep this file private.

The backend uses Prisma with its existing `pg` adapter and the pooled `DATABASE_URL` for application queries. Prisma migrations prefer Neon's `DATABASE_URL_UNPOOLED`, falling back to `DIRECT_URL` for existing setups. Apply committed production migrations with `npm run db:deploy`.

The backend's admin-only `GET /api/integrations/neon/status` endpoint checks Postgres, performs a temporary write/read/delete in the private `assets` bucket, calls the deployed Function, and subscribes to a live query through Neon Realtime. Run the same service checks without signing in using `npm run test:neon --workspace backend`; it does not print environment credentials.

Administrators use `/teams` to create teams, create Manager (team lead) and PSM accounts, set initial passwords, and assign each PSM to one team. Managers see only their team; PSM dashboard counts are scoped to their own assigned companies/job requests. Passwords are hashed and never returned after account creation. Managers can inspect their team's membership and configure its Google Sheets sources at `/sheets`.

To enable sheet-tab selection, enable the Google Sheets API for the service-account project, set the service account JSON as the base64-encoded `GOOGLE_SERVICE_ACCOUNT_BASE64` on the backend, and share each private workbook with the displayed service-account email. For example, on PowerShell, encode a local credential file with `[Convert]::ToBase64String([IO.File]::ReadAllBytes('service-account.json'))` and set that value in the ignored `.env`; do not commit the credential file or value. The setup reads spreadsheet metadata and only the header row an admin selects. It stores explicit tab/stage/column mappings, but does not yet import candidate rows, write a backup to Sheets, or run continuous sync.

## Authentication and security

- There is no public registration endpoint. Create the initial administrator through the explicit seed command; the administrator provisions Manager and PSM accounts through the team console.
- Passwords use bcrypt hashing. Access JWTs are short-lived and kept in browser memory. Refresh tokens are opaque, stored only as keyed hashes in PostgreSQL, sent in an HttpOnly cookie, rotated on use, and revoked on logout or detected reuse.
- The API validates request bodies with Zod, applies Helmet, CORS allowlisting, request-size limits, rate limits, structured redacted logs, centralized error responses, and role-aware authorization middleware.
- The initial role codes are `ADMIN`, `MANAGER`, `PSM`, and `VIEWER`. Fine-grained per-action permissions are intentionally deferred until their business rules are approved.

## Database notes

Prisma CLI operations prefer `DATABASE_URL_UNPOOLED` and fall back to `DIRECT_URL`; the API uses pooled `DATABASE_URL` through the PostgreSQL driver adapter. The schema stores users, roles, teams, sheet connection and stage-mapping configuration, refresh-token sessions, companies, products, job requests, PSM assignment history, and audit events. Candidate, application, screening, hiring-pipeline, and import entities are reserved for a later phase.

The database schema is the source of truth for persisted state. The admin overview and team/PSM workspace counts come from current database records and are scoped by role. Placement outcome conversion metrics, assessed-pool actions, candidate records, and automated Google Sheets imports/sync are not implemented yet; any remaining sample analytics are labeled as preview data.

## Decisions to confirm before affected features

- Job ID format, job status transitions, and whether multiple products may apply to one request.
- Whether a PSM assignment to a company is inherited by its job requests, and whether an owner may be assigned to multiple open requests.
- Company identity strategy. Company name is deliberately not unique; an external stable identifier may be added when its source is known.
- Role permissions and which candidate fields are visible to each role.
- Retention and deletion rules for audit events, refresh sessions, and candidate personal information.

These decisions do not block the Phase 1 scaffold or authentication; they must be settled before implementing the dependent workflows.
