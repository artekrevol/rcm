# ClaimShield — Phase 3 Sprint 1c: EDI Route → evaluateClaim Wire-In

This sprint closes the gap surfaced in `docs/architecture/sprint1a-audit-report.md §5` and tracked in `docs/architecture/migration-state.md §8.4`: the two stedi submission routes (`POST /api/billing/claims/:id/submit-stedi` at `routes.ts:6348` and `POST /api/billing/claims/:id/test-stedi` at `routes.ts:6623`) call `generate837P` directly without going through `evaluateClaim`. Sprint 1a wired Tier 1 into `evaluateClaim`; sprint 1c routes the EDI submission paths through it so structurally broken claims are rejected before EDI generation instead of being passed to Stedi for rejection there.

This is a server-side change only. No UI changes. No frontend changes. No data migration. No new tables, columns, or schema changes. The only behavior change a user can observe is that a structurally broken claim returns a Tier 1 finding code via the API instead of triggering a Stedi rejection downstream.

## Anchors from prior sprints

These facts are confirmed in `docs/architecture/sprint1a-audit-report.md`, `docs/architecture/sprint0-audit-report.md`, and `docs/architecture/phase3-prod-deploy-audit-report.md`:

- Tier 1 validator at `server/services/rules-engine/tier1-structural-integrity.ts`. Pure function `validateTier1Structural(input)` returning `Tier1Finding[]`. Eight rules T1-001 through T1-008 (sprint0-audit:§2.7).
- Adapter at `server/services/rules-engine/tier1-adapter.ts` maps the legacy claim shape to Tier 1's input shape (sprint1a-audit:§4).
- `evaluateClaim` in `server/services/rules-engine.ts` calls `validateTier1Structural` first via the adapter, short-circuits on blocking findings (sprint1a-audit:§4).
- The two stedi submission routes (`routes.ts:6348`, `:6623`) call `generate837P` in `server/services/edi-generator.ts` directly, with no rule-engine call between them (sprint1a-audit:§5).
- Tier 1 short-circuit returns `{ findings, shortCircuited: true, shortCircuitReason: 'tier1-structural-blocking' }` per the integration in sprint 1a (sprint1a-audit:§4).
- All Phase 3 architecture is live in production (`phase3-prod-deploy-audit-report.md`).

## What this sprint is

1. Pre-flight: snapshot, baseline verification.
2. Discovery (read-only): map the current call chain in both stedi routes — what's called, in what order, what error patterns exist for validation failures elsewhere in `routes.ts` (so the new gate matches existing conventions).
3. Add a `requireTier1Pass(claimId)` helper or equivalent inline check in both routes, calling `evaluateClaim` and inspecting findings before `generate837P` runs.
4. On Tier 1 blocking failure, return an error response matching the existing route's validation-failure pattern (discovered in step 2). Include the Tier 1 finding codes and messages so the caller can display them.
5. On Tier 1 pass, proceed to `generate837P` as today.
6. Tests verifying the gate fires correctly.
7. Verification, smoke, audit report.

## What this sprint is NOT

- No UI changes. The frontend may need to render Tier 1 finding messages in a future sprint, but sprint 1c only changes the API response.
- No changes to `evaluateClaim`'s signature or Tier 1's signature. Both are stable from sprint 1a.
- No changes to `generate837P` itself. The gate happens before generate837P is called; generate837P is unchanged.
- No changes to the legacy rule evaluation paths (CCI, payer-specific). Sprint 1c only gates on Tier 1.
- No payer dropdown work (sprint 1d).
- No Vapi cascade-scope validation (separate operational checklist).
- No production deploy. Sprint 1c lands in dev. Production deploy of sprint 1c happens in a separate task after sprint 1c is verified clean in dev.

If a step seems to require touching the frontend, the EDI generator's internals, or any non-stedi route, stop and flag.

---

## Hard rules

