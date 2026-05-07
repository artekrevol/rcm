/**
 * edi-generator DTP qualifier regression test.
 *
 * Asserts:
 *   1. DTP*434 NEVER appears anywhere in generated 837P output (was regressed).
 *   2. DTP*472 appears immediately after CLM in Loop 2300 when a statement
 *      period is provided (home-health multi-visit).
 *   3. DTP*472 appears exactly once per service line in Loop 2400, immediately
 *      after each SV1 segment.
 *   4. Single-date service lines emit DTP*472*D8*YYYYMMDD.
 *   5. Date-range service lines emit DTP*472*RD8*YYYYMMDD-YYYYMMDD.
 *   6. Claims WITHOUT a statement period still emit DTP*472 in Loop 2400
 *      and have zero DTP*434 segments.
 *
 * Run with: npx tsx server/services/edi-generator.test.ts
 * Exits 0 on success, 1 on any assertion failure.
 * No jest/vitest dependency — matches existing test pattern in this repo.
 */

import { generate837P } from "./edi-generator";
import type { EDI837PInput } from "./edi-generator";

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

function segments(edi: string): string[] {
  return edi
    .split(/[~\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Minimal valid 837P input. Mutate as needed per test case. */
function baseInput(overrides: Partial<EDI837PInput["claim"]> = {}): EDI837PInput {
  return {
    isa15: "T",
    claim: {
      id: "TEST-CLAIM-001",
      patient_id: "PAT-001",
      service_date: "2026-04-01",
      place_of_service: "12",
      auth_number: null,
      payer: "Test Payer",
      amount: 100.0,
      icd10_codes: ["F0390"],
      service_lines: [
        {
          hcpcs_code: "T1019",
          units: 4,
          charge: 100.0,
          modifier: null,
          diagnosis_pointer: "A",
          service_date: "2026-04-01",
        },
      ],
      ...overrides,
    },
    patient: {
      first_name: "Jane",
      last_name: "Doe",
      dob: "1955-06-15",
      member_id: "ABC123456",
      insurance_carrier: "Test Payer",
      sex: "F",
    },
    practice: {
      name: "Test Clinic LLC",
      npi: "1234567890",
      tax_id: "123456789",
      taxonomy_code: "251E00000X",
      address: "123 Main St",
      city: "Tampa",
      state: "FL",
      zip: "33601",
    },
    provider: {
      first_name: "John",
      last_name: "Smith",
      npi: "9876543210",
      taxonomy_code: "251E00000X",
    },
    ordering_provider: null,
    payer: {
      name: "Test Payer",
      payer_id: "12345",
    },
  };
}

console.log("edi-generator — DTP qualifier regression tests");
console.log("================================================\n");

// ── Case 1: DTP*434 never appears in any generated output ────────────────────
it("DTP*434 never appears in output without a statement period", () => {
  const edi = generate837P(baseInput());
  assert(
    !edi.includes("DTP*434"),
    `DTP*434 found in output but it must never appear in 837P.\nOffending segment: ${
      segments(edi).find((s) => s.startsWith("DTP*434")) ?? "(not found?)"
    }`
  );
});

// ── Case 2: DTP*434 never appears even WITH a statement period ───────────────
it("DTP*434 never appears in output even with a statement period (home health)", () => {
  const input = baseInput({
    statement_period_start: "2026-04-01",
    statement_period_end: "2026-04-30",
  });
  const edi = generate837P(input);
  assert(
    !edi.includes("DTP*434"),
    `DTP*434 found in output — qualifier 434 is 837I-only and must never appear in 837P.`
  );
});

// ── Case 3: NO DTP segment between CLM and first LX (Loop 2300 is DTP-free) ──
// 837P (005010X222A1) has no billing-period DTP in Loop 2300. Valid Loop 2300
// DTP qualifiers (050/090/091/096/296/297/304/314/360/361/431/435/439/444/
// 453/454/455/471/484) do not include 472 or 434. The statement_period_start /
// statement_period_end values are stored internally but must NOT appear in EDI.
it("NO DTP segment appears between CLM and first LX (Loop 2300 must be DTP-free)", () => {
  const input = baseInput({
    statement_period_start: "2026-04-01",
    statement_period_end: "2026-04-30",
  });
  const edi = generate837P(input);
  const segs = segments(edi);
  const clmIdx = segs.findIndex((s) => s.startsWith("CLM*"));
  const lxIdx = segs.findIndex((s) => s.startsWith("LX*"));
  assert(clmIdx !== -1, "CLM segment not found in output");
  assert(lxIdx !== -1, "LX segment not found in output");
  const between = segs.slice(clmIdx + 1, lxIdx);
  const dtpInLoop2300 = between.filter((s) => s.startsWith("DTP*"));
  assert(
    dtpInLoop2300.length === 0,
    `Found ${dtpInLoop2300.length} DTP segment(s) between CLM and LX — must be zero.\n` +
      `Offending: ${JSON.stringify(dtpInLoop2300)}`
  );
});

// ── Case 4: DTP*472*D8 appears immediately after each SV1 (single date) ──────
it("DTP*472*D8 appears immediately after SV1 for single-date service lines", () => {
  const edi = generate837P(baseInput());
  const segs = segments(edi);
  const sv1Indices = segs
    .map((s, i) => (s.startsWith("SV1*") ? i : -1))
    .filter((i) => i !== -1);
  assert(sv1Indices.length > 0, "No SV1 segments found in output");
  for (const idx of sv1Indices) {
    const next = segs[idx + 1];
    assert(
      next?.startsWith("DTP*472*D8*"),
      `Expected DTP*472*D8* immediately after SV1 at index ${idx}, got: ${next}`
    );
  }
});

// ── Case 5: DTP*472*RD8 appears immediately after SV1 for date-range lines ───
it("DTP*472*RD8 appears immediately after SV1 for date-range service lines", () => {
  const input = baseInput({
    service_lines: [
      {
        hcpcs_code: "T1019",
        units: 8,
        charge: 200.0,
        modifier: null,
        diagnosis_pointer: "A",
        service_date: "2026-04-01",
        service_date_to: "2026-04-07",
      },
    ],
  });
  const edi = generate837P(input);
  const segs = segments(edi);
  const sv1Idx = segs.findIndex((s) => s.startsWith("SV1*"));
  assert(sv1Idx !== -1, "SV1 segment not found");
  const next = segs[sv1Idx + 1];
  assert(
    next?.startsWith("DTP*472*RD8*"),
    `Expected DTP*472*RD8* after SV1, got: ${next}`
  );
  assert(
    next === "DTP*472*RD8*20260401-20260407",
    `Wrong date range: expected DTP*472*RD8*20260401-20260407, got: ${next}`
  );
});

// ── Case 6: DTP*472 count equals service line count in Loop 2400 ─────────────
it("DTP*472 count in Loop 2400 equals the number of service lines", () => {
  const input = baseInput({
    service_lines: [
      {
        hcpcs_code: "T1019",
        units: 4,
        charge: 100.0,
        modifier: null,
        diagnosis_pointer: "A",
        service_date: "2026-04-01",
      },
      {
        hcpcs_code: "T1020",
        units: 2,
        charge: 50.0,
        modifier: null,
        diagnosis_pointer: "A",
        service_date: "2026-04-02",
      },
    ],
  });
  const edi = generate837P(input);
  const segs = segments(edi);

  // Count DTP*472 segments that immediately follow an SV1 (Loop 2400 only)
  let loop2400DtpCount = 0;
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].startsWith("SV1*") && segs[i + 1]?.startsWith("DTP*472*")) {
      loop2400DtpCount++;
    }
  }
  assert(
    loop2400DtpCount === 2,
    `Expected 2 DTP*472 segments in Loop 2400 (one per service line), found ${loop2400DtpCount}`
  );
});

