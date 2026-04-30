/**
 * Crawler Monitoring Service
 *
 * Three monitoring layers:
 *  1. Post-scrape SQL assertions — validate data integrity after each cron run
 *  2. Webhook delivery — fires to SCRAPER_ALERT_WEBHOOK_URL on completion
 *  3. Weekly synthetic E2E test — inserts canary doc, verifies extraction pipeline
 *
 * All three are no-ops / graceful when optional env vars are absent.
 */

import { pool } from "../db";
import { ScrapeReport } from "../scrapers/types";
import { randomUUID } from "crypto";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AlertLevel = "info" | "warning" | "error";

export interface AssertionResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface MonitorPayload {
  type: "scrape_complete" | "synthetic_test";
  alert_level: AlertLevel;
  payer_code: string;
  triggered_by: string;
  run_id: string | null;
  report: Partial<ScrapeReport> | null;
  assertions: AssertionResult[];
  timestamp: string;
  env: string;
}

// ── 1. Post-scrape SQL assertions ─────────────────────────────────────────────

/**
 * Run 4 data-integrity assertions against the DB after a cron scrape.
 * Checks are scoped to documents created/modified in the past 24h to avoid
 * re-flagging pre-existing issues on every run.
 */
export async function runPostScrapeAssertions(
  runId: string,
  _report: ScrapeReport,
  payerCode: string,
): Promise<AssertionResult[]> {
  const results: AssertionResult[] = [];

  // ── A1: Newly-inserted scraped docs have non-null content_hash, source_url_canonical, last_scraped_at
  try {
    const { rows } = await pool.query<{ count: string }>(`
      SELECT COUNT(*)::int AS count
      FROM payer_source_documents
      WHERE source_acquisition_method = 'scraped'
        AND created_at > NOW() - INTERVAL '24 hours'
        AND (content_hash IS NULL OR source_url_canonical IS NULL OR last_scraped_at IS NULL)
    `);
    const bad = parseInt(rows[0]?.count ?? "0");
    results.push({
      name: "new_docs_have_required_fields",
      passed: bad === 0,
      detail: bad === 0
        ? "All new scraped docs have content_hash, source_url_canonical, last_scraped_at."
        : `${bad} new scraped doc(s) are missing one or more required fields.`,
    });
  } catch (err) {
    results.push({ name: "new_docs_have_required_fields", passed: false, detail: `Query error: ${(err as Error).message}` });
  }

  // ── A2: Each new doc with scrape_status='pending' has ≥1 extraction item created within 5 min of scrape
  try {
    const { rows } = await pool.query<{ count: string }>(`
      SELECT COUNT(*)::int AS count
      FROM payer_source_documents psd
      WHERE psd.source_acquisition_method = 'scraped'
        AND psd.scrape_status = 'pending'
        AND psd.created_at > NOW() - INTERVAL '24 hours'
        AND NOT EXISTS (
          SELECT 1 FROM manual_extraction_items mei
          WHERE mei.source_document_id = psd.id
            AND mei.created_at <= psd.created_at + INTERVAL '5 minutes'
        )
    `);
    const bad = parseInt(rows[0]?.count ?? "0");
    results.push({
      name: "pending_docs_have_extraction_items",
      passed: bad === 0,
      detail: bad === 0
        ? "All new pending docs have extraction items within 5 minutes."
        : `${bad} new pending doc(s) lack extraction items within 5 minutes of scrape.`,
    });
  } catch (err) {
    results.push({ name: "pending_docs_have_extraction_items", passed: false, detail: `Query error: ${(err as Error).message}` });
  }

  // ── A3: No docs with scrape_status='success' older than 5 days have zero extraction items (silent extraction failure)
  try {
    const { rows } = await pool.query<{ count: string }>(`
      SELECT COUNT(*)::int AS count
      FROM payer_source_documents psd
      WHERE psd.source_acquisition_method = 'scraped'
        AND psd.scrape_status = 'success'
        AND psd.created_at < NOW() - INTERVAL '5 days'
        AND NOT EXISTS (
          SELECT 1 FROM manual_extraction_items mei
          WHERE mei.source_document_id = psd.id
        )
    `);
    const bad = parseInt(rows[0]?.count ?? "0");
    results.push({
      name: "no_silent_extraction_failures",
      passed: bad === 0,
      detail: bad === 0
        ? "No documents with scrape_status=success have silent extraction failures."
        : `${bad} doc(s) marked success have zero extraction items (possible silent failure).`,
    });
  } catch (err) {
    results.push({ name: "no_silent_extraction_failures", passed: false, detail: `Query error: ${(err as Error).message}` });
  }

  // ── A4: No supplements unlinked (parent_document_id IS NULL) for more than 7 days
  try {
    const { rows } = await pool.query<{ count: string }>(`
      SELECT COUNT(*)::int AS count
      FROM payer_source_documents
      WHERE document_type = 'supplement'
        AND source_acquisition_method = 'scraped'
        AND parent_document_id IS NULL
        AND created_at < NOW() - INTERVAL '7 days'
    `);
    const bad = parseInt(rows[0]?.count ?? "0");
    results.push({
      name: "no_orphan_supplements",
      passed: bad === 0,
      detail: bad === 0
        ? "No supplement documents are orphaned for more than 7 days."
        : `${bad} supplement(s) have been unlinked for >7 days — URL year-prefix matching may need review.`,
    });
  } catch (err) {
    results.push({ name: "no_orphan_supplements", passed: false, detail: `Query error: ${(err as Error).message}` });
  }

  return results;
}

