import type { TextractAnalysisResult } from "./textract-extractor.js";

export interface AuthorizedService {
  description: string;
  billing_unit_type: "15-min" | "hourly" | "per-visit";
  max_units_per_period_text: string;
  max_units_per_visit: number | null;
  is_primary: boolean;
}

export interface VaReferralExtraction {
  patient: {
    first_name: string;
    middle_name: string | null;
    last_name: string;
    edipi: string;
    icn: string | null;
    ssn: string | null;
    dob: string;
    gender: "M" | "F";
    gender_identity_raw: string;
    address: {
      line1: string;
      line2: string | null;
      city: string;
      state: string;
      zip: string;
    };
    phone: string | null;
    email: string | null;
  };
  authorization: {
    auth_number: string;
    priority: string;
    issue_date: string;
    expiration_date: string;
    first_appointment_date: string | null;
    seoc_code: string | null;
    seoc_duration_days: number | null;
    authorized_services: AuthorizedService[];
  };
  diagnosis: {
    primary_icd10_code: string;
    primary_description: string;
    co_morbidities: string[];
  };
  payer: {
    name: string;
    payer_id: string;
    affiliation: string;
    network: string;
    pgba_region: number;
  };
  suggested_hcpcs: string;
  requesting_provider: {
    first_name: string;
    last_name: string;
    specialty: string;
  } | null;
  referring_provider: {
    first_name: string;
    last_name: string;
    raw_npi: string;
  } | null;
  va_facility: {
    name: string;
    station_number: string;
    address: string;
    phone: string;
    fax: string;
  };
  unique_consult_no: string | null;
  program_authority: string | null;
  clinical_context: {
    allergies: string[];
    active_medications: string[];
    is_pregnant: boolean;
    is_diabetic: boolean;
    has_mva_or_work_injury: boolean;
    care_coordination_required: boolean;
    history_of_trauma: string | null;
    recommended_treatment: string;
  };
  category_of_care: string;
  type_of_care: string;
  rate_basis: string;
  confidence: Record<string, number>;
  extraction_method: "textract-async";
}

// ─── ICD-10 normalizer ────────────────────────────────────────────────────────

function normalizeIcd10(raw: string): string {
  const clean = raw.trim().toUpperCase().replace(/\./g, "");
  if (clean.length <= 3) return clean;
  return clean.slice(0, 3) + "." + clean.slice(3);
}

// ─── Date normalizer ──────────────────────────────────────────────────────────

function parseToIso(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  // MM/DD/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  // YYYY-MM-DD already
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Month DD, YYYY
  const months: Record<string, string> = {
    january: "01", february: "02", march: "03", april: "04",
    may: "05", june: "06", july: "07", august: "08",
    september: "09", october: "10", november: "11", december: "12",
  };
  const longDate = s.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (longDate) {
    const m = months[longDate[1].toLowerCase()];
    if (m) return `${longDate[3]}-${m}-${longDate[2].padStart(2, "0")}`;
  }
  return null;
}

// ─── Name parser ──────────────────────────────────────────────────────────────

function parseName(raw: string): { first: string; middle: string | null; last: string } {
  const s = raw.trim();
  // "LAST, FIRST MIDDLE" format (VA form style)
  const commaFmt = s.match(/^([^,]+),\s*(.+)$/);
  if (commaFmt) {
    const last = commaFmt[1].trim();
    const rest = commaFmt[2].trim().split(/\s+/);
    const first = rest[0] ?? "";
    const middle = rest.length > 1 ? rest.slice(1).join(" ") : null;
    return { first, middle, last };
  }
  // "FIRST MIDDLE LAST" format
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], middle: null, last: "" };
  if (parts.length === 2) return { first: parts[0], middle: null, last: parts[1] };
  return { first: parts[0], middle: parts.slice(1, -1).join(" "), last: parts[parts.length - 1] };
}

// ─── State abbreviation lookup ────────────────────────────────────────────────

const STATE_ABBREVS: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

function toStateAbbrev(name: string): string {
  const lower = name.toLowerCase().trim();
  if (/^[A-Z]{2}$/.test(name.trim())) return name.trim().toUpperCase();
  return STATE_ABBREVS[lower] ?? name.trim().slice(0, 2).toUpperCase();
}

/**
 * Parse city / state / zip from a combined address line such as
 * "572 37TH AVE SAN FRANCISCO, CALIFORNIA 941212812" or
 * "RONALD W SEAWRIGHT 572 37TH AVE SAN FRANCISCO, CA 94121".
 */
