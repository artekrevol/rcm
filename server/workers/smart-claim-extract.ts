/**
 * Smart Claim background worker.
 * Orchestrates: S3 upload → Textract extraction → parsing → conflict detection → validation.
 * Pure side-effect: updates smart_claim_drafts row, never touches claims/patients tables.
 */

import { pool } from "../db.js";
import { startVaReferralExtraction, pollVaReferralExtraction, extractQbInvoice, parseBlocks } from "../services/extraction/textract-extractor.js";
import { parseVaReferral } from "../services/extraction/va-referral-parser.js";
import { parseQbInvoice } from "../services/extraction/qb-invoice-parser.js";
import { getPdfFromS3 } from "../services/storage/s3-uploader.js";

// ─── Backoff schedule (ms) ───────────────────────────────────────────────────
const POLL_BACKOFF_MS = [5000, 5000, 10000, 10000, 15000, 30000, 60000];
const MAX_POLL_MS = 5 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Conflict detection ───────────────────────────────────────────────────────

interface Conflict {
  type: string;
  severity: "error" | "warning";
  description: string;
  resolution_options: Array<{ label: string; value: string }>;
  field?: string;
}

function detectConflicts(
  va: ReturnType<typeof parseVaReferral>,
  qb: ReturnType<typeof parseQbInvoice>,
  existingPatient: Record<string, any> | null,
  existingAuth: Record<string, any> | null
): Conflict[] {
  const conflicts: Conflict[] = [];

  const authExpDate = va.authorization.expiration_date ? new Date(va.authorization.expiration_date) : null;
  const authIssueDate = va.authorization.issue_date ? new Date(va.authorization.issue_date) : null;

  // DOS after auth expiration
  for (const line of qb.line_items) {
    const dos = new Date(line.service_date);
    if (authExpDate && dos > authExpDate) {
      conflicts.push({
        type: "dos_after_expiration",
        severity: "error",
        description: `Service date ${line.service_date} is after authorization expiration ${va.authorization.expiration_date}.`,
        field: "service_date",
        resolution_options: [
          { label: "Drop these lines from the claim", value: "drop_lines" },
          { label: "Cancel — this is the wrong invoice", value: "cancel" },
        ],
      });
      break;
    }

    // DOS before auth issue date
    if (authIssueDate && dos < authIssueDate) {
      conflicts.push({
        type: "dos_before_issue",
        severity: "warning",
        description: `Service date ${line.service_date} is before authorization issue date ${va.authorization.issue_date}.`,
        field: "service_date",
        resolution_options: [
          { label: "Proceed per operations rule", value: "proceed" },
          { label: "Cancel — this is the wrong invoice", value: "cancel" },
        ],
      });
      break;
    }
  }

  // Customer name fuzzy match
  const vaName = `${va.patient.first_name} ${va.patient.last_name}`.toLowerCase().trim();
  const qbName = qb.customer_name.toLowerCase().trim();
  const similarity = levenshteinSimilarity(vaName, qbName);
  if (similarity < 0.7) {
    conflicts.push({
      type: "name_mismatch",
      severity: "error",
      description: `Invoice customer name does not match VA patient name (similarity: ${Math.round(similarity * 100)}%).`,
      field: "customer_name",
      resolution_options: [
        { label: "Same patient — proceed", value: "proceed" },
        { label: "Wrong invoice — re-upload", value: "cancel" },
      ],
    });
  }

  // Existing patient demographics differ
  if (existingPatient) {
    const existingDob = existingPatient.dob
      ? new Date(existingPatient.dob).toISOString().slice(0, 10)
      : null;
    if (existingDob && existingDob !== va.patient.dob) {
      conflicts.push({
        type: "patient_dob_differs",
        severity: "warning",
        description: `Existing patient record has DOB ${existingDob}, referral has ${va.patient.dob}.`,
        field: "dob",
        resolution_options: [
          { label: "Update existing record", value: "update_existing" },
          { label: "Keep existing record", value: "keep_existing" },
        ],
      });
    }
  }

  // Existing auth parameters differ
  if (existingAuth && va.authorization.expiration_date) {
    const existingExpDate = existingAuth.expiration_date
      ? new Date(existingAuth.expiration_date).toISOString().slice(0, 10)
      : null;
    if (existingExpDate && existingExpDate !== va.authorization.expiration_date) {
      conflicts.push({
        type: "auth_expiration_differs",
        severity: "warning",
        description: `Existing auth has expiration ${existingExpDate}, referral has ${va.authorization.expiration_date}.`,
        field: "expiration_date",
        resolution_options: [
          { label: "Update existing authorization", value: "update_existing" },
          { label: "Keep existing authorization", value: "keep_existing" },
        ],
      });
    }
  }

  return conflicts;
}

function levenshteinSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  const dist = dp[m][n];
  return 1 - dist / Math.max(m, n);
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function setDraftStatus(
  draftId: string,
  orgId: string,
  status: string,
  extra: Record<string, any> = {}
): Promise<void> {
  const sets = ["status = $3", "updated_at = NOW()"];
  const values: any[] = [draftId, orgId, status];
  let idx = 4;

  for (const [key, val] of Object.entries(extra)) {
    sets.push(`${key} = $${idx++}`);
    values.push(typeof val === "object" ? JSON.stringify(val) : val);
  }

  await pool.query(
    `UPDATE smart_claim_drafts SET ${sets.join(", ")} WHERE id = $1 AND organization_id = $2`,
    values
  );
}

// ─── Main worker function ─────────────────────────────────────────────────────

export async function runSmartClaimExtraction(draftId: string, orgId: string): Promise<void> {
  try {
    // Load draft
    const { rows } = await pool.query(
      `SELECT * FROM smart_claim_drafts WHERE id = $1 AND organization_id = $2`,
      [draftId, orgId]
    );
    if (!rows.length) throw new Error(`Draft not found: field=draft_id`);
    const draft = rows[0];

    await setDraftStatus(draftId, orgId, "processing");

    // ── Step 1: Start Textract async for VA referral ──────────────────────────
    let vaJobId = draft.textract_va_job_id as string | null;
    if (!vaJobId) {
      vaJobId = await startVaReferralExtraction(draft.va_referral_s3_key);
      await setDraftStatus(draftId, orgId, "processing", {
        textract_va_job_id: vaJobId,
      });
    }

    // ── Step 2: Extract QB invoice (sync) ────────────────────────────────────
    const qbPdfBytes = await getPdfFromS3(draft.qb_invoice_s3_key);
    const qbTextract = await extractQbInvoice(qbPdfBytes);
    const qbExtraction = parseQbInvoice(qbTextract);

    // ── Step 3: Poll VA Textract ──────────────────────────────────────────────
    let vaResult: Awaited<ReturnType<typeof pollVaReferralExtraction>> = "IN_PROGRESS";
    const deadline = Date.now() + MAX_POLL_MS;
    let pollIdx = 0;

    while (vaResult === "IN_PROGRESS" && Date.now() < deadline) {
      const waitMs = POLL_BACKOFF_MS[Math.min(pollIdx, POLL_BACKOFF_MS.length - 1)];
      await sleep(waitMs);
      pollIdx++;
      vaResult = await pollVaReferralExtraction(vaJobId);
    }

    if (vaResult === "IN_PROGRESS") {
      throw new Error("Textract VA referral extraction timed out after 5 minutes");
    }

    const vaExtraction = parseVaReferral(vaResult);

    // ── Step 4: Dedup lookups (tenant-scoped) ─────────────────────────────────
    let existingPatient: Record<string, any> | null = null;
    if (vaExtraction.patient.edipi) {
      const { rows: patRows } = await pool.query(
        `SELECT * FROM patients WHERE member_id = $1 AND organization_id = $2 LIMIT 1`,
        [vaExtraction.patient.edipi, orgId]
      );
      existingPatient = patRows[0] ?? null;
    }

    let existingAuth: Record<string, any> | null = null;
    if (vaExtraction.authorization.auth_number) {
      const { rows: authRows } = await pool.query(
        `SELECT * FROM prior_authorizations WHERE auth_number = $1 AND organization_id = $2 LIMIT 1`,
        [vaExtraction.authorization.auth_number, orgId]
      );
      existingAuth = authRows[0] ?? null;
    }

    // ── Step 5: Conflict detection ────────────────────────────────────────────
    const conflicts = detectConflicts(vaExtraction, qbExtraction, existingPatient, existingAuth);

    // ── Step 6: Validation (using validation engine against prospective claim) ─
    let validationResult: Record<string, any> | null = null;
    try {
      const { rows: payerRows } = await pool.query(
        `SELECT id FROM payers WHERE payer_id = $1 AND organization_id = $2 LIMIT 1`,
        ["TWVACCN", orgId]
      );
      const { rows: provRows } = await pool.query(
        `SELECT id FROM providers WHERE organization_id = $1 ORDER BY created_at ASC LIMIT 1`,
        [orgId]
      );

      if (payerRows.length && provRows.length) {
        const prospectiveClaimId = crypto.randomUUID();
        const prospectiveEncounterId = crypto.randomUUID();
        const now = new Date();

        const serviceLines = qbExtraction.line_items.map((li) => ({
          code: vaExtraction.suggested_hcpcs,
          hcpcsCode: vaExtraction.suggested_hcpcs,
          units: Math.round(li.hours * 4), // 15-min units
          charge: li.total,
          modifier: "",
          description: li.description,
          service_date: li.service_date,
          diagnosisPointers: "A",
        }));

        await pool.query(
          `INSERT INTO encounters (id, patient_id, service_type, facility_type, admission_type, expected_start_date, organization_id, created_at)
           VALUES ($1, $2, 'Home Health', 'Home', 'Elective', $3, $4, $5)`,
          [
            prospectiveEncounterId,
            existingPatient?.id ?? "00000000-0000-0000-0000-000000000000",
            qbExtraction.line_items[0]?.service_date ?? now.toISOString().slice(0, 10),
            orgId,
            now,
          ]
        );

        await pool.query(
          `INSERT INTO claims (id, organization_id, patient_id, encounter_id, payer, payer_id, provider_id,
             service_date, place_of_service, icd10_primary, authorization_number, amount, status,
             service_lines, cpt_codes, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'12',$9,$10,$11,'draft',$12::jsonb,$13::jsonb,NOW(),NOW())`,
          [
            prospectiveClaimId,
            orgId,
            existingPatient?.id ?? "00000000-0000-0000-0000-000000000000",
            prospectiveEncounterId,
            "VA Community Care",
            payerRows[0].id,
            provRows[0].id,
            qbExtraction.line_items[0]?.service_date ?? now.toISOString().slice(0, 10),
            vaExtraction.diagnosis.primary_icd10_code,
            vaExtraction.authorization.auth_number,
            qbExtraction.services_rendered_total,
            JSON.stringify(serviceLines),
            JSON.stringify([vaExtraction.suggested_hcpcs]),
          ]
        );

        const { runValidation } = await import("../services/validation/engine/runner.js");
        validationResult = await runValidation(prospectiveClaimId, orgId, {});

        // Clean up the prospective claim — it was only for validation
        await pool.query(`DELETE FROM claims WHERE id = $1`, [prospectiveClaimId]);
        await pool.query(`DELETE FROM encounters WHERE id = $1`, [prospectiveEncounterId]);
      }
    } catch (validationErr: any) {
      console.error(`[smart-claim-worker] Validation step failed for field=draft_id:`, validationErr?.message ?? validationErr);
    }

    // ── Step 7: Persist results ───────────────────────────────────────────────
    const extractedData = {
      va: vaExtraction,
      qb: qbExtraction,
      existing_patient_id: existingPatient?.id ?? null,
      existing_auth_id: existingAuth?.id ?? null,
      patient_match_status: existingPatient
        ? "existing-match"
        : "new-patient",
    };

    const confidenceLog = {
      va: vaExtraction.confidence,
      qb: qbExtraction.confidence,
    };

    await setDraftStatus(draftId, orgId, "ready", {
      raw_textract_va: vaResult,
      raw_textract_qb: qbTextract,
      extracted_data: extractedData,
      conflicts: conflicts,
      validation_result: validationResult,
      confidence_log: confidenceLog,
    });
  } catch (err: any) {
    console.error(`[smart-claim-worker] Extraction failed for field=draft_id:`, err?.message ?? err);
    await setDraftStatus(draftId, orgId, "error", {
      error_message: err?.message ?? "Unknown error",
    }).catch(() => {});
    throw err;
  }
}
