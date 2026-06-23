/**
 * Phase B verification harness — VB-0 through VB-8
 *
 * Run with:
 *   NODE_OPTIONS='--import tsx/esm' node --test test/phase-b-verify.test.ts
 *
 * VB-0  G1 golden EDI still parses identically after Phase B changes
 * VB-1  Dispatch selector routes 837I / 837P correctly
 * VB-2  Episode gate blocks when billing period is not ready_to_bill
 * VB-3  RCD/UTN gate: PCR blocks without UTN; passes with UTN; postpay passes with flag
 * VB-4  NOA precondition gate blocks when NOA is pending/missing
 * VB-5  NOA timing — penalty days computed correctly (Phase A computeNoaStatus)
 * VB-6  generate837I — correct TOB, HIPPS line, occurrence code 50, value codes
 * VB-7  generateNOA  — TOB 032A, placeholder HIPPS 1AA11, no occurrence code
 * VB-8  ISA15 defaults to 'T' in both generators
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture helpers
// ─────────────────────────────────────────────────────────────────────────────

const mockPractice = {
  name: 'Caritas Home Health',
  legal_name: 'Caritas Home Health LLC',
  npi: '1234567890',
  tax_id: '12-3456789',
  taxonomy_code: '251E00000X',
  address: '100 Health Way',
  city: 'Miami',
  state: 'FL',
  zip: '33101',
  phone: '3055550100',
};

const mockPatient = {
  first_name: 'Maria',
  last_name: 'Gonzalez',
  dob: '1945-03-15',
  member_id: '1EG4-TE5-MK72',
  sex: 'F',
};

const mockPayer = {
  name: 'Palmetto GBA Medicare',
  payer_id: '10111',
};

const mockProvider = {
  first_name: 'James',
  last_name: 'Smith',
  npi: '9876543210',
};

const mockAdmission = {
  socDate: '2026-06-01',
  firstVisitDate: '2026-06-01',
  principalDiagnosis: 'M1721',
  additionalDiagnoses: ['Z234'],
};

// ─────────────────────────────────────────────────────────────────────────────
// VB-0: G1 golden 837P file unchanged
// ─────────────────────────────────────────────────────────────────────────────
describe('VB-0 | G1 golden 837P unchanged', () => {
  it('generates an 837P with ISA/GS/ST segments', async () => {
    const { generate837P } = await import('../server/services/edi-generator.js');
    const result = generate837P({
      claim: {
        id: 'golden-vb0-test',
        patient_id: 'p1',
        payer_id: 'payer1',
        status: 'draft',
        amount: 150,
        place_of_service: '11',
        icd10_codes: ['M7910'],
        service_lines: [{ hcpcs_code: '97110', charge: 150, units: 2, modifier: null, diagnosis_pointer: '1', service_date: '2026-06-01', service_date_to: null }],
        claim_frequency_code: '1',
      } as any,
      patient: { first_name: 'John', last_name: 'Doe', dob: '1950-01-01', member_id: 'M001', sex: 'M' } as any,
      practice: { ...mockPractice, tax_id: '123456789', npi: '1234567890' } as any,
      provider: { first_name: 'Jane', last_name: 'Doe', npi: '9876543210', taxonomy_code: '207X00000X' } as any,
      payer: {
        name: 'Aetna',
        payer_id: 'AETNA',
        // 'situational' = referring provider is optional (won't throw without it)
        referringProviderPolicy: 'situational',
      } as any,
      // Supply referring provider to satisfy 'required' policies on production payers
      // NPI 1184288680 passes the CMS Luhn check digit validation
      referringProvider: {
        first_name: 'Jane',
        last_name: 'Doe',
        npi: '1184288680',
        verification_status: 'verified',
      } as any,
      isa15: 'T',
    });
    assert.ok(result.edi.includes('ISA*'), 'ISA segment present');
    assert.ok(result.edi.includes('GS*HC*'), 'GS HC segment present');
    assert.ok(result.edi.includes('005010X222A1'), '837P version code present');
    assert.ok(result.edi.includes('SV1*'), 'SV1 service line present (837P not 837I)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VB-1: Dispatch selector routes correctly
// ─────────────────────────────────────────────────────────────────────────────
describe('VB-1 | Dispatch selector', () => {
  it('resolveGeneratorKey returns 837I for "837I" input', async () => {
    const { resolveGeneratorKey } = await import('../server/services/edi/select-generator.js');
    assert.equal(resolveGeneratorKey('837I'), '837I');
  });

  it('resolveGeneratorKey returns 837P for null input', async () => {
    const { resolveGeneratorKey } = await import('../server/services/edi/select-generator.js');
    assert.equal(resolveGeneratorKey(null), '837P');
  });

  it('resolveGeneratorKey returns 837P for "837P" input', async () => {
    const { resolveGeneratorKey } = await import('../server/services/edi/select-generator.js');
    assert.equal(resolveGeneratorKey('837P'), '837P');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VB-2: Episode gate (pure function)
// ─────────────────────────────────────────────────────────────────────────────
describe('VB-2 | Episode gate', () => {
  it('blocks when period_status is "open"', async () => {
    const { assertEpisodeGateFromContext, HhGateError } = await import('../server/services/hh/gates.js');
    assert.throws(
      () => assertEpisodeGateFromContext({ billingPeriodStatus: 'open', undocumentedVisits: 0, unsignedVisits: 0 }),
      (e: any) => e instanceof HhGateError && e.code === 'HH-G3-STATUS',
    );
  });

  it('blocks when there are undocumented visits', async () => {
    const { assertEpisodeGateFromContext, HhGateError } = await import('../server/services/hh/gates.js');
    assert.throws(
      () => assertEpisodeGateFromContext({ billingPeriodStatus: 'ready_to_bill', undocumentedVisits: 2, unsignedVisits: 0 }),
      (e: any) => e instanceof HhGateError && e.code === 'HH-G3-UNDOCUMENTED',
    );
  });

  it('blocks when there are unsigned visits', async () => {
    const { assertEpisodeGateFromContext, HhGateError } = await import('../server/services/hh/gates.js');
    assert.throws(
      () => assertEpisodeGateFromContext({ billingPeriodStatus: 'ready_to_bill', undocumentedVisits: 0, unsignedVisits: 1 }),
      (e: any) => e instanceof HhGateError && e.code === 'HH-G3-UNSIGNED',
    );
  });

  it('passes when ready_to_bill and all visits complete', async () => {
    const { assertEpisodeGateFromContext } = await import('../server/services/hh/gates.js');
    assert.doesNotThrow(() =>
      assertEpisodeGateFromContext({ billingPeriodStatus: 'ready_to_bill', undocumentedVisits: 0, unsignedVisits: 0 }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VB-3: RCD/UTN gate (pure function)
// ─────────────────────────────────────────────────────────────────────────────
describe('VB-3 | RCD/UTN gate', () => {
  it('PCR + no UTN → throws HH-G4-UTN-REQUIRED', async () => {
    const { assertRcdUtnGateFromContext, HhGateError } = await import('../server/services/hh/gates.js');
    assert.throws(
      () => assertRcdUtnGateFromContext({ rcdReviewChoice: 'pre_claim_review', utnAffirmed: false }),
      (e: any) => e instanceof HhGateError && e.code === 'HH-G4-UTN-REQUIRED',
    );
  });

  it('PCR + affirmed UTN → allowed', async () => {
    const { assertRcdUtnGateFromContext } = await import('../server/services/hh/gates.js');
    const result = assertRcdUtnGateFromContext({ rcdReviewChoice: 'pre_claim_review', utnAffirmed: true });
    assert.equal(result.blocked, false);
    assert.equal(result.postpaymentReadinessFlagRequired, false);
  });

  it('Postpayment → allowed with readiness flag', async () => {
    const { assertRcdUtnGateFromContext } = await import('../server/services/hh/gates.js');
    const result = assertRcdUtnGateFromContext({ rcdReviewChoice: 'postpayment_review', utnAffirmed: false });
    assert.equal(result.blocked, false);
    assert.equal(result.postpaymentReadinessFlagRequired, true);
  });

  it('null choice → allowed, no flag', async () => {
    const { assertRcdUtnGateFromContext } = await import('../server/services/hh/gates.js');
    const result = assertRcdUtnGateFromContext({ rcdReviewChoice: null, utnAffirmed: false });
    assert.equal(result.blocked, false);
    assert.equal(result.postpaymentReadinessFlagRequired, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VB-4: NOA precondition gate (pure function)
// ─────────────────────────────────────────────────────────────────────────────
describe('VB-4 | NOA precondition gate', () => {
  it('blocks when NOA is null (no filing)', async () => {
    const { assertNoaPreconditionFromContext, HhGateError } = await import('../server/services/hh/gates.js');
    assert.throws(
      () => assertNoaPreconditionFromContext({ noaStatus: null }),
      (e: any) => e instanceof HhGateError && e.code === 'HH-G5-NOA-REQUIRED',
    );
  });

  it('blocks when NOA is "pending"', async () => {
    const { assertNoaPreconditionFromContext, HhGateError } = await import('../server/services/hh/gates.js');
    assert.throws(
      () => assertNoaPreconditionFromContext({ noaStatus: 'pending' }),
      (e: any) => e instanceof HhGateError && e.code === 'HH-G5-NOA-REQUIRED',
    );
  });

  it('passes when NOA is "filed"', async () => {
    const { assertNoaPreconditionFromContext } = await import('../server/services/hh/gates.js');
    assert.doesNotThrow(() => assertNoaPreconditionFromContext({ noaStatus: 'filed' }));
  });

  it('passes when NOA is "accepted"', async () => {
    const { assertNoaPreconditionFromContext } = await import('../server/services/hh/gates.js');
    assert.doesNotThrow(() => assertNoaPreconditionFromContext({ noaStatus: 'accepted' }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VB-5: NOA timing — penalty days (Phase A computeNoaStatus)
//
// computeNoaStatus({ soc_date, filed_date }) → { due_date, status, penalty_days }
// status: "pending" | "filed" | "late"
// due_date = soc_date + 5 calendar days (CMS PDGM)
// penalty_days = max(0, filed_date − due_date)
// ─────────────────────────────────────────────────────────────────────────────
describe('VB-5 | NOA timing + penalty', () => {
  it('no penalty when filed on SOC date itself (day 0)', async () => {
    const { computeNoaStatus } = await import('../server/services/hh/noa.js');
    const result = computeNoaStatus({ soc_date: '2026-06-01', filed_date: '2026-06-01' });
    assert.equal(result.penalty_days, 0);
    assert.equal(result.status, 'filed');
  });

  it('no penalty when filed on day 5 (due date — last valid day)', async () => {
    const { computeNoaStatus } = await import('../server/services/hh/noa.js');
    const result = computeNoaStatus({ soc_date: '2026-06-01', filed_date: '2026-06-06' });
    // due_date = 2026-06-06; filed on due date → penalty_days = 0
    assert.equal(result.penalty_days, 0);
    assert.equal(result.status, 'filed');
  });

  it('1-day penalty when filed one day after due date', async () => {
    const { computeNoaStatus } = await import('../server/services/hh/noa.js');
    // due_date = 2026-06-06; filed 2026-06-07 → 1 penalty day
    const result = computeNoaStatus({ soc_date: '2026-06-01', filed_date: '2026-06-07' });
    assert.equal(result.penalty_days, 1, `Expected 1 penalty day, got ${result.penalty_days}`);
    assert.equal(result.status, 'late');
  });

  it('status is "pending" when filed_date is null (not yet filed)', async () => {
    const { computeNoaStatus } = await import('../server/services/hh/noa.js');
    const result = computeNoaStatus({ soc_date: '2026-06-01', filed_date: null });
    assert.equal(result.status, 'pending');
    assert.equal(result.penalty_days, 0);
  });

  it('due_date is soc_date + 5 calendar days', async () => {
    const { computeNoaStatus } = await import('../server/services/hh/noa.js');
    const result = computeNoaStatus({ soc_date: '2026-06-01', filed_date: null });
    assert.equal(result.due_date, '2026-06-06', `due_date should be soc + 5 days, got ${result.due_date}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VB-6: generate837I — correct TOB, HIPPS line, occurrence code 50, value codes
// ─────────────────────────────────────────────────────────────────────────────
describe('VB-6 | generate837I content', () => {
  async function build837I(overrides: Partial<Parameters<any>[0]> = {}) {
    const { generate837I } = await import('../server/services/edi-generator-institutional.js');
    return generate837I({
      isa15: 'T',
      claimFrequencyCode: '2',
      patientControlNumber: 'PERIOD001',
      totalCharge: 3200.00,
      hippsCode: 'AA111',
      visitLines: [{ revenueCode: '0551', visitCount: 8, charge: 3200.00 }],
      oasisDate: '2026-06-28',
      fipsCounty: 'FL086',
      cbsaCode: '33100',
      admission: mockAdmission,
      patient: mockPatient,
      practice: mockPractice,
      attendingProvider: mockProvider,
      payer: mockPayer,
      ...overrides,
    });
  }

  it('produces 837I version code (005010X223A2) not 837P', async () => {
    const { edi } = await build837I();
    assert.ok(edi.includes('005010X223A2'), '837I version code in GS08/ST03');
    assert.ok(!edi.includes('005010X222A1'), '837P version code must NOT appear in 837I');
  });

  it('TOB frequency digit appears in CLM05 composite', async () => {
    const { edi } = await build837I({ claimFrequencyCode: '2' });
    assert.ok(edi.includes('32:1:2'), 'CLM05 should contain "32:1:2" for period-1 interim claim');
  });

  it('final claim has TOB frequency 4', async () => {
    const { edi } = await build837I({ claimFrequencyCode: '4' });
    assert.ok(edi.includes('32:1:4'), 'Final claim CLM05 should contain "32:1:4"');
  });

  it('0023 revenue line present with HIPPS code', async () => {
    const { edi } = await build837I();
    assert.ok(edi.includes('SV2*0023*HH:AA111'), 'SV2 0023 line with HH:HIPPS composite');
  });

  it('occurrence code 50 with OASIS date', async () => {
    const { edi } = await build837I();
    assert.ok(edi.includes('BH:50:D8:20260628'), 'Occurrence code 50 with OASIS date in HI segment');
  });

  it('value code 85 with FIPS county', async () => {
    const { edi } = await build837I();
    assert.ok(edi.includes('BE:85::FL086'), 'Value code 85 with FIPS in HI segment');
  });

  it('value code 61 with CBSA code', async () => {
    const { edi } = await build837I();
    assert.ok(edi.includes('BE:61::33100'), 'Value code 61 with CBSA in HI segment');
  });

  it('CL1 segment present', async () => {
    const { edi } = await build837I();
    assert.ok(edi.includes('CL1*'), 'CL1 institutional claim code segment present');
  });

  it('discipline revenue line present', async () => {
    const { edi } = await build837I();
    assert.ok(edi.includes('SV2*0551'), 'Discipline SN revenue code line present');
  });

  it('UTN in REF*9F when utnNumber supplied', async () => {
    const { edi } = await build837I({ utnNumber: 'UTN20260601001' });
    assert.ok(edi.includes('REF*9F*UTN20260601001'), 'REF*9F UTN segment present');
  });

  it('no REF*9F when utnNumber is null', async () => {
    const { edi } = await build837I({ utnNumber: null });
    assert.ok(!edi.includes('REF*9F'), 'REF*9F absent when no UTN');
  });

  it('attending physician NM1*71 present', async () => {
    const { edi } = await build837I();
    assert.ok(edi.includes('NM1*71*1*Smith*James'), 'Attending physician NM1*71 present');
  });

  it('throws when hippsCode missing', async () => {
    const { generate837I } = await import('../server/services/edi-generator-institutional.js');
    assert.rejects(
      async () => generate837I({ hippsCode: '', claimFrequencyCode: '2', patientControlNumber: 'X',
        totalCharge: 100, visitLines: [], oasisDate: '2026-01-01', fipsCounty: 'FL001',
        admission: mockAdmission, patient: mockPatient, practice: mockPractice,
        attendingProvider: mockProvider, payer: mockPayer } as any),
      /hippsCode is required/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VB-7: generateNOA — TOB 032A, placeholder HIPPS 1AA11
// ─────────────────────────────────────────────────────────────────────────────
describe('VB-7 | generateNOA content', () => {
  async function buildNOA(overrides: Partial<Parameters<any>[0]> = {}) {
    const { generateNOA } = await import('../server/services/edi-generator-institutional.js');
    return generateNOA({
      isa15: 'T',
      noaType: 'original',
      patientControlNumber: 'NOA001',
      admission: mockAdmission,
      patient: mockPatient,
      practice: mockPractice,
      attendingProvider: mockProvider,
      payer: mockPayer,
      totalCharge: 0,
      ...overrides,
    });
  }

  it('NOA has TOB 032A in CLM05', async () => {
    const { edi } = await buildNOA();
    assert.ok(edi.includes('32:1:A'), 'NOA CLM05 should contain "32:1:A"');
  });

  it('NOA has placeholder HIPPS 1AA11 on 0023 line', async () => {
    const { edi } = await buildNOA();
    assert.ok(edi.includes('SV2*0023*HH:1AA11'), 'NOA 0023 line with placeholder HIPPS 1AA11');
  });

  it('NOA cancel has TOB 032D', async () => {
    const { edi } = await buildNOA({ noaType: 'cancel' });
    assert.ok(edi.includes('32:1:D'), 'Cancel NOA CLM05 should contain "32:1:D"');
  });

  it('NOA uses 837I version code', async () => {
    const { edi } = await buildNOA();
    assert.ok(edi.includes('005010X223A2'), 'NOA must use 837I institutional version code');
  });

  it('NOA has NO occurrence code 50', async () => {
    const { edi } = await buildNOA();
    assert.ok(!edi.includes('BH:50'), 'NOA must NOT carry occurrence code 50 (OASIS date)');
  });

  it('NOA has NO value codes 85/61', async () => {
    const { edi } = await buildNOA();
    assert.ok(!edi.includes('BE:85'), 'NOA must NOT carry value code 85');
    assert.ok(!edi.includes('BE:61'), 'NOA must NOT carry value code 61');
  });

  it('rpTransmitted.noaType = "original"', async () => {
    const { rpTransmitted } = await buildNOA();
    assert.equal(rpTransmitted.noaType, 'original');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VB-8: ISA15 guard — both generators default to 'T'
// ─────────────────────────────────────────────────────────────────────────────
describe('VB-8 | ISA15 guard', () => {
  it('generate837I ISA element 15 is T when isa15 omitted', async () => {
    const { generate837I } = await import('../server/services/edi-generator-institutional.js');
    const { edi } = generate837I({
      claimFrequencyCode: '2', patientControlNumber: 'VB8TEST', totalCharge: 100,
      hippsCode: 'BB222', visitLines: [], oasisDate: '2026-06-01', fipsCounty: 'FL001',
      admission: mockAdmission, patient: mockPatient, practice: mockPractice,
      attendingProvider: mockProvider, payer: mockPayer,
    });
    // ISA15 is the 16th element (index 15) of the ISA segment:
    //   ISA*00*          *00*          *ZZ*sender*ZZ*receiver*date*time*:*00501*ctrl*0*T*:~
    // Index: 0   1       2    3        4    5      6    7       8    9  10  11    12   13 14 15 16
    const isaSegment = edi.split('~')[0];
    const isaElements = isaSegment.split('*');
    assert.equal(isaElements[15], 'T', `ISA element[15] should be T, got "${isaElements[15]}"`);
  });

  it('generateNOA ISA contains T when isa15 omitted', async () => {
    const { generateNOA } = await import('../server/services/edi-generator-institutional.js');
    const { edi } = generateNOA({
      noaType: 'original', patientControlNumber: 'VB8NOA', admission: mockAdmission,
      patient: mockPatient, practice: mockPractice, attendingProvider: mockProvider, payer: mockPayer,
    });
    assert.ok(edi.includes('*T*'), 'NOA ISA15 should be T by default');
  });

  it('rpTransmitted.transactionSet is 837I for both generators', async () => {
    const { generate837I, generateNOA } = await import('../server/services/edi-generator-institutional.js');
    const r1 = generate837I({
      isa15: 'T', claimFrequencyCode: '4', patientControlNumber: 'X', totalCharge: 100,
      hippsCode: 'CC333', visitLines: [], oasisDate: '2026-06-01', fipsCounty: 'FL001',
      admission: mockAdmission, patient: mockPatient, practice: mockPractice,
      attendingProvider: mockProvider, payer: mockPayer,
    });
    const r2 = generateNOA({ isa15: 'T', noaType: 'original', patientControlNumber: 'Y',
      admission: mockAdmission, patient: mockPatient, practice: mockPractice,
      attendingProvider: mockProvider, payer: mockPayer });
    assert.equal(r1.rpTransmitted.transactionSet, '837I');
    assert.equal(r2.rpTransmitted.transactionSet, '837I');
  });
});
