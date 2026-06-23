/**
 * hh-noa-precondition — NOA precondition gate pack.
 *
 * G-B5: A period-of-care claim cannot be generated until the NOA for that
 * admission reaches a gate-satisfying status. CMS will not reimburse home
 * health claims without a processed NOA on file.
 *
 * The gate-satisfying status set lives centrally in @shared/hh-status
 * (NOA_GATE_STATUSES) so this pack and server/services/hh/gates.ts can never drift.
 *
 * ONLY runs for home_health_skilled orgs.
 */

import type { RulePack, Rule, RuleContext, Violation } from '../engine/types.js';
import { NOA_GATE_STATUSES, isNoaGateSatisfied, formatStatusList } from '@shared/hh-status';

const PACK_ID = 'hh-noa-precondition';

const rules: Rule[] = [
  {
    id: 'HH-NOA-PRE-001',
    code: 'HH-NOA-PRE-001',
    severity: 'error',
    description:
      'A period-of-care claim cannot be submitted until the NOA for this admission ' +
      `is in ${formatStatusList(NOA_GATE_STATUSES)} status. CMS requires a processed NOA before ` +
      'home health claims can be reimbursed. Late NOAs incur payment penalties (see HH-NOA-TIMING-001).',
    ediSegment: 'CLM',
    check(ctx: RuleContext): Violation[] | null {
      const noaStatus: string | null = (ctx.claim as any).noaStatus ?? null;

      if (isNoaGateSatisfied(noaStatus)) return null;

      const msgSuffix = noaStatus
        ? ` Current NOA status: "${noaStatus}".`
        : ' No NOA has been filed for this episode.';

      return [{
        ruleId: 'HH-NOA-PRE-001', code: 'HH-NOA-PRE-001', severity: 'error', packId: PACK_ID,
        fieldPath: 'noa_filing.status', ediSegment: 'CLM',
        message:
          'NOA precondition not met: a period-of-care claim cannot be generated ' +
          `without a Notice of Admission (NOA) in ${formatStatusList(NOA_GATE_STATUSES)} status on file.` + msgSuffix,
        suggestedFix:
          'File the NOA via the NOA Dashboard. Late NOAs will incur CMS payment penalties ' +
          'but do not hard-block claim generation.',
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
