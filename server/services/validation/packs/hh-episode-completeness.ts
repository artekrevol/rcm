/**
 * hh-episode-completeness — HH segment validation pack.
 *
 * Blocks a billing period from reaching "ready_to_bill" until every visit
 * in the period is documented AND signed. Applied at the service layer (G6)
 * and also surfaced as a validation rule on the claim.
 *
 * This pack ONLY runs for home_health_skilled orgs. The pack-loader checks
 * care_model before including it in the resolved pack list.
 *
 * Segment filter: care_model must be 'home_health_skilled'.
 */

import type { RulePack, Rule, RuleContext, Violation } from '../engine/types.js';

const PACK_ID = 'hh-episode-completeness';

const rules: Rule[] = [
  {
    id: 'HH-EC-001',
    code: 'HH-EC-001',
    severity: 'error',
    description:
      'All visits in the billing period must be documented and signed before the period is ready to bill. ' +
      'Service layer enforces this via the G6 gate; this rule surfaces the same check on the claim validation result.',
    ediSegment: 'CLM',
    check(ctx: RuleContext): Violation[] | null {
      const billingPeriodId = (ctx.claim as any).billingPeriodId;
      if (!billingPeriodId) return null;

      const undocumentedVisits: number = (ctx.claim as any).undocumentedVisitCount ?? 0;
      const unsignedVisits: number = (ctx.claim as any).unsignedVisitCount ?? 0;

      const violations: Violation[] = [];

      if (undocumentedVisits > 0) {
        violations.push({
          ruleId: 'HH-EC-001',
          code: 'HH-EC-001',
          severity: 'error',
          message: `${undocumentedVisits} visit(s) in this billing period are not documented. All visits must be documented and signed before billing.`,
          fieldPath: 'billing_period.visits',
          ediSegment: 'CLM',
          suggestedFix: 'Document all visits in the billing period before marking it ready to bill.',
          packId: PACK_ID,
        });
      }

      if (unsignedVisits > 0) {
        violations.push({
          ruleId: 'HH-EC-001',
          code: 'HH-EC-001',
          severity: 'error',
          message: `${unsignedVisits} visit(s) in this billing period are not signed. All visits must be documented and signed before billing.`,
          fieldPath: 'billing_period.visits',
          ediSegment: 'CLM',
          suggestedFix: 'Have the supervising clinician sign all visits before billing.',
          packId: PACK_ID,
        });
      }

      return violations.length ? violations : null;
    },
  },

  {
    id: 'HH-EC-002',
    code: 'HH-EC-002',
    severity: 'error',
    description:
      'A billing period must be in "ready_to_bill" status before a claim linked to it can be submitted. ' +
      'Periods in "open" or "closed" status cannot be billed.',
    ediSegment: 'CLM',
    check(ctx: RuleContext): Violation[] | null {
      const billingPeriodStatus = (ctx.claim as any).billingPeriodStatus;
      if (!billingPeriodStatus) return null;

      if (billingPeriodStatus !== 'ready_to_bill') {
        return [{
          ruleId: 'HH-EC-002',
          code: 'HH-EC-002',
          severity: 'error',
          message: `Billing period status is "${billingPeriodStatus}". Claim submission requires the billing period to be in "ready_to_bill" status.`,
          fieldPath: 'billing_period.status',
          ediSegment: 'CLM',
          suggestedFix: 'Ensure all visits are documented and signed, then mark the billing period as ready to bill.',
          packId: PACK_ID,
        }];
      }
      return null;
    },
  },
];

// ── Standalone test adapter ───────────────────────────────────────────────────

export interface HhVisitRecord {
  id: string;
  documented: boolean;
  signed: boolean;
}

export interface HhPeriodInput {
  episode: { soc_date?: string; primary_diagnosis?: string };
  poc_present?: boolean;
  orders_present?: boolean;
  soc_present?: boolean;
  visits: HhVisitRecord[];
}

export interface HhFinding {
  ruleId: string;
  severity: "error" | "warning" | "info";
  message: string;
}

export interface HhCompletenessResult {
  findings: HhFinding[];
}

/**
 * Standalone completeness check — callable without the full validation engine.
 * Used by the Phase A verification harness and unit tests.
 *
 * Returns ERROR findings for any unsigned or undocumented visits.
 */
export function runHhEpisodeCompleteness(input: HhPeriodInput): HhCompletenessResult {
  const findings: HhFinding[] = [];

  const undocumented = input.visits.filter((v) => !v.documented);
  const unsigned = input.visits.filter((v) => !v.signed);

  if (undocumented.length > 0) {
    findings.push({
      ruleId: "HH-EC-001",
      severity: "error",
      message: `${undocumented.length} visit(s) are not documented. All visits must be documented and signed before billing.`,
    });
  }

  if (unsigned.length > 0) {
    findings.push({
      ruleId: "HH-EC-001",
      severity: "error",
      message: `${unsigned.length} visit(s) are not signed. All visits must be documented and signed before billing.`,
    });
  }

  return { findings };
}

export const hhEpisodeCompletenessPack: RulePack = {
  id: PACK_ID,
  name: 'HH Episode Completeness',
  version: '1.0.0',
  appliesTo: {
    claimType: '837I',
    careModels: ['home_health_skilled'],
  },
  extends: [],
  rules,
};