1. Take a database snapshot before any code change. Save the path in the audit report.
2. The two stedi routes (`routes.ts:6348` and `:6623`) are the ONLY routes modified in this sprint.
3. The gate uses `evaluateClaim` — not a direct call to `validateTier1Structural`. Going through `evaluateClaim` ensures consistency with sprint 1a's wiring and lets future tier wire-ins automatically apply to the EDI path.
4. The error response shape MUST match the existing route's validation-failure pattern. Discovery step 2 finds that pattern; the gate uses it. Inventing a new error shape creates inconsistency.
5. The gate runs BEFORE `generate837P` is invoked. If the existing route does any work between claim load and generate837P (logging, audit trail, status updates), the gate runs after that work but before generate837P. Document the precise insertion point.
6. The gate is unconditional. No feature flag. Same reasoning as sprint 1a's wire-in: this is closing a defect, not introducing optional behavior.
7. Standing order: dev only. No production deploy as part of this sprint.

---

## Step 1 — Pre-flight

### 1a. Snapshot

```bash
pg_dump --no-owner --no-privileges $DATABASE_URL > docs/architecture/sprint1c-snapshots/dev-pre-sprint1c-$(date -u +%Y%m%d-%H%M%SZ).sql
```

Add `docs/architecture/sprint1c-snapshots/` to `.gitignore` if not already covered.

### 1b. Baselines must be green

```bash
npx tsx scripts/verify-tenant-isolation.ts                              # 12/12
npx tsx server/services/rules-engine/tier1-structural-integrity.test.ts # 16/16
npx tsx server/services/rules-engine.test.ts                            # 4/4 from sprint 1a
npx tsx server/services/voice-persona-builder.test.ts                   # 8/8 from sprint 1b
npx tsx scripts/smoke-helpers.ts                                        # green
npx tsc --noEmit                                                        # clean
```

If any baseline fails, stop and flag.

Document baselines in `docs/architecture/sprint1c-audit-report.md §1`.

---

## Step 2 — Discovery (read-only)

### 2a. Read both stedi routes end to end

`routes.ts:6348` — `POST /api/billing/claims/:id/submit-stedi`. Read 50 lines before through 100 lines after the route handler entry. Document:

