import { pool } from "../db";
import { evaluateClaim, scoreViolations, type RuleViolation } from "./rules-engine";

export interface ClaimRiskResult {
  riskScore: number;
  readinessStatus: "GREEN" | "YELLOW" | "RED";
  factors: RuleViolation[];
  cciFactors: Array<{
    type: string;
    severity: string;
    message: string;
    fix_suggestion: string;
    modifier_indicator: string;
    primary_code: string;
    secondary_code: string;
  }>;
}

/**
 * Re-evaluates a claim against the rules engine using its CURRENT stored data
 * and persists the resulting risk_score / readiness_status / last_risk_factors.
 *
 * This is the single source of truth for claim risk recalculation. It is used
 * by the explicit POST /:id/risk endpoint, and is also invoked automatically
 * after claim data updates (PATCH) and lazily when a stale draft is viewed —
 * so a score computed against an empty just-created draft shell can never
 * stick around after the claim has been filled in.
 *
 * Returns null when the claim does not exist.
 */
export async function evaluateAndPersistClaimRisk(claimId: string): Promise<ClaimRiskResult | null> {
  const claimResult = await pool.query("SELECT * FROM claims WHERE id = $1", [claimId]);
  if (claimResult.rows.length === 0) return null;
  const claim = claimResult.rows[0];

  const patientResult = await pool.query(
    `SELECT p.*, l.name as lead_name FROM patients p LEFT JOIN leads l ON p.lead_id = l.id WHERE p.id = $1`,
    [claim.patient_id]
  );
  const patient = patientResult.rows[0];

  const payerResult = claim.payer_id
    ? await pool.query(`SELECT requires_vob FROM payers WHERE id = $1`, [claim.payer_id])
    : { rows: [] as any[] };
  const payerRequiresVob = payerResult.rows[0]?.requires_vob !== false;

  const rawServiceLines: any[] = claim.service_lines || [];
  const serviceLines = rawServiceLines.map((sl: any) => ({
    code: (sl.hcpcs_code || sl.code || "").trim(),
    modifier: sl.modifier || "",
    units: parseFloat(sl.units) || 0,
    totalCharge: parseFloat(sl.totalCharge || sl.total_charge) || 0,
  }));

  const ctx = {
    claimId: claim.id,
    organizationId: claim.organization_id,
    patientId: claim.patient_id,
    payerId: claim.payer_id || null,
    payerName: claim.payer || "",
    planProduct: (claim.plan_product || patient?.plan_product || null) as any,
    serviceDate: claim.service_date ? new Date(claim.service_date) : null,
    serviceLines,
    icd10Primary: claim.icd10_primary || "",
    icd10Secondary: Array.isArray(claim.icd10_secondary) ? claim.icd10_secondary : [],
    authorizationNumber: claim.authorization_number || null,
    placeOfService: claim.place_of_service || "11",
    memberId: patient?.member_id || null,
    patientDob: patient?.dob ? new Date(patient.dob) : null,
    patientFirstName: patient?.first_name || null,
    patientLastName: patient?.last_name || null,
    testMode: false,
    pcpReferralCheckStatus: (claim.pcp_referral_check_status || null) as any,
  };

  const violations = await evaluateClaim(ctx);
  const { riskScore } = scoreViolations(violations);

  // Legacy compat: also add VOB + charge_overridden as info factors
  const legacyFactors: RuleViolation[] = [];
  if (!patient?.vob_verified && payerRequiresVob) {
    legacyFactors.push({
      ruleType: "data_quality", severity: "info",
      message: "Benefits (VOB) not yet verified for this patient.",
      fixSuggestion: "Run insurance verification before submitting.",
      ruleId: null, sourcePage: null, sourceQuote: null, payerSpecific: false,
    });
  }
  if (claim.charge_overridden) {
    legacyFactors.push({
      ruleType: "data_quality", severity: "info",
      message: "Charge amount was manually overridden — ensure it matches your fee schedule.",
      fixSuggestion: "Confirm the charge is correct before submitting.",
      ruleId: null, sourcePage: null, sourceQuote: null, payerSpecific: false,
    });
  }

  const allFactors = [...violations, ...legacyFactors];
  const finalScore = Math.min(riskScore + legacyFactors.length * 5, 100);
  const finalStatus: "GREEN" | "YELLOW" | "RED" =
    finalScore >= 71 ? "RED" : finalScore >= 31 ? "YELLOW" : "GREEN";

  // Derive backward-compat cciFactors for existing wizard UI
  const cciFactors = allFactors
    .filter((v) => v.ruleType === "cci_edit")
    .map((v) => ({
      type: "cci_edit",
      severity: v.severity === "block" ? "high" : "medium",
      message: v.message,
      fix_suggestion: v.fixSuggestion,
      modifier_indicator: v.message.includes("hard block") ? "0" : "1",
      primary_code: v.message.match(/([A-Z0-9]{4,7}) and/i)?.[1] || "",
      secondary_code: v.message.match(/and ([A-Z0-9]{4,7})/i)?.[1] || "",
    }));

  await pool.query(
    `UPDATE claims SET
       risk_score = $1,
       readiness_status = $2,
       last_risk_evaluation_at = NOW(),
       last_risk_factors = $3,
       updated_at = NOW()
     WHERE id = $4`,
    [finalScore, finalStatus, JSON.stringify(allFactors), claimId]
  );

  return { riskScore: finalScore, readinessStatus: finalStatus, factors: allFactors, cciFactors };
}
