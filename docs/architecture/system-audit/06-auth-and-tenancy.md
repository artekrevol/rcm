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

### Layer 1 — DB (mixed: FK-only for legacy, RLS for Phase 3)

- **Foreign keys:** ~19 of 88 tables have an explicit FK on `organization_id → organizations.id` (`_queries/03_fks.txt`):
  `claims`, `patients`, `users`, `providers`, `practice_settings` (twice — duplicate constraint, see below), `pcp_referrals`, `practice_payer_enrollments`, `timely_filing_alerts`, the six `org_*` tables, and the six Phase 3 tables (`organization_practice_profiles`, `provider_practice_relationships`, `provider_payer_relationships`, `patient_insurance_enrollments`, `claim_provider_assignments`).
- **Row-Level Security (Sprint 0, 2026-05-03):** RLS + `FORCE ROW LEVEL SECURITY` is enabled on the 6 Phase 3 tables only. 12 policies total (2 per table — `tenant_isolation` USING + `service_role_bypass` USING). See `_queries/11_rls.txt` and `docs/architecture/sprint0-audit-report.md`. **Legacy tables (`leads`, `claims`, `patients`, etc.) have no RLS** — they remain enforced at app level only.
- **Sprint 1 prerequisite — `WITH CHECK` clauses not yet added** to the 6 Phase 3 policies; cross-tenant INSERTs are not blocked by the DB. Tracked in `migration-state.md` §3.1; must land before any Sprint-1 INSERT helper.
- **No database triggers** to default-fill `organization_id` (`_queries/08_triggers.tsv` is empty).
- **Tables holding `organization_id` without a FK constraint:** `leads`, `calls`, `chat_sessions`, `appointments`, `flows`, `flow_runs`, `denials`, `era_batches`, `activity_logs`, `email_logs`. Observable schema drift; documented in 12.
- **Duplicate FK on `practice_settings`:** both `practice_settings_org_fk` (RESTRICT) and `practice_settings_organization_id_fkey` (NO ACTION) exist (`_queries/03_fks.txt`).

### Layer 1.5 — DB roles (Sprint 0)

- `claimshield_app_role` — `NOLOGIN`, `NOINHERIT`. The role under which RLS-bound queries run.
- `claimshield_service_role` — bypass principal for migrations/admin tooling.
- The global `db`/`pool` from `server/db.ts` connects as superuser `postgres` and **bypasses RLS unconditionally**. Any tenant-scoped read on the 6 RLS tables must go through `withTenantTx` (or helpers in `server/services/practice-profile-helpers.ts`), which does `SET LOCAL ROLE claimshield_app_role` and `set_config('app.current_org_id', ...)` per transaction. Verified via `scripts/verify-tenant-isolation.ts` (12/12 cases pass).

### Layer 1.6 — Tenant context middleware (Sprint 0)

`server/index.ts:86` installs a middleware that:
1. Reads `req.user.organization_id` (or super_admin impersonation id).
2. Wraps the request handler in `AsyncLocalStorage` with the org id.
3. `withTenantTx` (from `server/services/tenant-context.ts`) opens a transaction, calls `SET LOCAL ROLE claimshield_app_role`, and `SELECT set_config('app.current_org_id', $1, true)`.

Feature flag `USE_PROFILE_AWARE_QUERIES=false` (`server/config/feature-flags.ts`) keeps the helpers idle until Sprint 1 wires them in.

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

- ⚠ **RLS partial — only on 6 of 88 tables.** Sprint 0 added RLS to the Phase 3 tables; the legacy 82 tables (incl. `claims`, `patients`, `leads`) still rely entirely on app-level `verifyOrg` checks. Roadmap: extend RLS to the rest in subsequent sprints once `WITH CHECK` clauses are validated on the Phase 3 set.
- ⚠ **`WITH CHECK` clauses missing** on the 6 Phase 3 policies — cross-tenant INSERTs are not DB-blocked yet. Must land before Sprint 1 INSERT helpers ship (`migration-state.md` §3.1).
- ⚠ **Org filter is opt-in per query**: code inventory grep for `organization_id` filters in `_grep/org_filters.txt` returned **504 matches** across server code, confirming the filter pattern is widely applied (vs the pre-Sprint-0 audit that reported 0 — that was a pattern-mismatch artifact). Inventory in `storage.ts` directly is still recommended for full coverage.
- ⚠ **`STEDI_WEBHOOK_SECRET`** is checked for inbound Stedi webhooks (`routes.ts:12767`); Vapi uses `VAPI_WEBHOOK_SECRET` (`routes.ts:9279`). **Twilio inbound SMS signature validation is UNVERIFIED.**
- ⚠ **`SUPER_ADMIN_PASSWORD` and `DANIELA_PASSWORD`** are used at `routes.ts:501-547` to seed/reset known accounts on startup or via a dev endpoint. This is a deployment-only convenience; production must rotate or remove these.

## Sessions

- `session` table currently has 0 rows (dev DB).
- 24-hour rolling cookie (per progress notes; not directly re-confirmed in this session).
- `req.session.impersonatingOrgId` is the super_admin scoping handle. **UNVERIFIED:** path that sets it (likely `/api/admin/impersonate/:orgId` — search to confirm).
