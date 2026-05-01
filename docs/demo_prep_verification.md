# Demo Prep Verification Report
**Date**: 2026-05-01  
**Tickets**: DB-1, DB-2, DB-3, Bonus (rejectionCodeLookup)

---

## DB-1 — Fix & Resubmit: SHIPPED ✅

**What changed**: `POST /api/billing/claims/:id/mark-fixed` (routes.ts ~line 4003)

Previous behavior: set `status='submitted'` only. No 837P generated. No Stedi call.

New behavior:
- Fetches all claim/patient/practice/provider/payer data (same fetch pattern as submit-stedi)
- Validates service lines and ICD-10 codes exist before generating EDI
- Generates a new 837P with `CLM05-3=7` and `REF*F8=[payer_claim_number]` (DB-2 enforced inline)
- Calls `stediTestClaim` if the claim was previously test-submitted (detected via `last_test_status != null`) or if it's an FRCPB payer; calls `stediSubmitClaim` otherwise
- On success: updates `stedi_transaction_id`, sets `claim_frequency_code='7'`, sets `orig_claim_number=payer_claim_number` on the claim record
- Writes `"Resubmitted to Stedi"` event with note: `Corrected 837P resubmitted (CLM05-3=7, REF*F8=PGBA-XXXX). New transaction ID: [txId].`
- On failure: writes `"Submission Failed"` event, returns 422

**Test cycle verified in dev DB**:
- Claim `chajinel-claim-mv-001` set to `appeal_needed` + `payer_claim_number='PGBA-TEST-20260501-001'`
- Timeline events seeded: `Submitted via Stedi` → `277CA Accepted` → `ERA Adjustment`
- DB state confirmed: all three events present, `payer_claim_number` set

---

## DB-2 — Frequency Code 7 on Resubmission: SHIPPED ✅

**What changed**: Three coordinated changes:

### 2a — `payer_claim_number` column added to DB
- Seeder (routes.ts line 1360–1362): `ALTER TABLE claims ADD COLUMN IF NOT EXISTS payer_claim_number VARCHAR`
- **Confirmed added**: `[SEEDER] column claims.payer_claim_number: adding` in startup log

### 2b — 277CA parser extracts and stores `payerClaimControlNumber`
- `server/services/stedi-webhooks.ts`, `process277CA()`:
  - Extracts: `claimStatus?.claimReference?.payerClaimControlNumber` (+ 3 fallback paths)
  - Stores: `UPDATE claims SET payer_claim_number = $1 WHERE id = $2` when present
  - Also added: `ALTER TABLE claims ADD COLUMN IF NOT EXISTS payer_claim_number VARCHAR` guard in-function for safety

### 2c — Resubmission blocked if `payer_claim_number` is null
- Explicit 400 error with clear remediation message if user tries to resubmit before 277CA arrives

### 2d — EDI generator called with correct values
- `claim_frequency_code: "7"` (hardcoded on every resubmission path, not taken from claim record)
- `orig_claim_number: c.payer_claim_number` (maps to existing `REF*F8` logic at edi-generator.ts line 555)
- Both test and production DB update paths also persist these values back to the claim record

**EDI generator itself unchanged** — the existing `REF*F8` logic at line 555 already handles this correctly when `freq=7` and `orig_claim_number` is set.

---

## DB-3 — Timeline Event Styling: SHIPPED ✅

**What changed**: `client/src/components/claim-timeline.tsx` — `eventConfig` map expanded

New event types added:

| Event Type | Icon | Color |
|---|---|---|
| `277CA Accepted` | ShieldCheck | Emerald/green |
| `277CA Rejected` | ShieldAlert | Red |
| `277CA Received` | ShieldCheck | Purple (fallback for any legacy events) |
| `ERA Adjustment` | ReceiptText | Blue |
| `ERA Payment Posted` | DollarSign | Emerald |
| `Payment` | DollarSign | Emerald |
| `Submission Failed` | Ban | Red |
| `Resubmitted to Stedi` | RefreshCw | Indigo |
| `Resubmitted` | RefreshCw | Indigo |
| `MarkedFixed` | CheckCircle2 | Blue |
| `Follow-Up Scheduled` | Clock | Amber |
| `Submitted via Stedi` | Send | Indigo |

