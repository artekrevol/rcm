# Post-Claim Filing Flow Audit
**Date**: 2026-05-01  
**Scope**: Everything that happens AFTER a claim is submitted to Stedi  
**Methodology**: Codebase trace — exact file paths and line numbers cited throughout  
**Status**: Read-only audit. No code changes made.

---

## DEMO BLOCKERS

| # | Severity | Issue | Recommended Fix |
|---|---|---|---|
| **DB-1** | 🔴 HIGH | `mark-fixed` + resubmit sets `status='submitted'` on the DB row but does **NOT** re-send the 837P to Stedi. A denied claim the user "resubmits" through the UI is silently stuck — no new EDI goes out. | Wire the existing `submit-stedi` endpoint call into the `mark-fixed?resubmit=true` path, or add a "Send to Stedi" step after mark-fixed. |
| **DB-2** | 🔴 HIGH | Frequency code 7 (replacement) is **never enforced** on resubmission. PGBA requires code 7 + `orig_claim_number` in REF\*F8 for corrected claims. Resubmitting with code 1 will be rejected by PGBA at the claim level. | Add a guard in `mark-fixed` that sets `claim_frequency_code='7'` and validates `orig_claim_number` is populated before calling Stedi. |
| **DB-3** | 🟡 MEDIUM | `"277CA Received"` and `"ERA Adjustment"` claim event types are not in the `eventConfig` map in `client/src/components/claim-timeline.tsx` (line ~90). They render with gray `Created` styling — looks broken in a live demo. | Add `'277CA Received'`, `'ERA Adjustment'`, `'Submission Failed'`, `'Resubmitted'`, and `'MarkedFixed'` to the `eventConfig` map with appropriate icons/colors. |

---

## a. Submission Response Handling

### Where the Stedi call lives
- **Production submit**: `server/services/stedi-claims.ts`, `submitClaim()` lines 76–167  
  Calls `POST https://healthcare.us.stedi.com/.../submissions`, sends raw X12, handles ISA15 safety guard (throws if ISA15=P and ENV=development).
- **Test submit**: `server/services/stedi-claims.ts`, `testClaim()` lines 169–243  
  Same call with `ISA15='T'` forced; result stored in `last_test_*` columns only — does NOT set `status='submitted'`.

### Is Stedi's `transaction_id` stored?
**Yes.** `server/routes.ts` line 6324–6332:
```sql
ALTER TABLE claims ADD COLUMN IF NOT EXISTS stedi_transaction_id VARCHAR  -- idempotent guard
UPDATE claims SET status='submitted', submission_method='stedi',
  stedi_transaction_id=$2, follow_up_date=$3, updated_at=NOW() WHERE id=$1
```
The `stedi_transaction_id` comes from `result.transactionId` returned by `submitClaim()`.  
**Test-stedi path** stores separately: `last_test_status`, `last_test_at`, `last_test_errors`, `last_test_correlation_id` — does NOT write `stedi_transaction_id` (lines 6541–6543).

### Is the synchronous 999 acknowledgment parsed?
**No.** Stedi's API returns a JSON response with `{transactionId, status, validationErrors}` — no X12 999 envelope is surfaced or parsed. The `status` field from Stedi's response is logged in the timeline note but not mapped to a claim status. If Stedi rejects at their edge, the `result.success === false` branch writes a `"Submission Failed"` event (line 6351–6354) but leaves the claim status unchanged (not set to `error` or any other state).

### Claim status at this point
On success: `status='submitted'`  
On Stedi edge rejection: status unchanged (left at whatever it was before), event `"Submission Failed"` written.

### What the UI shows
- **Claim detail page** (`client/src/pages/claim-detail.tsx` line 885): shows `stedi_transaction_id` in a monospace field labeled "Stedi Transaction ID"
- **Test-stedi result** (claim-detail.tsx lines 895–943): shows `last_test_status`, `last_test_at`, `last_test_errors`, `last_test_correlation_id` in a dedicated panel when `submission_method === 'stedi'`
- **Follow-up date**: set automatically from `payers.auto_followup_days` (routes.ts lines 6315–6322); visible on the claim card

---

## b. 277CA Acknowledgment Ingestion

