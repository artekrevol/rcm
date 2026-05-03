# ClaimShield — Phase 3 Sprint 1c Audit Report

**Sprint:** EDI Route → `evaluateClaim` Wire-In
**Scope:** server-side only; gates `POST /api/billing/claims/:id/submit-stedi` and `POST /api/billing/claims/:id/test-stedi` on Tier 1 structural integrity before `generate837P`
**Mode:** Build (executed directly by main agent in dev workspace)
**Status:** ⚠️ **STOPPED at Step 1 — `tsc --noEmit` baseline FAILED. Awaiting sign-off on how to proceed.**

This report follows the same convention as `sprint1a-audit-report.md` / `sprint1b-…` / `phase3-prod-deploy-audit-report.md`: per-step results, line-cited evidence, no production touches, dev-only.

---

## §1 Pre-flight (Step 1)

### §1.1 Snapshot (Step 1a) — ✅ DONE

| Item | Value |
|---|---|
| Snapshot path | `docs/architecture/sprint1c-snapshots/dev-pre-sprint1c-20260503-072034Z.sql` |
| Tool | `pg_dump (PostgreSQL) 16.5` (dev server is also v16; v17 binary not required for dev) |
| Flags | `--no-owner --no-privileges` |
| Size | 127 MB / 183,366 lines |
| `.gitignore` | `docs/architecture/sprint1c-snapshots/` already covered (pre-existing entry) |

### §1.2 Baseline test results (Step 1b)

| Check | Expected per prompt | Actual | Status |
|---|---|---|---|
| `scripts/verify-tenant-isolation.ts` | 12/12 | 12 passed, 0 failed | ✅ PASS |
| `server/services/rules-engine/tier1-structural-integrity.test.ts` | 16/16 | 16 passed, 0 failed | ✅ PASS |
| `server/services/rules-engine.test.ts` | 4/4 | 4 passed, 0 failed | ✅ PASS |
| `server/services/voice-persona-builder.test.ts` | 8/8 | **23 passed, 0 failed** | ✅ PASS (test suite expanded since prompt was authored — non-blocking, just a stale prompt expectation) |
| `scripts/smoke-helpers.ts` | "green" | Chajinel→home_care; demo ppe=2; chajinel ppe=0; no-ctx=0 | ✅ PASS (dev counts; matches Phase 3 expected dev state) |
| `npx tsc --noEmit` | "clean" | **exit 1, 85 errors across 10 files** | ❌ **FAIL** |

### §1.3 `tsc --noEmit` failure breakdown

Output captured to `/tmp/tsc-baseline.log`. Errors are **pre-existing** — Sprint 1c has not yet written or modified any code. Distribution:

**Errors per file (top → bottom):**
```
63  server/routes.ts
 5  server/storage.ts
 4  server/services/rate-ingest.ts
 4  client/src/pages/billing/claim-wizard.tsx
 3  server/services/field-resolver.ts
 1  server/services/rules-engine.ts
 1  server/services/manual-extractor.ts
 1  server/seed.ts
 1  server/lib/rate-lookup.ts
 1  client/src/pages/claim-detail.tsx
 1  client/src/lib/generate-claim-pdf.ts
```

**Errors per code (top → bottom):**
```
27  TS2345  (Argument of type X not assignable to parameter)
21  TS2304  (Cannot find name)
11  TS2339  (Property does not exist on type)
 7  TS2802  (Set/Map iteration target lower than es2015)
 6  TS7006  (Implicit any)
 6  TS2769  (No overload matches this call)
 4  TS2322  (Type X not assignable to type Y)
 1  TS7016, 1 TS18047, 1 TS1252
```

### §1.4 Sprint-1c relevance assessment

Three of the failing files intersect Sprint 1c's scope:

