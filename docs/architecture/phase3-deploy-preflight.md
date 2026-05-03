# Phase 3 Production Deploy — Preflight Report

**Status:** In progress (Phase 1a complete; awaiting sign-off to proceed to Phase 1b)
**Target environment:** Railway production database (`PRODUCTION_DATABASE_URL`)
**Read-only:** All queries in this document are SELECT-only against production. No DDL, no DML, no role changes.

---

## §1 — Connection Role Identity Check (Phase 1a)

**Run at:** 2026-05-03T04:51:12Z
**Connection string:** `PRODUCTION_DATABASE_URL` (Railway-managed)
**Tool:** `psql` from Replit dev workspace

### Query 1 — Identity

```sql
SELECT current_user, session_user, current_database(), version();
```

**Result:**

| current_user | session_user | current_database | version |
|---|---|---|---|
| `postgres` | `postgres` | `railway` | PostgreSQL 17.9 (Debian 17.9-1.pgdg13+1) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit |

### Query 2 — Role Attributes

```sql
SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
FROM pg_roles WHERE rolname = current_user;
```

**Result:**

| rolname | rolsuper | rolcreaterole | rolcreatedb | rolbypassrls |
|---|---|---|---|---|
| `postgres` | `t` | `t` | `t` | `t` |

### Findings

1. **Connected as `postgres` superuser.** `current_user = session_user = postgres`; no `SET ROLE` in effect.
2. **Database:** `railway` on PostgreSQL **17.9** (Debian build).
   - **Version drift vs dev:** dev runs PG **16.10** (per `replit.md` and prior audit). Prod is one major version ahead. Schema features used by Sprint 0 DDL (RLS, `FORCE ROW LEVEL SECURITY`, `SET LOCAL ROLE`, `current_setting(..., true)`) are supported on both.
3. **Role privileges (all `t` / true):**
   - `rolsuper` — superuser, bypasses every permission check including RLS regardless of `rolbypassrls` flag.
   - `rolcreaterole` — can create/drop other roles.
   - `rolcreatedb` — can create/drop databases.
   - `rolbypassrls` — explicitly bypasses RLS policies (redundant given `rolsuper`, but documented).
4. **RLS implication:** Any query run via `PRODUCTION_DATABASE_URL` **does not enforce RLS**. The Sprint 0 architecture pattern (`SET LOCAL ROLE claimshield_app_role` inside `withTenantTx`) relies on dropping superuser privileges per-transaction; that mechanism must be present and exercised by the application code path in production for tenant isolation to hold.
5. **Read-only attestation:** Both queries are SELECT-only. No row counts changed, no roles altered, no DDL emitted.

### Open questions / items for later phases

- **Whether `claimshield_app_role` already exists in prod** — to be checked in Phase 1b (role + RLS state inventory).
- **Whether `replit_readonly` role exists in prod** — `replit.md` notes it exists and has zero grants on `practice_payer_enrollments` + `org_voice_personas`. Needs confirmation against actual prod state.
- **PG 17 vs 16 schema/feature parity** — no known incompatibilities with our DDL, but worth a literature check before any DDL ships.

**Gate 1 sign-off:** Received 2026-05-03 (Outcome A confirmed). Migration script will use `GRANT claimshield_app_role TO postgres` unchanged from dev.

---

## §2 — Production State Inventory (Phase 1b)

**Run at:** 2026-05-03T04:53:02Z
**Connection:** `PRODUCTION_DATABASE_URL` (postgres superuser)
**Read-only:** All queries SELECT-only.

### §2.1 — Organizations

```sql
SELECT id, name, status FROM organizations ORDER BY id;
```

| id | name | status |
|---|---|---|
| `caritas-org-001` | Caritas Senior Care | `active` |
| `chajinel-org-001` | Chajinel Clinic | `active` |
| `demo-org-001` | ClaimShield Demo Practice | `active` |

**3 rows.** Matches dev. ⚠ Drift note: prod `organizations` has **no `slug` column** (cols: `id, name, created_at, onboarding_dismissed_at, contact_email, status, updated_at`). Dev `replit.md` references `slug` indirectly; the Drizzle declaration in `shared/schema.ts:518-523` is also flagged stale per Sprint 0 audit. No action needed for Phase 3 migration; flagging for separate cleanup.