### Which handler receives 277CAs — webhook, polling, or both?
**Both are wired. Both are active.**

**Webhook (primary for real-time):**
- Route: `server/routes.ts`, `POST /api/webhooks/stedi`, lines 12517–12606
- Dispatches by `transactionSetIdentifier === '277'` → fetches full transaction via `fetchStediTransaction()` → calls `process277CA(data, transactionId, db)` (`server/services/stedi-webhooks.ts` lines 45–131)

**Polling (reconciliation backup):**
- Function: `pollStedi277Acknowledgments()` in `server/routes.ts`, lines ~13388–13423
- Schedule: every 4 hours (`setInterval(..., 4 * 60 * 60 * 1000)`, line ~13509)
- Also called on startup immediately

**Manual trigger:**
- Route: `POST /api/billing/claims/:id/check-277` (routes.ts ~line 6577)
- User-triggered from the claim detail page when the claim is in `submitted` status

### Where does the 277CA parser live and what does it extract?
`server/services/stedi-webhooks.ts`, `process277CA()`, lines 45–131:
- Extracts `patientControlNumber` (maps to `claims.id`) and `statusCategoryCode`
- Maps category codes to internal status:

| PGBA code | Internal status |
|---|---|
| A1, A4, A6, A7, A8 | `acknowledged` |
| A2, A3 | `rejected` |
| (unknown) | `acknowledged` (safe default) |

- Only processes claims currently in `submitted` status (line 104 guard)
- Updates `claims.status` (lines 106–109)
- Writes `claim_events.type = '277CA Received'` with notes (lines 111–122)

### Is `rejectionCodeLookup` wired into the 277CA path?
**No.** The `server/data/pgba_rejection_codes.json` file exists (37 PGBA Table 5 rejection codes created during the EDI audit), but no service class wraps it and no code imports it. The 277CA processor has no enrichment step. If PGBA returns a specific Table 5 rejection code (e.g., `G2`, `S04`, `AAT`), it appears only in the raw `statusCategoryCode` field — no human-readable description is added to the timeline note.

**To wire it**: Create `server/services/rejection-code-lookup.ts` that imports the JSON, then call it in `process277CA()` to append the description to the timeline event notes.

### Claim status transitions on 277CA
`submitted` → `acknowledged` or `submitted` → `rejected`  
No further automatic transitions from those states.

### UI visibility for 277CA
- **Timeline**: event `"277CA Received"` written to `claim_events` — visible on claim detail page, but renders with **gray `Created` styling** (fallback) due to missing entry in `eventConfig` (see DB-3)
- **Manual check**: toast shows `"277CA: acknowledged"` / `"277CA: rejected"` on the claim detail page after user clicks Check 277CA
- **Dashboard**: no badge or counter updates on 277CA arrival from polling
- **No push notification**: polling-based 277CA arrivals are silent — no email, toast, or badge

---

## c. 835 ERA Ingestion and Payment Posting

### Which handler receives 835s — webhook, polling, or both?
**Both are wired.**

**Webhook:**
- Route: `server/routes.ts`, `POST /api/webhooks/stedi`, lines 12517–12606
- Dispatches by `transactionSetIdentifier === '835'` → `process835ERA(data, transactionId, db)` (`server/services/stedi-webhooks.ts` lines 133–261)

**Polling:**
- Function: `pollStedi835ERA()` in `server/routes.ts`, lines ~13457–13504
- Schedule: every 24 hours (`setInterval(..., 24 * 60 * 60 * 1000)`, line ~13511)
- Also called on startup

### Where does the 835 parser live?
Two parsers exist:
1. **`process835ERA()`** in `server/services/stedi-webhooks.ts` lines 133–261 — handles JSON from Stedi's API (webhook + polling path). Extracts: `checkNumber`, `checkDate`, `payerName`, `totalPayment`, per-claim `billedAmount`, `paidAmount`, `adjustments` (CARC codes).
2. **`parseERAResponse()`** in `server/services/stedi-claims.ts` lines 359–396 — shapes the polling response for `poll835ERA()`. Used internally by `pollStedi835ERA()`.

### Is payment auto-posting wired or stubbed?
**Partially wired — two separate paths:**

