/**
 * Backfill risk evaluation + rules snapshot for all existing claims.
 *
 * Idempotent: safe to re-run. Claims already evaluated (last_risk_evaluation_at IS NOT NULL)
 * are still re-evaluated so stale data gets refreshed.
 *
 * Usage:
 *   PRODUCTION_DATABASE_URL=... npx tsx scripts/backfill-risk-evaluation.ts
 *   # or against dev DB:
 *   npx tsx scripts/backfill-risk-evaluation.ts
 */

import { Pool } from "pg";
import { evaluateClaim, scoreViolations } from "../server/services/rules-engine";

const connStr = process.env.PRODUCTION_DATABASE_URL || process.env.DATABASE_URL;
if (!connStr) {
  console.error("ERROR: neither PRODUCTION_DATABASE_URL nor DATABASE_URL is set");
  process.exit(1);
}

const pool = new Pool({ connectionString: connStr, ssl: connStr.includes("railway") ? { rejectUnauthorized: false } : undefined });

async function run() {
  const targetDb = connStr!.includes("railway") ? "PRODUCTION (railway)" : "development";
  console.log(`\n[backfill] Connecting to ${targetDb}`);

  // Fetch all claims with their patients
  const { rows: claims } = await pool.query<any>(`
    SELECT
      c.id, c.organization_id, c.patient_id, c.payer_id, c.payer,
      c.plan_product, c.service_date, c.service_lines,
      c.icd10_primary, c.icd10_secondary, c.authorization_number,
      c.place_of_service, c.pcp_referral_check_status,
      c.last_risk_evaluation_at,
      p.member_id, p.dob, p.first_name, p.last_name,
      p.plan_product AS patient_plan_product,
      p.vob_verified
    FROM claims c
    LEFT JOIN patients p ON p.id = c.patient_id
    ORDER BY c.created_at ASC
  `);

  // Get NCCI version once
  const { rows: ncciRows } = await pool.query<{ latest: string | null }>(
    `SELECT MAX(ncci_version) AS latest FROM cci_edits`
  ).catch(() => ({ rows: [{ latest: null }] }));
  const ncciVersion: string | null = ncciRows[0]?.latest || null;

  // Get approved extraction items once (payer-agnostic for backfill)
  const { rows: approvedRules } = await pool.query<any>(`
    SELECT mei.id, mei.section_type, mei.extracted_json, mei.reviewed_by, mei.reviewed_at,
           pm.payer_id AS manual_payer_id
    FROM manual_extraction_items mei
    JOIN payer_source_documents pm ON pm.id = mei.source_document_id
    WHERE mei.review_status = 'approved'
    ORDER BY mei.reviewed_at DESC
  `).catch(() => ({ rows: [] }));

  console.log(`[backfill] ${claims.length} claims to process | NCCI version: ${ncciVersion ?? "none"} | ${approvedRules.length} approved rules`);

  let ok = 0, failed = 0;
  const errors: Array<{ claimId: string; error: string }> = [];

  for (const claim of claims) {
    try {
      const rawServiceLines: any[] = claim.service_lines || [];
      const serviceLines = rawServiceLines.map((sl: any) => ({
        code: (sl.hcpcs_code || sl.code || "").trim(),
        modifier: sl.modifier || "",
        units: parseFloat(sl.units) || 0,
        totalCharge: parseFloat(sl.totalCharge || sl.total_charge) || 0,
      }));

      const ctx = {
        claimId: claim.id,
        organizationId: claim.organization_id,
        patientId: claim.patient_id,
        payerId: claim.payer_id || null,
        payerName: claim.payer || "",
        planProduct: (claim.plan_product || claim.patient_plan_product || null) as any,
        serviceDate: claim.service_date ? new Date(claim.service_date) : null,
        serviceLines,
        icd10Primary: claim.icd10_primary || "",
        icd10Secondary: Array.isArray(claim.icd10_secondary) ? claim.icd10_secondary : [],
        authorizationNumber: claim.authorization_number || null,
        placeOfService: claim.place_of_service || "11",
        memberId: claim.member_id || null,
        patientDob: claim.dob ? new Date(claim.dob) : null,
        patientFirstName: claim.first_name || null,
        patientLastName: claim.last_name || null,
        testMode: false,
        pcpReferralCheckStatus: (claim.pcp_referral_check_status || null) as any,
      };

      const violations = await evaluateClaim(ctx);

      // Add VOB info factor (mirrors the /risk route logic)
      const allFactors: any[] = [...violations];
      if (!claim.vob_verified) {
        allFactors.push({
          ruleType: "data_quality", severity: "info",
          message: "Benefits (VOB) not yet verified for this patient.",
          fixSuggestion: "Run insurance verification before submitting.",
          ruleId: null, sourcePage: null, sourceQuote: null, payerSpecific: false,
        });
      }

      const { riskScore } = scoreViolations(violations);
      const finalScore = Math.min(riskScore + (allFactors.length - violations.length) * 5, 100);
      const finalStatus: "GREEN" | "YELLOW" | "RED" =
        finalScore >= 71 ? "RED" : finalScore >= 31 ? "YELLOW" : "GREEN";

      // Build snapshot using payer-specific approved rules where available
      const payerRules = approvedRules.filter(
        (r: any) => !claim.payer_id || r.manual_payer_id === claim.payer_id
      );
      const snapshot = {
        snapshot_taken_at: new Date().toISOString(),
        applied_rules: payerRules.map((r: any) => ({
          rule_id: r.id,
          rule_type: r.section_type,
          section_type: r.section_type,
          value: r.extracted_json,
          approved_at: r.reviewed_at,
          approved_by: r.reviewed_by,
        })),
        ncci_version: ncciVersion,
        rules_engine_version: "1.0.0",
      };

      await pool.query(
        `UPDATE claims
         SET last_risk_evaluation_at = NOW(),
             last_risk_factors       = $1::jsonb,
             risk_score              = $2,
             readiness_status        = $3,
             rules_snapshot          = $4::jsonb,
             rules_engine_version    = $5,
             ncci_version_at_creation = $6
         WHERE id = $7`,
        [JSON.stringify(allFactors), finalScore, finalStatus,
         JSON.stringify(snapshot), "1.0.0", ncciVersion, claim.id]
      );

      process.stdout.write(".");
      ok++;
    } catch (err: any) {
      process.stdout.write("E");
      failed++;
      errors.push({ claimId: claim.id, error: err.message });
    }
  }

  console.log(`\n\n[backfill] Done — ${ok} updated, ${failed} failed`);
  if (errors.length) {
    console.error("[backfill] Errors:");
    errors.forEach(e => console.error(`  ${e.claimId}: ${e.error}`));
  }

  // Print verification summary
  const { rows: summary } = await pool.query<any>(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE last_risk_evaluation_at IS NOT NULL) AS evaluated,
      COUNT(*) FILTER (WHERE last_risk_factors IS NOT NULL)       AS with_factors,
      COUNT(*) FILTER (WHERE rules_snapshot IS NOT NULL)          AS with_snapshot
    FROM claims
  `);
  console.log("\n[backfill] Post-run verification:");
  console.table(summary);

  await pool.end();
}

run().catch(err => {
  console.error("[backfill] Fatal:", err.message);
  process.exit(1);
});