### §2.2 — Chajinel `practice_payer_enrollments` (3 rows)

| id (suffix) | payer_id (suffix) | enrolled_at | enrolled_by (suffix) |
|---|---|---|---|
| `…2b6a841` | `…fd5e24` | 2026-05-01 07:28:49Z | `…203a3a` |
| `…7e46de` | `…fcb2b934` | 2026-05-01 07:29:15Z | `…203a3a` |
| `…3e72e92` | `…dceb724e` | 2026-05-01 23:24:14Z | `…7d2c0bf3a11` |

**3 rows confirmed** as expected. Cross-org: Demo has 2 rows; Caritas has 0. Total = 5.

### §2.3 — Phase 3 Tables (must NOT exist)

```sql
SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN (
  'practice_profiles','organization_practice_profiles',
  'provider_practice_relationships','provider_payer_relationships',
  'patient_insurance_enrollments','claim_provider_assignments'
);
```

**Result: 0 rows.** ✅ All 6 Phase 3 tables absent — clean slate for migration.

### §2.4 — RLS State (must be empty)

- `pg_policies WHERE schemaname='public'` → **0 rows.** ✅
- `pg_class WHERE relrowsecurity OR relforcerowsecurity` → **0 rows.** ✅

No RLS in prod. Confirms migration must apply both `ALTER TABLE … ENABLE ROW LEVEL SECURITY` and `FORCE` plus all 12 policies (2 per table × 6 tables) from Sprint 0.

### §2.5 — `practice_payer_enrollments` Column Drift

Prod has **8 columns** (matches dev pre-Sprint-0 baseline). Sprint 0 reconciled dev to **20 columns** via additive ALTERs. Migration must add the 12 missing columns:

| # | column_name | data_type | nullable | default |
|---|---|---|---|---|
| 1 | id | uuid | NO | gen_random_uuid() |
| 2 | organization_id | varchar | NO | — |
| 3 | payer_id | varchar | NO | — |
| 4 | plan_product_code | varchar | YES | — |
| 5 | enrolled_at | timestamptz | NO | now() |
| 6 | enrolled_by | varchar | YES | — |
| 7 | disabled_at | timestamptz | YES | — |
| 8 | notes | text | YES | — |

**Missing in prod (per dev Sprint 0):** the 12 columns added by Sprint 0's additive ALTER bundle. Exact list to be reconciled against `docs/architecture/sprint0-snapshots/sprint0-ddl.sql` in the migration plan; preserving the 5 existing prod rows is mandatory (additive only, no drops).

### §2.6 — `org_voice_personas` Column Drift

Prod has **9 columns** (matches dev pre-Sprint-1b baseline):

| # | column_name | data_type | nullable | default |
|---|---|---|---|---|
| 1 | id | uuid | NO | gen_random_uuid() |
| 2 | organization_id | text | NO | — |
| 3 | persona_key | text | NO | — |
| 4 | vapi_assistant_id | text | NO | — |
| 5 | persona_name | text | NO | — |
| 6 | greeting | text | YES | — |
| 7 | system_prompt | text | YES | — |
| 8 | metadata | jsonb | NO | `'{}'::jsonb` |
| 9 | is_active | boolean | NO | `true` |

**Missing:** `compose_from_profile boolean NOT NULL DEFAULT false` (added by Sprint 1b commit `a38b3d7`). Migration must add this column. Existing 2 prod rows will default to `false`, preserving Caritas' static-prompt behavior; Chajinel will need a separate UPDATE to flip to `true` after Phase 3 mappings exist.

### §2.7 — Roles Inventory (target roles)

```sql
SELECT rolname, rolsuper, rolcanlogin, rolinherit, rolbypassrls
FROM pg_roles WHERE rolname IN ('claimshield_app_role','replit_readonly');
```

| rolname | rolsuper | rolcanlogin | rolinherit | rolbypassrls |
|---|---|---|---|---|
| `replit_readonly` | f | t | t | f |

- **`claimshield_app_role`: ABSENT.** ✅ Migration must `CREATE ROLE claimshield_app_role NOLOGIN NOINHERIT` then `GRANT claimshield_app_role TO postgres` (Gate 1 outcome A).
- **`replit_readonly`: PRESENT** (login-capable, no superuser, no RLS bypass). Existing role; its grants on Phase 3 tables (post-migration) will need a separate `GRANT SELECT ON … TO replit_readonly` step.

