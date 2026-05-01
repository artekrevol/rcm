import { pool } from "../db";

// ────────────────────────────────────────────────────────────────────────────
// Interfaces
// ────────────────────────────────────────────────────────────────────────────

export interface ServiceLine {
  code: string;          // HCPCS/CPT
  modifier?: string;     // space/comma separated modifiers
  units?: number;
  totalCharge?: number;
}

export interface ClaimContext {
  claimId?: string;
  organizationId: string;
  patientId: string;
  payerId: string | null;
  payerName: string;
  planProduct: "HMO" | "PPO" | "POS" | "EPO" | "Indemnity" | "unknown" | null;
  serviceDate: Date | null;
  serviceLines: ServiceLine[];
  icd10Primary: string;
  icd10Secondary: string[];
  authorizationNumber: string | null;
  placeOfService: string;
  memberId: string | null;
  patientDob: Date | null;
  patientFirstName: string | null;
  patientLastName: string | null;
  testMode?: boolean;
  // PCP Referral (Prompt 05)
  pcpReferralCheckStatus?: "not_required" | "present_valid" | "present_expired" | "present_used_up" | "missing" | "unknown" | null;
}

export type RuleType =
  | "timely_filing"
  | "prior_auth"
  | "modifier"
  | "appeals"
  | "cci_edit"
  | "plan_product_mismatch"
  | "date_sanity"
  | "data_quality";

export type Severity = "block" | "warn" | "info";

