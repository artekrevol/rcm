/**
 * 837P generator structural regression test suite.
 *
 * Every assertion verifies X12 element positions by index, not substring.
 * This catches asterisk-count bugs (wrong element position) that .includes()
 * misses — e.g. NM108 at the wrong position would have elements[8] === ''
 * instead of 'MI', which fails here but passes a substring check.
 *
 * Run with: npx tsx server/services/edi-generator.test.ts
 * Exits 0 on all-pass, 1 on any failure.
 * No jest/vitest dependency.
 */

import { generate837P } from "./edi-generator";
import type { EDI837PInput } from "./edi-generator";
import { parseEdi } from "./edi/segment-parser";
import type { ParsedSegment } from "./edi/segment-parser";

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

/** Split raw EDI into segment strings (strips ~ terminator). */
function splitSegs(edi: string): string[] {
  return edi.split(/[~\n]+/).map(s => s.trim()).filter(Boolean);
}

/** Find a parsed segment by id and optional first-element match. */
function findSeg(
  segs: ParsedSegment[],
  id: string,
  el1?: string
): ParsedSegment | undefined {
  return segs.find(s => s.id === id && (el1 === undefined || s.elements[1] === el1));
}

/** Minimal valid 837P input; mutate per-test as needed. */
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

console.log("edi-generator — structural element-index regression tests");
console.log("===========================================================\n");

// ═══════════════════════════════════════════════════════════════════════════════
// DTP qualifier regression — Cases 1-7
// (structural at segment-id level; element-index DTP checks in Cases 12-13)
// ═══════════════════════════════════════════════════════════════════════════════

it("DTP*434 never appears in output without a statement period", () => {
  const segs = parseEdi(generate837P(baseInput()).edi);
  const dtp434 = segs.find(s => s.id === 'DTP' && s.elements[1] === '434');
  assert(dtp434 === undefined, `DTP*434 found — must never appear in 837P`);
});

it("DTP*434 never appears even with statement period (home health)", () => {
  const input = baseInput({ statement_period_start: "2026-04-01", statement_period_end: "2026-04-30" });
  const segs = parseEdi(generate837P(input).edi);
  const dtp434 = segs.find(s => s.id === 'DTP' && s.elements[1] === '434');
  assert(dtp434 === undefined, `DTP*434 found — qualifier 434 is 837I-only`);
});

it("NO DTP segment between CLM and first LX (Loop 2300 must be DTP-free)", () => {
  const input = baseInput({ statement_period_start: "2026-04-01", statement_period_end: "2026-04-30" });
  const segs = parseEdi(generate837P(input).edi);
  const clmIdx = segs.findIndex(s => s.id === 'CLM');
  const lxIdx  = segs.findIndex(s => s.id === 'LX');
  assert(clmIdx !== -1, "CLM not found");
  assert(lxIdx  !== -1, "LX not found");
  const between = segs.slice(clmIdx + 1, lxIdx);
  const dtpBetween = between.filter(s => s.id === 'DTP');
  assert(
    dtpBetween.length === 0,
    `Found ${dtpBetween.length} DTP(s) between CLM and LX — must be zero. Got: ${JSON.stringify(dtpBetween.map(s => s.elements.join('*')))}`
  );
});

it("DTP immediately after each SV1 has id='DTP', DTP01='472', DTP02='D8' (single date)", () => {
  const segs = parseEdi(generate837P(baseInput()).edi);
  const sv1Indices = segs.map((s, i) => s.id === 'SV1' ? i : -1).filter(i => i !== -1);
  assert(sv1Indices.length > 0, "No SV1 segments found");
  for (const idx of sv1Indices) {
    const next = segs[idx + 1];
    assert(next?.id === 'DTP',          `Expected DTP after SV1[${idx}], got: ${next?.id}`);
    assert(next!.elements[1] === '472', `DTP01 should be '472', got: '${next!.elements[1]}'`);
    assert(next!.elements[2] === 'D8',  `DTP02 should be 'D8', got: '${next!.elements[2]}'`);
    assert(next!.elements[3]?.match(/^\d{8}$/), `DTP03 should be YYYYMMDD, got: '${next!.elements[3]}'`);
  }
});

