/**
 * Backfill referring providers from prior_authorizations free-text columns.
 *
 * Scans prior_authorizations for rows that have referring_provider_name /
 * referring_provider_npi free-text but no referring_provider_id FK yet.
 * For each row it:
 *   (a) Looks up an existing referring_providers row for that tenant by NPI.
 *   (b) If none found, inserts a new row:
 *       – NPI valid  → verification_status='verified'
 *       – NPI absent / invalid → verification_status='pending'
 *   (c) Updates prior_authorizations.referring_provider_id with the resolved UUID.
 *
 * Outputs a CSV report to stdout: auto-resolved vs needs-review.
 *
 * Usage (Replit sandbox — safe, default):
 *   npx tsx scripts/backfill-referring-providers.ts [--dry-run]
 *
 * Usage (Railway production — requires explicit opt-in):
 *   RAILWAY_PRODUCTION_DATABASE_URL must be set; pass --confirm-production.
 *   DATABASE_URL=$RAILWAY_PRODUCTION_DATABASE_URL \
 *     npx tsx scripts/backfill-referring-providers.ts --dry-run --confirm-production
 *
 * Always run --dry-run first. Add --dry-run to preview changes without writing.
 */

import { Pool } from "pg";
import { validateNPI } from "../shared/npi-validation.js";

// ── CLI flags ──────────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes("--dry-run");

// ── Production guard ──────────────────────────────────────────────────────────
const _connStr = process.env.DATABASE_URL ?? "";
if (_connStr.includes("rlwy.net") || _connStr.includes("railway.internal")) {
  if (!process.argv.includes("--confirm-production")) {
    console.error(
      "ERROR: DATABASE_URL targets Railway production (hopper.proxy.rlwy.net).\n" +
      "Re-run with --confirm-production to proceed.\n" +
      "Hard rule: agent-driven scripts must not touch Railway production unattended.\n" +
      "For production data changes, use the Railway database tab manually."
    );
    process.exit(1);
  }
}

// ── DB pool ────────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: _connStr,
  ssl: _connStr.includes("localhost") ? false : { rejectUnauthorized: false },
});

// ── Types ──────────────────────────────────────────────────────────────────────
interface AuthRow {
  id: string;
  organization_id: string;
  referring_provider_name: string | null;
  referring_provider_npi: string | null;
}

interface CsvRow {
  auth_id: string;
  org_id: string;
  raw_name: string;
  raw_npi: string;
  outcome: "auto-resolved" | "needs-review" | "already-linked" | "skipped-no-data";
  rp_id: string;
  rp_status: string;
  note: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first: "", last: parts[0] };
  const last = parts[parts.length - 1];
  const first = parts.slice(0, -1).join(" ");
  return { first, last };
}

function isValidNpi(npi: string | null | undefined): boolean {
  if (!npi) return false;
  const clean = npi.replace(/\D/g, "");
  if (!/^\d{10}$/.test(clean)) return false;
  try { validateNPI(clean); return true; } catch { return false; }
}

async function findExistingRp(
  tenantId: string,
  npi: string | null,
): Promise<string | null> {
  if (!npi) return null;
  const { rows } = await pool.query(
    `SELECT id FROM referring_providers WHERE tenant_id = $1 AND npi = $2 LIMIT 1`,
    [tenantId, npi.replace(/\D/g, "")]
  );
  return rows[0]?.id ?? null;
}

async function insertRp(
  tenantId: string,
  first: string,
  last: string,
  npi: string | null,
  status: "verified" | "pending",
  notes: string,
): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO referring_providers
       (tenant_id, first_name, last_name, npi, verification_status, provider_type, notes)
     VALUES ($1, $2, $3, $4, $5, '1', $6)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [tenantId, first || "Unknown", last || "Unknown", npi || null, status, notes]
  );
  if (rows[0]) return rows[0].id;
  // Race / ON CONFLICT — fetch it
  const found = await findExistingRp(tenantId, npi);
  if (found) return found;
  throw new Error(`Could not insert or find RP for tenant=${tenantId} npi=${npi}`);
}

