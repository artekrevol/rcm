/**
 * Backfill payer_manual_extraction_history for items that were approved
 * before the history hook was wired.
 *
 * Idempotent: inserts only for (extraction_id, change_type) pairs that do
 * not already have a history row, so re-running is safe.
 *
 * Usage:
 *   PRODUCTION_DATABASE_URL=... npx tsx scripts/backfill-extraction-history.ts
 */

import { Pool } from "pg";

const connStr = process.env.PRODUCTION_DATABASE_URL || process.env.DATABASE_URL;
if (!connStr) {
  console.error("ERROR: neither PRODUCTION_DATABASE_URL nor DATABASE_URL is set");
  process.exit(1);
}

const pool = new Pool({
  connectionString: connStr,
  ssl: connStr.includes("railway") ? { rejectUnauthorized: false } : undefined,
});

async function run() {
  const targetDb = connStr!.includes("railway") ? "PRODUCTION (railway)" : "development";
  console.log(`\n[backfill-history] Connecting to ${targetDb}`);

  // Detect schema variant: production uses manual_id + payer_manuals;
  // dev uses source_document_id + payer_source_documents.
  const { rows: colCheck } = await pool.query<{ column_name: string }>(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'manual_extraction_items' AND column_name IN ('manual_id','source_document_id')
  `);
  const useManualId = colCheck.some(r => r.column_name === 'manual_id');
  console.log(`[backfill-history] Schema variant: ${useManualId ? 'manual_id (production)' : 'source_document_id (dev)'}`);

  // Fetch all reviewed items with payer name — left-join adapts to schema variant.
  const docJoin = useManualId
    ? `LEFT JOIN payer_manuals pm ON pm.id = mei.manual_id`
    : `LEFT JOIN payer_source_documents pm ON pm.id = mei.source_document_id`;
  const payerNameCol = useManualId ? `pm.payer_name` : `pm.document_name`;
  const docIdCol = useManualId ? `mei.manual_id` : `mei.source_document_id`;

  const { rows: items } = await pool.query<any>(`
    SELECT
      mei.id,
      ${docIdCol} AS doc_id,
      mei.section_type,
      mei.review_status,
      mei.reviewed_by,
      mei.reviewed_at,
      mei.extracted_json,
      mei.raw_snippet,
      mei.notes,
      mei.confidence,
      ${payerNameCol} AS payer_name
    FROM manual_extraction_items mei
    ${docJoin}
    WHERE mei.review_status IN ('approved', 'not_found', 'rejected', 'needs_reverification')
    ORDER BY COALESCE(mei.reviewed_at, '2026-01-01') ASC
  `);

  // Find which items already have a history row so we skip them
  const { rows: existingRows } = await pool.query<{ extraction_id: string; change_type: string }>(`
    SELECT extraction_id, change_type FROM payer_manual_extraction_history
  `);
  const existingSet = new Set(existingRows.map(r => `${r.extraction_id}::${r.change_type}`));

  console.log(`[backfill-history] ${items.length} reviewed items | ${existingSet.size} history rows already exist`);

  const changeTypeMap: Record<string, string> = {
    approved: "approved",
    rejected: "rejected",
    not_found: "rejected",
    needs_reverification: "needs_reverification",
  };

  let inserted = 0, skipped = 0, failed = 0;
  const errors: Array<{ itemId: string; error: string }> = [];

  for (const item of items) {
    const changeType = changeTypeMap[item.review_status] || "edited";
    const key = `${item.id}::${changeType}`;

    if (existingSet.has(key)) {
      skipped++;
      continue;
    }

    try {
      const stateSnapshot = {
        id: item.id,
        doc_id: item.doc_id,
        section_type: item.section_type,
        review_status: item.review_status,
        reviewed_by: item.reviewed_by,
        reviewed_at: item.reviewed_at,
        extracted_json: item.extracted_json,
        raw_snippet: item.raw_snippet,
        notes: item.notes,
        confidence: item.confidence,
      };

      await pool.query(`
        INSERT INTO payer_manual_extraction_history
          (extraction_id, changed_by, changed_at, change_type, state_snapshot, change_notes, payer_name, section_type)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
      `, [
        item.id,
        item.reviewed_by || 'system (backfill)',
        item.reviewed_at || new Date(),
        changeType,
        JSON.stringify(stateSnapshot),
        'Backfill: approval captured retroactively — action pre-dated history hook.',
        item.payer_name || null,
        item.section_type,
      ]);

      process.stdout.write(".");
      inserted++;
    } catch (err: any) {
      process.stdout.write("E");
      failed++;
      errors.push({ itemId: item.id, error: err.message });
    }
  }

  console.log(`\n\n[backfill-history] Done — ${inserted} inserted, ${skipped} skipped (already existed), ${failed} failed`);

  if (errors.length) {
    console.error("[backfill-history] Errors:");
    errors.forEach(e => console.error(`  ${e.itemId}: ${e.error}`));
  }

  // Print verification summary
  const { rows: summary } = await pool.query<any>(`
    SELECT change_type, COUNT(*) AS rows, MAX(changed_at) AS most_recent
    FROM payer_manual_extraction_history
    GROUP BY change_type
    ORDER BY rows DESC
  `);
  console.log("\n[backfill-history] Post-run verification (payer_manual_extraction_history):");
  console.table(summary);

  await pool.end();
}

run().catch(err => {
  console.error("[backfill-history] Fatal:", err.message);
  process.exit(1);
});