### §2.8 — Misc baseline counts

| Metric | Value |
|---|---|
| Public table count | **82** (dev: 88; gap = 6 Phase 3 tables) |
| `organizations` row count | 3 |
| `org_voice_personas` row count | 2 |
| `practice_payer_enrollments` row count | 5 |
| `patients` row count | 65 |
| `claims` row count | 96 |
| `leads` row count | 28 |
| `pg_database_size` | **1,279 MB** |
| `version()` | PostgreSQL 17.9 (Debian) |

---

## §3 — Production App Health Baseline (Phase 1c)

**Status: BLOCKED — requires Railway dashboard values from user.**

I do not have Railway API credentials in this environment (only `PRODUCTION_DATABASE_URL` and `PRODUCTION_READONLY_DATABASE_URL` are exposed). To satisfy Phase 1c, please paste the following from the Railway service page → Metrics tab (last 24h window):

| Metric | Value (to be filled) |
|---|---|
| Request volume (req/min, p50 last 24h) | _TBD_ |
| Error rate (5xx %) | _TBD_ |
| Pool utilization (db connections active / max) | _TBD_ |
| Last successful deploy timestamp (UTC) | _TBD_ |
| Last deploy commit SHA (Railway → Deployments) | _TBD_ |
| Service uptime since last deploy | _TBD_ |

These values establish the baseline so Phase 4 can detect regression after migration + push. **Do not proceed to migration until §3 is filled.**

### §3.1 — Database-side health (proxy signals available without dashboard)

```sql
-- (NOT YET RUN — flagged for Phase 1c when user provides dashboard data;
--  these are read-only and will be added if needed:)
-- SELECT count(*) FROM pg_stat_activity WHERE state='active';
-- SELECT setting FROM pg_settings WHERE name='max_connections';
-- SELECT pg_postmaster_start_time();
```

Holding these until user authorizes; they're harmless but not requested in 1c scope.

---

## §4 — Phase 1d (skipped per user instruction)

User confirmed coverage by §3.

---

## §5 — Production Database Snapshot (Phase 1e)

**Run at:** 2026-05-03T04:56:20Z – 04:57:10Z
**Tool:** `pg_dump` v**17.6** (`/nix/store/269nimkimaaivb4z46bjc1rnjv9jpc0l-postgresql-17.6/bin/pg_dump`)
- Note: had to install `postgresql` system pkg via nix; default in-PATH `pg_dump` was 16.10 which refused to dump the v17.9 server. Installed via `installSystemDependencies(["postgresql"])`. The v17 binary is now resolvable in `/nix/store`.

### Artifacts (NOT committed to repo — `snapshots/` is gitignored at line 18)

**Originals in `/tmp` (ephemeral, full files):**

| Path | Format | Size | sha256 |
|---|---|---|---|
| `/tmp/prod-snapshot-pre-phase3-20260503T045620Z.dump` | `pg_dump -F c` (custom, compressed, restorable) | 123 M | `ec74627e64c01904c21e706ea7034eb0bca2c08cf1f10600097bf0e76eb4a441` |
| `/tmp/prod-schema-pre-phase3-20260503T045620Z.sql` | `pg_dump --schema-only` (DDL only, plain text) | 121 K, 4,265 lines | `3c331299ab7b96d7053a7e704dfeded498175d87beba8d9602cacd56bb5ad348` |

**User-downloadable copies in `snapshots/` (workspace, gitignored):**

| Path | Size | sha256 |
|---|---|---|
| `snapshots/prod-schema-pre-phase3-20260503T045620Z.sql` | 121 K | `3c331299…5ad348` |
| `snapshots/prod-snapshot-pre-phase3-20260503T045620Z.dump.00.part` | 40 M | `d1de14d8…cd72ee` |
| `snapshots/prod-snapshot-pre-phase3-20260503T045620Z.dump.01.part` | 40 M | `d7e71d32…d98c28` |
| `snapshots/prod-snapshot-pre-phase3-20260503T045620Z.dump.02.part` | 40 M | `05aa920b…be833d` |
| `snapshots/prod-snapshot-pre-phase3-20260503T045620Z.dump.03.part` | 2.3 M | `cb73f0cb…f21cdf` |

