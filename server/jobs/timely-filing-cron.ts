/**
 * Timely Filing Guardian — Daily Cron
 * Fires evaluateAllActiveClaims() once per day at 6:00 AM UTC.
 * Double-fire guard: records last run date in memory — safe across redeploys
 * since the job only does upserts/idempotent writes.
 */

import { evaluateAllActiveClaims, sendEmailDigests } from "../services/timely-filing-guardian";

let lastRunDate = "";
let running = false;

const TARGET_HOUR_UTC = 6; // 6 AM UTC
const CHECK_INTERVAL_MS = 60 * 1000; // check every minute

async function maybeRun() {
  if (running) return; // already running
  const now = new Date();
  const todayKey = now.toISOString().split("T")[0];
  if (now.getUTCHours() !== TARGET_HOUR_UTC) return;
  if (lastRunDate === todayKey) return; // already ran today

  running = true;
  lastRunDate = todayKey;
  console.log(`[TF-Guardian] Daily evaluation starting (${todayKey})...`);
  try {
    const stats = await evaluateAllActiveClaims();
    console.log(
      `[TF-Guardian] Done — evaluated: ${stats.evaluated}, updated: ${stats.updated}, ` +
      `alerts created: ${stats.alertsCreated}, byStatus: ${JSON.stringify(stats.byStatus)}`
    );
    if (stats.payersWithNoRule.length > 0) {
      console.warn(`[TF-Guardian] Payers with no rule: ${stats.payersWithNoRule.join(", ")}`);
    }
    await sendEmailDigests(stats);
  } catch (err: any) {
    console.error("[TF-Guardian] Evaluation failed:", err.message || err);
  } finally {
    running = false;
  }
}

export function startTimelyFilingCron() {
  console.log(`[TF-Guardian] Cron started — will run daily at ${TARGET_HOUR_UTC}:00 UTC`);
  setInterval(maybeRun, CHECK_INTERVAL_MS);
}
