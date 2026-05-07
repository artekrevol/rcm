/**
 * Unit tests for buildSegment().
 *
 * Run with: npx tsx server/services/edi/segment-builder.test.ts
 * Exits 0 on all-pass, 1 on any failure.
 * No jest/vitest dependency.
 */

import { buildSegment } from './segment-builder';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function it(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  [PASS] ${name}`); }
  catch (err: any) {
    failed++;
    failures.push(`${name}: ${err?.message ?? err}`);
    console.log(`  [FAIL] ${name}\n         ${err?.message ?? err}`);
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

console.log('segment-builder — buildSegment() unit tests');
console.log('============================================\n');

// ── Canonical examples from the task spec ─────────────────────────────────────

it('NM1 with middle name (COIT) — elements fill gap at 6,7', () => {
  const result = buildSegment('NM1', {
    1: 'IL', 2: '1', 3: 'Mandler', 4: 'PETER', 5: 'COIT',
    8: 'MI', 9: '1636711604',
  });
  assert(
    result === 'NM1*IL*1*Mandler*PETER*COIT***MI*1636711604~',
    `got: ${result}`
  );
});

it('NM1 without middle name — four asterisks between PETER and MI', () => {
  const result = buildSegment('NM1', {
    1: 'IL', 2: '1', 3: 'Mandler', 4: 'PETER',
    8: 'MI', 9: '1636711604',
  });
  assert(
    result === 'NM1*IL*1*Mandler*PETER****MI*1636711604~',
    `got: ${result}`
  );
});

it('SBR with only SBR01/02/09 — six empty elements in middle', () => {
  const result = buildSegment('SBR', { 1: 'P', 2: '18', 9: 'CH' });
  assert(
    result === 'SBR*P*18*******CH~',
    `got: ${result}`
  );
});

it('HL with gap at element 2', () => {
  const result = buildSegment('HL', { 1: '1', 3: '20', 4: '1' });
  assert(result === 'HL*1**20*1~', `got: ${result}`);
});

it('SE with no gaps', () => {
  const result = buildSegment('SE', { 1: '82', 2: '0001' });
  assert(result === 'SE*82*0001~', `got: ${result}`);
});

it('NM1 with only four elements — no trailing empties', () => {
  const result = buildSegment('NM1', { 1: 'IL', 2: '1', 3: 'Mandler', 4: 'PETER' });
  assert(result === 'NM1*IL*1*Mandler*PETER~', `got: ${result}`);
});

// ── Additional structural cases ───────────────────────────────────────────────

it('single element, no gaps', () => {
  assert(buildSegment('LX', { 1: '1' }) === 'LX*1~');
});

it('empty elements map returns just id + terminator', () => {
  assert(buildSegment('XX', {}) === 'XX~');
});

it('null/undefined values become empty string', () => {
  const result = buildSegment('REF', { 1: 'G1', 2: null, 3: undefined });
  assert(result === 'REF*G1~', `trailing empties not stripped — got: ${result}`);
});

it('trailing empty elements are stripped', () => {
  const result = buildSegment('DTP', { 1: '472', 2: 'D8', 3: '', 4: '' });
  assert(result === 'DTP*472*D8~', `got: ${result}`);
});

it('interior empty element is preserved', () => {
  const result = buildSegment('CLM', { 1: 'CTL001', 2: '250.00', 5: '12:B:1', 6: 'Y', 7: 'A', 8: 'Y', 9: 'Y' });
  assert(
    result === 'CLM*CTL001*250.00***12:B:1*Y*A*Y*Y~',
    `got: ${result}`
  );
});

it('numeric values coerced to string', () => {
  const result = buildSegment('SV1', { 1: 'HC:T1019', 2: 100.00 as any, 3: 'UN', 4: 4 as any, 7: '1' });
  assert(result === 'SV1*HC:T1019*100*UN*4***1~', `got: ${result}`);
});

it('colons in values are allowed (composite elements)', () => {
  const result = buildSegment('HI', { 1: 'ABK:F0390', 2: 'ABF:I10' });
  assert(result === 'HI*ABK:F0390*ABF:I10~', `got: ${result}`);
});

// ── Custom separators ─────────────────────────────────────────────────────────

it('custom elementSep and segmentTerm', () => {
  const result = buildSegment('ST', { 1: '837', 2: '0001' }, { elementSep: '|', segmentTerm: '\n' });
  assert(result === 'ST|837|0001\n', `got: ${result}`);
});

// ── Guard rails — throws on separator chars in values ─────────────────────────

it('throws when value contains element separator (*)', () => {
  let threw = false;
  try { buildSegment('NM1', { 1: 'IL', 2: '1*bad' }); }
  catch (e: any) { threw = true; assert(e.message.includes('NM1'), e.message); }
  assert(threw, 'expected throw for * in value');
});

it('throws when value contains segment terminator (~)', () => {
  let threw = false;
  try { buildSegment('REF', { 1: 'G1', 2: 'bad~value' }); }
  catch (e: any) { threw = true; assert(e.message.includes('REF'), e.message); }
  assert(threw, 'expected throw for ~ in value');
});

it('error message includes segment id, element position, and truncated value', () => {
  let msg = '';
  try { buildSegment('CLM', { 1: 'has*star' }); }
  catch (e: any) { msg = e.message; }
  assert(msg.includes('CLM'), `missing segment id in: ${msg}`);
  assert(msg.includes('1'), `missing element position in: ${msg}`);
  assert(msg.includes('has*star'), `missing value excerpt in: ${msg}`);
});

// ── ISA-specific: spaces in values are preserved ──────────────────────────────

it('spaces in values are preserved (ISA02/ISA04)', () => {
  const tenSpaces = '          ';
  const result = buildSegment('ISA', { 1: '03', 2: tenSpaces, 3: '00', 4: tenSpaces });
  assert(result.includes(tenSpaces), `spaces stripped — got: ${result}`);
});

// ── Result ────────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)\n`);

if (failed > 0) {
  console.error('segment-builder tests FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
} else {
  console.log('All segment-builder tests passed.');
  process.exit(0);
}
