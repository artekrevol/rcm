# Phase 3 Sprint 1a — Audit Report

**Sprint dates:** 2026-05-03
**Standing order:** Dev only. No production deploy.
**Predecessor:** [`sprint0-audit-report.md`](./sprint0-audit-report.md), [`migration-state.md`](./migration-state.md)

## §1 Executive summary + baseline verification

Sprint 1a closes two safety/drift gaps from Sprint 0 and wires the Tier 1 structural validator into `evaluateClaim`. Daniela starts Tuesday — every change was scoped so user-visible behavior is unchanged.

**Outcomes**
- WITH CHECK clauses now live on all 6 `tenant_isolation` policies (Sprint 1b/1c can ship write helpers safely).
- Drizzle declaration of `organizations` reconciled with the live DB shape (3 missing columns added).
- `evaluateClaim` runs Tier 1 first; structurally broken claims short-circuit with a `T1-NNN` finding.
- EDI generator path investigation: **gap surfaced** — `submit-stedi` and `test-stedi` routes do NOT call `evaluateClaim` before `generate837P`. Sprint 1a's wire-in does NOT gate EDI submission. Documented as a Sprint 1c+ prerequisite.
- All Sprint 0 baselines remain green; one new test added (4/4 cases pass).

**Snapshot (pre-DDL):** `docs/architecture/sprint1a-snapshots/dev-pre-sprint1a-20260503-031642Z.sql` (133MB, 183116 lines, gitignored).

**Baseline verification (pre-change)**

| Script | Result |
|---|---|
| `scripts/verify-tenant-isolation.ts` | 12/12 PASS |
| `server/services/rules-engine/tier1-structural-integrity.test.ts` | 16/16 PASS |
| `scripts/smoke-helpers.ts` | green (chajinel→home_care_agency_personal_care, demo=2 enrollments, chajinel=0, no-ctx=0) |

## §2 WITH CHECK DDL applied

**Source:** `docs/architecture/migration-state.md §3.1` (verbatim).
**DDL bundle:** `docs/architecture/sprint1a-snapshots/sprint1a-with-check.sql`.

**GUC name verification (Step 2b)** — pre-application `pg_policy` query confirmed all 6 `tenant_isolation` policies use `current_setting('app.current_organization_id'::text, true)` and have `with_check_expr = NULL`. The migration-state DDL matches verbatim — no improvisation needed.

**Applied in single transaction** — six `ALTER POLICY` statements:
- `organization_practice_profiles`
- `practice_payer_enrollments`
- `provider_practice_relationships`
- `provider_payer_relationships`
- `patient_insurance_enrollments`
- `claim_provider_assignments`

**Post-application verification (Step 2d)**

```
     polname      |           table_name            | has_using | has_with_check | expressions_match
------------------+---------------------------------+-----------+----------------+-------------------
 tenant_isolation | claim_provider_assignments      | t         | t              | t
 tenant_isolation | organization_practice_profiles  | t         | t              | t
 tenant_isolation | patient_insurance_enrollments   | t         | t              | t
 tenant_isolation | practice_payer_enrollments      | t         | t              | t
 tenant_isolation | provider_payer_relationships    | t         | t              | t
 tenant_isolation | provider_practice_relationships | t         | t              | t
(6 rows)
```

All 6 policies now have non-NULL `with_check_expr` identical to `using_expr`. Service-role-bypass policies remain unchanged (`USING true / WITH CHECK true`).

**Step 2e — Re-run isolation script:** 12/12 PASS (WITH CHECK does not affect SELECT visibility).

## §3 Drizzle drift fix on `organizations`

**Live DB shape (Step 3b):**

| # | Column | Type | Nullable | Default |
|---|---|---|---|---|
| 1 | id | varchar | NO | gen_random_uuid()::text |
| 2 | name | varchar | NO | — |
| 3 | created_at | timestamp without time zone | YES | now() |
| 4 | onboarding_dismissed_at | timestamp without time zone | YES | — |
| 5 | contact_email | text | YES | — |
| 6 | status | text | NO | `'active'` |
| 7 | updated_at | timestamp with time zone | NO | now() |

