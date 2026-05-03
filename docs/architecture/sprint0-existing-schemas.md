# Sprint 0 — Step 1: Existing-Schema Inspection (Read-Only)

**Date:** 2026-05-03
**Database:** `heliumdb` (PostgreSQL 16.10), dev only. No production access.
**Mode:** Read-only — every query in this report is a `SELECT`. No DDL, no DML.
**Snapshot taken:** `docs/architecture/sprint0-snapshots/dev-pre-sprint0-20260503-022630Z.sql` (121 MB, plain `pg_dump --no-owner --no-privileges`). Directory is `.gitignore`d.
**Standing order honored:** No deploys, no DB writes. Pausing here for sign-off.

---

## TL;DR — items requiring sign-off before Steps 2–9

1. 🚩 **`practice_payer_enrollments` actual schema is fundamentally different from the prompt's expected schema.** It has 8 columns; the prompt expected 16. **Ten columns are missing.** Several are workflow-shaped (status, effective dates, billing_npi, etc.) — these can be additively ALTERed in. **Proposed ALTERs are at §3 below; need your sign-off.**
2. 🚩 **The 2 existing rows belong to `demo-org-001`** (not Chajinel, not Caritas). They will be **invisible after RLS is enabled** unless `demo-org-001` is the active tenant. They are NOT orphan, but they are not real customer data either — they are demo-seed rows. Confirm the intended behavior.
3. 🚩 **Two pieces of audit drift surfaced** that affect Sprint 0 execution. Both are out-of-scope to fix in Sprint 0 but worth knowing:
    - `organizations` table has columns `id, name, created_at, onboarding_dismissed_at, contact_email, status, updated_at`. The audit (`01-database-schema.md`) listed `is_active` and `slug` — **neither exists**. The Drizzle schema (`shared/schema.ts:518-523`) is even more out-of-date and only declares `id, name, created_at, updated_at`.
    - `practice_settings.billing_model` **does exist** (column type `character varying`, both existing rows populated). The audit's `12-known-issues-and-tech-debt.md` and `01-database-schema.md` claimed it did not. Both Drizzle (`shared/schema.ts:539`) and the DB agree the column exists.
