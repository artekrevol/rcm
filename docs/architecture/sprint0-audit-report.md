# Phase 3 Sprint 0 — Final Audit Report

**Sprint:** Phase 3 Sprint 0 — Architectural Foundation
**Date completed:** 2026-05-03
**Environment:** dev only (`heliumdb`, PG 16.10). Zero production deploys.
**Standing order honored:** No production deploys without Abeer review. Read-only on existing tables (only additive ALTERs to `practice_payer_enrollments`).

---

## 1. Executive summary

Sprint 0 shipped the architectural foundation for Phase 3 — a profile-aware multi-tenant model — without altering existing application behavior. Every new code path is either gated by a feature flag (default OFF) or not yet wired into a route, cron job, or seeder.

- **6 new tables** created (1 global catalog + 5 tenant-scoped relationship tables).
- **1 reconciled table** (`practice_payer_enrollments`) extended from 8 → 20 columns via additive ALTERs only.
- **RLS + FORCE RLS** enabled on all 6 tenant-scoped tables, with a `tenant_isolation` policy and a `service_role_bypass` policy on each (12 policies total).
- **Tenant-context middleware** wired into `server/index.ts` using `AsyncLocalStorage` and a transaction-scoped `set_config` helper.
- **`claimshield_app_role`** introduced after a discovered gap (the connecting role is a superuser and bypasses RLS); `withTenantTx` issues `SET LOCAL ROLE` so RLS is actually enforced for helper queries.
- **Helper service layer** (`practice-profile-helpers.ts`, 6 helpers) — idle, behind feature flag.
- **Tier 1 structural-integrity validator** (8 rules) — idle, not wired into the legacy rules engine.
- **Feature flag** `USE_PROFILE_AWARE_QUERIES=false`.
- **Migration-state document** captures Sprint 1+ prerequisites.

**Verification:** 12/12 tenant-isolation cases pass. 16/16 Tier 1 unit tests pass. Helper smoke test on dev DB confirms the seeded `home_care_agency_personal_care` profile resolves for `chajinel-org-001` and that demo-org-001 sees its 2 enrollments while chajinel and no-context see 0. Workflow restarted clean after middleware insertion.

**Existing data:** untouched. The 2 demo-seed rows in `practice_payer_enrollments` remain at `enrollment_status='pending'` (the column DEFAULT). No UPDATEs were issued to existing rows. All existing tables, columns, and constraints other than `practice_payer_enrollments`'s additive new columns are byte-identical to the pre-sprint snapshot.

---

## 2. Step-by-step results

### Step 1 — Read-only inspection ✅
Snapshot at `docs/architecture/sprint0-snapshots/dev-pre-sprint0-20260503-022630Z.sql` (121 MB, .gitignored). Findings written to `docs/architecture/sprint0-existing-schemas.md`. Three audit-drift items identified and recorded in §8b of that doc.

### Step 2 — `practice_profiles` catalog ✅
Created with 14 columns, no RLS (global catalog). Verified via `SELECT relname, relrowsecurity FROM pg_class` — `practice_profiles` correctly absent from the RLS-enabled list.

### Step 3 — Seed `home_care_agency_personal_care` ✅
1 row inserted via `ON CONFLICT (profile_code) DO NOTHING`. Counts:
- `service_code_catalog`: 5 entries (T1019, S5125, S5130, S5135, 99509)
- `intake_field_specs`: 13 entries
- `claim_field_specs`: 4 entries
- `payer_relationship_templates`: 4 entries (TWVACCN, IHSS_SAN_MATEO, LTC_PLACEHOLDER, PRIVATE_PAY)
- `provider_role_definitions`: 4 entries
- `authorization_templates`: 3 entries
- `rule_subscriptions`: 6 entries
- `edi_structural_rules.default_place_of_service` = `"12"`
- `edi_structural_rules.rendering_provider_loop_2310B.omit_when` = `"agency_billed"`

### Step 4a — `organization_practice_profiles` + Chajinel mapping ✅
Created with composite PK `(organization_id, profile_code)` and a partial unique index `idx_one_primary_profile_per_org WHERE is_primary = true`. INSERT for Chajinel: `is_primary=true`, `effective_from=CURRENT_DATE`, no `effective_to`. Idempotent via `ON CONFLICT DO NOTHING`.

### Step 4b — `practice_payer_enrollments` ALTERs ✅
8 → 20 columns. All additive; the 2 existing demo-org-001 rows were preserved. Columns added: `enrollment_status` (NOT NULL DEFAULT `'pending'`), `effective_from/to`, `billing_npi`, `taxonomy_code`, `submission_method`, `clearinghouse`, `timely_filing_days`, `prior_auth_required` (NOT NULL DEFAULT `false`), `contracted_rate_table_id`, `created_at/updated_at` (both NOT NULL DEFAULT `NOW()`). Per Sprint 0 sign-off (option a), the 2 demo rows landed at `enrollment_status='pending'` with no follow-up UPDATE.

