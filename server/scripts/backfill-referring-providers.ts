/**
 * Backfill Referring Providers
 * ─────────────────────────────
 * Scans prior_authorizations for free-text referring provider name/NPI data,
 * then for each unique value:
 *   (a) If the NPI is valid → create a 'verified' referring_providers row
 *   (b) Else → create a 'pending' row with the raw text as notes
 *
 * Outputs two CSV files:
 *   - auto-resolved.csv  (verified rows created)
 *   - needs-review.csv   (pending rows needing NPI lookup)
 *
 * Usage:
 *   npx tsx server/scripts/backfill-referring-providers.ts [--dry-run] [--org-id <uuid>]
 *
 * Options:
 *   --dry-run   Print what would be done without writing to DB
 *   --org-id    Limit to a specific organization UUID
 */

import { randomUUID } from "crypto";
import { pool } from "../db";
import { validateNPI } from "../../shared/npi-validation";
import { writeFileSync } from "fs";
import { join } from "path";

const isDryRun = process.argv.includes("--dry-run");
const orgIdIdx = process.argv.indexOf("--org-id");
const targetOrgId = orgIdIdx !== -1 ? process.argv[orgIdIdx + 1] : null;

function csvRow(cells: (string | null | undefined)[]): string {
  return cells.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",");
}

interface PaRow {
  id: string;
  organization_id: string;
  referring_provider_name: string | null;
  referring_provider_npi: string | null;
}

interface ResolvedEntry {
  org_id: string;
  pa_id: string;
  name: string;
  npi: string;
  rp_id: string | null;
}

interface PendingEntry {
  org_id: string;
  pa_id: string;
  raw_name: string;
  raw_npi: string;
  reason: string;
}

