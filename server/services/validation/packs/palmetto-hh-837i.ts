/**
 * palmetto-hh-837i — Palmetto GBA JM Medicare 837I validation pack.
 *
 * Validates home health institutional claim requirements per:
 *   CMS HH NOA 837I Companion Guide (updated 06/17/2021)
 *   Palmetto GBA Home Health Billing Codes Job Aid
 *
 * ONLY runs for home_health_skilled orgs and 837I claims.
 * Pack-loader careModels filter ensures this never runs for outpatient.
 */

import type { RulePack, Rule, RuleContext, Violation } from '../engine/types.js';

const PACK_ID = 'palmetto-hh-837i';

/** Valid HH revenue codes per CMS billing guide */
const VALID_HH_REVENUE_CODES = new Set([
  '0023',                          // HIPPS/OASIS grouper line
  '0551', '0559',                  // Skilled Nursing
  '0421', '0429',                  // Physical Therapy
  '0431', '0439',                  // Occupational Therapy
  '0441', '0449',                  // Speech-Language Pathology
  '0571', '0579',                  // Home Health Aide
  '0561', '0569',                  // Medical Social Services
]);

const rules: Rule[] = [
  {
    id: 'PHH-001',
    code: 'PHH-001',
    severity: 'error',
    description: 'HIPPS code must be present, exactly 5 uppercase alphanumeric characters, on the 0023 revenue line of a final 32x claim.',
    ediSegment: 'SV2',
    check(ctx: RuleContext): Violation[] | null {
      const hipps: string | null | undefined = (ctx.claim as any).hippsCode;
      const HIPPS_PATTERN = /^[A-Z0-9]{5}$/;
      if (!hipps) {
        return [{
          ruleId: 'PHH-001', code: 'PHH-001', severity: 'error', packId: PACK_ID,
          fieldPath: 'billing_period.hipps_code', ediSegment: 'SV2',
          message: 'HIPPS code is missing. A valid HIPPS code is required on the 0023 revenue line of all 32x HH final claims.',
          suggestedFix: 'Enter the 5-character HIPPS code from the OASIS grouper on the billing period.',
        }];
      }
      if (!HIPPS_PATTERN.test(hipps.trim())) {
        return [{
          ruleId: 'PHH-001', code: 'PHH-001', severity: 'error', packId: PACK_ID,
          fieldPath: 'billing_period.hipps_code', ediSegment: 'SV2',
          message: `HIPPS code "${hipps}" is invalid. Must be exactly 5 uppercase alphanumeric characters (A-Z, 0-9). No spaces, lowercase, or special characters.`,
          suggestedFix: 'Enter the 5-character uppercase alphanumeric HIPPS code from the OASIS grouper (e.g., "1AA11").',
        }];
      }
      return null;
    },
  },

  {
    id: 'PHH-007',
    code: 'PHH-007',
    severity: 'error',
    description: 'Claim frequency code must be valid for HH 32x claims (2=first period, 3=subsequent, 4=final, 9=void).',
    ediSegment: 'CLM',
    check(ctx: RuleContext): Violation[] | null {
      const freqCode: string | null | undefined = (ctx.claim as any).claimFrequencyCode;
      const VALID_HH_FREQ = ['2', '3', '4', '9'];
      if (!freqCode || !VALID_HH_FREQ.includes(freqCode)) {
        return [{
          ruleId: 'PHH-007', code: 'PHH-007', severity: 'error', packId: PACK_ID,
          fieldPath: 'billing_period.claim_frequency_code', ediSegment: 'CLM',
          message: `Claim frequency code "${freqCode ?? '(missing)'}" is not valid for a home health 32x claim. ` +
            'Valid codes: 2 (first 30-day period), 3 (subsequent), 4 (final), 9 (void/cancel).',
          suggestedFix: 'Select the correct claim frequency code for this billing period.',
        }];
      }
      return null;
    },
  },

  {
    id: 'PHH-008',
    code: 'PHH-008',
    severity: 'error',
    description: 'All visit revenue lines must use CMS-approved HH revenue codes (055x, 042x, 043x, 044x, 057x, 056x).',
    ediSegment: 'SV2',
    check(ctx: RuleContext): Violation[] | null {
      const visitLines: Array<{ revenueCode: string }> | undefined = (ctx.claim as any).visitLines;
      if (!visitLines || visitLines.length === 0) return null;
      const invalid = visitLines
        .filter(l => l.revenueCode !== '0023' && !VALID_HH_REVENUE_CODES.has(l.revenueCode))
        .map(l => l.revenueCode);
      if (invalid.length === 0) return null;
      return [{
        ruleId: 'PHH-008', code: 'PHH-008', severity: 'error', packId: PACK_ID,
        fieldPath: 'billing_period.visit_lines', ediSegment: 'SV2',
        message: `Invalid HH revenue code(s): ${invalid.join(', ')}. ` +
          'Revenue codes must be from the approved set: 055x (SN), 042x (PT), 043x (OT), 044x (ST), 057x (HHA), 056x (MSW).',
        suggestedFix: 'Correct discipline-to-revenue-code mapping for the flagged visit lines.',
        data: { invalid_codes: invalid },
      }];
    },
  },

  {
    id: 'PHH-002',
    code: 'PHH-002',
    severity: 'error',
    description: 'Occurrence code 50 (OASIS M0090 assessment completion date) is required on all 32x final claims.',
    ediSegment: 'HI',
    check(ctx: RuleContext): Violation[] | null {
      const oasisDate: string | null | undefined = (ctx.claim as any).oasisDate;
      if (!oasisDate) {
        return [{
          ruleId: 'PHH-002', code: 'PHH-002', severity: 'error', packId: PACK_ID,
          fieldPath: 'billing_period.oasis_date', ediSegment: 'HI',
          message: 'OASIS M0090 completion date (occurrence code 50) is missing. This field is required on all home health final claims.',
          suggestedFix: 'Enter the OASIS assessment completion date on the billing period.',
        }];
      }
      return null;
    },
  },

  {
    id: 'PHH-003',
    code: 'PHH-003',
    severity: 'error',
    description: 'Value code 85 (FIPS state/county) is required on all TOB 32x home health claims.',
    ediSegment: 'HI',
    check(ctx: RuleContext): Violation[] | null {
      const fipsCounty: string | null | undefined = (ctx.claim as any).fipsCounty;
      if (!fipsCounty || fipsCounty.trim().length < 5) {
        return [{
          ruleId: 'PHH-003', code: 'PHH-003', severity: 'error', packId: PACK_ID,
          fieldPath: 'billing_period.fips_county', ediSegment: 'HI',
          message: 'FIPS state/county code (value code 85) is missing or invalid. ' +
            'Format: 2-char state + 3-char county (e.g., FL067 for Miami-Dade, FL). Required on all 32x claims.',
          suggestedFix: 'Enter the 5-character FIPS state+county code on the billing period.',
        }];
      }
      return null;
    },
  },

  {
    id: 'PHH-004',
    code: 'PHH-004',
    severity: 'warning',
    description: 'CBSA code (value code 61) should be present on 32x home health claims.',
    ediSegment: 'HI',
    check(ctx: RuleContext): Violation[] | null {
      const cbsaCode: string | null | undefined = (ctx.claim as any).cbsaCode;
      if (!cbsaCode) {
        return [{
          ruleId: 'PHH-004', code: 'PHH-004', severity: 'warning', packId: PACK_ID,
          fieldPath: 'billing_period.cbsa_code', ediSegment: 'HI',
          message: 'CBSA code (value code 61) is missing. Confirm whether this is required for your MAC.',
          suggestedFix: 'Enter the CBSA code for the location where services were rendered.',
        }];
      }
      return null;
    },
  },

  {
    id: 'PHH-005',
    code: 'PHH-005',
    severity: 'error',
    description: 'Total claim charge must be greater than $0.',
    ediSegment: 'CLM',
    check(ctx: RuleContext): Violation[] | null {
      const amount: number = ctx.claim.amount ?? 0;
      if (amount <= 0) {
        return [{
          ruleId: 'PHH-005', code: 'PHH-005', severity: 'error', packId: PACK_ID,
          fieldPath: 'claim.amount', ediSegment: 'CLM',
          message: `Total claim charge is $${amount.toFixed(2)}. HH claims must have a charge greater than $0.`,
          suggestedFix: 'Verify that visit charges are correctly entered on the billing period.',
        }];
      }
      return null;
    },
  },

  {
    id: 'PHH-006',
    code: 'PHH-006',
    severity: 'error',
    description: 'Principal diagnosis (ICD-10-CM) is required on all HH claims.',
    ediSegment: 'HI',
    check(ctx: RuleContext): Violation[] | null {
      const dx = ctx.claim.icd10Codes ?? [];
      if (dx.length === 0 || !dx[0]?.trim()) {
        return [{
          ruleId: 'PHH-006', code: 'PHH-006', severity: 'error', packId: PACK_ID,
          fieldPath: 'episode.primary_diagnosis', ediSegment: 'HI',
          message: 'Principal ICD-10-CM diagnosis code is missing. Required on all 837I home health claims.',
          suggestedFix: 'Enter the principal diagnosis code on the episode.',
        }];
      }
      return null;
    },
  },
];

