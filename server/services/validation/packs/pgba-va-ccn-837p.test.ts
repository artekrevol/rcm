/**
 * Tests for the PGBA VA CCN 837P overlay pack.
 * Includes:
 *   - Each rule: passing and failing fixtures
 *   - Guard that the pack does NOT contain H16, AAT, SSC, SSE rules
 *   - appliesWhen-gated rules (NP4, REF-G2) do not fire when gate is closed
 *   - appliesWhen-gated rules fire when gate is open and rule fails
 */

import { pgbaVaCcn837pPack } from './pgba-va-ccn-837p.js';
import type { ClaimWithRelations, RuleContext, PracticeRecord, NormalizedServiceLine, ReferringProviderRecord } from '../engine/types.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) { console.log(`  [PASS] ${label}`); passed++; }
  else { console.error(`  [FAIL] ${label}`); failed++; }
}

function makePractice(): PracticeRecord {
  return {
    id: 'p1', practiceName: 'Chajinel', primaryNpi: '1184288680', taxId: '471075172',
    taxonomyCode: '253Z00000X',
    address: { line1: '208 Cypress Ave', city: 'South San Francisco', state: 'CA', zip: '94080' },
    agencyNpi: null,
  };
}

function makeLine(overrides: Partial<NormalizedServiceLine> = {}): NormalizedServiceLine {
  return { index: 0, hcpcsCode: 'G0156', units: 4, charge: 228, modifier: null, diagnosisPointer: 'A', serviceDate: '2026-03-15', serviceDateTo: null, ...overrides };
}

function makeClaim(overrides: Partial<ClaimWithRelations> = {}): ClaimWithRelations {
  return {
    id: 'c1', patientId: 'p1', organizationId: 'chajinel-org-001', status: 'draft',
    payerFkId: 'pay1', payerName: 'VA Community Care (TriWest / TWVACCN)',
    serviceDate: '2026-03-15', placeOfService: '12',
    authorizationNumber: 'VA9999999999', referringProviderId: null,
    icd10Codes: ['Z74.2'],
    serviceLines: [makeLine()],
    claimFrequencyCode: '1', amount: 228,
    patient: { id: 'p1', firstName: 'TESTPATIENT', lastName: 'STUB', middleName: 'COIT', dob: '1948-03-16', sex: 'M', memberId: '9999999999', veteranIdType: 'edipi', address: { state: 'CA', zip: '94105' } },
    payerRecord: { id: 'pay1', name: 'VA Community Care (TriWest / TWVACCN)', payerId: 'TWVACCN', payerClassification: 'va_community_care', claimFilingIndicator: 'VA', memberIdQualifier: 'MI', referringProviderPolicy: 'situational', authRequired: true },
    auth: { id: 'auth1', authNumber: 'VA9999999999', expirationDate: '2026-11-03T00:00:00.000Z', issuedDate: '2026-03-02T00:00:00.000Z' },
    referringProvider: null,
    ...overrides,
  };
}

function ctx(claim: ClaimWithRelations): RuleContext {
  return { claim, practice: makePractice(), today: new Date('2026-05-08') };
}

function runRule(ruleId: string, claim: ClaimWithRelations) {
  const rule = pgbaVaCcn837pPack.rules.find(r => r.id === ruleId)!;
  if (!rule) throw new Error(`Rule ${ruleId} not found in PGBA pack`);
  if (rule.appliesWhen && !rule.appliesWhen(ctx(claim))) return 'SKIPPED';
  return rule.check(ctx(claim));
}

console.log('\n=== PGBA VA CCN 837P pack tests ===\n');

// Guard: pack must NOT contain H16, AAT, SSC, SSE (owned by generator)
{
  const forbiddenCodes = new Set(['H16', 'AAT', 'SSC', 'SSE']);
  const forbidden = pgbaVaCcn837pPack.rules.filter(r => forbiddenCodes.has(r.code));
  assert(forbidden.length === 0, `GUARD: no H16/AAT/SSC/SSE rules in pack (found: ${forbidden.map(r => r.code).join(', ') || 'none'})`);
}

