# Stedi Webhook Handler Audit
**Date**: 2026-05-01  
**File**: `server/routes.ts`, lines 12690–12780  
**Support file**: `server/services/stedi-webhooks.ts` (`fetchStediTransaction`, `process277CA`, `process835ERA`)  
**Scope**: 7 verification points from Abeer's webhook audit spec

---

## Findings Summary

| # | Point | Status | Severity |
|---|---|---|---|
| 1 | AUTH | ❌ Two issues (see below) | CRITICAL |
| 2 | TIMEOUT ARCHITECTURE | ✅ Acknowledge-first pattern correctly implemented | — |
| 3 | DISPATCH | ⚠️ Correct for `transaction.processed.v2`; `file.delivered.v2` not yet handled | LOW |
| 4 | DATA RETRIEVAL | ✅ Correct endpoint URL and auth format | — |
| 5 | PAYER CLAIM NUMBER CAPTURE | ✅ Implemented in previous session | — |
| 6 | IDEMPOTENCY | ✅ `webhook_events` table with PRIMARY KEY on `event_id` | — |
| 7 | NEW BINDINGS | ⚠️ `file.failed.v2` — branch exists, timeline write missing. `file.delivered.v2` — no handler branch | MEDIUM |

**Code changes made**: Items 1 (auth), 7a (file.failed timeline), 7b (file.delivered branch). All changes are in `server/routes.ts` lines 12690–12780.

---

## 1. AUTH

### Finding — Two issues

**Issue A — Auth runs AFTER the 200 response (FIXED)**  
File: `server/routes.ts` lines 12691–12704 (before fix)  

```typescript
app.post("/api/webhooks/stedi", async (req, res) => {
  res.status(200).json({ received: true });    // ← 200 sent here

  setImmediate(async () => {                   // ← auth check deferred to here
    const webhookSecret = process.env.STEDI_WEBHOOK_SECRET;
    const authHeader = req.headers['authorization'];
    if (webhookSecret && authHeader !== `Key ${webhookSecret}`) {
      console.warn('[Webhook] Unauthorized — bad secret');
      return;  // ← too late — Stedi already got 200
    }
```

The 200 was returned unconditionally before auth was even checked. Stedi (or any other caller) sees 200 regardless of whether the secret is correct. The `return` in `setImmediate` prevents payload processing, but the response code is already gone.

**Fix**: Auth check moved to BEFORE `res.status(200)`. If auth fails, returns `401` synchronously. Then 200 is sent. Then `setImmediate` fires. No auth check needed inside setImmediate.

**Issue B — `STEDI_WEBHOOK_SECRET` is empty in `.env` (NOT fixed by code — requires secret config)**  
The `.env` file contains `STEDI_WEBHOOK_SECRET=` (empty string). An empty string is falsy in JavaScript. The guard `if (webhookSecret && authHeader !== ...)` evaluates to `false` when the secret is empty — auth is completely bypassed. ALL requests to `/api/webhooks/stedi` are accepted with no validation.

**Action required from Abeer**:  
1. In the Stedi portal, find the `claimshield-webhook-auth` credential under Manage credentials. The credential type is "API Key" — the header name Stedi sends is `Authorization` (confirmed by the code reading `req.headers['authorization']`).  
2. Copy the secret value and add it to Replit's environment secrets as `STEDI_WEBHOOK_SECRET`.  
3. Once set, the auth check at the top of the handler will enforce it and reject non-Stedi requests with 401.

**After the fix, the behavior is**:
- No `STEDI_WEBHOOK_SECRET` set → logs a warning on every request, processes all (current behavior — avoids lockout before secret is configured)
- `STEDI_WEBHOOK_SECRET` set → requests with wrong/missing header get `401 Unauthorized` immediately, processing is skipped, rejection is logged

---

## 2. TIMEOUT ARCHITECTURE

### Finding — ✅ Acknowledge-first pattern correctly implemented

