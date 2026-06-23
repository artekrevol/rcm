/**
 * hh-rcd-gate — Review Choice Demonstration gate pack.
 *
 * G-B4: choice-driven per rcd_review_choice from practice_settings.
 *   pre_claim_review  → blocks final claim without affirmed UTN
 *   postpayment_review → claim passes but postpayment readiness flag is set
 *
 * ONLY runs for home_health_skilled orgs.
 */

import type { RulePack, Rule, RuleContext, Violation } from '../engine/types.js';

const PACK_ID = 'hh-rcd-gate';

const rules: Rule[] = [
  {
    id: 'HH-RCD-001',
    code: 'HH-RCD-001',
    severity: 'error',
    description:
      'Pre-claim review (RCD): a final claim cannot be submitted without an affirmed ' +
      'UTN (Unique Tracking Number) from Palmetto GBA. ' +
      'Applies only when practice_settings.rcd_review_choice = "pre_claim_review".',
    ediSegment: 'CLM',
    check(ctx: RuleContext): Violation[] | null {
      const rcdChoice: string | null = (ctx.claim as any).rcdReviewChoice ?? null;
      if (rcdChoice !== 'pre_claim_review') return null;

      const utnAffirmed: boolean = (ctx.claim as any).utnAffirmed ?? false;
      if (!utnAffirmed) {
        return [{
          ruleId: 'HH-RCD-001', code: 'HH-RCD-001', severity: 'error', packId: PACK_ID,
          fieldPath: 'pre_claim_review.utn_number', ediSegment: 'CLM',
          message:
            'This organization participates in pre-claim review (RCD). ' +
            'A final claim cannot be generated until an affirmed UTN is recorded for this billing period. ' +
            'Submit the claim to Palmetto GBA for review and enter the affirmed UTN before billing.',
          suggestedFix: 'Record the affirmed UTN from the pre-claim review decision on the RCD panel.',
        }];
      }
      return null;
    },
  },

  {
    id: 'HH-RCD-002',
    code: 'HH-RCD-002',
    severity: 'warning',
    description:
      'Postpayment review (RCD): claim is allowed to proceed but postpayment ' +
      'documentation must be ready. Only flags when documentation-readiness fields ' +
      '(HIPPS code, OASIS date, at least one visit line) are incomplete. ' +
      'Palmetto GBA may audit this claim after payment.',
    ediSegment: 'CLM',
    check(ctx: RuleContext): Violation[] | null {
      const rcdChoice: string | null = (ctx.claim as any).rcdReviewChoice ?? null;
      if (rcdChoice !== 'postpayment_review') return null;

      // Evaluate documentation-readiness fields.
      // Only warn when one or more required fields are missing — not unconditionally.
      const hippsCode: string | null | undefined = (ctx.claim as any).hippsCode;
      const oasisDate: string | null | undefined = (ctx.claim as any).oasisDate;
      const visitLines: unknown[] | undefined = (ctx.claim as any).visitLines;

      const missingFields: string[] = [];
      if (!hippsCode) missingFields.push('HIPPS code');
      if (!oasisDate) missingFields.push('OASIS reference date');
      if (!visitLines || visitLines.length === 0) missingFields.push('visit documentation (revenue lines)');

      if (missingFields.length === 0) return null; // documentation is complete — no warning needed

      return [{
        ruleId: 'HH-RCD-002', code: 'HH-RCD-002', severity: 'warning', packId: PACK_ID,
        fieldPath: 'practice_settings.rcd_review_choice', ediSegment: 'CLM',
        message:
          'Postpayment review election: this claim is subject to postpayment audit by Palmetto GBA. ' +
          `The following documentation-readiness fields are incomplete: ${missingFields.join(', ')}. ` +
          'Complete these fields before submission to ensure audit readiness.',
        suggestedFix:
          'Complete the missing fields on the Billing Period screen before generating this claim. ' +
          'All clinical documentation (visit notes, OASIS, POC, physician orders) must be retained for ADR response.',
        data: { missingFields },
      }];
    },
  },
];

export const hhRcdGatePack: RulePack = {
  id: PACK_ID,
  name: 'HH Review Choice Demonstration (RCD) Gate',
  version: '1.0.0',
  appliesTo: {
    claimType: '837I',
    careModels: ['home_health_skilled'],
  },
  rules,
};