it("DTP*472*RD8 with correct date range for date-range service lines", () => {
  const input = baseInput({
    service_lines: [{
      hcpcs_code: "T1019", units: 8, charge: 200.0,
      modifier: null, diagnosis_pointer: "A",
      service_date: "2026-04-01", service_date_to: "2026-04-07",
    }],
  });
  const segs = parseEdi(generate837P(input).edi);
  const sv1Idx = segs.findIndex(s => s.id === 'SV1');
  assert(sv1Idx !== -1, "SV1 not found");
  const dtp = segs[sv1Idx + 1];
  assert(dtp?.id === 'DTP',                        `Expected DTP, got: ${dtp?.id}`);
  assert(dtp!.elements[1] === '472',               `DTP01: ${dtp!.elements[1]}`);
  assert(dtp!.elements[2] === 'RD8',               `DTP02: ${dtp!.elements[2]}`);
  assert(dtp!.elements[3] === '20260401-20260407', `DTP03: ${dtp!.elements[3]}`);
});

it("DTP*472 count equals service line count (one per SV1)", () => {
  const input = baseInput({
    service_lines: [
      { hcpcs_code: "T1019", units: 4, charge: 100.0, modifier: null, diagnosis_pointer: "A", service_date: "2026-04-01" },
      { hcpcs_code: "T1020", units: 2, charge: 50.0,  modifier: null, diagnosis_pointer: "A", service_date: "2026-04-02" },
    ],
  });
  const segs = parseEdi(generate837P(input).edi);
  let count = 0;
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].id === 'SV1' && segs[i + 1]?.id === 'DTP' && segs[i + 1]?.elements[1] === '472') count++;
  }
  assert(count === 2, `Expected 2 DTP*472 (one per SV1), found ${count}`);
});

it("DTP*434 never appears with multiple service lines", () => {
  const input = baseInput({
    service_lines: [
      { hcpcs_code: "T1019", units: 4, charge: 100.0, modifier: null, diagnosis_pointer: "A", service_date: "2026-04-01" },
      { hcpcs_code: "T1020", units: 2, charge: 50.0,  modifier: null, diagnosis_pointer: "A", service_date: "2026-04-02" },
    ],
  });
  const segs = parseEdi(generate837P(input).edi);
  assert(!segs.some(s => s.id === 'DTP' && s.elements[1] === '434'), "DTP*434 found — must never appear");
});

// ═══════════════════════════════════════════════════════════════════════════════
// NM1*IL — member ID qualifier (Cases 8-9)
// ═══════════════════════════════════════════════════════════════════════════════

it("payer.member_id_qualifier='MI' → NM108='MI' at correct element position", () => {
  const input = baseInput();
  input.payer.member_id_qualifier = "MI";
  const segs = parseEdi(generate837P(input).edi);
  const nm1 = findSeg(segs, 'NM1', 'IL');
  assert(nm1 !== undefined,           "NM1*IL not found");
  assert(nm1!.elements[8] === 'MI',   `NM108 should be 'MI', got: '${nm1!.elements[8]}'`);
  assert(nm1!.elements[9] === 'ABC123456', `NM109 member ID: '${nm1!.elements[9]}'`);
});

