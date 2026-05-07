/**
 * Unit tests for parseSegment() and parseEdi().
 *
 * Run with: npx tsx server/services/edi/segment-parser.test.ts
 * Exits 0 on all-pass, 1 on any failure.
 * No jest/vitest dependency.
 */

import { parseSegment, parseEdi } from './segment-parser';

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

console.log('segment-parser — parseSegment() / parseEdi() unit tests');
console.log('=========================================================\n');

// ── parseSegment ──────────────────────────────────────────────────────────────

it('parses id correctly', () => {
  const { id } = parseSegment('NM1*IL*1*Mandler~');
  assert(id === 'NM1', `expected 'NM1', got '${id}'`);
});

it('elements are 1-indexed (elements[0] is undefined)', () => {
  const { elements } = parseSegment('NM1*IL*1~');
  assert(elements[0] === undefined, `elements[0] should be undefined`);
  assert(elements[1] === 'IL',      `elements[1] should be 'IL'`);
  assert(elements[2] === '1',       `elements[2] should be '1'`);
});

it('parses NM1*IL full segment with middle name', () => {
  const { id, elements } = parseSegment('NM1*IL*1*Mandler*PETER*COIT***MI*1636711604~');
  assert(id === 'NM1',          `id: ${id}`);
  assert(elements[1] === 'IL',          `NM101: ${elements[1]}`);
  assert(elements[2] === '1',           `NM102: ${elements[2]}`);
  assert(elements[3] === 'Mandler',     `NM103: ${elements[3]}`);
  assert(elements[4] === 'PETER',       `NM104: ${elements[4]}`);
  assert(elements[5] === 'COIT',        `NM105: ${elements[5]}`);
  assert(elements[6] === '',            `NM106 empty: '${elements[6]}'`);
  assert(elements[7] === '',            `NM107 empty: '${elements[7]}'`);
  assert(elements[8] === 'MI',          `NM108: ${elements[8]}`);
  assert(elements[9] === '1636711604',  `NM109: ${elements[9]}`);
  assert(elements.length === 10,        `length: ${elements.length}`);
});

it('empty element at position 5 when no middle name', () => {
  const { elements } = parseSegment('NM1*IL*1*Mandler*PETER****MI*1636711604~');
  assert(elements[5] === '',   `NM105 should be empty: '${elements[5]}'`);
  assert(elements[8] === 'MI', `NM108 should be MI: '${elements[8]}'`);
});

it('strips trailing segment terminator', () => {
  const { id } = parseSegment('SE*82*0001~');
  assert(id === 'SE');
});

it('works without trailing terminator', () => {
  const { id, elements } = parseSegment('SE*82*0001');
  assert(id === 'SE');
  assert(elements[1] === '82');
  assert(elements[2] === '0001');
});

it('preserves empty interior elements', () => {
  const { elements } = parseSegment('SBR*P*18*******CI~');
  assert(elements[1] === 'P',  `SBR01: ${elements[1]}`);
  assert(elements[2] === '18', `SBR02: ${elements[2]}`);
  assert(elements[3] === '',   `SBR03 empty: '${elements[3]}'`);
  assert(elements[9] === 'CI', `SBR09: ${elements[9]}`);
});

it('CLM05 composite is parsed as single element (not split further)', () => {
  const { elements } = parseSegment('CLM*CTL001*250.00***12:B:1*Y*A*Y*Y~');
  assert(elements[1] === 'CTL001',  `CLM01: ${elements[1]}`);
  assert(elements[2] === '250.00',  `CLM02: ${elements[2]}`);
  assert(elements[3] === '',         `CLM03 empty: ${elements[3]}`);
  assert(elements[4] === '',         `CLM04 empty: ${elements[4]}`);
  assert(elements[5] === '12:B:1',   `CLM05 composite: ${elements[5]}`);
  assert(elements[6] === 'Y',        `CLM06: ${elements[6]}`);
  assert(elements[9] === 'Y',        `CLM09: ${elements[9]}`);
});

it('custom elementSep', () => {
  const { id, elements } = parseSegment('ST|837|0001', { elementSep: '|' });
  assert(id === 'ST');
  assert(elements[1] === '837');
  assert(elements[2] === '0001');
});

// ── parseEdi ─────────────────────────────────────────────────────────────────

const MINI_EDI = [
  'ISA*03*          *00*          *ZZ*1234567890     *30*841160004      *260101*1200*^*00501*000123456*0*T*:',
  'GS*HC*1234567890*841160004*20260101*1200*1*X*005010X222A1',
  'ST*837*0001*005010X222A1',
  'CLM*CTL001*250.00***12:B:1*Y*A*Y*Y',
  'SE*4*0001',
  'GE*1*1',
  'IEA*1*000123456',
].join('~\n') + '~';

it('parseEdi returns all segments', () => {
  const segs = parseEdi(MINI_EDI);
  assert(segs.length === 7, `expected 7 segments, got ${segs.length}`);
});

it('parseEdi first segment is ISA', () => {
  const segs = parseEdi(MINI_EDI);
  assert(segs[0].id === 'ISA', `first segment id: ${segs[0].id}`);
  assert(segs[0].elements[15] === 'T', `ISA15 (usage indicator): ${segs[0].elements[15]}`);
});

it('parseEdi can find segment by id', () => {
  const segs = parseEdi(MINI_EDI);
  const clm = segs.find(s => s.id === 'CLM');
  assert(clm !== undefined, 'CLM not found');
  assert(clm!.elements[1] === 'CTL001', `CLM01: ${clm!.elements[1]}`);
  assert(clm!.elements[5] === '12:B:1', `CLM05: ${clm!.elements[5]}`);
});

it('parseEdi handles newline-only joined EDI (new generator format)', () => {
  const edi = 'ISA*03~\nGS*HC~\nST*837*0001~';
  const segs = parseEdi(edi);
  assert(segs.length === 3, `expected 3, got ${segs.length}`);
  assert(segs[0].id === 'ISA');
  assert(segs[2].id === 'ST');
});

it('parseEdi skips blank lines', () => {
  const edi = 'SE*4*0001~\n\nGE*1*1~';
  const segs = parseEdi(edi);
  assert(segs.length === 2, `expected 2, got ${segs.length}`);
});

// ── Result ────────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)\n`);

if (failed > 0) {
  console.error('segment-parser tests FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
} else {
  console.log('All segment-parser tests passed.');
  process.exit(0);
}