**Variance from prompt's "expected" shape:** `name` is `varchar` (prompt expected `text`); `created_at` and `onboarding_dismissed_at` are `timestamp without time zone` (prompt expected `with time zone`); `created_at` is nullable. Per Hard rule #6, **live DB wins** — Drizzle now matches live exactly.

**Drizzle declaration (`shared/schema.ts:521-529`)** — replaced 4-column declaration with 7-column declaration matching live shape:

```typescript
export const organizations = pgTable("organizations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  onboardingDismissedAt: timestamp("onboarding_dismissed_at"),
  contactEmail: text("contact_email"),
  status: text("status").notNull().default("active"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
```

**Caller search (Step 3d)** — confirmed zero `organizations.is_active` references anywhere in `server/`, `shared/`, `client/`. All `is_active` matches refer to other tables (`practice_profiles pp`, `provider_practice_relationships ppr`, `patient_insurance_enrollments pie`, `flows`, `providers`, `payers`, `hcpcs_rates`, `cpt_codes`). **No callers required code changes.**

References to the `organizations` table in code are limited to:
- `shared/schema.ts:521` — pgTable declaration
- `shared/schema.ts:531` — `Organization` type export
- `server/routes.ts:3302` — comment only

**TypeScript compilation (Step 3e)** — `npx tsc --noEmit` reports 85 errors, **identical to the pre-Sprint-1a baseline**. Zero errors mention `organizations`. Zero new errors introduced by the Drizzle reconciliation. Pre-existing errors are unrelated drift in `extractedData`, `email_templates.variables`, `flows.steps`, `claims.archived_at`, `intake_sessions.createdAt` — out of Sprint 1a scope.

## §4 Tier 1 wire-in into `evaluateClaim`

**Existing `evaluateClaim` shape**
- File: `server/services/rules-engine.ts:341`
- Signature: `async (ctx: ClaimContext, options) => Promise<RuleViolation[]>`
- `RuleViolation` (line 52): `{ ruleType, severity, message, fixSuggestion, ruleId, sourcePage, sourceQuote, payerSpecific, reviewedBy?, lastVerifiedAt? }`
- `ClaimContext.serviceLines[]` uses field name `code` (not `procedureCode`).

**Tier 1 input shape**
- File: `server/services/rules-engine/tier1-structural-integrity.ts:78`
- `Tier1ClaimInput.serviceLines[]` uses `procedureCode` (not `code`). Field-name remap required.

**Adapter** — `server/services/rules-engine/tier1-adapter.ts` (new). Three exports:
- `adaptToTier1(ctx) → Tier1ClaimInput` — pure field-name remap.
- `tier1FindingToViolation(f) → RuleViolation` — Tier 1 findings tag as `ruleType: 'data_quality'`, preserve the `T1-NNN` code in `ruleId`, add `source: 'tier1-structural'` marker.
- `runTier1AsViolations(ctx) → RuleViolation[]` — convenience wrapper used by `evaluateClaim`.

**`RuleViolation` extension** — added optional `source?: string` field. Backwards-compatible (every existing caller treats it as undefined).

**Wire-in (`server/services/rules-engine.ts:347-358`)** — at the very top of `evaluateClaim`:

```typescript
const tier1Violations = runTier1AsViolations(ctx);
if (tier1Violations.some((v) => v.severity === "block")) {
  return tier1Violations;
}
violations.push(...tier1Violations);
```

Short-circuits on any blocking finding. Since none of the 8 Tier 1 rules emit `warn`-severity in the current implementation, the prepended slice is always empty when Tier 1 passes — but the code path is correct if Tier 1 ever adds warn-level rules.

