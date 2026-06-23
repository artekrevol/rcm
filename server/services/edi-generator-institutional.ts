/**
 * ClaimShield — 837I Institutional EDI Generator (Home Health)
 *
 * HIPAA X12 005010X223A2 (837 Institutional) for:
 *   - Period-of-care final claims (TOB 032x)
 *   - NOA — Notice of Admission (TOB 032A)
 *   - NOA cancel/rebill (TOB 032D)
 *
 * SIBLING to edi-generator.ts (837P).  That file is untouched except for the
 * dispatch hook in select-generator.ts.  This file has ZERO knowledge of 837P.
 *
 * ── CONFIRM-BEFORE-SHIP items (Phase B dispatch §7) ──────────────────────────
 * [C-1] TOB frequency digit for final claims: 0322 period-1, 0323 period-2,
 *       0324 final/discharge.  Verify against Palmetto HH companion guide.
 * [C-2] UTN placement: REF*9F in Loop 2300. Confirm qualifier with Palmetto.
 * [C-3] VC 85 (FIPS) required on all 32x; VC 61 (CBSA) — confirm applicability.
 * [C-4] Stedi transport: using same raw-x12-submission endpoint.
 *       GS08 differs (005010X223A2) — confirm Stedi accepts institutional via this path.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  ISA, GS, ST, BHT,
  NM1, PER, HL, PRV, N3, N4, DMG, SBR,
  REF, HI, DTP, LX,
  SE, GE, IEA,
  CL1, SV2,
} from './edi/segments.js';

// ── Date helpers ──────────────────────────────────────────────────────────────
function formatDate8(d: string | Date | null | undefined): string {
  if (!d) return '19000101';
  if (d instanceof Date) return d.toISOString().slice(0, 10).replace(/-/g, '');
  return String(d).trim().replace(/-/g, '').slice(0, 8);
}

function mapSex(sex?: string | null): string {
  const c = (sex ?? '').toUpperCase().charAt(0);
  return c === 'M' ? 'M' : c === 'F' ? 'F' : 'U';
}

// ─────────────────────────────────────────────────────────────────────────────
// Input / output types
// ─────────────────────────────────────────────────────────────────────────────

/** Discipline visit line bucketed by revenue code */
export interface HhVisitLine {
  /** 4-digit revenue code, e.g. "0551" (SN), "0421" (PT), "0441" (ST) */
  revenueCode: string;
  visitCount: number;
  charge: number;
}

export type NoaType = 'original' | 'cancel';

export interface HhAdmissionInfo {
  /** Start-of-care / Medicare admission date  YYYY-MM-DD */
  socDate: string;
  /** First clinical visit date (NOA from/through)  YYYY-MM-DD */
  firstVisitDate: string;
  /** Principal ICD-10-CM diagnosis */
  principalDiagnosis: string;
  additionalDiagnoses?: string[];
}

export interface EDI837IInput {
  /**
   * ISA15: 'T' = Test (safe default), 'P' = Production.
   * Callers must set via resolveISA15() only.
   */
  isa15?: 'P' | 'T';

  /**
   * TOB frequency digit (last digit of TOB).
   * '2'=Interim first, '3'=Interim continuing, '4'=Final, '9'=Late charge.
   * [C-1] Confirm with Palmetto HH companion guide.
   */
  claimFrequencyCode: '2' | '3' | '4' | '9';

  /** CMS-1450 patient control number (billing_period id works here). */
  patientControlNumber: string;

  /** Sum of all revenue line charges. */
  totalCharge: number;

  /** 5-character HIPPS code from OASIS grouper (required on 0023 line). */
  hippsCode: string;

  /** Discipline visit revenue lines (excluding the mandatory 0023 HIPPS line). */
  visitLines: HhVisitLine[];

  /** OASIS M0090 completion date → occurrence code 50. */
  oasisDate: string;