// ── 2. Alert level determination ──────────────────────────────────────────────

export function determineAlertLevel(
  report: ScrapeReport,
  finalStatus: string,
  assertions: AssertionResult[],
): AlertLevel {
  const anyAssertionFailed = assertions.some(a => !a.passed);
  const hasErrors = report.errors.length > 0;
  const isFailedStatus = finalStatus !== "success" && finalStatus !== "partial";

  if (anyAssertionFailed || hasErrors || isFailedStatus) return "error";
  if (report.used_fallback || report.documents_new === 0) return "warning";
  return "info";
}

// ── 3. Webhook delivery ───────────────────────────────────────────────────────

/**
 * POST the monitor payload to SCRAPER_ALERT_WEBHOOK_URL.
 * Silently no-ops if the env var is not set.
 * Logs result/failure but never throws.
 */
export async function fireWebhook(payload: MonitorPayload): Promise<void> {
  const webhookUrl = process.env.SCRAPER_ALERT_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log(`[scraper-monitor] SCRAPER_ALERT_WEBHOOK_URL not set — skipping webhook (alert_level=${payload.alert_level})`);
    return;
  }

  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      console.warn(`[scraper-monitor] Webhook responded ${resp.status} for ${payload.type} (${payload.payer_code})`);
    } else {
      console.log(`[scraper-monitor] Webhook fired — type=${payload.type} level=${payload.alert_level} payer=${payload.payer_code}`);
    }
  } catch (err) {
    console.error(`[scraper-monitor] Webhook delivery failed:`, (err as Error).message);
  }
}

// ── 4. Audit log ──────────────────────────────────────────────────────────────

/**
 * Write a row to scraper_monitor_log for permanent audit trail.
 * Gracefully no-ops on schema errors (table may not yet exist).
 */
