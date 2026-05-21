import { load } from "cheerio";
import { URL } from "url";
import * as net from "net";

// ── Prompt B1: 15 rule kind codes (risk_adjustment_hcc seeded only — not extracted) ──
export type SectionType =
  | "timely_filing"
  | "prior_auth"
  | "modifiers_and_liability"
  | "appeals"
  | "referrals"
  | "coordination_of_benefits"
  | "payer_specific_edits"
  | "edi_construction"
  | "place_of_service"
  | "submission_timeframe"
  | "decision_timeframe"
  | "documentation_timeframe"
  | "notification_event"
  | "member_notice"
  | "risk_adjustment_hcc";

// ── SSRF guard — block private/internal URLs ──────────────────────────────────
const BLOCKED_HOSTNAMES = new Set([
  "localhost", "0.0.0.0", "metadata.google.internal", "169.254.169.254",
  "::1", "ip6-localhost", "ip6-loopback",
]);

function isPrivateIp(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length === 4 && parts.every((p) => !isNaN(p))) {
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
  }
  return false;
}

export function validateManualUrl(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Invalid URL format");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are allowed");
  }
  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new Error(`URL host '${host}' is not allowed`);
  }
  if (isPrivateIp(host)) {
    throw new Error(`URL resolves to a private/internal IP range which is not allowed`);
  }
  if (net.isIPv6(host.replace(/^\[/, "").replace(/\]$/, ""))) {
    throw new Error("IPv6 literal URLs are not allowed");
  }
}

// ── Prompt B1: keyword arrays — reviewed and approved before shipping ─────────
//
// Design notes per reviewer guidance:
// • submission_timeframe: contains NO "X notification" phrases — those belong to notification_event.
//   Uses directional bigrams ("submit at least", "request at least") instead of unigrams.
// • decision_timeframe: directional bigrams ("decision within", "respond within", etc.)
// • documentation_timeframe: directional bigrams ("submit within", "supply within", etc.)
// • notification_event: all "X notification" phrases live here exclusively.
// • member_notice: QMB/dual-eligible/balance-billing removed; moved to coordination_of_benefits.
//   Keeps NOMNC, ABN, IDN, written consent, termination notice language only.
// • referrals: "gatekeeper" removed; "specialty care", "must select a PCP", "referral guide" added.
// • place_of_service: "POS-22", "POS-23", "outpatient hospital", "ambulatory surgery center" added.

