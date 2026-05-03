/**
 * Tier 1 — Structural Integrity Validator (Phase 3 Sprint 0, Step 7).
 *
 * Pure-function validator that checks an in-memory claim/service-line shape
 * for the structural completeness required to generate a syntactically
 * valid 837P transaction. **It does NOT validate clinical correctness,
 * payer-specific policy, or coding bundling rules** — those are tiers 2–4.
 *
 * "Structural" means: would the X12 837P generator be able to emit a
 * non-empty, well-formed segment from this data? The eight rules below
 * cover the minimum surface for that question.
 *
 * Sprint 0 status: NOT wired into the legacy `evaluateClaim` pipeline in
 * `server/services/rules-engine.ts`. The validator is exported, unit-tested,
 * and idle — Sprint 1+ may opt routes into calling it before legacy rules.
 */

export interface Tier1ServiceLine {
  procedureCode?: string | null;   // CPT/HCPCS
  units?: number | null;
  totalCharge?: number | null;
  serviceDate?: Date | string | null;
  placeOfService?: string | null;
  modifier?: string | null;
}

export interface Tier1ClaimInput {
  claimId?: string | null;
  organizationId?: string | null;
  patientId?: string | null;
  payerId?: string | null;
  memberId?: string | null;
  serviceDate?: Date | string | null;
  icd10Primary?: string | null;
  icd10Secondary?: string[] | null;
  serviceLines: Tier1ServiceLine[];
  placeOfService?: string | null;
}

export type Tier1Severity = "block" | "warn";

export interface Tier1Finding {
  ruleCode: string;
  severity: Tier1Severity;
  message: string;
  field?: string;
  serviceLineIndex?: number;
}

const CPT_HCPCS_PATTERN = /^[A-Z0-9]{4,7}$/i;
const ICD10_PATTERN = /^[A-Z][0-9][0-9A-Z]([0-9A-Z]{1,4}|\.[0-9A-Z]{1,4})?$/i;

function nonEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

function asDate(v: Date | string | null | undefined): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * The eight Tier 1 rules. Listed by code so callers can subscribe/unsubscribe
 * via a profile's rule_subscriptions array (Sprint 1+).
 *
 *   T1-001  organization_id present                 (block)
 *   T1-002  patient_id present                      (block)
 *   T1-003  at least one service line               (block)
 *   T1-004  every line has a CPT/HCPCS code         (block)
 *   T1-005  every line has units > 0                (block)
 *   T1-006  every line has a non-negative charge    (block)
 *   T1-007  primary ICD-10 present and well-formed  (block)
 *   T1-008  service date present (claim or line)    (block)
 */
export function validateTier1Structural(input: Tier1ClaimInput): Tier1Finding[] {
  const findings: Tier1Finding[] = [];

  // T1-001
  if (!nonEmpty(input.organizationId)) {
    findings.push({
      ruleCode: "T1-001",
      severity: "block",
      message: "Claim is missing organization_id",
      field: "organizationId",
    });
  }

  // T1-002
  if (!nonEmpty(input.patientId)) {
    findings.push({
      ruleCode: "T1-002",
      severity: "block",
      message: "Claim is missing patient_id",
      field: "patientId",
    });
  }

  // T1-003
  if (!Array.isArray(input.serviceLines) || input.serviceLines.length === 0) {
    findings.push({
      ruleCode: "T1-003",
      severity: "block",
      message: "Claim has no service lines",
      field: "serviceLines",
    });
  } else {
    input.serviceLines.forEach((line, i) => {
      // T1-004
      const code = line.procedureCode?.toString().trim() ?? "";
      if (!nonEmpty(code)) {
        findings.push({
          ruleCode: "T1-004",
          severity: "block",
          message: `Service line ${i + 1} is missing a procedure code`,
          field: "procedureCode",
          serviceLineIndex: i,
        });
      } else if (!CPT_HCPCS_PATTERN.test(code)) {
        findings.push({
          ruleCode: "T1-004",
          severity: "block",
          message: `Service line ${i + 1} procedure code "${code}" does not match CPT/HCPCS format`,
          field: "procedureCode",
          serviceLineIndex: i,
        });
      }

      // T1-005
      const units = line.units;
      if (units === null || units === undefined || !Number.isFinite(units) || (units as number) <= 0) {
        findings.push({
          ruleCode: "T1-005",
          severity: "block",
          message: `Service line ${i + 1} has invalid units (${units ?? "missing"})`,
          field: "units",
          serviceLineIndex: i,
        });
      }

      // T1-006
      const charge = line.totalCharge;
      if (charge === null || charge === undefined || !Number.isFinite(charge) || (charge as number) < 0) {
        findings.push({
          ruleCode: "T1-006",
          severity: "block",
          message: `Service line ${i + 1} has invalid charge amount (${charge ?? "missing"})`,
          field: "totalCharge",
          serviceLineIndex: i,
        });
      }
    });
  }

  // T1-007
  const icd = input.icd10Primary?.toString().trim() ?? "";
  if (!nonEmpty(icd)) {
    findings.push({
      ruleCode: "T1-007",
      severity: "block",
      message: "Claim is missing primary ICD-10 diagnosis",
      field: "icd10Primary",
    });
  } else if (!ICD10_PATTERN.test(icd)) {
    findings.push({
      ruleCode: "T1-007",
      severity: "block",
      message: `Primary ICD-10 "${icd}" does not match ICD-10 format`,
      field: "icd10Primary",
    });
  }

  // T1-008
  const claimDate = asDate(input.serviceDate ?? null);
  const anyLineHasDate = (input.serviceLines ?? []).some(
    (l) => asDate(l.serviceDate ?? null) !== null,
  );
  if (!claimDate && !anyLineHasDate) {
    findings.push({
      ruleCode: "T1-008",
      severity: "block",
      message: "Claim has no service date (neither header nor any line)",
      field: "serviceDate",
    });
  }

  return findings;
}

/** True when no `block`-severity findings were produced. */
export function isTier1Passing(findings: Tier1Finding[]): boolean {
  return !findings.some((f) => f.severity === "block");
}
