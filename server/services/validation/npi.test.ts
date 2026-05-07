/**
 * NPI Luhn check-digit validation tests.
 *
 * Reference NPI: 1184288680 — Chajinel's NPI, verified against the CMS registry.
 *
 * Run with: npx tsx server/services/validation/npi.test.ts
 * Exits 0 on all-pass, 1 on any failure.
 */

import { validateNPI, validateNpiOrThrow } from "./npi";

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

function assertThrows(fn: () => void, pattern: string): void {
  try {
    fn();
    throw new Error(`Expected throw containing "${pattern}" but no error was thrown`);
  } catch (err: any) {
    if (err.message.includes('Expected throw')) throw err;
    assert(
      err.message.includes(pattern),
      `Expected error containing "${pattern}", got: "${err.message}"`
    );
  }
}

console.log("NPI Luhn check-digit validation tests");
console.log("======================================\n");

// ── validateNPI ─────────────────────────────────────────────────────────────

it("valid NPI 1184288680 (Chajinel) returns true", () => {
  assert(validateNPI("1184288680") === true, "Expected true for known-good NPI");
});

it("valid NPI 1234567893 returns true", () => {
  // 1234567893 passes the Luhn check with the 80840 prefix
  assert(validateNPI("1234567893") === true, "Expected true for 1234567893");
});

it("9-digit NPI returns false", () => {
  assert(validateNPI("118428868") === false, "9-digit NPI should be invalid");
});

it("11-digit NPI returns false", () => {
  assert(validateNPI("11842886800") === false, "11-digit NPI should be invalid");
});

it("non-numeric NPI returns false", () => {
  assert(validateNPI("118428868X") === false, "Non-numeric NPI should be invalid");
});

it("NPI with dashes returns false", () => {
  assert(validateNPI("1184-288680") === false, "NPI with dashes should be invalid");
});

it("all-zeros NPI returns false (fails Luhn)", () => {
  assert(validateNPI("0000000000") === false, "All-zeros NPI should fail Luhn");
});

it("empty string returns false", () => {
  assert(validateNPI("") === false, "Empty string should be invalid");
});

it("NPI that passes length but fails Luhn returns false", () => {
  // Modify one digit of the known-good NPI to break the check
  assert(validateNPI("1184288681") === false, "Modified NPI should fail Luhn");
});

// ── validateNpiOrThrow ───────────────────────────────────────────────────────

it("validateNpiOrThrow: valid NPI does not throw", () => {
  let threw = false;
  try { validateNpiOrThrow("1184288680"); } catch { threw = true; }
  assert(!threw, "Valid NPI should not throw");
});

it("validateNpiOrThrow: empty string throws 'required'", () => {
  assertThrows(() => validateNpiOrThrow(""), "required");
});

it("validateNpiOrThrow: 9-digit NPI throws with length message", () => {
  assertThrows(() => validateNpiOrThrow("118428868"), "10 numeric digits");
});

it("validateNpiOrThrow: non-numeric throws with length message", () => {
  assertThrows(() => validateNpiOrThrow("118428868X"), "10 numeric digits");
});

it("validateNpiOrThrow: Luhn failure throws with Luhn message", () => {
  assertThrows(() => validateNpiOrThrow("1184288681"), "Luhn");
});

it("validateNpiOrThrow: null-ish treated as empty — throws 'required'", () => {
  assertThrows(() => validateNpiOrThrow(null as any), "required");
});

// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)\n`);

if (failed > 0) {
  console.error("NPI validation tests FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
} else {
  console.log("All NPI validation tests passed.");
  process.exit(0);
}
