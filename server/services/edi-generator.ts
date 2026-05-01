// ─────────────────────────────────────────────────────────────────────────────
// PGBA VA Community Care — Region 4 EDI Constants
// Source: PGBA 837I Companion Guide v1.3 (July 2021), Tables 5-6, pages 17-20.
// Note: 837I values confirmed; 837P guide pending. Per X12 5010 standard, the
//       ISA/GS envelope and Loop 1000B/2010BB values are identical between
//       837I and 837P for the same clearinghouse. Using confirmed 837I values
//       for these structural segments only.
// Source: TriWest Payer Space on Availity; PGBA EDI companion guide PDF.
// ─────────────────────────────────────────────────────────────────────────────

/** PGBA Region 4 federal tax ID. Used in ISA08, GS03, and Loop 1000B NM109.
 *  Per PGBA 837I CG v1.3, Table 5, page 17. Same across 837I and 837P. */
const PGBA_RECEIVER_TAX_ID = "841160004"; // Region 4 (Southeast/Gulf Coast)

/** PGBA receiver name in Loop 1000B NM103.
 *  Per PGBA 837I CG v1.3, Table 5, page 17. */
const PGBA_RECEIVER_NAME = "PGBA VACCN";

/** PGBA Loop 1000B NM108 — "46" = Electronic Transmitter Identification Number.
 *  Per PGBA 837I CG v1.3, Table 5, page 17. */
const PGBA_RECEIVER_ID_QUALIFIER = "46";

/** PGBA Loop 2010BB (payer) NM109. Different from the receiver ID.
 *  Per PGBA 837I CG v1.3, Table 6, page 18. */
const PGBA_PAYER_ID = "TWVACCN";

/** PGBA Loop 2010BB NM108 — "PI" = Payer Identification.
 *  Per PGBA 837I CG v1.3, Table 6, page 18. */
const PGBA_PAYER_ID_QUALIFIER = "PI";

// ─────────────────────────────────────────────────────────────────────────────
// A1: NM1 element 08 (Identification Code Qualifier) lookup keyed by NM101.
// Per X12 5010 TR3 Section 2.2. Every NM1 emission must pull from this map.
// This is the single source of truth — never hardcode qualifiers inline.
// ─────────────────────────────────────────────────────────────────────────────
const NM1_QUALIFIER: Record<string, string> = {
  "41": "46", // Submitter              → ETIN
  "40": "46", // Receiver               → ETIN
  "85": "XX", // Billing Provider       → NPI
  "87": "XX", // Pay-To Provider        → NPI
  "82": "XX", // Rendering Provider     → NPI
  "77": "XX", // Service Facility       → NPI
  DN:   "XX", // Referring Provider     → NPI
  DK:   "XX", // Ordering Provider      → NPI
  "71": "XX", // Attending Provider     → NPI
  "72": "XX", // Operating Provider     → NPI
  IL:   "MI", // Subscriber (Insured)   → Member ID  (overrideable for veterans)
  QC:   "MI", // Patient                → Member ID
  PR:   "PI", // Payer                  → Payer Identifier
};

// ─────────────────────────────────────────────────────────────────────────────
// A2: Canonical diagnosis pointer serializer.
// This is the ONLY place pointer conversion happens — routes.ts re-exports this.
// Accepts any valid X12 5010 SV107 input format:
//   Letter chars  A–L  (CMS-1500 Box 21 order, 1–4 per line)
//   Numeric chars 1–12 (already-converted)
//   Colon-separated composites "A:B" or "1:2"
//   Compact multi-char "AB" → "1:2"
// Returns colon-separated numeric string per X12 5010 spec.
// ─────────────────────────────────────────────────────────────────────────────
const DX_PTR_ALPHA_MAP: Record<string, string> = {
  A: "1",  B: "2",  C: "3",  D: "4",
  E: "5",  F: "6",  G: "7",  H: "8",
  I: "9",  J: "10", K: "11", L: "12",
};