// Palmetto GBA payer identifiers:
//   'PGBA-JM'  — Jurisdiction M (South: AL, AR, FL, GA, LA, MS, NC, SC, TN, VA, WV + DC/PR/VI)
//   'PGBA-JJ'  — Jurisdiction J (South East) — less common
// Rules appliesWhen checks on these IDs to avoid applying Palmetto-specific
// edits (occurrence code 50, value code 61/45, HIPPS format) to non-Palmetto payers.
const PALMETTO_PAYER_IDS = new Set(['PGBA-JM', 'PGBA-JJ', 'palmetto-gba-jm-001']);

/** True when the claim is being billed to a Palmetto GBA MAC. */
function isPalmettoPayerCtx(ctx: RuleContext): boolean {
  const payerId = ctx.claim.payerRecord?.payerId ?? (ctx.claim as any).payerFkId ?? null;
  return payerId != null && PALMETTO_PAYER_IDS.has(payerId);
}

export const palmettoHh837iPack: RulePack = {
  id: PACK_ID,
  name: 'Palmetto GBA JM — Home Health 837I',
  version: '1.0.0',
  appliesTo: {
    claimType: '837I',
    careModels: ['home_health_skilled'],
  },
  // Payer-scope each rule individually via appliesWhen so that generic HH
  // 837I validation packs do not absorb Palmetto-specific constraints.
  rules: rules.map(r => ({
    ...r,
    appliesWhen: (ctx: RuleContext) =>
      isPalmettoPayerCtx(ctx) && (r.appliesWhen ? r.appliesWhen(ctx) : true),
  })),
};
