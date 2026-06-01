---
name: ERA 835 ingestion bugs
description: Three structural bugs in the 835 ERA pipeline that caused ERAs from Stedi to be invisible in the UI and claims to never update to 'paid'.
---

# ERA 835 ingestion bugs

## The rules

1. **Always write era claim lines to `era_lines`** (not `era_claim_lines`). The UI, the POST action, and the "Post This ERA" button all read from `era_lines`. `era_claim_lines` is a dead table populated only by the old webhook path.

2. **Claim matching uses UUID prefix search** — see `clm01-format.md`. Never use `WHERE id = $1` with a raw control number from an 835 file.

3. **Clean ERAs (no CARC adjustments, paid_amount > 0) must update claim status to 'paid' immediately** — do not gate on `adjustments.length > 0`. The `applyCARCRules()` guard was the root cause of fully-paid claims staying in 'submitted' forever.

**Why:** The three paths (Stedi webhook, poll, manual upload) all had all three bugs simultaneously. TriWest check 5481337145VT6 for Seawright/Ronald W ($5,928, 13×G0156 lines, Status Code 1) arrived via Stedi and was invisible because: lines went to wrong table, orgId resolved to null (matching broken), and no status update fired (clean ERA guard).

**How to apply:** Any new ingestion path for 835 data must use `era_lines`, the UUID prefix query, and explicit clean-ERA status handling.
