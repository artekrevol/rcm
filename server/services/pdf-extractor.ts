/**
 * Phase 1 — PDF Text Extraction
 *
 * Two-strategy pipeline, tried in order:
 *   1. pdfjs-dist  — fast, free, perfect for text-layer PDFs.
 *   2. AWS Textract — accurate OCR for scanned / image-based PDFs.
 *
 * Callers receive RawChunk[] grouped in 50-page slices, ready to be stored
 * in payer_document_chunks before any AI analysis runs (Phase 2).
 *
 * This module deliberately has NO dependency on Claude or any LLM.
 */

import {
  TextractClient,
  DetectDocumentTextCommand,
  type Block,
} from "@aws-sdk/client-textract";
import type { RawChunk } from "./manual-extractor.js";

// Pages accumulated into a single RawChunk before storing to the DB.
// 50 pages keeps each chunk at a comfortable size for Phase 2 analysis.
const PAGES_PER_CHUNK = 50;

// If pdfjs yields fewer than this many chars per page on average,
// the PDF is image-based (scanned) and needs Textract OCR.
const SPARSE_CHARS_PER_PAGE = 10;

// AWS Textract DetectDocumentText hard limit (bytes).
// Stay 1 MB below to allow for encoding overhead.
const TEXTRACT_MAX_BYTES = 9 * 1024 * 1024;

// ── Textract client ───────────────────────────────────────────────────────────

function getTextractClient(): TextractClient {
  return new TextractClient({ region: process.env.AWS_REGION });
}

// ── pdfjs-dist extraction ─────────────────────────────────────────────────────

interface PdfjsResult {
  chunks: RawChunk[];
  charsPerPage: number;
}

async function extractWithPdfJs(buffer: Buffer): Promise<PdfjsResult> {
  // pdfjs-dist v5 is pure ESM — use dynamic import.
  // Disable the web worker (not available in Node.js).
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = "";

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    // Suppress canvas/DOM warnings in Node.js
    useSystemFonts: true,
    verbosity: 0,
  });
  const pdfDoc = await loadingTask.promise;
  const totalPages = pdfDoc.numPages;

  const pageTexts: string[] = [];
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: any) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/ {2,}/g, " ")
      .trim();
    pageTexts.push(pageText);
  }

  const totalChars = pageTexts.reduce((sum, t) => sum + t.length, 0);
  const charsPerPage = totalPages > 0 ? totalChars / totalPages : 0;

  // Group pages into PAGES_PER_CHUNK slices
  const chunks: RawChunk[] = [];
  for (let start = 0; start < totalPages; start += PAGES_PER_CHUNK) {
    const end = Math.min(start + PAGES_PER_CHUNK, totalPages);
    const rawText = pageTexts
      .slice(start, end)
      .join("\n\n")
      .replace(/\s{3,}/g, "\n\n")
      .trim();
    chunks.push({
      chunkIndex: Math.floor(start / PAGES_PER_CHUNK),
      pageStart: start + 1,
      pageEnd: end,
      rawText,
      charCount: rawText.length,
      extractionMethod: "pdfjs",
    });
  }

  return { chunks, charsPerPage };
}

// ── AWS Textract extraction ───────────────────────────────────────────────────

/** Convert Textract LINE blocks → Map<pageNumber, linesArray> */
function parseBlocks(blocks: Block[]): Map<number, string[]> {
  const pageMap = new Map<number, string[]>();
  for (const block of blocks) {
    if (block.BlockType === "LINE" && block.Text && block.Page != null) {
      if (!pageMap.has(block.Page)) pageMap.set(block.Page, []);
      pageMap.get(block.Page)!.push(block.Text);
    }
  }
  return pageMap;
}

/** Group a page→lines map into PAGES_PER_CHUNK RawChunk slices. */
function pageMapToChunks(pageMap: Map<number, string[]>): RawChunk[] {
  const sortedPages = Array.from(pageMap.keys()).sort((a, b) => a - b);
  const chunks: RawChunk[] = [];

  for (let i = 0; i < sortedPages.length; i += PAGES_PER_CHUNK) {
    const pageSlice = sortedPages.slice(i, i + PAGES_PER_CHUNK);
    const rawText = pageSlice
      .map((p) => (pageMap.get(p) || []).join("\n"))
      .join("\n\n")
      .replace(/\s{3,}/g, "\n\n")
      .trim();

    chunks.push({
      chunkIndex: Math.floor(i / PAGES_PER_CHUNK),
      pageStart: pageSlice[0],
      pageEnd: pageSlice[pageSlice.length - 1],
      rawText,
      charCount: rawText.length,
      extractionMethod: "textract",
    });
  }

  return chunks;
}

