export interface EDI837PInput {
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
    service_lines: Array<{
      hcpcs_code: string;
      units: number;
      charge: number;
      modifier: string | null;
      diagnosis_pointer: string;
      service_date?: string;
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
    npi: string;
    taxonomy_code: string;
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

  const segments: string[] = [];

  segments.push(
    `ISA*00*          *00*          *ZZ*${practice.npi.padEnd(15)}*ZZ*${payer.payer_id.padEnd(15)}*${date.slice(2)}*${time}*^*00501*${controlNumber}*0*P*:`
  );

  segments.push(
    `GS*HC*${practice.npi}*${payer.payer_id}*${date}*${time}*1*X*005010X222A1`
  );

  segments.push(`ST*837*0001*005010X222A1`);

  segments.push(`BHT*0019*00*${claimControlNumber}*${date}*${time}*CH`);

  // NM1*41: Submitter — qualifier 46 (Electronic Transmitter ID) per X12 5010 spec
  segments.push(
    `NM1*41*2*${practice.name}*****46*${practice.npi}`
  );
  const billingPhone = (practice.phone || "0000000000").replace(/\D/g, "");
  segments.push(`PER*IC*Billing Contact*TE*${billingPhone}`);

  segments.push(
    `NM1*40*2*${payer.name}*****46*${payer.payer_id}`
  );

  segments.push(`HL*1**20*1`);
  segments.push(`PRV*BI*PXC*${practice.taxonomy_code}`);
  segments.push(
    `NM1*85*2*${practice.name}*****XX*${practice.npi}`
  );
  segments.push(`N3*${street}`);
  segments.push(`N4*${city}*${state}*${zip}`);
  segments.push(`REF*EI*${practice.tax_id.replace("-", "")}`);

  segments.push(`HL*2*1*22*0`);

  // SBR09: X12 5010 claim filing indicator. "CI" (Commercial Insurance) is the
  // explicit X12 spec default when a payer has no specific indicator configured.
  // Admins should set the correct code in payer settings to override this value.
  const filingIndicator = payer.claim_filing_indicator && payer.claim_filing_indicator.trim()
    ? payer.claim_filing_indicator.trim()
    : "CI";
  segments.push(`SBR*P*18*******${filingIndicator}`);

  segments.push(
    `NM1*IL*1*${patient.last_name}*${patient.first_name}****MI*${patient.member_id}`
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

  segments.push(
    `NM1*PR*2*${payer.name}*****PI*${payer.payer_id}`
  );

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

  // 837P allows max 12 ICD-10 codes in a single HI segment; cap to prevent rejection
  const diagCodes = claim.icd10_codes
    .slice(0, 12)
    .map((code, i) => `${i === 0 ? "ABK" : "ABF"}:${code.replace(/\./g, "")}`)
    .join("*");
  segments.push(`HI*${diagCodes}`);

  // Loop 2310B: Rendering Provider — entity type 2 (org) vs 1 (individual)
  const isOrgProvider = provider.entity_type === "organization";
  if (isOrgProvider) {
    const orgName = [provider.first_name, provider.last_name].filter(Boolean).join(" ");
    segments.push(`NM1*82*2*${orgName}*****XX*${provider.npi}`);
  } else {
    segments.push(`NM1*82*1*${provider.last_name}*${provider.first_name}****XX*${provider.npi}`);
  }
  segments.push(`PRV*PE*PXC*${provider.taxonomy_code}`);
  // REF*1C: State license number — required by CareFirst, some VA companions, and commercial payers
  if (provider.license_number) {
    segments.push(`REF*1C*${provider.license_number}`);
  }

  // Loop 2310D: Ordering Provider (NM1*DK) — only if different from rendering
  if (ordering_provider && ordering_provider.npi !== provider.npi) {
    segments.push(
      `NM1*DK*1*${ordering_provider.last_name}*${ordering_provider.first_name}****XX*${ordering_provider.npi}`
    );
  }

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
    const ptrMap: Record<string, string> = { 'A': '1', 'B': '2', 'C': '3', 'D': '4' };
    const rawPtr = line.diagnosis_pointer || 'A';
    const diagPtr = ptrMap[rawPtr?.toUpperCase()] || rawPtr || '1';
    segments.push(
      `SV1*${composite}*${line.charge.toFixed(2)}*UN*${line.units}***${diagPtr}`
    );
    segments.push(
      `DTP*472*D8*${formatDate8(lineServiceDate)}`
    );
  });

  const segCount = segments.length - 2 + 1;
  segments.push(`SE*${segCount}*0001`);

  segments.push(`GE*1*1`);

  segments.push(`IEA*1*${controlNumber}`);

  return segments.join("~\n") + "~";
}