export function serializeDiagnosisPointer(raw: string | null | undefined): string {
  const s = String(raw || "A").trim().toUpperCase();

  // Already colon-separated: "A:B", "1:2", "1:2:3"
  if (s.includes(":")) {
    return s
      .split(":")
      .map((p) => DX_PTR_ALPHA_MAP[p] ?? p)
      .join(":");
  }

  // Single alpha "A" → "1"
  if (s.length === 1 && DX_PTR_ALPHA_MAP[s]) {
    return DX_PTR_ALPHA_MAP[s];
  }

  // Single numeric "1" through "12" — pass through
  if (/^\d{1,2}$/.test(s) && parseInt(s, 10) >= 1 && parseInt(s, 10) <= 12) {
    return s;
  }

  // Compact multi-char alpha "AB" → "1:2", "ABCD" → "1:2:3:4"
  // Only process if ALL chars are valid alpha pointers
  if (/^[A-L]{2,4}$/.test(s)) {
    return s
      .split("")
      .map((c) => DX_PTR_ALPHA_MAP[c] ?? c)
      .join(":");
  }

  // Colon-separated numeric already "1:2:3" — pass through unchanged
  if (/^[\d:]+$/.test(s)) return s;

  // Unrecognized — default to "1" to avoid rejecting the claim
  return "1";
}

// ─────────────────────────────────────────────────────────────────────────────

export interface EDI837PInput {
  /**
   * ISA15 Interchange Usage Indicator.
   * 'T' = Test (Stedi validates, does NOT forward to real payer — safe)
   * 'P' = Production (Stedi forwards to real payer — real-world consequence)
   *
   * Resolved by the caller via resolveISA15() from server/lib/environment.ts.
   * Default: ISA15_INDICATOR from environment (T in dev, P in production).
   */
  isa15?: "P" | "T";
  claim: {
    id: string;
    patient_id: string;
    service_date: string;
    place_of_service: string;
    auth_number: string | null;
    payer: string;
    amount: number;
    claim_frequency_code?: string | null;
    orig_claim_number?: string | null;
    homebound_indicator?: boolean | null;
    delay_reason_code?: string | null;
    statement_period_start?: string | null;
    statement_period_end?: string | null;
    service_lines: Array<{
      hcpcs_code: string;
      units: number;
      charge: number;
      modifier: string | null;
      diagnosis_pointer: string;
      service_date?: string;
      service_date_to?: string | null;
    }>;
    icd10_codes: string[];
  };
  patient: {
    first_name: string;
    last_name: string;
    dob: string;
    member_id: string;
    insurance_carrier: string;
    sex?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    /**
     * Veteran identifier type — determines NM108 qualifier in Loop 2010CA/IL.
     * Per PGBA 837I CG v1.3, page 20 (error codes LFN/LFM/SSC/SSE):
     *   "ssn"     → 9-byte SSN  → NM108 qualifier "SY"
     *   "edipi"   → 10-byte DoD EDIPI → NM108 qualifier "MI"
     *   "mvi_icn" → 17-byte VA MVI ICN → NM108 qualifier "MI"
     * Preference order: edipi > mvi_icn > ssn.
     * Inferred from member_id length when not explicitly set.
     */
    veteran_id_type?: "ssn" | "edipi" | "mvi_icn" | null;
  };
  practice: {
    name: string;
    npi: string;
    tax_id: string;
    taxonomy_code: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    phone?: string;
  };
  provider: {
    first_name: string;
    last_name: string;
    npi: string | null;
    taxonomy_code: string | null;
    license_number?: string | null;
    entity_type?: string | null;
  };
  ordering_provider?: {
    first_name: string;
    last_name: string;
    npi: string;
  } | null;
  payer: {
    name: string;
    payer_id: string;
    claim_filing_indicator?: string | null;
  };
}