export interface RuleViolation {
  ruleType: RuleType;
  severity: Severity;
  message: string;
  fixSuggestion: string;
  ruleId: string | null;
  sourcePage: number | null;
  sourceQuote: string | null;
  payerSpecific: boolean;
  reviewedBy?: string | null;
  lastVerifiedAt?: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

// Accepts codes with or without the decimal separator (both F03.90 and F0390 are valid)
const ICD10_PATTERN = /^[A-Z][0-9][0-9A-Z]([0-9A-Z]{1,4}|\.[0-9A-Z]{1,4})?$/i;
const CPT_HCPCS_PATTERN = /^[A-Z0-9]{4,7}$/i;
const UNBUNDLING_MODIFIERS = ["59", "XE", "XS", "XP", "XU"];

// HMO-suspect payer name fragments — if plan_product is unknown/null these trigger a warning
const HMO_SUSPECT_PAYERS = [
  "aetna", "kaiser", "molina", "united", "uhc", "humana hmo",
  "health plan", "hmo", "kaiser permanente", "anthem hmo", "blue shield hmo",
  "centene", "wellcare", "bright health",
];

function hasUnbundlingMod(modifier: string | undefined): boolean {
  if (!modifier) return false;
  const parts = modifier.toUpperCase().split(/[\s,;/]+/).map((m) => m.trim());
  return UNBUNDLING_MODIFIERS.some((m) => parts.includes(m));
}

function planProductMatches(
  appliesTo: string[] | null | undefined,
  planProduct: string | null
): boolean {
  if (!appliesTo || appliesTo.length === 0 || appliesTo.includes("all")) return true;
  if (!planProduct || planProduct === "unknown") return false;
  return appliesTo.includes(planProduct);
}

// ────────────────────────────────────────────────────────────────────────────
// Sanity rules (no DB queries)
// ────────────────────────────────────────────────────────────────────────────

function runSanityRules(ctx: ClaimContext): RuleViolation[] {
  const violations: RuleViolation[] = [];
  const now = new Date();

  // ── Date sanity ──────────────────────────────────────────────────────────
  if (!ctx.serviceDate) {
    violations.push({
      ruleType: "date_sanity",
      severity: "block",
      message: "Service date is missing.",
      fixSuggestion: "Enter the date of service before submitting.",
      ruleId: null,
      sourcePage: null,
      sourceQuote: null,
      payerSpecific: false,
    });
  } else {
    const svcMs = ctx.serviceDate.getTime();
    const daysDiff = Math.floor((now.getTime() - svcMs) / 86400000);

    if (daysDiff < 0) {
      violations.push({
        ruleType: "date_sanity",
        severity: "block",
        message: `Service date is ${Math.abs(daysDiff)} day(s) in the future — payers reject future-dated claims.`,
        fixSuggestion: "Correct the service date to the actual date of service.",
        ruleId: null,
        sourcePage: null,
        sourceQuote: null,
        payerSpecific: false,
      });
    } else if (daysDiff > 365) {
      violations.push({
        ruleType: "date_sanity",
        severity: "warn",
        message: `Service date is ${daysDiff} days ago (more than one year). Many payers have timely filing limits.`,
        fixSuggestion: "Verify the service date is correct and check the payer's timely filing limit.",
        ruleId: null,
        sourcePage: null,
        sourceQuote: null,
        payerSpecific: false,
      });
    }

    if (ctx.patientDob) {
      const dobMs = ctx.patientDob.getTime();
      if (dobMs > svcMs) {
        violations.push({
          ruleType: "date_sanity",
          severity: "block",
          message: "Patient date of birth is after the service date — likely a data entry error.",
          fixSuggestion: "Correct the patient's date of birth or the service date.",
          ruleId: null,
          sourcePage: null,
          sourceQuote: null,
          payerSpecific: false,
        });
      }
    }
  }

  // ── Diagnosis sanity ─────────────────────────────────────────────────────
  if (!ctx.icd10Primary) {
    violations.push({
      ruleType: "data_quality",
      severity: "block",
      message: "Primary diagnosis code is missing.",
      fixSuggestion: "Add at least one ICD-10 diagnosis code before submitting.",
      ruleId: null,
      sourcePage: null,
      sourceQuote: null,
      payerSpecific: false,
    });
  } else if (!ICD10_PATTERN.test(ctx.icd10Primary.trim())) {
    violations.push({
      ruleType: "data_quality",
      severity: "block",
      message: `Primary diagnosis code "${ctx.icd10Primary}" does not match the ICD-10 format (e.g. Z79.891).`,
      fixSuggestion: "Verify and correct the ICD-10 code.",
      ruleId: null,
      sourcePage: null,
      sourceQuote: null,
      payerSpecific: false,
    });
  }

  const allDx: string[] = [];
  if (ctx.icd10Primary) allDx.push(ctx.icd10Primary.trim().toUpperCase());
  for (const sec of ctx.icd10Secondary) {
    if (sec) allDx.push(sec.trim().toUpperCase());
  }
  if (allDx.length > new Set(allDx).size) {
    const dupes = allDx.filter((c, i) => allDx.indexOf(c) !== i);
    violations.push({
      ruleType: "data_quality",
      severity: "block",
      message: `Duplicate diagnosis code(s): ${[...new Set(dupes)].join(", ")}. Payers reject claims with repeated diagnosis codes.`,
      fixSuggestion: "Remove the duplicate code from secondary diagnoses.",
      ruleId: null,
      sourcePage: null,
      sourceQuote: null,
      payerSpecific: false,
    });
  }

  // ── Service line sanity ──────────────────────────────────────────────────
  const filledLines = ctx.serviceLines.filter((l) => l.code);
  if (filledLines.length === 0) {
    violations.push({
      ruleType: "data_quality",
      severity: "block",
      message: "No service lines with procedure codes.",
      fixSuggestion: "Add at least one HCPCS/CPT code on a service line.",
      ruleId: null,
      sourcePage: null,
      sourceQuote: null,
      payerSpecific: false,
    });
  } else {
    for (const line of filledLines) {
      if (!CPT_HCPCS_PATTERN.test(line.code.trim())) {
        violations.push({
          ruleType: "data_quality",
          severity: "block",
          message: `Service line code "${line.code}" doesn't look like a valid CPT/HCPCS code.`,
          fixSuggestion: "Verify the procedure code format (4–7 alphanumeric characters).",
          ruleId: null,
          sourcePage: null,
          sourceQuote: null,
          payerSpecific: false,
        });
      }
      if (line.totalCharge !== undefined && line.totalCharge <= 0) {
        violations.push({
          ruleType: "data_quality",
          severity: "warn",
          message: `Service line ${line.code} has a $0 charge — unusual and may trigger payer review.`,
          fixSuggestion: "Confirm the charge amount is correct.",
          ruleId: null,
          sourcePage: null,
          sourceQuote: null,
          payerSpecific: false,
        });
      }
      if (line.units !== undefined && line.units > 999) {
        violations.push({
          ruleType: "data_quality",
          severity: "warn",
          message: `Service line ${line.code} has ${line.units} units — suspiciously high, likely a data entry error.`,
          fixSuggestion: "Verify the unit count is correct.",
          ruleId: null,
          sourcePage: null,
          sourceQuote: null,
          payerSpecific: false,
        });
      }
    }
  }

  // ── Patient / insurance sanity ────────────────────────────────────────────
  if (!ctx.memberId) {
    violations.push({
      ruleType: "data_quality",
      severity: "block",
      message: "Member ID is missing. Payers cannot identify the patient's coverage without it.",
      fixSuggestion: "Add the patient's insurance member ID before submitting.",
      ruleId: null,
      sourcePage: null,
      sourceQuote: null,
      payerSpecific: false,
    });
  } else {
    const mId = ctx.memberId.trim().toUpperCase();
    const testPatterns = ["TEST", "ZZZ", "000000000", "123456789", "999999999", "111111111"];
    const isTestId = testPatterns.some((p) => mId.includes(p)) || /^0+$/.test(mId);
    if (isTestId && !ctx.testMode) {
      violations.push({
        ruleType: "data_quality",
        severity: "block",
        message: `Member ID "${ctx.memberId}" appears to be a test/placeholder value and will be rejected by the payer.`,
        fixSuggestion: "Replace with the patient's actual insurance member ID.",
        ruleId: null,
        sourcePage: null,
        sourceQuote: null,
        payerSpecific: false,
      });
    }
  }

  if (!ctx.patientFirstName || !ctx.patientLastName) {
    violations.push({
      ruleType: "data_quality",
      severity: "block",
      message: "Patient name (first or last) is missing.",
      fixSuggestion: "Complete the patient's full name on the patient record.",
      ruleId: null,
      sourcePage: null,
      sourceQuote: null,
      payerSpecific: false,
    });
  }

  if (!ctx.patientDob) {
    violations.push({
      ruleType: "data_quality",
      severity: "warn",
      message: "Patient date of birth is missing.",
      fixSuggestion: "Add the patient's date of birth to the patient record.",
      ruleId: null,
      sourcePage: null,
      sourceQuote: null,
      payerSpecific: false,
    });
  }

  // ── Plan product / HMO-suspect warning ──────────────────────────────────
  const payerNameLc = (ctx.payerName || "").toLowerCase();
  const isHmoSuspect = HMO_SUSPECT_PAYERS.some((p) => payerNameLc.includes(p));
  if (isHmoSuspect && (!ctx.planProduct || ctx.planProduct === "unknown")) {
    violations.push({
      ruleType: "plan_product_mismatch",
      severity: "warn",
      message: `Payer "${ctx.payerName}" often requires a plan product (HMO/PPO/etc.) to determine authorization requirements. Plan product is unset.`,
      fixSuggestion: "Set the plan product on the patient's insurance record to \"HMO\" or the correct type.",
      ruleId: null,
      sourcePage: null,
      sourceQuote: null,
      payerSpecific: true,
    });
  }

  return violations;
}

// ────────────────────────────────────────────────────────────────────────────
// Main evaluateClaim() — queries DB + runs sanity rules
// ────────────────────────────────────────────────────────────────────────────

export async function evaluateClaim(
  ctx: ClaimContext,
  options: { includeDemoSeed?: boolean } = {}
): Promise<RuleViolation[]> {
  const { includeDemoSeed = false } = options;
  const violations: RuleViolation[] = [];

  // Sanity rules first (no DB)
  violations.push(...runSanityRules(ctx));

  const client = await pool.connect();
  try {
    // ── 1. Payer source document extraction items ──────────────────────────
    //   Join payer_source_documents → manual_extraction_items where payer_id matches
    //   and review_status = 'approved'.
    //   Demo-seed rows (is_demo_seed=TRUE) are excluded by default; pass
    //   includeDemoSeed=true to include them (e.g. from the /cascade-demo path).
    if (ctx.payerId) {
      const manualItems = await client.query(`
        SELECT
          mei.id,
          mei.section_type,
          mei.raw_snippet,
          mei.extracted_json,
          mei.applies_to_plan_products,
          mei.reviewed_by,
          mei.last_verified_at,
          pm.document_name AS payer_name,
          pm.source_url
        FROM manual_extraction_items mei
        JOIN payer_source_documents pm ON pm.id = mei.source_document_id
        WHERE pm.payer_id = $1
          AND mei.review_status = 'approved'
          AND ($2 OR mei.is_demo_seed = FALSE)
        ORDER BY mei.section_type, mei.created_at
      `, [ctx.payerId, includeDemoSeed]);

      const now = new Date();

      for (const item of manualItems.rows) {
        const applies = planProductMatches(
          item.applies_to_plan_products as string[] | null,
          ctx.planProduct
        );
        if (!applies) continue;

        const ej = item.extracted_json || {};
        const section: string = item.section_type;

        // ── Timely filing ──────────────────────────────────────────────────
        if (section === "timely_filing" && ctx.serviceDate) {
          const days: number = ej.days || 365;
          const svcMs = ctx.serviceDate.getTime();
          const daysSince = Math.floor((now.getTime() - svcMs) / 86400000);
          const daysRemaining = days - daysSince;

          if (daysRemaining < 0) {
            violations.push({
              ruleType: "timely_filing",
              severity: "block",
              message: `Service date is ${daysSince} days ago — past the ${item.payer_name} ${days}-day timely filing limit.`,
              fixSuggestion: `File a late claim exception with ${item.payer_name} or write off the claim.`,
              ruleId: item.id,
              sourcePage: ej.source_page || null,
              sourceQuote: item.raw_snippet || null,
              payerSpecific: true,
              reviewedBy: item.reviewed_by || null,
              lastVerifiedAt: item.last_verified_at ? String(item.last_verified_at) : null,
            });
          } else if (daysRemaining <= 30) {
            violations.push({
              ruleType: "timely_filing",
              severity: "block",
              message: `Filing deadline is ${daysRemaining} day(s) away for ${item.payer_name} (${days}-day limit). Submit immediately.`,
              fixSuggestion: "Submit this claim today — it is within the final 30-day window.",
              ruleId: item.id,
              sourcePage: ej.source_page || null,
              sourceQuote: item.raw_snippet || null,
              payerSpecific: true,
              reviewedBy: item.reviewed_by || null,
              lastVerifiedAt: item.last_verified_at ? String(item.last_verified_at) : null,
            });
          } else if (daysRemaining <= days * 0.2) {
            // Within 20% of deadline
            violations.push({
              ruleType: "timely_filing",
              severity: "warn",
              message: `Service date is ${daysSince} days ago — approaching the ${item.payer_name} ${days}-day filing limit (${daysRemaining} days remaining).`,
              fixSuggestion: "Prioritize this claim to avoid missing the filing deadline.",
              ruleId: item.id,
              sourcePage: ej.source_page || null,
              sourceQuote: item.raw_snippet || null,
              payerSpecific: true,
              reviewedBy: item.reviewed_by || null,
              lastVerifiedAt: item.last_verified_at ? String(item.last_verified_at) : null,
            });
          }
        }

        // ── Prior authorization ────────────────────────────────────────────
        if (section === "prior_auth") {
          const requiresAuth: boolean = ej.requires_auth === true;
          if (!requiresAuth) continue;

          const coveredCodes: string[] = ej.cpt_codes || [];
          const threshold: number | null = ej.threshold_units || null;

          // Determine if any of the claim's codes fall under this rule
          const allCodes = ctx.serviceLines.map((l) => l.code.toUpperCase());
          const ruleAppliesToClaim =
            coveredCodes.length === 0 || // rule applies to all services
            allCodes.some((c) => coveredCodes.includes(c));

          if (!ruleAppliesToClaim) continue;

          if (!ctx.authorizationNumber) {
            const criteria = ej.criteria || "Prior authorization required.";
            violations.push({
              ruleType: "prior_auth",
              severity: "block",
              message: `${item.payer_name} requires prior authorization for this service type${coveredCodes.length > 0 ? ` (${coveredCodes.slice(0, 5).join(", ")})` : ""}. No authorization number is on record.`,
              fixSuggestion: `Obtain authorization from ${item.payer_name} before submitting. Criteria: ${criteria}`,
              ruleId: item.id,
              sourcePage: ej.source_page || null,
              sourceQuote: item.raw_snippet || null,
              payerSpecific: true,
              reviewedBy: item.reviewed_by || null,
              lastVerifiedAt: item.last_verified_at ? String(item.last_verified_at) : null,
            });
          }
        }

        // ── Modifier requirements (Prompt B1: renamed from modifiers → modifiers_and_liability) ──
        if (section === "modifiers_and_liability") {
          const requiredModifier: string = (ej.modifier_code || "").toUpperCase();
          if (!requiredModifier) continue;

          const payer_rule: string = ej.payer_rule || "";
          const description: string = ej.description || "";

          // Check if this modifier is already on all relevant service lines
          const allLines = ctx.serviceLines.filter((l) => l.code);
          const missingModifier = allLines.some((l) => {
            const mods = (l.modifier || "").toUpperCase().split(/[\s,;/]+/).map((m) => m.trim());
            return !mods.includes(requiredModifier);
          });

          if (missingModifier && allLines.length > 0) {
            violations.push({
              ruleType: "modifier",
              severity: "warn",
              message: `${item.payer_name} requires modifier ${requiredModifier} (${description}) on applicable service lines.`,
              fixSuggestion: payer_rule || `Append modifier ${requiredModifier} to the relevant service line(s).`,
              ruleId: item.id,
              sourcePage: ej.source_page || null,
              sourceQuote: item.raw_snippet || null,
              payerSpecific: true,
              reviewedBy: item.reviewed_by || null,
              lastVerifiedAt: item.last_verified_at ? String(item.last_verified_at) : null,
            });
          }
        }
      }
    }

    // ── 2. CCI edit conflicts ────────────────────────────────────────────────
    const codes = ctx.serviceLines
      .map((l) => (l.code || "").trim().toUpperCase())
      .filter(Boolean);

    if (codes.length >= 2) {
      const cciResult = await client.query(`
        SELECT id, column_1_code, column_2_code, modifier_indicator, ptp_edit_rationale
        FROM cci_edits
        WHERE deletion_date IS NULL
          AND ncci_version = (SELECT MAX(ncci_version) FROM cci_edits WHERE TRUE)
          AND column_1_code = ANY($1)
          AND column_2_code = ANY($1)
          AND modifier_indicator != '9'
      `, [codes]);

      for (const conflict of cciResult.rows) {
        const { id, column_1_code, column_2_code, modifier_indicator, ptp_edit_rationale } = conflict;

        const compLine = ctx.serviceLines.find(
          (l) => (l.code || "").toUpperCase() === column_2_code
        );
        const alreadyHasMod = hasUnbundlingMod(compLine?.modifier);

        if (modifier_indicator === "0") {
          violations.push({
            ruleType: "cci_edit",
            severity: "block",
            message: `CCI hard block: ${column_1_code} and ${column_2_code} cannot be billed together — CMS bundles ${column_2_code} into ${column_1_code}. ${ptp_edit_rationale || ""}`,
            fixSuggestion: `Remove ${column_2_code} from the claim. Only ${column_1_code} should be billed.`,
            ruleId: id,
            sourcePage: null,
            sourceQuote: null,
            payerSpecific: false,
          });
        } else if (modifier_indicator === "1" && !alreadyHasMod) {
          violations.push({
            ruleType: "cci_edit",
            severity: "warn",
            message: `CCI soft edit: ${column_1_code} and ${column_2_code} are typically bundled. ${ptp_edit_rationale || ""}`,
            fixSuggestion: `Add modifier 59 (or XE/XS/XP/XU) to ${column_2_code} to justify separate billing.`,
            ruleId: id,
            sourcePage: null,
            sourceQuote: null,
            payerSpecific: false,
          });
        }
      }
    }
  } finally {
    client.release();
  }

  // ── PCP Referral check ──────────────────────────────────────────────────
  const pcpViolation = evaluatePCPReferral(ctx);
  if (pcpViolation) violations.push(pcpViolation);

  // ── Rate check (Task 8) ─────────────────────────────────────────────────
  // Only for VA Community Care or Medicare payer names; skip if no service lines with charges
  const payerNameLc2 = (ctx.payerName || "").toLowerCase();
  const isVAOrMedicare =
    payerNameLc2.includes("va ") || payerNameLc2.includes("triwest") ||
    payerNameLc2.includes("optum") || payerNameLc2.includes("community care") ||
    payerNameLc2.includes("medicare") || payerNameLc2.includes("cms");

  if (isVAOrMedicare && ctx.serviceDate && ctx.serviceLines.length > 0) {
    try {
      const { calculateExpectedPayment } = await import("./expected-payment");
      const payerTypeForRate = (payerNameLc2.includes("va") || payerNameLc2.includes("triwest") || payerNameLc2.includes("optum") || payerNameLc2.includes("community care"))
        ? "va_community_care" : "medicare";

      for (const line of ctx.serviceLines) {
        if (!line.code || !line.totalCharge || line.totalCharge <= 0) continue;
        const firstMod = line.modifier ? line.modifier.split(/[\s,]+/)[0].trim() || null : null;
        const exp = await calculateExpectedPayment(
          pool, line.code, firstMod, ctx.organizationId, ctx.serviceDate, "non_facility", payerTypeForRate
        );

        if (exp.rate_source === "no_rate_found") {
          violations.push({
            ruleType: "data_quality",
            severity: "info",
            message: `${line.code}: No reference rate on file for this code (not in Medicare PFS or VA Fee Schedule). Billing at agency standard.`,
            fixSuggestion: "Verify your contracted rate for this code. No CMS benchmark is available — ensure the billed amount matches your agreement.",
            ruleId: null, sourcePage: null, sourceQuote: null, payerSpecific: false,
          });
        } else if (exp.expected_amount !== null && exp.expected_amount > 0) {
          const variancePct = ((line.totalCharge - exp.expected_amount) / exp.expected_amount) * 100;
          const src = exp.source_detail;
          if (variancePct > 200) {
            violations.push({
              ruleType: "data_quality",
              severity: "warn",
              message: `${line.code}: Billed $${line.totalCharge.toFixed(2)} is ${Math.round(variancePct)}% above the expected rate of $${exp.expected_amount.toFixed(2)} (${src}).`,
              fixSuggestion: "Verify the billed charge. Amounts more than 2× the Medicare benchmark may be flagged as billing errors by the payer.",
              ruleId: null, sourcePage: null, sourceQuote: null, payerSpecific: false,
            });
          } else if (variancePct < -50) {
            violations.push({
              ruleType: "data_quality",
              severity: "info",
              message: `${line.code}: Billed $${line.totalCharge.toFixed(2)} is ${Math.round(Math.abs(variancePct))}% below the expected rate of $${exp.expected_amount.toFixed(2)} (${src}). Potential under-billing.`,
              fixSuggestion: "Confirm this is intentional. Under-billing leaves reimbursement on the table and may indicate a charge entry error.",
              ruleId: null, sourcePage: null, sourceQuote: null, payerSpecific: false,
            });
          }
        }
      }
    } catch {
      // Rate check is non-blocking — silently skip if DB tables not yet populated
    }
  }

  return violations;
}

// ── PCP Referral evaluator (Prompt 05 T4) ────────────────────────────────
function evaluatePCPReferral(ctx: ClaimContext): RuleViolation | null {
  // Only applies to HMO and POS plans
  if (ctx.planProduct !== "HMO" && ctx.planProduct !== "POS") return null;

  const status = ctx.pcpReferralCheckStatus;

  // Explicitly satisfied
  if (status === "present_valid" || status === "not_required") return null;

  // Unknown / not yet evaluated — don't block at draft stage, just warn
  if (!status || status === "unknown") {
    return {
      ruleType: "plan_product_mismatch",
      severity: "warn",
      message: `${ctx.planProduct} plan — referral status not confirmed. Verify PCP referral before submitting.`,
      fixSuggestion: "Open the patient's Referrals tab and attach an active referral, or confirm via phone.",
      ruleId: null,
      sourcePage: null,
      sourceQuote: null,
      payerSpecific: false,
    };
  }

  if (status === "missing") {
    return {
      ruleType: "plan_product_mismatch",
      severity: "block",
      message: `${ctx.planProduct} plan requires a PCP referral. No referral is on file.`,
      fixSuggestion: "Obtain a referral from the patient's PCP before submitting this claim.",
      ruleId: null,
      sourcePage: null,
      sourceQuote: null,
      payerSpecific: false,
    };
  }

  if (status === "present_expired") {
    return {
      ruleType: "plan_product_mismatch",
      severity: "block",
      message: "PCP referral on file has expired. Claim will likely be denied without a valid referral.",
      fixSuggestion: "Obtain a renewed referral from the patient's PCP or attach a still-valid one.",
      ruleId: null,
      sourcePage: null,
      sourceQuote: null,
      payerSpecific: false,
    };
  }

  if (status === "present_used_up") {
    return {
      ruleType: "plan_product_mismatch",
      severity: "block",
      message: "PCP referral has no remaining authorized visits.",
      fixSuggestion: "Obtain a renewed referral with additional visit authorization before submitting.",
      ruleId: null,
      sourcePage: null,
      sourceQuote: null,
      payerSpecific: false,
    };
  }

  return null;
}

// ── Score helpers ────────────────────────────────────────────────────────────

export function scoreViolations(violations: RuleViolation[]): {
  riskScore: number;
  readinessStatus: "GREEN" | "YELLOW" | "RED";
} {
  let score = 0;
  for (const v of violations) {
    if (v.severity === "block") score += 40;
    else if (v.severity === "warn") score += 15;
    else score += 5;
  }
  const riskScore = Math.min(score, 100);
  const readinessStatus: "GREEN" | "YELLOW" | "RED" =
    riskScore >= 71 ? "RED" : riskScore >= 31 ? "YELLOW" : "GREEN";
  return { riskScore, readinessStatus };
}