/**
 * Run AWS Textract DetectDocumentText on a single buffer (≤ TEXTRACT_MAX_BYTES).
 * Returns the raw Block array for the caller to parse.
 */
async function textractDetect(client: TextractClient, buf: Buffer): Promise<Block[]> {
  const res = await client.send(
    new DetectDocumentTextCommand({ Document: { Bytes: buf } })
  );
  return res.Blocks ?? [];
}

async function extractWithTextract(buffer: Buffer): Promise<RawChunk[]> {
  const client = getTextractClient();
  const pageMap = new Map<number, string[]>();

  if (buffer.length <= TEXTRACT_MAX_BYTES) {
    // Fast path — buffer fits within sync API limit
    const blocks = await textractDetect(client, buffer);
    for (const [page, lines] of parseBlocks(blocks)) {
      pageMap.set(page, lines);
    }
  } else {
    // Large PDF — split with pdf-lib, run Textract on each sub-buffer,
    // then remap page numbers to the absolute position in the full document.
    console.log(
      `[pdf-extractor] Buffer ${(buffer.length / 1024 / 1024).toFixed(1)} MB > ${TEXTRACT_MAX_BYTES / 1024 / 1024} MB limit — splitting for Textract`
    );
    const { PDFDocument } = await import("pdf-lib");
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const totalPages = pdfDoc.getPageCount();

    // Conservative 200 KB/page estimate keeps us safely under the limit.
    const estBytesPerPage = buffer.length / Math.max(totalPages, 1);
    const pagesPerSplit = Math.max(
      1,
      Math.floor(TEXTRACT_MAX_BYTES / Math.max(estBytesPerPage, 1))
    );

    let pageOffset = 0;
    for (let start = 0; start < totalPages; start += pagesPerSplit) {
      const end = Math.min(start + pagesPerSplit, totalPages);
      const subDoc = await PDFDocument.create();
      const indices = Array.from({ length: end - start }, (_, i) => start + i);
      const copied = await subDoc.copyPages(pdfDoc, indices);
      copied.forEach((p) => subDoc.addPage(p));
      const subBuf = Buffer.from(await subDoc.save());

      console.log(
        `[pdf-extractor] Textract sub-buffer pages ${start + 1}–${end} (${(subBuf.length / 1024).toFixed(0)} KB)`
      );
      const blocks = await textractDetect(client, subBuf);
      for (const [relPage, lines] of parseBlocks(blocks)) {
        pageMap.set(relPage + pageOffset, lines);
      }
      pageOffset += end - start;
    }
  }

  return pageMapToChunks(pageMap);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Extract text from a PDF buffer and return page-range chunks.
 *
 * Routing:
 *  1. pdfjs-dist  → text-layer PDFs  (≥ SPARSE_CHARS_PER_PAGE chars/page avg)
 *  2. AWS Textract → scanned/image PDFs (below threshold or pdfjs failure)
 *
 * @param buffer   Raw PDF bytes
 * @param fileName Optional filename for log context
 */
export async function extractPdfToChunks(
  buffer: Buffer,
  fileName?: string
): Promise<RawChunk[]> {
  const label = fileName || "unnamed.pdf";
  const sizeKb = (buffer.length / 1024).toFixed(0);
  console.log(`[pdf-extractor] Starting extraction: ${label} (${sizeKb} KB)`);

  // ── Try pdfjs-dist first ──
  try {
    const { chunks, charsPerPage } = await extractWithPdfJs(buffer);
    console.log(
      `[pdf-extractor] pdfjs: ${charsPerPage.toFixed(1)} chars/page avg across ${chunks.length} chunk(s)`
    );

    if (charsPerPage >= SPARSE_CHARS_PER_PAGE) {
      console.log(
        `[pdf-extractor] Text-layer PDF confirmed — using pdfjs (${chunks.reduce((s, c) => s + c.charCount, 0).toLocaleString()} total chars)`
      );
      return chunks;
    }

    console.log(
      `[pdf-extractor] Sparse text (${charsPerPage.toFixed(1)} chars/page) — image-based PDF, routing to AWS Textract`
    );
  } catch (err: any) {
    console.warn(`[pdf-extractor] pdfjs failed (${err.message}) — routing to AWS Textract`);
  }

  // ── Fall back to AWS Textract ──
  console.log(`[pdf-extractor] Starting AWS Textract extraction for ${label}`);
  const chunks = await extractWithTextract(buffer);
  console.log(
    `[pdf-extractor] Textract complete — ${chunks.length} chunk(s), ${chunks.reduce((s, c) => s + c.charCount, 0).toLocaleString()} total chars`
  );
  return chunks;
}