**Architecture (lines 12691–12779)**:
```
→ POST /api/webhooks/stedi arrives
  1. [SYNC] Auth check — returns 401 if bad secret (post-fix)
  2. [SYNC] res.status(200).json({ received: true }) ← Stedi's timeout clock stops here
  3. setImmediate(async () => {
       // everything below runs asynchronously, never blocks Stedi's 5s window
       4. DB import + body parse
       5. eventId extraction
       6. idempotency check: SELECT from webhook_events
       7. INSERT into webhook_events
       8. dispatch on detailType
       9. fetchStediTransaction() ← network call to Stedi report API
      10. process277CA() or process835ERA() ← DB writes
     })
```

`setImmediate` defers ALL processing to the next event loop tick, after the HTTP response is flushed. Stedi's 5-second clock sees a 200 immediately and closes the connection. Steps 4–10 run after that — no timeout risk regardless of Stedi API latency.

**Caveat — process restart risk**: If the server process is killed after step 2 (200 sent) but before step 7 (idempotency write), Stedi will retry after 90 seconds. Because `webhook_events` wasn't written yet, the retry will be processed normally. This is the correct behavior — no data loss. The four Stedi retries provide replay coverage.

---

## 3. DISPATCH

### Finding — ✅ Two-stage dispatch correctly structured; one gap

**Stage 1 — `detail-type` dispatch** (`routes.ts` lines 12708–12774, post-fix):

| `detail-type` value | Handler | Timeline event written? |
|---|---|---|
| `file.failed.v2` or contains `file.failed` | Line 12739 | ✅ "Delivery Failed" (after fix) |
| `file.delivered.v2` | Line 12744 (new, after fix) | ✅ "Delivered to Payer" (after fix) |
| `transaction.processed.v2` | Falls through to stage 2 | — |
| anything else | Line 12763: log "Ignoring event type", return | No |

**Stage 2 — `transactionSetIdentifier` dispatch** (`routes.ts` lines 12779–12787):

| `transactionSetIdentifier` | Handler | File |
|---|---|---|
| `"277"` | `process277CA(data, transactionId, db)` | `server/services/stedi-webhooks.ts` line 45 |
| `"835"` | `process835ERA(data, transactionId, db)` | `server/services/stedi-webhooks.ts` line 172 |
| anything else | `console.log('[Webhook] Unknown set:', transactionSetIdentifier)` | — |

`transactionSetIdentifier` is extracted from: `detail?.x12?.metadata?.transaction?.transactionSetIdentifier || detail?.transactionSetIdentifier` (lines 12715–12717). The `OUTBOUND` guard at line 12755 fires before the inner dispatch — outbound 837P transactions are silently skipped (correct).

---

## 4. DATA RETRIEVAL

### Finding — ✅ Correct endpoint and auth format

**Function**: `fetchStediTransaction(transactionId, type)` — `server/services/stedi-webhooks.ts` lines 5–43

**Endpoint URL**:
```
GET https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/claims/reports/{transactionId}
```

**Auth header**:
```
Authorization: Key {STEDI_API_KEY}
```
Source: `stedi-webhooks.ts` lines 14, 18. Format matches Stedi's documented authentication format.

**Same function handles both 277 and 835** — the `transactionType` parameter is used only for logging; the URL structure is the same for both. Stedi returns the correct report type based on the transaction ID itself.

**Poll endpoints** (separate from webhook retrieval): `poll277Acknowledgments()` and `poll835ERA()` in `stedi-claims.ts` both use `https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/claims/reports` with `?transactionSetType=277` or `?transactionSetType=835`.

---

## 5. PAYER CLAIM NUMBER CAPTURE

### Finding — ✅ Implemented (previous session)

**Column**: `claims.payer_claim_number VARCHAR`  
**Seeder**: `routes.ts` line 1360–1362 — confirmed added (`[SEEDER] column claims.payer_claim_number: adding` in startup log)

**Extraction** in `process277CA()` (`stedi-webhooks.ts` lines 81–87):
```typescript
const payerClaimNumber: string | null =
  claimStatus?.claimReference?.payerClaimControlNumber ||
  claimStatus?.claimReference?.claimControlNumber ||
  claimStatus?.payerClaimControlNumber ||
  claimStatus?.claimInformation?.payerClaimControlNumber ||
  null;
```

