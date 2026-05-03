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

---

## 8. Sprint 1a — additive update (2026-05-03)

Sprint 1a closed two Sprint 0 prerequisites and shipped one functional change. **Existing §1–§7 above remain authoritative for Sprint 0 state**; this section records the deltas only.

### 8.1 §3.1 (WITH CHECK on tenant_isolation policies) — DONE

The 6× `ALTER POLICY ... WITH CHECK (...)` DDL bundle from §3.1 was applied verbatim in a single transaction on dev. DDL applied: `docs/architecture/sprint1a-snapshots/sprint1a-with-check.sql`. Pre-DDL snapshot at `docs/architecture/sprint1a-snapshots/dev-pre-sprint1a-20260503-031642Z.sql` (gitignored).

Post-application verification — all 6 policies:

| Table | has_using | has_with_check | expressions_match |
|---|---|---|---|
| `claim_provider_assignments` | t | t | t |
| `organization_practice_profiles` | t | t | t |
| `patient_insurance_enrollments` | t | t | t |
| `practice_payer_enrollments` | t | t | t |
| `provider_payer_relationships` | t | t | t |
| `provider_practice_relationships` | t | t | t |

Tenant isolation script re-run post-DDL: 12/12 PASS. Sprint 1b/1c may now ship `INSERT`/`UPDATE` helpers without re-opening the missing-WITH-CHECK gap.

### 8.2 §3.3 — Drizzle drift on `organizations` — DONE

`organizations` now declared in `shared/schema.ts:521-529` with all 7 live columns (`id`, `name`, `created_at`, `onboarding_dismissed_at`, `contact_email`, `status`, `updated_at`). Column types match live DB exactly (`name varchar`, `created_at timestamp without time zone nullable`, `updated_at timestamp with time zone notNull`). Zero `organizations.is_active` references found in `server/`, `shared/`, `client/`. `npx tsc --noEmit` error count unchanged at 85; zero errors mention `organizations`.

### 8.3 Tier 1 structural integrity — wired into `evaluateClaim`

Tier 1 validator (`server/services/rules-engine/tier1-structural-integrity.ts`) is now invoked at the top of `evaluateClaim` (`server/services/rules-engine.ts:347-358`). On any `block`-severity Tier 1 finding the function short-circuits and returns Tier 1 violations only; otherwise it falls through to legacy sanity rules + DB-driven rules as before. Adapter at `server/services/rules-engine/tier1-adapter.ts` handles the `code` ↔ `procedureCode` field-name remap. `RuleViolation` extended with optional `source?: string` (Tier 1 findings tag as `source: "tier1-structural"`, `ruleId: "T1-NNN"`, `ruleType: "data_quality"`).

Integration test `server/services/rules-engine.test.ts` (4/4 PASS): empty service lines, missing org_id, fully clean ctx, Tier-1-clean with legacy warn. Tier 1 baseline test re-run: 16/16 PASS.

### 8.4 New open question — EDI generator gating gap (Sprint 1c+ prerequisite)

**Read-only investigation finding.** Both EDI submission routes call `generate837P` directly without invoking `evaluateClaim`:

- `server/routes.ts:6348` — `POST /api/billing/claims/:id/submit-stedi` (production)
- `server/routes.ts:6623` — `POST /api/billing/claims/:id/test-stedi` (test mode)

`evaluateClaim` is only called from claim review/scoring/risk endpoints (`server/routes.ts:5179`, `5264`, `5422`). `server/services/edi-generator.ts` does not import `rules-engine` and does not perform structural validation beyond formatting. **Therefore Sprint 1a's Tier 1 wire-in does NOT gate EDI submission.** A claim that would fail Tier 1 (e.g. missing primary ICD-10, malformed CPT/HCPCS) can still be assembled into an 837P and submitted to Stedi if the route's hand-rolled "no service lines / no ICD-10" early-400 guards are satisfied.

