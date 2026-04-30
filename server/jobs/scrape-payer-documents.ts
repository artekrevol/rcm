import { randomUUID } from "crypto";
import { pool } from "../db";
import { ScrapeReport, DocumentManifest } from "../scrapers/types";
import { UhcScraper } from "../scrapers/uhc";
import { checkCircuit, recordSuccess, recordError } from "../scrapers/runtime";
import { loadManifestCache } from "../scrapers/uhc-fallback-cache";

type TriggeredBy = "manual_admin" | "cron" | "demo_button";

export interface ScrapeOptions {
  since?: Date;
  dryRun?: boolean;
  allowFallback?: boolean;
  triggeredBy?: TriggeredBy;
  userId?: string;
}

// ── Registry of available scrapers ───────────────────────────────────────────
const SCRAPERS: Record<string, () => InstanceType<typeof UhcScraper>> = {
  uhc: () => new UhcScraper(),
};

// ── In-flight guard (one scrape per payer at a time) ─────────────────────────
const inFlight = new Set<string>();

// ── SSE progress emitter ──────────────────────────────────────────────────────
// Listeners register per run_id to receive structured progress events.
type SseMessage = { stage: string; message: string; payload?: Record<string, unknown> };
type SseListener = (msg: SseMessage) => void;
const sseListeners = new Map<string, SseListener[]>();

export function registerSseListener(runId: string, fn: SseListener): void {
  const existing = sseListeners.get(runId) ?? [];
  sseListeners.set(runId, [...existing, fn]);
}
export function unregisterSseListener(runId: string, fn: SseListener): void {
  const existing = sseListeners.get(runId) ?? [];
  sseListeners.set(runId, existing.filter(l => l !== fn));
}

function emit(runId: string, msg: SseMessage): void {
  const listeners = sseListeners.get(runId) ?? [];
  for (const fn of listeners) fn(msg);
}

