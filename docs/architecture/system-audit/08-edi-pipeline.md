# 08 — EDI Pipeline

## 837P generation

**File:** `server/services/edi-generator.ts` (705 lines).

### PGBA VA CCN constants (`edi-generator.ts:11-36`)

| Constant | Value | Citation |
|---|---|---|
| `PGBA_RECEIVER_TAX_ID` | `841160004` (Region 4) | PGBA 837P CG v1.0, Table 6, p.15 |
| `PGBA_REGION_5_TAX_ID` | `841160005` | same |
| `PGBA_RECEIVER_NAME` | `PGBA VACCN` (no space) | Decision: Abeer 2026-05-01 — Appendix B working sample is authoritative when it conflicts with Table 6. (`edi-generator.ts:18-23`) |
| `PGBA_RECEIVER_ID_QUALIFIER` | `46` (ETIN) | Table 6, p.15 |
| `PGBA_PAYER_ID` | `TWVACCN` | Table 6, p.16 |
| `PGBA_PAYER_ID_QUALIFIER` | `PI` | Table 6, p.16 |

### NM1 qualifier lookup (`edi-generator.ts:43-57`)

Single source of truth for NM108 across all 837P NM1 emissions. Keyed by NM101 ("41" submitter, "40" receiver, "85" billing, "87" pay-to, "82" rendering, "77" service facility, DN referring, DK ordering, "71" attending, "72" operating, IL subscriber, QC patient, PR payer). Comment: "never hardcode qualifiers inline."

### Diagnosis pointer canonicalization (`edi-generator.ts:69-90+`)

`serializeDiagnosisPointer(raw)` — accepts:
- Letters A-L (CMS-1500 Box 21 order, 1-4 per line)
- Numerics 1-12
- Colon-separated composites "A:B" / "1:2"
- Compact multi-char "AB" → "1:2"

Returns colon-separated numeric per X12 5010 SV107. **Re-exported from `routes.ts:29` as `diagPointerToNumeric`**, which is just a wrapper (`routes.ts:164-166`) — comment: "All generate837P call sites must use this wrapper to ensure A2-compliant serialization."

## Stedi submission

**File:** `server/services/stedi-claims.ts` (397 lines).

### Endpoints

```
POST https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/professionalclaims/v3/raw-x12-submission
GET  https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/claims/reports
```

(`stedi-claims.ts:7-10`). Comment notes the structured-JSON `/v3/submission` endpoint **rejects raw EDI** with HTTP 500 — only `raw-x12-submission` accepts `{ x12: "ISA*..." }`.

### Submit path (`stedi-claims.ts:76-167`)

1. **Automated-agent gate (Task 5)** — `isAutomatedContext()` from `lib/environment.ts` returns true unless caller passes `hasUserSession=true` (and headers don't indicate a bot/agent UA). If automated:
   - require `STEDI_AUTOMATED_TEST_MODE=true` (else throw `AutomatedSubmissionBlocked`)
   - require ISA15='T' (else throw)
2. **ISA15 read (Task 1)** — parses ISA15 directly from EDI bytes via regex (`stedi-claims.ts:67-74`). Refuses to fire if unparseable (returns `blockedBy: 'claimshield'`). Comment: this exists because the prior code "would silently upgrade T → P" — the root cause of the Megan Perez production miss-fire (`stedi-claims.ts:108-111`).
3. **POST** with `Authorization: Key <STEDI_API_KEY>`, `Idempotency-Key: <claimId>`, body `{ x12: ediContent }`.
4. **Response shape** — extracts `claimReference.correlationId | rhclaimNumber` as `transactionId`; `customerClaimNumber | patientControlNumber` as `controlNumber`. `accepted` iff HTTP 200.
5. **Error shape** — `{ success: false, blockedBy: 'stedi'|'claimshield', error, validationErrors[], rawResponse }`.

### Test path (`stedi-claims.ts:169-243`)

`testClaim()` **forces ISA15='T'** via regex before submission (`stedi-claims.ts:178-183`). Comment: "this is the only endpoint that may safely mutate ISA15, and it can only ever downgrade P→T, never T→P."

Returns structured `validationErrors` array with `{code, message, segment, field}` shape (`stedi-claims.ts:226-231`).

### Polling (`stedi-claims.ts:245-347`)

- `poll277Acknowledgments(since?)` — GETs `/claims/reports?transactionSetType=277&startDate=...`. 404 → empty.
- `poll835ERA(since?)` — same with `transactionSetType=835`. Maps via `parseERAResponse()`.

### Status code map (`stedi-claims.ts:349-357`)

```
1 → "Accepted"
3 → "Accepted with Changes"
4 → "Rejected — Payer did not accept"
5 → "Payer acknowledgment pending"
```

## 277CA processing (webhook + manual)

**File:** `server/services/stedi-webhooks.ts:45+`. `process277CA(data, transactionId, db)`:

- Extracts `claimControlNumber`, `statusCategoryCode`, `statusCode` (PGBA business edit), `payerClaimControlNumber` from multiple possible response shapes (`stedi-webhooks.ts:58-83+`).
- Enriches with `enrichStatusNotes` from `services/rejectionCodeLookup.ts` (`stedi-webhooks.ts:50`).
- The payer claim number is required for REF*F8 on resubmission (CLM05-3=7).
- **UNVERIFIED:** persistence path (rest of file not read this session — covers DB writes to `claim_events` (507 rows)).

## 835 ERA processing

**File:** `server/services/stedi-claims.ts:359-396` (`parseERAResponse`).

Output shape:
```ts
{ eraId, checkNumber, checkDate, payerName, totalPayment,
  claimLines: [{ claimControlNumber, patientName, billedAmount,
    allowedAmount, paidAmount,
    adjustments: [{ code: "<group>-<reason>", amount, reason }] }],
  rawData }
```

Persistence into `era_batches` / `era_lines` is via the upload route (`routes.ts:12715`) and the polling job — **UNVERIFIED specific insert sites**.

## Office Ally fallback

`server/services/office-ally.ts` — SFTP submission via `OA_SFTP_HOST`, `OA_SFTP_USERNAME`, `OA_SFTP_PASSWORD` (`_queries/21_code_inventory.txt:263-265`). Routes:
- `POST /api/billing/test-oa-connection` (`routes.ts:6168`)
- `POST /api/billing/claims/:id/submit-oa` (`routes.ts:6190`)

Used as an alternative carrier path when Stedi is unavailable; **UNVERIFIED** whether it shares the same ISA15 guard as the Stedi path.

## EDI parser

**File:** `server/services/edi-parser.ts` — handles **inbound** 835 / 277 file uploads (vs the polling JSON path). Used by `/api/billing/eras/upload` (`routes.ts:12715`). **UNVERIFIED** in detail this session.

## Environment toggles affecting EDI

From `server/lib/environment.ts:13` and call sites:
- `NODE_ENV` and `STEDI_ENV` jointly drive `resolveISA15()` (default-T in non-prod, default-P in prod).
- `STEDI_AUTOMATED_TEST_MODE` — enables automated test submissions (T-only).
- `X_AUTOMATED_AGENT` header — additional bot signal for `isAutomatedContext`.
- `STEDI_API_KEY` — gate for all calls; lack of key throws.
- `STEDI_WEBHOOK_SECRET` — incoming webhook signature.
