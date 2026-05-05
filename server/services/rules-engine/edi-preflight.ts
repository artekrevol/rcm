import { evaluateClaim, type ClaimContext } from "../rules-engine";

export interface Tier1GateFinding {
  code: string;
  severity: "block" | "warn" | "info";
  message: string;
  fixSuggestion: string;
}

export interface Tier1FailureBody {
  success: false;
  error: string;
  findings: Tier1GateFinding[];
  gateName: "tier1-structural-preflight";
}

interface ClaimRow {
  id: string;
  organization_id: string;
  patient_id: string;
  payer_id?: string | null;
  payer?: string | null;
  service_date?: string | null;
  authorization_number?: string | null;
  place_of_service?: string | null;
}

interface PatientRow {
  member_id?: string | null;
  insurance_id?: string | null;
  dob?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

/**
 * Run the Tier 1 structural-integrity gate against a ClaimContext.
 * Returns null when the claim passes, or a Tier1FailureBody when any
 * Tier 1 block-severity finding fires.
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
 * Build a ClaimContext from the already-loaded claim, patient, and payer
 * rows that both stedi route handlers share. Centralised here so both
 * routes use identical field mapping.
 */
export function buildClaimContextForGate(args: {
  c: ClaimRow;
  pat: PatientRow;
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
