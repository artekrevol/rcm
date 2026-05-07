/**
 * Typed segment helpers for X12 837P generation.
 *
 * Each function names its parameters by X12 element name/number, builds the
 * segment via buildSegment(), and returns the terminated string.  Element
 * positions are written exactly once here — never again at the call site.
 *
 * Import and use directly in edi-generator.ts instead of template literals.
 */

import { buildSegment } from './segment-builder';

// ── ISA — Interchange Control Header ─────────────────────────────────────────
// ISA has 16 fixed-position elements; ISA02/ISA04 = 10 chars, ISA06/ISA08 = 15
// chars.  The helper pads to required widths; caller provides raw values.
export const ISA = (e: {
  authInfoQualifier?: string;      // 01 — default '03'
  authInfo?: string;               // 02 — 10 chars; default 10 spaces
  securityInfoQualifier?: string;  // 03 — default '00'
  securityInfo?: string;           // 04 — 10 chars; default 10 spaces
  senderQualifier?: string;        // 05 — default 'ZZ'
  senderId: string;                // 06 — padded to 15 chars
  receiverQualifier?: string;      // 07 — default '30'
  receiverId: string;              // 08 — padded to 15 chars
  date: string;                    // 09 — YYMMDD
  time: string;                    // 10 — HHMM
  repetitionSep?: string;          // 11 — default '^'
  version?: string;                // 12 — default '00501'
  controlNumber: string;           // 13 — 9-digit control number
  acknowledgmentRequested?: string;// 14 — default '0'
  usageIndicator: 'P' | 'T';      // 15 — 'T' test, 'P' production
  componentSep?: string;           // 16 — default ':'
}) => buildSegment('ISA', {
  1:  e.authInfoQualifier        ?? '03',
  2:  (e.authInfo                ?? '          ').padEnd(10),
  3:  e.securityInfoQualifier    ?? '00',
  4:  (e.securityInfo            ?? '          ').padEnd(10),
  5:  e.senderQualifier          ?? 'ZZ',
  6:  e.senderId.padEnd(15),
  7:  e.receiverQualifier        ?? '30',
  8:  e.receiverId.padEnd(15),
  9:  e.date,
  10: e.time,
  11: e.repetitionSep            ?? '^',
  12: e.version                  ?? '00501',
  13: e.controlNumber,
  14: e.acknowledgmentRequested  ?? '0',
  15: e.usageIndicator,
  16: e.componentSep             ?? ':',
});

// ── GS — Functional Group Header ─────────────────────────────────────────────
export const GS = (e: {
  functionalIdCode: string;       // 01 — 'HC' for health claims
  applicationSenderId: string;    // 02
  applicationReceiverId: string;  // 03
  date: string;                   // 04 — YYYYMMDD
  time: string;                   // 05 — HHMM
  groupControlNumber: string;     // 06
  responsibleAgencyCode?: string; // 07 — default 'X'
  versionCode?: string;           // 08 — default '005010X222A1'
}) => buildSegment('GS', {
  1: e.functionalIdCode,
  2: e.applicationSenderId,
  3: e.applicationReceiverId,
  4: e.date,
  5: e.time,
  6: e.groupControlNumber,
  7: e.responsibleAgencyCode ?? 'X',
  8: e.versionCode           ?? '005010X222A1',
});

// ── ST — Transaction Set Header ───────────────────────────────────────────────
export const ST = (e: {
  transactionSetId: string;           // 01 — '837'
  controlNumber: string;              // 02 — '0001'
  implementationConvention?: string;  // 03 — '005010X222A1'
}) => buildSegment('ST', {
  1: e.transactionSetId,
  2: e.controlNumber,
  3: e.implementationConvention,
});

// ── BHT — Beginning of Hierarchical Transaction ───────────────────────────────
export const BHT = (e: {
  structureCode: string;    // 01 — '0019'
  purposeCode: string;      // 02 — '00' original
  referenceId: string;      // 03 — claim control number
  date: string;             // 04 — YYYYMMDD
  time: string;             // 05 — HHMM
  transactionType?: string; // 06 — 'CH' chargeable
}) => buildSegment('BHT', {
  1: e.structureCode,
  2: e.purposeCode,
  3: e.referenceId,
  4: e.date,
  5: e.time,
  6: e.transactionType,
});