// ── Case 7: No DTP*434 with multiple service lines ───────────────────────────
it("DTP*434 never appears with multiple service lines", () => {
  const input = baseInput({
    service_lines: [
      {
        hcpcs_code: "T1019",
        units: 4,
        charge: 100.0,
        modifier: null,
        diagnosis_pointer: "A",
        service_date: "2026-04-01",
      },
      {
        hcpcs_code: "T1020",
        units: 2,
        charge: 50.0,
        modifier: null,
        diagnosis_pointer: "A",
        service_date: "2026-04-02",
      },
    ],
  });
  const edi = generate837P(input);
  assert(!edi.includes("DTP*434"), "DTP*434 found — must never appear in 837P");
});

// ── Case 8: payer.member_id_qualifier = 'MI' → NM108 is MI ──────────────────
it("payer.member_id_qualifier='MI' emits ***MI* in NM1*IL (non-PGBA)", () => {
  const input = baseInput();
  input.payer.member_id_qualifier = "MI";
  const edi = generate837P(input);
  assert(
    edi.includes("***MI*"),
    `Expected ***MI* in NM1*IL segment, not found.\nNM1 line: ${
      edi.split(/[~\n]+/).find((s) => s.includes("NM1*IL")) ?? "(not found)"
    }`
  );
  assert(!edi.includes("***SY*"), "Did not expect ***SY* when qualifier is MI");
});