**Persistence** (`stedi-webhooks.ts` lines 128–137): `UPDATE claims SET payer_claim_number = $1 WHERE id = $2` when `payerClaimNumber` is non-null. The column-add guard also runs here for safety.

**Consumer**: `mark-fixed?resubmit=true` — validates `c.payer_claim_number` is set (400 if null), passes it as `orig_claim_number` to `generate837P()` which emits `REF*F8*[value]`. `claim_frequency_code` is hardcoded to `"7"` on every resubmission path.

---

## 6. IDEMPOTENCY

### Finding — ✅ Correctly implemented

**Table**: `webhook_events` — seeded at `routes.ts` lines 1285–1295:
```sql
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id VARCHAR PRIMARY KEY,   ← unique constraint
  event_type VARCHAR,
  transaction_id VARCHAR,
  transaction_set VARCHAR,
  processed_at TIMESTAMP DEFAULT NOW(),
  status VARCHAR DEFAULT 'processed'
)
```

**Check pattern** (`routes.ts` lines 12724–12737):
```typescript
// 1. Check before processing
const existing = await db.query(
  'SELECT event_id FROM webhook_events WHERE event_id=$1', [eventId]
);
if (existing.rows.length > 0) {
  console.log(`[Webhook] Duplicate event ${eventId}, skip`);
  return;
}

// 2. Insert (ON CONFLICT DO NOTHING for race safety)
await db.query(
  'INSERT INTO webhook_events (event_id, ...) VALUES ... ON CONFLICT DO NOTHING',
  [eventId, ...]
);
```

**Event ID source** (line 12707): `eventObj?.id || eventObj?.detail?.transactionId`  
Stedi's top-level `event.id` (UUID) takes priority — this is what Stedi recommends. The `transactionId` fallback covers older payload formats.

**Minor race note**: Two simultaneous deliveries with the same `event_id` could both pass the `SELECT` check before either completes the `INSERT`. The `ON CONFLICT DO NOTHING` on the insert prevents both from writing, but both could proceed to call `process277CA()` or `process835ERA()`. The DB operations inside those functions are idempotent (ERA batch uses `check_number` dedup at `stedi-webhooks.ts` line 180; 277CA uses `claim.status !== 'submitted'` guard). In practice, Stedi does not send two identical events simultaneously.

---

## 7. NEW BINDINGS

### Finding — Gaps fixed

**7a — `file.failed.v2`** (handler existed, timeline write missing → FIXED)

Before fix: the branch wrote to `system_settings` only. No claim was updated. No timeline event was visible.

After fix: when a `file.failed.v2` event arrives, the handler:
1. Extracts error messages from `detail.errors[]`
2. Tries to find a claim with `stedi_transaction_id` matching `detail.fileExecutionId` (best-effort — the file.failed.v2 payload doesn't include a patientControlNumber, so this is a probabilistic match)
3. If a claim is found: writes `"Delivery Failed"` event to `claim_events` with the error text
4. If no claim is found: writes to `system_settings` as before (preserves the existing alert behavior)
5. Logs the full detail object for debugging

**Limitation**: PGBA's file delivery failures may not include a `fileExecutionId` that directly maps to a `stedi_transaction_id`. If no match is found, the failure is logged to `system_settings` only — the claim timeline won't show the event. Stedi support may be needed to understand which field links the file event back to the original submission.

**7b — `file.delivered.v2`** (no handler existed → ADDED)

New branch added between the `file.failed` check and the `transaction.processed` check. When `file.delivered.v2` arrives:
1. Extracts `detail.fileExecutionId` and `detail.tradingPartnerIds[0]` (payer identifier)
2. Best-effort claim lookup by `stedi_transaction_id`
3. If found: writes `"Delivered to Payer"` event to `claim_events`
4. Logs receipt regardless

**Action required from Abeer**: Add the `file.delivered.v2` and `file.failed.v2` bindings in the Stedi portal, pointing to `https://[your-domain]/api/webhooks/stedi` (same destination URL, same credential). The handler branches are now ready to receive them.