- The exact handler function signature
- What the handler does in order: auth check, claim load, any pre-checks, EDI generation, Stedi submission, response shaping
- Where `generate837P` is called (line number)
- What variables hold the claim object at the point of EDI generation (need this for the gate's input)
- Any try/catch or error shaping logic

`routes.ts:6623` — `POST /api/billing/claims/:id/test-stedi`. Same depth of read, same documentation.

### 2b. Find the existing validation-failure pattern

Search `routes.ts` for how OTHER billing routes return validation failures:

```bash
grep -n "res.status(400\|res.status(422\|return res.json.*errors\|return res.json.*findings" server/routes.ts | head -30
```

Look at 3-5 matches. What's the standard shape of a 4xx validation response in this codebase? Examples: `{ error: "...", details: [...] }`, `{ findings: [...], status: "validation_failed" }`, etc.

Document the pattern in `sprint1c-audit-report.md §2`. The new gate uses this pattern.

### 2c. Read evaluateClaim's exact return shape

Open `server/services/rules-engine.ts`. Read the function. Document:

- The exact return type of `evaluateClaim`
- How short-circuit findings are flagged in the return (per sprint 1a, `shortCircuited: true` and `shortCircuitReason: 'tier1-structural-blocking'`)
- How a non-short-circuited evaluation looks (for the success path)

Document in `§2c`.

### 2d. Sign-off gate

After discovery, **stop and produce the §2 deliverable** in the audit report. Wait for sign-off before continuing to Step 3.

The reviewer needs to see:
- The handler structure of both routes
- The existing validation-failure response shape
- The `evaluateClaim` return shape

This is the foundation for the gate's design. Get it right before writing code.

---

## Step 3 — Implement the gate

### 3a. Decide where the gate lives

Two reasonable choices:

**Option A: Inline in each route handler.** Add the `evaluateClaim` call + finding inspection + early return directly in both `submit-stedi` and `test-stedi` handlers. Pro: explicit and visible at the call site. Con: duplicated logic.

**Option B: Helper function called by both routes.** Create `server/services/rules-engine/edi-preflight.ts` exporting `requireTier1Pass(claimContext): Promise<Tier1FailureResponse | null>`. Returns a response object if the gate fails, null if it passes. Both routes call it identically.

Pick Option B. Same logic in two places is exactly what helpers exist for, and a future third route (sprint 2+ may add one) gets the same gate for free.

### 3b. Build `edi-preflight.ts`

```typescript
// server/services/rules-engine/edi-preflight.ts
import { evaluateClaim } from '../rules-engine';
// import the type definitions for the validation-failure response per discovery §2b

export async function requireTier1Pass(claim: ClaimWithLines): Promise<Tier1FailureResponse | null> {
  const result = await evaluateClaim(claim);
  
  if (result.shortCircuited && result.shortCircuitReason === 'tier1-structural-blocking') {
    return {
      // Match the response shape from discovery §2b exactly.
      // For example, if existing pattern is { error, details }:
      error: 'Claim has structural integrity failures and cannot be submitted',
      details: result.findings.filter(f => f.source === 'tier1-structural'),
      // Tag so callers/logs can identify the gate
      gateName: 'tier1-structural-preflight',
    };
  }
  
  // Tier 1 passed (legacy rules may have had non-blocking findings; that's not
  // this gate's concern — the EDI submission proceeds, downstream behavior
  // is unchanged from today)
  return null;
}
```

The exact shape of the return depends on what discovery §2b found. If the existing pattern is different, match it.

### 3c. Wire into both routes

In `submit-stedi` handler at `routes.ts:6348`:

```typescript
// Find the line where the claim is loaded and ready for EDI generation.
// Insert immediately before generate837P:

const tier1Failure = await requireTier1Pass(claim);
if (tier1Failure) {
  return res.status(<status_code_per_discovery_2b>).json(tier1Failure);
}

// Existing code that calls generate837P continues unchanged
const ediEnvelope = await generate837P(claim);
// ...
```

Same pattern in `test-stedi` at `routes.ts:6623`.

The gate is a pure addition between claim-load and generate837P. Do not modify any other line of either handler.

### 3d. Verify the response status code matches discovery

If discovery §2b found that this codebase uses 400 for validation failures, use 400. If it uses 422, use 422. Don't pick a code based on REST best-practices arguments — match the existing codebase convention.

---

## Step 4 — Tests

Create `server/services/rules-engine/edi-preflight.test.ts` (tsx-runnable, matching sprint 0/1a/1b test pattern):

1. **Tier 1 passes**: claim is well-formed → `requireTier1Pass(claim)` returns null. The route proceeds to EDI generation in real usage.
2. **Tier 1 blocks on missing service lines**: claim has zero service lines → `requireTier1Pass(claim)` returns the failure response object with T1-003 in details.
3. **Tier 1 blocks on missing HCPCS code**: claim has a service line with no HCPCS → returns failure with T1-004 (or whichever code matches the rule).
4. **Tier 1 blocks on missing patient**: claim has no patient_id → returns T1-001 or equivalent.
5. **Multiple Tier 1 failures**: claim has both missing service lines AND missing diagnosis → returns failure with both finding codes in details.
6. **Response shape exactly matches discovery §2b pattern**: assert the keys and shape of the returned object match what other validation failures in the codebase look like.

Run:

```bash
npx tsx server/services/rules-engine/edi-preflight.test.ts
```

All tests pass. If any fails, fix and re-run before continuing.

Add an integration test if the codebase has a pattern for testing routes (probably it does — search `*.test.ts` or `__tests__/` directories). If not, skip and note in the audit report.

---

## Step 5 — Verification

```bash
# Sprint 0 + 1a + 1b baselines (must still pass)
npx tsx scripts/verify-tenant-isolation.ts                                # 12/12
npx tsx server/services/rules-engine/tier1-structural-integrity.test.ts   # 16/16
npx tsx server/services/rules-engine.test.ts                              # 4/4
npx tsx server/services/voice-persona-builder.test.ts                     # 8/8
npx tsx scripts/smoke-helpers.ts                                          # green

# Sprint 1c additions
npx tsx server/services/rules-engine/edi-preflight.test.ts                # 6/6 (or however many)
npx tsc --noEmit                                                          # clean
```

Document outputs in audit report §5.

---

## Step 6 — Smoke test the EDI submission paths

Manual smoke test in dev:

1. **Known-good claim, submit-stedi path**: pick an existing claim that should pass Tier 1 (has service lines, HCPCS codes, patient, diagnosis, etc.). Submit via the route. Expected: same behavior as before sprint 1c — EDI generates, Stedi submission proceeds, response is whatever it was today.

2. **Structurally broken claim, submit-stedi path**: construct or pick a claim with no service lines (or stub one in dev). Submit via the route. Expected: 4xx response with T1-003 in the body. EDI generation does NOT run. Stedi is NOT contacted.

3. **Repeat both with test-stedi path** (`:6623`).

Capture each response (status code, body) and document in audit report §6.

The key signal: a broken claim that previously made it to Stedi for rejection now stops at the gate. The Stedi rejection counter for tier-1-blockable claims should drop to zero in production once sprint 1c deploys.

---

## Step 7 — Audit report

Create `docs/architecture/sprint1c-audit-report.md` with:

- §1 Executive summary + baseline verification
- §2 Discovery findings (route handler structure, validation-failure pattern, evaluateClaim return shape)
- §3 Gate design + helper implementation
- §4 Wire-in to both routes (file:line of changes)
- §5 Test results
- §6 Smoke test results (response captures for the four scenarios)
- §7 Files created / modified
- §8 Risks carried forward (production deploy of sprint 1c is a separate task; document recommended timing)
- §9 Standing-order attestation

## Step 8 — Update migration-state

Append to `docs/architecture/migration-state.md`:

- Mark §8.4 (EDI route gap) as **DONE in dev**, with reference to sprint 1c audit report and a note that production deploy of this change is a separate task.
- Add a new section noting: sprint 1c is dev-only. Production code path is unchanged until a separate prod deploy lands sprint 1c. Until then, structurally broken claims in production continue to fail at Stedi.

---

## Out of scope — confirm none touched

- Frontend components.
- The EDI generator (`server/services/edi-generator.ts`) — gate happens before generate837P, generator itself is unchanged.
- Any non-stedi route.
- The voice persona builder.
- The helper service layer (`practice-profile-helpers.ts`).
- Any RLS policy.
- Any database schema.
- Production database or production app.
- `replit.md` or audit docs other than `migration-state.md` and the new sprint1c docs.

If any modified, revert and flag.

---

## End-of-sprint state

- Snapshot taken, path recorded.
- `edi-preflight.ts` helper exports `requireTier1Pass`.
- Both stedi routes call `requireTier1Pass` before `generate837P`.
- Structurally broken claims return 4xx responses (matching existing validation-failure pattern) instead of generating broken EDI for Stedi to reject.
- Tier 1 gate covers both submit-stedi and test-stedi paths.
- All sprint 0 + 1a + 1b verifications still green.
- New edi-preflight tests green.
- TypeScript compiles clean.
- Smoke tests confirm gate fires on broken claims and passes through on good claims.
- Daniela's claim submission path unchanged for well-formed claims.
- Production unchanged (deploy is a separate task).
- Audit report committed locally.

A small follow-up task ships sprint 1c to production via the same Phase 3 deploy pattern (snapshot → migration-or-code → verify → push). For sprint 1c specifically, no schema migration is needed — it's code-only — so the prod deploy is just a push to origin/main and a Railway redeploy with smoke verification afterward.