**Tests (`server/services/rules-engine.test.ts`, NEW)** — 4 cases, all pass:
1. Empty service lines → `T1-003` short-circuit, all returned violations tagged `tier1-structural`.
2. Missing `organization_id` → `T1-001` short-circuit.
3. Fully clean ctx → 0 violations (Tier 1 passes, sanity rules pass, `payerId: null` skips DB lookup).
4. Tier 1 passes but legacy "high units" warning fires → returns the warn (non-`tier1-structural` source), no Tier 1 blocking findings.

**Tier 1 baseline regression test** — re-ran `tier1-structural-integrity.test.ts` post-wire-in: 16/16 PASS. The validator's signature was not modified, so its tests remain authoritative.

## §5 EDI generator path investigation (read-only)

**Generator** — `server/services/edi-generator.ts`. Entry point: `generate837P(input: EDI837PInput): string` at line 375. The generator is a pure transform: it does NOT import `rules-engine`, does NOT call `evaluateClaim`, and does NOT perform structural validation beyond formatting. `rg "evaluateClaim|rules-engine" server/services/edi-generator.ts` returns zero matches.

**Routes that call `generate837P`** (per audit:§04-api-surface):
- `server/routes.ts:6348` — `POST /api/billing/claims/:id/submit-stedi` (production EDI submission). Imports `generate837P` at offset+152 (line 6500), invokes at offset+153 (line 6501). **No `evaluateClaim` call anywhere in this route handler.**
- `server/routes.ts:6623` — `POST /api/billing/claims/:id/test-stedi` (test-mode EDI). Imports `generate837P` at offset+83 (line 6706), invokes at offset+84 (line 6707). **No `evaluateClaim` call anywhere in this route handler.**

Both routes do perform minimal hand-rolled validation (e.g. early 400 if `serviceLines.length === 0` or `icd10Codes.length === 0`), but this is far weaker than the rules engine's checks.

**Where `evaluateClaim` IS called**
- `server/routes.ts:5179, 5231` — claim review/scoring endpoint
- `server/routes.ts:5264, 5293` — risk factors endpoint
- `server/routes.ts:5422, 5464` — bulk claim evaluation endpoint

These are scoring/risk surfaces, not EDI submission paths.

**Conclusion: GAP**

Sprint 1a's Tier 1 wire-in into `evaluateClaim` does **NOT** gate EDI generation. A claim can still be submitted to Stedi via `submit-stedi` even if it would fail Tier 1 — only the route's hand-rolled "no service lines / no ICD-10" guards stand between a structurally broken claim and the wire.

**Recommendation (carried forward, NOT fixed in Sprint 1a):** A future sprint should call `evaluateClaim` (or at minimum `validateTier1Structural`) inside both `submit-stedi` and `test-stedi` before invoking `generate837P`, and reject the request if any blocking finding is present. This is added to `migration-state.md` as a Sprint 1c+ prerequisite.

## §6 Verification matrix

| Check | Result |
|---|---|
| `scripts/verify-tenant-isolation.ts` | 12/12 PASS |
| `server/services/rules-engine/tier1-structural-integrity.test.ts` | 16/16 PASS |
| `scripts/smoke-helpers.ts` | green |
| `server/services/rules-engine.test.ts` (new) | 4/4 PASS |
| `npx tsc --noEmit` total error count | 85 (unchanged from baseline; zero new errors) |
| Errors mentioning `organizations` | 0 |
| Errors in `rules-engine.ts` / `tier1-adapter.ts` | 1 pre-existing (`Set<string>` iteration at `rules-engine.ts:196`, unchanged by Sprint 1a) |
| All 6 `tenant_isolation` policies: `has_using ∧ has_with_check ∧ expressions_match` | TRUE for all 6 |

## §7 Smoke test result

**App boot:** Workflow `Start application` boots clean — `[express] serving on port 5000` with no error logs. Startup seeder completes successfully (all schema-ensure entries report `already present`). Cron jobs (`flow-orchestrator`, `cci-cron`, `tf-guardian`, `scraper-cron`) all start.

