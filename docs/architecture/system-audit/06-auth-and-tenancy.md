# 06 — Auth and Multi-Tenancy

## Authentication stack

- **Strategy:** Passport local (`server/auth.ts`).
- **Password hashing:** `bcryptjs`, rounds = 10 (`auth.ts`).
- **Session store:** custom `PgSessionStore` writing to `session` table; 24-hour cookie.
- **Cookie signing:** `SESSION_SECRET` env var (`auth.ts:106`).
- **Rate limiting:** 10 failed attempts / 15 min via `login_attempts` table (3 rows currently).
- **Session table bootstrap:** `ensureSessionTable()` runs at app startup before `setupAuth(app)` (`server/index.ts:77-78`).

## Helpers (server/auth.ts:231-260, per progress notes)

```ts
requireAuth(req, res, next)              // 401 if not logged in
requireRole(...allowed)(req, res, next)  // 403 if user.role ∉ allowed
requireSuperAdmin(req, res, next)        // 403 unless user.role === 'super_admin'
```

## Roles (observed values)

From route definitions (`_queries/21_code_inventory.txt`) and the `role_permissions` table (32 rows):
`super_admin`, `admin`, `rcm_manager`, `biller`, `coder`, `front_desk`, `intake`.

## Frontend gate

`<AuthGuard allowedRoles={...}>` at `client/src/components/auth-guard.tsx` — wraps every protected route in `App.tsx`. `useAuth()` (`client/src/hooks/use-auth.ts`) exposes `AuthUser` with `role` and `organization_id`, plus `useOrgId()` helper.

## Multi-tenancy enforcement

### Layer 1 — DB (partial)

- 13 of 82 tables have an explicit FK on `organization_id → organizations.id` (`_queries/04_foreign_keys.tsv`):
  `claims`, `patients`, `users`, `providers`, `practice_settings` (twice — duplicate constraint, see below), `pcp_referrals`, `practice_payer_enrollments`, `timely_filing_alerts`, and the six `org_*` tables.
- **No DB-side row-level security** (`_queries/12_rls_policies.tsv` is empty) — all tenancy enforcement happens in app code.
- **No database triggers** to default-fill `organization_id` (`_queries/08_triggers.tsv` is empty).
- Many tenant-scoped tables (`leads`, `calls`, `chat_sessions`, `appointments`, `flows`, `flow_runs`, `denials`, `era_batches`, `activity_logs`, `email_logs`) hold `organization_id` per the Drizzle schema but **do not declare an FK constraint**. This is observable schema drift.
- **Duplicate FK on `practice_settings`:** both `practice_settings_org_fk` (RESTRICT) and `practice_settings_organization_id_fkey` (NO ACTION) exist (`_queries/04_foreign_keys.tsv:36-37`).

### Layer 2 — App (primary enforcement)

`server/routes.ts` wraps every list/detail endpoint with the helper trio (`routes.ts:153-186`):

```ts
function getOrgId(req): string | null
function verifyOrg(entity, req): boolean    // false ⇒ deny
function requireOrgCtx(req, res): string | null  // 400 if missing
```

Key behaviors:
- For `super_admin`, org context comes from `req.session.impersonatingOrgId`. Without impersonation, `verifyOrg` **denies** access to any org-scoped entity (`routes.ts:171-174`). Comment: "Super admins must impersonate an org to access its data through regular endpoints."
- For regular users, org id comes from `user.organization_id`.
- Every storage call that returns org-scoped rows is expected to filter by `organization_id` in `IStorage` (per `replit.md`).

### Layer 3 — Cron / background jobs

- **Flow orchestrator** (`server/jobs/flow-orchestrator.ts:11-23`) selects all `flow_runs` regardless of org, but each run already carries `flow_id` and `lead_id` whose org is implicit. **No explicit cross-org leakage check.**
- **Timely filing cron** (`server/jobs/timely-filing-cron.ts`) iterates all active claims; org is captured via the alert row's `organization_id` FK. Email digest grouping by org is **UNVERIFIED**.
- **Scraper cron** runs once per payer globally — payer documents are not org-scoped (they're shared reference data).
- **CCI cron** writes shared `cci_edits` (no org).

### Layer 4 — Frontend

`AuthGuard` checks role only; the org id is read from the authenticated session and used implicitly for all queries. There is **no client-side org switcher for non-super_admin users**.

## Known gates / hardening notes

- ⚠ **No RLS** — a missing org filter in any future query is silently cross-tenant. Adding RLS would be defense-in-depth.
- ⚠ **Org filter is opt-in per query**: code inventory grep for `organization_id` filters in storage / route handlers returned **0 hits** (`_queries/21_code_inventory.txt:284-285`). This is almost certainly a grep artifact (the filters live in `IStorage` implementations using Drizzle's `.where(eq(table.organizationId, ...))` — which our grep pattern missed). **UNVERIFIED via static grep — recommended next step is to inventory `storage.ts` directly.**
- ⚠ **`STEDI_WEBHOOK_SECRET`** is checked for inbound Stedi webhooks (`routes.ts:12767`); Vapi uses `VAPI_WEBHOOK_SECRET` (`routes.ts:9279`). **Twilio inbound SMS signature validation is UNVERIFIED.**
- ⚠ **`SUPER_ADMIN_PASSWORD` and `DANIELA_PASSWORD`** are used at `routes.ts:501-547` to seed/reset known accounts on startup or via a dev endpoint. This is a deployment-only convenience; production must rotate or remove these.

## Sessions

- `session` table currently has 0 rows (dev DB).
- 24-hour rolling cookie (per progress notes; not directly re-confirmed in this session).
- `req.session.impersonatingOrgId` is the super_admin scoping handle. **UNVERIFIED:** path that sets it (likely `/api/admin/impersonate/:orgId` — search to confirm).