async function main() {
  console.log(`[backfill] Starting${isDryRun ? " (DRY RUN)" : ""}${targetOrgId ? ` for org ${targetOrgId}` : " for all orgs"}`);

  const orgFilter = targetOrgId ? `AND pa.organization_id = '${targetOrgId}'` : "";

  // Collect prior_auth rows with free-text referring provider data
  const { rows: paRows } = await pool.query<PaRow>(`
    SELECT
      pa.id,
      pa.organization_id,
      pa.referring_provider_name,
      pa.referring_provider_npi
    FROM prior_authorizations pa
    WHERE (pa.referring_provider_name IS NOT NULL OR pa.referring_provider_npi IS NOT NULL)
      AND pa.referring_provider_id IS NULL
      ${orgFilter}
    ORDER BY pa.organization_id, pa.submitted_at
  `);

  console.log(`[backfill] Found ${paRows.length} prior_auth rows with free-text referring provider data`);

  const resolved: ResolvedEntry[] = [];
  const pending: PendingEntry[] = [];

  // Deduplicate by (organization_id, npi or name)
  const processedKeys = new Set<string>();
  const rpIdCache = new Map<string, string>(); // cache: `${org_id}:${npi_or_name}` → rp.id

  for (const pa of paRows) {
    const rawName = (pa.referring_provider_name || "").trim();
    const rawNpi = (pa.referring_provider_npi || "").replace(/\D/g, "").trim();
    const dedupeKey = `${pa.organization_id}:${rawNpi || rawName}`;

    // Try to link to already-processed RP
    if (rpIdCache.has(dedupeKey)) {
      if (!isDryRun) {
        await pool.query(
          `UPDATE prior_authorizations SET referring_provider_id = $1 WHERE id = $2`,
          [rpIdCache.get(dedupeKey), pa.id]
        ).catch(() => {});
      }
      continue;
    }

    if (processedKeys.has(dedupeKey)) continue;
    processedKeys.add(dedupeKey);

    // Check if an RP already exists for this org+NPI (idempotent)
    if (rawNpi) {
      const { rows: existing } = await pool.query(
        `SELECT id FROM referring_providers WHERE tenant_id = $1 AND npi = $2 LIMIT 1`,
        [pa.organization_id, rawNpi]
      );
      if (existing.length) {
        rpIdCache.set(dedupeKey, existing[0].id);
        resolved.push({ org_id: pa.organization_id, pa_id: pa.id, name: rawName, npi: rawNpi, rp_id: existing[0].id });
        if (!isDryRun) {
          await pool.query(`UPDATE prior_authorizations SET referring_provider_id = $1 WHERE id = $2`, [existing[0].id, pa.id]).catch(() => {});
        }
        continue;
      }
    }

    // Decide: valid NPI → verified; else → pending
    const isValidNpi = rawNpi.length === 10 && validateNPI(rawNpi);
    const nameParts = rawName.split(/[\s,]+/).filter(Boolean);
    const firstName = nameParts.length >= 2 ? nameParts[0] : "Unknown";
    const lastName = nameParts.length >= 2 ? nameParts.slice(1).join(" ") : (rawName || "Provider");

    if (isValidNpi) {
      const newId = randomUUID();
      if (!isDryRun) {
        await pool.query(
          `INSERT INTO referring_providers (id, tenant_id, first_name, last_name, npi, verification_status, provider_type, notes)
           VALUES ($1,$2,$3,$4,$5,'verified','1',$6)
           ON CONFLICT DO NOTHING`,
          [newId, pa.organization_id, firstName, lastName, rawNpi, `Auto-backfilled from PA ${pa.id}`]
        );
        await pool.query(`UPDATE prior_authorizations SET referring_provider_id = $1 WHERE id = $2`, [newId, pa.id]).catch(() => {});
      }
      rpIdCache.set(dedupeKey, newId);
      resolved.push({ org_id: pa.organization_id, pa_id: pa.id, name: rawName, npi: rawNpi, rp_id: isDryRun ? null : newId });
    } else {
      const newId = randomUUID();
      if (!isDryRun) {
        await pool.query(
          `INSERT INTO referring_providers (id, tenant_id, first_name, last_name, npi, va_composite_id, verification_status, provider_type, notes)
           VALUES ($1,$2,$3,$4,NULL,$5,'pending','1',$6)
           ON CONFLICT DO NOTHING`,
          [newId, pa.organization_id, firstName, lastName,
           /^\d{3}[_-]\d{6,8}$/.test(rawNpi) ? rawNpi : null,
           `Auto-backfilled from PA ${pa.id}; raw="${rawName}"; raw_npi="${rawNpi}"`]
        );
      }
      rpIdCache.set(dedupeKey, newId);
      pending.push({ org_id: pa.organization_id, pa_id: pa.id, raw_name: rawName, raw_npi: rawNpi, reason: !rawNpi ? "no NPI" : "invalid NPI" });
    }
  }

  // Write CSVs
  const outDir = join(process.cwd(), "server", "scripts", "backfill-output");
  try {
    const fs = await import("fs");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  } catch {}

  const resolvedCsv = [
    csvRow(["org_id", "pa_id", "name", "npi", "rp_id"]),
    ...resolved.map(r => csvRow([r.org_id, r.pa_id, r.name, r.npi, r.rp_id])),
  ].join("\n");

  const pendingCsv = [
    csvRow(["org_id", "pa_id", "raw_name", "raw_npi", "reason"]),
    ...pending.map(p => csvRow([p.org_id, p.pa_id, p.raw_name, p.raw_npi, p.reason])),
  ].join("\n");

  writeFileSync(join(outDir, "auto-resolved.csv"), resolvedCsv);
  writeFileSync(join(outDir, "needs-review.csv"), pendingCsv);

  console.log(`\n[backfill] Done${isDryRun ? " (DRY RUN — no DB writes)" : ""}`);
  console.log(`  Auto-resolved (verified):  ${resolved.length}`);
  console.log(`  Needs review  (pending):   ${pending.length}`);
  console.log(`  CSVs written to: ${outDir}`);

  await pool.end();
}

main().catch(err => {
  console.error("[backfill] Fatal error:", err);
  process.exit(1);
});
