/**
 * Scraper Cron — Scheduled scraper + monitoring
 *
 * Daily   03:00 UTC  — run scrapePayerDocuments for every registered payer,
 *                      then fire post-scrape SQL assertions + webhook alert.
 * Weekly  Sun 03:30  — run synthetic E2E canary test + webhook alert.
 *
 * Double-fire guards prevent re-running within the same UTC day / week.
 * All monitoring is handled by server/services/scraper-monitor.ts.
 */

import { scrapePayerDocuments } from "./scrape-payer-documents";
import { runMonitorForCronScrape, runWeeklySyntheticTest, fireWebhook, logMonitorEvent } from "../services/scraper-monitor";

const DAILY_HOUR_UTC  = 3;   // 3:00 AM UTC
const WEEKLY_HOUR_UTC = 3;   // 3:00 AM UTC on Sunday
const WEEKLY_MIN_UTC  = 30;  // 3:30 AM UTC on Sunday (offset from daily)
const CHECK_INTERVAL_MS = 60 * 1000; // check every minute

// Keys to prevent double-fires
let lastDailyDate = "";     // "YYYY-MM-DD"
let lastWeeklyKey = "";     // "YYYY-WW"  (ISO week)

// Running guards
let dailyRunning  = false;
let weeklyRunning = false;

/** Return ISO week string "YYYY-WW" for a Date */
function isoWeekKey(d: Date): string {
  const jan4 = new Date(d.getUTCFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const weekNum = Math.ceil((((d.getTime() - startOfWeek1.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

// ── SCRAPERS list ─────────────────────────────────────────────────────────────
// Must stay in sync with the SCRAPERS map in scrape-payer-documents.ts.
const CRON_PAYERS = ["uhc"];

// ── Daily scrape ──────────────────────────────────────────────────────────────

async function runDailyScrapes() {
  if (dailyRunning) return;
  dailyRunning = true;
  const todayKey = new Date().toISOString().split("T")[0];
  lastDailyDate = todayKey;
  console.log(`[scraper-cron] Daily scrape starting (${todayKey}) — payers: ${CRON_PAYERS.join(", ")}`);

  for (const payerCode of CRON_PAYERS) {
    try {
      console.log(`[scraper-cron] Scraping ${payerCode}...`);
      const report = await scrapePayerDocuments(payerCode, {
        triggeredBy: "cron",
        allowFallback: true,
      });

      // Determine final status from report (mirrors job logic)
      const finalStatus = report.errors.length === 0 ? "success"
        : report.documents_new > 0 || report.documents_updated > 0 ? "partial"
        : "failed";

      console.log(`[scraper-cron] ${payerCode} done — status=${finalStatus} new=${report.documents_new} updated=${report.documents_updated} errors=${report.errors.length}`);

      // Resolve run_id from the most recent scrape_runs row for this payer
      const { pool } = await import("../db");
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM scrape_runs WHERE payer_code=$1 AND triggered_by='cron' ORDER BY started_at DESC LIMIT 1`,
        [payerCode]
      );
      const runId = rows[0]?.id ?? `cron-${Date.now()}`;

      await runMonitorForCronScrape(runId, report, finalStatus, "cron");

    } catch (err) {
      console.error(`[scraper-cron] ${payerCode} scrape failed:`, (err as Error).message);
    }
  }

  dailyRunning = false;
  console.log(`[scraper-cron] Daily cycle complete.`);
}

// ── Weekly synthetic test ─────────────────────────────────────────────────────

async function runWeeklyTest() {
  if (weeklyRunning) return;
  weeklyRunning = true;
  const weekKey = isoWeekKey(new Date());
  lastWeeklyKey = weekKey;
  console.log(`[scraper-cron] Weekly synthetic E2E test starting (${weekKey})...`);

  try {
    const payload = await runWeeklySyntheticTest("uhc");
    await Promise.all([
      fireWebhook(payload),
      logMonitorEvent(payload),
    ]);
    console.log(`[scraper-cron] Weekly synthetic test complete — alert_level=${payload.alert_level}`);
  } catch (err) {
    console.error(`[scraper-cron] Weekly synthetic test error:`, (err as Error).message);
  }

  weeklyRunning = false;
}

// ── Tick (runs every minute) ──────────────────────────────────────────────────

async function tick() {
  const now = new Date();
  const hourUTC = now.getUTCHours();
  const minUTC  = now.getUTCMinutes();
  const todayKey = now.toISOString().split("T")[0];
  const weekKey  = isoWeekKey(now);
  const dayOfWeek = now.getUTCDay(); // 0 = Sunday

  // Daily scrape: fire at DAILY_HOUR_UTC:00 UTC, any day
  if (hourUTC === DAILY_HOUR_UTC && minUTC === 0 && lastDailyDate !== todayKey && !dailyRunning) {
    runDailyScrapes().catch(err => console.error("[scraper-cron] Daily run error:", err.message));
  }

  // Weekly synthetic test: fire at WEEKLY_HOUR_UTC:WEEKLY_MIN_UTC UTC on Sunday
  if (
    dayOfWeek === 0 &&
    hourUTC === WEEKLY_HOUR_UTC &&
    minUTC === WEEKLY_MIN_UTC &&
    lastWeeklyKey !== weekKey &&
    !weeklyRunning
  ) {
    runWeeklyTest().catch(err => console.error("[scraper-cron] Weekly test error:", err.message));
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

let cronInterval: ReturnType<typeof setInterval> | null = null;

export function startScraperCron(): void {
  if (cronInterval) return; // already started
  cronInterval = setInterval(() => { tick().catch(() => {}); }, CHECK_INTERVAL_MS);
  console.log(`[scraper-cron] Scheduled scraper cron started — daily at ${DAILY_HOUR_UTC}:00 UTC, weekly synthetic test Sunday ${WEEKLY_HOUR_UTC}:${String(WEEKLY_MIN_UTC).padStart(2,"0")} UTC`);
}

/**
 * Manual trigger: run all daily scrapes immediately (for admin use / testing).
 * Returns after all payers are scraped.
 */
export async function triggerDailyScrapeNow(): Promise<void> {
  await runDailyScrapes();
}

/**
 * Manual trigger: run the weekly synthetic test immediately.
 */
export async function triggerSyntheticTestNow(): Promise<void> {
  weeklyRunning = false; // allow re-run on manual trigger
  await runWeeklyTest();
}
