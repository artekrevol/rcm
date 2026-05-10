/**
 * Tests for the X12 Base 837P pack.
 * Each rule is tested with passing and failing fixtures including boundary cases.
 */

import { x12Base837pPack } from './x12-base-837p.js';
import type { ClaimWithRelations, RuleContext, PracticeRecord, NormalizedServiceLine } from '../engine/types.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) { console.log(`  [PASS] ${label}`); passed++; }
  else { console.error(`  [FAIL] ${label}`); failed++; }
}

function makePractice(): PracticeRecord {
  return {
    id: 'p1', practiceName: 'Test', primaryNpi: '1234567893', taxId: '123456789',
    taxonomyCode: '253Z00000X',
    address: { line1: '100 Main St', city: 'Anytown', state: 'CA', zip: '94080' },
    agencyNpi: null,
  };
}

function makeLine(overrides: Partial<NormalizedServiceLine> = {}): NormalizedServiceLine {
  return { index: 0, hcpcsCode: 'G0156', units: 4, charge: 228, modifier: null, diagnosisPointer: 'A', serviceDate: '2026-01-15', serviceDateTo: null, ...overrides };
}

function makeClaim(overrides: Partial<ClaimWithRelations> = {}): ClaimWithRelations {
  return {
    id: 'c1', patientId: 'p1', organizationId: 'o1', status: 'draft',
    payerFkId: 'pay1', payerName: 'Test Payer', serviceDate: '2026-01-15',
    placeOfService: '12', authorizationNumber: 'AUTH1', referringProviderId: null,
    icd10Codes: ['Z74.2'],
    serviceLines: [makeLine()],
    claimFrequencyCode: '1', amount: 228,
    patient: { id: 'p1', firstName: 'JOHN', lastName: 'DOE', middleName: null, dob: '1970-01-01', sex: 'M', memberId: '9999999999', veteranIdType: 'edipi', address: { state: 'CA', zip: '94080' } },
    payerRecord: { id: 'pay1', name: 'Test Payer', payerId: 'TEST', payerClassification: 'commercial', claimFilingIndicator: 'CI', memberIdQualifier: 'MI', referringProviderPolicy: 'required', authRequired: false },
    auth: null, referringProvider: null,
    ...overrides,
  };
}

function ctx(claim: ClaimWithRelations): RuleContext {
  return { claim, practice: makePractice(), today: new Date('2026-05-08') };
}

function runRule(ruleId: string, claim: ClaimWithRelations) {
  const rule = x12Base837pPack.rules.find(r => r.id === ruleId)!;
  if (!rule) throw new Error(`Rule ${ruleId} not found in base pack`);
  return rule.check(ctx(claim));
}

console.log('\n=== X12 Base 837P pack tests ===\n');

// X12-CHARGE-POSITIVE
{
  assert(runRule('X12-CHARGE-POSITIVE', makeClaim()) === null, 'CHARGE-POSITIVE: passes on valid charge');
  assert(runRule('X12-CHARGE-POSITIVE', makeClaim({ serviceLines: [makeLine({ charge: 0 })] })) !== null, 'CHARGE-POSITIVE: fails on $0 charge');
  assert(runRule('X12-CHARGE-POSITIVE', makeClaim({ serviceLines: [makeLine({ charge: -1 })] })) !== null, 'CHARGE-POSITIVE: fails on negative charge');
  const result = runRule('X12-CHARGE-POSITIVE', makeClaim({ serviceLines: [makeLine({ charge: 0.01 })] }));
  assert(result === null, 'CHARGE-POSITIVE: passes on $0.01');
}

// X12-CHARGE-UNDER-CAP
{
  assert(runRule('X12-CHARGE-UNDER-CAP', makeClaim()) === null, 'CHARGE-UNDER-CAP: passes on $228');
  assert(runRule('X12-CHARGE-UNDER-CAP', makeClaim({ serviceLines: [makeLine({ charge: 999999 })] })) === null, 'CHARGE-UNDER-CAP: passes on $999,999');
  assert(runRule('X12-CHARGE-UNDER-CAP', makeClaim({ serviceLines: [makeLine({ charge: 1_000_000 })] })) !== null, 'CHARGE-UNDER-CAP: fails on exactly $1M');
  assert(runRule('X12-CHARGE-UNDER-CAP', makeClaim({ serviceLines: [makeLine({ charge: 2_000_000 })] })) !== null, 'CHARGE-UNDER-CAP: fails on $2M');
}