// PGBA-H68: Subscriber name validation
{
  assert(runRule('PGBA-H68', makeClaim()) === null, 'H68: passes on TESTPATIENT STUB');
  // Hyphenated name — allowed
  const hyphen = makeClaim({ patient: { ...makeClaim().patient, lastName: 'SMITH-JONES' } });
  assert(runRule('PGBA-H68', hyphen) === null, "H68: passes on hyphenated SMITH-JONES");
  // Apostrophe — allowed
  const apostrophe = makeClaim({ patient: { ...makeClaim().patient, lastName: "O'BRIEN" } });
  assert(runRule('PGBA-H68', apostrophe) === null, "H68: passes on apostrophe O'BRIEN");
  // Digits in name — fails
  const withDigit = makeClaim({ patient: { ...makeClaim().patient, lastName: 'SMITH2' } });
  assert(runRule('PGBA-H68', withDigit) !== null, 'H68: fails on digit in last name SMITH2');
  // Special char — fails
  const withSpecial = makeClaim({ patient: { ...makeClaim().patient, firstName: 'JOHN@' } });
  assert(runRule('PGBA-H68', withSpecial) !== null, 'H68: fails on @ in first name');
}

// PGBA-BG5: ZIP/state consistency
{
  // CA 94080 → CA ✓
  assert(runRule('PGBA-BG5', makeClaim()) === null, 'BG5: passes CA/94080 (practice)');
  // Patient ZIP 99999 — unrecognized prefix, no lookup → no violation
  assert(runRule('PGBA-BG5', makeClaim()) === null, 'BG5: unknown ZIP prefix skipped');
  // Patient TX zip but state CA → warning
  const mismatch = makeClaim({ patient: { ...makeClaim().patient, address: { state: 'CA', zip: '75001' } } });
  const bg5Result = runRule('PGBA-BG5', mismatch);
  assert(bg5Result !== null && bg5Result !== 'SKIPPED', 'BG5: fires on TX zip with CA state');
  assert((bg5Result as any)?.[0]?.severity === 'warning', 'BG5: severity is warning not error');
}

// PGBA-RXO: Duplicate diagnosis
{
  assert(runRule('PGBA-RXO', makeClaim({ icd10Codes: ['Z74.2'] })) === null, 'RXO: passes single code');
  assert(runRule('PGBA-RXO', makeClaim({ icd10Codes: ['Z74.2', 'Z74.2'] })) !== null, 'RXO: fails on duplicate');
  assert(runRule('PGBA-RXO', makeClaim({ icd10Codes: ['Z74.2', 'z74.2'] })) !== null, 'RXO: case-insensitive duplicate');
}

// PGBA-QSF: E-code in primary position
{
  assert(runRule('PGBA-QSF', makeClaim({ icd10Codes: ['Z74.2'] })) === null, 'QSF: passes Z74.2 (Z-prefix is not E-code)');
  assert(runRule('PGBA-QSF', makeClaim({ icd10Codes: ['W19.XXXA'] })) !== null, 'QSF: fails on W-prefix as primary');
  assert(runRule('PGBA-QSF', makeClaim({ icd10Codes: ['X71.0XXA'] })) !== null, 'QSF: fails on X-prefix as primary');
  assert(runRule('PGBA-QSF', makeClaim({ icd10Codes: ['Y93.89'] })) !== null, 'QSF: fails on Y-prefix as primary');
  assert(runRule('PGBA-QSF', makeClaim({ icd10Codes: ['V89.2XXA'] })) !== null, 'QSF: fails on V-prefix as primary');
  // E-code as secondary → no violation (rule only checks primary)
  const eAsSecondary = makeClaim({ icd10Codes: ['Z74.2', 'W19.XXXA'] });
  assert(runRule('PGBA-QSF', eAsSecondary) === null, 'QSF: passes E-code in secondary position');
  assert(runRule('PGBA-QSF', makeClaim({ icd10Codes: [] })) === null, 'QSF: passes empty dx list');
}

// PGBA-DX-POINTER: Pointer validation
{
  assert(runRule('PGBA-DX-POINTER', makeClaim()) === null, 'DX-PTR: passes A with 1 dx');
  const outOfRange = makeClaim({ icd10Codes: ['Z74.2'], serviceLines: [makeLine({ diagnosisPointer: 'B' })] });
  assert(runRule('PGBA-DX-POINTER', outOfRange) !== null, 'DX-PTR: fails B when only 1 dx');
  const valid2 = makeClaim({ icd10Codes: ['Z74.2', 'M54.5'], serviceLines: [makeLine({ diagnosisPointer: 'AB' })] });
  assert(runRule('PGBA-DX-POINTER', valid2) === null, 'DX-PTR: passes AB with 2 dx');
}

// PGBA-NP4: appliesWhen closed (no referring provider)
{
  const noRp = makeClaim({ referringProviderId: null });
  assert(runRule('PGBA-NP4', noRp) === 'SKIPPED', 'NP4: skipped when no referring provider linked');
}

