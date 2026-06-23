/**
 * hh-auth-visit-cap — HH authorization visit cap validation pack.
 *
 * Warns when visits are approaching the authorized cap and blocks
 * submission when the cap is exceeded. Linked to prior_authorizations
 * via visits_approved / visits_used columns.
 *
 * This pack ONLY runs for home_health_skilled orgs. The pack-loader checks
 * care_model before including it in the resolved pack list.
 *
 * Segment filter: care_model must be 'home_health_skilled'.
 */

import type { RulePack, Rule, RuleContext, Violation } from '../engine/types.js';

const PACK_ID = 'hh-auth-visit-cap';

const WARN_THRESHOLD_PERCENT = 0.8;

const rules: Rule[] = [
  {
    id: 'HH-AVC-001',
    code: 'HH-AVC-001',
    severity: 'warning',
    description:
      'Warns when visits used have reached 80% or more of the authorized visit cap. ' +
      'Obtain a new authorization or extension before the cap is exceeded.',
    ediSegment: 'CLM',
    check(ctx: RuleContext): Violation[] | null {
      const visitsApproved: number | null = (ctx.claim as any).visitsApproved ?? null;
      const visitsUsed: number | null = (ctx.claim as any).visitsUsed ?? null;

      if (visitsApproved == null || visitsUsed == null) return null;
      if (visitsApproved <= 0) return null;

      const ratio = visitsUsed / visitsApproved;
      if (ratio >= 1.0) return null;

      if (ratio >= WARN_THRESHOLD_PERCENT) {
        return [{
          ruleId: 'HH-AVC-001',
          code: 'HH-AVC-001',
          severity: 'warning',
          message: `${visitsUsed} of ${visitsApproved} authorized visits used (${Math.round(ratio * 100)}%). ` +
            `Contact the payer to obtain an extension before the visit cap is reached.`,
          fieldPath: 'prior_authorization.visits_used',
          ediSegment: 'CLM',
          suggestedFix: 'Request a visit cap extension from the payer before the cap is exceeded.',
          packId: PACK_ID,
        }];
      }
      return null;
    },
  },

  {
    id: 'HH-AVC-002',
    code: 'HH-AVC-002',
    severity: 'error',
    description:
      'Blocks claim submission when the authorized visit cap has been exceeded. ' +
      'A new authorization is required before additional visits can be billed.',
    ediSegment: 'CLM',
    check(ctx: RuleContext): Violation[] | null {
      const visitsApproved: number | null = (ctx.claim as any).visitsApproved ?? null;
      const visitsUsed: number | null = (ctx.claim as any).visitsUsed ?? null;

      if (visitsApproved == null || visitsUsed == null) return null;
      if (visitsApproved <= 0) return null;

      if (visitsUsed > visitsApproved) {
        return [{
          ruleId: 'HH-AVC-002',
          code: 'HH-AVC-002',
          severity: 'error',
          message: `Visit cap exceeded: ${visitsUsed} visits used but only ${visitsApproved} authorized. ` +
            `A new prior authorization is required before submitting additional claims.`,
          fieldPath: 'prior_authorization.visits_used',
          ediSegment: 'CLM',
          suggestedFix: 'Obtain a new prior authorization covering the additional visits before billing.',
          packId: PACK_ID,
        }];
      }
      return null;
    },
  },
];

export const hhAuthVisitCapPack: RulePack = {
  id: PACK_ID,
  name: 'HH Authorization Visit Cap',
  version: '1.0.0',
  appliesTo: {
    claimType: '837I',
    careModels: ['home_health_skilled'],
  },
  extends: [],
  rules,
};
