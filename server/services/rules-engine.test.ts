/**
 * rules-engine integration test — Sprint 1a Step 4d.
 *
 * Verifies the Tier 1 wire-in inside `evaluateClaim`:
 *   1. A claim that fails Tier 1 short-circuits with Tier 1 findings only.
 *   2. A claim that passes Tier 1 falls through to legacy sanity rules.
 *   3. A claim that passes Tier 1 but trips a legacy-only rule returns the
 *      legacy finding (and no Tier 1 findings).
 *
 * Run with: npx tsx server/services/rules-engine.test.ts
 * Exits 0 on success, 1 on any assertion failure.
 *
 * No jest/vitest dependency (matches the Sprint 0 Tier 1 test pattern).
 *
 * NOTE: `evaluateClaim` opens a `pool` connection for the payer-specific
 * manual-extraction-items query. We pass `payerId: null` in every test ctx
 * so that branch is skipped — these tests do not depend on DB row state.
 */

import { evaluateClaim, type ClaimContext, type RuleViolation } from "./rules-engine";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function it(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  [PASS] ${name}`);
    })
    .catch((err: any) => {
      failed++;
      const msg = err?.message ?? String(err);
      failures.push(`${name}: ${msg}`);
      console.log(`  [FAIL] ${name}\n         ${msg}`);
    });
}

function assert(cond: any, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function violationsByRuleId(vs: RuleViolation[]): string[] {
  return vs.map((v) => v.ruleId ?? "(null)");
}

/** Minimal context that satisfies every Tier 1 rule and every legacy sanity
 *  rule. Used as a base; tests mutate fields to trigger specific failures.  */
function freshValidCtx(): ClaimContext {
  // Service date 30 days ago — past enough to avoid future-dated, recent
  // enough to avoid the >365d warn.
  const svc = new Date(Date.now() - 30 * 86400000);
  return {
    organizationId: "chajinel-org-001",
    patientId: "patient-test-001",
    payerId: null,
    payerName: "Test Payer",
    planProduct: "PPO",
    serviceDate: svc,
    serviceLines: [
      { code: "T1019", units: 4, totalCharge: 100.0 },
    ],
    icd10Primary: "F03.90",
    icd10Secondary: [],
    authorizationNumber: null,
    placeOfService: "12",
    memberId: "ABC123456",
    patientDob: new Date("1955-06-15"),
    patientFirstName: "Jane",
    patientLastName: "Doe",
  };
}

console.log("rules-engine — Tier 1 wire-in tests");
console.log("====================================\n");

(async () => {
  // ── Case 1 — Tier 1 fails (empty service lines) → short-circuit ─────────
  await it("empty service lines short-circuits with Tier 1 T1-003", async () => {
    const ctx = freshValidCtx();
    ctx.serviceLines = [];
    const out = await evaluateClaim(ctx);
    assert(out.length > 0, "expected at least one violation");
    assert(
      out.every((v) => v.source === "tier1-structural"),
      `expected ALL violations to be tier1-structural; got: ${JSON.stringify(violationsByRuleId(out))}`
    );
    const codes = violationsByRuleId(out);
    assert(codes.includes("T1-003"), `expected T1-003 in codes; got ${JSON.stringify(codes)}`);
    // Critical: legacy sanity rules MUST NOT have run — they would produce
    // ruleType: 'data_quality' with ruleId: null. Tier 1 short-circuit means
    // every returned violation must be tagged tier1-structural.
    assert(
      out.every((v) => v.ruleId !== null && v.ruleId.startsWith("T1-")),
      "expected only T1-* findings on short-circuit"
    );
  });

  // ── Case 2 — Tier 1 fails (missing organization_id) → T1-001 ────────────
  await it("missing organization_id short-circuits with T1-001", async () => {
    const ctx = freshValidCtx();
    (ctx as any).organizationId = "";
    const out = await evaluateClaim(ctx);
    const codes = violationsByRuleId(out);
    assert(codes.includes("T1-001"), `expected T1-001; got ${JSON.stringify(codes)}`);
    assert(out.every((v) => v.source === "tier1-structural"), "expected only Tier 1 sources");
  });

  // ── Case 3 — Tier 1 passes, fully clean claim → zero violations ─────────
  await it("fully clean claim returns zero violations", async () => {
    const ctx = freshValidCtx();
    const out = await evaluateClaim(ctx);
    assert(out.length === 0, `expected 0 violations; got ${out.length}: ${JSON.stringify(violationsByRuleId(out))}`);
  });

  // ── Case 4 — Tier 1 passes, legacy sanity rule fires (units > 999) ──────
  await it("Tier 1 passes but legacy 'high units' warning fires", async () => {
    const ctx = freshValidCtx();
    ctx.serviceLines = [{ code: "T1019", units: 1000, totalCharge: 100.0 }];
    const out = await evaluateClaim(ctx);
    // Tier 1 T1-005 only flags units <= 0, so 1000 passes Tier 1.
    // The legacy sanity rule emits a 'data_quality' WARN.
    assert(out.length >= 1, "expected at least one violation");
    assert(
      out.some((v) => v.severity === "warn" && /units/i.test(v.message) && v.source !== "tier1-structural"),
      `expected legacy 'units' warn (non-tier1); got ${JSON.stringify(out.map((v) => ({ id: v.ruleId, src: v.source, sev: v.severity, msg: v.message })))}`
    );
    // No blocking Tier 1 findings should be present.
    assert(
      !out.some((v) => v.severity === "block" && v.source === "tier1-structural"),
      "expected no Tier 1 blocking findings on a Tier-1-clean claim"
    );
  });

  console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
  if (failed > 0) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log("\nAll rules-engine wire-in tests passed.");
    process.exit(0);
  }
})();
