---
name: Claim risk staleness contract
description: Stored risk scores are snapshots; every write path that changes rules-engine inputs must keep the staleness contract or claims show stale Blocked/RED.
---

## The rule
`claims.risk_score` / `readiness_status` / `last_risk_factors` are persisted snapshots of a rules-engine run, not live values. The staleness contract is: **a claim is stale when `last_risk_evaluation_at IS NULL OR updated_at > last_risk_evaluation_at`**. The shared helper (`evaluateAndPersistClaimRisk` in `server/services/claim-risk.ts`) is the only thing allowed to set `last_risk_evaluation_at`, and it sets both timestamps to `NOW()` in one statement so a fresh evaluation is never self-stale.

**Why:** A draft is scored at creation against an empty claim shell → always 100/RED (3 Tier-1 blocks × 40, capped). If the wizard's later re-score fails or is skipped, that 100/RED stuck forever, showing a "Blocked" banner while a separate heuristic explanation claimed 97% confidence — a visible contradiction on a real production claim.

**How to apply:**
- Any new endpoint that mutates rules-engine inputs (service lines, dx, payer, auth number, plan product, PCP referral status, service date, POS) must either call the helper or at minimum set `updated_at = NOW()` so the GET self-heal catches it. Silent column updates (no `updated_at` bump) make the stale score undetectable.
- Never persist `last_risk_evaluation_at` without also persisting the score/status from the same evaluation (the preflight route once did this and could mask a stale score).
- GET claim detail lazily self-heals stale pre-submission claims (draft/created/ready). Post-submission statuses are deliberately untouched.
- The separate "Why this decision?" heuristic explanation (`getRiskExplanation` in storage.ts) must fold in stored block factors, or its confidence number will contradict the blocked banner again.