4. ✅ **No duplicate FK on `practice_payer_enrollments`.** (The audit's flagged duplicate was on `practice_settings`, not this table.) See §2.
5. ✅ **All ID-type assumptions in Steps 4c/4d/4e/4f are valid.** `claims.id`, `providers.id`, `patients.id`, `organizations.id`, `payers.id` are all `character varying`. `practice_payer_enrollments.id` is `uuid`. See §6.
6. ✅ **Connection pool config is the simple case.** Standard `pg.Pool` with defaults, no pgbouncer. Transaction-scoped `SET LOCAL` will work as designed. See §7.
7. 🚩 **`practice_payer_enrollments` is NOT defined in `shared/schema.ts`.** The table exists in the DB (created out-of-band — raw SQL or seeder) but Drizzle has no type-safe handle on it. Any new helper code that touches it via Drizzle needs a definition added. Out of scope for Step 1 but flagged for Step 6's helper layer.

---

## §1. `practice_payer_enrollments` — actual columns

```sql
SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='practice_payer_enrollments'
ORDER BY ordinal_position;
```

| # | Column | Type | Nullable | Default |
|---|---|---|---|---|
| 1 | `id` | `uuid` | NO | `gen_random_uuid()` |
| 2 | `organization_id` | `character varying` | NO | — |
| 3 | `payer_id` | `character varying` | NO | — |
| 4 | `plan_product_code` | `character varying` | YES | — |
| 5 | `enrolled_at` | `timestamp with time zone` | NO | `now()` |
| 6 | `enrolled_by` | `character varying` | YES | — |
| 7 | `disabled_at` | `timestamp with time zone` | YES | — |
| 8 | `notes` | `text` | YES | — |

**Total: 8 columns.** Prompt's expected schema has 16 columns. The conceptual model also differs:

- Existing model: simple enrollment record with a `disabled_at` soft-delete and `plan_product_code` FK. No status workflow, no effective-date range, no clearinghouse/NPI tracking.
- Prompt's model: enrollment with status workflow (`'pending' | 'active' | …`), explicit effective date range, billing NPI, taxonomy, submission method, clearinghouse, timely-filing days, prior-auth-required boolean, contracted-rate-table FK, audit timestamps.

The two are **reconcilable via additive ALTER** — none of the existing 8 columns conflict with the new 10. But it is a sizable shape change. ALTER proposals at §3.

## §2. `practice_payer_enrollments` — constraints

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid = 'public.practice_payer_enrollments'::regclass;
```

| Name | Definition |
|---|---|
| `practice_payer_enrollments_pkey` | PRIMARY KEY (id) |
| `practice_payer_enrollments_organization_id_fkey` | FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE |
| `practice_payer_enrollments_payer_id_fkey` | FOREIGN KEY (payer_id) REFERENCES payers(id) ON DELETE RESTRICT |
| `practice_payer_enrollments_enrolled_by_fkey` | FOREIGN KEY (enrolled_by) REFERENCES users(id) ON DELETE SET NULL |
| `fk_ppe_plan_product` | FOREIGN KEY (plan_product_code) REFERENCES plan_products(code) ON DELETE RESTRICT |
| `practice_payer_enrollments_organization_id_payer_id_plan_pr_key` | UNIQUE (organization_id, payer_id, plan_product_code) |

**No duplicate FK.** ✅

The audit's `12-known-issues-and-tech-debt.md` item 4 referred to `practice_settings`, not this table. (Re-confirmed: `practice_settings` does have both `practice_settings_org_fk` and `practice_settings_organization_id_fkey` per `_queries/04_foreign_keys.tsv:36-37`.)

## §3. Existing rows + proposed ALTERs

```sql
SELECT ppe.*, o.name AS org_name, o.status, p.name AS payer_name
FROM practice_payer_enrollments ppe
LEFT JOIN organizations o ON o.id = ppe.organization_id
LEFT JOIN payers p ON p.id = ppe.payer_id;
```

| id | organization_id | org_name | payer_name | plan_product_code | enrolled_at | disabled_at | notes |
|---|---|---|---|---|---|---|---|
| `f32b273f-…d33da7b2` | `demo-org-001` | ClaimShield Demo Practice | UnitedHealthcare (Commercial) | NULL | 2026-04-30 09:31 UTC | NULL | `[demo_seed] Auto-enrolled for conditional-field activation demo` |
| `ffd069e9-…ce624427a68e` | `demo-org-001` | ClaimShield Demo Practice | Medicare Advantage — UnitedHealthcare | NULL | 2026-04-30 09:31 UTC | NULL | `[demo_seed] Auto-enrolled for conditional-field activation demo` |

**Both rows are demo-seed rows belonging to `demo-org-001`.** Both have status='active' org and valid payer FKs — they are NOT orphan. Their visibility under RLS is correct: visible only when `app.current_organization_id = 'demo-org-001'`.

### Proposed ALTERs to add the prompt's missing columns

**Not yet executed.** All are additive, NULL-safe (no NOT NULL without DEFAULT), and preserve the 2 existing rows.

```sql
-- §3a. Status workflow column
ALTER TABLE practice_payer_enrollments
  ADD COLUMN IF NOT EXISTS enrollment_status TEXT NOT NULL DEFAULT 'pending';
-- Reasoning: prompt's status workflow. NOT NULL is safe because of the DEFAULT,
-- and 'pending' is the prompt's own default. The 2 existing rows will land in
-- 'pending' — review whether 'active' is a more accurate backfill given they're
-- already enrolled. (See §3-followup below.)

-- §3b. Effective-date range
ALTER TABLE practice_payer_enrollments
  ADD COLUMN IF NOT EXISTS effective_from DATE,
  ADD COLUMN IF NOT EXISTS effective_to DATE;

-- §3c. Submission/credential metadata
ALTER TABLE practice_payer_enrollments
  ADD COLUMN IF NOT EXISTS billing_npi TEXT,
  ADD COLUMN IF NOT EXISTS taxonomy_code TEXT,
  ADD COLUMN IF NOT EXISTS submission_method TEXT,
  ADD COLUMN IF NOT EXISTS clearinghouse TEXT,
  ADD COLUMN IF NOT EXISTS timely_filing_days INTEGER,
  ADD COLUMN IF NOT EXISTS prior_auth_required BOOLEAN NOT NULL DEFAULT false;

-- §3d. Forward link for future contracted-rate work
ALTER TABLE practice_payer_enrollments
  ADD COLUMN IF NOT EXISTS contracted_rate_table_id UUID;
-- No FK declared yet — the rate table doesn't exist. Adding the FK in a later
-- sprint is additive.

-- §3e. Audit timestamps
ALTER TABLE practice_payer_enrollments
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Note: the existing `enrolled_at` covers creation; we keep it. `created_at` is
-- the prompt's name; both can coexist. If the architecture wants `created_at`
-- to be the authoritative "this row was inserted" timestamp, consider a
-- one-time backfill: UPDATE … SET created_at = enrolled_at WHERE created_at >
-- enrolled_at; — propose only with sign-off.
```

### §3-followup — backfill question for `enrollment_status`

The 2 demo rows would land in `'pending'` after §3a runs (because of the DEFAULT). They were created as auto-enrollments meaning they're effectively already active. Three options:

- **(a)** Leave as `'pending'`. Demo rows are then in a "wrong" state that looks visible-but-not-active. **Lowest risk to sprint.**
- **(b)** After §3a runs, do a one-line `UPDATE practice_payer_enrollments SET enrollment_status='active' WHERE notes LIKE '[demo_seed]%';` Touches 2 rows. **Mild** — one DML statement against demo data only.
- **(c)** Change the DEFAULT in §3a to `'active'`. **Don't recommend** — the prompt explicitly says default is `'pending'`.

**Recommendation: (a).** Sprint 0 is foundation only; backfill semantics is sprint 1+ work.

## §4. Three organizations confirmed

```sql
SELECT id, name, status FROM organizations ORDER BY id;
```

| id | name | status |
|---|---|---|
| `caritas-org-001` | Caritas Senior Care | `active` |
| `chajinel-org-001` | Chajinel Clinic | `active` |
| `demo-org-001` | ClaimShield Demo Practice | `active` |

The Step 4a INSERT for Chajinel can use the literal `'chajinel-org-001'` exactly. ✅

**Audit drift note:** `replit.md` claimed Chajinel was `is_active=false` pending a Vapi config; the actual `status` column says `active`. The Vapi placeholder issue is real (`org_voice_personas.vapi_assistant_id = 'PLACEHOLDER_AWAITING_VAPI_CONFIG'` per `replit.md`), but the org row itself is `active`. Out of scope to reconcile in Sprint 0.

## §5. ID column types — Sprint 0 assumptions verified

```sql
SELECT table_name, column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema='public' AND column_name='id'
  AND table_name IN ('claims','providers','patients','organizations','payers','practice_payer_enrollments');
```

| Table | id type | Default | Sprint 0 assumption | Status |
|---|---|---|---|---|
| `organizations` | `character varying` | `(gen_random_uuid())::text` | varchar | ✅ |
| `payers` | `character varying` | `(gen_random_uuid())::text` | varchar | ✅ |
| `claims` | `character varying` | `gen_random_uuid()` *(implicit cast at insert)* | varchar (Step 4f) | ✅ |
| `providers` | `character varying` | `(gen_random_uuid())::text` | varchar (Steps 4c/4d) | ✅ |
| `patients` | `character varying` | `gen_random_uuid()` | varchar (Step 4e) | ✅ |
| `practice_payer_enrollments` | `uuid` | `gen_random_uuid()` | uuid (prompt expected) | ✅ |

**No type override needed.** All FK declarations in Step 4 will be valid as written.

## §6. PostgreSQL features

| Property | Value | Note |
|---|---|---|
| Server version | 16.10 | `gen_random_uuid()` is built-in (no extension needed) |
| Database | `heliumdb` | dev only |
| Current user | `postgres` | superuser; relevant for RLS — `FORCE ROW LEVEL SECURITY` is required (Step 5c) |
| `max_connections` | 112 | plenty of headroom for the transaction-scoped middleware |
| `pgcrypto` extension | not installed | not required (built-in `gen_random_uuid` since PG 13) |
| `uuid-ossp` extension | not installed | not required |

## §7. Connection pool config (`server/db.ts`)

```typescript
// server/db.ts (entire file, 14 lines)
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
```

| Property | Value | Step 5e implication |
|---|---|---|
| Pool driver | `node-postgres` (`pg.Pool`) | standard |
| Pool size | **default (10 connections)** — no `max` configured | tight under load; bump to 20–30 if Sprint 1 wires the middleware to many routes |
| Idle timeout | default (10 s) | fine |
| pgbouncer in front | **none** — `DATABASE_URL` from `.env` points directly at the Postgres instance, no `?pgbouncer=true`, no separate `DIRECT_URL` | ✅ — transaction-scoped `SET LOCAL` is valid |
| Statement-mode pooler | not present | ✅ |
| TLS / sslmode | not configured | dev-only; production may differ |

**Conclusion:** the Step 5d transaction-scoped middleware works as designed. No architectural override needed.

## §8. Drizzle drift surfaced (informational, out of Sprint 0 scope)

| Symbol | Drizzle says | DB says | Impact |
|---|---|---|---|
| `organizations` columns | `id, name, created_at, updated_at` (`shared/schema.ts:518-523`) | `id, name, created_at, onboarding_dismissed_at, contact_email, status, updated_at` | Drizzle queries can't read `status`, `contact_email`, `onboarding_dismissed_at`. Anywhere code uses `o.status` it must use raw SQL. |
| `practice_payer_enrollments` table | **not declared in Drizzle at all** (grep of `shared/schema.ts` returns 0 hits) | exists, 8 columns | Step 6 helpers cannot use Drizzle's typed query builder for this table without first adding a Drizzle definition. **Recommend:** add the Drizzle table block alongside Step 4b's ALTERs. |
| `practice_settings.billing_model` | declared (`shared/schema.ts:539`) | exists, populated | Audit drift only — code already works. The audit's `12-known-issues-and-tech-debt.md` claim that "this column does not exist" is wrong. |

## §9. Out-of-scope items confirmed not touched

- ✅ No DDL has been run.
- ✅ No DML has been run.
- ✅ No code edits.
- ✅ No `replit.md` edits.
- ✅ No `server/index.ts`, `server/db.ts`, `server/auth.ts` edits.
- ✅ Snapshot taken and `.gitignore`d.

---

## Pause point — awaiting sign-off

Before executing **any** of the following:

- §3a–§3e ALTERs against `practice_payer_enrollments`
- Steps 2–4 (create `practice_profiles`, seed home_care profile, create the four new relationship tables, create `organization_practice_profiles`, INSERT Chajinel mapping)
- Step 5 (RLS, service role, FORCE RLS, middleware wire-up)
- Step 6 helper layer
- Step 7 Tier 1 validator
- Step 8 feature flag
- Step 9 migration-state doc

I'm pausing for your sign-off. **Specifically need a decision on:**

1. **§3 ALTERs** — green-light all 5 ALTER blocks as written? Any column to defer or rename?
2. **§3-followup backfill** — option (a) leave demo rows at `'pending'`, or (b) one-line UPDATE to `'active'`?
3. **§8 Drizzle drift** — do I (i) add `practicePayerEnrollments` to `shared/schema.ts` as part of Sprint 0 (small, scoped), or (ii) defer to Sprint 1?
4. **Pool size bump** — leave at default 10 for Sprint 0 (recommended), or bump now to 20?