export const SECTION_KEYWORDS: Record<SectionType, string[]> = {
  timely_filing: [
    "timely filing", "filing deadline", "filing limit", "filing requirement",
    "submission deadline", "days to file", "days from service", "claim submission",
    "filing period", "time limit", "claims must be submitted", "within 90 days",
    "within 180 days", "within 365 days", "within one year", "within 12 months",
  ],

  prior_auth: [
    "prior authorization", "prior auth", "pre-authorization", "preauthorization",
    "pre-certification", "precertification", "authorization required",
    "requires authorization", "authorization number",
    "approved units", "concurrent review", "clinical review",
  ],

  modifiers_and_liability: [
    "modifier", "procedure modifier", "billing modifier", "append modifier",
    "modifier requirement", "modifier policy", "HCPCS modifier", "CPT modifier",
    "modifier GT", "modifier 59", "modifier 25", "modifier GP", "modifier GO",
    "modifier GN", "modifier 95", "telehealth modifier", "modifier GA", "modifier GZ",
    "modifier GY", "modifier 26", "modifier TC", "modifier 76", "modifier 77",
    "modifier 91", "liability assignment", "balance billing", "member liability",
    "provider liability", "advance written notice", "noncovered service",
  ],

  appeals: [
    "appeal", "reconsideration", "dispute", "redetermination", "grievance",
    "claim dispute", "appeal process", "appeal deadline", "appeal rights",
    "file an appeal", "appeal period", "days to appeal", "appeal submission",
    "first level", "second level", "formal appeal",
  ],

  referrals: [
    "referral", "PCP referral", "primary care physician referral", "specialist referral",
    "referral required", "referral not required", "referral exception", "self-referral",
    "standing referral", "referral authorization", "out-of-network referral",
    "referral to specialist", "referral waiver", "referral process",
    "W500 wrap network", "referral requirement", "PCP selection",
    "without referral", "specialty care", "must select a PCP", "referral guide",
  ],

  coordination_of_benefits: [
    "coordination of benefits", "COB", "Medicare Secondary Payer", "MSP",
    "Medicare crossover", "primary payer", "secondary payer", "tertiary payer",
    "COB rules", "crossover claim", "dual coverage", "other insurance",
    "Medicare as secondary", "MSP questionnaire", "COB determination",
    "primary insurance", "secondary billing", "Medicare coordination",
    "EOB required", "payer of last resort", "working aged", "ESRD", "disability MSP",
    "QMB", "dual eligible", "balance billing notice", "cannot bill member",
  ],

  payer_specific_edits: [
    "Smart Edits", "Smart Edit", "Return Smart Edit", "Rejection Smart Edit",
    "Documentation Smart Edit", "clearinghouse edit", "5 calendar days", "auto-process",
    "claim edit", "edit response window", "flagged claims", "Return and Documentation",
    "edit notification", "claim correction", "edit category", "Rejection Smart Edit",
  ],

  edi_construction: [
    "837", "NDC", "national drug code", "field format", "loop 2400", "MEA segment",
    "LIN03", "CTP04", "HCT level", "EPO claims", "DEX Z-code", "molecular pathology",
    "24D field", "CMS-1500 field", "UB-04 field 43", "5010", "EDI format requirement",
    "NPI format", "taxonomy code", "qualifier", "segment requirement",
    "claim format specification",
  ],

  place_of_service: [
    "place of service", "POS", "POS-02", "POS-10", "POS-11", "POS-22", "POS-23",
    "telehealth place of service", "facility vs non-facility", "POS code",
    "office setting", "outpatient facility", "inpatient facility",
    "assistant surgeon POS", "rendering location", "originating site",
    "POS restriction", "distant site", "modifier GT", "modifier 95",
    "outpatient hospital", "ambulatory surgery center",
  ],

  // Submission timeframe: advance PRE-SERVICE deadlines only.
  // NO "X notification" phrases — those belong to notification_event.
  // Uses directional bigrams ("submit at least", "request at least") for precision.
  submission_timeframe: [
    "submit prior to service", "prior authorization deadline", "claim submission deadline",
    "retroactive authorization", "post-service review", "request prior to service",
    "submit before service date", "home health prior notice", "DME prior notice",
    "submit at least", "request at least", "notify at least",
    "at least 5 business days before", "at least 15 calendar days before",
    "at least 2 business days after", "prospective review", "advance authorization",
  ],

  // Decision timeframe: directional bigrams for payer turnaround obligations.
  decision_timeframe: [
    "decision within", "respond within", "determination within",
    "review within", "completed within", "we will decide within",
    "authorization decision", "PA decision", "approval timeline",
    "expedited review", "standard review", "urgent review", "concurrent review",
    "turnaround time", "coverage determination",
  ],

  // Documentation timeframe: directional bigrams for records submission deadlines.
  documentation_timeframe: [
    "submit within", "supply within", "provide within", "records within",
    "delivered within", "produce within",
    "medical record", "records submission", "record request", "clinical documentation",
    "medical records request", "audit records", "lab results submission",
    "discharge summary", "HEDIS", "records retention", "10 years",
    "electronic file transfer",
  ],

  // Notification event: all "X notification" phrases live exclusively here.
  notification_event: [
    "notify payer", "notification to payer", "concurrent notification",
    "inpatient notification", "discharge notification", "admission notification",
    "demographic change", "termination notice", "NOMNC",
    "notice of Medicare noncoverage", "provider notification",
    "SNF notification", "observation notification", "network change notification",
    "immediate notification", "30 calendar days", "45 calendar days",
  ],

  // Member notice: NOMNC, ABN, IDN, written consent, termination notices ONLY.
  // QMB / dual-eligible / balance-billing moved to coordination_of_benefits.
  member_notice: [
    "notice to member", "member notification", "advance written notice",
    "ABN", "advance beneficiary notice", "NOMNC", "IDN",
    "integrated denial notice", "SNF discharge notice",
    "written consent", "termination of services notice",
    "member rights notice", "noncoverage notice",
  ],

  // risk_adjustment_hcc: seeded in rule_kinds but NOT active in extraction.
  // Keyword array included for future reference; extractManualSections skips this kind.
  risk_adjustment_hcc: [
    "HCC", "hierarchical condition category", "risk adjustment", "RAF score",
    "risk adjustment factor", "HCC coding", "Medicare Advantage risk",
    "diagnosis coding", "HCC documentation", "risk adjustment guidance",
  ],
};