async function linkAuth(authId: string, rpId: string): Promise<void> {
  await pool.query(
    `UPDATE prior_authorizations SET referring_provider_id = $1 WHERE id = $2`,
    [rpId, authId]
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.error(`[backfill] mode=${DRY_RUN ? "DRY-RUN" : "LIVE"}`);
  console.error(`[backfill] db=${process.env.DATABASE_URL?.split("@")[1] ?? "(local)"}`);

  // Fetch all prior_auths that have free-text RP data but no FK yet
  const { rows: auths } = await pool.query<AuthRow>(`
    SELECT id, organization_id, referring_provider_name, referring_provider_npi
    FROM prior_authorizations
    WHERE (referring_provider_name IS NOT NULL OR referring_provider_npi IS NOT NULL)
      AND referring_provider_id IS NULL
    ORDER BY organization_id, referring_provider_name
  `);

  console.error(`[backfill] found ${auths.length} prior_auth rows to process`);

  const report: CsvRow[] = [];
  let autoResolved = 0;
  let needsReview = 0;
  let alreadyLinked = 0;

  for (const auth of auths) {
    const rawName = auth.referring_provider_name ?? "";
    const rawNpi  = auth.referring_provider_npi ?? "";
    const orgId   = auth.organization_id;

    // Skip rows with no usable data at all
    if (!rawName.trim() && !rawNpi.trim()) {
      report.push({
        auth_id: auth.id, org_id: orgId,
        raw_name: rawName, raw_npi: rawNpi,
        outcome: "skipped-no-data", rp_id: "", rp_status: "",
        note: "both name and NPI empty after trim",
      });
      continue;
    }

    const npiClean = rawNpi.replace(/\D/g, "") || null;
    const npiValid = isValidNpi(npiClean);
    const { first, last } = parseName(rawName || "Unknown Provider");

    // Check for existing RP by NPI
    const existingId = await findExistingRp(orgId, npiValid ? npiClean : null);

    if (existingId) {
      // Already in directory — just link
      if (!DRY_RUN) await linkAuth(auth.id, existingId);
      alreadyLinked++;
      report.push({
        auth_id: auth.id, org_id: orgId,
        raw_name: rawName, raw_npi: rawNpi,
        outcome: "auto-resolved", rp_id: existingId, rp_status: "existing",
        note: `Linked to existing RP ${existingId}`,
      });
      continue;
    }

    // No existing RP — create one
    const status: "verified" | "pending" = npiValid ? "verified" : "pending";
    const notes = [
      `Backfill from prior_auth ${auth.id}`,
      !npiValid && rawNpi ? `raw NPI '${rawNpi}' failed validation` : "",
    ].filter(Boolean).join("; ");

    let rpId = "";
    if (!DRY_RUN) {
      rpId = await insertRp(orgId, first, last, npiValid ? npiClean : null, status, notes);
      await linkAuth(auth.id, rpId);
    } else {
      rpId = "(dry-run)";
    }

    const outcome = npiValid ? "auto-resolved" : "needs-review";
    if (outcome === "auto-resolved") autoResolved++;
    else needsReview++;

    report.push({
      auth_id: auth.id, org_id: orgId,
      raw_name: rawName, raw_npi: rawNpi,
      outcome, rp_id: rpId, rp_status: status,
      note: npiValid
        ? `Created verified RP: ${first} ${last} NPI=${npiClean}`
        : `Created pending RP — NPI ${rawNpi ? `'${rawNpi}' invalid` : "absent"}; manual lookup needed`,
    });
  }

  // ── CSV output ──────────────────────────────────────────────────────────────
  const header = "auth_id,org_id,raw_name,raw_npi,outcome,rp_id,rp_status,note";
  console.log(header);
  for (const r of report) {
    const row = [
      r.auth_id, r.org_id,
      `"${r.raw_name.replace(/"/g, '""')}"`,
      `"${r.raw_npi.replace(/"/g, '""')}"`,
      r.outcome, r.rp_id, r.rp_status,
      `"${r.note.replace(/"/g, '""')}"`,
    ].join(",");
    console.log(row);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.error(`\n[backfill] done`);
  console.error(`  auto-resolved  : ${autoResolved} (NPI valid — created verified, linked)`);
  console.error(`  needs-review   : ${needsReview} (NPI absent/invalid — created pending, manual lookup needed)`);
  console.error(`  already-linked : ${alreadyLinked} (matched existing row by NPI)`);
  console.error(`  total processed: ${auths.length}`);
  if (DRY_RUN) console.error(`\n  ** DRY-RUN — no DB changes were made **`);

  await pool.end();
}

main().catch(err => {
  console.error("[backfill] fatal:", err.message);
  process.exit(1);
});
