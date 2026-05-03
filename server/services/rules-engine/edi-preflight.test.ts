/**
 * edi-preflight test — Phase 3 Sprint 1c, Step 4.
 *
 * Verifies the Tier 1 structural-integrity gate that fires immediately
 * before `generate837P` in the two stedi submission routes:
 *   1. Pass-through: a claim with all Tier 1 rules satisfied returns null.
 *   2. T1-003 block: empty service lines → failure body with T1-003.
 *   3. T1-007 block: missing primary ICD-10 → failure body with T1-007.
 *   4. T1-001 block: missing organization_id → failure body with T1-001.
 *   5. Multi-rule block: missing org + empty lines → both T1-001 + T1-003.
 *   6. Failure body shape: matches the documented Tier1FailureBody contract
 *      (success=false, error starts with "VALIDATION_ERROR:", gateName,
 *      findings is a non-empty array with required keys).
 *
 * Run with: npx tsx server/services/rules-engine/edi-preflight.test.ts
 * Exits 0 on success, 1 on any assertion failure.
 *
 * No jest/vitest dependency (matches the Sprint 0/1a/1b test pattern).
 *
 * NOTE: `evaluateClaim` opens a `pool` connection for the payer-specific
 * manual-extraction-items query on the SUCCESS path. The pass-through test
 * (case 1) therefore requires DATABASE_URL. We pass `payerId: null` in
 * every test so the payer-specific query branch is skipped — these tests
 * do not depend on DB row state. Failure cases short-circuit before
 * pool.connect() and need no DB at all.
 */

import {
  requireTier1Pass,
  buildClaimContextForGate,
  type Tier1FailureBody,
} from "./edi-preflight";
import type { ClaimContext } from "../rules-engine";

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

/** Minimal context that satisfies every Tier 1 rule. Mutate fields to
 *  trigger specific failures. Mirrors the equivalent helper in
 *  rules-engine.test.ts so behavior matches across both test surfaces. */