function parseCityStateZipFromAddress(address: string): { city: string; state: string; zip: string } {
  if (!address) return { city: "", state: "", zip: "" };
  // Look for "CITY, STATE ZIP" pattern near the end (state is 2-letter abbrev or full name)
  const m = address.match(/([A-Za-z][A-Za-z\s]{1,30}),\s*([A-Za-z]{2,20})\s+(\d{5})(?:\d{4})?\s*$/);
  if (m) {
    return {
      city: m[1].trim().replace(/^\d+\s+(?:[A-Z0-9]+\s+)*/, "").trim() || m[1].trim(),
      state: toStateAbbrev(m[2]),
      zip: m[3],
    };
  }
  // No comma format: "CITY STATE ZIP"
  const m2 = address.match(/([A-Za-z][A-Za-z\s]{1,30})\s+([A-Z]{2})\s+(\d{5})(?:\d{4})?\s*$/);
  if (m2) {
    return { city: m2[1].trim(), state: m2[2], zip: m2[3] };
  }
  return { city: "", state: "", zip: "" };
}

/** Return true when a KV value looks like a city name (letters/spaces/hyphens, no long runs of digits) */
function looksLikeCity(val: string): boolean {
  if (!val) return false;
  // Reject if it's mostly digits or very long (probably a phone/ID number)
  if (/^\d+$/.test(val.trim())) return false;
  if (val.trim().replace(/\D/g, "").length > 5) return false;
  return true;
}

/** Return true when a KV value looks like a US state abbrev or name */
function looksLikeState(val: string): boolean {
  if (!val) return false;
  const t = val.trim();
  if (/^\d+$/.test(t)) return false;
  if (t.replace(/\D/g, "").length > 4) return false;
  return true;
}

// ─── KV lookup with aliases ───────────────────────────────────────────────────

function kv(
  map: Map<string, { value: string; confidence: number }>,
  ...keys: string[]
): { value: string; confidence: number } | undefined {
  for (const key of keys) {
    const normalized = key.toLowerCase().replace(/[:\s]+$/g, "").trim();
    const entry = map.get(normalized);
    if (entry?.value) return entry;
    // Fuzzy: require both sides to be at least 4 chars long to avoid spurious short-key matches
    for (const [k, v] of Array.from(map.entries())) {
      const kLong = k.length >= 4;
      const nLong = normalized.length >= 4;
      if (kLong && k.includes(normalized)) return v;
      if (nLong && kLong && normalized.includes(k)) return v;
    }
  }
  return undefined;
}

// ─── Service line billing unit inference ─────────────────────────────────────

function inferBillingUnit(description: string): "15-min" | "hourly" | "per-visit" {
  const d = description.toLowerCase();
  if (d.includes("15 min") || d.includes("15-min") || d.includes("per 15")) return "15-min";
  if (d.includes("hour") || d.includes("hr")) return "hourly";
  return "per-visit";
}

// ─── SEOC → HCPCS mapping ─────────────────────────────────────────────────────

const SEOC_HCPCS: Record<string, string> = {
  "1.28.2": "G0156",
  "1.38.2": "G0156",
  "1.29.2": "G0299",
  "1.30.2": "G0300",
  "1.01.1": "G0151",
};

// ─── Main parser ──────────────────────────────────────────────────────────────

