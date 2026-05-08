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
  amount: number;
  patient: PatientRecord;
  payerRecord: PayerRecord | null;
  auth: AuthRecord | null;
  referringProvider: ReferringProviderRecord | null;
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
    claimType: '837P' | '837I';
    payerIds?: string[];
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
