---
name: Stedi 277CA polling architecture
description: How the 277CA acknowledgment poll must work — common mistakes that cause silent failures.
---

# Stedi 277CA polling — correct architecture

## The rule

The list-transactions endpoint (`GET .../claims/reports?transactionSetType=277`) returns **file-level metadata only** — it does NOT include claim-level `statusCategoryCode` (A1/A2/A4…).

The correct poll flow:
1. List 277 transactions since last poll timestamp
2. For EACH transaction, call `fetchStediTransaction(transactionId, '277')` to get full detail
3. Pass the detail to `process277CA(detail, transactionId, db)` — same code path as the webhook

**Why:** `process277CA` already handles claim-level status mapping (A1→acknowledged, A2/A3→rejected, etc.) and uses the correct UUID prefix query. Running the poll through the same function means there is only one place to maintain the logic.

**How to apply:** Any new ingestion path for 277 data must go through `fetchStediTransaction` + `process277CA`, not try to read claim status from the list endpoint.

## Default lookback windows

- 277 poll: 90 days on first run (no saved `stedi_last_277_poll` in system_settings)
- 835 poll: 90 days on first run (no saved `stedi_last_835_poll` in system_settings)

Shorter windows (1 day, 7 days) cause new deployments to miss all existing transactions.

## Polling intervals

- 277CA: every 2 hours
- 835 ERA: every 4 hours
- Webhooks are primary; polling is the catch-up mechanism

## Manual sync

`POST /api/billing/stedi/sync` (admin/rcm_manager) runs both polls with optional `since` override. The ERA page has a "Sync from Stedi" button wired to this endpoint.