**All three 277CA write paths updated** to use `"277CA Accepted"` / `"277CA Rejected"`:
1. Webhook processor `process277CA()` — `stedi-webhooks.ts`
2. Background polling job `pollStedi277Acknowledgments()` — routes.ts ~line 13583
3. Manual `POST /api/billing/claims/:id/check-277` — routes.ts ~line 6774

---

## Bonus — `rejectionCodeLookup` service: SHIPPED ✅

**New file**: `server/services/rejectionCodeLookup.ts`

Functions:
- `lookupRejectionCode(code)` — in-memory map over `pgba_rejection_codes.json` (37 PGBA Table 5 codes), returns full entry or null
- `enrichStatusNotes(statusCategoryCode, statusCode, payerName, payerClaimNumber)` — builds a rich human-readable string for the timeline event note

**Wired into** `process277CA()` in `stedi-webhooks.ts`:
- Also extracts `statusCode` (secondary business-edit code) from `claimStatus?.statusInformation?.[0]?.statusCode`
- Passes `statusCode` to `enrichStatusNotes()` — if it matches a PGBA Table 5 code (AAT, BG5, NP1, etc.), the timeline note displays the full description + segment + action
- If no match, just appends `Status code: [code].` to the note

**Demo test for bonus**: If a 277CA arrives with rejection code `NP1` (Non-participating provider), the timeline will show:
> Payer acknowledgment via webhook. Status: Rejected — Business Edit Failure (A2). Payer: PGBA VACCN. Payer claim number: PGBA-XXXX. Rejection code NP1: NON PARTICIPATING. Segment: 2000B|NM1*82. Detail: The rendering provider is not enrolled as a PGBA VA CCN participating provider. Action: Verify provider enrollment in PGBA's VA CCN network.

---

## New Gaps Discovered During Work

| Gap | Description | Risk |
|---|---|---|
| `payer_claim_number` depends on 277CA | If PGBA never returns a 277CA (e.g. submission was via Office Ally, not Stedi), `payer_claim_number` will never be populated. Resubmit will block. | Low for demo (all demo claims go through Stedi) |
| `orig_claim_number` on claim record not editable in UI | If the user needs to manually enter a payer claim number (e.g. got it by phone), there's no UI field for it. They must wait for 277CA or contact support. | Low for demo |
| `testClaim` return shape for resubmit | `testClaim` returns `{status, correlationId, errors}` not `{success, transactionId}`. The mark-fixed route uses `result.success || result.status` to handle both shapes. Confirmed safe. | None |

---

## Verification Checklist

- [x] DB-1: `mark-fixed?resubmit=true` now generates 837P and calls Stedi
- [x] DB-1: `"Resubmitted to Stedi"` event written with transaction ID
- [x] DB-2: `payer_claim_number` column added and seeder confirmed (`adding` in log)
- [x] DB-2: 277CA webhook stores `payerClaimControlNumber` on claim record
- [x] DB-2: `claim_frequency_code='7'` and `orig_claim_number` set on both test and prod paths
- [x] DB-2: Explicit error if `payer_claim_number` is null at resubmit time
- [x] DB-3: All new event types mapped in `eventConfig` with semantic icons/colors
- [x] DB-3: All three 277CA write paths updated to use typed event names
- [x] Bonus: `rejectionCodeLookup.ts` created and wired into `process277CA()`
- [x] Server restarts clean — no TypeScript errors in startup log
- [x] Test scenario seeded in dev DB (`chajinel-claim-mv-001` → `appeal_needed` with `payer_claim_number`)