function formatDate8(dateStr: string): string {
  if (!dateStr) return "19000101";
  // Handle MM/DD/YYYY → YYYYMMDD
  const mdy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}${mdy[1].padStart(2, "0")}${mdy[2].padStart(2, "0")}`;
  // Handle MM/DD/YY → YYYYMMDD (century cutoff: 00-30 → 2000s, 31-99 → 1900s)
  const mdyShort = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (mdyShort) {
    const yy = parseInt(mdyShort[3], 10);
    const century = yy <= 30 ? "20" : "19";
    return `${century}${mdyShort[3]}${mdyShort[1].padStart(2, "0")}${mdyShort[2].padStart(2, "0")}`;
  }
  // Handle YYYY-MM-DD or YYYYMMDD
  return dateStr.replace(/-/g, "").slice(0, 8);
}

function mapSex(sex?: string): string {
  if (!sex) return "U";
  const s = sex.toUpperCase().charAt(0);
  if (s === "M") return "M";
  if (s === "F") return "F";
  return "U";
}

/**
 * Detect PGBA VA Community Care payer.
 * Covers: TriWest Healthcare Alliance, PGBA VACCN, OptumVA, VA Community Care.
 * Per PGBA 837I CG v1.3: payer_id "TWVACCN" and receiver tax ID "841160004"
 * are the canonical identifiers for Region 4 PGBA submissions.
 */
function isPGBAPayer(payer: { name: string; payer_id: string }): boolean {
  const nameLc = (payer.name || "").toLowerCase();
  const id = (payer.payer_id || "").toUpperCase();
  return (
    id === "TWVACCN" ||
    id === PGBA_RECEIVER_TAX_ID ||
    nameLc.includes("triwest") ||
    nameLc.includes("pgba") ||
    nameLc.includes("vaccn") ||
    nameLc.includes("va community care") ||
    nameLc.includes("community care")
  );
}

/**
 * Resolve patient NM108 qualifier and NM109 value for PGBA submissions.
 * Per PGBA 837I CG v1.3, page 20 (error codes LFN/LFM/SSC/SSE):
 *   EDIPI (10-byte DoD ID)  → qualifier "MI"
 *   MVI ICN (17-byte VA ID) → qualifier "MI"
 *   SSN (9-byte)            → qualifier "SY"
 * Preference: EDIPI > MVI ICN > SSN.
 * Falls back to length heuristic when veteran_id_type not explicitly set.
 */
function resolveVeteranId(patient: EDI837PInput["patient"]): { qualifier: string; id: string } {
  const id = (patient.member_id || "").replace(/[-\s]/g, "");
  const explicitType = patient.veteran_id_type;

  if (explicitType === "ssn") return { qualifier: "SY", id };
  if (explicitType === "edipi" || explicitType === "mvi_icn") return { qualifier: "MI", id };

  // Heuristic fallback when type not set — length-based per PGBA format rules
  if (id.length === 9 && /^\d{9}$/.test(id)) return { qualifier: "SY", id };  // SSN
  if (id.length === 10) return { qualifier: "MI", id };  // EDIPI
  if (id.length === 17) return { qualifier: "MI", id };  // MVI ICN

  // Default: MI (most common for VA)
  return { qualifier: "MI", id: patient.member_id };
}

export function generate837P(input: EDI837PInput): string {
  const { claim, patient, practice, provider, ordering_provider, payer } = input;
  const freqCode = claim.claim_frequency_code || "1";
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toTimeString().slice(0, 5).replace(":", "");
  const controlNumber = String(Date.now()).slice(-9).padStart(9, "0");
  const claimControlNumber = claim.id.replace(/-/g, "").slice(0, 20);

  const street = practice.address || "123 Main St";
  const city = practice.city || "Austin";
  const state = practice.state || "TX";
  const zip = practice.zip || "78701";

  // ISA15 must be set by the caller via resolveISA15() from server/lib/environment.ts.
  // Default is 'T' (safe) — callers explicitly opt into 'P' for production submissions.
  const isa15 = input.isa15 || "T";

  // ── PGBA-specific receiver values ──────────────────────────────────────────
  // Per PGBA 837I CG v1.3, Table 5 (page 17). Applied when the payer is
  // identified as PGBA/TriWest VA Community Care Region 4.
  // For non-PGBA payers, use the standard payer_id from practice/payer settings.
  const pgba = isPGBAPayer(payer);

  // ISA08: Receiver ID — PGBA federal tax ID (Region 4) for PGBA payers,
  //        payer_id for all others. Must be 15 chars (padded).
  // Per PGBA 837I CG v1.3, Table 5, page 17: ISA08 = "841160004"
  const isaReceiverId = pgba ? PGBA_RECEIVER_TAX_ID : payer.payer_id;

  // GS03: Receiver application ID — must match ISA08 for PGBA.
  // Per PGBA 837I CG v1.3, Table 5, page 17: GS03 = "841160004"
  const gsReceiverId = pgba ? PGBA_RECEIVER_TAX_ID : payer.payer_id;

  // Loop 1000B NM1*40: Receiver identification in transaction set header.
  // Per PGBA 837I CG v1.3, Table 5, page 17:
  //   NM103 = "PGBA VACCN", NM108 = "46", NM109 = "841160004"
  const loop1000bName = pgba ? PGBA_RECEIVER_NAME : payer.name;
  const loop1000bQual = pgba ? PGBA_RECEIVER_ID_QUALIFIER : NM1_QUALIFIER["40"];
  const loop1000bId   = pgba ? PGBA_RECEIVER_TAX_ID : payer.payer_id;

  // Loop 2010BB NM1*PR: Payer identification at claim level.
  // Per PGBA 837I CG v1.3, Table 6, page 18:
  //   NM103 = "PGBA VACCN", NM108 = "PI", NM109 = "TWVACCN"
  const loop2010bbName = pgba ? PGBA_RECEIVER_NAME : payer.name;
  const loop2010bbQual = pgba ? PGBA_PAYER_ID_QUALIFIER : NM1_QUALIFIER["PR"] ?? "PI";
  const loop2010bbId   = pgba ? PGBA_PAYER_ID : payer.payer_id;

  const segments: string[] = [];

  // ── ISA — Interchange Control Header ───────────────────────────────────────
  segments.push(
    `ISA*00*          *00*          *ZZ*${practice.npi.padEnd(15)}*ZZ*${isaReceiverId.padEnd(15)}*${date.slice(2)}*${time}*^*00501*${controlNumber}*0*${isa15}*:`
  );

  // ── GS — Functional Group Header ───────────────────────────────────────────
  // GS03 must match ISA08 per PGBA 837I CG v1.3, Table 5, page 17.
  segments.push(
    `GS*HC*${practice.npi}*${gsReceiverId}*${date}*${time}*1*X*005010X222A1`
  );

  segments.push(`ST*837*0001*005010X222A1`);

  segments.push(`BHT*0019*00*${claimControlNumber}*${date}*${time}*CH`);

  // ── Loop 1000A: Submitter ─────────────────────────────────────────────────
  // NM1*41: NM108 = "46" (ETIN) per NM1_QUALIFIER lookup. NM109 = submitter NPI.
  // Per PGBA 837I CG v1.3, page 18: NM108 = "46", NM109 = agency NPI.
  segments.push(
    `NM1*41*2*${practice.name}*****${NM1_QUALIFIER["41"]}*${practice.npi}`
  );
  const billingPhone = (practice.phone || "0000000000").replace(/\D/g, "");
  segments.push(`PER*IC*Billing Contact*TE*${billingPhone}`);

  // ── Loop 1000B: Receiver ─────────────────────────────────────────────────
  // NM1*40: NM108 = "46" (ETIN) per NM1_QUALIFIER lookup.
  // PGBA: NM103 = "PGBA VACCN", NM108 = "46", NM109 = "841160004" (Region 4).
  segments.push(
    `NM1*40*2*${loop1000bName}*****${loop1000bQual}*${loop1000bId}`
  );

  // ── Loop 2000A: Billing Provider HL ─────────────────────────────────────
  segments.push(`HL*1**20*1`);
  segments.push(`PRV*BI*PXC*${practice.taxonomy_code}`);

  // ── Loop 2010AA: Billing Provider ────────────────────────────────────────
  // NM108 = "XX" (NPI) per NM1_QUALIFIER["85"]; NM109 = agency NPI.
  // Billing provider is always an organization (practice) → NM102 = 2.
  // REF*EI: federal tax ID.
  segments.push(
    `NM1*85*2*${practice.name}*****${NM1_QUALIFIER["85"]}*${practice.npi}`
  );
  segments.push(`N3*${street}`);
  segments.push(`N4*${city}*${state}*${zip}`);
  segments.push(`REF*EI*${practice.tax_id.replace("-", "")}`);

  // ── Loop 2000B: Subscriber HL ────────────────────────────────────────────
  segments.push(`HL*2*1*22*0`);

  // SBR09: X12 5010 claim filing indicator. "CI" (Commercial Insurance) is the
  // explicit X12 spec default when a payer has no specific indicator configured.
  // For VA Community Care, "VA" is often used. Admins should set this in payer settings.
  const filingIndicator = payer.claim_filing_indicator && payer.claim_filing_indicator.trim()
    ? payer.claim_filing_indicator.trim()
    : "CI";
  segments.push(`SBR*P*18*******${filingIndicator}`);

  // ── Loop 2010BA: Subscriber (Insured/Patient) ─────────────────────────────
  // NM108/NM109: Patient identifier qualifier and value.
  // For PGBA: use veteran_id_type to select qualifier (SY = SSN, MI = EDIPI/MVI ICN).
  // NM1_QUALIFIER["IL"] = "MI" (default); PGBA resolveVeteranId may override to "SY".
  const { qualifier: patientIdQual, id: patientIdVal } = pgba
    ? resolveVeteranId(patient)
    : { qualifier: NM1_QUALIFIER["IL"], id: patient.member_id };

  segments.push(
    `NM1*IL*1*${patient.last_name}*${patient.first_name}****${patientIdQual}*${patientIdVal}`
  );
  const patientAddr = patient.address || street;
  const patientCity = patient.city || city;
  const patientState = patient.state || state;
  const patientZip = patient.zip || zip;
  segments.push(`N3*${patientAddr}`);
  segments.push(`N4*${patientCity}*${patientState}*${patientZip}`);
  segments.push(
    `DMG*D8*${formatDate8(patient.dob)}*${mapSex(patient.sex)}`
  );

  // ── Loop 2010BB: Payer ────────────────────────────────────────────────────
  // NM1*PR: NM108 = "PI" per NM1_QUALIFIER["PR"].
  // PGBA: NM103 = "PGBA VACCN", NM108 = "PI", NM109 = "TWVACCN".
  segments.push(
    `NM1*PR*2*${loop2010bbName}*****${loop2010bbQual}*${loop2010bbId}`
  );

  // ── Loop 2300: Claim ─────────────────────────────────────────────────────
  const totalCharge = claim.service_lines.reduce(
    (sum, line) => sum + line.charge,
    0
  );
  // CLM: CLM01=control#, CLM02=charge, CLM05=POS:B:freq, CLM06=provider sig, CLM07=assignment, CLM08=benefits, CLM09=release
  segments.push(
    // CLM09=Y: "provider has signed statement permitting release" — most payers including VA and Medicare expect Y not I
  `CLM*${claimControlNumber}*${totalCharge.toFixed(2)}***${claim.place_of_service}:B:${freqCode}*Y*A*Y*Y`
  );

  // REF*F8: Original claim ICN/TCN for replacement/void claims
  if ((freqCode === "7" || freqCode === "8") && claim.orig_claim_number) {
    segments.push(`REF*F8*${claim.orig_claim_number}`);
  }

  // REF*G1: Prior Authorization number.
  // Qualifier "G1" confirmed via PGBA 837I CG v1.3, page 20 (sample EDI).
  // Per X12 5010, G1 = "Prior Authorization Number". Applies to both 837I and 837P.
  if (claim.auth_number) {
    segments.push(`REF*G1*${claim.auth_number}`);
  }

  // REF*4N: Reason for late filing — omit if empty/none (not a valid X12 qualifier)
  if (claim.delay_reason_code && claim.delay_reason_code !== "none") {
    segments.push(`REF*4N*${claim.delay_reason_code}`);
  }

  // NTE: Homebound indicator — only emit when explicitly true, not for "N" string
  if (claim.homebound_indicator === true) {
    segments.push(`NTE*ADD*PATIENT IS HOMEBOUND`);
  }

  // ── HI: Diagnosis Codes ───────────────────────────────────────────────────
  // 837P allows max 12 ICD-10 codes in a single HI segment; cap to prevent rejection
  const diagCodes = claim.icd10_codes
    .slice(0, 12)
    .map((code, i) => `${i === 0 ? "ABK" : "ABF"}:${code.replace(/\./g, "")}`)
    .join("*");
  segments.push(`HI*${diagCodes}`);

  // ── Loop 2300 DTP*434: Statement Dates (home health billing period) ────────
  // Qualifier 434 = Statement Dates; format RD8 = date range CCYYMMDD-CCYYMMDD
  // Only emit when a statement period is explicitly provided (home care multi-visit).
  // Per X12 5010 TR3 2300/DTP rules for 837P home health claims.
  if (claim.statement_period_start) {
    const periodStart = formatDate8(claim.statement_period_start);
    const periodEnd = claim.statement_period_end
      ? formatDate8(claim.statement_period_end)
      : periodStart;
    segments.push(`DTP*434*RD8*${periodStart}-${periodEnd}`);
  }

  // ── Loop 2310B: Rendering Provider ────────────────────────────────────────
  // A3 FIX: Omit this loop entirely when the provider has no NPI (agency worker,
  // home health aide, etc.). For agency-billed claims, the billing provider (NM1*85)
  // acts as the rendering provider per X12 5010 TR3 §2.5.1. Emitting NM1*82 with
  // a null/empty NPI produces an invalid segment that causes Stedi to reject.
  const providerNpi = provider.npi && provider.npi !== "null" && provider.npi.trim()
    ? provider.npi.trim()
    : null;
  const isAgencyWorker = provider.entity_type === "agency_worker" || !providerNpi;

  if (!isAgencyWorker && providerNpi) {
    const isOrgProvider = provider.entity_type === "organization";
    if (isOrgProvider) {
      // NM102 = 2 (organization); NM103 = full org name; NM104/NM105 empty.
      // Org name stored across first_name + last_name — join both non-empty parts.
      const orgName = [provider.first_name, provider.last_name]
        .map((s) => (s || "").trim())
        .filter(Boolean)
        .join(" ");
      segments.push(
        `NM1*82*2*${orgName}*****${NM1_QUALIFIER["82"]}*${providerNpi}`
      );
    } else {
      // NM102 = 1 (individual); NM103 = last name; NM104 = first name.
      segments.push(
        `NM1*82*1*${provider.last_name}*${provider.first_name}****${NM1_QUALIFIER["82"]}*${providerNpi}`
      );
    }
    const taxonomyCode = provider.taxonomy_code && provider.taxonomy_code !== "null"
      ? provider.taxonomy_code.trim()
      : null;
    if (taxonomyCode) {
      segments.push(`PRV*PE*PXC*${taxonomyCode}`);
    }
    // REF*1C: State license number — required by CareFirst, some VA companions, and commercial payers
    if (provider.license_number) {
      segments.push(`REF*1C*${provider.license_number}`);
    }
  }

  // ── Loop 2310D: Ordering Provider ────────────────────────────────────────
  // NM1*DK: only emit if different from rendering provider and has a valid NPI
  if (ordering_provider && ordering_provider.npi && ordering_provider.npi !== providerNpi) {
    segments.push(
      `NM1*DK*1*${ordering_provider.last_name}*${ordering_provider.first_name}****${NM1_QUALIFIER["DK"]}*${ordering_provider.npi}`
    );
  }

  // ── Loop 2400: Service Lines ──────────────────────────────────────────────
  claim.service_lines.forEach((line, index) => {
    const lineServiceDate = line.service_date || claim.service_date;
    segments.push(`LX*${index + 1}`);
    // Build composite procedure identifier - components are ALWAYS colon-separated
    // per X12 spec. Never use * (element separator) inside a composite.
    // X12 modifiers must be exactly 2 characters. Filter out any longer values
    // (e.g. HCPCS codes mistakenly stored in the modifier field).
    const modifiers = line.modifier
      ? line.modifier.split(",").map(m => m.trim()).filter(m => m.length === 2)
      : [];
    const composite = ["HC", line.hcpcs_code, ...modifiers].join(":");
    // A2 FIX: Use the canonical serializeDiagnosisPointer for all input formats.
    // Handles single chars ("A"→"1"), multi-char composites ("AB"→"1:2"),
    // already-numeric ("1", "1:2"), and colon-separated mixed forms.
    const diagPtr = serializeDiagnosisPointer(line.diagnosis_pointer);
    segments.push(
      `SV1*${composite}*${line.charge.toFixed(2)}*UN*${line.units}***${diagPtr}`
    );
    // DTP*472: Date – Service. Use RD8 date range when service_date_to is present
    // (multi-visit lines spanning a range), otherwise D8 for a single date.
    if (line.service_date_to && line.service_date_to !== lineServiceDate) {
      segments.push(
        `DTP*472*RD8*${formatDate8(lineServiceDate)}-${formatDate8(line.service_date_to)}`
      );
    } else {
      segments.push(
        `DTP*472*D8*${formatDate8(lineServiceDate)}`
      );
    }
  });

  const segCount = segments.length - 2 + 1;
  segments.push(`SE*${segCount}*0001`);

  segments.push(`GE*1*1`);

  segments.push(`IEA*1*${controlNumber}`);

  return segments.join("~\n") + "~";
}