// ── Artificial min-stage delay (for demo UX — each stage ≥2 seconds) ─────────
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Parent document resolution by year-prefix URL matching ───────────────────
// Supplements follow the pattern YYYY-UHC-*-Supplement.pdf and the admin guide
// is YYYY-UHC-Administrative-Guide.pdf. We extract the year token from the
// supplement URL and look up any existing row with the admin guide URL pattern.
//
// On the first scrape, the admin guide row may not exist yet — the supplement
// inserts with parent_document_id = NULL (orphan). On the second pass, both rows
// are present and the backfill resolves naturally. No manual linkage is needed.
//
// Admin warning: if a supplement row remains unlinked after 7 days, the
// /api/admin/scrapers/status endpoint surfaces a "unlinked_supplement_count" to
// signal that the year-prefix pattern may have broken (e.g., UHC changed their
// URL scheme).
async function resolveParentDocumentId(manifestEntry: DocumentManifest): Promise<string | null> {
  if (manifestEntry.document_type !== 'supplement') return null;
  const yearMatch = manifestEntry.url.match(/\/(\d{4})-UHC-/i);
  if (!yearMatch) return null;
  const year = yearMatch[1];
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM payer_source_documents
     WHERE source_url_canonical ILIKE $1
       AND source_acquisition_method = 'scraped'
     LIMIT 1`,
    [`%${year}-UHC-Administrative-Guide%`]
  );
  return rows[0]?.id ?? null;
}

// ── Trigger extraction on a newly-inserted source document ───────────────────
async function triggerExtraction(docId: string, payerId: string, runId: string): Promise<void> {
  try {
    // Fetch the document row to get content
    const { rows } = await pool.query<{
      file_content: Buffer; file_name: string; document_type: string
    }>(
      `SELECT file_content, file_name, document_type FROM payer_source_documents WHERE id = $1`,
      [docId]
    );
    if (!rows.length || !rows[0].file_content) return;

    const { extractManualSections, FALLBACK_ACTIVE_SECTION_TYPES } = await import(
      "../services/manual-extractor"
    );

    const result = await extractManualSections({
      buffer: rows[0].file_content,
      fileName: rows[0].file_name ?? "document.pdf",
    });

    for (const section of result.sections) {
      for (const chunk of section.chunks) {
        await pool.query(`
          INSERT INTO manual_extraction_items
            (source_document_id, section_type, raw_snippet, review_status, is_demo_seed, notes)
          VALUES ($1, $2, $3, 'pending', FALSE, $4)
        `, [
          docId,
          section.sectionType,
          chunk,
          `[uhc_scraped] run_id:${runId}`,
        ]);
      }
    }
  } catch (err) {
    console.error(`[scraper-job] Extraction failed for doc ${docId}:`, (err as Error).message);
  }
}

// ── Main job ──────────────────────────────────────────────────────────────────
export async function scrapePayerDocuments(
  payer_code: string,
  opts: ScrapeOptions = {}
): Promise<ScrapeReport> {
  const {
    since,
    dryRun = false,
    allowFallback = true,
    triggeredBy = "manual_admin",
    userId,
  } = opts;

  const runId = randomUUID();
  const started_at = new Date();

  const report: ScrapeReport = {
    payer_code,
    started_at,
    completed_at: new Date(),
    documents_discovered: 0,
    documents_new: 0,
    documents_updated: 0,
    documents_unchanged: 0,
    bulletins_discovered: 0,
    errors: [],
    used_fallback: false,
  };

  // Concurrency guard
  if (inFlight.has(payer_code)) {
    report.completed_at = new Date();
    return { ...report };
  }

  // Resolve scraper
  const scraperFactory = SCRAPERS[payer_code];
  if (!scraperFactory) {
    throw new Error(`No scraper registered for payer_code "${payer_code}". Registered: ${Object.keys(SCRAPERS).join(", ")}`);
  }

  // Write scrape_runs row
  if (!dryRun) {
    await pool.query(`
      INSERT INTO scrape_runs(id, payer_code, status, triggered_by, triggered_by_user_id)
      VALUES($1,$2,'running',$3,$4)
    `, [runId, payer_code, triggeredBy, userId ?? null]);
  }

  inFlight.add(payer_code);

  try {
    // Step 1 — Circuit breaker
    emit(runId, { stage: "circuit_check", message: "Checking service health..." });
    const circuitState = await checkCircuit(payer_code);
    if (circuitState === 'open') {
      emit(runId, { stage: "circuit_open", message: "Service temporarily paused due to repeated errors. Try again later." });
      if (!dryRun) {
        await pool.query(
          `UPDATE scrape_runs SET status='circuit_open', completed_at=now(), report=$2 WHERE id=$1`,
          [runId, JSON.stringify(report)]
        );
      }
      return { ...report, completed_at: new Date() };
    }

    const scraper = scraperFactory();

    // Step 2 — Discover documents
    emit(runId, { stage: "discovering", message: `Discovering documents on UHCprovider.com...` });
    await sleep(500); // ensure at least 2s visibility when fast

    let manifest: DocumentManifest[];
    try {
      manifest = await scraper.list_documents({ since });
      await sleep(Math.max(0, 2000 - (Date.now() - started_at.getTime())));
    } catch (err) {
      if (allowFallback) {
        console.warn(`[scraper-job:${payer_code}] Live scrape failed, loading fallback cache:`, (err as Error).message);
        report.used_fallback = true;
        manifest = loadManifestCache() ?? [];
        if (!manifest.length) {
          throw new Error(`Live scrape failed and fallback cache is empty. Original error: ${(err as Error).message}`);
        }
      } else {
        await recordError(payer_code, err as Error);
        throw err;
      }
    }

    report.documents_discovered = manifest.length;
    emit(runId, {
      stage: "comparing",
      message: `Found ${manifest.length} documents. Comparing against existing corpus...`,
      payload: { count: manifest.length, used_fallback: report.used_fallback },
    });
    await sleep(1500);

    // Look up UHC payer ID
    const { rows: payerRows } = await pool.query<{ id: string }>(
      `SELECT id FROM payers WHERE LOWER(name) LIKE 'united%' LIMIT 1`
    );
    const payerId = payerRows[0]?.id ?? null;

    // Step 3 — Process each document
    for (const entry of manifest) {
      try {
        // Check if URL already in DB
        const { rows: existing } = await pool.query<{
          id: string; content_hash: string | null; source_acquisition_method: string
        }>(
          `SELECT id, content_hash, source_acquisition_method
           FROM payer_source_documents
           WHERE source_url_canonical = $1 LIMIT 1`,
          [entry.url]
        );

        if (dryRun) {
          if (!existing.length) report.documents_new++;
          else report.documents_unchanged++;
          continue;
        }

        emit(runId, {
          stage: "fetching",
          message: `Fetching document: ${entry.document_name}...`,
          payload: { url: entry.url },
        });

        if (!existing.length) {
          // New document — fetch and insert
          const fetchResult = await scraper.fetch_document(entry.url);
          const parentId = await resolveParentDocumentId(entry);

          const docId = randomUUID();
          await pool.query(`
            INSERT INTO payer_source_documents
              (id, payer_id, document_type, document_name, source_url,
               source_url_canonical, content_hash, file_content, file_name,
               source_acquisition_method, scrape_status, last_scraped_at,
               status, parent_document_id, notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'scraped','success',now(),'pending',$10,$11)
          `, [
            docId,
            payerId,
            entry.document_type,
            entry.document_name,
            entry.url,
            entry.url,
            fetchResult.content_hash,
            fetchResult.content,
            entry.url.split("/").pop() ?? "document",
            parentId,
            `[uhc_scraped] run_id:${runId}${report.used_fallback ? " [fallback]" : ""}`,
          ]);

          emit(runId, {
            stage: "extracting",
            message: `Extracting payer rules from document...`,
            payload: { document_name: entry.document_name },
          });
          await triggerExtraction(docId, payerId ?? "", runId);
          report.documents_new++;

        } else if (existing[0].source_acquisition_method === 'manual_upload') {
          // Contract: never modify manual_upload rows
          // (manual upload is a first-class path; scraper is additive only)
          await pool.query(
            `UPDATE payer_source_documents SET last_scraped_at=now(), scrape_status='unchanged' WHERE id=$1`,
            [existing[0].id]
          );
          report.documents_unchanged++;

        } else {
          // Existing scraped row — check for updates
          const fetchResult = await scraper.fetch_document(entry.url);
          if (fetchResult.content_hash === existing[0].content_hash) {
            await pool.query(
              `UPDATE payer_source_documents SET last_scraped_at=now(), scrape_status='unchanged' WHERE id=$1`,
              [existing[0].id]
            );
            report.documents_unchanged++;
          } else {
            // New version detected — supersede old row, insert new
            await pool.query(`
              UPDATE payer_source_documents
              SET status='superseded', effective_end=CURRENT_DATE - INTERVAL '1 day'
              WHERE id=$1
            `, [existing[0].id]);

            // Flag all extraction items from old version as needing reverification
            await pool.query(`
              UPDATE manual_extraction_items
              SET needs_reverification=TRUE,
                  notes=COALESCE(notes,'') || $2
              WHERE source_document_id=$1 AND needs_reverification IS NOT TRUE
            `, [
              existing[0].id,
              ` Superseded by document version scraped at ${new Date().toISOString()}. Re-review required.`,
            ]);

            const parentId = await resolveParentDocumentId(entry);
            const docId = randomUUID();
            await pool.query(`
              INSERT INTO payer_source_documents
                (id, payer_id, document_type, document_name, source_url,
                 source_url_canonical, content_hash, file_content, file_name,
                 source_acquisition_method, scrape_status, last_scraped_at,
                 status, parent_document_id, notes)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'scraped','success',now(),'pending',$10,$11)
            `, [
              docId,
              payerId,
              entry.document_type,
              entry.document_name,
              entry.url,
              entry.url,
              fetchResult.content_hash,
              fetchResult.content,
              entry.url.split("/").pop() ?? "document",
              parentId,
              `[uhc_scraped] run_id:${runId} version_of:${existing[0].id}`,
            ]);

            await triggerExtraction(docId, payerId ?? "", runId);
            report.documents_updated++;
          }
        }
      } catch (err) {
        report.errors.push({ url: entry.url, error: (err as Error).message });
        await recordError(payer_code, err as Error);
      }
    }

    // Step 4 — Bulletins
    try {
      const bulletins = await scraper.list_bulletins({ since });
      for (const bulletin of bulletins) {
        if (dryRun) { report.bulletins_discovered++; continue; }
        const { rows: existing } = await pool.query(
          `SELECT id FROM payer_source_documents WHERE source_url_canonical=$1 LIMIT 1`,
          [bulletin.url]
        );
        if (!existing.length) {
          await pool.query(`
            INSERT INTO payer_source_documents
              (id, payer_id, document_type, document_name, source_url,
               source_url_canonical, source_acquisition_method, scrape_status,
               last_scraped_at, status)
            VALUES ($1,$2,'bulletin',$3,$4,$5,'bulletin_triggered','success',now(),'pending')
          `, [
            randomUUID(), payerId, bulletin.title,
            bulletin.url, bulletin.url,
          ]);
          report.bulletins_discovered++;
        }
      }
    } catch (err) {
      report.errors.push({ url: NEWS_URL, error: (err as Error).message });
    }

    // Record success on circuit breaker
    if (!report.errors.length) {
      await recordSuccess(payer_code);
    }

    report.completed_at = new Date();

    // Count new extraction items for demo callout
    let newExtractionCount = 0;
    if (!dryRun && report.documents_new > 0) {
      const { rows: countRows } = await pool.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM manual_extraction_items
         WHERE notes LIKE $1 AND review_status='pending'`,
        [`%run_id:${runId}%`]
      );
      newExtractionCount = parseInt(countRows[0]?.count ?? "0");
    }

    const finalStatus = report.errors.length === 0 ? 'success'
      : report.documents_new > 0 || report.documents_updated > 0 ? 'partial' : 'failed';

    emit(runId, {
      stage: "complete",
      message: `Demo complete. Discovered ${report.documents_discovered} new documents, updated ${report.documents_updated}, identified ${newExtractionCount} new rules for review.`,
      payload: {
        ...report,
        new_extraction_item_count: newExtractionCount,
        run_id: runId,
      },
    });

    if (!dryRun) {
      await pool.query(`
        UPDATE scrape_runs
        SET status=$2, completed_at=now(), report=$3, used_fallback=$4
        WHERE id=$1
      `, [runId, finalStatus, JSON.stringify({ ...report, new_extraction_item_count: newExtractionCount }), report.used_fallback]);
    }

    return { ...report, completed_at: new Date() };

  } catch (err) {
    report.errors.push({ url: "job", error: (err as Error).message });
    report.completed_at = new Date();
    if (!dryRun) {
      await pool.query(
        `UPDATE scrape_runs SET status='failed', completed_at=now(), report=$2 WHERE id=$1`,
        [runId, JSON.stringify(report)]
      );
    }
    throw err;
  } finally {
    inFlight.delete(payer_code);
    // Clean up SSE listeners after a delay
    setTimeout(() => sseListeners.delete(runId), 60_000);
  }
}

// ── Expose the in-flight guard for status checks ──────────────────────────────
export function isInFlight(payerCode: string): boolean {
  return inFlight.has(payerCode);
}

// ── Expose NEWS_URL for verify script ────────────────────────────────────────
export { NEWS_URL };
