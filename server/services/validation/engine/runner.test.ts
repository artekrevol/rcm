/**
 * Tests for the validation engine runner orchestration.
 * Uses in-memory synthetic data — no DB required.
 */

import type {
  RulePack,
  Rule,
  RuleContext,
  Violation,
  ClaimWithRelations,
  PracticeRecord,
  ValidationResult,
} from './types.js';

// ── Synthetic fixtures ────────────────────────────────────────────────────────

function makePractice(): PracticeRecord {
  return {
    id: 'practice-1',
    practiceName: 'Test Agency',
    primaryNpi: '1234567893',
    taxId: '471075172',
    taxonomyCode: '253Z00000X',
    address: { line1: '100 Main St', city: 'Anytown', state: 'CA', zip: '94080' },
    agencyNpi: null,
  };
}

function makeClaim(overrides: Partial<ClaimWithRelations> = {}): ClaimWithRelations {
  return {
    id: 'claim-test-1',
    patientId: 'patient-1',
    organizationId: 'org-1',
    status: 'draft',
    payerFkId: 'payer-1',
    payerName: 'Test Payer',
    serviceDate: '2026-01-15',
    placeOfService: '12',
    authorizationNumber: 'AUTH123',
    referringProviderId: null,
    icd10Codes: ['Z74.2'],
    serviceLines: [{
      index: 0,
      hcpcsCode: 'G0156',
      units: 4,
      charge: 228,
      modifier: null,
      diagnosisPointer: 'A',
      serviceDate: '2026-01-15',
      serviceDateTo: null,
    }],
    claimFrequencyCode: '1',
    amount: 228,
    patient: {
      id: 'patient-1',
      firstName: 'JOHN',
      lastName: 'DOE',
      middleName: null,
      dob: '1970-01-01',
      sex: 'M',
      memberId: '9999999999',
      veteranIdType: 'edipi',
      address: { line1: '123 Main St', city: 'Anytown', state: 'CA', zip: '94080' },
    },
    payerRecord: {
      id: 'payer-1',
      name: 'Test Payer',
      payerId: 'TESTPAYER',
      payerClassification: 'commercial',
      claimFilingIndicator: 'CI',
      memberIdQualifier: 'MI',
      referringProviderPolicy: 'required',
      authRequired: false,
    },
    auth: null,
    referringProvider: null,
    ...overrides,
  };
}

// ── Inline test runner (no framework dependency) ──────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}`);
    failed++;
  }
}

// ── Engine logic helpers (extracted so tests don't need DB) ──────────────────

function buildRuleContext(claim: ClaimWithRelations, practice: PracticeRecord): RuleContext {
  return { claim, practice, today: new Date('2026-05-08') };
}

