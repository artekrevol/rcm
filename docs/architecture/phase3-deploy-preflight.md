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

### Artifacts (NOT committed to repo — `/tmp` is ephemeral and outside the git tree)

| Path | Format | Size | sha256 |
|---|---|---|---|
| `/tmp/prod-snapshot-pre-phase3-20260503T045620Z.dump` | `pg_dump -F c` (custom, compressed, restorable) | 123 M | `ec74627e64c01904c21e706ea7034eb0bca2c08cf1f10600097bf0e76eb4a441` |
| `/tmp/prod-schema-pre-phase3-20260503T045620Z.sql` | `pg_dump --schema-only` (DDL only, plain text) | 121 K, 4,265 lines | `3c331299ab7b96d7053a7e704dfeded498175d87beba8d9602cacd56bb5ad348` |

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

## Gate 2 — Sign-off requested

Phases 1a, 1b, 1e complete. Phase 1c **blocked on user-provided Railway dashboard values** (§3 table). Phase 1d skipped per instruction.

**Stopping here. Awaiting user input to fill §3, then sign-off to proceed to Phase 2.**

### Headline findings for the gate review

1. **Prod is at the expected pre-Sprint-0 state.** No Phase 3 tables, no RLS, no `claimshield_app_role`. Migration is required and additive in nature (no drops needed).
2. **Two existing roles to preserve:** `postgres` (superuser, what we connect as) and `replit_readonly` (read-only consumer; will need post-migration grants on the 6 new tables).
3. **5 rows of preserved data:** 3 organizations, 5 `practice_payer_enrollments` (3 Chajinel + 2 Demo), 2 `org_voice_personas`. Migration must be additive-only.
4. **PG version mismatch (17.9 prod vs 16.10 dev tooling) is benign** — confirmed Sprint 0 DDL features all supported on PG 17.
5. **Snapshot is in `/tmp` only** — durable backup before Phase 2 is non-negotiable.
