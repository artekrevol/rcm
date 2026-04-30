/**
 * Daily Cron — Timely Filing Guardian + PCP Referral Maintenance
 * Fires at 6:00 AM UTC:
 *   1. evaluateAllActiveClaims() — timely filing status
 *   2. maintainReferralStatuses() — expire/use-up stale referrals
 * Double-fire guard: records last run date in memory.
 */

import { evaluateAllActiveClaims, sendEmailDigests } from "../services/timely-filing-guardian";
import { pool } from "../db";

let lastRunDate = "";
let running = false;

const TARGET_HOUR_UTC = 6; // 6 AM UTC
const CHECK_INTERVAL_MS = 60 * 1000; // check every minute

/** Update pcp_referrals: mark expired or used-up records */
async function maintainReferralStatuses(): Promise<{ expired: number; usedUp: number }> {
  const today = new Date().toISOString().split("T")[0];
  const expiredRes = await pool.query(
    `UPDATE pcp_referrals
     SET status = 'expired'
     WHERE status = 'active'
       AND expiration_date IS NOT NULL
       AND expiration_date < $1
     RETURNING id`,
    [today]
  );
  const usedUpRes = await pool.query(
    `UPDATE pcp_referrals
     SET status = 'used_up'
     WHERE status = 'active'
       AND visits_authorized IS NOT NULL
       AND visits_used >= visits_authorized
     RETURNING id`
  );
  return { expired: expiredRes.rowCount ?? 0, usedUp: usedUpRes.rowCount ?? 0 };
}

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

    // ── Referral status maintenance ─────────────────────────────────────────
    const refStats = await maintainReferralStatuses();
    console.log(`[PCP-Referrals] Status maintenance: expired=${refStats.expired}, used_up=${refStats.usedUp}`);
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