**Sprint 1c+ prerequisite (recommended fix):** Inside both `submit-stedi` and `test-stedi` route handlers, call `evaluateClaim` (or at minimum `validateTier1Structural`) before `generate837P` and reject the request on any blocking finding. This was deliberately NOT fixed in Sprint 1a — the standing order limited Sprint 1a to read-only investigation of the EDI path. Full analysis in `docs/architecture/sprint1a-audit-report.md` §5.

### 8.5 Verification artifacts (Sprint 1a re-runs)

| Check | Command | Result |
|---|---|---|
| Tenant isolation (post WITH CHECK) | `npx tsx scripts/verify-tenant-isolation.ts` | 12/12 PASS |
| Tier 1 structural integrity baseline | `npx tsx server/services/rules-engine/tier1-structural-integrity.test.ts` | 16/16 PASS |
| Helper smoke | `npx tsx scripts/smoke-helpers.ts` | green (chajinel→home_care_agency_personal_care; demo=2, chajinel=0, no-ctx=0) |
| Rules-engine wire-in | `npx tsx server/services/rules-engine.test.ts` (NEW) | 4/4 PASS |
| TypeScript | `npx tsc --noEmit` | 85 errors (unchanged baseline; 0 new) |
| Workflow startup | observed in `Start application` post-change | clean (no errors) |

Full Sprint 1a audit report: `docs/architecture/sprint1a-audit-report.md`.

---

## 9. Sprint 1b — voice persona profile-driven composition (2026-05-03)

Sprint 1b refactored the voice persona system-prompt builder so the "fields to capture" section is composed at runtime from the active practice profile instead of being baked into the static template stored in `org_voice_personas.system_prompt`. Existing §1–§8 above remain authoritative; this section records the deltas.

### 9.1 What landed

- **DDL (additive):** `ALTER TABLE org_voice_personas ADD COLUMN compose_from_profile boolean NOT NULL DEFAULT false;`. Both seeded rows started at `false`; only Chajinel was migrated to `true`.
- **Drizzle:** `orgVoicePersonas` declaration NEW in `shared/schema.ts:857-869` (the table predates Phase 3 and previously had no Drizzle decl — Sprint 1b adds it covering all 9 base columns + `composeFromProfile`). Type `OrgVoicePersona` exported.
- **`OrgPersona` interface + `getOrgContext` query:** extended with `compose_from_profile` field at `server/services/org-context.ts:32` and SELECT line 114, so the cached persona record in `orgCtx.personas[key]` carries the flag.
- **NEW service `server/services/voice-persona-builder.ts`** (137 lines): `buildAssistantSystemPrompt(orgId)` with opt-out / opt-in-with-placeholder / opt-in-without-placeholder paths and the §5c fail-safe rules. `renderIntakeFieldsForPrompt(specs)` exported for test use.
- **Outbound wire-in:** `server/services/flow-step-executor.ts:657-672` resolves the assembled prompt only when `persona.compose_from_profile === true`; line 708-710 conditionally injects `messages: [{ role: "system", content }]` into the existing `assistantOverrides.model` block. For opt-out personas (including Caritas) the spread evaluates to `{}` — the model block is byte-identical to before Sprint 1b. Verified empirically: `buildAssistantSystemPrompt('caritas-org-001')` returns the stored `system_prompt` unchanged (md5-stable; see audit §6 + §7).
- **Chajinel migration applied** (transaction): `compose_from_profile=true`, prompt template now ends with `\n\n{{INTAKE_FIELDS}}`. Pre/post snapshots at `docs/architecture/sprint1b-snapshots/{chajinel-persona-pre.txt, chajinel-persona-post.txt, chajinel-persona-assembled.txt}`.
- **Tests:** `server/services/voice-persona-builder.test.ts` — 23/23 PASS (10 renderer + 6 builder against seeded data + 4 synthetic-org + 3 fail-safe / placeholder-leak guards).

### 9.2 RLS NOT extended to `org_voice_personas` in Sprint 1b

The persona table predates Phase 3. As of 1b ship: `relrowsecurity = false`, `relforcerowsecurity = false`. The builder reads the persona row via the global `pool` (postgres superuser) since no RLS is in effect — verified safe because the query is explicitly filtered by `organization_id = $1`. Adding RLS would require the same role-grant + middleware-routing dance Sprint 0 did for the new tables; this is tracked as a Sprint 2 prerequisite if the persona table needs cross-tenant protection. No INSERT/UPDATE helpers are introduced for this table in 1b, so the missing-WITH-CHECK gate from §3.1 does not apply here.

