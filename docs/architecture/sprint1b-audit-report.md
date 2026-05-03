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

## §3+ — HELD AT SIGN-OFF GATE

**No DDL applied. No code written. No persona modified.**

The following items are held pending reviewer sign-off on the issues raised in §2b (outbound `system_prompt` disconnect) and §2e (missing `updated_at` column, `intake_field_specs` key drift):

- §3 Schema change (ALTER TABLE)
- §4 Drizzle update
- §5 Builder implementation
- §6 Outbound wire-in
- §7 Chajinel persona migration
- §8 Tests
- §9 Verification matrix
- §10 Files / DDL summary
- §11 Standing-order attestation
- Migration-state §9 append

Sign-off questions are raised in the chat thread (see "Sprint 1b §2 sign-off — open questions" message).
