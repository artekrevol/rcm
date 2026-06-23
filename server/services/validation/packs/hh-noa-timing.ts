/**
 * hh-noa-timing — NOA 5-day clock and penalty pack.
 *
 * G-B6: NOA due = admission date + 5 calendar days. Late penalty spans
 * into additional 30-day periods. Reuses computeNoaStatus from Phase A.
 *
 * ONLY runs for home_health_skilled orgs.
 */

import type { RulePack, Rule, RuleContext, Violation } from '../engine/types.js';

const PACK_ID = 'hh-noa-timing';

/**
 * Determine which 30-day period(s) a penalty affects.
 * Period 1: days 1-30 after admission, Period 2: days 31-60.
 * If the NOA accepted day falls beyond day 5:
 *   - Days 6-35 → affects period 1 only
 *   - Day 36+ → affects both periods
 */
function penaltyPeriods(penaltyDays: number, socDateStr: string, acceptedDateStr?: string | null): number[] {
  if (penaltyDays <= 0) return [];
  if (!acceptedDateStr) return [1]; // unknown acceptance → assume period 1

  const [sy, sm, sd] = socDateStr.split('-').map(Number);
  const [ay, am, ad] = acceptedDateStr.split('-').map(Number);
  const soc = new Date(sy, sm - 1, sd);
  const acc = new Date(ay, am - 1, ad);
  const daysSinceSoc = Math.floor((acc.getTime() - soc.getTime()) / (24 * 60 * 60 * 1000));

  if (daysSinceSoc > 35) return [1, 2];
  return [1];
}

const rules: Rule[] = [
  {
    id: 'HH-NOA-TIMING-001',
    code: 'HH-NOA-TIMING-001',
    severity: 'error',
    description:
      'NOA 5-day clock: the NOA must be filed within 5 calendar days of the ' +
      'admission (SOC) date. Late filing incurs a payment reduction for each ' +
      'affected 30-day billing period.',
    ediSegment: 'CLM',
    check(ctx: RuleContext): Violation[] | null {
      const noaStatus: string | null = (ctx.claim as any).noaStatus ?? null;
      const penaltyDays: number = (ctx.claim as any).noaPenaltyDays ?? 0;
      const socDate: string | null = (ctx.claim as any).socDate ?? null;
      const filedDate: string | null = (ctx.claim as any).noaFiledDate ?? null;

      // Only flag when we have enough data
      if (!noaStatus || noaStatus === 'pending') return null;
      if (penaltyDays <= 0) return null;
      if (!socDate) return null;

      const affected = penaltyPeriods(penaltyDays, socDate, filedDate);
      const periodText = affected.length > 1
        ? 'both the 1st and 2nd 30-day periods'
        : `the ${affected[0] === 1 ? '1st' : '2nd'} 30-day period`;

      return [{
        ruleId: 'HH-NOA-TIMING-001', code: 'HH-NOA-TIMING-001', severity: 'error', packId: PACK_ID,
        fieldPath: 'noa_filing.penalty_days', ediSegment: 'CLM',
        message:
          `NOA was filed ${penaltyDays} day(s) late (after the 5-day deadline). ` +
          `CMS will apply a payment reduction to ${periodText} of this episode. ` +
          `Penalty: ${penaltyDays} day(s) at the applicable per-day reduction rate.`,
        suggestedFix:
          'No correction is possible after the fact. Document the penalty for billing reconciliation. ' +
          'For future episodes, file the NOA within 5 calendar days of the start-of-care date.',
        data: { penalty_days: penaltyDays },
      }];
    },
  },

  {
    id: 'HH-NOA-TIMING-002',
    code: 'HH-NOA-TIMING-002',
    severity: 'error',
    description:
      'NOA penalty spanning both 30-day periods: a very late NOA (accepted after day 35) ' +
      'causes payment reduction on both periods. This is a blocking finding because the ' +
      'payment impact affects the total episode and must be acknowledged before billing.',
    ediSegment: 'CLM',
    check(ctx: RuleContext): Violation[] | null {
      const penaltyDays: number = (ctx.claim as any).noaPenaltyDays ?? 0;
      const socDate: string | null = (ctx.claim as any).socDate ?? null;
      const filedDate: string | null = (ctx.claim as any).noaFiledDate ?? null;

      if (penaltyDays <= 0 || !socDate) return null;
      const affected = penaltyPeriods(penaltyDays, socDate, filedDate);
      if (affected.length < 2) return null;

      return [{
        ruleId: 'HH-NOA-TIMING-002', code: 'HH-NOA-TIMING-002', severity: 'error', packId: PACK_ID,
        fieldPath: 'noa_filing.penalty_days', ediSegment: 'CLM',
        message:
          `NOA penalty spans BOTH 30-day periods (late by ${penaltyDays} days). ` +
          `The payment reduction applies to period 1 and period 2 of this episode. ` +
          `Review and acknowledge this dual-period impact before submitting the claim.`,
        suggestedFix:
          'Review the financial impact with Leo before submitting. ' +
          'Ensure both billing periods reflect the reduced expected payment.',
      }];
    },
  },
];

export const hhNoaTimingPack: RulePack = {
  id: PACK_ID,
  name: 'HH NOA Timing (5-day Clock + Penalty)',
  version: '1.0.0',
  appliesTo: {
    claimType: '837I',
    careModels: ['home_health_skilled'],
  },
  rules,
};
