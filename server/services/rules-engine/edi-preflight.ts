/**
 * EDI Preflight Gate — Phase 3 Sprint 1c.
 *
 * Single-purpose helper invoked by the two stedi submission routes
 *   - `POST /api/billing/claims/:id/submit-stedi`  (server/routes.ts:6348)
 *   - `POST /api/billing/claims/:id/test-stedi`    (server/routes.ts:6623)
 * immediately before `generate837P` is called.
 *
 * Runs `evaluateClaim()` against the Tier 1 structural-integrity rules
 * (T1-001 … T1-008) and short-circuits the request with HTTP 400 if any
 * Tier 1 finding is `block`-severity.
 *
 * Why a separate file rather than inline in routes.ts:
 *   - The same gate is shared by two route handlers.
 *   - The Tier 1 ↔ ClaimContext mapping is identical across both routes
 *     and benefits from a single test surface.
 *   - Keeps `routes.ts` (already 13,867 lines) from growing further.
 *
 * Hard rule (Sprint 1c Step 3c): the existing in-route VALIDATION_ERROR
 * checks at routes.ts 6428/6441/6685/6698 are NOT removed. They overlap
 * with Tier 1 rules T1-003/T1-007 and become harmless redundancy after
 * this gate lands; rolling back Sprint 1c then does not introduce a
 * regression.
 */

import { evaluateClaim, type ClaimContext } from "../rules-engine";

export interface Tier1GateFinding {
  code: string; // e.g. "T1-003"
  severity: "block" | "warn" | "info";
  message: string;
  fixSuggestion: string;
}

export interface Tier1FailureBody {
  success: false;
  error: string; // begins with "VALIDATION_ERROR: "
  findings: Tier1GateFinding[];
  gateName: "tier1-structural-preflight";
}

/**
 * Run the Tier 1 structural-integrity gate against a ClaimContext.
 *
 * Returns:
 *   - `null` if the claim has zero block-severity Tier 1 findings.
 *     The caller may proceed to `generate837P`.
 *   - A `Tier1FailureBody` if any Tier 1 rule blocks. The caller should
 *     respond with `res.status(400).json(body)` and return.
 *
 * Detection contract:
 *   `evaluateClaim` returns `Promise<RuleViolation[]>` (Sprint 1a). Tier 1
 *   findings are tagged with `source: "tier1-structural"` by the adapter
 *   (`tier1-adapter.ts:tier1FindingToViolation`). When any Tier 1 finding
 *   is `block`-severity, `evaluateClaim` short-circuits (rules-engine.ts
 *   line 351–354) and returns ONLY Tier 1 violations — but we filter
 *   explicitly on `source === "tier1-structural" && severity === "block"`
 *   so the gate is robust to any future change in the order or scope of
 *   rules that `evaluateClaim` runs.
 *
 * NOTE: We deliberately call the full `evaluateClaim` (not the lower-level
 * `runTier1AsViolations`) so the gate behaves identically to every other
 * invocation of the rules engine across the codebase. The DB cost is
 * negligible on the failure path: on a Tier 1 block, `evaluateClaim`
 * short-circuits BEFORE `pool.connect()` (rules-engine.ts:360), so no DB
 * connection is opened when the gate fires.
 */
export async function requireTier1Pass(
  ctx: ClaimContext
): Promise<Tier1FailureBody | null> {
  const findings = await evaluateClaim(ctx);
  const tier1Blocks = findings.filter(
    (f) => f.source === "tier1-structural" && f.severity === "block"
  );
  if (tier1Blocks.length === 0) return null;

  return {
    success: false,
    error:
      "VALIDATION_ERROR: Claim has structural integrity failures and cannot be submitted.",
    findings: tier1Blocks.map((f) => ({
      code: f.ruleId ?? "T1-???",
      severity: f.severity,
      message: f.message,
      fixSuggestion: f.fixSuggestion,
    })),
    gateName: "tier1-structural-preflight",
  };
}

/**
 * Build a `ClaimContext` from the snake_case row variables that both
 * stedi route handlers have already loaded (`c` claim row, `pat` patient
 * row, `payerInfo` payer row), plus the already-mapped `serviceLines`
 * and `icd10Codes` arrays. Centralized here so the two routes use an
 * identical mapping.
 *
 * The shape conversions:
 *   - serviceLines: `{hcpcs_code, units, charge, modifier}`
 *                   → `{code, units, totalCharge, modifier}`
 *   - icd10Codes:   `[primary, ...secondary]` array
 *                   → `{icd10Primary, icd10Secondary}` split
 *   - dates:        coerced to `Date` or `null`
 */
export function buildClaimContextForGate(args: {
  c: any;
  pat: any;
  payerInfo: { name?: string; payer_id?: string };
  serviceLines: Array<{
    hcpcs_code: string;
    units: number;
    charge: number;
    modifier: string | null;
  }>;
  icd10Codes: string[];
}): ClaimContext {
  const { c, pat, payerInfo, serviceLines, icd10Codes } = args;
  return {
    claimId: c.id,
    organizationId: c.organization_id,
    patientId: c.patient_id,
    payerId: c.payer_id ?? null,
    payerName: payerInfo.name || c.payer || "Unknown",
    planProduct: null,
    serviceDate: c.service_date ? new Date(c.service_date) : null,
    serviceLines: serviceLines.map((sl) => ({
      code: sl.hcpcs_code,
      modifier: sl.modifier ?? undefined,
      units: sl.units,
      totalCharge: sl.charge,
    })),
    icd10Primary: icd10Codes[0] ?? "",
    icd10Secondary: icd10Codes.slice(1),
    authorizationNumber: c.authorization_number ?? null,
    placeOfService: c.place_of_service ?? "12",
    memberId: pat.member_id || pat.insurance_id || null,
    patientDob: pat.dob ? new Date(pat.dob) : null,
    patientFirstName: pat.first_name ?? null,
    patientLastName: pat.last_name ?? null,
  };
}