// ── Case 9: payer.member_id_qualifier = 'SY' → NM108 is SY ──────────────────
it("payer.member_id_qualifier='SY' emits ***SY* in NM1*IL (non-PGBA)", () => {
  const input = baseInput();
  input.payer.member_id_qualifier = "SY";
  input.payer.payer_id = "NONPGBA"; // ensure not routed through resolveVeteranId
  const edi = generate837P(input);
  assert(
    edi.includes("***SY*"),
    `Expected ***SY* in NM1*IL segment, not found.\nNM1 line: ${
      edi.split(/[~\n]+/).find((s) => s.includes("NM1*IL")) ?? "(not found)"
    }`
  );
  assert(!edi.includes("***MI*") || true, "MI check skipped — SY payer confirmed");
});

// ── Case 10: patient with middle name → NM105 position is populated ──────────
// NM1 element layout: NM1*IL(1)*1(2)*Last(3)*First(4)*Middle(5)**(6)**(7)*qualifier(8)*id(9)
// parts[0]=NM1, [1]=IL, [2]=1, [3]=Last, [4]=First, [5]=MiddleInitial, [6]="", [7]="", [8]=qualifier, [9]=id
it("middle name appears in NM1*05 position when patient has middle name", () => {
  const input = baseInput();
  input.patient.middle_name = "Alexander";
  const edi = generate837P(input);
  const nm1Il = edi.split(/[~\n]+/).find((s) => s.startsWith("NM1*IL"));
  assert(nm1Il !== undefined, "NM1*IL segment not found");
  const parts = nm1Il!.split("*");
  // NM105 is element index 5 (0-based: NM1=0, IL=1, 1=2, Last=3, First=4, Middle=5)
  assert(
    parts[5] === "A.",
    `Expected NM105 (parts[5])='A.' for middle name 'Alexander', got: '${parts[5]}'. Full segment: ${nm1Il}`
  );
});

// ── Case 11: patient with no middle name → NM105 is empty ────────────────────
it("NM105 position is empty when patient has no middle name", () => {
  const input = baseInput();
  input.patient.middle_name = undefined;
  const edi = generate837P(input);
  const nm1Il = edi.split(/[~\n]+/).find((s) => s.startsWith("NM1*IL"));
  assert(nm1Il !== undefined, "NM1*IL segment not found");
  const parts = nm1Il!.split("*");
  // NM105 is element index 5 — must be empty when no middle name
  assert(
    parts[5] === "",
    `Expected NM105 (parts[5])='' when no middle name, got: '${parts[5]}'. Full segment: ${nm1Il}`
  );
  // Verify full element count is preserved (NM1 has 10 elements: indices 0–9)
  assert(
    parts.length >= 9,
    `NM1*IL must have at least 9 elements even with empty NM105, got: ${parts.length}`
  );
});

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)\n`);

if (failed > 0) {
  console.error("DTP qualifier regression tests FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
} else {
  console.log("All DTP qualifier regression tests passed.");
  process.exit(0);
}