// ── Chunk utilities ───────────────────────────────────────────────────────────

const MAX_CHUNK_CHARS = 6000;

export interface ExtractedSection {
  sectionType: SectionType;
  chunks: string[];
}

export interface ManualText {
  fullText: string;
  sections: ExtractedSection[];
}

export interface RawChunk {
  chunkIndex: number;
  pageStart: number | null;
  pageEnd: number | null;
  rawText: string;
  charCount: number;
  // 'pdf_parse' kept for backward-compat with existing DB rows only.
  // New documents will only produce 'pdfjs', 'textract', 'html', or 'url'.
  extractionMethod: 'pdf_parse' | 'pdfjs' | 'textract' | 'html' | 'url';
}

function splitIntoChunks(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n{2,}/);
  let current = "";
  for (const p of paragraphs) {
    if ((current + "\n\n" + p).length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = p;
    } else {
      current = current ? current + "\n\n" + p : p;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function findRelevantChunks(fullText: string, sectionType: SectionType): string[] {
  const keywords = SECTION_KEYWORDS[sectionType as keyof typeof SECTION_KEYWORDS];
  if (!keywords || keywords.length === 0) return [];
  const allChunks = splitIntoChunks(fullText);
  const relevant: Array<{ chunk: string; score: number }> = [];
  for (const chunk of allChunks) {
    const lower = chunk.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) score++;
    }
    if (score > 0) relevant.push({ chunk, score });
  }
  relevant.sort((a, b) => b.score - a.score);
  return relevant.slice(0, 4).map((r) => r.chunk);
}

// ── Text extraction ───────────────────────────────────────────────────────────

async function extractTextFromUrl(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "ClaimShieldHealth/1.0 ManualIngestionAgent" },
    });
    clearTimeout(timeout);
    const contentType = res.headers.get("content-type") || "";
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    if (contentType.includes("text/html") || contentType.includes("text/plain")) {
      const html = await res.text();
      return extractTextFromHtml(html);
    }
    if (contentType.includes("application/pdf") || url.toLowerCase().endsWith(".pdf")) {
      const buf = await res.arrayBuffer();
      const { extractPdfToChunks } = await import("./pdf-extractor.js");
      const chunks = await extractPdfToChunks(Buffer.from(buf));
      return chunks.map((c) => c.rawText).join("\n\n");
    }
    const text = await res.text();
    return text.replace(/\s+/g, " ").trim();
  } finally {
    clearTimeout(timeout);
  }
}