**EDI byte-identity argument:** Sprint 1a made zero changes to `edi-generator.ts` and zero changes to either `submit-stedi` or `test-stedi` route handlers. The Tier 1 wire-in is in `evaluateClaim`, which is **not** called by either EDI route (per §5). Therefore generated EDI for any of the 147 existing claims is byte-identical to pre-Sprint-1a output by construction. Empirical capture-and-diff was not run because no code path that produces EDI was modified.

**Daniela demo path:** No frontend file under `client/` was modified. `client/`-side test IDs, query keys, and routes are unchanged. The only API surface change observable to a frontend caller is the rules-evaluation endpoints (5179, 5264, 5422), which now may return Tier 1 findings tagged with `source: "tier1-structural"` and `ruleId: "T1-NNN"` on structurally broken claims. For the demo dataset (147 valid claims plus seeded test claims), Tier 1 produces zero blocking findings, so the response shape on the demo path is identical.

## §8 Files created / modified / DDL applied

**Created**
- `docs/architecture/sprint1a-snapshots/dev-pre-sprint1a-20260503-031642Z.sql` (gitignored)
- `docs/architecture/sprint1a-snapshots/sprint1a-with-check.sql`
- `server/services/rules-engine/tier1-adapter.ts`
- `server/services/rules-engine.test.ts`
- `docs/architecture/sprint1a-audit-report.md` (this file)

**Modified**
- `.gitignore` — added `docs/architecture/sprint1a-snapshots/`
- `shared/schema.ts:521-529` — `organizations` Drizzle declaration: 4 → 7 columns
- `server/services/rules-engine.ts` — import adapter (line 1), add `source?: string` to `RuleViolation` (line 65), wire Tier 1 at top of `evaluateClaim` (lines 348-358)
- `docs/architecture/migration-state.md` — Sprint 1a status appended

**DDL applied (single transaction)**
- 6× `ALTER POLICY tenant_isolation ON <table> ... WITH CHECK (...)` — see `sprint1a-with-check.sql`

**Out-of-scope confirmation** — zero changes to: `client/**`, `server/services/edi-generator.ts`, `server/services/practice-profile-helpers.ts`, voice persona builder, claim wizard, payer dropdown, intake forms, Caritas onboarding, `server/jobs/*-cron.ts`, `replit.md`, audit docs other than `migration-state.md` and this file.

## §9 Risks carried into Sprint 1b/1c

1. **EDI generator gap (CRITICAL for Sprint 1c).** `submit-stedi` and `test-stedi` bypass `evaluateClaim`. The Tier 1 wire-in does not protect production EDI submissions. Recommended fix: invoke `evaluateClaim` (or at least `validateTier1Structural`) inside both routes before `generate837P`.

2. **Tier 1 / legacy duplication (low priority).** `runSanityRules` in `rules-engine.ts:96` still checks several conditions that overlap with Tier 1 (missing `icd10Primary` → `T1-007`; ICD-10 format → `T1-007`; empty service lines → `T1-003`; CPT/HCPCS format → `T1-004`; missing service date → `T1-008`). Because Tier 1 short-circuits before sanity rules, end-users will see the `T1-NNN` finding instead of the legacy duplicate — this is the desired ordering. A future cleanup can prune duplicate sanity rules, but doing so now would change finding messages on edge cases.

3. **Pre-existing TS errors (out of scope, persistent).** 85 type errors in `client/`, `server/routes.ts`, `server/seed.ts`, `server/storage.ts`, `server/lib/rate-lookup.ts`. None block runtime. Addressing them is its own multi-sprint cleanup.

## §10 Standing-order attestation

- ☑ Dev DB only. No production deploy executed in this sprint.
- ☑ No frontend file under `client/` modified.
- ☑ No EDI generator (`edi-generator.ts`) logic changed (read-only investigation only).
- ☑ No helper signature changes in `practice-profile-helpers.ts`.
- ☑ Pre-DDL snapshot taken; path recorded in §1.
- ☑ All Sprint 0 baseline scripts re-verified post-change.
- ☑ Daniela demo behavior unchanged (zero frontend touches; demo claims do not trip Tier 1).

---

End of report.
