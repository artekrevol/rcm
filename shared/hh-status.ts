/**
 * Centralized Home Health (HH) status constants.
 *
 * Single source of truth for the two HH status vocabularies that were
 * previously duplicated as inline string literals across gates, validation
 * packs, the rules runner, and routes:
 *
 *   1. UTN / pre-claim-review (PCR) "review_status" values.
 *   2. NOA (Notice of Admission) filing "status" values.
 *
 * Keeping these here prevents the drift that occurs when one call site is
 * updated and another is missed (e.g. the gate accepting "late" but a SQL
 * query still filtering only "accepted").
 *
 * NOTE: This module intentionally does NOT cover unrelated workflow
 * vocabularies (lead handoff status, VOB status, etc.) — those are different
 * domains and must not be conflated with HH UTN/NOA status.
 */

// ─────────────────────────────────────────────────────────────────────────────
// UTN / PCR review_status
// ─────────────────────────────────────────────────────────────────────────────

/** Canonical "affirmed" review_status. UTN edits lock once a PCR reaches this. */
export const UTN_AFFIRMED_CANONICAL = "affirmed" as const;

/**
 * review_status values that count as an affirmed/usable UTN.
 * "affirmed" is canonical; "accepted"/"approved" are legacy aliases retained
 * for historical PCR rows. Used by SQL filters that load the affirmed UTN.
 */
export const UTN_AFFIRMED_STATES = ["affirmed", "accepted", "approved"] as const;

/** All valid PCR review_status values accepted by the PCR update endpoint. */
export const PCR_REVIEW_STATUSES = [
  "pending",
  "submitted",
  "affirmed",
  "rejected",
  "approved",
] as const;

export type UtnAffirmedState = (typeof UTN_AFFIRMED_STATES)[number];
export type PcrReviewStatus = (typeof PCR_REVIEW_STATUSES)[number];

/** True when a PCR review_status satisfies the affirmed-UTN requirement. */
export function isUtnAffirmedStatus(status: string | null | undefined): boolean {
  return status != null && (UTN_AFFIRMED_STATES as readonly string[]).includes(status);
}

// ─────────────────────────────────────────────────────────────────────────────
// NOA filing status
// ─────────────────────────────────────────────────────────────────────────────

/** Canonical NOA status values written by the filing/submission flows. */
export const NOA_STATUS = {
  PENDING: "pending",
  FILED: "filed",
  LATE: "late",
  ACCEPTED: "accepted",
} as const;

export type NoaStatus = (typeof NOA_STATUS)[keyof typeof NOA_STATUS];

/**
 * NOA statuses that satisfy the period-of-care precondition gate (G-B5):
 *   filed    — on-time submission
 *   late     — past-due submission (penalty applies via hh-noa-timing, NOT hard-blocked)
 *   accepted — confirmed by payer via Stedi / 277CA
 */
export const NOA_GATE_STATUSES = [
  NOA_STATUS.FILED,
  NOA_STATUS.LATE,
  NOA_STATUS.ACCEPTED,
] as const;

/** True when a NOA status satisfies the precondition gate. */
export function isNoaGateSatisfied(status: string | null | undefined): boolean {
  return status != null && (NOA_GATE_STATUSES as readonly string[]).includes(status);
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers (for user-facing messages built from the constants above)
// ─────────────────────────────────────────────────────────────────────────────

/** Render a status list for prose, e.g. ["a","b","c"] → "a, b, or c". */
export function formatStatusList(statuses: readonly string[]): string {
  if (statuses.length <= 1) return statuses[0] ?? "";
  return `${statuses.slice(0, -1).join(", ")}, or ${statuses[statuses.length - 1]}`;
}