### Steps 4c–4f — Four new relationship tables ✅
- `provider_practice_relationships` (8 cols + composite UNIQUE, indexed on `(organization_id, is_active)`)
- `provider_payer_relationships` (10 cols + composite UNIQUE)
- `patient_insurance_enrollments` (12 cols + composite UNIQUE on `(patient_id, payer_id, coverage_priority)`, two indexes)
- `claim_provider_assignments` (8 cols + composite UNIQUE, two indexes)

All four FK to `organizations`, `payers`, `providers`, `patients`, `claims` as appropriate. Type assumptions (varchar IDs everywhere except `practice_payer_enrollments.id` which is uuid) verified in Step 1 §5.

### Step 5a — Enable RLS ✅
`ALTER TABLE … ENABLE ROW LEVEL SECURITY` on all 6 tenant-scoped tables.

### Step 5b — Tenant isolation policies ✅
`tenant_isolation USING (organization_id = current_setting('app.current_organization_id', true))` on all 6 tables. The `, true` makes `current_setting` return NULL when unset, so the policy fails closed.

**Known gap (carried into Sprint 1):** policies have only `USING`, no `WITH CHECK`. Sprint 0 ships only read helpers, so this is harmless now — but the gap **must** be closed before any Sprint 1 INSERT helper goes live, or an INSERT through `claimshield_app_role` could write a row with a different `organization_id` than the current tenant. DDL is in `docs/architecture/migration-state.md` §3.1.

### Step 5c — Service role + FORCE RLS ✅
Created `claimshield_service_role` (NOINHERIT). Granted DML on the 6 tenant-scoped tables. `FORCE ROW LEVEL SECURITY` on all 6. Service-role bypass policy (`PERMISSIVE FOR ALL TO claimshield_service_role USING (true) WITH CHECK (true)`) on all 6.

### Step 5d–5e — Middleware wired ✅
`server/middleware/tenant-context.ts` with three exports:
- `tenantContextMiddleware(req, res, next)` — populates AsyncLocalStorage with `{ organizationId, userId, role }` from `req.user`.
- `withTenantTx(fn, orgIdOverride?)` — opens a transaction, drops privileges to `claimshield_app_role`, sets the tenant GUC, runs the caller's function, commits.
- `runWithTenantContext(ctx, fn)` — explicit context for non-HTTP entry points (cron, scripts, tests).

Wired in `server/index.ts:86` between `setupAuth(app)` and `registerRoutes(...)`. Workflow restarted clean (logs show `serving on port 5000` with no errors).

### Step 5f — Verification (the unexpected discovery) 🚩 → ✅

The first run failed 6 of 12 cases — every "no context" or "wrong context" query returned **all** rows in the table, ignoring RLS entirely. Diagnosis: the application's `pg.Pool` connects as `postgres`, a superuser. Postgres superusers bypass RLS unconditionally; `FORCE ROW LEVEL SECURITY` forces RLS on the table owner but **not on superusers**. This is documented PG-engine behavior, not a misconfiguration.

**Fix applied (with sign-off):** added `claimshield_app_role` (NOLOGIN, NOINHERIT, no `BYPASSRLS`). Granted DML on the 6 tenant tables, SELECT on `practice_profiles`, and **SELECT on parent tables `organizations, payers, providers, patients, claims`** (essential for helper joins per sign-off). Granted membership: `GRANT claimshield_app_role TO postgres`. Modified `withTenantTx` to `SET LOCAL ROLE claimshield_app_role` immediately after `BEGIN` — `SET LOCAL` reverts on COMMIT/ROLLBACK so the pool client returns clean.

Re-run after fix: **12/12 PASS** (all cases below).

| Case | ctx | Table | Expected | Actual |
|---|---|---|---|---|
| 1 | none | practice_payer_enrollments | 0 | 0 ✅ |
| 1 | none | organization_practice_profiles | 0 | 0 ✅ |
| 1 | none | patient_insurance_enrollments | 0 | 0 ✅ |
| 1 | none | provider_practice_relationships | 0 | 0 ✅ |
| 1 | none | provider_payer_relationships | 0 | 0 ✅ |
| 1 | none | claim_provider_assignments | 0 | 0 ✅ |
| 2 | demo-org-001 | practice_payer_enrollments | 2 | 2 ✅ |
| 2 | demo-org-001 | organization_practice_profiles | 0 | 0 ✅ |
| 3 | chajinel-org-001 | organization_practice_profiles | 1 | 1 ✅ |
| 3 | chajinel-org-001 | practice_payer_enrollments | 0 | 0 ✅ |
| 4 | fake-org-xyz | practice_payer_enrollments | 0 | 0 ✅ |
| 4 | fake-org-xyz | organization_practice_profiles | 0 | 0 ✅ |

