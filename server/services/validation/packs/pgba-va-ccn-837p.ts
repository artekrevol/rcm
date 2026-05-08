/**
 * PGBA VA CCN 837P validation overlay.
 * Source: PGBA Companion Guide for ASC X12N 837 (005010X222A1),
 * version 1.0, March 2021.
 *
 * INTENTIONALLY EXCLUDED — already implemented in
 * server/services/edi-generator.ts validateForPGBA():
 *   - PGBA H16 / SV102: per-line charge bounds (>0 and <$100k)
 *   - PGBA AAT: anesthesia modifier requirement for HCPCS 00000-09999
 *   - PGBA SSC / SSE: patient identifier format (SSN 9 / EDIPI 10 / ICN 17)
 *
 * Migrating those into this pack is a planned follow-up. Until then,
 * do not duplicate them here — the generator owns that source of truth.
 */

import type { RulePack, Rule, RuleContext, Violation } from '../engine/types.js';
import { stateForZip } from '../data/usps-state-zip.js';

const PACK_ID = 'pgba-va-ccn-837p';

/** NPI Luhn-10 checksum per CMS specification. */
function isValidNpiLuhn(npi: string): boolean {
  if (!/^\d{10}$/.test(npi)) return false;
  // Prepend "80840" as per NPI Luhn specification
  const digits = ('80840' + npi).split('').map(Number);
  let sum = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits[i];
    if ((digits.length - 1 - i) % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Parse raw diagnosis pointer string to 1-based position indices. */
function parseDiagnosisPointers(raw: string): number[] {
  if (!raw || raw.trim() === '') return [];
  const s = raw.trim();
  if (s.includes(':')) {
    return s.split(':').map(p => {
      const n = parseInt(p, 10);
      if (!isNaN(n)) return n;
      const u = p.trim().toUpperCase();
      if (/^[A-L]$/.test(u)) return u.charCodeAt(0) - 64;
      return NaN;
    }).filter(n => !isNaN(n) && n > 0);
  }
  if (/^[A-La-l]{2,}$/.test(s)) return s.toUpperCase().split('').map(c => c.charCodeAt(0) - 64);
  if (/^[A-La-l]$/.test(s)) return [s.toUpperCase().charCodeAt(0) - 64];
  if (/^\d+(,\d+)*$/.test(s)) return s.split(',').map(n => parseInt(n, 10)).filter(n => n > 0);
  const n = parseInt(s, 10);
  if (!isNaN(n) && n > 0) return [n];
  return [];
}

const NAME_REGEX = /^[A-Za-z][A-Za-z'\- ]*[A-Za-z]$|^[A-Za-z]$/;

const rules: Rule[] = [

  // PGBA-H68: Subscriber name must be alphabetic + hyphens + apostrophes only
  {
    id: 'PGBA-H68',
    code: 'H68',
    severity: 'error',
    description: 'Subscriber NM103 (last name) and NM104 (first name) must contain only letters, hyphens, apostrophes, and single spaces. No digits or other special characters.',
    ediSegment: '2010BA|NM103,NM104',
    check(ctx: RuleContext): Violation[] | null {
      const violations: Violation[] = [];
      const last = ctx.claim.patient.lastName ?? '';
      const first = ctx.claim.patient.firstName ?? '';
      if (last && !NAME_REGEX.test(last)) {
        violations.push({
          ruleId: 'PGBA-H68',
          code: 'H68',
          severity: 'error',
          message: `Patient last name "${last}" contains invalid characters. PGBA requires letters, single spaces, hyphens, and apostrophes only.`,
          fieldPath: 'patient.last_name',
          ediSegment: '2010BA|NM103',
          suggestedFix: 'Letters, single spaces, hyphens, and apostrophes only. Remove any digits or other characters.',
          packId: PACK_ID,
        });
      }
      if (first && !NAME_REGEX.test(first)) {
        violations.push({
          ruleId: 'PGBA-H68',
          code: 'H68',
          severity: 'error',
          message: `Patient first name "${first}" contains invalid characters. PGBA requires letters, single spaces, hyphens, and apostrophes only.`,
          fieldPath: 'patient.first_name',
          ediSegment: '2010BA|NM104',
          suggestedFix: 'Letters, single spaces, hyphens, and apostrophes only. Remove any digits or other characters.',
          packId: PACK_ID,
        });
      }
      return violations.length ? violations : null;
    },
  },

  // PGBA-BG5: Patient and billing provider state must be consistent with ZIP prefix
  {
    id: 'PGBA-BG5',
    code: 'BG5',
    severity: 'warning',
    description: 'Patient and billing provider state must be consistent with their ZIP code per USPS prefix map.',
    ediSegment: '2010AA|N4 and 2010BA|N4',
    check(ctx: RuleContext): Violation[] | null {
      const violations: Violation[] = [];

      const patState = ctx.claim.patient.address?.state?.toUpperCase();
      const patZip = ctx.claim.patient.address?.zip ?? '';
      if (patState && patZip) {
        const expected = stateForZip(patZip);
        if (expected && expected !== patState) {
          violations.push({
            ruleId: 'PGBA-BG5',
            code: 'BG5',
            severity: 'warning',
            message: `Patient ZIP "${patZip}" suggests state "${expected}" but state is set to "${patState}". PGBA may flag this as inconsistent.`,
            fieldPath: 'patient.address.state',
            ediSegment: '2010BA|N4',
            suggestedFix: 'Verify the patient ZIP code and state match. Correct one or override if you are certain they are accurate.',
            packId: PACK_ID,
          });
        }
      }

      const pracState = ctx.practice.address?.state?.toUpperCase();
      const pracZip = ctx.practice.address?.zip ?? '';
      if (pracState && pracZip) {
        const expected = stateForZip(pracZip);
        if (expected && expected !== pracState) {
          violations.push({
            ruleId: 'PGBA-BG5',
            code: 'BG5',
            severity: 'warning',
            message: `Billing provider ZIP "${pracZip}" suggests state "${expected}" but state is set to "${pracState}". PGBA may flag this as inconsistent.`,
            fieldPath: 'practice.address.state',
            ediSegment: '2010AA|N4',
            suggestedFix: 'Verify the practice ZIP code and state in Practice Settings.',
            packId: PACK_ID,
          });
        }
      }

      return violations.length ? violations : null;
    },
  },

  // PGBA-RXO: No duplicate diagnosis codes (case-insensitive, trimmed)
  {
    id: 'PGBA-RXO',
    code: 'RXO',
    severity: 'error',
    description: 'No two diagnosis codes on a claim may be identical. PGBA rejects claims with duplicate HI elements.',
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
            ruleId: 'PGBA-RXO',
            code: 'RXO',
            severity: 'error',
            message: `Diagnosis code "${code}" appears ${indices.length} times (positions ${indices.map(i => i + 1).join(', ')}). PGBA VA CCN rejects duplicate diagnosis codes.`,
            fieldPath: `icd10_codes[${indices.join(',')}]`,
            ediSegment: '2300|HI',
            suggestedFix: 'Remove duplicate diagnosis codes. Each ICD-10 code may appear only once per claim.',
            packId: PACK_ID,
          });
        }
      }
      return violations.length ? violations : null;
    },
  },

  // PGBA-QSF: Principal diagnosis must not be an external-cause code (V/W/X/Y)
  {
    id: 'PGBA-QSF',
    code: 'QSF',
    severity: 'error',
    description: 'First diagnosis code (principal) must not start with V, W, X, or Y (external-cause codes).',
    ediSegment: '2300|HI01-2',
    check(ctx: RuleContext): Violation[] | null {
      const primary = ctx.claim.icd10Codes[0];
      if (!primary) return null;
      const firstChar = primary.trim().toUpperCase()[0];
      if (['V', 'W', 'X', 'Y'].includes(firstChar)) {
        return [{
          ruleId: 'PGBA-QSF',
          code: 'QSF',
          severity: 'error',
          message: `Primary diagnosis "${primary}" starts with "${firstChar}" — this is an external-cause code and cannot be the principal diagnosis for PGBA VA CCN claims.`,
          fieldPath: 'icd10_codes[0]',
          ediSegment: '2300|HI01-2',
          suggestedFix: 'External-cause codes (V/W/X/Y) cannot be primary. Move to a secondary position and use an appropriate primary diagnosis.',
          packId: PACK_ID,
        }];
      }
      return null;
    },
  },

  // PGBA-DX-POINTER: Each service line diagnosis pointer must reference a valid position
  {
    id: 'PGBA-DX-POINTER',
    code: 'PGBA-DX-POINTER',
    severity: 'error',
    description: 'For each service line, every diagnosis pointer character must reference a position that exists in the claim\'s diagnosis code list.',
    ediSegment: '2400|SV107',
    check(ctx: RuleContext): Violation[] | null {
      const totalDx = ctx.claim.icd10Codes.length;
      const violations: Violation[] = [];
      ctx.claim.serviceLines.forEach((line, i) => {
        const pointers = parseDiagnosisPointers(line.diagnosisPointer);
        pointers.forEach(ptr => {
          if (ptr > totalDx) {
            violations.push({
              ruleId: 'PGBA-DX-POINTER',
              code: 'PGBA-DX-POINTER',
              severity: 'error',
              message: `Service line ${i + 1} (${line.hcpcsCode}): pointer references diagnosis position ${ptr} but only ${totalDx} code(s) exist on this claim.`,
              fieldPath: `service_lines[${i}].diagnosis_pointer`,
              ediSegment: '2400|SV107',
              suggestedFix: `Set the diagnosis pointer to a value between 1 and ${totalDx}.`,
              packId: PACK_ID,
            });
          }
        });
      });
      return violations.length ? violations : null;
    },
  },

  // PGBA-NP4: If Loop 2310A is populated, NPI must be 10-digit and pass Luhn-10
  {
    id: 'PGBA-NP4',
    code: 'NP4',
    severity: 'error',
    description: 'If a referring provider is linked, their NPI must be a valid 10-digit number passing the Luhn-10 checksum.',
    ediSegment: '2310A|NM109',
    appliesWhen: (ctx: RuleContext) => ctx.claim.referringProviderId != null,
    check(ctx: RuleContext): Violation[] | null {
      const rp = ctx.claim.referringProvider;
      if (!rp) return null;
      if (!rp.npi) {
        return [{
          ruleId: 'PGBA-NP4',
          code: 'NP4',
          severity: 'error',
          message: `Referring provider ${rp.firstName} ${rp.lastName} has no NPI on record. PGBA requires a valid NPI when Loop 2310A is submitted.`,
          fieldPath: 'referring_provider.npi',
          ediSegment: '2310A|NM109',
          suggestedFix: 'Look up the provider\'s NPI in NPPES and update their record, or remove the referring provider link if it is not required.',
          packId: PACK_ID,
        }];
      }
      if (!isValidNpiLuhn(rp.npi)) {
        return [{
          ruleId: 'PGBA-NP4',
          code: 'NP4',
          severity: 'error',
          message: `Referring provider NPI "${rp.npi}" does not pass the Luhn-10 checksum. It may be mis-entered or a station-prefixed composite ID rather than a real NPI.`,
          fieldPath: 'referring_provider.npi',
          ediSegment: '2310A|NM109',
          suggestedFix: 'Verify the NPI on NPPES (nppes.cms.hhs.gov). VA station-prefixed IDs (e.g. "662_1234567") are not valid NPIs.',
          packId: PACK_ID,
        }];
      }
      return null;
    },
  },

  // PGBA-REF-G2: If Loop 2310A is populated, REF01 must be 'G2'
  {
    id: 'PGBA-REF-G2',
    code: 'PGBA-REF-G2',
    severity: 'error',
    description: 'If a referring provider is linked (Loop 2310A emitted), REF01 must be "G2". ' +
      'NOTE: The current EDI generator does not yet emit REF*G2 in Loop 2310A. This rule will fire ' +
      'on any claim with a referring provider linked until that generator update lands in a separate ' +
      'ticket. Currently no Chajinel claims have referring providers, so this rule fires zero times ' +
      'in production today.',
    ediSegment: '2310A|REF01',
    appliesWhen: (ctx: RuleContext) => ctx.claim.referringProviderId != null,
    check(ctx: RuleContext): Violation[] | null {
      return [{
        ruleId: 'PGBA-REF-G2',
        code: 'PGBA-REF-G2',
        severity: 'error',
        message: 'Loop 2310A is populated but the EDI generator does not yet emit REF*G2 for the referring provider. ' +
          'PGBA requires REF01="G2" when Loop 2310A is present. This will be fixed in a separate generator ticket.',
        fieldPath: 'referring_provider_id',
        ediSegment: '2310A|REF01',
        suggestedFix: 'This is a known generator gap. Until the generator update lands, VA CCN claims with a referring provider may be rejected by PGBA.',
        packId: PACK_ID,
      }];
    },
  },

  // PGBA-N04: Each service line units must be >= 1 (server-side backstop)
  {
    id: 'PGBA-N04',
    code: 'N04',
    severity: 'error',
    description: 'Each service line must have at least 1 unit. Server-side backstop — client form validation should catch zero-unit lines first.',
    ediSegment: '2400|SV104',
    check(ctx: RuleContext): Violation[] | null {
      const violations: Violation[] = [];
      ctx.claim.serviceLines.forEach((line, i) => {
        if (line.units < 1) {
          violations.push({
            ruleId: 'PGBA-N04',
            code: 'N04',
            severity: 'error',
            message: `Service line ${i + 1} (${line.hcpcsCode}): units must be >= 1. Got: ${line.units}. PGBA rejects zero-unit lines.`,
            fieldPath: `service_lines[${i}].units`,
            ediSegment: '2400|SV104',
            suggestedFix: 'Set units to at least 1, or remove the service line.',
            packId: PACK_ID,
          });
        }
      });
      return violations.length ? violations : null;
    },
  },

  // PGBA-AUTH-PRESENT: TWVACCN claims must have a linked auth with a non-empty auth_number
  {
    id: 'PGBA-AUTH-PRESENT',
    code: 'PGBA-AUTH-PRESENT',
    severity: 'error',
    description: 'Claims to TWVACCN must have a linked authorization with a non-empty auth number (REF*G1).',
    ediSegment: '2300|REF*G1',
    check(ctx: RuleContext): Violation[] | null {
      const authNum = ctx.claim.authorizationNumber?.trim();
      if (!authNum) {
        return [{
          ruleId: 'PGBA-AUTH-PRESENT',
          code: 'PGBA-AUTH-PRESENT',
          severity: 'error',
          message: 'PGBA VA CCN requires a VA authorization number (REF*G1) on every claim. No authorization number is set.',
          fieldPath: 'authorization_number',
          ediSegment: '2300|REF*G1',
          suggestedFix: 'Add the VA authorization number from the referral document (e.g. "VA0056843497"). This is required for all TWVACCN claims.',
          packId: PACK_ID,
        }];
      }
      return null;
    },
  },

  // PGBA-DOS-WITHIN-AUTH: Each service line DOS must be <= auth expiration_date
  {
    id: 'PGBA-DOS-WITHIN-AUTH',
    code: 'PGBA-DOS-WITHIN-AUTH',
    severity: 'error',
    description: 'Each service line date of service must be on or before the linked authorization\'s expiration date.',
    ediSegment: '2400|DTP*472',
    appliesWhen: (ctx: RuleContext) => ctx.claim.auth?.expirationDate != null,
    check(ctx: RuleContext): Violation[] | null {
      const expStr = ctx.claim.auth?.expirationDate;
      if (!expStr) return null;
      const expDate = new Date(expStr);
      if (isNaN(expDate.getTime())) return null;

      const violations: Violation[] = [];
      ctx.claim.serviceLines.forEach((line, i) => {
        const dosStr = line.serviceDate || ctx.claim.serviceDate;
        if (!dosStr) return;
        const dos = new Date(dosStr);
        if (isNaN(dos.getTime())) return;
        if (dos > expDate) {
          violations.push({
            ruleId: 'PGBA-DOS-WITHIN-AUTH',
            code: 'PGBA-DOS-WITHIN-AUTH',
            severity: 'error',
            message: `Service line ${i + 1} (${line.hcpcsCode}): date of service ${dosStr} is after the authorization expiration date ${expStr.slice(0, 10)}.`,
            fieldPath: `service_lines[${i}].service_date`,
            ediSegment: '2400|DTP*472',
            suggestedFix: 'Remove service lines with dates after the authorization expiration, or obtain a new authorization covering the service dates.',
            packId: PACK_ID,
          });
        }
      });
      return violations.length ? violations : null;
    },
  },

];

export const pgbaVaCcn837pPack: RulePack = {
  id: PACK_ID,
  name: 'PGBA VA CCN 837P (March 2021)',
  version: '1.0.0',
  appliesTo: { claimType: '837P', payerIds: ['TWVACCN'] },
  extends: ['x12-base-837p'],
  rules,
};
