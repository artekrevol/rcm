/**
 * X12 Base 837P Validation Pack
 * Rules that are universally true for any 837P claim per the X12 5010 TR3
 * (005010X222A1). No payer-specific logic — this pack applies to all 837P
 * claims regardless of payer.
 *
 * Payer-specific rules (PGBA, Aetna, etc.) belong in overlay packs that
 * extend this one.
 */

import type { RulePack, Rule, RuleContext, Violation } from '../engine/types.js';
import { VALID_STATE_CODES } from '../data/usps-state-zip.js';

const PACK_ID = 'x12-base-837p';

const ICD10_REGEX = /^[A-TV-Z][0-9][A-Z0-9]{1,4}(\.[A-Z0-9]{1,4})?$/;

/** Parse a raw diagnosis pointer string into a list of 1-based position indices. */
function parseDiagnosisPointers(raw: string): number[] {
  if (!raw || raw.trim() === '') return [];
  const s = raw.trim();

  // Colon-separated: "1:2", "A:B"
  if (s.includes(':')) {
    return s.split(':').map(p => {
      const n = parseInt(p, 10);
      if (!isNaN(n)) return n;
      const upper = p.trim().toUpperCase();
      if (/^[A-L]$/.test(upper)) return upper.charCodeAt(0) - 64;
      return NaN;
    }).filter(n => !isNaN(n) && n > 0);
  }

  // Compact alpha: "AB" → [1, 2]
  if (/^[A-La-l]{2,}$/.test(s)) {
    return s.toUpperCase().split('').map(c => c.charCodeAt(0) - 64);
  }

  // Single alpha
  if (/^[A-La-l]$/.test(s)) return [s.toUpperCase().charCodeAt(0) - 64];

  // Single or comma-separated numeric
  if (/^\d+(,\d+)*$/.test(s)) {
    return s.split(',').map(n => parseInt(n, 10)).filter(n => n > 0);
  }

  // Fall back to single numeric
  const n = parseInt(s, 10);
  if (!isNaN(n) && n > 0) return [n];

  return [];
}