### Step 6 — Helper service layer ✅
`server/services/practice-profile-helpers.ts` exports:
- `getActivePracticeProfile(organizationIdOverride?)` — joins `org_practice_profiles` + `practice_profiles`
- `getEnrolledPayers()` — joins `ppe` + `payers`
- `getActiveProviders()` — joins `ppr` + `providers`
- `getProviderPayerParticipation()`
- `getPatientCoverages(patientId)` — joins `pie` + `payers`
- `getClaimProviderAssignments(claimId)` — joins `cpa` + `providers`

Per Sprint 0 sign-off (decision #3), Drizzle definitions for all 7 new/reconciled tables added to `shared/schema.ts:721-842`. Helpers consume these types.

**Smoke test (dev DB):**
```
Chajinel active profile code: home_care_agency_personal_care
  display: Home Care Agency — Personal Care
  is_primary: true
  rule_subs count: 6
demo-org-001 enrollments: 2
chajinel-org-001 enrollments: 0
no-ctx enrollments (must be 0): 0
```

The helper-layer JOINs to parent tables succeed because of the SELECT grant added in Step 5f's role fix. Without that grant, `getEnrolledPayers` would have thrown `permission denied for table payers` on first run.

### Step 7 — Tier 1 structural validator ✅
`server/services/rules-engine/tier1-structural-integrity.ts` — pure function `validateTier1Structural(input)` returning a `Tier1Finding[]`. Eight rules:

| Code | Description | Severity |
|---|---|---|
| T1-001 | `organization_id` present | block |
| T1-002 | `patient_id` present | block |
| T1-003 | At least one service line | block |
| T1-004 | Every line has a CPT/HCPCS-shaped procedure code | block |
| T1-005 | Every line has units > 0 | block |
| T1-006 | Every line has a non-negative charge | block |
| T1-007 | Primary ICD-10 present and well-formed (accepts `F0390` and `F03.90`) | block |
| T1-008 | Service date present (header or any line) | block |

**Test results:** 16/16 PASS. Runner is a tsx-runnable assertion script (no test-framework dependency added to `package.json`). Run with `npx tsx server/services/rules-engine/tier1-structural-integrity.test.ts`.

The validator is **not wired** into `server/services/rules-engine.ts` (`evaluateClaim`). Sprint 1+ may opt routes into calling it before legacy rules.

### Step 8 — Feature flag ✅
`server/config/feature-flags.ts` exports `useProfileAwareQueries()` (reads `USE_PROFILE_AWARE_QUERIES` env, default `false`). The flag does NOT control whether RLS, the middleware, or the helpers themselves work — it controls only whether routes/jobs are *expected* to use the new helpers. This separation lets Sprint 1 unit-test the helpers without flipping production behavior.

### Step 9 — Migration-state document ✅
`docs/architecture/migration-state.md` records:
- What shipped (§1)
- The RLS + role + `SET LOCAL ROLE` architecture and the load-bearing rule that any new tenant-scoped query must use `withTenantTx` (§2)
- Sprint 1 prerequisites: `WITH CHECK` policy gap, `organizations.is_active` does not exist, Drizzle drift on `organizations` (§3)
- Sprint 2 prerequisites: `practice_settings.billing_model` reconciliation (§4)
- Demo data state (§5), standing orders (§6), verification artifacts (§7)

---

## 3. Audit drift correction

Three claims in `docs/architecture/system-audit/` were marked `VERIFIED` but turned out wrong. Recorded in `docs/architecture/sprint0-existing-schemas.md` §8b and `docs/architecture/migration-state.md`. Summary:

1. `organizations.slug` does not exist.
2. `organizations.is_active` does not exist (it's `status` with values like `'active'`).
3. `practice_settings.billing_model` does exist (Drizzle and live DB agree).

The audit remains broadly accurate, but the methodology lesson is recorded: future architectural work should re-introspect against the live DB on anything load-bearing rather than relying on audit text alone. Drizzle drift on `organizations` (only `id, name, created_at, updated_at` declared, vs. 7 columns in the DB) is a separate, smaller issue noted for Sprint 1 if `organizations.status` needs Drizzle access.

## 4. Risks and mitigations carried into Sprint 1+

| Risk | Mitigation | Owner |
|---|---|---|
| Sprint 1 INSERT helper writes wrong-tenant row through `claimshield_app_role` | `WITH CHECK` clauses (DDL in `migration-state.md` §3.1) — must run before first INSERT helper ships | Sprint 1 lead |
| Future developer uses global `db` for a tenant-scoped query and silently leaks rows | Convention rule documented in `migration-state.md` §2; consider a lint rule or code-review checklist in Sprint 1 | Sprint 1 lead |
| Sprint 2 EDI refactor double-handles `billing_model` (both column and profile) | `migration-state.md` §4.1 enumerates required reconciliation: locate, decide, plan deprecation | Sprint 2 lead |
| Demo rows at `enrollment_status='pending'` look "wrong" in any UI built before Sprint 1 hygiene pass | Tagged in `migration-state.md` §5; not a Sprint 0 problem | Sprint 1+ |
| Drizzle `practicePayerEnrollments` definition gets out of sync with future ALTERs | Single source of truth comment to be added when the next ALTER ships | next sprint touching PPE |

## 5. Files changed / created

### Created
- `docs/architecture/sprint0-existing-schemas.md`
- `docs/architecture/sprint0-snapshots/dev-pre-sprint0-20260503-022630Z.sql` (.gitignored)
- `docs/architecture/sprint0-snapshots/sprint0-ddl.sql` (the DDL bundle that was applied)
- `docs/architecture/sprint0-snapshots/sprint0-app-role.sql` (the role + grants bundle)
- `docs/architecture/migration-state.md`
- `docs/architecture/sprint0-audit-report.md` (this file)
- `server/middleware/tenant-context.ts`
- `server/config/feature-flags.ts`
- `server/services/practice-profile-helpers.ts`
- `server/services/rules-engine/tier1-structural-integrity.ts`
- `server/services/rules-engine/tier1-structural-integrity.test.ts`
- `scripts/verify-tenant-isolation.ts`
- `scripts/smoke-helpers.ts`

### Modified
- `shared/schema.ts` — added `uuid, primaryKey` imports; appended 7 table definitions (lines 721-842).
- `server/index.ts` — 1 import line + 1 `app.use(tenantContextMiddleware)` call inside the async IIFE (line 86).
- `.gitignore` — added `docs/architecture/sprint0-snapshots/`.
- `replit.md` — Phase 3 Sprint 0 status block.

### Database (dev only)
| Object | Action |
|---|---|
| 6 tables | CREATE |
| 12 policies | CREATE (2 per tenant-scoped table) |
| 6 tables | ALTER ENABLE ROW LEVEL SECURITY |
| 6 tables | ALTER FORCE ROW LEVEL SECURITY |
| 11 columns on `practice_payer_enrollments` | ADD COLUMN (additive) |
| 2 roles | CREATE (`claimshield_service_role`, `claimshield_app_role`) |
| 30 grants | GRANT to `claimshield_app_role` |
| 6 grants | GRANT (DML) to `claimshield_service_role` |
| 1 role membership | GRANT `claimshield_app_role` TO `postgres` |
| 1 row | INSERT into `practice_profiles` |
| 1 row | INSERT into `organization_practice_profiles` |

**No UPDATE or DELETE statements were issued** against any pre-existing row in any table.

## 6. Final verification snapshot

```
ppe_existing_rows_unchanged | 2     -- the 2 demo-seed rows are still present
practice_profiles_count     | 1     -- home_care_agency_personal_care
org_profile_mappings        | 1     -- chajinel ↔ home_care
rls_force_count             | 6     -- all 6 tenant-scoped tables FORCE RLS
policy_count                | 12    -- 2 policies × 6 tables
app_role_grants             | 30    -- claimshield_app_role privileges across DML + parent-SELECT
```

```
=== Tier 1 ===                    16 passed, 0 failed (16 total)
=== Tenant isolation ===          12 passed, 0 failed (12 total)
=== Helper smoke ===              chajinel profile resolves; demo=2, chajinel=0, no-ctx=0
=== Workflow ===                  serving on port 5000 (no errors after middleware insertion)
```

## 7. Sign-off

Sprint 0 is complete. All four user-approved decisions implemented as agreed:

1. ✅ All 5 ALTER blocks ran without renaming anything (name harmonization deferred to Sprint 2).
2. ✅ Demo rows left at `enrollment_status='pending'`. Zero UPDATEs.
3. ✅ `practicePayerEnrollments` and the other 6 new tables added to `shared/schema.ts`.
4. ✅ Pool size left at default 10.

The unplanned addition (the `claimshield_app_role` + `SET LOCAL ROLE`) was approved mid-sprint after the Step 5f verification surfaced superuser-bypass behavior; the fix is scoped, documented, and verified.

Standing order honored: no production deploys. All work was on dev (`heliumdb`). Awaiting Abeer review before any production migration is scheduled.
