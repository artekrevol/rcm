# Migration State — Phase 3 Sprint 0

**Last updated:** 2026-05-03
**Sprint:** Phase 3 Sprint 0 — Architectural Foundation (complete)
**Production deploys:** Zero. Standing order is no production deploys without Abeer review.

This document is the single source of truth for the in-flight Phase 3 migration. It captures (a) what has shipped, (b) what is intentionally inert and gated behind a flag, and (c) the prerequisites that must be resolved before each subsequent sprint may begin.

---

## 1. What shipped in Sprint 0

| Area | Artifact | Status |
|---|---|---|
| Snapshot | `docs/architecture/sprint0-snapshots/dev-pre-sprint0-20260503-022630Z.sql` (121 MB, .gitignored) | ✅ |
| DDL bundle | `docs/architecture/sprint0-snapshots/sprint0-ddl.sql` | ✅ applied |
| Role DDL | `docs/architecture/sprint0-snapshots/sprint0-app-role.sql` | ✅ applied |
| New table — `practice_profiles` (global catalog) | 14 cols, no RLS | ✅ |
| New table — `organization_practice_profiles` | RLS + FORCE | ✅ |
| New table — `provider_practice_relationships` | RLS + FORCE | ✅ |
| New table — `provider_payer_relationships` | RLS + FORCE | ✅ |
| New table — `patient_insurance_enrollments` | RLS + FORCE | ✅ |
| New table — `claim_provider_assignments` | RLS + FORCE | ✅ |
| Reconciled table — `practice_payer_enrollments` | 8 → 20 cols (additive only); RLS + FORCE | ✅ |
| Seed — `home_care_agency_personal_care` profile | 5 svc codes, 13 intake fields, 6 rule subs | ✅ |
| Mapping — `chajinel-org-001` ↔ home_care profile | `is_primary=true` | ✅ |
| Drizzle schema additions | 7 new tables in `shared/schema.ts:721-842` | ✅ |
| Tenant context middleware | `server/middleware/tenant-context.ts` | ✅ wired in `server/index.ts:86` |
| App role | `claimshield_app_role` (NOLOGIN, NOINHERIT) | ✅ |
| Helper service layer | `server/services/practice-profile-helpers.ts` (6 helpers) | ✅ idle (flag OFF) |
| Tier 1 validator | `server/services/rules-engine/tier1-structural-integrity.ts` (8 rules) | ✅ idle (not wired) |
| Feature flag | `server/config/feature-flags.ts` (`USE_PROFILE_AWARE_QUERIES` default false) | ✅ OFF |
| Verification scripts | `scripts/verify-tenant-isolation.ts` (12/12 pass), Tier 1 unit tests (16/16 pass) | ✅ |

Existing tables (`organizations`, `payers`, `providers`, `patients`, `claims`, `practice_settings`, etc.) were **not modified** beyond the additive ALTERs on `practice_payer_enrollments`. Read-only contract honored.

## 2. RLS architecture — load-bearing facts for Sprint 1+

**Read this section before adding any new tenant-scoped query.**

The new Phase-3 tables have:
- `ENABLE ROW LEVEL SECURITY`
- `FORCE ROW LEVEL SECURITY`
- A `tenant_isolation` policy: `USING (organization_id = current_setting('app.current_organization_id', true))`
- A `service_role_bypass` policy granting full access to `claimshield_service_role`

**However**, the application's `pg.Pool` connects as the database superuser (`postgres`). Postgres superusers bypass RLS unconditionally — `FORCE ROW LEVEL SECURITY` forces RLS on the table owner but NOT on superusers. This is documented PG-engine behavior, not a misconfiguration.

The Sprint 0 fix:
- Created `claimshield_app_role` (NOLOGIN, NOINHERIT, no `BYPASSRLS`).
- Granted `claimshield_app_role` `SELECT/INSERT/UPDATE/DELETE` on the 6 tenant-scoped tables, plus `SELECT` on `practice_profiles` (global catalog) and `SELECT` on the parent tables `organizations, payers, providers, patients, claims` (so helpers can JOIN).
- Granted membership: `GRANT claimshield_app_role TO postgres`.
- `withTenantTx` (`server/middleware/tenant-context.ts:95`) issues `SET LOCAL ROLE claimshield_app_role` immediately after `BEGIN`. The `LOCAL` qualifier reverts the role on `COMMIT`/`ROLLBACK`, so the pool client returns clean. The `set_config('app.current_organization_id', $1, true)` follows the role switch — custom GUCs are settable by any role.

**Practical rule for new code:**
> Any tenant-scoped query MUST use `withTenantTx` (or the helpers in `server/services/practice-profile-helpers.ts`). The global `db` import from `server/db.ts` connects as `postgres` and bypasses RLS — using it for tenant-scoped reads will silently leak cross-tenant rows.

Existing code paths (cron jobs, seeders, the legacy rules engine, the EDI generator) continue to use the global `db`/`pool` and continue to bypass RLS. This is the intentional Sprint 0 contract — none of the tables they touch have RLS enabled. They are unaffected by this sprint.

