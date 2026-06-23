export type Severity = 'error' | 'warning' | 'info';

export interface Violation {
  ruleId: string;
  code: string;
  severity: Severity;
  message: string;
  fieldPath: string;
  ediSegment?: string;
  suggestedFix?: string;
  packId: string;
  data?: Record<string, unknown>;
}

export interface NormalizedServiceLine {
  index: number;
  hcpcsCode: string;
  units: number;
  charge: number;
  modifier: string | null;
  diagnosisPointer: string;
  serviceDate: string | null;
  serviceDateTo: string | null;
}

export interface PatientRecord {
  id: string;
  firstName: string | null;
  lastName: string | null;
  middleName: string | null;
  dob: string;
  sex: string | null;
  memberId: string | null;
  veteranIdType: string | null;
  address: { line1?: string; city?: string; state?: string; zip?: string } | null;
}

export interface PayerRecord {
  id: string;
  name: string;
  payerId: string | null;
  payerClassification: string | null;
  claimFilingIndicator: string | null;
  memberIdQualifier: string | null;
  referringProviderPolicy: string;
  authRequired: boolean;
}

export interface AuthRecord {
  id: string;
  authNumber: string | null;
  expirationDate: string | null;
  issuedDate: string | null;
}

export interface ReferringProviderRecord {
  id: string;
  firstName: string;
  lastName: string;
  npi: string | null;
  vaCompositeId: string | null;
  verificationStatus: string;
}

export interface PracticeRecord {
  id: string;
  practiceName: string;
  primaryNpi: string | null;
  taxId: string | null;
  taxonomyCode: string | null;
  address: { line1?: string; city?: string; state?: string; zip?: string } | null;
  agencyNpi: string | null;
}

/** Revenue line entry for 837I institutional claims. */
export interface HhVisitLine {
  revenueCode: string;
  visitCount: number;
}

export interface ClaimWithRelations {
  id: string;
  patientId: string;
  organizationId: string | null;
  status: string;
  payerFkId: string | null;
  payerName: string;
  serviceDate: string | null;
  placeOfService: string;
  authorizationNumber: string | null;
  referringProviderId: string | null;
  icd10Codes: string[];
  serviceLines: NormalizedServiceLine[];
  claimFrequencyCode: string;
  /** '837I' for institutional home-health claims; '837P' or null for professional. */
  claimTransactionSet?: string | null;
  amount: number;
  patient: PatientRecord;
  payerRecord: PayerRecord | null;
  auth: AuthRecord | null;
  referringProvider: ReferringProviderRecord | null;

  // ── HH context (populated only when claimTransactionSet === '837I') ──────
  /** HIPPS code from the billing period. */
  hippsCode?: string | null;
  /** OASIS assessment reference date (YYYY-MM-DD). */
  oasisDate?: string | null;
  /** FIPS county code for value code 61 (home health). */
  fipsCounty?: string | null;
  /** CBSA code for geographic wage index. */
  cbsaCode?: string | null;
  /** Revenue lines built from episode visit discipline counts. */
  visitLines?: HhVisitLine[];
  /** Status of the most recent NOA filing for this episode. */
  noaStatus?: string | null;
  /** Number of days the NOA was filed late (0 = on time). */
  noaPenaltyDays?: number;
  /** Date the NOA was filed (YYYY-MM-DD). */
  noaFiledDate?: string | null;
  /** Episode start-of-care date (YYYY-MM-DD). */
  socDate?: string | null;
  /** Org-level RCD policy: 'pre_claim_review' | 'postpayment_review' | 'exempt'. */
  rcdReviewChoice?: string | null;
  /** True when the episode has an affirmed PCR with a UTN number. */
  utnAffirmed?: boolean;
  /** The UTN number from the most recent affirmed PCR, or null. */
  utnNumber?: string | null;
  /** Total visits authorized for linked prior authorization. */
  visitsApproved?: number | null;
  /** Visits consumed against the linked prior authorization. */
  visitsUsed?: number | null;
}

export interface RuleContext {
  claim: ClaimWithRelations;
  practice: PracticeRecord;
  today: Date;
}

export interface Rule {
  id: string;
  code: string;
  description: string;
  severity: Severity;
  ediSegment?: string;
  appliesWhen?: (ctx: RuleContext) => boolean;
  check: (ctx: RuleContext) => Violation[] | null;
}

export interface RulePack {
  id: string;
  name: string;
  version: string;
  appliesTo: {
    claimType: '837P' | '837I' | '*';
    payerIds?: string[];
    /**
     * Segment filter: if set, this pack only runs for orgs whose
     * practice_settings.care_model is in this list.
     * Used by HH packs so they never load for outpatient orgs.
     */
    careModels?: string[];
  };
  extends?: string[];
  rules: Rule[];
}

export interface ValidationResult {
  claimId: string;
  packsApplied: string[];
  violations: Violation[];
  canSubmit: boolean;
  checkedAt: string;
}