// ── NM1 — Entity Name / Identification ───────────────────────────────────────
// Works for both persons (entityTypeQualifier='1') and organizations ('2').
// For orgs, only NM103 (lastOrOrgName) is populated; NM104-107 are omitted.
// For persons, NM104 (firstName) and NM105 (middleName) may be populated.
// NM105 receives the FULL middle name — not an initial (X12 allows up to 25 chars).
export const NM1 = (e: {
  entityIdCode: string;              // 01
  entityTypeQualifier: '1' | '2';   // 02 — '1'=person, '2'=org
  lastOrOrgName?: string;            // 03
  firstName?: string;                // 04 — person only
  middleName?: string;               // 05 — person only; full name, max 25 chars
  namePrefix?: string;               // 06
  nameSuffix?: string;               // 07
  idQualifier?: string;              // 08
  idCode?: string;                   // 09
}) => buildSegment('NM1', {
  1: e.entityIdCode,
  2: e.entityTypeQualifier,
  3: e.lastOrOrgName,
  4: e.firstName,
  5: e.middleName ? e.middleName.slice(0, 25) : undefined,
  6: e.namePrefix,
  7: e.nameSuffix,
  8: e.idQualifier,
  9: e.idCode,
});

// ── PER — Administrative Communications Contact ───────────────────────────────
export const PER = (e: {
  contactFunctionCode: string;  // 01 — 'IC'
  name?: string;                // 02
  commQualifier1?: string;      // 03 — 'TE' (telephone)
  commNumber1?: string;         // 04 — phone
  commQualifier2?: string;      // 05
  commNumber2?: string;         // 06
}) => buildSegment('PER', {
  1: e.contactFunctionCode,
  2: e.name,
  3: e.commQualifier1,
  4: e.commNumber1,
  5: e.commQualifier2,
  6: e.commNumber2,
});

// ── HL — Hierarchical Level ───────────────────────────────────────────────────
export const HL = (e: {
  idNumber: string;         // 01
  parentIdNumber?: string;  // 02 — empty for Level 1
  levelCode: string;        // 03 — '20' info source, '22' subscriber, '23' dependent
  childCode: '0' | '1';    // 04 — '1' has children, '0' no children
}) => buildSegment('HL', {
  1: e.idNumber,
  2: e.parentIdNumber,
  3: e.levelCode,
  4: e.childCode,
});

// ── PRV — Provider Information ────────────────────────────────────────────────
export const PRV = (e: {
  providerCode: string;              // 01 — 'BI' billing, 'PE' performing
  referenceIdQualifier?: string;     // 02 — 'PXC' taxonomy
  referenceId?: string;              // 03 — taxonomy code
}) => buildSegment('PRV', {
  1: e.providerCode,
  2: e.referenceIdQualifier,
  3: e.referenceId,
});

// ── N3 — Address Information ──────────────────────────────────────────────────
export const N3 = (e: {
  addressLine1: string;   // 01
  addressLine2?: string;  // 02
}) => buildSegment('N3', {
  1: e.addressLine1,
  2: e.addressLine2,
});

// ── N4 — Geographic Location ──────────────────────────────────────────────────
export const N4 = (e: {
  city: string;           // 01
  stateCode: string;      // 02
  postalCode: string;     // 03
  countryCode?: string;   // 04
}) => buildSegment('N4', {
  1: e.city,
  2: e.stateCode,
  3: e.postalCode,
  4: e.countryCode,
});

// ── DMG — Demographic Information ─────────────────────────────────────────────
export const DMG = (e: {
  dateFormatQualifier?: string;  // 01 — default 'D8'
  dob: string;                   // 02 — YYYYMMDD
  genderCode: string;            // 03 — 'M', 'F', or 'U'
}) => buildSegment('DMG', {
  1: e.dateFormatQualifier ?? 'D8',
  2: e.dob,
  3: e.genderCode,
});

// ── SBR — Subscriber Information ─────────────────────────────────────────────
export const SBR = (e: {
  payerResponsibilityCode: string;      // 01 — 'P' primary
  relationshipCode?: string;            // 02 — '18' self
  referenceId?: string;                 // 03
  name?: string;                        // 04
  insuranceTypeCode?: string;           // 05
  coordinationOfBenefits?: string;      // 06
  conditionCodes?: string;              // 07
  employmentStatusCode?: string;        // 08
  claimFilingIndicatorCode?: string;    // 09
}) => buildSegment('SBR', {
  1: e.payerResponsibilityCode,
  2: e.relationshipCode,
  3: e.referenceId,
  4: e.name,
  5: e.insuranceTypeCode,
  6: e.coordinationOfBenefits,
  7: e.conditionCodes,
  8: e.employmentStatusCode,
  9: e.claimFilingIndicatorCode,
});

// ── REF — Reference Identification ───────────────────────────────────────────
export const REF = (e: {
  qualifier: string;     // 01
  id: string;            // 02
  description?: string;  // 03
}) => buildSegment('REF', {
  1: e.qualifier,
  2: e.id,
  3: e.description,
});