## 3. Sprint 1 prerequisites (must be resolved before Sprint 1 INSERTs)

### 3.1 Add `WITH CHECK` clauses to every `tenant_isolation` policy

Sprint 0 only ships read-side helpers, so the missing `WITH CHECK` is harmless. The moment Sprint 1 adds an INSERT/UPDATE helper that runs through `claimshield_app_role`, an INSERT could write a row with any `organization_id`, even one that doesn't match the current tenant context. `USING` covers SELECT and the row-visibility side of UPDATE/DELETE; `WITH CHECK` covers the row-validation side of INSERT and UPDATE.

Required DDL (run before the first Sprint-1 INSERT helper lands in production):

```sql
ALTER POLICY tenant_isolation ON organization_practice_profiles
  USING       (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK  (organization_id = current_setting('app.current_organization_id', true));

ALTER POLICY tenant_isolation ON practice_payer_enrollments
  USING       (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK  (organization_id = current_setting('app.current_organization_id', true));

ALTER POLICY tenant_isolation ON provider_practice_relationships
  USING       (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK  (organization_id = current_setting('app.current_organization_id', true));

ALTER POLICY tenant_isolation ON provider_payer_relationships
  USING       (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK  (organization_id = current_setting('app.current_organization_id', true));

ALTER POLICY tenant_isolation ON patient_insurance_enrollments
  USING       (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK  (organization_id = current_setting('app.current_organization_id', true));

ALTER POLICY tenant_isolation ON claim_provider_assignments
  USING       (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK  (organization_id = current_setting('app.current_organization_id', true));
```

### 3.2 `organizations.is_active` does not exist

`organizations` has columns `id, name, created_at, onboarding_dismissed_at, contact_email, status, updated_at`. There is no `is_active` boolean. Sprint 1 seed scripts and queries that filter "active orgs" must use `WHERE status = 'active'`. A quick grep before merging Sprint 1: `rg "organizations\.is_active|orgs\.is_active|o\.is_active"` — should return zero hits.

### 3.3 Drizzle drift on `organizations`

`shared/schema.ts:518-523` declares only `id, name, created_at, updated_at`. The columns `status`, `contact_email`, `onboarding_dismissed_at` exist in the DB but are not in Drizzle. Any Sprint 1 work that needs to read `organizations.status` through Drizzle must first extend the table definition (one-line add per column). Out of scope for Sprint 0 (`organizations` is a read-only table for this sprint).

## 4. Sprint 2 prerequisites (EDI generator refactor)

### 4.1 `practice_settings.billing_model` exists

Both Drizzle (`shared/schema.ts:539`) and the live DB agree this column exists. Both the audit (`12-known-issues-and-tech-debt.md`) and the original prompt assumption that "this column does not exist and the logic lives somewhere else" were wrong. Current data:

| organization_id | billing_model |
|---|---|
| `demo-org-001` | `direct` |
| `chajinel-org-001` | `agency_billed` |

The home_care profile's `edi_structural_rules.rendering_provider_loop_2310B.omit_when = 'agency_billed'` was written assuming the column does not exist. Sprint 2's EDI generator refactor must:

1. Locate every reference to `practice_settings.billing_model` in `server/services/edi-generator.ts` and any consumer.
2. Decide whether the profile rule **replaces** the column read (column becomes deprecated, single source of truth is the profile) or **augments** it (both are checked — backward compat).
3. If replacing, write a migration plan: deprecate column, mark for removal in Sprint 3.

This is the largest known reconciliation in the Phase 3 plan.

## 5. Demo data state — unmodified

The two existing rows in `practice_payer_enrollments` belong to `demo-org-001` (UnitedHealthcare commercial, UnitedHealthcare Medicare Advantage) with `notes='[demo_seed] Auto-enrolled for conditional-field activation demo'`. After the additive ALTERs, both rows have `enrollment_status='pending'` (the column DEFAULT). Per Sprint 0 sign-off (option a), no UPDATE was issued. If demo-data hygiene is later wanted, that is a separate, named decision in a future sprint.

## 6. Standing orders carried forward

- No production deploys without Abeer review.
- Read-only on existing tables (only additive ALTERs to `practice_payer_enrollments` are excepted, and they shipped in this sprint).
- Audit wins on conflicts — if a future audit and live introspection disagree, live introspection is authoritative; update the audit.
- Every new tenant-scoped query goes through `withTenantTx` (see §2).

## 7. Verification artifacts

| Check | Command | Result |
|---|---|---|
| Tenant isolation (4 cases × tables) | `npx tsx scripts/verify-tenant-isolation.ts` | 12/12 PASS |
| Tier 1 structural integrity | `npx tsx server/services/rules-engine/tier1-structural-integrity.test.ts` | 16/16 PASS |
| Workflow startup | observed in `Start application` after middleware wire-up | clean (no errors) |
| Existing rows preserved | `SELECT count(*) FROM practice_payer_enrollments;` returns 2 | ✅ |