**Path 1 — webhook/polling automatic posting** (`stedi-webhooks.ts` `applyCARCRules()` lines 263–328):
- Fires when an 835 arrives via webhook or polling and the claim has matching adjustments
- Reads `carc_posting_rules` table (22 seeded rules) and applies:
  - `auto_writeoff` → `claims.status = 'paid'`
  - `flag_appeal` → `claims.status = 'appeal_needed'`
  - `flag_review` → `claims.status = 'review_needed'`
  - `patient_responsibility` → `claims.status = 'patient_responsibility'`
- Writes `claim_events.type = 'ERA Adjustment'` per CARC
- **Does NOT update `paid_amount`, `patient_responsibility_amount`, or `adjustment_amount` columns on the claim record** — only status is updated

**Path 2 — manual ERA posting UI** (`server/routes.ts` ERA posting route ~line 4026, `client/src/pages/billing/era.tsx`):
- User navigates to ERA Posting page, selects an ERA batch, confirms posting
- Updates `claims.status = 'paid'` when `paid_amount > 0` (routes.ts ~line 4188)
- Writes `claim_events.type = 'Payment'` (routes.ts ~line 4192)
- Also updates `era_batches.status` and `era_lines` columns

### How are CARC codes captured and surfaced?
- **`carc_codes` table**: seeded reference table (full CARC code list) — accessible via `GET /api/billing/carc-codes` with search (routes.ts ~line 3178)
- **`carc_posting_rules` table**: 22 seeded rules (`INSERT INTO carc_posting_rules` at routes.ts ~line 1231) — no auto-update from live data
- **ERA claim lines**: CARC adjustment codes stored as JSON in `era_claim_lines.adjustment_codes` (stedi-webhooks.ts line 247–252)
- **UI**: CARC codes visible on the ERA Posting page (`client/src/pages/billing/era.tsx`) and in the DenialRecoveryPanel on the claim detail page

### Does `denial_patterns` get written from real ERA data?
**No.** The `denial_patterns` table is seeded-only (22 patterns seeded at routes.ts ~line 453–468). No code path exists that writes new rows from live 835 ERA data. The table is read by the rules engine for prevention scoring but is never updated from production denials.

### Where does the user see ERAs in the UI?
- **ERA Posting page**: `client/src/pages/billing/era.tsx` — dedicated page listing `era_batches`, drill-down to line items, manual post action
- **Claim detail page**: `DenialRecoveryPanel` (claim-detail.tsx ~lines 252–333) calls `GET /api/billing/claims/:claimId/denial-recovery` — shows denial code, root cause, recommended action, ERA payment history when present

---

## d. Claim Status Lifecycle

### Complete status value inventory

| Status | How it's set | Reachable? |
|---|---|---|
| `created` | Default on `INSERT INTO claims` (`shared/schema.ts` ~line 123) | ✅ Yes |
| `verified` | Manual or rules engine readiness check | ✅ Yes |
| `submitted` | `POST /api/billing/claims/:id/submit-stedi` (routes.ts line 6327); `POST /api/billing/claims/:id/submit-oa`; `mark-fixed?resubmit=true` (routes.ts line 4009) | ✅ Yes |
| `acknowledged` | 277CA process (webhook / polling / manual check) — statusCategoryCode A1/A4/A6/A7/A8 | ✅ Yes |
| `rejected` | 277CA process — statusCategoryCode A2/A3 or ack.status `"4"` | ✅ Yes |
| `pending` | Mentioned in `status-badge.tsx` and `claim-timeline.tsx` `eventConfig` | ⚠️ Partial — no code path sets it from 277CA; may be set manually |
| `suspended` | In `status-badge.tsx` display map and in dashboard aggregate SQL (`WHERE status IN ('denied','suspended')` at routes.ts lines 4403–4406) | ❌ Not set — no UPDATE path sets this value in any handler |
| `denied` | CARC rule `flag_appeal` leaves at `appeal_needed`; `denied` is set by ERA manual posting or CARC rules if configured | ⚠️ Reachable via ERA posting but no CARC rule maps to it directly |
| `appeal_needed` | `applyCARCRules()` CARC `flag_appeal` action (stedi-webhooks.ts line 295–299) | ✅ Yes |
| `review_needed` | `applyCARCRules()` CARC `flag_review` action (stedi-webhooks.ts line 301–305) | ✅ Yes |
| `patient_responsibility` | `applyCARCRules()` CARC `patient_responsibility` action (stedi-webhooks.ts line 307–311) | ✅ Yes |
| `paid` | `applyCARCRules()` CARC `auto_writeoff` (stedi-webhooks.ts line 290–293); manual ERA posting (routes.ts ~line 4188) | ✅ Yes |
| `appealed` | In `status-badge.tsx`; presumably set via the "Deny Recovery" flow | ⚠️ No explicit UPDATE found — likely set manually |
| `error` | `mark-fixed` source list includes `'error'` as an allowed resubmit-from status (routes.ts line 4004) | ⚠️ No UPDATE found that sets this — not set by any handler |

