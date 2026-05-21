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
  StartDocumentTextDetectionCommand,
  GetDocumentTextDetectionCommand,
  type Block,
} from "@aws-sdk/client-textract";
import type { RawChunk } from "./manual-extractor.js";
import { uploadBufferToS3, deletePdfFromS3 } from "./storage/s3-uploader.js";

// Pages accumulated into a single RawChunk before storing to the DB.
// 50 pages keeps each chunk at a comfortable size for Phase 2 analysis.
const PAGES_PER_CHUNK = 50;

// If pdfjs yields fewer than this many chars per page on average,
// the PDF is image-based (scanned) and needs Textract OCR.
const SPARSE_CHARS_PER_PAGE = 10;

// AWS Textract DetectDocumentText hard limit (bytes).
// Stay 1 MB below to allow for encoding overhead.
const TEXTRACT_MAX_BYTES = 9 * 1024 * 1024;

// Polling backoff schedule (ms) for async Textract jobs.
const ASYNC_POLL_BACKOFF_MS = [5000, 5000, 10000, 10000, 15000, 30000, 60000];
// Allow up to 10 minutes for very large payer manuals.
const ASYNC_MAX_POLL_MS = 10 * 60 * 1000;

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
  // Point to the bundled worker mjs so pdfjs can spawn it off the main thread.
  // The legacy build is required for Node.js (it avoids browser-only APIs).
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // Resolve the worker path using process.cwd() so it works in both
  // ESM (tsx dev) and CJS (esbuild production bundle) without import.meta.url.
  const path = await import("path");
  const workerPath = path.resolve(
    process.cwd(),
    "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"
  );
  pdfjsLib.GlobalWorkerOptions.workerSrc = `file://${workerPath}`;

  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
    standardFontDataUrl: null as any,
    cMapUrl: null as any,
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

/**
 * Async Textract path for scanned PDFs > TEXTRACT_MAX_BYTES.
 *
 * Flow:
 *   1. Upload the full PDF to S3 under a temp key (payer-manuals/temp/<ts>-<rand>.pdf).
 *   2. Call StartDocumentTextDetection to kick off the async job.
 *   3. Poll GetDocumentTextDetection with exponential backoff until SUCCEEDED.
 *   4. Collect all blocks (handles NextToken pagination).
 *   5. Delete the temp S3 object.
 *   6. Return RawChunk[] via the shared helpers.
 */
async function extractWithTextractAsync(
  buffer: Buffer,
  label: string
): Promise<RawChunk[]> {
  const client = getTextractClient();

  const rand = Math.random().toString(36).slice(2, 10);
  const s3Key = `payer-manuals/temp/${Date.now()}-${rand}.pdf`;

  console.log(
    `[pdf-extractor] Uploading ${label} (${(buffer.length / 1024 / 1024).toFixed(1)} MB) ` +
    `to S3 for async Textract: ${s3Key}`
  );
  await uploadBufferToS3(buffer, s3Key, "application/pdf");

  const bucket = process.env.S3_BUCKET_NAME?.trim();
  if (!bucket) throw new Error("S3_BUCKET_NAME env var not set");

  const startResp = await client.send(
    new StartDocumentTextDetectionCommand({
      DocumentLocation: { S3Object: { Bucket: bucket, Name: s3Key } },
    })
  );
  const jobId = startResp.JobId;
  if (!jobId) throw new Error("Textract StartDocumentTextDetection returned no JobId");

  console.log(`[pdf-extractor] Async Textract job started: ${jobId}`);

  const started = Date.now();
  let backoffIdx = 0;
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  while (true) {
    const elapsed = Date.now() - started;
    if (elapsed > ASYNC_MAX_POLL_MS) {
      throw new Error(
        `[pdf-extractor] Async Textract job ${jobId} timed out after ${Math.round(elapsed / 1000)}s`
      );
    }

    const waitMs = ASYNC_POLL_BACKOFF_MS[Math.min(backoffIdx, ASYNC_POLL_BACKOFF_MS.length - 1)];
    backoffIdx++;
    console.log(`[pdf-extractor] Waiting ${waitMs / 1000}s before polling job ${jobId}…`);
    await sleep(waitMs);

    const allBlocks: Block[] = [];
    const firstResp = await client.send(
      new GetDocumentTextDetectionCommand({ JobId: jobId })
    );

    const status = firstResp.JobStatus;
    if (status === "IN_PROGRESS") {
      console.log(`[pdf-extractor] Job ${jobId} still IN_PROGRESS (${Math.round(elapsed / 1000)}s elapsed)`);
      continue;
    }
    if (status === "FAILED") {
      throw new Error(
        `[pdf-extractor] Async Textract job ${jobId} failed: ${firstResp.StatusMessage ?? "no message"}`
      );
    }

    // SUCCEEDED — gather all blocks across paginated responses.
    allBlocks.push(...(firstResp.Blocks ?? []));
    let nextToken = firstResp.NextToken;
    while (nextToken) {
      const pageResp = await client.send(
        new GetDocumentTextDetectionCommand({ JobId: jobId, NextToken: nextToken })
      );
      allBlocks.push(...(pageResp.Blocks ?? []));
      nextToken = pageResp.NextToken;
    }

    console.log(
      `[pdf-extractor] Async Textract job ${jobId} SUCCEEDED — ` +
      `${allBlocks.length} blocks in ${Math.round((Date.now() - started) / 1000)}s`
    );

    // Clean up temp S3 object — best-effort, don't abort on failure.
    deletePdfFromS3(s3Key).catch((err) =>
      console.warn(`[pdf-extractor] Failed to delete temp S3 object ${s3Key}: ${err.message}`)
    );

    return pageMapToChunks(parseBlocks(allBlocks));
  }
}

async function extractWithTextract(buffer: Buffer, label = "unnamed.pdf"): Promise<RawChunk[]> {
  const client = getTextractClient();

  if (buffer.length <= TEXTRACT_MAX_BYTES) {
    // Fast path — buffer fits within sync API limit.
    const blocks = await textractDetect(client, buffer);
    return pageMapToChunks(parseBlocks(blocks));
  }

  // Large PDF (> 9 MB) — use the async S3 + StartDocumentTextDetection path.
  console.log(
    `[pdf-extractor] Buffer ${(buffer.length / 1024 / 1024).toFixed(1)} MB ` +
    `> ${TEXTRACT_MAX_BYTES / 1024 / 1024} MB sync limit — routing to async Textract via S3`
  );
  return extractWithTextractAsync(buffer, label);
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
  const chunks = await extractWithTextract(buffer, label);
  console.log(
    `[pdf-extractor] Textract complete — ${chunks.length} chunk(s), ${chunks.reduce((s, c) => s + c.charCount, 0).toLocaleString()} total chars`
  );
  return chunks;
}
