/**
 * Tier 1 Structural Integrity — assertion-based test runner.
 *
 * Run with: npx tsx server/services/rules-engine/tier1-structural-integrity.test.ts
 * Exits 0 on success, 1 on any assertion failure.
 *
 * Standalone (no jest/vitest dependency) so Sprint 0 can ship without
 * touching package.json.
 */
import {
  validateTier1Structural,
  isTier1Passing,
  type Tier1ClaimInput,
} from "./tier1-structural-integrity";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function it(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err: any) {
    failed++;
    const msg = err?.message ?? String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`  [FAIL] ${name}\n         ${msg}`);
  }
}

function assert(cond: any, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function findingCodes(input: Tier1ClaimInput): string[] {
  return validateTier1Structural(input).map((f) => f.ruleCode);
}

const validClaim: Tier1ClaimInput = {
  organizationId: "chajinel-org-001",
  patientId: "patient-1",
  icd10Primary: "F03.90",
  serviceDate: "2026-04-15",
  placeOfService: "12",
  serviceLines: [
    {
      procedureCode: "T1019",
      units: 4,
      totalCharge: 100.0,
      serviceDate: "2026-04-15",
      placeOfService: "12",
    },
  ],
};

console.log("Tier 1 Structural Integrity — Tests");
console.log("====================================\n");

it("a fully valid claim produces zero findings and passes", () => {
  const findings = validateTier1Structural(validClaim);
  assert(findings.length === 0, `expected 0 findings, got ${findings.length}: ${JSON.stringify(findings)}`);
  assert(isTier1Passing(findings), "expected isTier1Passing=true");
});

it("T1-001 — missing organization_id is flagged", () => {
  const codes = findingCodes({ ...validClaim, organizationId: "" });
  assert(codes.includes("T1-001"), `T1-001 missing from ${codes.join(",")}`);
});

it("T1-002 — missing patient_id is flagged", () => {
  const codes = findingCodes({ ...validClaim, patientId: null });
  assert(codes.includes("T1-002"), `T1-002 missing from ${codes.join(",")}`);
});

it("T1-003 — empty service-line array is flagged", () => {
  const codes = findingCodes({ ...validClaim, serviceLines: [] });
  assert(codes.includes("T1-003"), `T1-003 missing from ${codes.join(",")}`);
});

it("T1-004 — missing procedure code on a line is flagged", () => {
  const codes = findingCodes({
    ...validClaim,
    serviceLines: [{ ...validClaim.serviceLines[0], procedureCode: "" }],
  });
  assert(codes.includes("T1-004"), `T1-004 missing from ${codes.join(",")}`);
});

it("T1-004 — malformed procedure code is flagged", () => {
  const codes = findingCodes({
    ...validClaim,
    serviceLines: [{ ...validClaim.serviceLines[0], procedureCode: "??" }],
  });
  assert(codes.includes("T1-004"), `T1-004 missing from ${codes.join(",")}`);
});

it("T1-005 — zero or negative units is flagged", () => {
  const c1 = findingCodes({
    ...validClaim,
    serviceLines: [{ ...validClaim.serviceLines[0], units: 0 }],
  });
  assert(c1.includes("T1-005"), "T1-005 not flagged for units=0");

  const c2 = findingCodes({
    ...validClaim,
    serviceLines: [{ ...validClaim.serviceLines[0], units: -1 }],
  });
  assert(c2.includes("T1-005"), "T1-005 not flagged for negative units");
});

it("T1-006 — negative charge is flagged", () => {
  const codes = findingCodes({
    ...validClaim,
    serviceLines: [{ ...validClaim.serviceLines[0], totalCharge: -5 }],
  });
  assert(codes.includes("T1-006"), `T1-006 missing from ${codes.join(",")}`);
});

it("T1-006 — missing charge is flagged", () => {
  const codes = findingCodes({
    ...validClaim,
    serviceLines: [{ ...validClaim.serviceLines[0], totalCharge: null }],
  });
  assert(codes.includes("T1-006"), `T1-006 missing from ${codes.join(",")}`);
});

it("T1-007 — missing ICD-10 is flagged", () => {
  const codes = findingCodes({ ...validClaim, icd10Primary: null });
  assert(codes.includes("T1-007"), `T1-007 missing from ${codes.join(",")}`);
});

it("T1-007 — malformed ICD-10 is flagged", () => {
  const codes = findingCodes({ ...validClaim, icd10Primary: "9999" });
  assert(codes.includes("T1-007"), `T1-007 missing from ${codes.join(",")}`);
});

it("T1-007 accepts both 'F0390' and 'F03.90'", () => {
  for (const icd of ["F0390", "F03.90"]) {
    const findings = validateTier1Structural({ ...validClaim, icd10Primary: icd });
    assert(
      !findings.some((f) => f.ruleCode === "T1-007"),
      `T1-007 incorrectly flagged for ${icd}`,
    );
  }
});

it("T1-008 — claim with no header date and no line date is flagged", () => {
  const codes = findingCodes({
    ...validClaim,
    serviceDate: null,
    serviceLines: [{ ...validClaim.serviceLines[0], serviceDate: null }],
  });
  assert(codes.includes("T1-008"), `T1-008 missing from ${codes.join(",")}`);
});

it("T1-008 — header date alone is sufficient", () => {
  const findings = validateTier1Structural({
    ...validClaim,
    serviceDate: "2026-04-15",
    serviceLines: [{ ...validClaim.serviceLines[0], serviceDate: null }],
  });
  assert(
    !findings.some((f) => f.ruleCode === "T1-008"),
    `T1-008 incorrectly flagged when header date present`,
  );
});

it("T1-008 — line date alone is sufficient", () => {
  const findings = validateTier1Structural({
    ...validClaim,
    serviceDate: null,
    serviceLines: [{ ...validClaim.serviceLines[0], serviceDate: "2026-04-15" }],
  });
  assert(
    !findings.some((f) => f.ruleCode === "T1-008"),
    `T1-008 incorrectly flagged when line date present`,
  );
});

it("multiple violations are reported together", () => {
  const findings = validateTier1Structural({
    organizationId: "",
    patientId: "",
    icd10Primary: null,
    serviceDate: null,
    serviceLines: [],
  });
  const codes = findings.map((f) => f.ruleCode);
  for (const expected of ["T1-001", "T1-002", "T1-003", "T1-007", "T1-008"]) {
    assert(codes.includes(expected), `${expected} missing from ${codes.join(",")}`);
  }
  assert(!isTier1Passing(findings), "isTier1Passing should be false when blocks present");
});

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
console.log("\nAll Tier 1 structural-integrity tests passed.");
process.exit(0);
