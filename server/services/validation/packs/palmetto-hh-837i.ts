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

const rules: Rule[] = [
  {
    id: 'PHH-001',
    code: 'PHH-001',
    severity: 'error',
    description: 'HIPPS code must be present and exactly 5 characters on the 0023 revenue line of a final 32x claim.',
    ediSegment: 'SV2',
    check(ctx: RuleContext): Violation[] | null {
      const hipps: string | null | undefined = (ctx.claim as any).hippsCode;
      if (!hipps || hipps.trim().length !== 5) {
        return [{
          ruleId: 'PHH-001', code: 'PHH-001', severity: 'error', packId: PACK_ID,
          fieldPath: 'billing_period.hipps_code', ediSegment: 'SV2',
          message: hipps
            ? `HIPPS code "${hipps}" is not exactly 5 characters. HIPPS codes must be 5 alphanumeric characters.`
            : 'HIPPS code is missing. A valid HIPPS code is required on the 0023 revenue line of all 32x HH final claims.',
          suggestedFix: 'Enter the 5-character HIPPS code from the OASIS grouper on the billing period.',
        }];
      }
      return null;
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

export const palmettoHh837iPack: RulePack = {
  id: PACK_ID,
  name: 'Palmetto GBA JM — Home Health 837I',
  version: '1.0.0',
  appliesTo: {
    claimType: '837I',
    careModels: ['home_health_skilled'],
  },
  rules,
};