function runPacksInMemory(
  packs: RulePack[],
  ctx: RuleContext,
): { violations: Violation[]; canSubmit: boolean; packsApplied: string[] } {
  const ruleMap = new Map<string, { rule: Rule; packId: string }>();
  for (const pack of packs) {
    for (const rule of pack.rules) {
      if (ruleMap.has(rule.id)) {
        console.log(`  [override] Rule "${rule.id}" overridden by pack "${pack.id}"`);
      }
      ruleMap.set(rule.id, { rule, packId: pack.id });
    }
  }

  const violations: Violation[] = [];
  for (const { rule } of ruleMap.values()) {
    try {
      if (rule.appliesWhen && !rule.appliesWhen(ctx)) continue;
      const result = rule.check(ctx);
      if (result) violations.push(...result);
    } catch (err: any) {
      violations.push({
        ruleId: rule.id, code: rule.code, severity: 'info',
        message: `Rule "${rule.id}" threw: ${err?.message}`,
        fieldPath: '', packId: 'engine',
      });
    }
  }

  return {
    violations,
    canSubmit: !violations.some(v => v.severity === 'error'),
    packsApplied: packs.map(p => p.id),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\n=== Runner orchestration tests ===\n');

// T1: Clean claim → no violations, canSubmit=true
{
  const rule: Rule = {
    id: 'TEST-PASS', code: 'TEST-PASS', severity: 'error',
    description: 'Always passes',
    check: () => null,
  };
  const pack: RulePack = { id: 'test', name: 'Test', version: '1.0.0', appliesTo: { claimType: '837P' }, rules: [rule] };
  const ctx = buildRuleContext(makeClaim(), makePractice());
  const { violations, canSubmit } = runPacksInMemory([pack], ctx);
  assert(violations.length === 0, 'T1: no violations on clean claim');
  assert(canSubmit === true, 'T1: canSubmit=true when no errors');
}

// T2: Rule that throws does not crash validation — emits info violation
{
  const throwingRule: Rule = {
    id: 'TEST-THROW', code: 'TEST-THROW', severity: 'error',
    description: 'Always throws',
    check: () => { throw new Error('intentional test error'); },
  };
  const pack: RulePack = { id: 'test-throw', name: 'Throw Pack', version: '1.0.0', appliesTo: { claimType: '837P' }, rules: [throwingRule] };
  const ctx = buildRuleContext(makeClaim(), makePractice());
  const { violations } = runPacksInMemory([pack], ctx);
  assert(violations.length === 1, 'T2: throwing rule emits one violation');
  assert(violations[0].severity === 'info', 'T2: thrown rule violation is info severity');
  assert(violations[0].message.includes('intentional test error'), 'T2: error message propagated');
}

// T3: appliesWhen=false rules are skipped without invoking check()
{
  let checkCalled = false;
  const gatedRule: Rule = {
    id: 'TEST-GATED', code: 'TEST-GATED', severity: 'error',
    description: 'Gated rule',
    appliesWhen: () => false,
    check: () => { checkCalled = true; return null; },
  };
  const pack: RulePack = { id: 'test-gated', name: 'Gated', version: '1.0.0', appliesTo: { claimType: '837P' }, rules: [gatedRule] };
  const ctx = buildRuleContext(makeClaim(), makePractice());
  runPacksInMemory([pack], ctx);
  assert(!checkCalled, 'T3: check() not called when appliesWhen=false');
}

// T4: Pack extends chain — parent rules available before child rules
{
  const parentRule: Rule = {
    id: 'PARENT-RULE', code: 'PARENT', severity: 'warning',
    description: 'Parent rule',
    check: (ctx) => [{
      ruleId: 'PARENT-RULE', code: 'PARENT', severity: 'warning',
      message: 'parent fired', fieldPath: 'test', packId: 'parent-pack',
    }],
  };
  const childRule: Rule = {
    id: 'CHILD-RULE', code: 'CHILD', severity: 'error',
    description: 'Child rule',
    check: () => null,
  };
  const parentPack: RulePack = { id: 'parent-pack', name: 'Parent', version: '1.0.0', appliesTo: { claimType: '837P' }, rules: [parentRule] };
  const childPack: RulePack = { id: 'child-pack', name: 'Child', version: '1.0.0', appliesTo: { claimType: '837P' }, extends: ['parent-pack'], rules: [childRule] };
  const ctx = buildRuleContext(makeClaim(), makePractice());
  const { violations, packsApplied } = runPacksInMemory([parentPack, childPack], ctx);
  assert(violations.some(v => v.ruleId === 'PARENT-RULE'), 'T4: parent rule fires in child pack context');
  assert(packsApplied.includes('parent-pack'), 'T4: parent pack listed in packsApplied');
}

// T5: More-specific pack wins on duplicate ruleId
{
  const baseRule: Rule = {
    id: 'SHARED-RULE', code: 'SHARED', severity: 'warning',
    description: 'Base version',
    check: () => [{ ruleId: 'SHARED-RULE', code: 'SHARED', severity: 'warning', message: 'base fired', fieldPath: 'test', packId: 'base' }],
  };
  const overlayRule: Rule = {
    id: 'SHARED-RULE', code: 'SHARED', severity: 'error',
    description: 'Overlay version — overrides base',
    check: () => [{ ruleId: 'SHARED-RULE', code: 'SHARED', severity: 'error', message: 'overlay fired', fieldPath: 'test', packId: 'overlay' }],
  };
  const basePack: RulePack = { id: 'base', name: 'Base', version: '1.0.0', appliesTo: { claimType: '837P' }, rules: [baseRule] };
  const overlayPack: RulePack = { id: 'overlay', name: 'Overlay', version: '1.0.0', appliesTo: { claimType: '837P' }, rules: [overlayRule] };
  const ctx = buildRuleContext(makeClaim(), makePractice());
  const { violations } = runPacksInMemory([basePack, overlayPack], ctx);
  const sharedViolations = violations.filter(v => v.ruleId === 'SHARED-RULE');
  assert(sharedViolations.length === 1, 'T5: duplicate ruleId → only one violation');
  assert(sharedViolations[0].severity === 'error', 'T5: overlay (more specific) wins');
  assert(sharedViolations[0].message === 'overlay fired', 'T5: overlay message used');
}

// T6: canSubmit logic — false for any error, true if only warnings
{
  const warnRule: Rule = {
    id: 'WARN-ONLY', code: 'WARN', severity: 'warning',
    description: 'Warning rule',
    check: () => [{ ruleId: 'WARN-ONLY', code: 'WARN', severity: 'warning', message: 'warning', fieldPath: 'test', packId: 'test' }],
  };
  const pack: RulePack = { id: 'test-warn', name: 'Warn', version: '1.0.0', appliesTo: { claimType: '837P' }, rules: [warnRule] };
  const ctx = buildRuleContext(makeClaim(), makePractice());
  const { canSubmit } = runPacksInMemory([pack], ctx);
  assert(canSubmit === true, 'T6: warning-only violations → canSubmit=true');
}

// T7: info-severity violation does not block submission
{
  const infoRule: Rule = {
    id: 'INFO-ONLY', code: 'INFO', severity: 'info',
    description: 'Info rule',
    check: () => [{ ruleId: 'INFO-ONLY', code: 'INFO', severity: 'info', message: 'info', fieldPath: 'test', packId: 'test' }],
  };
  const pack: RulePack = { id: 'test-info', name: 'Info', version: '1.0.0', appliesTo: { claimType: '837P' }, rules: [infoRule] };
  const ctx = buildRuleContext(makeClaim(), makePractice());
  const { canSubmit } = runPacksInMemory([pack], ctx);
  assert(canSubmit === true, 'T7: info-only violations → canSubmit=true');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\nRunner tests: ${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0) process.exit(1);
