/**
 * Tier 1 ↔ Legacy rules-engine adapter (Phase 3 Sprint 1a, Step 4).
 *
 * The Tier 1 validator (`tier1-structural-integrity.ts`) was authored as a
 * pure function with its own input/output shape so its 16 unit tests could
 * stay portable. The legacy `evaluateClaim` in `rules-engine.ts` operates on
 * `ClaimContext` and emits `RuleViolation`. This module bridges the two
 * shapes without touching either side.
 *
 * Sprint 1a deliberately keeps this thin — no semantic transformation, only
 * field-name remapping. If Tier 1's input shape changes in the future, only
 * this file needs to be updated; the validator's tests remain authoritative
 * for Tier 1 correctness.
 */

import type { ClaimContext, RuleViolation } from "../rules-engine";
import {
  validateTier1Structural,
  type Tier1ClaimInput,
  type Tier1Finding,
} from "./tier1-structural-integrity";

/**
 * Map the legacy `ClaimContext` shape to the Tier 1 validator's input shape.
 * Field renames:
 *   - `serviceLines[].code`         → `serviceLines[].procedureCode`
 *   - `serviceLines[].units`        unchanged
 *   - `serviceLines[].totalCharge`  unchanged
 *   - `serviceLines[].modifier`     unchanged
 * The Tier 1 service-line shape additionally accepts a per-line `serviceDate`
 * and `placeOfService`; the legacy `ClaimContext` only carries those at the
 * claim header level, so per-line is left undefined and Tier 1's T1-008 falls
 * back to the header `serviceDate`.
 */
export function adaptToTier1(ctx: ClaimContext): Tier1ClaimInput {
  return {
    claimId: ctx.claimId ?? null,
    organizationId: ctx.organizationId ?? null,
    patientId: ctx.patientId ?? null,
    payerId: ctx.payerId ?? null,
    memberId: ctx.memberId ?? null,
    serviceDate: ctx.serviceDate ?? null,
    icd10Primary: ctx.icd10Primary ?? null,
    icd10Secondary: ctx.icd10Secondary ?? null,
    placeOfService: ctx.placeOfService ?? null,
    serviceLines: (ctx.serviceLines ?? []).map((line) => ({
      procedureCode: line.code ?? null,
      units: line.units ?? null,
      totalCharge: line.totalCharge ?? null,
      modifier: line.modifier ?? null,
      serviceDate: ctx.serviceDate ?? null,
      placeOfService: ctx.placeOfService ?? null,
    })),
  };
}

/**
 * Convert a `Tier1Finding` into a legacy `RuleViolation`. Tier 1's `block` /
 * `warn` map directly to the legacy severities. The legacy `RuleType` does
 * not have a structural-integrity bucket, so Tier 1 findings are tagged as
 * `data_quality` with a `source: "tier1-structural"` marker so callers can
 * filter on origin if needed.
 *
 * The Tier 1 `ruleCode` (e.g. `T1-003`) is preserved in the `ruleId` field
 * so the existing scoring/UX layer can surface it without any other change.
 */
export function tier1FindingToViolation(f: Tier1Finding): RuleViolation {
  return {
    ruleType: "data_quality",
    severity: f.severity,
    message: `[${f.ruleCode}] ${f.message}`,
    fixSuggestion: tier1FixSuggestion(f.ruleCode),
    ruleId: f.ruleCode,
    sourcePage: null,
    sourceQuote: null,
    payerSpecific: false,
    source: "tier1-structural",
  };
}

function tier1FixSuggestion(ruleCode: string): string {
  switch (ruleCode) {
    case "T1-001": return "Set the claim's organization_id before submission.";
    case "T1-002": return "Attach the claim to a patient record before submission.";
    case "T1-003": return "Add at least one service line with a procedure code, units, and charge.";
    case "T1-004": return "Verify the procedure code is a valid 4–7 character CPT/HCPCS code.";
    case "T1-005": return "Set service-line units to a positive number.";
    case "T1-006": return "Set service-line charge to a non-negative dollar amount.";
    case "T1-007": return "Add or correct the primary ICD-10 diagnosis code (e.g. F03.90).";
    case "T1-008": return "Set the claim's service date (header or at least one line).";
    default: return "Resolve the structural integrity issue before submission.";
  }
}

/**
 * Run Tier 1 against a legacy `ClaimContext` and return the findings already
 * mapped into the legacy violation shape. Convenience wrapper used by
 * `evaluateClaim`.
 */
export function runTier1AsViolations(ctx: ClaimContext): RuleViolation[] {
  const findings = validateTier1Structural(adaptToTier1(ctx));
  return findings.map(tier1FindingToViolation);
}
