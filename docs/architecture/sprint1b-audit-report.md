# Phase 3 Sprint 1b — Audit Report (IN PROGRESS — held at §2 sign-off gate)

**Sprint dates:** 2026-05-03 (in progress)
**Standing order:** Dev only. No production deploy. No mutations performed in this report period — discovery only.
**Predecessors:** [`sprint0-audit-report.md`](./sprint0-audit-report.md), [`sprint1a-audit-report.md`](./sprint1a-audit-report.md), [`migration-state.md`](./migration-state.md)

> **Status:** Steps 1–2 complete. **Held at the §2 sign-off gate** per prompt (read-only discovery surfaced a material architectural finding that affects Steps 3–11). Reviewer sign-off required before Step 3 (DDL).

## §1 Executive summary + baseline verification

Sprint 1b adds runtime composition of the voice persona system-prompt, sourcing the "fields to capture" section from the active practice profile. This audit report covers Steps 1–2 only.

**Snapshot (pre-DDL):** `docs/architecture/sprint1b-snapshots/dev-pre-sprint1b-20260503-034006Z.sql` (127 MB, 183,165 lines, gitignored).
**`.gitignore`:** `sprint1b-snapshots/` appended (Sprint 1a covered `sprint1a-snapshots/` only).

**Baseline matrix (Step 1b)** — all green:

| Check | Result |
|---|---|
| `scripts/verify-tenant-isolation.ts` | 12/12 PASS |
| `server/services/rules-engine/tier1-structural-integrity.test.ts` | 16/16 PASS |
| `server/services/rules-engine.test.ts` (Sprint 1a) | 4/4 PASS |
| `scripts/smoke-helpers.ts` | green (chajinel→home_care_agency_personal_care, demo=2, chajinel=0, no-ctx=0) |
| `npx tsc --noEmit` | 85 errors (unchanged baseline; 0 new from Sprint 1a) |

## §2 Discovery (read-only)

### §2a. Both `org_voice_personas` rows

Live `org_voice_personas` schema (9 columns, **no `created_at` / `updated_at` columns**):

| # | Column | Type |
|---|---|---|
| 1 | `id` | uuid |
| 2 | `organization_id` | text |
| 3 | `persona_key` | text |
| 4 | `vapi_assistant_id` | text |
| 5 | `persona_name` | text |
| 6 | `greeting` | text |
| 7 | `system_prompt` | text |
| 8 | `metadata` | jsonb |
| 9 | `is_active` | boolean |

The two seeded rows:

| organization_id | persona_key | vapi_assistant_id | prompt_len |
|---|---|---|---|
| `caritas-org-001` | `intake_coordinator` | `71a284d9-b37b-4b12-b721-834fa84e8ad9` | 373 |
| `chajinel-org-001` | `intake_coordinator` | `PLACEHOLDER_AWAITING_VAPI_CONFIG` | 204 |

Caritas prompt preview (first 300 chars):
> "You are Sarah, a compassionate intake coordinator at Caritas Senior Care in Miami, FL. You help families explore senior care options — companion care, personal care, skilled nursing, dementia care, hospice, and respite care. Capture: insurance carrier, member ID, DOB, urgency level, and state. Be wa…"

Chajinel prompt (full, 204 chars):
> "You are an intake coordinator for Chajinel Clinic. Greet warmly, ask reason for visit, scheduling preference, and payment method (self-pay vs insurance). Spanish or English depending on caller preference."

> ⚠️ **The "second persona row" is Caritas, with a real (non-placeholder) `vapi_assistant_id`.** Per replit.md, Caritas Senior Care is `is_active=true` with the live 8-step Standard Intake flow. Per the prompt's §2a hard rule and Hard Rule #3, Caritas's persona is **production-active and must NOT be modified** in Sprint 1b — `compose_from_profile` stays at the column default `false`. Only Chajinel's persona is migrated.

### §2b. Outbound prompt construction call chain (`server/services/flow-step-executor.ts`)

**File range:** lines 564–751 (full `voice_call` step type handler).

