/**
 * Timely Filing Guardian Agent
 * Evaluates all active claims against payer-specific timely filing deadlines,
 * writes alerts to timely_filing_alerts, and fires email digests.
 *
 * Prompt 04 — T2, T4, T6
 */

import nodemailer from "nodemailer";

export interface EvaluationStats {
  evaluated: number;
  updated: number;
  alertsCreated: number;
  payersWithNoRule: string[];
  byStatus: Record<string, number>;
}

/** Status from days remaining */
function daysToStatus(days: number): "safe" | "caution" | "urgent" | "critical" | "expired" {
  if (days <= 0) return "expired";
  if (days <= 7) return "critical";
  if (days <= 30) return "urgent";
  if (days <= 60) return "caution";
  return "safe";
}

/** Status severity order (lower = more urgent) */
const SEVERITY_ORDER: Record<string, number> = {
  expired: 0, critical: 1, urgent: 2, caution: 3, safe: 4,
};

const ALERT_STATUSES = new Set(["caution", "urgent", "critical", "expired"]);
const ACTIVE_CLAIM_STATUSES = ["draft", "submitted", "pending", "denied", "resubmitted"];
const DEFAULT_FILING_DAYS = 365; // Medicare default

export async function evaluateAllActiveClaims(): Promise<EvaluationStats> {
  const { pool } = await import("../db");
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const stats: EvaluationStats = {
    evaluated: 0,
    updated: 0,
    alertsCreated: 0,
    payersWithNoRule: [],
    byStatus: {},
  };

  // Load all active claims with payer info
  const claimsRes = await pool.query(`
    SELECT
      c.id,
      c.organization_id,
      c.patient_id,
      c.payer_id,
      c.plan_product,
      c.service_date,
      c.timely_filing_status AS prev_status,
      c.status AS claim_status,
      p.name AS payer_name,
      p.timely_filing_days AS payer_filing_days
    FROM claims c
    LEFT JOIN payers p ON p.id = c.payer_id
    WHERE c.status = ANY($1::text[])
      AND c.service_date IS NOT NULL
  `, [ACTIVE_CLAIM_STATUSES]);

  const claims = claimsRes.rows;
  stats.evaluated = claims.length;

  // Build a map of approved manual extraction items for timely filing
  const extractionRes = await pool.query(`
    SELECT
      mei.id AS rule_id,
      pm.payer_id,
      mei.extracted_json,
      mei.raw_snippet,
      mei.applies_to_plan_products
    FROM manual_extraction_items mei
    JOIN payer_manuals pm ON pm.id = mei.manual_id
    WHERE mei.section_type = 'timely_filing'
      AND mei.review_status = 'approved'
      AND pm.payer_id IS NOT NULL
  `);

  // Index: payer_id → array of rules (with optional plan product scope)
  const rulesByPayer: Record<string, Array<{
    ruleId: string;
    filingDays: number | null;
    planProducts: string[] | null;
    snippet: string;
  }>> = {};

  for (const row of extractionRes.rows) {
    const pid = row.payer_id;
    if (!rulesByPayer[pid]) rulesByPayer[pid] = [];
    let filingDays: number | null = null;
    if (row.extracted_json) {
      const j = typeof row.extracted_json === "string"
        ? JSON.parse(row.extracted_json)
        : row.extracted_json;
      filingDays = parseInt(j.days || j.filing_days || j.timely_filing_days || "0", 10) || null;
    }
    rulesByPayer[pid].push({
      ruleId: row.rule_id,
      filingDays,
      planProducts: row.applies_to_plan_products || null,
      snippet: row.raw_snippet || "",
    });
  }

  const payersWithNoRule = new Set<string>();

  for (const claim of claims) {
    // Determine filing days for this claim's payer
    let filingDays: number = DEFAULT_FILING_DAYS;
    let ruleUsed: string | null = null;
    let ruleWasDefault = false;

    if (claim.payer_id && claim.payer_filing_days) {
      filingDays = claim.payer_filing_days;
    }

    // Check manual extraction rules — prefer plan_product match, fall back to universal
    if (claim.payer_id && rulesByPayer[claim.payer_id]?.length) {
      const payerRules = rulesByPayer[claim.payer_id];
      // Try plan-product match first
      let matched = payerRules.find((r) => {
        if (!r.planProducts || r.planProducts.length === 0) return false;
        return r.planProducts.includes(claim.plan_product || "");
      });
      // Fall back to universal rule (no plan product scope)
      if (!matched) {
        matched = payerRules.find((r) => !r.planProducts || r.planProducts.length === 0);
      }
      if (matched && matched.filingDays) {
        filingDays = matched.filingDays;
        ruleUsed = matched.ruleId;
      }
    } else if (!claim.payer_filing_days) {
      // No payer rule and no timely_filing_days on payer record
      ruleWasDefault = true;
      if (claim.payer_name) payersWithNoRule.add(claim.payer_name);
      console.warn(`[TF-Guardian] No timely filing rule for payer "${claim.payer_name}" (${claim.payer_id}) — using Medicare default ${DEFAULT_FILING_DAYS}d`);
    }

    // Calculate deadline and days remaining
    const serviceDate = new Date(claim.service_date);
    serviceDate.setHours(0, 0, 0, 0);
    const deadline = new Date(serviceDate);
    deadline.setDate(deadline.getDate() + filingDays);

    const msPerDay = 1000 * 60 * 60 * 24;
    const daysRemaining = Math.floor((deadline.getTime() - today.getTime()) / msPerDay);
    const newStatus = daysToStatus(daysRemaining);

    const prevStatus = claim.prev_status;
    const deadlineStr = deadline.toISOString().split("T")[0];

    // Update claim timely_filing columns
    await pool.query(`
      UPDATE claims SET
        timely_filing_deadline = $1,
        timely_filing_days_remaining = $2,
        timely_filing_status = $3,
        timely_filing_last_evaluated_at = NOW()
      WHERE id = $4
    `, [deadlineStr, daysRemaining, newStatus, claim.id]);

    stats.updated++;
    stats.byStatus[newStatus] = (stats.byStatus[newStatus] || 0) + 1;

    // ── T6: Activity log if status changed ─────────────────────────────────
    if (prevStatus !== null && prevStatus !== newStatus) {
      await pool.query(`
        INSERT INTO activity_logs
          (id, claim_id, patient_id, activity_type, description, metadata, organization_id)
        VALUES
          (gen_random_uuid()::text, $1, $2, 'timely_filing_update', $3, $4, $5)
      `, [
        claim.id,
        claim.patient_id,
        `Timely Filing status changed from ${prevStatus ?? "unset"} to ${newStatus}. ` +
          `${daysRemaining > 0 ? daysRemaining + " days remaining" : Math.abs(daysRemaining) + " days overdue"} ` +
          `until ${claim.payer_name || "payer"} deadline (${deadlineStr}).` +
          (ruleUsed ? ` Rule source: ${ruleUsed}.` : ruleWasDefault ? " Using Medicare default (365d)." : ""),
        JSON.stringify({ newStatus, prevStatus, daysRemaining, deadline: deadlineStr, ruleId: ruleUsed }),
        claim.organization_id,
      ]).catch((e: any) => console.error("[TF-Guardian] Activity log error:", e.message));
    }

    // ── T2/T4: Create alert if at threshold ────────────────────────────────
    if (ALERT_STATUSES.has(newStatus)) {
      await pool.query(`
        INSERT INTO timely_filing_alerts
          (claim_id, organization_id, alert_status, days_remaining, deadline_date, alert_method)
        VALUES ($1, $2, $3, $4, $5, 'in_app')
        ON CONFLICT (claim_id, alert_status) DO NOTHING
      `, [claim.id, claim.organization_id, newStatus, daysRemaining, deadlineStr])
        .then((r: any) => { if (r.rowCount > 0) stats.alertsCreated++; })
        .catch(() => {});
    }
  }

  stats.payersWithNoRule = Array.from(payersWithNoRule);
  return stats;
}

