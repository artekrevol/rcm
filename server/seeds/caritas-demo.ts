// Caritas Senior Care end-to-end demo data seed.
//
// DEVELOPMENT SANDBOX ONLY. This populates organization "caritas-org-001" with a
// full Home Health RCM journey (leads -> AI intake calls -> VOB -> patients ->
// episodes -> NOA -> RCD/UTN -> billing periods/visits -> 837I claims -> denial).
// It refuses to run against the Railway/production database.
//
// Run manually:  npx tsx server/seeds/caritas-demo.ts
// It is intentionally NOT wired into app startup so it can never seed production.

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { pool } from "../db";

const ORG_ID = "caritas-org-001";

const REQUIRED_PAYERS = [
  "Medicare Part A & B - Palmetto GBA (JJ/JM)",
  "Humana Gold Plus (HMO)",
];

export async function seedCaritasDemo(): Promise<void> {
  const url = process.env.DATABASE_URL || "";
  if (/rlwy\.net|railway/i.test(url)) {
    throw new Error(
      "[caritas-demo] Refusing to run against a production/Railway database. " +
        "This seed is for the development sandbox only.",
    );
  }

  const { rows: payerRows } = await pool.query(
    `SELECT name FROM payers WHERE organization_id IS NULL AND name = ANY($1::text[])`,
    [REQUIRED_PAYERS],
  );
  if (payerRows.length < REQUIRED_PAYERS.length) {
    throw new Error(
      "[caritas-demo] Required global payers are missing — run the reference-tables " +
        "seed first. Needed: " +
        REQUIRED_PAYERS.join(", "),
    );
  }

  const sqlPath = join(dirname(fileURLToPath(import.meta.url)), "caritas-demo.sql");
  const sql = readFileSync(sqlPath, "utf8");
  await pool.query(sql);

  const { rows } = await pool.query(
    `SELECT 'patients' AS entity, count(*)::int AS n FROM patients WHERE organization_id = $1
     UNION ALL SELECT 'leads', count(*)::int FROM leads WHERE organization_id = $1
     UNION ALL SELECT 'calls', count(*)::int FROM calls WHERE organization_id = $1
     UNION ALL SELECT 'episodes', count(*)::int FROM episodes WHERE organization_id = $1
     UNION ALL SELECT 'noa_filings', count(*)::int FROM noa_filings WHERE organization_id = $1
     UNION ALL SELECT 'pre_claim_reviews', count(*)::int FROM pre_claim_reviews WHERE organization_id = $1
     UNION ALL SELECT 'claims', count(*)::int FROM claims WHERE organization_id = $1
     ORDER BY entity`,
    [ORG_ID],
  );
  const summary = rows.map((r) => `${r.entity}=${r.n}`).join(", ");
  console.log(`[caritas-demo] Seeded ${ORG_ID}: ${summary}`);
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  seedCaritasDemo()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