function extractTextFromHtml(html: string): string {
  const $ = load(html);
  $("script, style, nav, header, footer, .nav, .menu, .sidebar, .cookie, .banner").remove();
  const bodyText = $("body").text();
  return bodyText.replace(/\t/g, " ").replace(/ {2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Delegate to the dedicated Phase 1 extraction service.
 * pdfjs-dist handles text-layer PDFs; AWS Textract handles scanned/image PDFs.
 * No Claude calls occur during text extraction.
 */
async function extractChunksFromPdf(buffer: Buffer, fileName?: string): Promise<RawChunk[]> {
  const { extractPdfToChunks } = await import("./pdf-extractor.js");
  return extractPdfToChunks(buffer, fileName);
}

// ── Main extraction entry point ───────────────────────────────────────────────

// Fallback list used when the caller does not pass activeSectionTypes.
// The extraction route should always pass the DB-driven list instead so that
// toggling rule_kinds.active_in_extraction requires no code change.
export const FALLBACK_ACTIVE_SECTION_TYPES: SectionType[] = [
  "timely_filing",
  "prior_auth",
  "modifiers_and_liability",
  "appeals",
  "referrals",
  "coordination_of_benefits",
  "payer_specific_edits",
  "edi_construction",
  "place_of_service",
  "submission_timeframe",
  "decision_timeframe",
  "documentation_timeframe",
  "notification_event",
  "member_notice",
];

/**
 * Extract raw text chunks from any source (PDF, HTML buffer, or URL).
 * Each chunk carries its page range and extraction method for storage and audit.
 * Callers should persist these chunks before running structured AI analysis.
 */
export async function extractRawChunks(
  input: { url?: string; buffer?: Buffer; fileName?: string }
): Promise<RawChunk[]> {
  if (input.buffer) {
    const name = (input.fileName || "").toLowerCase();
    if (name.endsWith(".pdf")) {
      return extractChunksFromPdf(input.buffer, input.fileName);
    }
    let text = input.buffer.toString("utf-8");
    if (text.trim().startsWith("<")) {
      text = extractTextFromHtml(text);
    }
    return [{
      chunkIndex: 0, pageStart: null, pageEnd: null,
      rawText: text, charCount: text.length, extractionMethod: 'html',
    }];
  }
  if (input.url) {
    const text = await extractTextFromUrl(input.url);
    return [{
      chunkIndex: 0, pageStart: null, pageEnd: null,
      rawText: text, charCount: text.length, extractionMethod: 'url',
    }];
  }
  throw new Error("Must provide either url or buffer");
}

/**
 * Given already-extracted full text, find semantically relevant passages per
 * section type. This is Phase 2 of the pipeline — call this after chunks are
 * stored in the DB to avoid re-running OCR/PDF extraction.
 */
export function analyzeFullText(
  fullText: string,
  activeSectionTypes: SectionType[]
): ExtractedSection[] {
  return activeSectionTypes.map((st) => ({
    sectionType: st,
    chunks: findRelevantChunks(fullText, st),
  }));
}

/**
 * Find which stored DB chunk a given text snippet most likely came from.
 * Used to set chunk_id on manual_extraction_items for auditability.
 */
export function findSourceChunkId(
  snippet: string,
  savedChunks: Array<{ id: string; raw_text: string }>
): string | null {
  if (savedChunks.length === 0) return null;
  if (savedChunks.length === 1) return savedChunks[0].id;
  const probe = snippet.slice(0, 120).toLowerCase();
  for (const chunk of savedChunks) {
    if (chunk.raw_text.toLowerCase().includes(probe)) return chunk.id;
  }
  return savedChunks[0].id;
}

export async function extractManualSections(
  input: { url?: string; buffer?: Buffer; fileName?: string; activeSectionTypes?: SectionType[] }
): Promise<ManualText> {
  const rawChunks = await extractRawChunks(input);
  const fullText = rawChunks.map(c => c.rawText).join("\n\n").replace(/\s{3,}/g, "\n\n").trim();
  const activeTypes = input.activeSectionTypes ?? FALLBACK_ACTIVE_SECTION_TYPES;
  return { fullText, sections: analyzeFullText(fullText, activeTypes) };
}
