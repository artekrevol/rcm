---
name: ERA 835 ingestion — durable rules
description: Structural rules for 835 ERA ingestion that prevent silent data loss across all ingestion paths.
---

# ERA 835 ingestion — durable rules

## Rules (apply to every ingestion path)

1. **Write ERA claim lines to `era_lines`** — not `era_claim_lines`. The UI, POST action, and "Post This ERA" button all read from `era_lines`. `era_claim_lines` is a dead table and should not be written to.

2. **Claim matching uses UUID prefix search** — see `clm01-format.md`. Never use `WHERE id = $1` with a raw control number from an 835 or 277 file.

3. **Clean ERAs must immediately update claim status to `paid`** — a clean ERA is: `paid_amount > 0` AND `adjustments.length === 0`. Do not gate the status update on the presence of adjustments; gating on `adjustments.length > 0` is wrong and causes fully-paid claims to stay in `submitted` forever.

**Why:** All three paths (Stedi webhook, background poll, manual upload) originally had all three bugs simultaneously, causing inbound ERAs to be invisible in the UI and claims to never reach `paid` status.

**How to apply:** Any new ingestion path for 835 data must: (a) write to `era_lines`, (b) use the UUID prefix query from `clm01-format.md`, and (c) include explicit clean-ERA `→ paid` status handling.