export function parseVaReferral(result: TextractAnalysisResult): VaReferralExtraction {
  const kvm = result.keyValuePairs;
  const conf: Record<string, number> = {};

  // ── Patient ──────────────────────────────────────────────────────────────────
  const nameEntry = kv(kvm, "veteran name", "patient name", "name");
  const rawName = nameEntry?.value ?? "";
  const parsed = parseName(rawName);
  conf.patient = nameEntry?.confidence ?? 0.5;

  const edipiEntry = kv(kvm, "veteran edipi", "edipi", "member id");
  const edipiRaw = edipiEntry?.value ?? "";
  const edipi = edipiRaw.replace(/\D/g, "").slice(0, 10);
  conf.edipi = edipiEntry?.confidence ?? 0.5;

  const icnEntry = kv(kvm, "icn", "veteran icn", "integration control number");
  const icn = icnEntry?.value?.match(/\d{10}V\d{6}/i)?.[0] ?? null;

  const ssnEntry = kv(kvm, "ssn", "social security", "veteran ssn");
  const ssn = ssnEntry?.value?.replace(/\D/g, "").slice(0, 9) ?? null;

  const dobEntry = kv(kvm, "date of birth", "dob", "veteran dob", "birth date");
  const dob = parseToIso(dobEntry?.value) ?? "1900-01-01";
  conf.dob = dobEntry?.confidence ?? 0.5;

  const genderEntry = kv(kvm, "gender", "sex", "veteran gender");
  const genderRaw = genderEntry?.value?.trim() ?? "";
  const gender: "M" | "F" = /^f/i.test(genderRaw) ? "F" : "M";

  const addr1Entry = kv(kvm, "address", "street address", "veteran address", "home address");
  const rawCityEntry = kv(kvm, "city", "veteran city");
  const rawStateEntry = kv(kvm, "state", "veteran state");
  const rawZipEntry = kv(kvm, "zip", "zip code", "postal code", "veteran zip");
  conf.address = addr1Entry?.confidence ?? 0.5;

  // Validate extracted city/state/zip; if they look like phone numbers or IDs,
  // fall back to parsing them from the combined address line.
  const addrLine = addr1Entry?.value?.trim() ?? "";
  const parsedFromAddr = parseCityStateZipFromAddress(addrLine);

  const cityVal = rawCityEntry?.value?.trim() ?? "";
  const stateVal = rawStateEntry?.value?.trim() ?? "";
  const zipVal = rawZipEntry?.value?.trim() ?? "";

  const cityEntry = looksLikeCity(cityVal)
    ? rawCityEntry
    : parsedFromAddr.city
      ? { value: parsedFromAddr.city, confidence: 0.7 }
      : rawCityEntry;

  const stateEntry = looksLikeState(stateVal)
    ? rawStateEntry
    : parsedFromAddr.state
      ? { value: parsedFromAddr.state, confidence: 0.7 }
      : rawStateEntry;

  const zipEntry = /^\d{5}/.test(zipVal)
    ? rawZipEntry
    : parsedFromAddr.zip
      ? { value: parsedFromAddr.zip, confidence: 0.7 }
      : rawZipEntry;

  const phoneEntry = kv(kvm, "phone", "telephone", "veteran phone", "home phone");
  const emailEntry = kv(kvm, "email", "veteran email");

  // ── Authorization ─────────────────────────────────────────────────────────────
  const authEntry = kv(kvm, "authorization number", "auth number", "auth no", "authorization no");
  // Validate: auth numbers are alphanumeric codes, not phone numbers or long text blobs
  const rawAuth = authEntry?.value?.trim() ?? "";
  const authLooksValid = rawAuth.length > 0
    && rawAuth.length <= 30
    && !/\(\d{3}\)|\d{3}-\d{4}/.test(rawAuth)   // reject phone patterns
    && !/phone|email|fax/i.test(rawAuth);          // reject contact fields
  const auth_number = authLooksValid ? rawAuth : "";
  conf.authorization = authEntry?.confidence ?? 0.5;

  const priorityEntry = kv(kvm, "priority", "type", "request type");
  const priority = priorityEntry?.value?.trim() ?? "Routine";

  const issueDateEntry = kv(kvm, "issue date", "authorization date", "date issued", "effective date");
  const issue_date = parseToIso(issueDateEntry?.value) ?? new Date().toISOString().slice(0, 10);

  const expEntry = kv(kvm, "expiration date", "expiry date", "valid through", "end date");
  const expiration_date = parseToIso(expEntry?.value) ?? "";

  const apptEntry = kv(kvm, "first appointment date", "first appt", "appointment date");
  const first_appointment_date = parseToIso(apptEntry?.value);

  const seocEntry = kv(kvm, "seoc code", "seoc", "standard episode of care");
  const seoc_code = seocEntry?.value?.trim() ?? null;

  const durationEntry = kv(kvm, "duration", "episode duration", "days authorized");
  const seoc_duration_days = durationEntry?.value
    ? parseInt(durationEntry.value.replace(/\D/g, ""), 10) || null
    : null;

  // ── Authorized services from tables ─────────────────────────────────────────
  const authorized_services: AuthorizedService[] = [];
  for (const table of result.tables) {
    if (table.rows.length < 2) continue;
    const header = table.rows[0].map((c) => c.text.toLowerCase());
    const descIdx = header.findIndex((h) => h.includes("service") || h.includes("description") || h.includes("treatment"));
    if (descIdx === -1) continue;
    const unitsIdx = header.findIndex((h) => h.includes("unit") || h.includes("hours") || h.includes("quantity") || h.includes("limit"));

    for (let i = 1; i < table.rows.length; i++) {
      const row = table.rows[i];
      const description = row[descIdx]?.text ?? "";
      if (!description.trim()) continue;
      const unitsText = unitsIdx >= 0 ? (row[unitsIdx]?.text ?? "") : "";
      authorized_services.push({
        description,
        billing_unit_type: inferBillingUnit(description),
        max_units_per_period_text: unitsText || "N/A",
        max_units_per_visit: null,
        is_primary: authorized_services.length === 0,
      });
    }
  }

  // Fallback: if no table found, infer from SEOC
  if (authorized_services.length === 0 && seoc_code) {
    const seocAuthEntry = kv(kvm, "authorized services", "services authorized");
    authorized_services.push({
      description: seocAuthEntry?.value ?? `SEOC ${seoc_code}`,
      billing_unit_type: "15-min",
      max_units_per_period_text: "N/A",
      max_units_per_visit: null,
      is_primary: true,
    });
  }

  // ── Diagnosis ─────────────────────────────────────────────────────────────────
  const dx1Entry = kv(kvm, "diagnosis", "primary diagnosis", "icd-10", "icd10", "diagnosis code", "primary icd");
  const dx1Raw = dx1Entry?.value ?? "";
  const icdMatch = dx1Raw.match(/[A-Z]\d{2}\.?\d*/i);
  const primary_icd10_code = icdMatch ? normalizeIcd10(icdMatch[0]) : "";
  const primary_description = dx1Raw.replace(icdMatch?.[0] ?? "", "").trim();
  conf.diagnosis = dx1Entry?.confidence ?? 0.5;

  // Co-morbidities from lines near "co-morbid" heading.
  // Strategy: collect only lines that look like ICD codes or short medical diagnoses.
  // Stop on any VA form section header or after 15 items.
  const CO_MORBID_STOP = /^(allergies|allerg|medication|treatment|authorization|veteran|patient|service|type of care|rate|category|referring|requesting|network|community|form|va form|printed|approved|program|referral|contact|note|instruction|please|telephone|fax|billing|rendering|ordering|status|priority|section|page \d|scheduling|appointment|provider|facility|ordering|signature|date|prepared|authorization number|auth number|auth no|unique consult|issue date|expiration|diagnosis:|primary diagnosis|icd-10|hcpcs|suggested|care coordinator|from:|to:|subject:|dear|sincerely|approved referral|referral request)/i;
  const co_morbidities: string[] = [];
  let inCoMorbid = false;
  for (const line of result.lines) {
    if (/co.?morbid/i.test(line.text)) { inCoMorbid = true; continue; }
    if (!inCoMorbid) continue;

    const item = line.text.trim();
    // Stop on section headers or boilerplate
    if (CO_MORBID_STOP.test(item)) { inCoMorbid = false; continue; }
    // Stop on blank / very short lines that suggest section breaks
    if (item.length < 3) { inCoMorbid = false; continue; }
    // Reject items that look like long sentences (form boilerplate)
    if (item.length > 80) continue;
    // Reject items that are pure numbers (page numbers, IDs)
    if (/^\d+$/.test(item)) continue;
    // Only accept items that look like a medical term or ICD code:
    // – starts with a letter, may contain digits, dots, hyphens
    // – OR looks like "F32.0", "M54.5", "Z87.39" etc.
    const looksLikeDiag = /^[A-Za-z][A-Za-z0-9.\-\s]{1,60}$/.test(item);
    if (!looksLikeDiag) continue;
    // Reject obvious form boilerplate (contains "Form", "VA", "Referral", "Approved")
    if (/\bform\b|\bVA\b|\breferral\b|\bapproved\b|\bmedical care\b/i.test(item)) continue;

    co_morbidities.push(item);
    // Cap to avoid runaway capture
    if (co_morbidities.length >= 15) { inCoMorbid = false; break; }
  }

  // ── Payer / Network ──────────────────────────────────────────────────────────
  const networkEntry = kv(kvm, "network", "payer network", "community care network");
  const network = networkEntry?.value?.trim() ?? "CC Network 4";
  const affiliation = /triwest/i.test(network) ? "Triwest" : "TriWest";
  conf.payer = networkEntry?.confidence ?? 0.7;

  // ── Facility ─────────────────────────────────────────────────────────────────
  const facilityEntry = kv(kvm, "facility name", "va facility", "ordering facility", "referring facility");
  const stationEntry = kv(kvm, "station number", "station", "facility code");
  const facilityAddrEntry = kv(kvm, "facility address");
  const facilityPhoneEntry = kv(kvm, "facility phone", "ordering facility phone");
  const facilityFaxEntry = kv(kvm, "facility fax", "ordering facility fax");

  // ── Referring / Requesting provider ──────────────────────────────────────────
  const reqProvEntry = kv(kvm, "requesting provider", "ordering provider", "requesting physician");
  const refProvEntry = kv(kvm, "referring provider", "referring physician");
  const refNpiEntry = kv(kvm, "referring provider npi", "referring npi");

  let requesting_provider = null;
  if (reqProvEntry?.value) {
    const n = parseName(reqProvEntry.value);
    const specEntry = kv(kvm, "requesting provider specialty", "specialty");
    requesting_provider = {
      first_name: n.first,
      last_name: n.last,
      specialty: specEntry?.value ?? "",
    };
  }

  let referring_provider = null;
  if (refProvEntry?.value) {
    const n = parseName(refProvEntry.value);
    referring_provider = {
      first_name: n.first,
      last_name: n.last,
      raw_npi: refNpiEntry?.value?.trim() ?? "",
    };
  }

  // ── Clinical context ─────────────────────────────────────────────────────────
  const allergiesEntry = kv(kvm, "allergies", "allergy");
  const medsEntry = kv(kvm, "medications", "active medications", "current medications");
  const treatmentEntry = kv(kvm, "recommended treatment", "treatment", "recommended care");
  const coordEntry = kv(kvm, "care coordination", "coordination required");

  const allergies = allergiesEntry?.value
    ? allergiesEntry.value.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)
    : [];
  const active_medications = medsEntry?.value
    ? medsEntry.value.split(/[,;]+/).map((s) => s.trim()).filter(Boolean)
    : [];

  const linesLower = result.lines.map((l) => l.text.toLowerCase());
  const is_pregnant = linesLower.some((l) => l.includes("pregnant"));
  const is_diabetic = linesLower.some((l) => l.includes("diabetic") || l.includes("diabetes"));
  const has_mva_or_work_injury = linesLower.some((l) => l.includes("mva") || l.includes("work injury") || l.includes("motor vehicle"));
  const care_coordination_required =
    /yes|true|required/i.test(coordEntry?.value ?? "") || false;

  // ── Misc ─────────────────────────────────────────────────────────────────────
  const consultEntry = kv(kvm, "unique consult", "consult no", "consult number");
  const authorityEntry = kv(kvm, "program authority", "authority");
  const categoryEntry = kv(kvm, "category of care", "care category");
  const typeEntry = kv(kvm, "type of care", "care type");
  const rateEntry = kv(kvm, "rate basis", "rate");

  return {
    patient: {
      first_name: parsed.first,
      middle_name: parsed.middle,
      last_name: parsed.last,
      edipi,
      icn,
      ssn,
      dob,
      gender,
      gender_identity_raw: genderRaw || "Man",
      address: {
        line1: addr1Entry?.value?.trim() ?? "",
        line2: null,
        city: cityEntry?.value?.trim() ?? "",
        state: stateEntry?.value?.trim() ?? "",
        zip: zipEntry?.value?.replace(/\D/g, "").slice(0, 5) ?? "",
      },
      phone: phoneEntry?.value?.trim() ?? null,
      email: emailEntry?.value?.trim() ?? null,
    },
    authorization: {
      auth_number,
      priority,
      issue_date,
      expiration_date,
      first_appointment_date,
      seoc_code,
      seoc_duration_days,
      authorized_services,
    },
    diagnosis: {
      primary_icd10_code,
      primary_description,
      co_morbidities,
    },
    payer: {
      name: "VA Community Care",
      payer_id: "TWVACCN",
      affiliation,
      network,
      pgba_region: 4,
    },
    suggested_hcpcs: seoc_code ? (SEOC_HCPCS[seoc_code] ?? "G0156") : "G0156",
    requesting_provider,
    referring_provider,
    va_facility: {
      name: facilityEntry?.value?.trim() ?? "",
      station_number: stationEntry?.value?.trim() ?? "",
      address: facilityAddrEntry?.value?.trim() ?? "",
      phone: facilityPhoneEntry?.value?.trim() ?? "",
      fax: facilityFaxEntry?.value?.trim() ?? "",
    },
    unique_consult_no: consultEntry?.value?.trim() ?? null,
    program_authority: authorityEntry?.value?.trim() ?? null,
    clinical_context: {
      allergies,
      active_medications,
      is_pregnant,
      is_diabetic,
      has_mva_or_work_injury,
      care_coordination_required,
      history_of_trauma: null,
      recommended_treatment: treatmentEntry?.value?.trim() ?? "",
    },
    category_of_care: categoryEntry?.value?.trim() ?? "",
    type_of_care: typeEntry?.value?.trim() ?? "",
    rate_basis: rateEntry?.value?.trim() ?? "",
    confidence: conf,
    extraction_method: "textract-async",
  };
}