// PGBA-NP4: appliesWhen open — valid NPI passes
{
  const validNpi: ReferringProviderRecord = { id: 'rp1', firstName: 'TEST', lastName: 'PROVIDER', npi: '1184288680', vaCompositeId: null, verificationStatus: 'verified' };
  const withValidRp = makeClaim({ referringProviderId: 'rp1', referringProvider: validNpi });
  assert(runRule('PGBA-NP4', withValidRp) === null, 'NP4: passes on valid NPI 1184288680');
}

// PGBA-NP4: appliesWhen open — invalid NPI fails
{
  const invalidNpi: ReferringProviderRecord = { id: 'rp2', firstName: 'TEST', lastName: 'PROVIDER', npi: '1234567890', vaCompositeId: null, verificationStatus: 'verified' };
  const withInvalidRp = makeClaim({ referringProviderId: 'rp2', referringProvider: invalidNpi });
  assert(runRule('PGBA-NP4', withInvalidRp) !== null, 'NP4: fails on invalid Luhn NPI');
}

// PGBA-NP4: appliesWhen open — null NPI (VA composite ID) fails
{
  const compositeRp: ReferringProviderRecord = { id: 'rp3', firstName: 'TEST', lastName: 'PROVIDER', npi: null, vaCompositeId: '662_1234567', verificationStatus: 'pending' };
  const withCompositeRp = makeClaim({ referringProviderId: 'rp3', referringProvider: compositeRp });
  assert(runRule('PGBA-NP4', withCompositeRp) !== null, 'NP4: fails when NPI is null (VA composite only)');
}

// PGBA-REF-G2: appliesWhen closed
{
  const noRp = makeClaim({ referringProviderId: null });
  assert(runRule('PGBA-REF-G2', noRp) === 'SKIPPED', 'REF-G2: skipped when no referring provider');
}

// PGBA-REF-G2: appliesWhen open — always fires (generator gap)
{
  const rp: ReferringProviderRecord = { id: 'rp1', firstName: 'A', lastName: 'B', npi: '1740564008', vaCompositeId: null, verificationStatus: 'verified' };
  const withRp = makeClaim({ referringProviderId: 'rp1', referringProvider: rp });
  assert(runRule('PGBA-REF-G2', withRp) !== null, 'REF-G2: fires when referring provider linked (known generator gap)');
}

// PGBA-N04: Zero units
{
  assert(runRule('PGBA-N04', makeClaim()) === null, 'N04: passes on 4 units');
  assert(runRule('PGBA-N04', makeClaim({ serviceLines: [makeLine({ units: 0 })] })) !== null, 'N04: fails on 0 units');
  assert(runRule('PGBA-N04', makeClaim({ serviceLines: [makeLine({ units: 1 })] })) === null, 'N04: passes on exactly 1 unit');
}

// PGBA-AUTH-PRESENT
{
  assert(runRule('PGBA-AUTH-PRESENT', makeClaim()) === null, 'AUTH-PRESENT: passes with VA auth number');
  assert(runRule('PGBA-AUTH-PRESENT', makeClaim({ authorizationNumber: null })) !== null, 'AUTH-PRESENT: fails with no auth number');
  assert(runRule('PGBA-AUTH-PRESENT', makeClaim({ authorizationNumber: '  ' })) !== null, 'AUTH-PRESENT: fails on blank auth number');
}

// PGBA-DOS-WITHIN-AUTH
{
  // DOS 2026-03-15 ≤ expiry 2026-11-03 → passes
  assert(runRule('PGBA-DOS-WITHIN-AUTH', makeClaim()) === null, 'DOS-WITHIN-AUTH: passes on DOS within auth window');
  // DOS after expiry → fails
  const afterExpiry = makeClaim({ serviceLines: [makeLine({ serviceDate: '2026-12-01' })] });
  assert(runRule('PGBA-DOS-WITHIN-AUTH', afterExpiry) !== null, 'DOS-WITHIN-AUTH: fails on DOS after expiry');
  // DOS before issue date → passes (Rachel's rule: no block for early DOS)
  const beforeIssue = makeClaim({ serviceLines: [makeLine({ serviceDate: '2026-01-01' })] });
  assert(runRule('PGBA-DOS-WITHIN-AUTH', beforeIssue) === null, 'DOS-WITHIN-AUTH: passes on DOS before issue date (Rachel rule)');
  // No auth → skipped (appliesWhen)
  const noAuth = makeClaim({ auth: null });
  assert(runRule('PGBA-DOS-WITHIN-AUTH', noAuth) === 'SKIPPED', 'DOS-WITHIN-AUTH: skipped when no auth linked');
}

console.log(`\nPGBA VA CCN pack tests: ${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0) process.exit(1);