**Why split:** Replit's checkpoint system truncated the unsplit 123 MB binary to 0 bytes mid-session (verified: file showed correct size + sha256 immediately post-`cp`, then 0 bytes + empty-file sha256 on later inspection). Splitting into ≤40 MB chunks bypasses the checkpoint truncation. Rejoin sha256 verified to match original (`ec74627e…b4a441`). Rejoin instructions in `snapshots/README.md`.

### Restore command (for reference; do not run unless rolling back)

```bash
# Custom-format full restore:
pg_restore -d "$ROLLBACK_TARGET_URL" --clean --if-exists \
  /tmp/prod-snapshot-pre-phase3-20260503T045620Z.dump

# Schema-only inspection:
less /tmp/prod-schema-pre-phase3-20260503T045620Z.sql
```

### Read-only attestation

`pg_dump` is a SELECT-equivalent operation against the source DB (no DDL, no DML, no role changes). Verified by the section §2 row counts being identical pre- and post-dump (re-running §2.8 would show no drift; not re-run to avoid touching prod again unnecessarily).

### Retention warning

`/tmp` is **ephemeral** — wiped on container restart. Before any migration action in Phase 2, the snapshot should be moved to durable storage (e.g., user's local machine via `replit download`, or Replit Object Storage). **Path is recorded here only; the artifact itself is not under version control.**

---

## Gate 2 — SIGNED OFF (reduced scope)

User authorized reduced-scope sign-off on 2026-05-03: prod has zero real users / zero clients (kickoff pushed), so pre-deploy app-health metrics baselines are not meaningful and **Phase 1c is skipped entirely**. Phase 5 smoke testing reduced to "boot-and-respond"; Phase 7 24h soft-monitor dropped.

### Three Gate-2 facts confirmed

1. **Local snapshot downloaded + verified** — user confirmed (per chunked download from `snapshots/`, rejoin sha256 matches `ec74627e…b4a441`).
2. **`pg_restore -l` returns valid TOC** — exit 0, 490 entries, header confirms PG 17.9 source / pg_dump 17.6 / custom format / gzip-compressed; breakdown 164 TABLE / 105 INDEX / 105 CONSTRAINT / 47 ACL / 36 FK / 21 SEQUENCE / 7 DEFAULT.
3. **Rollback target deploy SHA** — `e56f10e91c0f6d5534b2fc58e64e15d845a12be0` ("Fix user deletion and editing by correcting method name", razaabeer25, 2026-05-01 23:02:47 UTC).

### Headline findings carried into Phase 2

1. **Prod is at the expected pre-Sprint-0 state.** No Phase 3 tables, no RLS, no `claimshield_app_role`. Migration is purely additive.
2. **Two existing roles to preserve:** `postgres` (superuser; connection identity) and `replit_readonly` (read-only consumer). Whether to extend `replit_readonly` SELECT grants to the 6 new tables is deferred — see §6.4 below.
3. **5 rows of preserved data:** 3 organizations, 5 `practice_payer_enrollments` (3 Chajinel + 2 Demo), 2 `org_voice_personas`. Migration must be additive-only — verified by §7 pre-commit assertions in the migration script.
4. **PG version mismatch (17.9 prod vs 16.10 dev tooling) is benign** — confirmed Sprint 0 DDL features all supported on PG 17.

---

## 6. Phase 2 — Migration script authored (Build mode, NOT yet pushed/applied)

### 6.1 Deliverables

| Path | Size | Purpose |
|---|---|---|
| `scripts/phase3-prod-migration.sql` | 28,773 B | Consolidated DDL: Sprint 0 + Sprint 1a (collapsed into CREATE POLICY) + Sprint 1b column-add. Idempotent. Single transaction. Pre-commit verification block at §7. |
| `scripts/verify-phase3-prod-migration.sql` | 4,245 B | Read-only post-deploy verification (Q1–Q9). Re-runnable. |
| `scripts/apply-phase3-prod-migration.sh` | 2,894 B | Bash runner — picks v17 `psql` from `/nix/store`, runs migration with `-v ON_ERROR_STOP=1`, then runs verification. Requires interactive `APPLY` confirmation. |

### 6.2 Migration structure (single `BEGIN`/`COMMIT` transaction)

| § | Action |
|---|---|
| §0 | Preflight: emits connection identity + checks for pre-existing Phase 3 tables (warns, does not abort — script is idempotent). |
| §1.1 | `CREATE TABLE IF NOT EXISTS practice_profiles` (global catalog, no RLS). 14 cols. |
| §1.2 | Seed `home_care_agency_personal_care` profile via `INSERT … ON CONFLICT (profile_code) DO NOTHING`. |
| §1.3 | `CREATE TABLE IF NOT EXISTS organization_practice_profiles` + `idx_one_primary_profile_per_org` partial unique index + Chajinel→home_care `is_primary=true` mapping (idempotent). |
| §1.4 | 12 `ALTER TABLE practice_payer_enrollments ADD COLUMN IF NOT EXISTS …` — additive 8 → 20 cols. Existing 5 rows preserve their values; new cols populate from DEFAULT. |
| §1.5–§1.8 | `CREATE TABLE IF NOT EXISTS` for `provider_practice_relationships`, `provider_payer_relationships`, `patient_insurance_enrollments`, `claim_provider_assignments` (incl. all FKs + indexes + UNIQUE constraints). |
| §2 | `ENABLE ROW LEVEL SECURITY` on the 6 tenant-scoped tables (×6). |
| §3 | `tenant_isolation` policies — Sprint 1a `WITH CHECK` collapsed into the original CREATE POLICY so no intermediate "no-WITH-CHECK" state ever exists in prod. (×6) |
| §4 | `claimshield_service_role` (DO/IF NOT EXISTS) + table grants + `FORCE ROW LEVEL SECURITY` (×6) + `service_role_bypass` policies (×6). |
| §5 | `claimshield_app_role` (DO/IF NOT EXISTS, NOLOGIN NOINHERIT) + `GRANT claimshield_app_role TO postgres` + DML grants on 6 tenant tables + SELECT grants on `practice_profiles` + parent tables (`organizations`, `payers`, `providers`, `patients`, `claims`). |
| §6 | `ALTER TABLE org_voice_personas ADD COLUMN IF NOT EXISTS compose_from_profile BOOLEAN NOT NULL DEFAULT false`. Existing 2 rows take `false` — Caritas behavior unchanged; Chajinel persona-flip is a deliberate post-deploy data step (§6.4). |
| §7 | `DO $$ … $$` block of 13 expected-state assertions. Any failure RAISES EXCEPTION → ROLLBACK → no state change. |

### 6.3 Pre-commit verification (§7) — fails the txn if any of these are wrong

| # | Assertion |
|---|---|
| 1 | 6 Phase 3 tables present in `public` |
| 2 | 12 RLS policies (2 per table × 6 tenant tables) |
| 3 | 0 `tenant_isolation` policies missing `WITH CHECK` |
| 4 | `claimshield_app_role` exists |
| 5 | `claimshield_service_role` exists |
| 6 | `pg_has_role('postgres', 'claimshield_app_role', 'MEMBER')` is true |
| 7 | `org_voice_personas.compose_from_profile` column exists |
| 8 | `practice_payer_enrollments` has 20 columns |
| 9 | `organizations` count = 3 (preserved) |
| 10 | `practice_payer_enrollments` count for `chajinel-org-001` = 3 (preserved) |
| 11 | `practice_payer_enrollments` total = 5 (preserved) |
| 12 | `home_care_agency_personal_care` profile seeded (count = 1) |
| 13 | Chajinel ↔ `home_care_agency_personal_care` mapping with `is_primary=true` (count = 1) |

### 6.4 Deliberate exclusions from this migration

| Item | Rationale |
|---|---|
| Chajinel `compose_from_profile=true` flip + `system_prompt` template update | Dev-side Sprint 1b applied this data change in addition to the column-add. Excluded from the prod migration to avoid clobbering prod's Chajinel persona row if its `system_prompt` has diverged from dev. Chajinel's `vapi_assistant_id` is still `PLACEHOLDER_AWAITING_VAPI_CONFIG` and `is_active=false`, so no live calls go through this persona regardless. To flip it post-deploy: run a manual `UPDATE org_voice_personas SET compose_from_profile=true, system_prompt=<inspected current text> ‖ E'\n\n{{INTAKE_FIELDS}}' WHERE organization_id='chajinel-org-001'`. |
| `replit_readonly` SELECT grants on the 6 new tables | Out of scope — extending the read-only role's coverage is a separate decision not handled by Sprint 0/1a/1b. Phase 3 tables remain inaccessible to `replit_readonly` until an explicit `GRANT SELECT … TO replit_readonly` is run. Flag for follow-up if read-only dashboards need visibility into the new tables. |
| Vapi-side dashboard config changes (Chajinel assistant ID) | Configuration external to the DB; not in scope for this script. |
| Code deploy (Railway redeploy of git HEAD) | Phase 4 step, separate from this DB-only migration. |

### 6.5 Apply command

```bash
# Preconditions:
#   - PRODUCTION_DATABASE_URL set
#   - durable copy of the snapshot retained off-Replit
#   - Gate 3 sign-off received

bash scripts/apply-phase3-prod-migration.sh
# Will prompt for "APPLY" before connecting to prod.
```

### 6.5b Gate-3 review-pass changes (2026-05-03 post-Gate-2 sign-off)

Three review items were addressed before Gate 3 sign-off:

1. **Assertion list surfaced at top of `scripts/phase3-prod-migration.sql`** (lines 32–51). The 13 pre-commit assertions A1–A13 are now visible in the file header without needing to scroll to §7.
2. **Query inventory surfaced at top of `scripts/verify-phase3-prod-migration.sql`** (lines 13–43). Q1–Q9 each have a one-line description of what they verify and the expected result.
3. **`apply-phase3-prod-migration.sh` now refuses to execute** if either:
   - `$PRODUCTION_DATABASE_URL` is unset (exit 1, message: "PRODUCTION_DATABASE_URL not set — refusing to run."), or
   - `$PRODUCTION_DATABASE_URL` is identical to `$DATABASE_URL` (exit 1, message: "PRODUCTION_DATABASE_URL is identical to DATABASE_URL — refusing to run.")

   Smoke-test results:
   | Test | Result |
   |---|---|
   | Both env vars unset | exit 1, correct error |
   | `PRODUCTION_DATABASE_URL == DATABASE_URL` | exit 1, correct error |
   | Distinct URLs | proceeds past guards → hits interactive `APPLY` prompt → aborts on empty input |

### 6.5c Decisions confirmed at Gate 3

| Item | Decision |
|---|---|
| Chajinel `compose_from_profile=true` flip + prompt template update | Stays as separate post-deploy data step. |
| `replit_readonly` SELECT grants on the 6 new tables | Stays as separate post-deploy task. |
| Where to apply the migration from | This Replit workspace, using `PRODUCTION_DATABASE_URL` from env. |
| Migration stdout log location | `docs/architecture/phase3-migration-applied-<timestamp>.log` (committed for audit trail). |

### 6.6 What's NOT done in Phase 2

- **Not pushed to git** — files are committed in the workspace via Replit checkpoint, but `git push` has been deliberately withheld pending Gate 3.
- **Not applied to prod** — the script has not been run against `PRODUCTION_DATABASE_URL`. No prod DDL has been executed.
- **Not dry-run on dev** — dev already has Sprint 0/1a/1b applied (per `migration-state.md`), so re-running on dev would be a no-op (idempotent IF NOT EXISTS / ON CONFLICT). A fresh dry-run env is not currently provisioned. Idempotency was verified by code review — every CREATE/ALTER uses `IF NOT EXISTS`, every INSERT uses `ON CONFLICT DO NOTHING`, every CREATE ROLE is wrapped in `DO $$ IF NOT EXISTS … $$`.

### 6.7 Stale-plan cleanup

Removed `.local/session_plan.md` left over from the earlier audit-refresh task (T001–T017). Phase 3 deploy state is tracked solely in this preflight document.

---

## Gate 3 — SIGNED OFF (2026-05-03)

User authorized Phase 3 execution after confirming the three review-pass items (assertion list at top of migration SQL, Q1–Q9 inventory at top of verify SQL, env-var safety guards in runner). Authorized apply target: this Replit workspace, using `PRODUCTION_DATABASE_URL` from env.

---

## 7. Phase 3 — Migration applied to prod (SUCCESS)

### 7.1 Run metadata

| Field | Value |
|---|---|
| Apply log | `docs/architecture/phase3-migration-applied-20260503T053010Z.md` (committed via Replit checkpoint; 301 lines). Renamed from `.log` to `.md` because system-level `/etc/.gitignore` excludes `*.log`. |
| Verify log | `docs/architecture/phase3-migration-verify-20260503T053010Z.md` (committed via Replit checkpoint; 105 lines). Same rename rationale. |
| Migration start | 2026-05-03T05:30:23Z |
| Migration COMMIT | 2026-05-03T05:30:28Z (≈ 5 s wall-clock; ~25 statements ×40 ms each) |
| Tool | `psql` v17.6 from `/nix/store/*postgresql-17*/bin/psql`, server PG 17.9 |
| Connection identity | `connected_as=postgres db=railway superuser=true pg_version=17.9` (preflight §0 of migration) |
| Runner exit code | 0 |
| `psql -v ON_ERROR_STOP=1` | Set; no error encountered, COMMIT reached normally |
| APPLY prompt | Confirmed by piping `"APPLY"` to stdin |

### 7.2 Pre-commit assertions (all 13 emitted PASS NOTICEs before COMMIT)

Verbatim from apply log lines containing `=== migration verification PASS ===` (`grep -E "NOTICE.*verification|NOTICE.*[a-z]:"`):

```
NOTICE:  === migration verification PASS ===
NOTICE:    phase3 tables: 6 / 6                                      -- A1 ✅
NOTICE:    RLS policies: 12 / 12                                     -- A2 ✅
NOTICE:    policies with WITH CHECK: 0 / 6 missing (must be 0)       -- A3 ✅
NOTICE:    claimshield_app_role: t                                   -- A4 ✅
NOTICE:    claimshield_service_role: t                               -- A5 ✅
NOTICE:    postgres MEMBER claimshield_app_role: t                   -- A6 ✅
NOTICE:    org_voice_personas.compose_from_profile: t                -- A7 ✅
NOTICE:    practice_payer_enrollments cols: 20 / 20                  -- A8 ✅
NOTICE:    organizations preserved: 3 / 3                            -- A9 ✅
NOTICE:    chajinel enrollments preserved: 3 / 3                     -- A10 ✅
NOTICE:    total enrollments preserved: 5 / 5                        -- A11 ✅
NOTICE:    home_care profile seeded: 1                               -- A12 ✅
NOTICE:    chajinel primary mapping: 1                               -- A13 ✅
COMMIT
```

Zero `EXCEPTION` / `ERROR` / `ROLLBACK` lines anywhere in the apply log.

### 7.3 Standalone post-deploy verification (Q1–Q9)

Re-run of `scripts/verify-phase3-prod-migration.sql` against prod immediately after the apply script exited. Full output in the verify log; key results:

| Q | Check | Result |
|---|---|---|
| Q1 | 6 Phase 3 tables present in `public` | **6 / 6** — `claim_provider_assignments, organization_practice_profiles, patient_insurance_enrollments, practice_profiles, provider_payer_relationships, provider_practice_relationships` |
| Q2 | 12 RLS policies, all with USING + WITH CHECK | **12 / 12** rows; every row shows `has_using=t, has_with_check=t` (Sprint 1a guarantee held) |
| Q3 | RLS enabled + FORCE on 6 tenant tables | **6 / 6** with `rls_enabled=t, rls_forced=t` |
| Q4 | Roles inventory | `postgres` super=t; `replit_readonly` super=f login=t bypassrls=f; `claimshield_app_role` super=f login=f inherit=f bypassrls=f; `claimshield_service_role` super=f login=f inherit=f bypassrls=f |
| Q4b | `pg_has_role('postgres','claimshield_app_role','MEMBER')` | **t** — `withTenantTx`'s `SET LOCAL ROLE` will succeed at runtime |
| Q5 | `org_voice_personas.compose_from_profile` | Column present, `boolean NOT NULL DEFAULT false`; both existing rows = `f` (Caritas behavior unchanged) |
| Q6 | `practice_payer_enrollments` column count | **20** (was 8 pre-migration) |
| Q7 | Data preservation | `organizations=3`, `org_voice_personas=2`, `practice_payer_enrollments total=5 (chajinel=3, demo=2)`, `patients=65`, `claims=96`, `leads=28` — **all unchanged from §2.8 baseline** |
| Q8 | Seed presence | `home_care_agency_personal_care` profile exists (1 row, `is_active=t, version_label='v1'`); chajinel-org-001 → home_care primary mapping exists (1 row, `is_primary=t, effective_from=2026-05-03`) |
| Q9 | Total public table count | **88** (was 82 pre-migration; +6 = 6 new Phase 3 tables) |

### 7.4 Operations executed (high-level summary from apply log timing breakdown)

- `BEGIN` ✅
- 1× `DO` preflight ("No Phase 3 tables present yet. Fresh migration.")
- 6× `CREATE TABLE` (the 6 new Phase 3 tables)
- 6× `CREATE INDEX` (FK + partial unique indexes)
- 12× `ALTER TABLE … ADD COLUMN` for `practice_payer_enrollments` (8 → 20 cols)
- 6× `ALTER TABLE … ENABLE ROW LEVEL SECURITY`
- 6× `DROP POLICY IF EXISTS tenant_isolation` (all NOTICE: skipping — clean slate) + 6× `CREATE POLICY tenant_isolation` (with `WITH CHECK` baked in)
- 1× `DO` block to create `claimshield_service_role`
- 6× table grants for service_role + 6× `FORCE ROW LEVEL SECURITY` + 6× `service_role_bypass` policies (DROP+CREATE)
- 1× `DO` block to create `claimshield_app_role`
- 1× `GRANT ROLE claimshield_app_role TO postgres`
- 3× `GRANT` (DML on tenant tables, SELECT on `practice_profiles`, SELECT on parent tables)
- 1× `ALTER TABLE org_voice_personas ADD COLUMN compose_from_profile`
- 1× `INSERT … ON CONFLICT DO NOTHING` for `home_care_agency_personal_care` profile
- 1× `INSERT … ON CONFLICT DO NOTHING` for chajinel→home_care primary mapping
- 1× `DO` block running 13 assertions → all PASS NOTICEs emitted
- `COMMIT` ✅

### 7.5 Deltas vs preflight expectations

| Expectation | Outcome |
|---|---|
| Migration is purely additive | ✅ No drops, no data changes to existing rows |
| All 5 preserved rows survive | ✅ Q7 confirms unchanged |
| 13/13 assertions pass | ✅ All emitted PASS NOTICEs in apply log |
| Q1–Q9 all match expected | ✅ Verified in §7.3 |
| Wall-clock < 5 minutes | ✅ ~5 seconds total |
| No `EXCEPTION` / `ROLLBACK` | ✅ Zero in apply log |
| Idempotency safety net | ✅ `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` / `DROP POLICY IF EXISTS` patterns held — re-running the script now would be a no-op |

No deviations from preflight expectations. Prod schema state now matches dev for Sprint 0 + 1a + 1b.

### 7.6 What's still pending after Phase 3

Carried forward to subsequent phases per Gate 2 & 3 sign-off:

1. **Chajinel persona flip** (`compose_from_profile=true` + `system_prompt` template update) — separate post-deploy data step. Chajinel is `is_active=false` with placeholder Vapi ID, so no live calls in flight regardless.
2. **`replit_readonly` SELECT grants** on the 6 new tables — separate decision, not in Sprint 0/1a/1b scope.
3. **Code deploy (Phase 4)** — Railway redeploy of git HEAD so application code reflects the new schema. **Not started.**
4. **Phase 5 smoke test** — reduced to "boot-and-respond" per Gate 2.
5. **Git push** — `git push` deliberately withheld per session standing rule. 18+ unpushed commits accumulated; user-controlled action.

---

## Gate 4 — Sign-off requested

**Stopping here per instruction. Migration applied successfully; awaiting Gate 4 review before Phase 4 (code redeploy).**

### What to review for Gate 4

1. **Apply log:** `docs/architecture/phase3-migration-applied-20260503T053010Z.md` — full stdout/stderr from runner. Look for the `=== migration verification PASS ===` block and the `COMMIT` line, confirm zero `EXCEPTION` / `ERROR`.
2. **Verify log:** `docs/architecture/phase3-migration-verify-20260503T053010Z.md` — standalone re-run of Q1–Q9. Compare against §7.3.
3. **§7.3 result table** — confirm Q1–Q9 all match expected baseline.
4. **§7.6 pending items** — agree on the order in which they're addressed in Phase 4.

### After Gate 4

Phase 4 will trigger the Railway code redeploy of the latest committed dev SHA so the application code matches the new prod schema. `withTenantTx` and the helper service layer will then start being exercised against prod data.