  /**
   * FIPS state+county code → value code 85.
   * Format: 2-char state + 3-char county  (e.g., "FL067" = Miami-Dade).
   * [C-3] Required on all TOB 32x per CMS.
   */
  fipsCounty: string;

  /**
   * CBSA code → value code 61. [C-3] Confirm applicability per MAC.
   */
  cbsaCode?: string | null;

  /**
   * UTN from pre-claim review → REF*9F in Loop 2300.
   * Only included when rcd_review_choice = 'pre_claim_review'. [C-2]
   */
  utnNumber?: string | null;

  /**
   * CL103 patient status.
   * '30' = Still patient (interim),  '01' = Routine discharge (final).
   */
  patientStatusCode?: string;

  admission: HhAdmissionInfo;

  patient: {
    first_name: string;
    last_name: string;
    dob: string;
    member_id: string;
    sex?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  };

  practice: {
    name: string;
    legal_name?: string | null;
    npi: string;
    tax_id: string;
    taxonomy_code: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    phone?: string | null;
  };

  /** Attending physician — MUST be an individual NPI, not a group. */
  attendingProvider: {
    first_name: string;
    last_name: string;
    npi: string;
  };

  payer: {
    name: string;
    payer_id: string;
    stedi_payer_id?: string | null;
    claim_filing_indicator?: string | null;
    member_id_qualifier?: string | null;
  };
}