| Step | Line(s) | What |
|---|---|---|
| 1 | 565 | `if (step.step_type === "voice_call" || step.step_type === "call")` — handler entry |
| 2 | 566–567 | Read `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID` from env |
| 3 | 568–569 | Read `step.config.persona_key` (defaults to `"intake_coordinator"`) |
| 4 | **570** | **Persona record loaded from `orgCtx.personas[personaKey]`** (NOT a fresh DB query — comes from `getOrgContext(organizationId)` cached at line 437). |
| 5 | **571** | **`assistantId = persona?.vapi_assistant_id \|\| process.env.VAPI_ASSISTANT_ID`** — the persona's Vapi assistant ID is the only field used for routing the call. |
| 6 | 581–596 | Lead-state gates (no phone, no consent → skip) |
| 7 | 598–616 | Business-hours guard (8am–8pm ET unless `CALL_WINDOW_OVERRIDE` set) |
| 8 | 619–633 | In-progress dedup guard |
| 9 | 635–649 | `acquireLock` (channel="call", 240 min) |
| 10 | 651–699 | Construct `vapiPayload` (see §2b-1 below) |
| 11 | 701–708 | `POST https://api.vapi.ai/call/phone` with `Authorization: Bearer ${vapiApiKey}` |
| 12 | 710–723 | Error path: release lock, log step_failed, fail flow run |
| 13 | 725–734 | Insert into `calls` table with `disposition='in_progress'` |
| 14 | 736–748 | Log `voice_call_initiated`, push `next_action_at` 4h out (webhook will resume) |

**§2b-1. The Vapi payload (lines 654–699):**

```typescript
const vapiPayload = {
  assistantId,           // ← from persona.vapi_assistant_id
  phoneNumberId,         // ← from env
  customer: { number, name },
  metadata: { leadId, flowRunId, lockId, orgId },
  assistantOverrides: {
    variableValues: {    // ← template var substitution (8 keys)
      patient_first_name, patient_last_name, patient_full_name,
      patient_phone, patient_state, service_needed,
      insurance_carrier, clinic_name,    // ← persona.persona_name
    },
    transcriber: { provider: "deepgram", model: "nova-2", language: "en", endpointing: 300 },
    model: { provider: "openai", model: "gpt-4o-mini", temperature: 0.2 },
    voice: { provider: "11labs", voiceId: "21m00Tcm4TlvDq8ikWAM", stability: 0.5, similarityBoost: 0.75 },
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 900,
    backgroundDenoisingEnabled: true,
  },
};
```

> 🚨 **CRITICAL FINDING — `system_prompt` is never read in the outbound path.** The full `voice_call` handler (lines 564–751) references `persona.vapi_assistant_id` (line 571) and `persona.persona_name` (line 676). It does **not** reference `persona.system_prompt`, `persona.greeting`, or any prompt-bearing field. The `assistantOverrides` block contains transcriber/model/voice configuration and `variableValues` for template substitution, but it does **NOT** contain a `model.messages` override or any other system-prompt field that Vapi accepts.
>
> **Implication:** The actual system prompt that Vapi uses for outbound calls is the one statically configured on the **Vapi-side dashboard** for assistant ID `71a284d9-b37b-4b12-b721-834fa84e8ad9` (Caritas). The `org_voice_personas.system_prompt` column is a **stored copy / reference**, currently disconnected from production call behavior.
>
> This is verified by `rg "system_prompt|systemPrompt" server/services/flow-step-executor.ts` returning **zero matches** within the file. The persona row's `system_prompt` is also not read by `getOrgContext` for purposes of the outbound payload (only persona_name and vapi_assistant_id are surfaced into the orgCtx personas map for use by the handler).

### §2c. Inbound webhook (`server/routes.ts:9275–9429`)

Handler: `POST /api/vapi/webhook`. Authenticated via `x-vapi-secret` header against `VAPI_WEBHOOK_SECRET` env var (line 9279, with a soft-warning fallback when env is unset).

Events handled:
- `end-of-call-report` / `call.completed` / `call-ended` (lines 9290–9421) — extracts `recordingUrl`, `transcript`, `summary` from Vapi's deeply-nested artifacts envelope; updates the `calls` row; if `metadata.flowRunId` is present, runs `extractInsuranceFromTranscript` and updates the `leads` row, then advances the flow.
- All other event types: 200 OK, no-op.

**Inbound never modifies the assistant prompt.** The handler does not call back to Vapi at all — it consumes one-way webhook deliveries, releases the comm lock, persists transcript/recording/summary, and advances the flow state machine. There is no mid-call `assistantOverrides` push.