it("payer.member_id_qualifier='SY' → NM108='SY' at correct element position", () => {
  const input = baseInput();
  input.payer.member_id_qualifier = "SY";
  input.payer.payer_id = "NONPGBA";
  const segs = parseEdi(generate837P(input).edi);
  const nm1 = findSeg(segs, 'NM1', 'IL');
  assert(nm1 !== undefined,           "NM1*IL not found");
  assert(nm1!.elements[8] === 'SY',   `NM108 should be 'SY', got: '${nm1!.elements[8]}'`);
  assert(nm1!.elements[9] === 'ABC123456', `NM109 member ID: '${nm1!.elements[9]}'`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// NM1*IL — middle name (Cases 10-11)
// Full middle name emitted verbatim (not abbreviated to initial+period)
// ═══════════════════════════════════════════════════════════════════════════════

it("patient with middle name → NM105 contains full name, NM108/NM109 at correct positions", () => {
  const input = baseInput();
  input.patient.middle_name = "Alexander";
  const segs = parseEdi(generate837P(input).edi);
  const nm1 = findSeg(segs, 'NM1', 'IL');
  assert(nm1 !== undefined,                  "NM1*IL not found");
  assert(nm1!.elements[3] === 'Doe',         `NM103 last: '${nm1!.elements[3]}'`);
  assert(nm1!.elements[4] === 'Jane',        `NM104 first: '${nm1!.elements[4]}'`);
  assert(nm1!.elements[5] === 'Alexander',   `NM105 middle (full name): '${nm1!.elements[5]}'`);
  assert(nm1!.elements[6] === '',            `NM106 empty: '${nm1!.elements[6]}'`);
  assert(nm1!.elements[7] === '',            `NM107 empty: '${nm1!.elements[7]}'`);
  assert(nm1!.elements[8] === 'MI',          `NM108 qualifier: '${nm1!.elements[8]}'`);
  assert(nm1!.elements[9] === 'ABC123456',   `NM109 ID: '${nm1!.elements[9]}'`);
  assert(nm1!.elements.length === 10,        `element count: ${nm1!.elements.length}`);
});

it("patient with no middle name → NM105 is empty, NM108/NM109 at correct positions", () => {
  const input = baseInput();
  input.patient.middle_name = undefined;
  const segs = parseEdi(generate837P(input).edi);
  const nm1 = findSeg(segs, 'NM1', 'IL');
  assert(nm1 !== undefined,                "NM1*IL not found");
  assert(nm1!.elements[5] === '',          `NM105 should be empty, got: '${nm1!.elements[5]}'`);
  assert(nm1!.elements[8] === 'MI',        `NM108 qualifier: '${nm1!.elements[8]}'`);
  assert(nm1!.elements[9] === 'ABC123456', `NM109 ID: '${nm1!.elements[9]}'`);
  assert(nm1!.elements.length === 10,      `element count: ${nm1!.elements.length}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// NM1*85 — Billing Provider structural check
// ═══════════════════════════════════════════════════════════════════════════════

it("NM1*85 billing provider: entity type=2, NM108=XX, NM109=NPI", () => {
  const segs = parseEdi(generate837P(baseInput()).edi);
  const nm1 = findSeg(segs, 'NM1', '85');
  assert(nm1 !== undefined,                    "NM1*85 not found");
  assert(nm1!.elements[2] === '2',             `NM102 entity type: '${nm1!.elements[2]}'`);
  assert(nm1!.elements[3] === 'Test Clinic LLC', `NM103 name: '${nm1!.elements[3]}'`);
  assert(nm1!.elements[8] === 'XX',            `NM108 qualifier: '${nm1!.elements[8]}'`);
  assert(nm1!.elements[9] === '1234567890',    `NM109 NPI: '${nm1!.elements[9]}'`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// NM1*82 — Rendering Provider structural check
// ═══════════════════════════════════════════════════════════════════════════════

it("NM1*82 rendering provider individual: entity type=1, NM108=XX, NM109=NPI, no extra empties", () => {
  const segs = parseEdi(generate837P(baseInput()).edi);
  const nm1 = findSeg(segs, 'NM1', '82');
  assert(nm1 !== undefined,                 "NM1*82 not found");
  assert(nm1!.elements[2] === '1',          `NM102 entity type: '${nm1!.elements[2]}'`);
  assert(nm1!.elements[3] === 'Smith',      `NM103 last: '${nm1!.elements[3]}'`);
  assert(nm1!.elements[4] === 'John',       `NM104 first: '${nm1!.elements[4]}'`);
  assert(nm1!.elements[5] === '',           `NM105 middle empty: '${nm1!.elements[5]}'`);
  assert(nm1!.elements[8] === 'XX',         `NM108 qualifier: '${nm1!.elements[8]}'`);
  assert(nm1!.elements[9] === '9876543210', `NM109 NPI: '${nm1!.elements[9]}'`);
  assert(nm1!.elements.length === 10,       `element count: ${nm1!.elements.length}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// NM1*PR — Payer structural check
// ═══════════════════════════════════════════════════════════════════════════════

it("NM1*PR payer: entity type=2, NM108=PI, NM109=payer_id", () => {
  const segs = parseEdi(generate837P(baseInput()).edi);
  const nm1 = findSeg(segs, 'NM1', 'PR');
  assert(nm1 !== undefined,               "NM1*PR not found");
  assert(nm1!.elements[2] === '2',        `NM102 entity type: '${nm1!.elements[2]}'`);
  assert(nm1!.elements[3] === 'Test Payer', `NM103 name: '${nm1!.elements[3]}'`);
  assert(nm1!.elements[8] === 'PI',       `NM108 qualifier: '${nm1!.elements[8]}'`);
  assert(nm1!.elements[9] === '12345',    `NM109 payer ID: '${nm1!.elements[9]}'`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// NM1*41 — Submitter structural check
// ═══════════════════════════════════════════════════════════════════════════════

it("NM1*41 submitter: entity type=2, NM108=46, NM109=practice NPI", () => {
  const segs = parseEdi(generate837P(baseInput()).edi);
  const nm1 = findSeg(segs, 'NM1', '41');
  assert(nm1 !== undefined,               "NM1*41 not found");
  assert(nm1!.elements[2] === '2',        `NM102 entity type: '${nm1!.elements[2]}'`);
  assert(nm1!.elements[8] === '46',       `NM108 qualifier: '${nm1!.elements[8]}'`);
  assert(nm1!.elements[9] === '1234567890', `NM109 NPI: '${nm1!.elements[9]}'`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// NM1*40 — Receiver structural check
// ═══════════════════════════════════════════════════════════════════════════════

it("NM1*40 receiver: entity type=2, NM108=46", () => {
  const segs = parseEdi(generate837P(baseInput()).edi);
  const nm1 = findSeg(segs, 'NM1', '40');
  assert(nm1 !== undefined,         "NM1*40 not found");
  assert(nm1!.elements[2] === '2',  `NM102 entity type: '${nm1!.elements[2]}'`);
  assert(nm1!.elements[8] === '46', `NM108 qualifier: '${nm1!.elements[8]}'`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SBR — Claim filing indicator (SBR09)
// ═══════════════════════════════════════════════════════════════════════════════

it("SBR: SBR01='P', SBR02='18', SBR09=default 'CI' claim filing indicator", () => {
  const segs = parseEdi(generate837P(baseInput()).edi);
  const sbr = segs.find(s => s.id === 'SBR');
  assert(sbr !== undefined,             "SBR not found");
  assert(sbr!.elements[1] === 'P',      `SBR01: '${sbr!.elements[1]}'`);
  assert(sbr!.elements[2] === '18',     `SBR02: '${sbr!.elements[2]}'`);
  assert(sbr!.elements[9] === 'CI',     `SBR09 claim filing: '${sbr!.elements[9]}'`);
  // Elements 3-8 must be empty
  for (let i = 3; i <= 8; i++) {
    assert(sbr!.elements[i] === '',     `SBR0${i} should be empty: '${sbr!.elements[i]}'`);
  }
});

it("SBR09 reflects payer.claim_filing_indicator when set", () => {
  const input = baseInput();
  input.payer.claim_filing_indicator = "VA";
  const segs = parseEdi(generate837P(input).edi);
  const sbr = segs.find(s => s.id === 'SBR');
  assert(sbr !== undefined,         "SBR not found");
  assert(sbr!.elements[9] === 'VA', `SBR09: '${sbr!.elements[9]}'`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// CLM — Total charge and place-of-service composite
// ═══════════════════════════════════════════════════════════════════════════════

it("CLM: CLM02=total charge, CLM05=POS composite, CLM06-09 flags", () => {
  const segs = parseEdi(generate837P(baseInput()).edi);
  const clm = segs.find(s => s.id === 'CLM');
  assert(clm !== undefined,                   "CLM not found");
  assert(clm!.elements[2] === '100.00',       `CLM02 charge: '${clm!.elements[2]}'`);
  assert(clm!.elements[3] === '',             `CLM03 empty: '${clm!.elements[3]}'`);
  assert(clm!.elements[4] === '',             `CLM04 empty: '${clm!.elements[4]}'`);
  assert(clm!.elements[5] === '12:B:1',       `CLM05 composite: '${clm!.elements[5]}'`);
  assert(clm!.elements[6] === 'Y',            `CLM06 provider sig: '${clm!.elements[6]}'`);
  assert(clm!.elements[7] === 'A',            `CLM07 assignment: '${clm!.elements[7]}'`);
  assert(clm!.elements[8] === 'Y',            `CLM08 benefits: '${clm!.elements[8]}'`);
  assert(clm!.elements[9] === 'Y',            `CLM09 release: '${clm!.elements[9]}'`);
});

it("CLM02 sums all service line charges", () => {
  const input = baseInput({
    service_lines: [
      { hcpcs_code: "T1019", units: 4, charge: 100.0, modifier: null, diagnosis_pointer: "A", service_date: "2026-04-01" },
      { hcpcs_code: "T1020", units: 2, charge: 75.50, modifier: null, diagnosis_pointer: "A", service_date: "2026-04-02" },
    ],
  });
  const segs = parseEdi(generate837P(input).edi);
  const clm = segs.find(s => s.id === 'CLM');
  assert(clm !== undefined,               "CLM not found");
  assert(clm!.elements[2] === '175.50',   `CLM02 should be '175.50', got: '${clm!.elements[2]}'`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// REF*G1 — Prior Authorization Number
// ═══════════════════════════════════════════════════════════════════════════════

it("REF*G1 emitted when auth_number is present, REF02=auth number", () => {
  const input = baseInput({ auth_number: "AUTH12345" });
  const segs = parseEdi(generate837P(input).edi);
  const ref = findSeg(segs, 'REF', 'G1');
  assert(ref !== undefined,                 "REF*G1 not found");
  assert(ref!.elements[2] === 'AUTH12345', `REF02: '${ref!.elements[2]}'`);
});

it("REF*G1 NOT emitted when auth_number is null", () => {
  const input = baseInput({ auth_number: null });
  const segs = parseEdi(generate837P(input).edi);
  const ref = findSeg(segs, 'REF', 'G1');
  assert(ref === undefined, "REF*G1 should not be present when auth_number is null");
});

// ═══════════════════════════════════════════════════════════════════════════════
// REF*EI — Billing Provider Tax ID
// ═══════════════════════════════════════════════════════════════════════════════

it("REF*EI: REF01='EI', REF02=tax ID without dash", () => {
  const segs = parseEdi(generate837P(baseInput()).edi);
  const ref = findSeg(segs, 'REF', 'EI');
  assert(ref !== undefined,                "REF*EI not found");
  assert(ref!.elements[2] === '123456789', `REF02: '${ref!.elements[2]}'`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// HI — Diagnosis codes: qualifier and code in composite position
// ═══════════════════════════════════════════════════════════════════════════════

it("HI: first diagnosis has qualifier ABK, code F0390 in HI01 composite", () => {
  const segs = parseEdi(generate837P(baseInput()).edi);
  const hi = segs.find(s => s.id === 'HI');
  assert(hi !== undefined,                    "HI not found");
  assert(hi!.elements[1] === 'ABK:F0390',    `HI01: '${hi!.elements[1]}'`);
});

it("HI: second diagnosis has qualifier ABF in HI02", () => {
  const input = baseInput({ icd10_codes: ["F0390", "I10"] });
  const segs = parseEdi(generate837P(input).edi);
  const hi = segs.find(s => s.id === 'HI');
  assert(hi !== undefined,                    "HI not found");
  assert(hi!.elements[1] === 'ABK:F0390',    `HI01 primary: '${hi!.elements[1]}'`);
  assert(hi!.elements[2] === 'ABF:I10',      `HI02 secondary: '${hi!.elements[2]}'`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SV1 — Service line: procedure, charge, units, diagnosis pointer
// ═══════════════════════════════════════════════════════════════════════════════

it("SV1: SV101=composite, SV102=charge, SV103=UN, SV104=units, SV107=diag pointer", () => {
  const segs = parseEdi(generate837P(baseInput()).edi);
  const sv1 = segs.find(s => s.id === 'SV1');
  assert(sv1 !== undefined,                "SV1 not found");
  assert(sv1!.elements[1] === 'HC:T1019', `SV101 composite: '${sv1!.elements[1]}'`);
  assert(sv1!.elements[2] === '100.00',   `SV102 charge: '${sv1!.elements[2]}'`);
  assert(sv1!.elements[3] === 'UN',       `SV103 unit: '${sv1!.elements[3]}'`);
  assert(sv1!.elements[4] === '4',        `SV104 units: '${sv1!.elements[4]}'`);
  assert(sv1!.elements[5] === '',         `SV105 empty: '${sv1!.elements[5]}'`);
  assert(sv1!.elements[6] === '',         `SV106 empty: '${sv1!.elements[6]}'`);
  assert(sv1!.elements[7] === '1',        `SV107 diag pointer: '${sv1!.elements[7]}'`);
  assert(sv1!.elements.length === 8,      `element count: ${sv1!.elements.length}`);
});

it("SV1 with modifier: SV101 includes modifier in composite", () => {
  const input = baseInput({
    service_lines: [{
      hcpcs_code: "T1019", units: 4, charge: 100.0,
      modifier: "GT", diagnosis_pointer: "A", service_date: "2026-04-01",
    }],
  });
  const segs = parseEdi(generate837P(input).edi);
  const sv1 = segs.find(s => s.id === 'SV1');
  assert(sv1 !== undefined,                    "SV1 not found");
  assert(sv1!.elements[1] === 'HC:T1019:GT',  `SV101 with modifier: '${sv1!.elements[1]}'`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// DTP*472 — Date of service: element-index structural check
// ═══════════════════════════════════════════════════════════════════════════════

it("DTP*472*D8: DTP01='472', DTP02='D8', DTP03=YYYYMMDD single date", () => {
  const segs = parseEdi(generate837P(baseInput()).edi);
  const dtp = segs.find(s => s.id === 'DTP' && s.elements[1] === '472');
  assert(dtp !== undefined,                       "DTP*472 not found");
  assert(dtp!.elements[1] === '472',              `DTP01: '${dtp!.elements[1]}'`);
  assert(dtp!.elements[2] === 'D8',               `DTP02: '${dtp!.elements[2]}'`);
  assert(dtp!.elements[3] === '20260401',         `DTP03: '${dtp!.elements[3]}'`);
  assert(dtp!.elements.length === 4,              `element count: ${dtp!.elements.length}`);
});

it("DTP*472*RD8: DTP01='472', DTP02='RD8', DTP03=YYYYMMDD-YYYYMMDD range", () => {
  const input = baseInput({
    service_lines: [{
      hcpcs_code: "T1019", units: 8, charge: 200.0,
      modifier: null, diagnosis_pointer: "A",
      service_date: "2026-04-01", service_date_to: "2026-04-07",
    }],
  });
  const segs = parseEdi(generate837P(input).edi);
  const dtp = segs.find(s => s.id === 'DTP' && s.elements[1] === '472');
  assert(dtp !== undefined,                          "DTP*472 not found");
  assert(dtp!.elements[2] === 'RD8',                 `DTP02: '${dtp!.elements[2]}'`);
  assert(dtp!.elements[3] === '20260401-20260407',   `DTP03: '${dtp!.elements[3]}'`);
  assert(dtp!.elements.length === 4,                 `element count: ${dtp!.elements.length}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// ISA envelope — basic structural sanity
// ═══════════════════════════════════════════════════════════════════════════════

it("ISA: ISA15 usage indicator='T', ISA16=':'", () => {
  const segs = parseEdi(generate837P(baseInput()).edi);
  const isa = segs.find(s => s.id === 'ISA');
  assert(isa !== undefined,            "ISA not found");
  assert(isa!.elements[15] === 'T',   `ISA15 usage: '${isa!.elements[15]}'`);
  assert(isa!.elements[16] === ':',   `ISA16 component sep: '${isa!.elements[16]}'`);
  assert(isa!.elements.length === 17, `ISA element count (id+16 elements): ${isa!.elements.length}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// PGBA-specific: Peter Mandler EDIPI case (full NM1*IL structural check)
// ═══════════════════════════════════════════════════════════════════════════════

it("PGBA veteran (EDIPI): NM108='MI', NM105=full middle name, NM109=EDIPI", () => {
  const input = baseInput();
  // Simulate PGBA payer + EDIPI patient
  input.payer = { name: "PGBA VACCN", payer_id: "TWVACCN" };
  input.patient.first_name = "PETER";
  input.patient.last_name = "Mandler";
  input.patient.middle_name = "COIT";
  input.patient.member_id = "1636711604";  // 10-digit EDIPI → MI
  input.claim.service_lines = [
    { hcpcs_code: "T1019", units: 1, charge: 150.00, modifier: null, diagnosis_pointer: "A", service_date: "2026-04-01" },
  ];
  const segs = parseEdi(generate837P(input).edi);
  const nm1 = findSeg(segs, 'NM1', 'IL');
  assert(nm1 !== undefined,                  "NM1*IL not found");
  assert(nm1!.elements[3] === 'Mandler',     `NM103 last: '${nm1!.elements[3]}'`);
  assert(nm1!.elements[4] === 'PETER',       `NM104 first: '${nm1!.elements[4]}'`);
  assert(nm1!.elements[5] === 'COIT',        `NM105 middle (full): '${nm1!.elements[5]}'`);
  assert(nm1!.elements[6] === '',            `NM106 empty: '${nm1!.elements[6]}'`);
  assert(nm1!.elements[7] === '',            `NM107 empty: '${nm1!.elements[7]}'`);
  assert(nm1!.elements[8] === 'MI',          `NM108 qualifier: '${nm1!.elements[8]}'`);
  assert(nm1!.elements[9] === '1636711604',  `NM109 EDIPI: '${nm1!.elements[9]}'`);
  assert(nm1!.elements.length === 10,        `element count: ${nm1!.elements.length}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Loop 2310A — NM1*DN (Referring Provider)
// ─────────────────────────────────────────────────────────────────────────────

console.log("\nLoop 2310A — NM1*DN (Referring Provider) tests");
console.log("===============================================");

it("NM1*DN present when referringProvider supplied — qualifier, name, NPI", () => {
  const input = baseInput();
  input.referringProvider = {
    first_name: "JANE",
    last_name: "SMITH",
    npi: "1184288680",
    provider_type: "1",
  };
  const { edi } = generate837P(input);
  const segs = parseEdi(edi);
  const nm1 = findSeg(segs, "NM1", "DN");
  assert(nm1 !== undefined,               "NM1*DN not found");
  assert(nm1!.elements[1] === "DN",       `NM101 qualifier: '${nm1!.elements[1]}'`);
  assert(nm1!.elements[2] === "1",        `NM102 entity type: '${nm1!.elements[2]}'`);
  assert(nm1!.elements[3] === "SMITH",    `NM103 last: '${nm1!.elements[3]}'`);
  assert(nm1!.elements[4] === "JANE",     `NM104 first: '${nm1!.elements[4]}'`);
  assert(nm1!.elements[8] === "XX",       `NM108 id qualifier: '${nm1!.elements[8]}'`);
  assert(nm1!.elements[9] === "1184288680", `NM109 NPI: '${nm1!.elements[9]}'`);
});

it("NM1*DN absent when referringProvider is null", () => {
  const input = baseInput();
  input.referringProvider = null;
  const { edi } = generate837P(input);
  const segs = parseEdi(edi);
  const nm1 = findSeg(segs, "NM1", "DN");
  assert(nm1 === undefined, "NM1*DN should be absent when referringProvider is null");
});

it("NM1*DN absent when referringProvider is undefined (default)", () => {
  const input = baseInput();
  const { edi } = generate837P(input);
  const segs = parseEdi(edi);
  const nm1 = findSeg(segs, "NM1", "DN");
  assert(nm1 === undefined, "NM1*DN should be absent when referringProvider is not set");
});

it("NM1*DN entity type qualifier = '2' when provider_type is '2' (org/facility)", () => {
  const input = baseInput();
  input.referringProvider = {
    first_name: "VA",
    last_name: "COMMUNITY CARE CENTER",
    npi: "1184288680",
    provider_type: "2",
  };
  const { edi } = generate837P(input);
  const segs = parseEdi(edi);
  const nm1 = findSeg(segs, "NM1", "DN");
  assert(nm1 !== undefined,        "NM1*DN not found");
  assert(nm1!.elements[2] === "2", `NM102 should be '2' for org: '${nm1!.elements[2]}'`);
});

it("NM1*DN appears AFTER HI and BEFORE NM1*82 (segment ordering)", () => {
  const input = baseInput();
  input.referringProvider = {
    first_name: "JOHN",
    last_name: "DOE",
    npi: "1184288680",
  };
  const { edi } = generate837P(input);
  const segs = parseEdi(edi);
  const rawSegs = edi.split(/[~\n]+/).map(s => s.trim()).filter(Boolean);
  const idxHI  = rawSegs.findIndex(s => s.startsWith("HI"));
  const idxDN  = rawSegs.findIndex(s => s.startsWith("NM1*DN"));
  const idx82  = rawSegs.findIndex(s => s.startsWith("NM1*82"));
  assert(idxHI  !== -1, "HI segment not found");
  assert(idxDN  !== -1, "NM1*DN segment not found");
  // NM1*82 may be absent for agency-worker providers; only check order when present
  assert(idxDN > idxHI, `NM1*DN (${idxDN}) must come after HI (${idxHI})`);
  if (idx82 !== -1) {
    assert(idxDN < idx82, `NM1*DN (${idxDN}) must come before NM1*82 (${idx82})`);
  }
});

it("invalid NPI in referringProvider throws NPI validation error", () => {
  const input = baseInput();
  input.referringProvider = {
    first_name: "BAD",
    last_name: "NPI",
    npi: "1234567890",
  };
  let threw = false;
  let msg = "";
  try { generate837P(input); } catch (e: any) { threw = true; msg = e?.message ?? ""; }
  assert(threw,            "Expected generate837P to throw for invalid NPI");
  assert(msg.length > 0,  `Error message should be non-empty: '${msg}'`);
});

// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)\n`);

if (failed > 0) {
  console.error("837P structural regression tests FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
} else {
  console.log("All 837P structural regression tests passed.");
  process.exit(0);
}
