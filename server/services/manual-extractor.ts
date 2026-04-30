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
  const keywords = SECTION_KEYWORDS[sectionType];
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
      return await extractTextFromPdf(Buffer.from(buf));
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

const PDF_VISION_MAX_BYTES = 5 * 1024 * 1024;

async function extractPdfWithClaudeVision(buffer: Buffer): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set — cannot use Claude PDF vision");

  if (buffer.length > PDF_VISION_MAX_BYTES) {
    buffer = buffer.subarray(0, PDF_VISION_MAX_BYTES);
  }

  const base64 = buffer.toString("base64");

  const visionController = new AbortController();
  const visionTimeout = setTimeout(() => visionController.abort(), 120000);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: visionController.signal,
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "pdfs-2024-09-25",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: base64 },
            },
            {
              type: "text",
              text: `Extract all text content from this payer billing manual PDF, preserving section headings and structure.
Pay special attention to sections about:
1. Timely filing requirements (how many days to submit claims)
2. Prior authorization requirements and CPT code lists
3. Billing modifier requirements and liability assignment (GA, GZ, GY, Mod 25, 59, 26, TC)
4. Claims appeal and reconsideration process
5. Referral requirements by plan product
6. Coordination of benefits and Medicare Secondary Payer rules
7. Smart Edits and payer-specific clearinghouse edit rules
8. EDI field-level construction requirements (837 format, NDC, segment specs)
9. Place of service rules and telehealth POS requirements
10. Advance submission deadlines (PA prior notice, home health, DME)
11. Payer decision turnaround timeframes
12. Medical records and documentation submission deadlines
13. Provider-to-payer notification event requirements
14. Provider-to-member notice requirements (ABN, NOMNC, IDN)

Return the extracted text in plain text format with section headings preserved. Do not summarize — return the actual text.`,
            },
          ],
        },
      ],
    }),
  });

  clearTimeout(visionTimeout);

  if (!res.ok) {
    const errBody = await res.text();
    if (errBody.includes("maximum of 100 PDF pages")) {
      throw new Error(
        "PDF exceeds 100-page Claude limit. Upload a shorter document or split into chapter-level files before ingesting."
      );
    }
    throw new Error(`Claude PDF vision API error ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data = (await res.json()) as any;
  const text = data.content?.[0]?.text || "";
  if (!text.trim()) throw new Error("Claude PDF vision returned empty text");
  return text.replace(/\s{3,}/g, "\n\n").trim();
}

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  try {
    const pdfParse = (await import("pdf-parse")).default;
    const data = await pdfParse(buffer);
    const text = data.text.replace(/\s{3,}/g, "\n\n").trim();
    if (text.length > 200) return text;
  } catch {
    // pdf-parse failed — fall through to Claude vision
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return await extractPdfWithClaudeVision(buffer);
  }

  throw new Error("PDF text extraction failed — file may be image-only (ANTHROPIC_API_KEY required for OCR)");
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

export async function extractManualSections(
  input: { url?: string; buffer?: Buffer; fileName?: string; activeSectionTypes?: SectionType[] }
): Promise<ManualText> {
  let fullText: string;
  if (input.buffer) {
    const name = (input.fileName || "").toLowerCase();
    if (name.endsWith(".pdf")) {
      fullText = await extractTextFromPdf(input.buffer);
    } else {
      fullText = input.buffer.toString("utf-8");
      if (fullText.trim().startsWith("<")) {
        fullText = extractTextFromHtml(fullText);
      }
    }
  } else if (input.url) {
    fullText = await extractTextFromUrl(input.url);
  } else {
    throw new Error("Must provide either url or buffer");
  }

  const activeTypes = input.activeSectionTypes ?? FALLBACK_ACTIVE_SECTION_TYPES;
  const sections: ExtractedSection[] = activeTypes.map((st) => ({
    sectionType: st,
    chunks: findRelevantChunks(fullText, st),
  }));

  return { fullText, sections };
}