Other pre-Phase-3 `org_*` tables (`org_message_templates`, `org_service_types`, `org_payer_mappings`, `org_lead_sources`, `org_providers`) are in the same RLS-disabled state and the same Sprint 2 gate covers them as a class.

### 9.3 Vapi authoritative prompt source — documentation correction

> ⚠️ **Important architectural clarification.** The Sprint 0 audit at `docs/architecture/system-audit/02-data-flows.md` Flow B and `docs/architecture/system-audit/09-integrations.md` (Vapi section) implied that `org_voice_personas.system_prompt` flows directly to Vapi. **It does not.** Sprint 1b discovery (audit §2b) traced the full outbound `voice_call` handler at `server/services/flow-step-executor.ts:564-751` and confirmed the only persona fields read are `vapi_assistant_id` (line 571) and `persona_name` (line 676). The pre-Sprint-1b `assistantOverrides` payload contained no `model.messages` override — the actual system prompt used on outbound calls came entirely from the **Vapi-side dashboard configuration** for each assistant ID.
>
> Post Sprint 1b the truth is split:
> - For personas with `compose_from_profile = false` (Caritas today, every persona row at sprint 1b ship): the **Vapi dashboard prompt** for that assistant ID is authoritative. ClaimShield does not override the system message. The `org_voice_personas.system_prompt` column is a stored reference copy, not what reaches Vapi.
> - For personas with `compose_from_profile = true` (Chajinel post-migration): the **assembled prompt from the builder** is sent as `assistantOverrides.model.messages = [{ role: "system", content: assembled }]`, overriding the dashboard's system message for that one call. The dashboard's other config (model name unless overridden, voice, tools, knowledge base, etc.) is unaffected by adding `messages` to the model block.
>
> Future engineers updating `02-data-flows.md` Flow B or `09-integrations.md` Vapi section should reflect this split, not the original simplifying assumption.

### 9.4 Vapi `model.messages` cascade-scope assumption

The Sprint 1b wire-in adds `messages` *inside the existing `model` override block* (`flow-step-executor.ts:704-711`), which already overrides `provider/model/temperature` for every outbound call (opt-in or opt-out). Whatever cascade-replace behavior Vapi applies to `assistantOverrides.model` was already in effect for both personas pre-1b — Sprint 1b only extends that block by one key for opt-in personas.