> Per prompt §2c standing order: **inbound path is NOT modified in Sprint 1b**, regardless of finding. Sprint 1c+ owns the inbound-side reconciliation question (inbound assistants, like outbound ones, currently rely on Vapi's static dashboard config).

### §2d. Helper composition shape (`server/services/practice-profile-helpers.ts:40–94`)

`getActivePracticeProfile(orgIdOverride?)` runs inside `withTenantTx`, returning `(OrganizationPracticeProfile & { profile: PracticeProfile }) | null`. The `profile` payload has fully-typed fields including `intakeFieldSpecs` (camelCase, line 80). Drizzle exposes the JSONB content directly — **no parsing layer is needed**, the builder gets the array-of-objects shape directly.

Smoke result for Chajinel (re-run as part of Step 1b baseline): `home_care_agency_personal_care` profile, 13 intake field specs. **Helper signature is fit for purpose; no extension required.**

**Live `intake_field_specs` shape** — distinct top-level keys across all 13 entries:
- `display_label`
- `display_order`
- `field_group`
- `field_name`
- `is_required`

> ⚠️ **Spec drift vs prompt §5b/§5c:** The prompt suggests rendering `help_text` (as a sub-bullet) and skipping fields where `is_applicable === false`. Neither key exists in the live data — all 13 specs return `NULL` for `help_text` and there is no `is_applicable` field. Recommendation: the builder treats both as optional/absent and is forward-compatible if those keys are added in a later sprint, but the live render path will not include any `help_text` lines or `is_applicable` filtering for Chajinel today.

The 13 fields with required/optional flags (`field_name → display_label, is_required`):

| # | field_name | display_label | required |
|---|---|---|---|
| 1 | `first_name` | Caller first name | ✓ |
| 2 | `last_name` | Caller last name | ✓ |
| 3 | `phone` | Phone | ✓ |
| 4 | `care_recipient_name` | Who needs care | ✓ |
| 5 | `care_recipient_relationship` | Relationship to caller | — |
| 6 | `address` | Home address | ✓ |
| 7 | `hours_needed_per_week` | Hours per week | ✓ |
| 8 | `adl_assessment` | ADL needs (bathing, dressing, mobility, etc.) | — |
| 9 | `home_environment_notes` | Home environment notes | — |
| 10 | `considering_alf` | Considering assisted living | — |
| 11 | `payer_intent` | How will care be paid for | ✓ |
| 12 | `va_authorization_number` | VA authorization number | — |
| 13 | `ihss_county` | IHSS county (if applicable) | — |

### §2e. Other discovery items affecting the plan

1. **`org_voice_personas` has no `updated_at` column.** The prompt's Step 7c `UPDATE ... SET updated_at = NOW()` will fail. The migration UPDATE must drop that clause (or Step 3 must additionally add an `updated_at` column — a scope expansion).
2. **`org_voice_personas` RLS state:** `relrowsecurity = false`, `relforcerowsecurity = false`. Confirms the prompt's claim that the table predates Phase 3 RLS, and the builder's use of global `db` for persona reads is correct.

---

## §3 — Schema change

**Applied** in a single `BEGIN; ... COMMIT;` transaction:

```sql
ALTER TABLE org_voice_personas
  ADD COLUMN compose_from_profile boolean NOT NULL DEFAULT false;
```

Rationale for `NOT NULL DEFAULT false`: the legacy persona-rendering path is the only path in production today (Caritas). Defaulting the new column to `false` makes every existing row opt-out by construction — zero behavior change for already-active assistants. Opt-in is an explicit per-row UPDATE.

`updated_at` is not maintained on this table (table predates the project's hygiene conventions; column does not exist). No `updated_at` was set; the prompt's Step 7c clause was dropped accordingly. Hygiene fix tracked in migration-state §9.7 as a Sprint-2-class concern.

Post-DDL state (`SELECT organization_id, compose_from_profile, length(system_prompt)`):

| organization_id  | compose_from_profile | prompt_len |
|---|---|---|
| caritas-org-001  | f | 373 |
| chajinel-org-001 | f | 204 |

(Chajinel `compose_from_profile` flips to `t` and prompt grows to 223 in §7.)

## §4 — Drizzle declaration

The §1 inspection confirmed `org_voice_personas` has **no pre-existing Drizzle declaration**. The table is created by the raw-SQL startup seeder at `server/routes.ts:2199` and read via raw SQL in `server/services/org-context.ts:104`. The prompt's Step 4 wording assumed an existing declaration to update.

**Deviation (acknowledged):** Sprint 1b *creates* a fresh Drizzle declaration covering all 9 base columns + the new `composeFromProfile` column, instead of editing a non-existent one. This gives the new builder service typed access via `orgVoicePersonas` and exports an `OrgVoicePersona` select-type. End state matches the spirit of the prompt; only the path differs.

Decl shipped at `shared/schema.ts:850-869`:

```ts
export const orgVoicePersonas = pgTable("org_voice_personas", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: text("organization_id").notNull(),
  personaKey: text("persona_key").notNull(),
  vapiAssistantId: text("vapi_assistant_id"),
  personaName: text("persona_name"),
  greeting: text("greeting"),
  systemPrompt: text("system_prompt"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  isActive: boolean("is_active").notNull().default(true),
  composeFromProfile: boolean("compose_from_profile").notNull().default(false),
});
export type OrgVoicePersona = typeof orgVoicePersonas.$inferSelect;
```

Header comment notes the table predates Phase 3 and the seeder remains the source of truth for the table's *creation*; the Drizzle decl is for typed *reads* only. No `createInsertSchema` was generated — the builder does not insert.

The `OrgPersona` runtime interface in `server/services/org-context.ts:13-33` is also extended with `compose_from_profile: boolean`, and the cached SELECT at line 113-117 is widened to include the new column. This makes the flag available on `orgCtx.personas[key].compose_from_profile` for the wire-in at §6.

## §5 — Builder implementation

`server/services/voice-persona-builder.ts` — 137 lines, exports two functions.

**`buildAssistantSystemPrompt(orgId: string): Promise<string>`** — top-level entry. Path selection:

1. Read persona row by `organization_id = $1`, `ORDER BY persona_key LIMIT 1`. **No `is_active` filter** — Chajinel's org-level `is_active` is currently `false` (per `replit.md`); the builder must still produce a prompt for the org's primary persona regardless of activation status. Throws `Error("No voice persona configured for organization <id>")` if no row.
2. If `compose_from_profile === false` → return stored `system_prompt` verbatim. **Opt-out is byte-stable.** Verified empirically: `md5(buildAssistantSystemPrompt('caritas-org-001'))` equals `md5(system_prompt)` from the row (smoke #3 in §9).
3. If `compose_from_profile === true` → call `getActivePracticeProfile(orgId)` (RLS-aware via `withTenantTx`, explicit `organizationIdOverride`). On no profile **or** missing/empty `intakeFieldSpecs` → return stored `system_prompt` verbatim (fail-safe).
4. Render the specs via `renderIntakeFieldsForPrompt`. If the stored prompt contains `{{INTAKE_FIELDS}}` → `replaceAll` with the rendered block. Otherwise → append `\n\n${block}`.

**`renderIntakeFieldsForPrompt(specs: unknown): string`** — exported for tests. Rules:

- Empty / null / undefined / non-array → `""`.
- Sort by `display_order` (missing values fall to 999).
- Skip specs where `is_applicable === false` (forward-compat; not present in seeded data today).
- Use `display_label || field_name` for each line. Skips lines with neither.
- Optional `help_text` rendered as a sub-line in parentheses (forward-compat; not present today).
- Group: required first, optional second. Section headers omitted when a section is empty.
- If both groups end up empty → `""` (caller treats as no-op).

Output format (verified against assembled Chajinel prompt at `docs/architecture/sprint1b-snapshots/chajinel-persona-assembled.txt`):

```
DATA TO CAPTURE DURING THE CALL:

Required fields:
- Caller first name
- Caller last name
- Phone
- Who needs care
- Home address
- Hours per week
- How will care be paid for

Optional fields (capture if naturally offered):
- Relationship to caller
- ADL needs (bathing, dressing, mobility, etc.)
- Home environment notes
- Considering assisted living
- VA authorization number
- IHSS county (if applicable)
```

**Why pool not Drizzle for the persona read:** consistent with the existing read pattern in `server/services/org-context.ts:102-107`. The Drizzle decl exists for type safety on the read result, but the actual query is parameterized SQL — it's a single row, the columns are stable, and switching to Drizzle here adds no runtime safety.

## §6 — Outbound wire-in

Edited `server/services/flow-step-executor.ts` in two places, both inside the `voice_call` step handler:

1. **Lines 657-672** (newly inserted before the `vapiPayload` literal): resolve `composedSystemPrompt: string | null`. Resolution runs **only** when `persona?.compose_from_profile === true && organizationId`. Failure path (builder throws) is logged and `composedSystemPrompt` stays `null` — the call still goes out, just with no system-message override (degrades to dashboard prompt instead of failing the step).

2. **Lines 704-711** (existing `model` block): conditional spread injects `messages: [{ role: "system", content: composedSystemPrompt }]` only when the prompt is non-null. For opt-out personas the spread evaluates to `{}` and the emitted JSON for the `model` key is **byte-identical** to pre-Sprint-1b.

```ts
model: {
  provider: "openai",
  model: "gpt-4o-mini",
  temperature: 0.2,
  ...(composedSystemPrompt
    ? { messages: [{ role: "system", content: composedSystemPrompt }] }
    : {}),
},
```

**No new override scope.** The `model` block already overrode `provider/model/temperature` for *every* outbound call regardless of persona before Sprint 1b. Adding `messages` extends the same existing override scope by one key. Whatever cascade-replace semantics Vapi applies to `assistantOverrides.model`, they were already in effect for both Caritas and Chajinel pre-1b — Sprint 1b does not introduce new cascade-scope risk for opt-out personas, only for opt-in. (See §10 — assumption flagged for live validation.)

Dynamic `import()` is used to load the builder, keeping the cold-path lazy and isolating the executor from a pure code-load failure of the new module.

## §7 — Chajinel persona migration

**Caritas (production-active) was not touched.** `vapi_assistant_id=71a284d9-b37b-4b12-b721-834fa84e8ad9`, `compose_from_profile=false`, `system_prompt` md5 stable post-sprint at `87ecbe996f1c1e5fb42df9b1939f5409` (verified §9 smoke #4).

**Chajinel** (`vapi_assistant_id=PLACEHOLDER_AWAITING_VAPI_CONFIG`, org-level `is_active=false` per `replit.md`) migrated in a single transaction:

```sql
BEGIN;
UPDATE org_voice_personas
   SET system_prompt          = '<original 204 chars>\n\n{{INTAKE_FIELDS}}',
       compose_from_profile   = true
 WHERE organization_id = 'chajinel-org-001';
COMMIT;
```

Pre/post snapshots committed to `docs/architecture/sprint1b-snapshots/`:

- `chajinel-persona-pre.txt` — original 204-char prompt
- `chajinel-persona-post.txt` — 223-char post-migration template (with `\n\n{{INTAKE_FIELDS}}` appended)
- `chajinel-persona-assembled.txt` — 613-char assembled output produced by the builder for Chajinel post-migration (greeting + DATA TO CAPTURE block)

Per Step 7b, the original prompt has **no fields-to-capture section** (it gives directives like "ask reason for visit, scheduling preference, payment method" but lists no field names). The append-pattern was used. **Persona-vs-profile domain-mismatch flagged in §10.**

## §8 — Tests

`server/services/voice-persona-builder.test.ts` — **23/23 PASS**, run via `npx tsx server/services/voice-persona-builder.test.ts`.

| # | Test | Path covered |
|---|---|---|
| T1 | Caritas opt-out returns stored `system_prompt` byte-identical | `compose_from_profile=false` |
| T1b | Opt-out output contains no fields block | invariant guard |
| T2a-d | Chajinel opt-in: placeholder substituted; rendered block present; known label substituted in; greeting preserved | `compose=true` + has placeholder |
| T3a-d | Synthetic opt-in without placeholder: prefix preserved; block appended; known label appended; no placeholder leaked | `compose=true` + no placeholder |
| T4 | Synthetic opt-in without profile mapping: returns `system_prompt` verbatim (fail-safe) | `compose=true` + no profile |
| T5a-c | Renderer empty-input cases: `[]`, `null`, `undefined` → `""` | renderer unit |
| T6a-b | Builder throws for missing persona row; error message identifies cause | error path |
| T7a-c | Renderer required/optional grouping: both headers present; required before optional | format invariant |
| T8a-b | Renderer uses `display_label` not `field_name` | format invariant |
| T-applicable a-b | Renderer skips `is_applicable=false`, includes others | forward-compat |

Synthetic-org tests INSERT three rows (organizations + org_voice_personas + organization_practice_profiles) under timestamped IDs (`sprint1b-test-noprof-<ts>`, `sprint1b-test-noph-<ts>`) and DELETE them in a `finally` block in reverse FK order. **Zero pollution of seeded data** — verified by re-running and confirming no leaked rows.

## §9 — Verification matrix

All gates run after Step 7d's UPDATE landed and the workflow was restarted.

| Gate | Pre-1b baseline | Post-1b result | Δ |
|---|---|---|---|
| `scripts/verify-tenant-isolation.ts` | 12/12 | **12/12** | 0 |
| `tier1-structural-integrity.test.ts` | 16/16 | **16/16** | 0 |
| `rules-engine.test.ts` | 4/4 | **4/4** | 0 |
| `scripts/smoke-helpers.ts` | clean | **clean** (chajinel resolves home_care, demo=2, chajinel=0, no-ctx=0) | 0 |
| `voice-persona-builder.test.ts` | n/a | **23/23** (NEW) | +23 |
| `npx tsc --noEmit` | 85 errors (pre-existing storage.ts / unrelated) | **85 errors** | **0** (no new errors introduced) |
| Workflow boot | clean | **clean** (port 5000, all seeders green, all cron jobs started) | 0 |

**Smoke #1** — final DB state confirmed only Chajinel was migrated:

| organization_id  | compose_from_profile | prompt_len |
|---|---|---|
| caritas-org-001  | `f` | 373 |
| chajinel-org-001 | `t` | 223 |

**Smoke #2** — Chajinel assembled prompt produced via runtime call to the builder, captured to `chajinel-persona-assembled.txt` (613 bytes). Greeting preserved, DATA TO CAPTURE block correctly populated with 7 required + 6 optional labels matching `home_care_agency_personal_care.intake_field_specs`.

**Smoke #3** — Caritas builder output byte-identical to stored row: `buildAssistantSystemPrompt('caritas-org-001') === row.system_prompt` → `PASS`. Confirms opt-out path is a true no-op.

**Smoke #4** — Caritas `system_prompt` md5 unchanged across the entire sprint: `87ecbe996f1c1e5fb42df9b1939f5409`. Production persona row was not touched.

## §10 — Risks carried forward

### 10.1 `model.messages` cascade-scope assumption (UNVERIFIED LIVE)

The wire-in adds `messages` to the existing `assistantOverrides.model` block. That block already overrode `provider/model/temperature` for every outbound call in production pre-Sprint-1b — adding one key to a block that was already there does not introduce a new override boundary. Whatever Vapi does with partial `model` overrides today (cascade-clear other dashboard `model.*` keys, or merge), it was already doing it for Caritas every call.

**However**, Sprint 1b cannot validate this end-to-end: Chajinel's Vapi assistant ID is still `PLACEHOLDER_AWAITING_VAPI_CONFIG`, and Caritas is production-active and out of scope for live test calls. **First Chajinel test call after a real assistant ID is configured must verify** that adding `messages` does not unexpectedly clear `tools`, `knowledgeBase`, `functions`, etc. on that assistant. If it does, the wire-in must be expanded to mirror all dashboard-configured `model.*` keys for opt-in personas. Tracked in migration-state §9.4.

### 10.2 Vapi authoritative-prompt-source documentation correction

Sprint 1b's §2b discovery — that `org_voice_personas.system_prompt` was **never** sent to Vapi pre-Sprint-1b for *any* persona; the Vapi-dashboard prompt was authoritative — overturns claims in:

- `docs/architecture/system-audit/02-data-flows.md` Flow B
- `docs/architecture/system-audit/09-integrations.md` (Vapi section)

Migration-state §9.3 records the corrected post-1b split: opt-out personas continue to use the dashboard prompt; opt-in personas use the builder-assembled override via `model.messages`. Future updates to those audit docs must reflect this; **no edit to those docs is being made in 1b** because that is system-audit-doc scope, not 1b sprint scope.

### 10.3 Chajinel persona-vs-profile domain mismatch

The migrated Chajinel prompt opens with "You are an intake coordinator for Chajinel Clinic" and gives clinic-style directives (reason for visit, scheduling preference, payment method). The mapped profile is `home_care_agency_personal_care`, whose `intake_field_specs` are senior-care fields (Hours per week, ADL needs, VA authorization, IHSS county). The assembled output (`chajinel-persona-assembled.txt`) reflects this mixed domain.

Sprint 1b ships only the structural plumbing; the persona text **or** the profile mapping should be reconciled before Chajinel is activated for live calls. Flag is also recorded in migration-state §9.7 so the same review is surfaced for any new tenant onboarding via the §9.6 playbook.

### 10.4 RLS not extended to `org_voice_personas`

The persona table predates Phase 3 and remains `relrowsecurity=false` post-Sprint-1b. The builder reads via the global superuser `pool` because RLS is not in effect. Acceptable for 1b — no INSERT/UPDATE helpers are introduced for this table — but the table sits in the same Sprint-2-class gate as the other pre-Phase-3 `org_*` tables (`org_message_templates`, `org_service_types`, `org_payer_mappings`, `org_lead_sources`, `org_providers`). Tracked in migration-state §9.2.

### 10.5 `intake_field_specs` key drift (forward-compat dead-code today)

The renderer supports `help_text` (rendered as parenthetical sub-line) and `is_applicable=false` (skip). Neither key exists in the live data on any of the 13 seeded specs as of Sprint 1b. If specs are back-filled with these keys later, no builder change is needed.

## §11 — Files / DDL summary + standing-order attestation

### 11.1 Files modified

| Path | Change |
|---|---|
| `shared/schema.ts:850-869` | NEW Drizzle decl `orgVoicePersonas` + `OrgVoicePersona` type |
| `server/services/org-context.ts:13-33` | Extended `OrgPersona` interface with `compose_from_profile` |
| `server/services/org-context.ts:113-117` | Extended persona SELECT to include new column |
| `server/services/voice-persona-builder.ts` | **NEW** — 137 lines, exports `buildAssistantSystemPrompt` + `renderIntakeFieldsForPrompt` |
| `server/services/voice-persona-builder.test.ts` | **NEW** — 23 tests |
| `server/services/flow-step-executor.ts:657-672` | NEW: lazy resolve `composedSystemPrompt` (opt-in only) |
| `server/services/flow-step-executor.ts:704-711` | Conditional `messages` injection in existing `model` block |
| `docs/architecture/migration-state.md` | NEW §9 (sprint 1b state, Vapi correction, Caritas onboarding playbook, Tier-2/3 known concerns) |
| `docs/architecture/sprint1b-audit-report.md` | This document |
| `docs/architecture/sprint1b-snapshots/dev-pre-sprint1b-*.sql` | Snapshot (Step 1, gitignored) |
| `docs/architecture/sprint1b-snapshots/chajinel-persona-{pre,post,assembled}.txt` | Pre/post/assembled prompt snapshots |

### 11.2 DDL applied (dev only)

Two transactions, both committed:

```sql
-- Step 3: schema change
ALTER TABLE org_voice_personas
  ADD COLUMN compose_from_profile boolean NOT NULL DEFAULT false;

-- Step 7c: Chajinel migration (single org)
UPDATE org_voice_personas
   SET system_prompt        = '<existing prompt>' || E'\n\n{{INTAKE_FIELDS}}',
       compose_from_profile = true
 WHERE organization_id = 'chajinel-org-001';
```

### 11.3 Standing-order attestation

- ✅ **Dev only**: zero production deploys; all changes against dev `DATABASE_URL`.
- ✅ **No Caritas mutation**: `system_prompt` md5 stable at `87ecbe996f1c1e5fb42df9b1939f5409` pre→post sprint (§9 smoke #4); `compose_from_profile=false`; `vapi_assistant_id` unchanged.
- ✅ **No new tsc errors**: 85 → 85.
- ✅ **All sprint 0/1a baselines green**: 12/12 + 16/16 + 4/4 + smoke clean.
- ✅ **Sprint 1b tests green**: 23/23 builder tests.
- ✅ **Workflow boot clean** post-restart: port 5000, seeders green, cron jobs started, no errors in console.
- ✅ **Snapshots captured**: pre-sprint DB snapshot + Chajinel pre/post/assembled prompt files committed.
- ✅ **Migration-state updated**: §9 appended, including Vapi authoritative-prompt-source correction note for the existing system-audit docs.
- ✅ **Reviewer guardrail honored** (Option B + cascade-scope assumption documentation): override only injected when `compose_from_profile=true`; cascade-scope risk explicitly documented in §10.1 + migration-state §9.4 with required live-validation checkpoint.

— end Sprint 1b audit —
