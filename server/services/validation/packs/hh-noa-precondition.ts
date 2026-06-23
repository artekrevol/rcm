/**
 * hh-noa-precondition — NOA precondition gate pack.
 *
 * G-B5: A period-of-care claim cannot be generated until the NOA for that
 * admission is in 'filed' or 'accepted' status. CMS will not reimburse home
 * health claims without a processed NOA on file.
 *
 * ONLY runs for home_health_skilled orgs.
 */

import type { RulePack, Rule, RuleContext, Violation } from '../engine/types.js';

const PACK_ID = 'hh-noa-precondition';

const rules: Rule[] = [
  {
    id: 'HH-NOA-PRE-001',
    code: 'HH-NOA-PRE-001',
    severity: 'error',
    description:
      'A period-of-care claim cannot be submitted until the NOA for this admission ' +
      'is in "filed" or "accepted" status. CMS requires a processed NOA before ' +
      'home health claims can be reimbursed.',
    ediSegment: 'CLM',
    check(ctx: RuleContext): Violation[] | null {
      const noaStatus: string | null = (ctx.claim as any).noaStatus ?? null;

      if (noaStatus === 'filed' || noaStatus === 'accepted') return null;

      const msgSuffix = noaStatus
        ? ` Current NOA status: "${noaStatus}".`
        : ' No NOA has been filed for this episode.';

      return [{
        ruleId: 'HH-NOA-PRE-001', code: 'HH-NOA-PRE-001', severity: 'error', packId: PACK_ID,
        fieldPath: 'noa_filing.status', ediSegment: 'CLM',
        message:
          'NOA precondition not met: a period-of-care claim cannot be generated ' +
          'without a filed or accepted Notice of Admission (NOA) on file.' + msgSuffix,
        suggestedFix: 'File the NOA via the NOA Dashboard and wait for accepted status before generating this claim.',
      }];
    },
  },
];

export const hhNoaPreconditionPack: RulePack = {
  id: PACK_ID,
  name: 'HH NOA Precondition Gate',
  version: '1.0.0',
  appliesTo: {
    claimType: '837I',
    careModels: ['home_health_skilled'],
  },
  rules,
};