**Untested at sprint 1b ship.** No dev Vapi assistant exists to validate end-to-end (Chajinel's `vapi_assistant_id` is still `PLACEHOLDER_AWAITING_VAPI_CONFIG`; Caritas is production-active and out of scope). The assumption — that adding `messages` to the model override block does not cascade-clear other dashboard fields like `tools`, `knowledgeBase`, or `functions` — must be validated when Chajinel's real Vapi assistant ID is configured (or via a dedicated dev assistant before that). If the override turns out to cascade-replace the entire `model` config, the wire-in must be expanded to include all currently-dashboard-configured `model.*` keys for opt-in personas.

### 9.5 Inbound Vapi prompt reconciliation deferred

The inbound webhook at `server/routes.ts:9275-9429` (`POST /api/vapi/webhook`) is one-way only — it consumes `end-of-call-report` events, persists transcript/recording/summary, releases the comm lock, and advances the flow state machine. It never pushes `assistantOverrides` back to Vapi. Inbound assistants therefore continue to use their static dashboard-configured prompts regardless of `compose_from_profile`. Sprint 1c+ owns inbound-side reconciliation if/when it becomes necessary.

### 9.6 Caritas onboarding — now structurally unblocked

Adding a new tenant after Sprint 1b becomes a pure configuration task:

1. Define a profile (e.g. `referral_intake_only`) or reuse an existing one in `practice_profiles`.
2. Seed the profile with appropriate `intake_field_specs`.
3. Create the org's `org_voice_personas` row with a static template containing `{{INTAKE_FIELDS}}` and `compose_from_profile = true`.
4. Map the org via `organization_practice_profiles` (`is_primary = true`).
5. Configure the org's Vapi assistant ID (replacing any placeholder).
6. **Validate the Vapi `model.messages` cascade-scope assumption from §9.4 against that assistant before going live.**

### 9.7 Tier-2 / Tier-3 known concerns (Sprint 1b discovery)

- **Persona-vs-profile domain mismatch (Chajinel):** the migrated persona prompt opens with "You are an intake coordinator for Chajinel Clinic" and gives clinic-style directives ("ask reason for visit, scheduling preference, payment method"), but Chajinel is mapped to the home-care `home_care_agency_personal_care` profile whose `intake_field_specs` are senior-care intake fields ("Hours per week", "ADL needs", "VA authorization number", "IHSS county"). The assembled prompt (`docs/architecture/sprint1b-snapshots/chajinel-persona-assembled.txt`) reflects this mixed domain. Sprint 1b ships the structural plumbing; the persona text **or** the profile mapping should be reconciled before Chajinel's Vapi assistant goes live. Tracked here so the Caritas onboarding playbook surfaces the same review for any new tenant.
- **`intake_field_specs` key drift:** seeded specs use only 5 keys (`field_name`, `display_label`, `display_order`, `field_group`, `is_required`). The builder is forward-compatible with `help_text` (rendered as a sub-line) and `is_applicable=false` (skips the field), but neither key exists in the live data today. If specs are ever back-filled with these keys, no builder change is needed.
- **`org_voice_personas` has no `created_at` / `updated_at` columns.** Step 7c's `UPDATE` therefore could not write a `updated_at = NOW()`. Adding these columns is a Sprint-2-class hygiene change, not a 1b scope item.

---

## 10. Phase 3 — DEPLOYED TO PRODUCTION (2026-05-03)

Sprint 0 + Sprint 1a + Sprint 1b promoted to Railway production. All gates (1, 2, 3, 4, 6) signed off; Gate 5 collapsed into Gate 6 under Gate 2's reduced-scope plan.

- **DB migration window:** 2026-05-03T05:30:23Z → 05:30:28Z (single transaction, 13/13 pre-commit assertions PASS)
- **Code deploy:** `e56f10e..6e99937` pushed to `origin/main`, Railway auto-deployed; boot OK on :8080, `/health` 200, all background jobs started
- **Phase 5 smoke (against `$PRODUCTION_DATABASE_URL`):** smoke-helpers PASS; tenant-isolation 12/12 PASS with prod-correct expectations
- **Net schema delta:** `public` 82 → 88 tables; `practice_payer_enrollments` 8 → 20 columns; 2 new roles; 12 RLS policies (all with `WITH CHECK`); FORCE RLS on 6 tables

**Audit report:** `docs/architecture/phase3-prod-deploy-audit-report.md` is the authoritative end-to-end record of this deploy (timeline, pre-flight findings, migration design, execution evidence, push lessons learned, smoke results, files/DDL applied, open follow-ups, standing-order attestation).

Open follow-ups carried forward (none gating further work): stale `.git/refs/remotes/origin/main.lock` cleanup, Chajinel `compose_from_profile=true` flip, optional `replit_readonly` SELECT grants on the 6 new tables, Drizzle `organizations` declaration drift (§3.3, §8.2).

---

## 11. Sprint 1c — EDI Preflight Gate (delivered 2026-05-03)

Wires `evaluateClaim`'s Tier 1 structural-integrity rules (T1-001 … T1-008) into the two Stedi EDI submission routes. Server-side only, dev-only, no production deploy.

### 11.1 What shipped

- **New helper** `server/services/rules-engine/edi-preflight.ts` exporting:
  - `requireTier1Pass(ctx: ClaimContext): Promise<Tier1FailureBody | null>` — calls `evaluateClaim`, filters `RuleViolation[]` for `source==="tier1-structural" && severity==="block"`, returns a 400-ready failure body or `null`.
  - `buildClaimContextForGate({c, pat, payerInfo, serviceLines, icd10Codes})` — centralizes the snake_case → ClaimContext mapping shared by both stedi routes.
- **Two route gates wired** at `server/routes.ts`:
  - `POST /api/billing/claims/:id/submit-stedi` — gate at lines 6502–6527, fires after the synthetic-data gate / `submission_attempts` insert, before `generate837P`.
  - `POST /api/billing/claims/:id/test-stedi` — gate at lines 6735–6755, fires after address building, before `generate837P`.
- **Failure response contract** (matches the existing EDI-route Convention 2): HTTP 400 with `{success:false, error:"VALIDATION_ERROR: …", findings:[{code,severity,message,fixSuggestion}], gateName:"tier1-structural-preflight"}`.
- **7 new tests** at `server/services/rules-engine/edi-preflight.test.ts` (6 documented + 1 bonus mapping check), all passing.
- **Pre-existing in-route VALIDATION_ERROR checks** at `routes.ts` 6428/6441/6685/6698 left untouched per Hard Rule 3c; harmless redundancy that keeps Sprint 1c rollback-safe.

### 11.2 Important contract correction discovered during Sprint 1c

The Sprint 1c prompt's "Anchors" section claimed `evaluateClaim` returns `{ findings, shortCircuited, shortCircuitReason }`. **The actual contract has been `Promise<RuleViolation[]>` since Sprint 1a** — a flat array, no wrapper, no flag. The Sprint 1c gate detects Tier 1 blocks via filter (`f.source === "tier1-structural" && f.severity === "block"`) rather than a non-existent boolean. The behavior is functionally identical to the prompt's intent. See `docs/architecture/sprint1c-audit-report.md` §2c for line-cited evidence and Option (i) detection rationale.

### 11.3 Verification

| Suite | Result |
|---|---|
| `scripts/verify-tenant-isolation.ts` | 12/12 |
| `tier1-structural-integrity.test.ts` | 16/16 |
| `rules-engine.test.ts` | 4/4 |
| `voice-persona-builder.test.ts` | 23/23 |
| `scripts/smoke-helpers.ts` | green (chajinel→home_care, demo ppe=2, chajinel ppe=0, no-ctx=0) |
| **`edi-preflight.test.ts`** (new) | **7/7** |
| `tsc --noEmit` error count | 85 (= baseline; **zero new errors** introduced) |
| Workflow boot | clean — `serving on port 5000`, all crons started |

### 11.4 Sprint 2 pre-flight recommendation (carried forward from §1.8 of sprint1c-audit-report)

When Sprint 2 captures its baselines, **replace any binary "tsc clean" assertion with an explicit error-count assertion** (e.g. `tsc count ≤ 85` or whatever the snapshot count is at Sprint 2 start). Rationale: Sprint 1a/1b's audit reports both claimed a clean tsc baseline, but the Sprint 1c pre-flight found 85 pre-existing errors with at least one (`server/services/rules-engine.ts:196` TS2802) traceable to commit `9537fc2` — well before Phase 3. Either the prior baselines measured something narrower than full-project strict tsc, or accumulated drift slipped through. An explicit numeric count is environment-stable and catches regressions even when the absolute floor is non-zero.

Path A's Sprint 1c success criterion (no new tsc errors) should become the Sprint 2+ default for all baseline assertions: capture the pre-sprint count `N`, require post-sprint count `≤ N`, document any drift.

### 11.5 Open follow-ups (non-blocking)

- The pre-existing 85 tsc errors remain (63 in `routes.ts`, 5 in `storage.ts`, 4 each in `rate-ingest.ts` / `claim-wizard.tsx`, etc.). Hygiene-only; not Sprint-1c-relevant per Path A. A future hygiene sprint could drain them; the current report makes the count explicit and trackable.
- The pre-existing in-route VALIDATION_ERROR checks at 6428/6441/6685/6698 are now functionally dead code (the Tier 1 gate validates the same conditions and more), but were intentionally kept for rollback safety. A future cleanup sprint can remove them once the gate has soaked.
- Sprint 1c only covers the two Stedi EDI submission routes. Office Ally submission (`routes.ts:6298–6345`) and the resubmit-stedi route (~line 4167 vicinity) are NOT gated by Tier 1 yet. If the gate is desired there, it's a copy-paste of the same 4-line block — out of Sprint 1c scope.

---

## §12 Sprint 1c — DEPLOYED TO PRODUCTION (2026-05-03)

Code-only deploy. No DDL, no DML, no migration scripts. Sits on top of Phase 3 prod deploy.

### Push

- **Transition:** `6e99937..eecedc6  main -> main`
- **Pre-flight:** Gate 1 stopped at Step 1d on a stale-local-fetch-ref anomaly (initial reading: 176 unpushed commits, origin at `9d89d2f`). Diagnostic queries authorized by Abeer proved the GitHub `origin/main` was at `6e99937` (Phase 3 SHA); local cache was frozen by the unresolved `.git/refs/remotes/origin/main.lock` (Apr 27 mtime). True unpushed delta was 9 commits. Gate 1 PASSED after evidence-based reconciliation.
- **Gate 2:** Abeer's explicit "push" issued; `git push origin main` succeeded (LFS upload 133 MB, 69 objects). The `update_ref failed for ref 'refs/remotes/origin/main'` warning at end is the same stale-lock side-effect — actual remote advanced (`ls-remote` returns `eecedc6`).

### Post-deploy verification (autonomous portions)

| Check | Result |
|---|---|
| `git ls-remote origin main` post-push | `eecedc6...` ✅ |
| `smoke-helpers` against `$PRODUCTION_DATABASE_URL` | green — chajinel→home_care, ppe=3; demo ppe=2; no-ctx=0 (identical to Phase 3 baseline) |
| Phase 3 schema regression read | 6/6 tables present, role exists, FORCE RLS=6, ppe cols=20 — **unchanged** by push |

### Post-deploy verification (Abeer's outstanding tasks)

| Check | Status |
|---|---|
| Railway dashboard shows latest deploy at SHA `eecedc6` (or descendant) + clean boot | ⏳ DEFERRED — Replit's `fetch_deployment_logs` doesn't see Railway logs |
| UI smoke test: well-formed claim through `submit-stedi` + `test-stedi` → same behavior as pre-Sprint-1c | ⏳ DEFERRED — requires real-claim submission via UI |

### Files in delta — code-only attestation

`edi-preflight.ts` (new), `edi-preflight.test.ts` (new), `routes.ts` (+49 lines, gates at 6502–6527 and 6735–6755), `verify-tenant-isolation-prod.ts` (new helper script), plus docs (`sprint1c-audit-report.md`, `sprint1c-deploy-preflight.md`, `sprint1c-prod-deploy-audit-report.md`, `migration-state.md` §11/§12, `replit.md` updates), plus `sprint1c-snapshots/dev-pre-sprint1c-*.sql` (text snapshot, not executed). **Zero schema/migration code in delta. Zero DDL/DML against prod DB during deploy.**

### Open follow-ups (carried forward)

1. `.git/refs/remotes/origin/main.lock` cleanup — Phase 3 §10 follow-up #1, sandbox blocked `rm` as destructive git op. Needs Project Task. Not blocking — push uses live GitHub ref; only the local cache view stays frozen.
2. Persona flip (Caritas Sprint 1b post-merge) — still open.
3. `replit_readonly` permission grants — still open.
4. Drizzle declaration drift on `organizations` — still open (`is_active` vs `status='active'`).
5. Pre-existing 85 tsc errors — Path A baseline hold, drain in a future hygiene sprint.

### Authoritative records

- `docs/architecture/sprint1c-deploy-preflight.md` — pre-flight findings (with anomaly + reconciliation)
- `docs/architecture/sprint1c-prod-deploy-audit-report.md` — full Sprint 1c prod-deploy audit
- `docs/architecture/sprint1c-audit-report.md` — Sprint 1c implementation audit (predates deploy)

**Status:** Push complete. Awaiting Abeer's Gate 3 sign-off on Railway boot logs + UI smoke test before marking Sprint 1c officially DEPLOYED in this section's headline.
