/**
 * Home Health service-layer gates.
 *
 * These are pure-functional (or DB-reading) checks enforced BEFORE a
 * final claim is generated. They are the software equivalent of Leo's
 * manual QA — each gate that fails prevents a real-money submission mistake.
 *
 * G-B3: Episode gate — billing period must be ready_to_bill, all visits documented+signed.
 * G-B4: RCD/UTN gate — choice-driven; PCR blocks without affirmed UTN.
 * G-B5: NOA precondition — no period claim without a filed/accepted NOA.
 */

import type { PoolClient } from 'pg';

// ─────────────────────────────────────────────────────────────────────────────
// Shared error type returned by all gates (so tests can inspect without parsing)
// ─────────────────────────────────────────────────────────────────────────────

export class HhGateError extends Error {
  constructor(
    public readonly gate: 'episode' | 'rcd_utn' | 'noa_precondition',
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HhGateError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// G-B3: Episode completeness + period-status gate
// ─────────────────────────────────────────────────────────────────────────────

export interface EpisodeGateInput {
  billingPeriodId: string;
  organizationId: string;
}

export interface EpisodeGateContext {
  billingPeriodStatus: string;
  undocumentedVisits: number;
  unsignedVisits: number;
}

/**
 * Assert that a billing period is ready to bill and has no unsigned/undocumented visits.
 * Throws HhGateError if any condition is not met.
 * Pure function when given pre-loaded context (for unit tests).
 */
export function assertEpisodeGateFromContext(ctx: EpisodeGateContext): void {
  if (ctx.billingPeriodStatus !== 'ready_to_bill') {
    throw new HhGateError(
      'episode',
      'HH-G3-STATUS',
      `Billing period status is "${ctx.billingPeriodStatus}". ` +
        'Final claim generation requires the billing period to be in "ready_to_bill" status.',
    );
  }
  if (ctx.undocumentedVisits > 0) {
    throw new HhGateError(
      'episode',
      'HH-G3-UNDOCUMENTED',
      `${ctx.undocumentedVisits} visit(s) are not documented. ` +
        'All visits must be documented and signed before generating a final claim.',
    );
  }
  if (ctx.unsignedVisits > 0) {
    throw new HhGateError(
      'episode',
      'HH-G3-UNSIGNED',
      `${ctx.unsignedVisits} visit(s) are not signed. ` +
        'All visits must be documented and signed before generating a final claim.',
    );
  }
}

/**
 * DB-backed version — reads billing_period + visit counts, then calls the pure checker.
 */
export async function assertEpisodeGate(
  billingPeriodId: string,
  organizationId: string,
  client: PoolClient,
): Promise<void> {
  const { rows: [bp] } = await client.query(
    `SELECT period_status FROM billing_periods WHERE id=$1 AND organization_id=$2`,
    [billingPeriodId, organizationId],
  );
  if (!bp) {
    throw new HhGateError('episode', 'HH-G3-NOT-FOUND', 'Billing period not found.');
  }

  const { rows: [counts] } = await client.query(
    `SELECT
       COUNT(*) FILTER (WHERE NOT documented) AS undocumented,
       COUNT(*) FILTER (WHERE NOT signed)     AS unsigned
     FROM episode_visits
     WHERE billing_period_id=$1 AND organization_id=$2`,
    [billingPeriodId, organizationId],
  );

  assertEpisodeGateFromContext({
    billingPeriodStatus: bp.period_status,
    undocumentedVisits: parseInt(counts?.undocumented ?? '0', 10),
    unsignedVisits: parseInt(counts?.unsigned ?? '0', 10),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// G-B4: RCD / UTN gate
// ─────────────────────────────────────────────────────────────────────────────

export interface RcdUtnGateInput {
  rcdReviewChoice: string | null;
  utnAffirmed: boolean;
}

export interface RcdUtnGateResult {
  blocked: boolean;
  reason: string | null;
  /** True when postpayment choice — claim goes through but must carry readiness flag. */
  postpaymentReadinessFlagRequired: boolean;
}

/**
 * Pure RCD/UTN gate — choice-driven per G-B4.
 * - pre_claim_review + no affirmed UTN → blocked (HhGateError)
 * - pre_claim_review + affirmed UTN → allowed, postpaymentReadinessFlagRequired=false
 * - postpayment_review (any UTN state) → allowed, postpaymentReadinessFlagRequired=true
 * - null / other → allowed, no flag
 */
export function assertRcdUtnGateFromContext(input: RcdUtnGateInput): RcdUtnGateResult {
  const choice = input.rcdReviewChoice;
  if (choice === 'pre_claim_review') {
    if (!input.utnAffirmed) {
      throw new HhGateError(
        'rcd_utn',
        'HH-G4-UTN-REQUIRED',
        'This organization is enrolled in pre-claim review (RCD). ' +
          'A final claim cannot be generated until a UTN (Unique Tracking Number) ' +
          'with affirmative outcome is on file for this billing period.',
      );
    }
    return { blocked: false, reason: null, postpaymentReadinessFlagRequired: false };
  }
  if (choice === 'postpayment_review') {
    return {
      blocked: false,
      reason: null,
      postpaymentReadinessFlagRequired: true,
    };
  }
  return { blocked: false, reason: null, postpaymentReadinessFlagRequired: false };
}

/**
 * DB-backed RCD/UTN gate.
 * Reads rcd_review_choice from practice_settings and affirmed UTN from
 * pre_claim_reviews for the episode.
 */
export async function assertRcdUtnGate(
  episodeId: string,
  organizationId: string,
  client: PoolClient,
): Promise<RcdUtnGateResult> {
  const { rows: [settings] } = await client.query(
    `SELECT rcd_review_choice FROM practice_settings WHERE organization_id=$1`,
    [organizationId],
  );
  const rcdReviewChoice: string | null = settings?.rcd_review_choice ?? null;

  const { rows: [pcr] } = await client.query(
    `SELECT utn_number, review_status, outcome
     FROM pre_claim_reviews
     WHERE episode_id=$1 AND organization_id=$2
     ORDER BY created_at DESC
     LIMIT 1`,
    [episodeId, organizationId],
  );
  // Require BOTH a non-null UTN number AND an explicit 'affirmed' review_status
  // or outcome === 'Affirmative'. Approved without a UTN does not pass.
  const utnAffirmed =
    !!pcr?.utn_number &&
    (pcr?.review_status === 'affirmed' || pcr?.outcome === 'Affirmative');

  return assertRcdUtnGateFromContext({ rcdReviewChoice, utnAffirmed });
}

// ─────────────────────────────────────────────────────────────────────────────
// G-B5: NOA precondition gate
// ─────────────────────────────────────────────────────────────────────────────

export interface NoaPreconditionGateInput {
  noaStatus: string | null;
}

/**
 * Pure NOA precondition check.
 * A period claim cannot generate unless the episode has a NOA in 'filed' or 'accepted' status.
 */
export function assertNoaPreconditionFromContext(input: NoaPreconditionGateInput): void {
  const status = input.noaStatus;
  if (status !== 'filed' && status !== 'accepted') {
    throw new HhGateError(
      'noa_precondition',
      'HH-G5-NOA-REQUIRED',
      status
        ? `The NOA for this episode is in "${status}" status. ` +
            'A period-of-care claim cannot be generated until the NOA is in "filed" or "accepted" status.'
        : 'No NOA filing found for this episode. ' +
            'A Notice of Admission (NOA) must be filed before generating a period-of-care claim.',
    );
  }
}

/**
 * DB-backed NOA precondition gate.
 * Looks up the most recent NOA for the episode.
 */
export async function assertNoaPreconditionGate(
  episodeId: string,
  organizationId: string,
  client: PoolClient,
): Promise<void> {
  const { rows: [noa] } = await client.query(
    `SELECT status FROM noa_filings
     WHERE episode_id=$1 AND organization_id=$2
     ORDER BY created_at DESC
     LIMIT 1`,
    [episodeId, organizationId],
  );
  assertNoaPreconditionFromContext({ noaStatus: noa?.status ?? null });
}