function freshValidCtx(): ClaimContext {
  const svc = new Date(Date.now() - 30 * 86400000);
  return {
    organizationId: "chajinel-org-001",
    patientId: "patient-test-001",
    payerId: null,
    payerName: "Test Payer",
    planProduct: "PPO",
    serviceDate: svc,
    serviceLines: [{ code: "T1019", units: 4, totalCharge: 100.0 }],
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

console.log("edi-preflight — Tier 1 gate tests");
console.log("===================================\n");

(async () => {
  // ── Case 1 — All Tier 1 rules pass → null ─────────────────────────────
  await it("returns null when every Tier 1 rule is satisfied", async () => {
    const result = await requireTier1Pass(freshValidCtx());
    assert(
      result === null,
      `expected null, got ${JSON.stringify(result)?.slice(0, 200)}`
    );
  });

  // ── Case 2 — T1-003 (empty service lines) ─────────────────────────────
  await it("returns failure body with T1-003 when service lines are empty", async () => {
    const ctx = freshValidCtx();
    ctx.serviceLines = [];
    const result = await requireTier1Pass(ctx);
    assert(result !== null, "expected non-null failure body");
    assert(
      result!.findings.some((f) => f.code === "T1-003"),
      `expected T1-003 in findings, got: ${JSON.stringify(result!.findings.map((f) => f.code))}`
    );
  });

  // ── Case 3 — T1-007 (missing ICD-10) ──────────────────────────────────
  await it("returns failure body with T1-007 when primary ICD-10 is missing", async () => {
    const ctx = freshValidCtx();
    ctx.icd10Primary = "";
    const result = await requireTier1Pass(ctx);
    assert(result !== null, "expected non-null failure body");
    assert(
      result!.findings.some((f) => f.code === "T1-007"),
      `expected T1-007 in findings, got: ${JSON.stringify(result!.findings.map((f) => f.code))}`
    );
  });

  // ── Case 4 — T1-001 (missing organization_id) ─────────────────────────
  await it("returns failure body with T1-001 when organization_id is missing", async () => {
    const ctx = freshValidCtx();
    ctx.organizationId = "";
    const result = await requireTier1Pass(ctx);
    assert(result !== null, "expected non-null failure body");
    assert(
      result!.findings.some((f) => f.code === "T1-001"),
      `expected T1-001 in findings, got: ${JSON.stringify(result!.findings.map((f) => f.code))}`
    );
  });

  // ── Case 5 — Multiple Tier 1 rules fire simultaneously ────────────────
  await it("reports multiple Tier 1 findings when multiple rules block", async () => {
    const ctx = freshValidCtx();
    ctx.organizationId = "";
    ctx.serviceLines = [];
    const result = await requireTier1Pass(ctx);
    assert(result !== null, "expected non-null failure body");
    const codes = result!.findings.map((f) => f.code);
    assert(
      codes.includes("T1-001") && codes.includes("T1-003"),
      `expected both T1-001 and T1-003 in findings, got: ${JSON.stringify(codes)}`
    );
  });

  // ── Case 6 — Failure body shape contract ──────────────────────────────
  await it("failure body matches the documented Tier1FailureBody shape", async () => {
    const ctx = freshValidCtx();
    ctx.serviceLines = [];
    const result = (await requireTier1Pass(ctx)) as Tier1FailureBody;
    assert(result !== null, "expected non-null failure body");
    assert(
      result.success === false,
      `expected success===false, got ${JSON.stringify(result.success)}`
    );
    assert(
      typeof result.error === "string" && result.error.startsWith("VALIDATION_ERROR:"),
      `expected error string with 'VALIDATION_ERROR:' prefix, got: ${JSON.stringify(result.error)}`
    );
    assert(
      result.gateName === "tier1-structural-preflight",
      `expected gateName='tier1-structural-preflight', got: ${JSON.stringify(result.gateName)}`
    );
    assert(
      Array.isArray(result.findings) && result.findings.length > 0,
      "expected non-empty findings array"
    );
    for (const f of result.findings) {
      assert(typeof f.code === "string" && /^T1-\d{3}$/.test(f.code), `bad code: ${f.code}`);
      assert(f.severity === "block", `expected severity=block, got ${f.severity}`);
      assert(typeof f.message === "string" && f.message.length > 0, "missing message");
      assert(
        typeof f.fixSuggestion === "string" && f.fixSuggestion.length > 0,
        "missing fixSuggestion"
      );
    }
  });

  // ── buildClaimContextForGate sanity ───────────────────────────────────
  // Bonus check (not counted in the 6) — guards against silent shape drift
  // in the snake_case → ClaimContext mapping shared by both routes.
  await it("buildClaimContextForGate maps route variables into a ClaimContext", () => {
    const ctx = buildClaimContextForGate({
      c: {
        id: "claim-1",
        organization_id: "chajinel-org-001",
        patient_id: "patient-1",
        payer_id: null,
        payer: "Aetna",
        service_date: "2026-04-01",
        authorization_number: "AUTH123",
        place_of_service: "12",
      },
      pat: {
        member_id: "M123",
        dob: "1955-06-15",
        first_name: "Jane",
        last_name: "Doe",
      },
      payerInfo: { name: "Aetna PPO", payer_id: "60054" },
      serviceLines: [
        { hcpcs_code: "T1019", units: 4, charge: 100, modifier: null },
      ],
      icd10Codes: ["F03.90", "I10"],
    });
    assert(ctx.organizationId === "chajinel-org-001", "organizationId mismap");
    assert(ctx.patientId === "patient-1", "patientId mismap");
    assert(ctx.payerName === "Aetna PPO", "payerName mismap");
    assert(ctx.serviceLines[0].code === "T1019", "service line code mismap");
    assert(ctx.serviceLines[0].totalCharge === 100, "totalCharge mismap");
    assert(ctx.icd10Primary === "F03.90", "icd10Primary mismap");
    assert(
      ctx.icd10Secondary.length === 1 && ctx.icd10Secondary[0] === "I10",
      "icd10Secondary mismap"
    );
    assert(ctx.memberId === "M123", "memberId mismap");
    assert(
      ctx.serviceDate instanceof Date && !Number.isNaN(ctx.serviceDate.getTime()),
      "serviceDate not a valid Date"
    );
  });

  console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)\n`);

  if (failed > 0) {
    console.error("Some edi-preflight tests failed:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  } else {
    console.log("All edi-preflight tests passed.");
    process.exit(0);
  }
})();