### Status values not reachable in live code
- `suspended`: used in dashboard aggregate SQL and in the UI badge, but no handler sets it
- `error`: included as a resubmittable status but no handler transitions to it
- `pending`: in the UI badge config and stuck-claim detection, but 277CA path does not map any status code to it

### Stuck-claim detection
**Exists in the UI only — no server-side alert fires.**
- `client/src/pages/claim-detail.tsx` lines ~469–476: `isStuck = lastEvent?.type === "Pending" && differenceInDays(...) > 7`
- `client/src/components/claim-timeline.tsx` lines ~67–115: shows "Stuck N days" badge on the last Pending event
- Depends on `claim_events.type === "Pending"` (capital P, exact match) — but 277CA processing writes `"277CA Received"`, not `"Pending"`, so stuck detection only fires if a `"Pending"` event was written manually

---

## e. Denial Intelligence Feedback Loop

### Does `denial_patterns` get auto-updated from live denials?
**No.** `denial_patterns` is populated once at startup via a static seed (22 CARC/VA patterns, routes.ts ~lines 453–468). No ERA ingestion path, 277CA processor, or CARC rules engine writes new rows.

### Does the prevention rules engine generate rules from real denial data?
**No.** The rules engine (`server/services/rules-engine.ts`) reads from:
- Seeded `denial_patterns` rows
- Seeded `carc_posting_rules`
- `payer_manual_extraction_items` (scraped payer policy docs)
- NCCI PTP edits table

It does not write new rules from live denial events.

### Is the "47 denials in the NPI category" clustering from live data?
Partially. Dashboard analytics (`GET /api/billing/analytics`, routes.ts ~line 4390) use `GROUP BY` SQL against live `claims` and `era_lines` data — so denial counts are real. However, the "clustering into categories" display appears to map to the seeded `denial_patterns` categories rather than dynamically discovered categories from live ERA CARC codes.

---

## f. Resubmission and Corrected Claim Flow

### What's the current resubmission path?

**Step 1:** User clicks "Fix This Claim" on the claim detail page → `POST /api/billing/claims/:id/mark-fixed` with `{resubmit: true}` (routes.ts lines 3996–4024)  
**What this does:**
- Validates claim is in `['denied', 'error', 'appeal_needed', 'review_needed']` status
- Sets `claims.status = 'submitted'`
- Writes `claim_events.type = 'Resubmitted'`

**What it does NOT do (DEMO BLOCKER DB-1):**
- Does NOT generate a new 837P
- Does NOT call Stedi
- The claim is now in `submitted` status with no actual EDI sent

**Step 2 (manual, not guided):** User must then navigate back and click "Submit to Stedi" again to actually send a new 837P. There is no UI prompt or automatic redirect to do this.

### Does the system enforce frequency code 7 on resubmission?
**No (DEMO BLOCKER DB-2).** The `claim_frequency_code` field exists in the schema and is passed through to the 837P generator. On resubmission, no code sets it to `'7'`. The user would need to manually edit the claim to change it before resubmitting. PGBA's companion guide requires frequency code 7 for replacement claims.

### Is `orig_claim_number` populated in REF*F8 on resubmissions?
The field exists in `claims.orig_claim_number` and is passed to `generate837P()` which emits `REF*F8*{orig_claim_number}` when present. However, population of this field is entirely manual — the resubmission flow does not auto-populate it with the original `stedi_transaction_id` or claim control number.

---