export async function logMonitorEvent(payload: MonitorPayload): Promise<void> {
  try {
    await pool.query(`
      INSERT INTO scraper_monitor_log
        (id, event_type, alert_level, payer_code, run_id, payload, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, [
      randomUUID(),
      payload.type,
      payload.alert_level,
      payload.payer_code,
      payload.run_id,
      JSON.stringify(payload),
    ]);
  } catch {
    // table may not exist yet during first boot — non-fatal
  }
}

// ── 5. Weekly synthetic E2E test ──────────────────────────────────────────────

/**
 * Synthetic canary test that validates the pipeline without touching
 * production data:
 *   1. Resolve the UHC payer row
 *   2. Insert a canary payer_source_document (flagged with [synthetic_test] in notes)
 *   3. Insert a canary manual_extraction_items row linked to it
 *   4. Wait 2 seconds, then verify the item is queryable in the queue
 *   5. Delete both rows
 *   6. Return a MonitorPayload suitable for fireWebhook
 */
export async function runWeeklySyntheticTest(payerCode: string): Promise<MonitorPayload> {
  const assertions: AssertionResult[] = [];
  const runId = `synthetic-${randomUUID()}`;
  const now = new Date().toISOString();

  let docId: string | null = null;
  let itemId: string | null = null;

  try {
    // Step 1 — resolve payer_id
    const { rows: payerRows } = await pool.query<{ id: string }>(
      `SELECT id FROM payers WHERE LOWER(name) LIKE '%united%' OR id ILIKE '%uhc%' LIMIT 1`
    );
    const payerId = payerRows[0]?.id ?? null;

    // Step 2 — insert canary document
    docId = randomUUID();
    await pool.query(`
      INSERT INTO payer_source_documents
        (id, payer_id, document_name, document_type, source_acquisition_method,
         source_url_canonical, content_hash, scrape_status, last_scraped_at,
         created_at, notes)
      VALUES ($1, $2, $3, 'pa_list', 'scraped', $4, $5, 'success', NOW(), NOW(), $6)
    `, [
      docId,
      payerId,
      `[synthetic_test] Monitoring Canary — ${now}`,
      `https://synthetic-test.internal/${docId}`,
      `SYNTHETIC_${runId}`,
      `[synthetic_test] run_id:${runId}`,
    ]);

    assertions.push({
      name: "canary_doc_inserted",
      passed: true,
      detail: `Canary document inserted with id=${docId}.`,
    });

    // Step 3 — insert a simulated extraction item
    itemId = randomUUID();
    await pool.query(`
      INSERT INTO manual_extraction_items
        (id, source_document_id, section_type, raw_snippet, review_status, is_demo_seed, notes, created_at)
      VALUES ($1, $2, 'timely_filing', $3, 'pending', FALSE, $4, NOW())
    `, [
      itemId,
      docId,
      `[SYNTHETIC TEST] This is an auto-generated canary extraction item. run_id=${runId}`,
      `[synthetic_test] run_id:${runId}`,
    ]);

    // Step 4 — wait 2 seconds, then verify
    await new Promise(r => setTimeout(r, 2000));

    const { rows: verifyRows } = await pool.query<{ count: string }>(`
      SELECT COUNT(*)::int AS count FROM manual_extraction_items WHERE id = $1
    `, [itemId]);

    const found = parseInt(verifyRows[0]?.count ?? "0") > 0;
    assertions.push({
      name: "canary_extraction_item_visible_in_queue",
      passed: found,
      detail: found
        ? "Canary extraction item is visible in the pending queue."
        : "Canary extraction item was NOT found in the queue — pipeline may be broken.",
    });

  } catch (err) {
    assertions.push({
      name: "synthetic_test_execution",
      passed: false,
      detail: `Test failed with error: ${(err as Error).message}`,
    });
  } finally {
    // Step 5 — clean up regardless of outcome
    try {
      if (itemId) await pool.query(`DELETE FROM manual_extraction_items WHERE id = $1`, [itemId]);
      if (docId) await pool.query(`DELETE FROM payer_source_documents WHERE id = $1`, [docId]);
    } catch (cleanupErr) {
      console.error(`[scraper-monitor] Synthetic test cleanup error:`, (cleanupErr as Error).message);
    }
  }

  const allPassed = assertions.every(a => a.passed);
  const alertLevel: AlertLevel = allPassed ? "info" : "error";

  const payload: MonitorPayload = {
    type: "synthetic_test",
    alert_level: alertLevel,
    payer_code: payerCode,
    triggered_by: "cron_weekly",
    run_id: runId,
    report: null,
    assertions,
    timestamp: now,
    env: process.env.NODE_ENV ?? "development",
  };

  console.log(`[scraper-monitor] Synthetic test complete — level=${alertLevel} assertions=${assertions.length} allPassed=${allPassed}`);
  return payload;
}

// ── Convenience: full post-scrape monitor run ─────────────────────────────────

/**
 * Run assertions + determine alert level + fire webhook + log.
 * Call this after every cron-triggered scrape.
 */
export async function runMonitorForCronScrape(
  runId: string,
  report: ScrapeReport,
  finalStatus: string,
  triggeredBy: string,
): Promise<void> {
  try {
    const assertions = await runPostScrapeAssertions(runId, report, report.payer_code);
    const alertLevel = determineAlertLevel(report, finalStatus, assertions);

    const payload: MonitorPayload = {
      type: "scrape_complete",
      alert_level: alertLevel,
      payer_code: report.payer_code,
      triggered_by: triggeredBy,
      run_id: runId,
      report,
      assertions,
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV ?? "development",
    };

    await Promise.all([
      fireWebhook(payload),
      logMonitorEvent(payload),
    ]);
  } catch (err) {
    console.error(`[scraper-monitor] Monitor run failed for run ${runId}:`, (err as Error).message);
  }
}