// X12-UNITS-AT-LEAST-ONE
{
  assert(runRule('X12-UNITS-AT-LEAST-ONE', makeClaim()) === null, 'UNITS: passes on 4 units');
  assert(runRule('X12-UNITS-AT-LEAST-ONE', makeClaim({ serviceLines: [makeLine({ units: 1 })] })) === null, 'UNITS: passes on exactly 1 unit');
  assert(runRule('X12-UNITS-AT-LEAST-ONE', makeClaim({ serviceLines: [makeLine({ units: 0 })] })) !== null, 'UNITS: fails on 0 units');
  assert(runRule('X12-UNITS-AT-LEAST-ONE', makeClaim({ serviceLines: [makeLine({ units: -1 })] })) !== null, 'UNITS: fails on -1 units');
}

// X12-DX-FORMAT-ICD10
{
  // ── Valid formats (pass) ──────────────────────────────────────────────────
  assert(runRule('X12-DX-FORMAT-ICD10', makeClaim({ icd10Codes: ['Z74.2'] })) === null,  'DX-FORMAT: passes Z74.2 (3+decimal)');
  assert(runRule('X12-DX-FORMAT-ICD10', makeClaim({ icd10Codes: ['M54.5'] })) === null,  'DX-FORMAT: passes M54.5');
  assert(runRule('X12-DX-FORMAT-ICD10', makeClaim({ icd10Codes: ['I10'] })) === null,    'DX-FORMAT: passes I10 (3-char, no decimal)');
  assert(runRule('X12-DX-FORMAT-ICD10', makeClaim({ icd10Codes: ['F0390'] })) === null,  'DX-FORMAT: passes F0390 (5-char, no decimal — claim 4809034a)');
  assert(runRule('X12-DX-FORMAT-ICD10', makeClaim({ icd10Codes: ['R269'] })) === null,   'DX-FORMAT: passes R269 (4-char, no decimal — claim 4809034a)');
  assert(runRule('X12-DX-FORMAT-ICD10', makeClaim({ icd10Codes: ['Z51.11'] })) === null, 'DX-FORMAT: passes Z51.11 (decimal form — claim 4809034a)');
  assert(runRule('X12-DX-FORMAT-ICD10', makeClaim({ icd10Codes: [] })) === null,         'DX-FORMAT: passes on empty (no dx)');

  // ── Invalid formats (fail) ────────────────────────────────────────────────
  // ICD-9 numeric codes — start with a digit, never valid ICD-10-CM
  assert(runRule('X12-DX-FORMAT-ICD10', makeClaim({ icd10Codes: ['274.2'] })) !== null,  'DX-FORMAT: fails on legacy ICD-9 format (digit-first)');
  assert(runRule('X12-DX-FORMAT-ICD10', makeClaim({ icd10Codes: ['27422'] })) !== null,  'DX-FORMAT: fails on digit-first code (ICD-9 style)');
  // U-prefix reserved for provisional/emergency codes — excluded per X12 5010 TR3
  assert(runRule('X12-DX-FORMAT-ICD10', makeClaim({ icd10Codes: ['U07.1'] })) !== null,  'DX-FORMAT: fails on U-prefix (provisional)');
}

// X12-DX-NO-DUPLICATES
{
  assert(runRule('X12-DX-NO-DUPLICATES', makeClaim({ icd10Codes: ['Z74.2'] })) === null, 'DX-DUPS: passes single code');
  assert(runRule('X12-DX-NO-DUPLICATES', makeClaim({ icd10Codes: ['Z74.2', 'M54.5'] })) === null, 'DX-DUPS: passes two different codes');
  assert(runRule('X12-DX-NO-DUPLICATES', makeClaim({ icd10Codes: ['Z74.2', 'Z74.2'] })) !== null, 'DX-DUPS: fails on duplicate');
  assert(runRule('X12-DX-NO-DUPLICATES', makeClaim({ icd10Codes: ['Z74.2', 'z74.2'] })) !== null, 'DX-DUPS: case-insensitive duplicate detection');
  assert(runRule('X12-DX-NO-DUPLICATES', makeClaim({ icd10Codes: [] })) === null, 'DX-DUPS: passes empty list');
}

