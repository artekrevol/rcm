import { load } from "cheerio";
import { URL } from "url";
import * as net from "net";

export type SectionType = "timely_filing" | "prior_auth" | "modifiers" | "appeals";

// SSRF guard — block private/internal URLs
const BLOCKED_HOSTNAMES = new Set([
  "localhost", "0.0.0.0", "metadata.google.internal", "169.254.169.254",
  "::1", "ip6-localhost", "ip6-loopback",
]);

function isPrivateIp(host: string): boolean {
  // Check dotted-quad private ranges
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
  // Block numeric IPv6 literals that may be private
  if (net.isIPv6(host.replace(/^\[/, "").replace(/\]$/, ""))) {
    throw new Error("IPv6 literal URLs are not allowed");
  }
}

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
    "requires authorization", "referral required", "authorization number",
    "approved units", "concurrent review", "clinical review",
  ],
  modifiers: [
    "modifier", "procedure modifier", "billing modifier", "append modifier",
    "modifier requirement", "modifier policy", "HCPCS modifier", "CPT modifier",
    "modifier GT", "modifier 59", "modifier 25", "modifier GP", "modifier GO",
    "modifier GN", "modifier 95", "telehealth modifier", "place of service modifier",
  ],
  appeals: [
    "appeal", "reconsideration", "dispute", "redetermination", "grievance",
    "claim dispute", "appeal process", "appeal deadline", "appeal rights",
    "file an appeal", "appeal period", "days to appeal", "appeal submission",
    "first level", "second level", "formal appeal",
  ],
};

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

async function extractTextFromUrl(url: string): Promise<string> {
  const controller = new AbortController();
  // Allow 60 s to download — large PDFs from major payers can be slow
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

// 5 MB keeps us well under Claude's 200 K-token context limit for scanned pages
const PDF_VISION_MAX_BYTES = 5 * 1024 * 1024;

async function extractPdfWithClaudeVision(buffer: Buffer): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set — cannot use Claude PDF vision");

  if (buffer.length > PDF_VISION_MAX_BYTES) {
    // Trim to first 20 MB to stay within Claude's document limit
    buffer = buffer.subarray(0, PDF_VISION_MAX_BYTES);
  }

  const base64 = buffer.toString("base64");

  const visionController = new AbortController();
  const visionTimeout = setTimeout(() => visionController.abort(), 120000); // 2-min timeout for large PDFs

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
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64,
              },
            },
            {
              type: "text",
              text: `Extract all text content from this payer billing manual PDF, preserving section headings and structure.
Pay special attention to sections about:
1. Timely filing requirements (how many days to submit claims)
2. Prior authorization requirements
3. Billing modifier requirements
4. Claims appeal and reconsideration process

Return the extracted text in plain text format with section headings preserved. Do not summarize — return the actual text.`,
            },
          ],
        },
      ],
    }),
  });

  clearTimeout(visionTimeout);

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude PDF vision API error ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = (await res.json()) as any;
  const text = data.content?.[0]?.text || "";
  if (!text.trim()) throw new Error("Claude PDF vision returned empty text");
  return text.replace(/\s{3,}/g, "\n\n").trim();
}

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  // First try the fast, free text-layer extraction
  try {
    const pdfParse = (await import("pdf-parse")).default;
    const data = await pdfParse(buffer);
    const text = data.text.replace(/\s{3,}/g, "\n\n").trim();
    // If the PDF had a proper text layer, use it
    if (text.length > 200) return text;
  } catch {
    // pdf-parse failed — fall through to Claude vision
  }

  // Fallback: use Claude's vision to read image-based / scanned PDFs
  if (process.env.ANTHROPIC_API_KEY) {
    return await extractPdfWithClaudeVision(buffer);
  }

  throw new Error("PDF text extraction failed — file may be image-only (ANTHROPIC_API_KEY required for OCR)");
}

export async function extractManualSections(
  input: { url?: string; buffer?: Buffer; fileName?: string }
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

  const sectionTypes: SectionType[] = ["timely_filing", "prior_auth", "modifiers", "appeals"];
  const sections: ExtractedSection[] = sectionTypes.map((st) => ({
    sectionType: st,
    chunks: findRelevantChunks(fullText, st),
  }));

  return { fullText, sections };
}