export interface EDI837IResult {
  edi: string;
  rpTransmitted: Record<string, unknown>;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const PALMETTO_PAYER_ID = '10111'; // Palmetto GBA JM Medicare FFS payer ID
const MEDICARE_FILING_INDICATOR = 'MB';

function isMedicarePayer(payer: { name: string; payer_id: string }): boolean {
  const n = (payer.name || '').toLowerCase();
  const id = (payer.payer_id || '').toUpperCase();
  return (
    id === PALMETTO_PAYER_ID || id === 'PALMETTO' ||
    n.includes('palmetto') || n.includes('medicare') || n.includes('palmetto gba')
  );
}

// ── Shared envelope builder ────────────────────────────────────────────────────
interface EnvelopeParams {
  practice: EDI837IInput['practice'];
  payer: EDI837IInput['payer'];
  patient: EDI837IInput['patient'];
  isa15: 'P' | 'T';
  claimControlNumber: string;
  controlNumber: string;
  date: string;
  time: string;
  filingIndicator: string;
}

function buildEnvelopeLoops(p: EnvelopeParams): string[] {
  const segs: string[] = [];
  const effectivePayerId = p.payer.stedi_payer_id || p.payer.payer_id;
  const phone = (p.practice.phone || '0000000000').replace(/\D/g, '');

  // ISA
  segs.push(ISA({ senderId: p.practice.npi, receiverId: effectivePayerId,
    date: p.date.slice(2), time: p.time, controlNumber: p.controlNumber,
    usageIndicator: p.isa15 }));

  // GS — 005010X223A2 for institutional (differs from 837P)
  segs.push(GS({ functionalIdCode: 'HC', applicationSenderId: p.practice.npi,
    applicationReceiverId: effectivePayerId, date: p.date, time: p.time,
    groupControlNumber: '1', versionCode: '005010X223A2' }));

  segs.push(ST({ transactionSetId: '837', controlNumber: '0001',
    implementationConvention: '005010X223A2' }));
  segs.push(BHT({ structureCode: '0019', purposeCode: '00',
    referenceId: p.claimControlNumber, date: p.date, time: p.time, transactionType: 'CH' }));

  // Loop 1000A: Submitter
  segs.push(NM1({ entityIdCode: '41', entityTypeQualifier: '2',
    lastOrOrgName: p.practice.legal_name || p.practice.name, idQualifier: '46', idCode: p.practice.npi }));
  segs.push(PER({ contactFunctionCode: 'IC', name: 'Billing Contact',
    commQualifier1: 'TE', commNumber1: phone }));

  // Loop 1000B: Receiver
  segs.push(NM1({ entityIdCode: '40', entityTypeQualifier: '2',
    lastOrOrgName: p.payer.name, idQualifier: '46', idCode: effectivePayerId }));

  // Loop 2000A / 2010AA: Billing provider
  segs.push(HL({ idNumber: '1', levelCode: '20', childCode: '1' }));
  segs.push(PRV({ providerCode: 'BI', referenceIdQualifier: 'PXC',
    referenceId: p.practice.taxonomy_code }));
  segs.push(NM1({ entityIdCode: '85', entityTypeQualifier: '2',
    lastOrOrgName: p.practice.legal_name || p.practice.name, idQualifier: 'XX', idCode: p.practice.npi }));
  segs.push(N3({ addressLine1: p.practice.address }));
  segs.push(N4({ city: p.practice.city, stateCode: p.practice.state, postalCode: p.practice.zip }));
  segs.push(REF({ qualifier: 'EI', id: p.practice.tax_id.replace(/-/g, '') }));

  // Loop 2000B / 2010BA: Subscriber
  segs.push(HL({ idNumber: '2', parentIdNumber: '1', levelCode: '22', childCode: '0' }));
  segs.push(SBR({ payerResponsibilityCode: 'P', relationshipCode: '18',
    claimFilingIndicatorCode: p.filingIndicator }));

  const memberIdQual = p.payer.member_id_qualifier || 'MI';
  segs.push(NM1({ entityIdCode: 'IL', entityTypeQualifier: '1',
    lastOrOrgName: p.patient.last_name, firstName: p.patient.first_name,
    idQualifier: memberIdQual, idCode: p.patient.member_id }));
  segs.push(N3({ addressLine1: p.patient.address || p.practice.address }));
  segs.push(N4({ city: p.patient.city || p.practice.city,
    stateCode: p.patient.state || p.practice.state,
    postalCode: p.patient.zip || p.practice.zip }));
  segs.push(DMG({ dob: formatDate8(p.patient.dob), genderCode: mapSex(p.patient.sex) }));

  // Loop 2010BB: Payer
  segs.push(NM1({ entityIdCode: 'PR', entityTypeQualifier: '2',
    lastOrOrgName: p.payer.name, idQualifier: 'PI', idCode: effectivePayerId }));

  return segs;
}

// ─────────────────────────────────────────────────────────────────────────────
// generate837I — Period-of-Care Final Claim (TOB 032x)
// ─────────────────────────────────────────────────────────────────────────────

export function generate837I(input: EDI837IInput): EDI837IResult {
  if (!input.hippsCode?.trim())
    throw new Error('[837I] hippsCode is required on the 0023 revenue line.');
  if (!input.fipsCounty?.trim())
    throw new Error('[837I] fipsCounty (value code 85) is required on all TOB 32x claims.');
  if (!input.oasisDate?.trim())
    throw new Error('[837I] oasisDate (occurrence code 50) is required.');
  if (!input.attendingProvider.npi?.trim())
    throw new Error('[837I] attendingProvider.npi must be an individual NPI.');

  const isa15 = input.isa15 ?? 'T';
  const freq = input.claimFrequencyCode;
  const tob = `32${freq}`;
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toTimeString().slice(0, 5).replace(':', '');
  const controlNumber = String(Date.now()).slice(-9).padStart(9, '0');
  const ccn = input.patientControlNumber.replace(/-/g, '').slice(0, 20);
  const filingIndicator = isMedicarePayer(input.payer)
    ? MEDICARE_FILING_INDICATOR : (input.payer.claim_filing_indicator || 'CI');

  const segs = buildEnvelopeLoops({
    practice: input.practice, payer: input.payer, patient: input.patient,
    isa15, claimControlNumber: ccn, controlNumber, date, time, filingIndicator,
  });

  const totalChargeStr = input.totalCharge.toFixed(2);

  // ── Loop 2300: Claim ──────────────────────────────────────────────────────
  // CLM05 for 837I: "facilityTypeCode:facilityCodeQualifier:freqCode"
  // "32" = home health, "1" = UB-92 institutional qualifier. [C-1]
  segs.push(`CLM*${ccn}*${totalChargeStr}***32:1:${freq}*Y*A*Y*Y~`);

  // DTP*434: Statement from/through (SOC to first visit date)
  segs.push(DTP({ qualifier: '434', formatQualifier: 'RD8',
    dateValue: `${formatDate8(input.admission.socDate)}-${formatDate8(input.admission.firstVisitDate)}` }));

  // CL1: Admission type=3 (Elective/HH), source=1 (Non-HC), status per caller
  segs.push(CL1({ admissionTypeCode: '3', admissionSourceCode: '1',
    patientStatusCode: input.patientStatusCode || '30' }));

  // DTP*435: Admission date
  segs.push(DTP({ qualifier: '435', formatQualifier: 'D8',
    dateValue: formatDate8(input.admission.socDate) }));

  // REF*9F: UTN (RCD pre-claim review) — [C-2]
  if (input.utnNumber) segs.push(REF({ qualifier: '9F', id: input.utnNumber }));

  // HI: Diagnoses
  const dxCodes = [input.admission.principalDiagnosis, ...(input.admission.additionalDiagnoses ?? [])];
  const dxComposites = dxCodes.map((code, i) => ({ qualifier: i === 0 ? 'ABK' : 'ABF', code }));
  for (let i = 0; i < dxComposites.length; i += 12) {
    segs.push(HI(dxComposites.slice(i, i + 12)));
  }

  // HI: Occurrence code 50 (OASIS M0090 completion date) — [C-4]
  segs.push(`HI*BH:50:D8:${formatDate8(input.oasisDate)}~`);

  // HI: Value codes 85 (FIPS) + 61 (CBSA) — [C-3]
  if (input.cbsaCode) {
    segs.push(`HI*BE:85::${input.fipsCounty}*BE:61::${input.cbsaCode}~`);
  } else {
    segs.push(`HI*BE:85::${input.fipsCounty}~`);
  }

  // ── Loop 2310A: Attending provider (individual NPI) ───────────────────────
  segs.push(NM1({ entityIdCode: '71', entityTypeQualifier: '1',
    lastOrOrgName: input.attendingProvider.last_name,
    firstName: input.attendingProvider.first_name,
    idQualifier: 'XX', idCode: input.attendingProvider.npi }));

  // ── Loop 2400: Service lines ──────────────────────────────────────────────
  // Line 1: 0023 — HIPPS rate code line (carries the full episode charge per CMS)
  segs.push(LX(1));
  segs.push(SV2({ revenueCode: '0023',
    procedureComposite: `HH:${input.hippsCode}`,
    charge: totalChargeStr, serviceUnits: 1 }));
  segs.push(DTP({ qualifier: '472', formatQualifier: 'RD8',
    dateValue: `${formatDate8(input.admission.socDate)}-${formatDate8(input.oasisDate)}` }));

  // Additional discipline visit lines
  let lineNum = 2;
  for (const line of input.visitLines) {
    segs.push(LX(lineNum));
    segs.push(SV2({ revenueCode: line.revenueCode,
      charge: line.charge.toFixed(2), serviceUnits: line.visitCount }));
    lineNum++;
  }

  // ── Trailers ──────────────────────────────────────────────────────────────
  const segmentCount = segs.length + 1;
  segs.push(SE({ segmentCount, controlNumber: '0001' }));
  segs.push(GE({ transactionCount: 1, groupControlNumber: '1' }));
  segs.push(IEA({ functionalGroupCount: 1, controlNumber }));

  return {
    edi: segs.join('\n'),
    rpTransmitted: { transactionSet: '837I', tob, hippsCode: input.hippsCode,
      fipsCounty: input.fipsCounty, isa15, patientControlNumber: ccn },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// generateNOA — Notice of Admission (TOB 032A / 032D)
// ─────────────────────────────────────────────────────────────────────────────

export interface NOAInput {
  isa15?: 'P' | 'T';
  noaType: NoaType;
  patientControlNumber: string;
  admission: HhAdmissionInfo;
  patient: EDI837IInput['patient'];
  practice: EDI837IInput['practice'];
  attendingProvider: EDI837IInput['attendingProvider'];
  payer: EDI837IInput['payer'];
  /** Administrative charge — $0 is acceptable per CMS guidance. */
  totalCharge?: number;
}

export interface NOAResult {
  edi: string;
  rpTransmitted: Record<string, unknown>;
}

export function generateNOA(input: NOAInput): NOAResult {
  if (!input.attendingProvider.npi?.trim())
    throw new Error('[NOA] attendingProvider.npi must be an individual NPI.');

  const freq = input.noaType === 'cancel' ? 'D' : 'A';
  const tob = `32${freq}`;
  const isa15 = input.isa15 ?? 'T';
  const totalCharge = (input.totalCharge ?? 0).toFixed(2);

  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toTimeString().slice(0, 5).replace(':', '');
  const controlNumber = String(Date.now()).slice(-9).padStart(9, '0');
  const ccn = input.patientControlNumber.replace(/-/g, '').slice(0, 20);
  const filingIndicator = isMedicarePayer(input.payer)
    ? MEDICARE_FILING_INDICATOR : (input.payer.claim_filing_indicator || 'CI');

  const segs = buildEnvelopeLoops({
    practice: input.practice, payer: input.payer, patient: input.patient,
    isa15, claimControlNumber: ccn, controlNumber, date, time, filingIndicator,
  });

  const firstVisit8 = formatDate8(input.admission.firstVisitDate);

  // ── Loop 2300: NOA Claim ──────────────────────────────────────────────────
  segs.push(`CLM*${ccn}*${totalCharge}***32:1:${freq}*Y*A*Y*Y~`);
  // NOA from/through = first visit date (same for both, per CMS NOA guidance)
  segs.push(DTP({ qualifier: '434', formatQualifier: 'RD8',
    dateValue: `${firstVisit8}-${firstVisit8}` }));
  segs.push(CL1({ admissionTypeCode: '3', admissionSourceCode: '1', patientStatusCode: '30' }));
  segs.push(DTP({ qualifier: '435', formatQualifier: 'D8',
    dateValue: formatDate8(input.admission.socDate) }));

  // Principal diagnosis only on NOA (no secondary required)
  segs.push(HI([{ qualifier: 'ABK', code: input.admission.principalDiagnosis }]));

  // Attending physician (individual NPI required)
  segs.push(NM1({ entityIdCode: '71', entityTypeQualifier: '1',
    lastOrOrgName: input.attendingProvider.last_name,
    firstName: input.attendingProvider.first_name,
    idQualifier: 'XX', idCode: input.attendingProvider.npi }));

  // Loop 2400: 0023 with placeholder HIPPS "1AA11" per dispatch §3.2
  segs.push(LX(1));
  segs.push(SV2({ revenueCode: '0023', procedureComposite: 'HH:1AA11',
    charge: totalCharge, serviceUnits: 1 }));
  segs.push(DTP({ qualifier: '472', formatQualifier: 'D8', dateValue: firstVisit8 }));

  // Trailers
  const segmentCount = segs.length + 1;
  segs.push(SE({ segmentCount, controlNumber: '0001' }));
  segs.push(GE({ transactionCount: 1, groupControlNumber: '1' }));
  segs.push(IEA({ functionalGroupCount: 1, controlNumber }));

  return {
    edi: segs.join('\n'),
    rpTransmitted: { transactionSet: '837I', tob, noaType: input.noaType, isa15, patientControlNumber: ccn },
  };
}