## g. UI Visibility Gaps

| Post-submission event | Claim detail page | Dashboard | Notification / badge |
|---|---|---|---|
| Submission accepted (Stedi) | ✅ Timeline event "Submitted via Stedi" + transaction ID field | ✅ Status changes to `submitted` | Toast in UI after user action |
| Submission failed (Stedi edge reject) | ✅ Timeline event "Submission Failed" with error notes | ❌ Status unchanged | ❌ No notification |
| 277CA received (webhook) | ✅ Timeline event "277CA Received" (gray styling — DB-3) | ❌ No update | ❌ No notification |
| 277CA received (polling — silent) | ✅ Timeline event written | ❌ No update | ❌ No notification |
| ERA received (webhook) | ✅ "ERA Adjustment" events per CARC (gray styling — DB-3) | ❌ No update | ❌ No notification |
| ERA available for posting | ✅ ERA Posting page lists pending batches | ❌ No badge | ❌ No notification |
| Payment posted (manual) | ✅ Timeline "Payment" event | ✅ Claim goes to `paid` | ❌ No notification |
| Denial received (CARC rule) | ✅ Timeline "ERA Adjustment" with CARC notes | ✅ Status changes | ❌ No notification |
| Resubmission | ✅ Timeline "Resubmitted" | ✅ Status back to `submitted` | ❌ No notification |

**Events that fire server-side with no UI surface:**
- Stedi submission failure (status not updated — only a timeline event)
- Polling-based 277CA / 835 arrivals — no badge, no toast, no email; user only sees if they open the claim detail
- `"277CA Received"` and `"ERA Adjustment"` events render with wrong styling (gray)

---

## h. Stubs and TODOs

| Item | Location | Status | Demo risk |
|---|---|---|---|
| `rejectionCodeLookup` service | `server/data/pgba_rejection_codes.json` exists; no `.ts` service wraps it | Not implemented — JSON exists, no importer | Low (enrichment only) |
| Denial pattern auto-update from live ERA | No code path | Not implemented | Low (analytics only) |
| Resubmission → re-send to Stedi | `mark-fixed?resubmit=true` route (routes.ts line 4009) | Stub — sets status only | **HIGH — DB-1** |
| Frequency code 7 enforcement | `mark-fixed` route | Not implemented | **HIGH — DB-2** |
| Timeline event type styling | `claim-timeline.tsx` eventConfig | Missing entries | **MEDIUM — DB-3** |
| 999 functional acknowledgment parsing | Stedi API response handled | Not parsed — only `transactionId` and `status` string extracted | Low — Stedi handles this |
| `suspended` status trigger | Schema + UI + dashboard SQL | No handler sets it | Low |
| `error` status trigger | Allowed in resubmit guard (routes.ts line 4004) | No handler sets it | Low |
| `orig_claim_number` auto-population | Resubmission flow | Not auto-populated | Medium (manual workaround exists) |
| Payment field updates on CARC auto-post | `applyCARCRules()` (stedi-webhooks.ts lines 263–328) | Only `claims.status` updated; `paid_amount`, `patient_responsibility_amount` not written | Medium (ERA Posting page shows $0 until manual post) |
| User notification on silent polling events | All polling jobs | Not implemented — no email/badge/toast | Medium |

---

## Summary: What Breaks If a Real Demo Claim Gets a Real Denial Back

1. **Denial arrives via 277CA** — Claim status updates to `rejected`, timeline shows "277CA Received" (gray). Visible on claim detail only. No alert fires. ✅ Functionally OK.

2. **Denial arrives via 835 ERA** — `applyCARCRules()` updates status to `appeal_needed` / `review_needed`. Timeline shows "ERA Adjustment" (gray). ERA appears in ERA Posting page. ✅ Functionally OK, cosmetically rough.

3. **User tries to fix and resubmit** — Status set to `submitted` but NO new 837P sent to Stedi. Claim is stuck in `submitted` with no actual transmission. **❌ BREAKS the demo end-to-end if resubmission is shown.**

4. **Resubmitted 837P (if user clicks Submit again)** — Goes out with frequency code 1 and no `orig_claim_number` unless user edited both manually. **❌ PGBA will reject this as a duplicate, not a corrected claim.**