const rules: Rule[] = [

  // X12-CHARGE-POSITIVE — each service line charge > 0
  {
    id: 'X12-CHARGE-POSITIVE',
    code: 'X12-CHARGE-POSITIVE',
    severity: 'error',
    description: 'Each service line charge must be greater than $0.',
    ediSegment: '2400|SV102',
    check(ctx: RuleContext): Violation[] | null {
      const violations: Violation[] = [];
      ctx.claim.serviceLines.forEach((line, i) => {
        if (line.charge <= 0) {
          violations.push({
            ruleId: 'X12-CHARGE-POSITIVE',
            code: 'X12-CHARGE-POSITIVE',
            severity: 'error',
            message: `Service line ${i + 1} (${line.hcpcsCode}): charge must be > $0. Got: $${line.charge.toFixed(2)}.`,
            fieldPath: `service_lines[${i}].charge`,
            ediSegment: '2400|SV102',
            packId: PACK_ID,
          });
        }
      });
      return violations.length ? violations : null;
    },
  },

  // X12-CHARGE-UNDER-CAP — each service line charge < $1,000,000
  {
    id: 'X12-CHARGE-UNDER-CAP',
    code: 'X12-CHARGE-UNDER-CAP',
    severity: 'error',
    description: 'Each service line charge must be less than $1,000,000 (X12 element max length).',
    ediSegment: '2400|SV102',
    check(ctx: RuleContext): Violation[] | null {
      const violations: Violation[] = [];
      ctx.claim.serviceLines.forEach((line, i) => {
        if (line.charge >= 1_000_000) {
          violations.push({
            ruleId: 'X12-CHARGE-UNDER-CAP',
            code: 'X12-CHARGE-UNDER-CAP',
            severity: 'error',
            message: `Service line ${i + 1} (${line.hcpcsCode}): charge must be < $1,000,000. Got: $${line.charge.toFixed(2)}.`,
            fieldPath: `service_lines[${i}].charge`,
            ediSegment: '2400|SV102',
            packId: PACK_ID,
          });
        }
      });
      return violations.length ? violations : null;
    },
  },

  // X12-UNITS-AT-LEAST-ONE — units >= 1
  {
    id: 'X12-UNITS-AT-LEAST-ONE',
    code: 'X12-UNITS-AT-LEAST-ONE',
    severity: 'error',
    description: 'Each service line must have at least 1 unit.',
    ediSegment: '2400|SV104',
    check(ctx: RuleContext): Violation[] | null {
      const violations: Violation[] = [];
      ctx.claim.serviceLines.forEach((line, i) => {
        if (line.units < 1) {
          violations.push({
            ruleId: 'X12-UNITS-AT-LEAST-ONE',
            code: 'X12-UNITS-AT-LEAST-ONE',
            severity: 'error',
            message: `Service line ${i + 1} (${line.hcpcsCode}): units must be >= 1. Got: ${line.units}.`,
            fieldPath: `service_lines[${i}].units`,
            ediSegment: '2400|SV104',
            packId: PACK_ID,
          });
        }
      });
      return violations.length ? violations : null;
    },
  },

  // X12-DX-FORMAT-ICD10 — each diagnosis code must match ICD-10-CM format
  {
    id: 'X12-DX-FORMAT-ICD10',
    code: 'X12-DX-FORMAT-ICD10',
    severity: 'error',
    description: 'Each diagnosis code must match ICD-10-CM format (e.g. Z74.2, M54.5).',
    ediSegment: '2300|HI',
    check(ctx: RuleContext): Violation[] | null {
      const violations: Violation[] = [];
      ctx.claim.icd10Codes.forEach((code, i) => {
        const normalized = code.trim().toUpperCase();
        if (!ICD10_REGEX.test(normalized)) {
          violations.push({
            ruleId: 'X12-DX-FORMAT-ICD10',
            code: 'X12-DX-FORMAT-ICD10',
            severity: 'error',
            message: `Diagnosis code at position ${i + 1} ("${code}") does not match ICD-10-CM format. Expected pattern like "Z74.2" or "M54.5".`,
            fieldPath: `icd10_codes[${i}]`,
            ediSegment: '2300|HI',
            suggestedFix: 'Verify the ICD-10-CM code. U-prefix codes are reserved for provisional use and are not valid for billing.',
            packId: PACK_ID,
          });
        }
      });
      return violations.length ? violations : null;
    },
  },

  // X12-DX-NO-DUPLICATES — no duplicate diagnosis codes
  {
    id: 'X12-DX-NO-DUPLICATES',
    code: 'X12-DX-NO-DUPLICATES',
    severity: 'error',
    description: 'No two diagnosis codes on a claim may be identical.',
    ediSegment: '2300|HI',
    check(ctx: RuleContext): Violation[] | null {
      const seen = new Map<string, number[]>();
      ctx.claim.icd10Codes.forEach((code, i) => {
        const key = code.trim().toUpperCase();
        const indices = seen.get(key) ?? [];
        indices.push(i);
        seen.set(key, indices);
      });
      const violations: Violation[] = [];
      for (const [code, indices] of seen.entries()) {
        if (indices.length > 1) {
          violations.push({
            ruleId: 'X12-DX-NO-DUPLICATES',
            code: 'X12-DX-NO-DUPLICATES',
            severity: 'error',
            message: `Diagnosis code "${code}" appears ${indices.length} times (positions ${indices.map(i => i + 1).join(', ')}). Each code must appear only once.`,
            fieldPath: `icd10_codes[${indices.join(',')}]`,
            ediSegment: '2300|HI',
            suggestedFix: 'Remove duplicate diagnosis codes. Each ICD-10 code may only appear once per claim.',
            packId: PACK_ID,
          });
        }
      }
      return violations.length ? violations : null;
    },
  },

  // X12-DX-POINTER-VALID — each diagnosis pointer must reference an existing code position
  {
    id: 'X12-DX-POINTER-VALID',
    code: 'X12-DX-POINTER-VALID',
    severity: 'error',
    description: 'Each diagnosis pointer character must reference a populated diagnosis position.',
    ediSegment: '2400|SV107',
    check(ctx: RuleContext): Violation[] | null {
      const totalDx = ctx.claim.icd10Codes.length;
      const violations: Violation[] = [];
      ctx.claim.serviceLines.forEach((line, i) => {
        const pointers = parseDiagnosisPointers(line.diagnosisPointer);
        if (pointers.length === 0 && totalDx > 0) {
          violations.push({
            ruleId: 'X12-DX-POINTER-VALID',
            code: 'X12-DX-POINTER-VALID',
            severity: 'error',
            message: `Service line ${i + 1} (${line.hcpcsCode}): diagnosis pointer "${line.diagnosisPointer}" could not be parsed.`,
            fieldPath: `service_lines[${i}].diagnosis_pointer`,
            ediSegment: '2400|SV107',
            suggestedFix: 'Set the diagnosis pointer to "A" to reference the primary diagnosis.',
            packId: PACK_ID,
          });
          return;
        }
        pointers.forEach(ptr => {
          if (ptr > totalDx) {
            violations.push({
              ruleId: 'X12-DX-POINTER-VALID',
              code: 'X12-DX-POINTER-VALID',
              severity: 'error',
              message: `Service line ${i + 1} (${line.hcpcsCode}): diagnosis pointer references position ${ptr} but only ${totalDx} diagnosis code(s) exist.`,
              fieldPath: `service_lines[${i}].diagnosis_pointer`,
              ediSegment: '2400|SV107',
              suggestedFix: `Use a pointer between 1 and ${totalDx} (A–${String.fromCharCode(64 + totalDx)}).`,
              packId: PACK_ID,
            });
          }
        });
      });
      return violations.length ? violations : null;
    },
  },

  // X12-CLAIM-TOTAL-POSITIVE — claim total charge > 0
  {
    id: 'X12-CLAIM-TOTAL-POSITIVE',
    code: 'X12-CLAIM-TOTAL-POSITIVE',
    severity: 'error',
    description: 'Claim total charge must be greater than $0.',
    ediSegment: '2300|CLM02',
    check(ctx: RuleContext): Violation[] | null {
      const total = ctx.claim.serviceLines.reduce((s, l) => s + l.charge, 0);
      if (total <= 0) {
        return [{
          ruleId: 'X12-CLAIM-TOTAL-POSITIVE',
          code: 'X12-CLAIM-TOTAL-POSITIVE',
          severity: 'error',
          message: `Claim total charge must be > $0. Current sum of service lines: $${total.toFixed(2)}.`,
          fieldPath: 'amount',
          ediSegment: '2300|CLM02',
          packId: PACK_ID,
        }];
      }
      return null;
    },
  },

  // X12-CLAIM-TOTAL-RECONCILES — service line sum matches claim total within $0.01
  {
    id: 'X12-CLAIM-TOTAL-RECONCILES',
    code: 'X12-CLAIM-TOTAL-RECONCILES',
    severity: 'warning',
    description: 'Sum of service line charges should equal the claim total charge (within $0.01 tolerance).',
    ediSegment: '2300|CLM02',
    check(ctx: RuleContext): Violation[] | null {
      if (ctx.claim.serviceLines.length === 0) return null;
      const lineSum = ctx.claim.serviceLines.reduce((s, l) => s + l.charge, 0);
      const claimTotal = ctx.claim.amount;
      if (Math.abs(lineSum - claimTotal) > 0.01) {
        return [{
          ruleId: 'X12-CLAIM-TOTAL-RECONCILES',
          code: 'X12-CLAIM-TOTAL-RECONCILES',
          severity: 'warning',
          message: `Claim total ($${claimTotal.toFixed(2)}) does not match sum of service lines ($${lineSum.toFixed(2)}). Difference: $${Math.abs(lineSum - claimTotal).toFixed(2)}.`,
          fieldPath: 'amount',
          ediSegment: '2300|CLM02',
          suggestedFix: 'Recalculate the claim total from the service lines, or verify no lines were added or removed after the total was set.',
          packId: PACK_ID,
        }];
      }
      return null;
    },
  },

  // X12-LINE-DOS-VALID — each service line DOS is a valid date and not in the future
  {
    id: 'X12-LINE-DOS-VALID',
    code: 'X12-LINE-DOS-VALID',
    severity: 'error',
    description: 'Each service line date of service must be a valid date and not in the future.',
    ediSegment: '2400|DTP*472',
    check(ctx: RuleContext): Violation[] | null {
      const violations: Violation[] = [];
      const today = ctx.today;
      ctx.claim.serviceLines.forEach((line, i) => {
        const raw = line.serviceDate || ctx.claim.serviceDate;
        if (!raw) {
          violations.push({
            ruleId: 'X12-LINE-DOS-VALID',
            code: 'X12-LINE-DOS-VALID',
            severity: 'error',
            message: `Service line ${i + 1} (${line.hcpcsCode}): date of service is missing.`,
            fieldPath: `service_lines[${i}].service_date`,
            ediSegment: '2400|DTP*472',
            packId: PACK_ID,
          });
          return;
        }
        const d = new Date(raw);
        if (isNaN(d.getTime())) {
          violations.push({
            ruleId: 'X12-LINE-DOS-VALID',
            code: 'X12-LINE-DOS-VALID',
            severity: 'error',
            message: `Service line ${i + 1} (${line.hcpcsCode}): date of service "${raw}" is not a valid date.`,
            fieldPath: `service_lines[${i}].service_date`,
            ediSegment: '2400|DTP*472',
            packId: PACK_ID,
          });
          return;
        }
        if (d > today) {
          violations.push({
            ruleId: 'X12-LINE-DOS-VALID',
            code: 'X12-LINE-DOS-VALID',
            severity: 'error',
            message: `Service line ${i + 1} (${line.hcpcsCode}): date of service ${raw} is in the future (today is ${today.toISOString().slice(0, 10)}).`,
            fieldPath: `service_lines[${i}].service_date`,
            ediSegment: '2400|DTP*472',
            packId: PACK_ID,
          });
        }
      });
      return violations.length ? violations : null;
    },
  },

  // X12-VALID-STATE-CODE — patient and billing provider state codes must be valid
  {
    id: 'X12-VALID-STATE-CODE',
    code: 'X12-VALID-STATE-CODE',
    severity: 'error',
    description: 'State codes on patient and billing provider addresses must be valid US 2-letter codes (including military AA/AE/AP).',
    ediSegment: '2010AA|N4 and 2010BA|N4',
    check(ctx: RuleContext): Violation[] | null {
      const violations: Violation[] = [];
      const patState = ctx.claim.patient.address?.state;
      if (patState && !VALID_STATE_CODES.has(patState.toUpperCase())) {
        violations.push({
          ruleId: 'X12-VALID-STATE-CODE',
          code: 'X12-VALID-STATE-CODE',
          severity: 'error',
          message: `Patient state code "${patState}" is not a valid US state or territory abbreviation.`,
          fieldPath: 'patient.address.state',
          ediSegment: '2010BA|N4',
          packId: PACK_ID,
        });
      }
      const pracState = ctx.practice.address?.state;
      if (pracState && !VALID_STATE_CODES.has(pracState.toUpperCase())) {
        violations.push({
          ruleId: 'X12-VALID-STATE-CODE',
          code: 'X12-VALID-STATE-CODE',
          severity: 'error',
          message: `Billing provider state code "${pracState}" is not a valid US state or territory abbreviation.`,
          fieldPath: 'practice.address.state',
          ediSegment: '2010AA|N4',
          packId: PACK_ID,
        });
      }
      return violations.length ? violations : null;
    },
  },

];

export const x12Base837pPack: RulePack = {
  id: PACK_ID,
  name: 'X12 Base 837P',
  version: '1.0.0',
  appliesTo: { claimType: '837P' },
  rules,
};