/** Send email digests after evaluation. Silently skips if no email configured. */
export async function sendEmailDigests(stats: EvaluationStats): Promise<void> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.warn("[TF-Guardian] Email not configured — skipping digests");
    return;
  }

  const { pool } = await import("../db");

  let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;
  try {
    transporter = nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
  } catch (e: any) {
    console.error("[TF-Guardian] Failed to create email transporter:", e.message);
    return;
  }

  const send = async (to: string, subject: string, html: string) => {
    try {
      await transporter!.sendMail({ from: `"Claim Shield Health" <${user}>`, to, subject, html });
    } catch (e: any) {
      console.error(`[TF-Guardian] Email send failed to ${to}:`, e.message);
    }
  };

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const critical = stats.byStatus["critical"] || 0;
  const urgent = stats.byStatus["urgent"] || 0;
  const caution = stats.byStatus["caution"] || 0;
  const expired = stats.byStatus["expired"] || 0;
  const hasCriticalOrUrgent = critical + urgent > 0;

  // Get top 5 most urgent claims for biller digest
  const urgentClaimsRes = await pool.query(`
    SELECT c.id, c.timely_filing_status, c.timely_filing_days_remaining,
           c.timely_filing_deadline, c.organization_id,
           pat.first_name || ' ' || pat.last_name AS patient_name,
           p.name AS payer_name
    FROM claims c
    LEFT JOIN patients pat ON pat.id = c.patient_id
    LEFT JOIN payers p ON p.id = c.payer_id
    WHERE c.timely_filing_status IN ('critical','urgent')
    ORDER BY c.timely_filing_days_remaining ASC NULLS LAST
    LIMIT 5
  `).catch(() => ({ rows: [] }));

  const urgentRows = (urgentClaimsRes as any).rows;
  const urgentRowsHtml = urgentRows.map((r: any) => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${r.patient_name || "—"}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${r.payer_name || "—"}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;color:${r.timely_filing_status === "critical" ? "#dc2626" : "#d97706"};font-weight:600">
        ${r.timely_filing_status?.toUpperCase()}
      </td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${r.timely_filing_days_remaining ?? "—"} days</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${r.timely_filing_deadline || "—"}</td>
    </tr>
  `).join("");

  // ── Biller digest (only if critical/urgent) ──────────────────────────────
  if (hasCriticalOrUrgent) {
    const billersRes = await pool.query(
      `SELECT email FROM users WHERE role IN ('biller') AND is_active = true`
    ).catch(() => ({ rows: [] }));

    const billerEmail = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#1e3a5f">Filing Alerts — ${critical + urgent} claim(s) need attention</h2>
        <p>As of <strong>${today}</strong>:</p>
        <ul>
          ${critical > 0 ? `<li style="color:#dc2626"><strong>${critical} CRITICAL</strong> — ≤ 7 days to deadline</li>` : ""}
          ${urgent > 0 ? `<li style="color:#d97706"><strong>${urgent} URGENT</strong> — 8-30 days to deadline</li>` : ""}
          ${caution > 0 ? `<li style="color:#2563eb"><strong>${caution} CAUTION</strong> — 31-60 days to deadline</li>` : ""}
          ${expired > 0 ? `<li style="color:#111"><strong>${expired} EXPIRED</strong> — past deadline</li>` : ""}
        </ul>
        ${urgentRows.length > 0 ? `
        <h3>Top ${urgentRows.length} Most Urgent</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#f1f5f9">
            <th style="padding:6px 8px;text-align:left">Patient</th>
            <th style="padding:6px 8px;text-align:left">Payer</th>
            <th style="padding:6px 8px;text-align:left">Status</th>
            <th style="padding:6px 8px;text-align:left">Days Left</th>
            <th style="padding:6px 8px;text-align:left">Deadline</th>
          </tr></thead>
          <tbody>${urgentRowsHtml}</tbody>
        </table>` : ""}
        <p style="margin-top:24px">
          <a href="${process.env.APP_URL || "https://app.claimshield.ai"}/billing/filing-alerts"
             style="background:#1e3a5f;color:white;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">
            View Filing Alerts
          </a>
        </p>
      </div>
    `;

    for (const biller of (billersRes as any).rows) {
      await send(biller.email, `Filing Alerts — ${critical + urgent} claims need attention`, billerEmail);
    }
  }

  // ── Admin/RCM manager digest (daily, always sent) ────────────────────────
  const adminsRes = await pool.query(
    `SELECT email FROM users WHERE role IN ('admin','rcm_manager') AND is_active = true`
  ).catch(() => ({ rows: [] }));

  const noRuleList = stats.payersWithNoRule.length > 0
    ? `<h3>Payers Without Rules</h3><ul>${stats.payersWithNoRule.map((p) => `<li>${p}</li>`).join("")}</ul>`
    : "<p>✓ All evaluated payers have timely filing rules configured.</p>";

  const adminEmail = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#1e3a5f">Daily Filing Risk Report — ${today}</h2>
      <h3>Summary</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#f1f5f9">
          <th style="padding:6px 8px;text-align:left">Status</th>
          <th style="padding:6px 8px;text-align:left">Claims</th>
        </tr></thead>
        <tbody>
          <tr><td style="padding:6px 8px;color:#dc2626;font-weight:600">CRITICAL</td><td style="padding:6px 8px">${critical}</td></tr>
          <tr><td style="padding:6px 8px;color:#d97706;font-weight:600">URGENT</td><td style="padding:6px 8px">${urgent}</td></tr>
          <tr><td style="padding:6px 8px;color:#2563eb;font-weight:600">CAUTION</td><td style="padding:6px 8px">${caution}</td></tr>
          <tr><td style="padding:6px 8px;color:#111">EXPIRED</td><td style="padding:6px 8px">${expired}</td></tr>
          <tr><td style="padding:6px 8px;color:#16a34a">SAFE</td><td style="padding:6px 8px">${stats.byStatus["safe"] || 0}</td></tr>
        </tbody>
      </table>
      <p>Total evaluated: ${stats.evaluated} claims. Alerts created (new): ${stats.alertsCreated}.</p>
      ${noRuleList}
      <p style="color:#6b7280;font-size:12px">This report is sent daily. If you stop receiving it, the Guardian cron may have stopped.</p>
    </div>
  `;

  for (const admin of (adminsRes as any).rows) {
    await send(admin.email, `Daily Filing Risk Report — ${new Date().toISOString().split("T")[0]}`, adminEmail);
  }
}
