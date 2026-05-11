/**
 * Smart Claim end-to-end smoke test.
 * Bypasses HTTP auth — calls the worker and S3 directly.
 * Uses the ANDERSON fixture (patient 1).
 * Does NOT create any real claims — extraction only.
 *
 * Run: npx tsx scripts/smoke-test-smart-claim.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { pool } from "../server/db.js";
import { uploadPdfToS3, buildS3Key } from "../server/services/storage/s3-uploader.js";
import { runSmartClaimExtraction } from "../server/workers/smart-claim-extract.js";

const FIXTURE_VA = path.resolve("test/fixtures/va-referrals/anderson-va-referral.pdf");
const FIXTURE_QB = path.resolve("test/fixtures/qb-invoices/anderson-qb-invoice.pdf");

async function getTestOrgId(): Promise<string> {
  const { rows } = await pool.query(
    `SELECT id FROM organizations WHERE name ILIKE '%demo%' OR name ILIKE '%caritas%' OR name ILIKE '%chajinel%' ORDER BY created_at ASC LIMIT 1`
  );
  if (!rows.length) throw new Error("No demo org found in DB");
  return rows[0].id;
}

async function main() {
  console.log("=".repeat(60));
  console.log("Smart Claim E2E Smoke Test — ANDERSON fixture");
  console.log("=".repeat(60));
  console.log();

  // ── Step 0: Verify fixtures exist ─────────────────────────────────────────
  if (!fs.existsSync(FIXTURE_VA)) {
    console.error(`FAIL: VA fixture not found at ${FIXTURE_VA}`);
    console.error("Run: npx tsx scripts/generate-smart-claim-fixtures.ts first");
    process.exit(1);
  }
  if (!fs.existsSync(FIXTURE_QB)) {
    console.error(`FAIL: QB fixture not found at ${FIXTURE_QB}`);
    process.exit(1);
  }
  const vaBytes = fs.readFileSync(FIXTURE_VA);
  const qbBytes = fs.readFileSync(FIXTURE_QB);
  console.log(`[step 0] Fixtures loaded — VA: ${vaBytes.byteLength} bytes, QB: ${qbBytes.byteLength} bytes`);

  // ── Step 1: Resolve test org ───────────────────────────────────────────────
  const orgId = await getTestOrgId();
  const draftId = crypto.randomUUID();
  console.log(`[step 1] Using org: ${orgId}`);
  console.log(`[step 1] Draft ID: ${draftId}`);

  // ── Step 2: Upload to S3 ───────────────────────────────────────────────────
  console.log("\n[step 2] Uploading fixtures to S3...");
  const uploadStart = Date.now();

  let vaKey: string;
  let qbKey: string;
  try {
    vaKey = await uploadPdfToS3(vaBytes, orgId, draftId, "va-referral");
    console.log(`[step 2] VA upload OK — key: ${vaKey}`);
    qbKey = await uploadPdfToS3(qbBytes, orgId, draftId, "qb-invoice");
    console.log(`[step 2] QB upload OK — key: ${qbKey}`);
  } catch (err: any) {
    console.error(`[step 2] UPLOAD FAILED: ${err?.message}`);
    await pool.end();
    process.exit(1);
  }

  const uploadMs = Date.now() - uploadStart;
  console.log(`[step 2] Upload complete in ${uploadMs}ms`);

  // ── Step 3: Insert draft record ────────────────────────────────────────────
  console.log("\n[step 3] Creating smart_claim_draft record...");
  await pool.query(
    `INSERT INTO smart_claim_drafts (id, organization_id, user_id, status, va_referral_s3_key, qb_invoice_s3_key, created_at, updated_at)
     VALUES ($1, $2, 'smoke-test', 'uploading', $3, $4, NOW(), NOW())`,
    [draftId, orgId, vaKey!, qbKey!]
  );
  console.log(`[step 3] Draft inserted with status=uploading`);

  // ── Step 4: Run extraction worker directly ─────────────────────────────────
  console.log("\n[step 4] Starting extraction worker...");
  const extractStart = Date.now();

  try {
    await runSmartClaimExtraction(draftId, orgId);
  } catch (err: any) {
    console.error(`[step 4] Worker threw: ${err?.message}`);
    // Don't exit — check DB status below for details
  }

  const extractMs = Date.now() - extractStart;
  console.log(`[step 4] Worker finished in ${(extractMs / 1000).toFixed(1)}s`);

  // ── Step 5: Read final draft state ────────────────────────────────────────
  console.log("\n[step 5] Reading draft result from DB...");
  const { rows } = await pool.query(
    `SELECT id, status, error_message, extracted_data, conflicts, validation_result, confidence_log, created_at, updated_at
     FROM smart_claim_drafts WHERE id = $1`,
    [draftId]
  );

  if (!rows.length) {
    console.error("[step 5] FAIL: Draft row not found in DB after extraction!");
    await pool.end();
    process.exit(1);
  }

  const draft = rows[0];
  const totalMs = Date.now() - uploadStart;

  // ── Step 6: Report ─────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("RESULTS");
  console.log("=".repeat(60));

  console.log(`\nDraft status:        ${draft.status}`);
  console.log(`Total elapsed:       ${(totalMs / 1000).toFixed(1)}s (upload + extraction)`);
  console.log(`Extraction elapsed:  ${(extractMs / 1000).toFixed(1)}s`);

  if (draft.error_message) {
    console.log(`\nError message:       ${draft.error_message}`);
  }

  if (draft.extracted_data) {
    const ed = typeof draft.extracted_data === "string"
      ? JSON.parse(draft.extracted_data)
      : draft.extracted_data;

    const va = ed.va;
    const qb = ed.qb;

    console.log("\n--- VA Referral Extraction (ANDERSON) ---");
    console.log(`Patient name:        ${va?.patient?.first_name} ${va?.patient?.last_name}`);
    console.log(`EDIPI extracted:     ${va?.patient?.edipi || "(empty)"}`);
    console.log(`DOB:                 ${va?.patient?.dob}`);
    console.log(`Auth number:         ${va?.authorization?.auth_number || "(empty)"}`);
    console.log(`SEOC code:           ${va?.authorization?.seoc_code || "(empty)"}`);
    console.log(`Issue date:          ${va?.authorization?.issue_date}`);
    console.log(`Expiration date:     ${va?.authorization?.expiration_date}`);
    console.log(`ICD-10 primary:      ${va?.diagnosis?.primary_icd10_code || "(empty)"}`);
    console.log(`Suggested HCPCS:     ${va?.suggested_hcpcs}`);
    console.log(`Patient match:       ${ed.patient_match_status}`);
    console.log(`Confidence scores:   ${JSON.stringify(ed.va?.confidence ?? {})}`);

    console.log("\n--- QB Invoice Extraction ---");
    console.log(`Customer name:       ${qb?.customer_name || "(empty)"}`);
    console.log(`Invoice number:      ${qb?.invoice_number}`);
    console.log(`Invoice date:        ${qb?.invoice_date}`);
    console.log(`Line items count:    ${qb?.line_items?.length ?? 0}`);
    if (qb?.line_items?.length) {
      for (const li of qb.line_items) {
        console.log(`  ${li.service_date}  ${li.description}  hrs=${li.hours}  rate=$${li.rate}  total=$${li.total}`);
      }
    }
    console.log(`Services total:      $${qb?.services_rendered_total}`);
    console.log(`Grand total:         $${qb?.grand_total}`);
  } else {
    console.log("\nextracted_data: NULL");
  }

  if (draft.conflicts !== null && draft.conflicts !== undefined) {
    const conflicts = typeof draft.conflicts === "string"
      ? JSON.parse(draft.conflicts)
      : draft.conflicts;
    console.log(`\nConflicts detected:  ${conflicts.length}`);
    for (const c of conflicts) {
      console.log(`  [${c.severity.toUpperCase()}] ${c.type}: ${c.description}`);
    }
  } else {
    console.log("\nConflicts:           NULL");
  }

  if (draft.validation_result !== null && draft.validation_result !== undefined) {
    const vr = typeof draft.validation_result === "string"
      ? JSON.parse(draft.validation_result)
      : draft.validation_result;
    console.log(`\nValidation result:   returned (not null)`);
    console.log(`  Risk score:        ${vr?.riskScore ?? vr?.risk_score ?? "(not found)"}`);
    console.log(`  Ready:             ${vr?.ready ?? "(not found)"}`);
    const findings = vr?.findings ?? vr?.issues ?? [];
    console.log(`  Finding count:     ${findings.length}`);
  } else {
    console.log("\nValidation result:   NULL (validation step skipped or failed)");
  }

  // ── Step 7: Cleanup ────────────────────────────────────────────────────────
  console.log("\n[cleanup] Deleting smoke-test draft from DB...");
  await pool.query(`DELETE FROM smart_claim_drafts WHERE id = $1`, [draftId]);
  console.log("[cleanup] Done.");

  console.log("\n" + "=".repeat(60));
  console.log(draft.status === "ready" ? "SMOKE TEST PASSED ✓" : `SMOKE TEST ENDED WITH STATUS: ${draft.status}`);
  console.log("=".repeat(60));

  await pool.end();
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