// ── CLM — Health Claim ────────────────────────────────────────────────────────
// CLM05 is a composite element: "POS:B:freqCode" (colon-separated, pre-built by caller).
export const CLM = (e: {
  patientControlNumber: string;   // 01 — claim ID
  totalCharge: string;            // 02 — "NNN.NN"
  claimFilingCode?: string;       // 03 — usually empty in 837P
  nonInstitutionalCode?: string;  // 04 — usually empty
  placeOfServiceComposite: string;// 05 — "POS:B:freq" composite
  providerSignatureCode: string;  // 06 — 'Y'
  assignmentCode: string;         // 07 — 'A'
  benefitsAssignmentCode: string; // 08 — 'Y'
  releaseInfoCode: string;        // 09 — 'Y'
}) => buildSegment('CLM', {
  1: e.patientControlNumber,
  2: e.totalCharge,
  3: e.claimFilingCode,
  4: e.nonInstitutionalCode,
  5: e.placeOfServiceComposite,
  6: e.providerSignatureCode,
  7: e.assignmentCode,
  8: e.benefitsAssignmentCode,
  9: e.releaseInfoCode,
});

// ── HI — Health Care Diagnosis Codes ─────────────────────────────────────────
// Each diagnosis is a composite element: "qualifier:code" (e.g., "ABK:F0390").
// Max 12 codes per segment per X12 5010 837P spec.
export const HI = (codes: Array<{ qualifier: string; code: string }>) => {
  const elements: Record<number, string> = {};
  codes.slice(0, 12).forEach((c, i) => {
    elements[i + 1] = `${c.qualifier}:${c.code}`;
  });
  return buildSegment('HI', elements);
};

// ── NTE — Note / Special Instruction ─────────────────────────────────────────
export const NTE = (e: {
  noteCode: string;    // 01 — 'ADD'
  description: string; // 02 — free text
}) => buildSegment('NTE', {
  1: e.noteCode,
  2: e.description,
});

// ── DTP — Date or Time Reference ─────────────────────────────────────────────
export const DTP = (e: {
  qualifier: string;       // 01 — '472' service date
  formatQualifier: string; // 02 — 'D8' single date, 'RD8' date range
  dateValue: string;       // 03 — YYYYMMDD or YYYYMMDD-YYYYMMDD
}) => buildSegment('DTP', {
  1: e.qualifier,
  2: e.formatQualifier,
  3: e.dateValue,
});

// ── LX — Service Line Number ──────────────────────────────────────────────────
export const LX = (lineNumber: number | string) =>
  buildSegment('LX', { 1: String(lineNumber) });

// ── SV1 — Professional Service ────────────────────────────────────────────────
// SV101 is a pre-built composite: "HC:hcpcs_code[:mod1[:mod2]]"
// SV105 (facility code qualifier) and SV106 (facility code) are usually empty
// in 837P professional claims; they are omitted when not provided.
export const SV1 = (e: {
  procedureComposite: string;     // 01 — "HC:code[:modifiers]"
  charge: string;                 // 02 — "NNN.NN"
  unitOfMeasure?: string;         // 03 — default 'UN'
  serviceUnits: number | string;  // 04
  facilityCodeQualifier?: string; // 05 — usually empty
  facilityCode?: string;          // 06 — usually empty
  diagnosisPointers: string;      // 07 — "1" or "1:2" etc.
}) => buildSegment('SV1', {
  1: e.procedureComposite,
  2: e.charge,
  3: e.unitOfMeasure ?? 'UN',
  4: String(e.serviceUnits),
  5: e.facilityCodeQualifier,
  6: e.facilityCode,
  7: e.diagnosisPointers,
});

// ── SE — Transaction Set Trailer ──────────────────────────────────────────────
export const SE = (e: {
  segmentCount: number | string;  // 01 — count of segments from ST through SE
  controlNumber: string;           // 02 — '0001'
}) => buildSegment('SE', {
  1: String(e.segmentCount),
  2: e.controlNumber,
});

// ── GE — Functional Group Trailer ────────────────────────────────────────────
export const GE = (e: {
  transactionCount: number | string;  // 01
  groupControlNumber: string;          // 02
}) => buildSegment('GE', {
  1: String(e.transactionCount),
  2: e.groupControlNumber,
});

// ── IEA — Interchange Control Trailer ────────────────────────────────────────
export const IEA = (e: {
  functionalGroupCount: number | string;  // 01
  controlNumber: string;                   // 02
}) => buildSegment('IEA', {
  1: String(e.functionalGroupCount),
  2: e.controlNumber,
});
