/**
 * Synthetic test-data detection for claim submissions.
 *
 * Returns 'clean' | 'suspicious' | 'blocked'.
 * Integrate at both the API layer (hard gate) and wizard UI (soft warning).
 *
 * Important exemption: when testModeOverride===true or payer is FRCPB,
 * the function still returns a result for logging, but callers must NOT
 * block on 'suspicious' or 'blocked' — synthetic data is expected in test mode.
 */

export type TestDataResult = "clean" | "suspicious" | "blocked";

export interface TestDataSignal {
  field: string;
  reason: string;
  weight: number;
}

const KNOWN_FIXTURE_NAMES = new Set([
  "test patient",
  "qa test",
  "qa test patient",
  "john doe",
  "jane doe",
  "demo patient",
  "megan perez",     // actual phantom submission patient name
  "test user",
  "sample patient",
  "fake patient",
]);

const FIXTURE_DOBS = new Set([
  "1970-01-01",
  "2000-01-01",
  "1900-01-01",
  "1945-09-21",
]);

const MEMBER_ID_TEST_PREFIXES = ["zzz", "xxx", "test", "demo", "qa", "sample", "fake"];
const MEMBER_ID_TEST_SUBSTRINGS = [
  "democlaim", "testclaim", "testpatient", "qatest",
  "democlaimva", "000000000", "123456789", "111111111",
];

const AUTH_TEST_PATTERNS = ["test", "demo", "qa", "fake", "TEST-AUTH", "VA-2026-TEST"];

// Demo seed member ID pattern: 3 uppercase letters + 9 digits (e.g. SEN638112662, LYR076183563)
const DEMO_SEED_MEMBER_PATTERN = /^[A-Z]{3}\d{9}$/;

// democlaimvaNNN pattern
const DEMO_CLAIM_VA_PATTERN = /^democlaimva\d{3}$/i;

function normName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function matchesKnownFixtureName(firstName: string, lastName: string): boolean {
  const full = normName(`${firstName} ${lastName}`);
  if (KNOWN_FIXTURE_NAMES.has(full)) return true;
  // "Demo Patient {3-letter prefix}" seeded pattern
  if (/^demo patient [a-z]{3}$/i.test(full)) return true;
  return false;
}

function matchesTestStringPattern(firstName: string, lastName: string): boolean {
  const words = ["test", "demo", "qa", "sample", "fixture", "fake"];
  const full = normName(`${firstName} ${lastName}`);
  return words.some((w) => full.includes(w));
}

function memberIdMatchesTestPattern(memberId: string): boolean {
  if (!memberId) return false;
  const lower = memberId.toLowerCase().replace(/[-_\s]/g, "");
  if (MEMBER_ID_TEST_PREFIXES.some((p) => lower.startsWith(p))) return true;
  if (MEMBER_ID_TEST_SUBSTRINGS.some((s) => lower.includes(s))) return true;
  if (DEMO_SEED_MEMBER_PATTERN.test(memberId.trim())) return true;
  if (DEMO_CLAIM_VA_PATTERN.test(lower)) return true;
  // All zeros / all nines / ascending sequence
  if (/^0+$/.test(lower) || /^9+$/.test(lower) || /^123456789/.test(lower)) return true;
  // "VA" prefix + plausible numeric but known test prefix (VA651254344 — Megan Perez's actual ID)
  if (/^va\d{9}$/i.test(lower)) return true;
  return false;
}

function matchesFixtureDOB(dob: string): boolean {
  if (!dob) return false;
  const normalized = dob.replace(/\//g, "-").slice(0, 10);
  return FIXTURE_DOBS.has(normalized);
}

function patientAddressMatchesPracticeAddress(
  patientAddr: string | undefined,
  practiceAddr: string | object | undefined
): boolean {
  if (!patientAddr || !practiceAddr) return false;
  const pNorm = String(patientAddr).toLowerCase().replace(/\s+/g, " ").trim();
  const prNorm = String(
    typeof practiceAddr === "object"
      ? (practiceAddr as any).street || JSON.stringify(practiceAddr)
      : practiceAddr
  )
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return pNorm.length > 5 && pNorm === prNorm;
}

function addressContainsTestWords(address: string | undefined): boolean {
  if (!address) return false;
  const words = ["test", "demo", "fake", "sample", "fixture"];
  const lower = address.toLowerCase();
  return words.some((w) => lower.includes(w));
}

function authNumberMatchesTestPattern(authNumber: string | undefined | null): boolean {
  if (!authNumber) return false;
  const lower = authNumber.toLowerCase();
  return AUTH_TEST_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

export interface TestDataInput {
  patient: {
    firstName: string;
    lastName: string;
    memberId: string;
    dob?: string;
    address?: string;
  };
  claim: {
    authNumber?: string | null;
  };
  practice?: {
    address?: string | object;
  };
}

export interface TestDataAssessment {
  result: TestDataResult;
  score: number;
  signals: TestDataSignal[];
}

export function looksLikeTestData(input: TestDataInput): TestDataAssessment {
  const { patient, claim, practice } = input;
  const signals: TestDataSignal[] = [];
  let score = 0;
  let strongSignal = false;

  if (matchesKnownFixtureName(patient.firstName, patient.lastName)) {
    signals.push({ field: "patient.name", reason: "Matches known fixture/test name", weight: 2 });
    score += 2;
    strongSignal = true;
  } else if (matchesTestStringPattern(patient.firstName, patient.lastName)) {
    signals.push({ field: "patient.name", reason: "Name contains test/demo/qa keyword", weight: 2 });
    score += 2;
  }

  if (memberIdMatchesTestPattern(patient.memberId)) {
    signals.push({ field: "patient.memberId", reason: "Member ID matches test/demo/synthetic pattern", weight: 3 });
    score += 3;
    strongSignal = true;
  }

  if (matchesFixtureDOB(patient.dob || "")) {
    signals.push({ field: "patient.dob", reason: "Date of birth matches known test fixture DOB", weight: 1 });
    score += 1;
  }

  if (addressContainsTestWords(patient.address)) {
    signals.push({ field: "patient.address", reason: "Address contains test/demo/fake keyword", weight: 1 });
    score += 1;
  }

  if (practice && patientAddressMatchesPracticeAddress(patient.address, practice.address)) {
    signals.push({ field: "patient.address", reason: "Patient address exactly matches practice billing address (subscriber fallback bug)", weight: 2 });
    score += 2;
  }

  if (authNumberMatchesTestPattern(claim.authNumber)) {
    signals.push({ field: "claim.authNumber", reason: "Authorization number contains test/demo/qa marker", weight: 2 });
    score += 2;
  }

  let result: TestDataResult;
  if (strongSignal && score >= 4) {
    result = "blocked";
  } else if (score >= 2) {
    result = "suspicious";
  } else {
    result = "clean";
  }

  return { result, score, signals };
}