1. **`server/routes.ts` — 63 errors.** This is the file Sprint 1c must edit (insertions at `:6348` and `:6623`). The TSC errors are pre-existing and not localized to the Sprint 1c insertion points; they're scattered across the 7,000+ line file. Sample: lines 662 (`storage.ts insert call`), various `routes.ts` entries.
2. **`server/services/rules-engine.ts` — 1 error.** The exact module Sprint 1c routes through:
   ```
   server/services/rules-engine.ts(196,52): error TS2802: Type 'Set<string>' can only be iterated through when using the '--downlevelIteration' flag or with a '--target' of 'es2015' or higher.
   ```
   This is a tsconfig `target`/`downlevelIteration` config issue, not a logic bug. Tests for `rules-engine.ts` and `tier1-structural-integrity.ts` both pass cleanly via tsx (which does its own transpile and doesn't enforce strict tsc), so runtime behavior is unaffected.
3. **`server/storage.ts` — 5 errors.** Drizzle insert overload mismatches; not Sprint 1c scope but adjacent.

### §1.5 Standing-rule trigger

The prompt's hard rule under Step 1b is **"If any baseline fails, stop and flag."** I am stopping here as instructed.

### §1.6 Reviewer decision — **Path A confirmed (2026-05-03)**

User signed off on Path A: "Treat the 85 pre-existing tsc errors as the known baseline. Sprint 1c success criterion: zero new TypeScript errors introduced (final tsc count must be ≤ 85, ideally exactly 85)."

Reasoning per user (verbatim): "The 85 errors are scope creep waiting to happen… The 'all baselines green' rule's intent is to catch regressions introduced by the new sprint, not to enforce broader codebase health… Path C — fix only the errors touching sprint 1c's scope — is tempting but dangerous. Once you start 'while I'm here, this one is easy,' you don't know where to stop."

**Sprint 1c verification gate at Step 5 (per this decision):** `tsc --noEmit` must report ≤ 85 errors. Equality is the target (85). Any value > 85 means Sprint 1c introduced regressions and must be fixed before sign-off.

### §1.7 — (reserved)

### §1.8 Footnote — when did the 85 errors first appear?

Per user's "side note for the audit report (not gating sprint 1c)": confirm whether the 85 errors are new since sprint 1b, sprint 1a, or older.

Lightweight git archaeology performed:

- The single error in `server/services/rules-engine.ts:196` (`TS2802` on `Set<string>` iteration) traces back to commit `9537fc2 — Add advanced claim validation and scoring rules engine`, which created the file. That predates Sprint 0, Sprint 1a, and Sprint 1b — meaning at least one of the 85 errors has been latent in the repo since well before Phase 3.
- 63 of the 85 errors are in `server/routes.ts`, a 13,867-line file whose last touch in Sprint 1a/1b was localized (the Tier 1 wire-in lives in `rules-engine.ts`, not in routes). The breadth and distribution suggest these accumulated over many commits, not in a single sprint.
- Sprint 1a and Sprint 1b's audit reports both claim a clean tsc baseline. Either (a) the prior baseline checks were narrower (e.g. `tsx --check` per file rather than full-project `tsc --noEmit`), (b) the prior runs missed errors due to incremental cache, or (c) the errors materialized after those sprints from intervening commits unrelated to either sprint's scope.

**Conclusion (footnote, non-gating):** the 85 errors are old, broad, and not Sprint 1c-relevant. Worth a future hygiene sprint, but the prior "tsc clean" baseline claim in Sprint 1a/1b reports should be re-examined — either the earlier checks measured something different than full-project strict tsc, or accumulated drift slipped through. Recommend Sprint 2's pre-flight uses an explicit `npx tsc --noEmit 2>&1 | grep -c "error TS"` count rather than a binary "clean" assertion.

---

## §2 Discovery (Step 2)

Read-only discovery covering the two stedi route handlers, the existing validation-failure response convention, and the actual return shape of `evaluateClaim`. Stops at §2.5 sign-off gate per Step 2d.

### §2a Both stedi route handlers

#### `POST /api/billing/claims/:id/submit-stedi` — `routes.ts:6348`

| Aspect | Detail |
|---|---|
| Handler signature | `async (req, res) => { try { ... } catch (err: any) { ... } }` |
| Auth gate | `requireRole("admin", "rcm_manager")` (line 6348) |
| Failure modes returned via try/catch | line 6612–6618: 403 (`AutomatedSubmissionBlocked`) or 500 (default). Body: `{ success: false, blockedBy, error }` |

**Pre-EDI work, in order:**

| Line | Step |
|---:|---|
| 6350–6353 | Stedi config check → 400 `{success:false,error:"Stedi API key not configured. …"}` if not set |
| 6356–6359 | Load claim by `req.params.id`; 404 `{success:false,error:"Claim not found"}` if missing or fails `verifyOrg(c, req)` |
| 6361 | Load patient row |
| 6362–6367 | Load org-scoped `practice_settings`; 400 if missing |
| 6369–6378 | Resolve provider (claim.provider_id → org default → fallback dummy) |
| 6380–6387 | Resolve payer (`payer_id` → `payers` row → fallback by name lookup) |
| 6389 | `pat = patientResult.rows[0] \|\| {}` |
| 6391–6402 | Automated-agent gate → 403 if blocked |
| 6404–6413 | Test-mode override + ISA15 resolution + console log |
| 6415–6433 | Build `serviceLines` from raw, filter to those with `hcpcs_code`; **400 with `VALIDATION_ERROR:` body if `serviceLines.length === 0`** |
| 6434–6443 | Build `icd10Codes`; **400 with `VALIDATION_ERROR:` body if empty** |
| 6445–6494 | Synthetic test-data gate (`looksLikeTestData`); 422 if `result==='blocked'` and ISA15='P'; logs to `submission_attempts` table |
| 6496–6498 | Address building |
| **6499** | `const { generate837P } = await import("./services/edi-generator");` |
| **6500** | `const ediString = generate837P({...})` ← **`generate837P` invocation** |

**Variable holding the claim at the EDI generation point:** `c` (a row object from `claims`, snake_case columns, with `c.service_lines` already parsed to `rawLines`/`serviceLines`, `c.icd10_primary` + `c.icd10_secondary` already parsed to `icd10Codes`, `c.organization_id`, `c.patient_id`, etc.). `pat`, `ps`, `prov`, `payerInfo` are also in scope.

**Per Hard Rule 5** ("the gate runs after that work but before `generate837P`"), the **gate insertion point is immediately before line 6499** — after the synthetic-data gate, after `submission_attempts` insert, before the EDI generator import + call.

#### `POST /api/billing/claims/:id/test-stedi` — `routes.ts:6623`

| Aspect | Detail |
|---|---|
| Handler signature | `async (req, res) => { try { ... } catch (err: any) { ... } }` |
| Auth gate | `requireRole("admin", "rcm_manager", "super_admin")` (line 6623) |

**Pre-EDI work, in order:**

| Line | Step |
|---:|---|
| 6625–6628 | Stedi config check → 400 if not set |
| 6633–6636 | Idempotent `ALTER TABLE claims ADD COLUMN IF NOT EXISTS …` for 4 test columns (silent on failure) |
| 6638–6641 | Load claim; 404 if missing/cross-tenant |
| 6643 | Load patient |
| 6644–6649 | Load practice settings; 400 if missing |
| 6651–6660 | Resolve provider |
| 6662–6669 | Resolve payer |
| 6671 | `pat = …` |
| 6672–6684 | Build `serviceLines`; **400 with `VALIDATION_ERROR:` body if empty** |
| 6691–6700 | Build `icd10Codes`; **400 with `VALIDATION_ERROR:` body if empty** |
| 6702–6703 | Address building |
| **6705** | `const { generate837P } = await import("./services/edi-generator");` |
| **6706** | `const ediString = generate837P({...})` ← **`generate837P` invocation** |

**Variable holding the claim at the EDI generation point:** same as submit-stedi (`c`, `pat`, `ps`, `prov`, `payerInfo` in scope). No automated-agent gate, no test-data gate, no `submission_attempts` insert.

**Gate insertion point: immediately before line 6705.**

### §2b Validation-failure response convention

`grep -nE "res\.status\(400\)|res\.status\(422\)" server/routes.ts | head -30` returned 30 hits. Two distinct conventions in use:

**Convention 1 — non-billing routes (simple form):**
```ts
res.status(400).json({ error: "<human message>" })
```
Examples: `:182`, `:3206`, `:3344`, `:3554`, `:3673`, `:3910`, `:3946`, `:4493`, `:4523`, `:5044`, `:5142`, `:5353`. Uses 400 throughout. No `success` flag, no structured details.

**Convention 2 — billing/EDI routes (`success:false` form, the relevant convention for Sprint 1c):**
```ts
res.status(400).json({ success: false, error: "VALIDATION_ERROR: <human message>" })
```
Examples — all hits within ~200 lines of submit-stedi/test-stedi/resubmit-stedi:

| Line | Code |
|---:|---|
| 4096–4100 | `res.status(400).json({ success: false, error: …, … })` (resubmit-stedi denial) |
| 4103 | `res.status(400).json({ success: false, error: "Stedi API key not configured." })` |
| 4113 | `res.status(400).json({ success: false, error: "Practice settings not configured" })` |
| 4152 | `res.status(400).json({ success: false, error: "VALIDATION_ERROR: Claim has no service lines." })` |
| 4163 | `res.status(400).json({ success: false, error: "VALIDATION_ERROR: …" })` |
| 4262 | `res.status(422).json({ success: false, error: errMsg })` (Stedi result post-submission rejection) |
| 6352, 6357, 6359, 6367 | Same `{success:false,error}` skeleton in submit-stedi pre-checks |
| 6398–6402 | 403 `{success:false,error}` for automated block |
| 6429–6432 | **400 `VALIDATION_ERROR: Claim has no service lines.` — direct precedent for the gate's failure shape** |
| 6442 | **400 `VALIDATION_ERROR: Claim has no ICD-10 diagnosis codes.`** |
| 6466–6470 | 422 `{success:false, error, testDataSignals}` (synthetic-data block — extends the pattern with an extra array key) |
| 6685–6689, 6699 | Same pattern in test-stedi |

**Pattern conclusion:**
- **Status code: 400** for in-route input/structural validation failures (consistent with Convention 2 across submit-stedi, test-stedi, resubmit-stedi).
- **422** is reserved for *post*-Stedi rejections (`:4262`) and *policy* gates (synthetic-data block at `:6466`). Tier 1 structural failures are input-validation, so **400 is the correct match**, not 422.
- **Body shape:** `{ success: false, error: "VALIDATION_ERROR: <human message>" }`. The synthetic-data gate at `:6466` shows the codebase accepts an extra structured array key on the response (`testDataSignals`). Sprint 1c can extend the same way with a `findings` (or similarly named) array carrying the Tier 1 finding codes — preserving the standard keys plus one structured extension.

**Proposed Sprint 1c failure body (subject to §2.5 sign-off):**
```ts
res.status(400).json({
  success: false,
  error: "VALIDATION_ERROR: Claim has structural integrity failures and cannot be submitted.",
  findings: [
    { code: "T1-003", severity: "block", message: "...", fixSuggestion: "..." },
    ...
  ],
  gateName: "tier1-structural-preflight"
})
```

This matches Convention 2 exactly on the required keys (`success`, `error`, `VALIDATION_ERROR:` prefix, status 400) and adds two structured extensions (`findings`, `gateName`) consistent with how `:6466` adds `testDataSignals`.

### §2c `evaluateClaim` actual return shape — **prompt anchor mismatch**

`server/services/rules-engine.ts` lines 338–354:

```ts
export async function evaluateClaim(
  ctx: ClaimContext,
  options: { includeDemoSeed?: boolean } = {}
): Promise<RuleViolation[]> {
  const { includeDemoSeed = false } = options;
  const violations: RuleViolation[] = [];

  // ── Tier 1 structural integrity (Sprint 1a wire-in) ──────────────────────
  const tier1Violations = runTier1AsViolations(ctx);
  if (tier1Violations.some((v) => v.severity === "block")) {
    return tier1Violations;
  }
  violations.push(...tier1Violations);

  // Sanity rules first (no DB)
  violations.push(...runSanityRules(ctx));
  ...
```

**Return type: `Promise<RuleViolation[]>`** — a flat array, no wrapper.

`RuleViolation` (lines 49–63):
```ts
export interface RuleViolation {
  ruleType: RuleType;
  severity: Severity;          // "block" | "warn" | "info"
  message: string;
  fixSuggestion: string;
  ruleId: string | null;
  sourcePage: number | null;
  sourceQuote: string | null;
  payerSpecific: boolean;
  reviewedBy?: string | null;
  lastVerifiedAt?: string | null;
  source?: string;             // "tier1-structural" for Tier 1 findings
}
```

**Short-circuit semantics (actual):** when any Tier 1 violation has `severity === "block"`, `evaluateClaim` returns `tier1Violations` directly — the result array contains ONLY Tier 1 entries (no legacy/CCI/payer rules ran). The "short-circuit" is a behavioral property of the array contents, not a flag on a wrapper object.

**🚩 PROMPT ANCHOR MISMATCH — material to the sprint design.**

The prompt's "Anchors from prior sprints" section claims:

> Tier 1 short-circuit returns `{ findings, shortCircuited: true, shortCircuitReason: 'tier1-structural-blocking' }` per the integration in sprint 1a (sprint1a-audit:§4).

This **does not match the actual code**. There is no wrapper object, no `shortCircuited` boolean, no `shortCircuitReason` string. `evaluateClaim` returns `RuleViolation[]`. The prompt's Step 3b helper template (which uses `result.shortCircuited && result.shortCircuitReason === 'tier1-structural-blocking'`) is therefore unimplementable as written.

**Implication for the helper design:** the gate must inspect the array directly, not a flag. Correct logic:

```ts
const findings = await evaluateClaim(ctx);
const tier1Blocks = findings.filter(
  (f) => f.source === "tier1-structural" && f.severity === "block"
);
if (tier1Blocks.length > 0) {
  return { /* failure response per §2b */ };
}
return null;
```

This is functionally identical to the prompt's intent (gate fires on Tier 1 blocking findings, passes otherwise) but uses the actual contract. Two equally valid filter-equivalent approaches were considered:

- **Option (i):** filter on `source === "tier1-structural" && severity === "block"` (above). Most explicit; works regardless of whether legacy rules also produced blocking findings (they would mean tier1 already passed and the gate should not fire).
- **Option (ii):** check whether *every* returned finding is `source === "tier1-structural"` AND any is `severity === "block"`. Mirrors the actual short-circuit branch semantics ("tier1 returned alone means tier1 short-circuited"). Slightly more brittle if a non-source-tagged Tier 1 finding ever leaks through.

**Recommend Option (i)** — explicit, self-documenting, robust to ordering changes inside `evaluateClaim`.

**Other considerations from this discovery:**

1. **`ClaimContext` adapter required.** `evaluateClaim` takes a `ClaimContext` (`{organizationId, patientId, payerId, payerName, planProduct, serviceDate, serviceLines:{code,modifier,units,totalCharge}, icd10Primary, icd10Secondary, …}`). The route currently has loose `c.*` snake_case columns and a slightly different `serviceLines` shape (`hcpcs_code` not `code`, `charge` not `totalCharge`). The helper or its caller must build a `ClaimContext` from the route's already-loaded variables (`c`, `pat`, `payerInfo`, `serviceLines`, `icd10Codes`). Modest mapping; not difficult.

2. **Existing in-route VALIDATION_ERROR checks become redundant but harmless.** Both routes already 400 on empty service lines and empty ICD-10 (lines 6428–6432, 6441–6443, 6685–6689, 6698) — those overlap with Tier 1 rules T1-003 and T1-007. After Sprint 1c they fire first (before the gate) and short-circuit a structurally identical 400 with the legacy `VALIDATION_ERROR:` shape. Per Hard Rule 3c ("Do not modify any other line of either handler"), they stay. Net effect: a bit of duplication, no behavioral regression. Worth noting for a future sprint that consolidates.

3. **`evaluateClaim` opens a DB connection** (`pool.connect()` at line 360) for the legacy CCI/payer-document path. On Tier 1 short-circuit, the DB connection is *not* opened (early `return tier1Violations` happens at line 353, before line 360). Good — the gate is fast on the failure path.

### §2d Gate-design summary (for sign-off)

Given §2a–§2c, the recommended Sprint 1c shape is:

| Aspect | Decision |
|---|---|
| Helper file | `server/services/rules-engine/edi-preflight.ts` (Option B from prompt) |
| Helper signature | `requireTier1Pass(ctx: ClaimContext): Promise<Tier1FailureBody \| null>` |
| Detection | Filter `RuleViolation[]` on `source === "tier1-structural" && severity === "block"` |
| Failure body | `{success:false, error:"VALIDATION_ERROR: …", findings:[…], gateName:"tier1-structural-preflight"}` |
| Status code | **400** (matches Convention 2, not 422) |
| Submit-stedi insertion | After line 6494 (post-`submission_attempts` insert), before line 6499 (EDI import) |
| Test-stedi insertion | After line 6703 (post-address building), before line 6705 (EDI import) |
| `ClaimContext` builder | Inline in each route, populating from `c`, `pat`, `payerInfo`, `serviceLines`, `icd10Codes` already in scope |
| Existing `VALIDATION_ERROR` checks at 6428/6441/6685/6698 | Untouched per Hard Rule 3c |

### §2.5 — STOP for sign-off (Step 2d gate)

Stopping here per the prompt's Step 2d. Awaiting reviewer sign-off on:

1. **§2c critical finding — prompt anchor mismatch.** Confirm Option (i) detection logic (`filter source==='tier1-structural' && severity==='block'`) is acceptable in place of the prompt's `result.shortCircuited && result.shortCircuitReason==='tier1-structural-blocking'` (which doesn't exist).
2. **§2b — body shape and status code.** Confirm 400 with `{success:false, error:"VALIDATION_ERROR: …", findings:[…], gateName:"tier1-structural-preflight"}`.
3. **§2a — insertion points.** Confirm "before line 6499 in submit-stedi, before line 6705 in test-stedi" (i.e. *after* the synthetic-data gate / submission_attempts insert in submit-stedi, and *after* the existing in-route validation checks in both routes).
4. **§2c.2 — leave the existing 6428/6441/6685/6698 `VALIDATION_ERROR` returns untouched** per Hard Rule 3c, accepting harmless redundancy. Confirm or override.

Once signed off, Steps 3 (helper + wire-in), 4 (tests), 5 (verification including `tsc count ≤ 85`), 6 (audit report fill-in), 7 (final sign-off) are mechanical.

---

## §3+ — NOT STARTED
