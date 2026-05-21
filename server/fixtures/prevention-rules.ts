/**
 * Wave 2c — Prevention Rules Fixture
 *
 * Moved from the inline SQL VALUES block in routes.ts (seeder).
 * Each entry maps directly to the rules table columns used in the
 * one-time VA/CARC prevention seeder:
 *   name, description, trigger_pattern, prevention_action, payer,
 *   enabled, specialty_tags
 *
 * specialty_tags are set here explicitly so the keyword-scan migration
 * at startup does not need to retroactively assign them.
 */

export interface PreventionRule {
  name: string;
  description: string;
  trigger_pattern: string;
  prevention_action: "block" | "warn";
  payer: string;
  enabled: boolean;
  specialty_tags: string[];
}

export const PREVENTION_RULES: PreventionRule[] = [
  {
    name: "VA: Missing or Invalid Member ICN/SSN",
    description:
      "VA requires the 17-character Internal Control Number (10 digits + V + 6 digits) or 9-digit SSN with no special characters in the Member ID field. This is the #1 VA rejection reason.",
    trigger_pattern: "member_id_format",
    prevention_action: "block",
    payer: "VA Community Care",
    enabled: true,
    specialty_tags: ["VA Community Care"],
  },
  {
    name: "VA: Invalid or Missing Rendering Provider NPI",
    description:
      "The rendering provider NPI must be a valid 10-digit NPI that passes Luhn checksum validation and is enrolled with the VA Community Care Network.",
    trigger_pattern: "rendering_npi",
    prevention_action: "block",
    payer: "VA Community Care",
    enabled: true,
    specialty_tags: ["VA Community Care"],
  },
  {
    name: "VA: Invalid Place of Service Code",
    description:
      "VA home health claims must use Place of Service 12 (Home). Using an incorrect POS code is a top-10 VA rejection reason.",
    trigger_pattern: "place_of_service",
    prevention_action: "warn",
    payer: "VA Community Care",
    enabled: true,
    specialty_tags: ["VA Community Care", "Home Health"],
  },
  {
    name: "VA: Unrecognized HCPCS/CPT Code",
    description:
      "All procedure codes must be valid HCPCS Level II or CPT codes. VA will reject claims with invalid or discontinued codes.",
    trigger_pattern: "procedure_code_validity",
    prevention_action: "block",
    payer: "VA Community Care",
    enabled: true,
    specialty_tags: ["VA Community Care"],
  },
  {
    name: "VA: Missing Provider Taxonomy Code",
    description:
      "VA requires a valid taxonomy code on the service line provider. Home health RN taxonomy is 163W00000X.",
    trigger_pattern: "provider_taxonomy",
    prevention_action: "warn",
    payer: "VA Community Care",
    enabled: true,
    specialty_tags: ["VA Community Care"],
  },
  {
    name: "VA: ICD-9 Diagnosis Code Used Instead of ICD-10",
    description:
      "VA requires ICD-10-CM codes for all dates of service after 09/30/2015. ICD-9 codes will be rejected immediately.",
    trigger_pattern: "diagnosis_code_version",
    prevention_action: "block",
    payer: "VA Community Care",
    enabled: true,
    specialty_tags: ["VA Community Care"],
  },
  {
    name: "VA: Timely Filing Limit Approaching (180 Days)",
    description:
      "VA Community Care Network requires claims within 180 days of service date. After 180 days, claims cannot be paid or appealed.",
    trigger_pattern: "timely_filing",
    prevention_action: "warn",
    payer: "VA Community Care",
    enabled: true,
    specialty_tags: ["VA Community Care"],
  },
  {
    name: "VA: Timely Filing Limit Exceeded (180 Days)",
    description:
      "Claim is past the 180-day VA timely filing deadline. VA will reject this claim and it is nearly impossible to appeal successfully.",
    trigger_pattern: "timely_filing_exceeded",
    prevention_action: "block",
    payer: "VA Community Care",
    enabled: true,
    specialty_tags: ["VA Community Care"],
  },
  {
    name: "VA: Missing Authorization Number",
    description:
      "All VA Community Care claims require a pre-authorization/referral number issued by the VA or Optum/TriWest. Claims without auth numbers will be denied.",
    trigger_pattern: "authorization_required",
    prevention_action: "block",
    payer: "VA Community Care",
    enabled: true,
    specialty_tags: ["VA Community Care"],
  },
  {
    name: "VA: Authorization Number Format Invalid",
    description:
      "VA authorization numbers follow a specific format. Invalid auth numbers result in denial even if care was authorized.",
    trigger_pattern: "authorization_format",
    prevention_action: "warn",
    payer: "VA Community Care",
    enabled: true,
    specialty_tags: ["VA Community Care"],
  },
  {
    name: "CARC CO-29: Timely Filing — Medicare (365 Days)",
    description:
      "Medicare requires claims within 365 days of service date. Missing this window results in CO-29 denial with no appeal path.",
    trigger_pattern: "medicare_timely_filing",
    prevention_action: "warn",
    payer: "Medicare",
    enabled: true,
    specialty_tags: ["Medicare"],
  },
  {
    name: "CARC CO-97: Service Already Included in Another Code (NCCI Bundling)",
    description:
      "Billing two codes where one is included in the other per CCI edits. Common home health example: billing G0299 and a separate E&M visit on same date without modifier.",
    trigger_pattern: "ncci_bundling",
    prevention_action: "warn",
    payer: "All",
    enabled: true,
    specialty_tags: ["Universal"],
  },
  {
    name: "CARC CO-16: Claim Missing Required Information",
    description:
      "CO-16 is the most frequently issued CARC. Triggered by missing NPI, missing auth number, missing diagnosis pointer, or invalid dates.",
    trigger_pattern: "missing_required_fields",
    prevention_action: "block",
    payer: "All",
    enabled: true,
    specialty_tags: ["Universal"],
  },
  {
    name: "CARC CO-4: Modifier Required or Inconsistent with Procedure",
    description:
      "Certain timed home health codes require modifiers (e.g., modifier GT for telehealth, modifier 59 for distinct service). Missing or wrong modifier causes CO-4 denial.",
    trigger_pattern: "modifier_required",
    prevention_action: "warn",
    payer: "All",
    enabled: true,
    specialty_tags: ["Universal"],
  },
  {
    name: "CARC CO-50: Service Not Medically Necessary",
    description:
      "Payer determined the service does not meet medical necessity criteria for the diagnosis billed. Ensure ICD-10 diagnosis supports the home health service provided.",
    trigger_pattern: "medical_necessity",
    prevention_action: "warn",
    payer: "All",
    enabled: false,
    specialty_tags: ["Universal"],
  },
  {
    name: "Duplicate Claim: Same Patient, Service Date, and Code",
    description:
      "A claim with the same patient, service date, and procedure code was already submitted. Duplicate claims result in CO-18 or VA rejection code 65 denial.",
    trigger_pattern: "duplicate_claim",
    prevention_action: "block",
    payer: "All",
    enabled: true,
    specialty_tags: ["Universal"],
  },
  {
    name: "VA: G0299 Units May Exceed Authorized Hours",
    description:
      "G0299 billed in 15-minute units. Verify that total units billed do not exceed the hours authorized on the VA referral.",
    trigger_pattern: "va_unit_authorization_check",
    prevention_action: "warn",
    payer: "VA Community Care",
    enabled: true,
    specialty_tags: ["VA Community Care"],
  },
  {
    name: "Missing ICD-10 Diagnosis Pointer on Service Line",
    description:
      "Each service line must have a diagnosis pointer linking it to one of the listed ICD-10 codes (A, B, C, or D). Missing pointer causes CO-16 with RARC N286.",
    trigger_pattern: "diagnosis_pointer",
    prevention_action: "warn",
    payer: "All",
    enabled: true,
    specialty_tags: ["Universal"],
  },
  {
    name: "VA: Home Health Code Requires Place of Service 12",
    description:
      "G0299, G0300, G0151, G0152, G0153, G0156, T1019 must be billed with Place of Service 12 (Home). Using any other POS for these codes will result in denial.",
    trigger_pattern: "home_health_pos_mismatch",
    prevention_action: "block",
    payer: "All",
    enabled: true,
    specialty_tags: ["VA Community Care", "Home Health"],
  },
  {
    name: "Provider Not Credentialed with Payer",
    description:
      "Rendering provider must be credentialed and contracted with the payer. Uncredentialed providers result in immediate denial.",
    trigger_pattern: "provider_credentialing",
    prevention_action: "warn",
    payer: "All",
    enabled: false,
    specialty_tags: ["Universal"],
  },
  {
    name: "CARC CO-29: Medicare Timely Filing Exceeded (365 Days)",
    description:
      "Claim is past the 365-day Medicare timely filing limit. CO-29 denial cannot be appealed except in cases of administrative error by a Medicare agent.",
    trigger_pattern: "medicare_timely_exceeded",
    prevention_action: "block",
    payer: "Medicare",
    enabled: true,
    specialty_tags: ["Medicare"],
  },
  {
    name: "COB: VA Secondary Payer Requires Primary EOB",
    description:
      "When VA is secondary payer, the primary insurance EOB must be attached. VA will reject as code 78 without the primary payer EOB.",
    trigger_pattern: "cob_primary_eob_required",
    prevention_action: "warn",
    payer: "VA Community Care",
    enabled: true,
    specialty_tags: ["VA Community Care"],
  },
];