// X12-DX-POINTER-VALID
{
  assert(runRule('X12-DX-POINTER-VALID', makeClaim({ icd10Codes: ['Z74.2'], serviceLines: [makeLine({ diagnosisPointer: 'A' })] })) === null, 'DX-PTR: passes A → position 1 of 1');
  assert(runRule('X12-DX-POINTER-VALID', makeClaim({ icd10Codes: ['Z74.2', 'M54.5'], serviceLines: [makeLine({ diagnosisPointer: 'AB' })] })) === null, 'DX-PTR: passes AB → positions 1,2 of 2');
  assert(runRule('X12-DX-POINTER-VALID', makeClaim({ icd10Codes: ['Z74.2'], serviceLines: [makeLine({ diagnosisPointer: 'B' })] })) !== null, 'DX-PTR: fails B → position 2 when only 1 dx exists');
  assert(runRule('X12-DX-POINTER-VALID', makeClaim({ icd10Codes: ['Z74.2'], serviceLines: [makeLine({ diagnosisPointer: '1' })] })) === null, 'DX-PTR: passes numeric pointer 1');
  assert(runRule('X12-DX-POINTER-VALID', makeClaim({ icd10Codes: ['Z74.2'], serviceLines: [makeLine({ diagnosisPointer: '2' })] })) !== null, 'DX-PTR: fails numeric pointer 2 when only 1 dx');
}

// X12-CLAIM-TOTAL-POSITIVE
{
  assert(runRule('X12-CLAIM-TOTAL-POSITIVE', makeClaim()) === null, 'TOTAL-POS: passes on $228');
  const zeroLines = makeClaim({ serviceLines: [makeLine({ charge: 0 })] });
  assert(runRule('X12-CLAIM-TOTAL-POSITIVE', zeroLines) !== null, 'TOTAL-POS: fails when all lines are $0');
}

// X12-CLAIM-TOTAL-RECONCILES
{
  assert(runRule('X12-CLAIM-TOTAL-RECONCILES', makeClaim({ amount: 228, serviceLines: [makeLine({ charge: 228 })] })) === null, 'TOTAL-RECONCILE: passes exact match');
  assert(runRule('X12-CLAIM-TOTAL-RECONCILES', makeClaim({ amount: 228.005, serviceLines: [makeLine({ charge: 228 })] })) === null, 'TOTAL-RECONCILE: passes within $0.01 tolerance');
  const mismatch = runRule('X12-CLAIM-TOTAL-RECONCILES', makeClaim({ amount: 300, serviceLines: [makeLine({ charge: 228 })] }));
  assert(mismatch !== null, 'TOTAL-RECONCILE: fails on $72 discrepancy');
  assert(mismatch?.[0]?.severity === 'warning', 'TOTAL-RECONCILE: severity is warning not error');
}

// X12-LINE-DOS-VALID
{
  assert(runRule('X12-LINE-DOS-VALID', makeClaim()) === null, 'DOS-VALID: passes on past date');
  const futureDate = new Date(); futureDate.setFullYear(futureDate.getFullYear() + 1);
  const futureClaim = makeClaim({ serviceLines: [makeLine({ serviceDate: futureDate.toISOString().slice(0, 10) })] });
  assert(runRule('X12-LINE-DOS-VALID', futureClaim) !== null, 'DOS-VALID: fails on future date');
  const missingDate = makeClaim({ serviceDate: null, serviceLines: [makeLine({ serviceDate: null })] });
  assert(runRule('X12-LINE-DOS-VALID', missingDate) !== null, 'DOS-VALID: fails on missing date');
  const invalidDate = makeClaim({ serviceLines: [makeLine({ serviceDate: 'not-a-date' })] });
  assert(runRule('X12-LINE-DOS-VALID', invalidDate) !== null, 'DOS-VALID: fails on invalid date string');
}

// X12-VALID-STATE-CODE
{
  assert(runRule('X12-VALID-STATE-CODE', makeClaim()) === null, 'STATE: passes on CA');
  const badState = makeClaim({ patient: { ...makeClaim().patient, address: { state: 'XX', zip: '94080' } } });
  assert(runRule('X12-VALID-STATE-CODE', badState) !== null, 'STATE: fails on XX');
  const military = makeClaim({ patient: { ...makeClaim().patient, address: { state: 'AE', zip: '09012' } } });
  assert(runRule('X12-VALID-STATE-CODE', military) === null, 'STATE: passes on AE (military)');
}

console.log(`\nX12 Base pack tests: ${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0) process.exit(1);
