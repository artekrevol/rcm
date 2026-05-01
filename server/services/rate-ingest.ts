import https from "https";
import http from "http";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { Pool } from "pg";
import * as XLSX from "xlsx";

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────
const CMS_RVU26B_URL = "https://www.cms.gov/files/zip/rvu26b-updated-03-10-2026.zip";
const VA_CY26_URL = "https://www.va.gov/COMMUNITYCARE/docs/RO/CY26-Fee-Schedule.xlsx";
const PFS_YEAR = 2026;
const CONVERSION_FACTOR_2026 = 33.4009;
const EFFECTIVE_DATE = "2026-01-01";
const TERMINATION_DATE = "2026-12-31";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────
function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const protocol = url.startsWith("https") ? https : http;
    const req = protocol.get(url, { headers: { "User-Agent": "ClaimShieldHealth/1.0" } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        return downloadFile(res.headers.location!, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      }
      res.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    });
    req.on("error", (err) => { file.close(); reject(err); });
    file.on("error", (err) => { fs.unlink(destPath, () => {}); reject(err); });
  });
}

function parseNum(s: string | undefined): number | null {
  if (!s || s.trim() === "" || s.trim() === "*") return null;
  const n = parseFloat(s.trim());
  return isNaN(n) ? null : n;
}

function parseSimpleCSV(text: string): string[][] {
  return text
    .split("\n")
    .map((line) => {
      const cols: string[] = [];
      let cur = "";
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { inQ = !inQ; }
        else if (c === "," && !inQ) { cols.push(cur.trim()); cur = ""; }
        else { cur += c; }
      }
      cols.push(cur.trim());
      return cols.map((c) => c.replace(/\r$/, "").trim());
    });
}

async function batchInsert(pool: Pool, query: string, rowSets: any[][], batchSize = 500): Promise<number> {
  let total = 0;
  for (let i = 0; i < rowSets.length; i += batchSize) {
    const batch = rowSets.slice(i, i + batchSize);
    for (const row of batch) {
      try {
        await pool.query(query, row);
        total++;
      } catch (e: any) {
        if (!e.message?.includes("unique") && !e.message?.includes("duplicate")) {
          // Upsert conflicts are expected — only log unexpected errors
          console.warn("[rate-ingest] row insert warning:", e.message?.slice(0, 80));
        }
      }
    }
  }
  return total;
}

// ──────────────────────────────────────────────────────────────────────────────
// Task 2 + 3 + LOCCO: Ingest CMS PFS RVU, GPCI, and locality-county data
// ──────────────────────────────────────────────────────────────────────────────
export async function ingestCMSData(pool: Pool, year = PFS_YEAR): Promise<{
  rvu: { parsed: number; inserted: number };
  gpci: { parsed: number; inserted: number };
  locco: { parsed: number; inserted: number };
}> {
  const zipPath = `/tmp/rvu${String(year).slice(2)}b.zip`;
  console.log(`[cms-ingest] Downloading CMS RVU${String(year).slice(2)}B from CMS...`);
  await downloadFile(CMS_RVU26B_URL, zipPath);
  console.log(`[cms-ingest] Downloaded. Size: ${Math.round(fs.statSync(zipPath).size / 1024)}KB`);

  const zip = new AdmZip(zipPath);

  // ─── RVU data ───────────────────────────────────────────────────────────────
  const rvuEntry = zip.getEntries().find((e) =>
    e.entryName.startsWith("PPRRVU") && e.entryName.endsWith("nonQPP.csv")
  );
  if (!rvuEntry) throw new Error("RVU CSV not found in ZIP");

  const rvuText = rvuEntry.getData().toString("utf8");
  const rvuLines = parseSimpleCSV(rvuText);

  // Find the actual header row — the data row starts with a HCPCS code pattern
  let dataStart = 0;
  for (let i = 0; i < rvuLines.length; i++) {
    if (rvuLines[i][0] && /^[0-9A-Z]{4,5}$/.test(rvuLines[i][0])) {
      dataStart = i;
      break;
    }
  }

  const rvuRows: any[][] = [];
  let rvuParsed = 0;
  for (let i = dataStart; i < rvuLines.length; i++) {
    const cols = rvuLines[i];
    if (!cols[0] || cols[0].length < 4) continue;
    const hcpcs = cols[0].trim().toUpperCase();
    const modifier = cols[1]?.trim() || null;
    const workRvu = parseNum(cols[5]);
    const peNonFac = parseNum(cols[6]);
    const peFac = parseNum(cols[8]);
    const mpRvu = parseNum(cols[10]);
    const statusInd = cols[3]?.trim() || null;
    const globalPeriod = cols[14]?.trim() || null;
    const multProc = cols[18]?.trim() || null;
    const bilatSurg = cols[19]?.trim() || null;
    const asstSurg = cols[20]?.trim() || null;
    const coSurg = cols[21]?.trim() || null;
    const teamSurg = cols[22]?.trim() || null;
    const pcInd = cols[13]?.trim() || null;
    const convFactor = parseNum(cols[25]) ?? CONVERSION_FACTOR_2026;
    rvuParsed++;
    rvuRows.push([
      hcpcs, modifier, workRvu, peNonFac, peFac, mpRvu,
      statusInd, globalPeriod, pcInd, multProc, bilatSurg, asstSurg, coSurg, teamSurg,
      EFFECTIVE_DATE, TERMINATION_DATE, year, convFactor, CMS_RVU26B_URL,
    ]);
  }

  console.log(`[cms-ingest] RVU: parsed ${rvuParsed} rows, inserting...`);
  const rvuInserted = await batchInsert(pool, `
    INSERT INTO cms_pfs_rvu (
      hcpcs_code, modifier, work_rvu, practice_expense_rvu_non_facility,
      practice_expense_rvu_facility, malpractice_rvu,
      status_indicator, global_period, professional_component_indicator,
      multiple_procedure_indicator, bilateral_surgery_indicator,
      assistant_surgery_indicator, co_surgeon_indicator, team_surgery_indicator,
      effective_date, termination_date, pfs_year, conversion_factor, source_url
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    ON CONFLICT (hcpcs_code, modifier, effective_date, pfs_year) DO UPDATE SET
      work_rvu = EXCLUDED.work_rvu,
      practice_expense_rvu_non_facility = EXCLUDED.practice_expense_rvu_non_facility,
      practice_expense_rvu_facility = EXCLUDED.practice_expense_rvu_facility,
      malpractice_rvu = EXCLUDED.malpractice_rvu,
      status_indicator = EXCLUDED.status_indicator,
      conversion_factor = EXCLUDED.conversion_factor,
      ingested_at = NOW()
  `, rvuRows);
  console.log(`[cms-ingest] RVU: inserted/updated ${rvuInserted}`);

  // ─── GPCI data ──────────────────────────────────────────────────────────────
  const gpciEntry = zip.getEntries().find((e) => e.entryName === "GPCI2026.csv");
  if (!gpciEntry) throw new Error("GPCI CSV not found in ZIP");

  const gpciText = gpciEntry.getData().toString("utf8");
  const gpciLines = parseSimpleCSV(gpciText);

  const gpciRows: any[][] = [];
  let gpciParsed = 0;
  for (const cols of gpciLines) {
    // Data rows start with a numeric MAC carrier code
    if (!cols[0] || !/^\d{5}$/.test(cols[0])) continue;
    gpciParsed++;
    const state = cols[1]?.trim() || "";
    const locality = cols[2]?.trim().padStart(2, "0");
    const localityName = cols[3]?.trim() || "";
    const workGpci = parseNum(cols[5]); // with 1.0 floor
    const peGpci = parseNum(cols[6]);
    const mpGpci = parseNum(cols[7]);
    gpciRows.push([
      cols[0].trim(), locality, localityName, state,
      workGpci, peGpci, mpGpci,
      EFFECTIVE_DATE, TERMINATION_DATE, year, CMS_RVU26B_URL,
    ]);
  }

  console.log(`[cms-ingest] GPCI: parsed ${gpciParsed} localities, inserting...`);
  const gpciInserted = await batchInsert(pool, `
    INSERT INTO cms_gpci (
      mac_carrier, locality_code, locality_name, state,
      work_gpci, practice_expense_gpci, malpractice_gpci,
      effective_date, termination_date, pfs_year, source_url
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (mac_carrier, locality_code, effective_date, pfs_year) DO UPDATE SET
      locality_name = EXCLUDED.locality_name,
      work_gpci = EXCLUDED.work_gpci,
      practice_expense_gpci = EXCLUDED.practice_expense_gpci,
      malpractice_gpci = EXCLUDED.malpractice_gpci,
      ingested_at = NOW()
  `, gpciRows);
  console.log(`[cms-ingest] GPCI: inserted/updated ${gpciInserted}`);

  // ─── County-to-locality (26LOCCO) ──────────────────────────────────────────
  const loccoEntry = zip.getEntries().find((e) => e.entryName.match(/\d{2}LOCCO\.csv/i));
  if (!loccoEntry) throw new Error("LOCCO CSV not found in ZIP");

  const loccoText = loccoEntry.getData().toString("utf8");
  const loccoLines = parseSimpleCSV(loccoText);

  const loccoRows: any[][] = [];
  let loccoParsed = 0;
  for (const cols of loccoLines) {
    if (!cols[0] || !/^\d{5}$/.test(cols[0])) continue;
    const counties = cols[4]?.trim()
      ? cols[4].split(/[,\/]/).map((c: string) => c.trim()).filter(Boolean)
      : [];
    loccoParsed++;
    loccoRows.push([
      cols[0].trim(),
      cols[1]?.trim().padStart(2, "0"),
      cols[2]?.trim() || "",
      cols[3]?.trim() || "",
      counties,
      year,
      CMS_RVU26B_URL,
    ]);
  }

  console.log(`[cms-ingest] LOCCO: parsed ${loccoParsed} locality-county rows, inserting...`);
  const loccoInserted = await batchInsert(pool, `
    INSERT INTO cms_locality_county (mac_carrier, locality_code, state, locality_name, counties, pfs_year, source_url)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (mac_carrier, locality_code, pfs_year) DO UPDATE SET
      locality_name = EXCLUDED.locality_name,
      counties = EXCLUDED.counties,
      ingested_at = NOW()
  `, loccoRows);
  console.log(`[cms-ingest] LOCCO: inserted/updated ${loccoInserted}`);

  return {
    rvu: { parsed: rvuParsed, inserted: rvuInserted },
    gpci: { parsed: gpciParsed, inserted: gpciInserted },
    locco: { parsed: loccoParsed, inserted: loccoInserted },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Task 5: Ingest VA Community Care Fee Schedule
// ──────────────────────────────────────────────────────────────────────────────
export async function ingestVASchedule(pool: Pool, year = PFS_YEAR, localityFilter?: { macCarrier: string; localityCode: string }): Promise<{
  parsed: number; inserted: number;
}> {
  const xlsxPath = `/tmp/va-cy${String(year).slice(2)}.xlsx`;
  console.log(`[va-ingest] Downloading VA CY${year} fee schedule...`);
  await downloadFile(VA_CY26_URL, xlsxPath);
  console.log(`[va-ingest] Downloaded. Size: ${Math.round(fs.statSync(xlsxPath).size / 1024)}KB`);

  console.log("[va-ingest] Parsing XLSX (large file — this may take 30-60s)...");
  const wb = XLSX.readFile(xlsxPath, { dense: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rawRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as any[][];
  console.log(`[va-ingest] XLSX parsed: ${rawRows.length} rows`);

  // Row 4 (index 4) is the header row: Row.No, Procedure Code, Modifier, Location Description, Carrier, Locality, Facility Rate, Non-Facility Rate, Effective Date, Note
  const vaRows: any[][] = [];
  let parsed = 0;

  for (let i = 5; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || !row[1]) continue;
    const code = String(row[1]).trim().toUpperCase();
    if (!code || code === "PROCEDURE CODE") continue;

    // Optional locality filter (for faster ingests)
    const carrier = row[4] ? String(row[4]).trim() : null;
    const locality = row[5] ? String(row[5]).trim().padStart(2, "0") : null;
    if (localityFilter) {
      if (carrier !== localityFilter.macCarrier || locality !== localityFilter.localityCode) continue;
    }

    const modifier = row[2] && row[2] !== "N/A" ? String(row[2]).trim() : null;
    const locationDesc = row[3] ? String(row[3]).trim() : "NATIONAL";
    const facilityRate = typeof row[6] === "number" ? row[6] : parseNum(String(row[6] ?? ""));
    const nonFacRate = typeof row[7] === "number" ? row[7] : parseNum(String(row[7] ?? ""));
    const note = row[9] ? String(row[9]).trim() : null;
    // Skip non-reimbursable codes (marked with #)
    if (note === "#") continue;

    const geoScope = carrier && locality ? `${carrier}_${locality}` : "national";

    parsed++;
    vaRows.push([
      code, modifier, "national_vafs",
      facilityRate, nonFacRate,
      geoScope, carrier, locality, locationDesc,
      EFFECTIVE_DATE, TERMINATION_DATE, year, VA_CY26_URL,
    ]);
  }

  console.log(`[va-ingest] VAFS: parsed ${parsed} reimbursable rows, inserting in batches...`);
  const inserted = await batchInsert(pool, `
    INSERT INTO va_fee_schedule (
      hcpcs_code, modifier, schedule_type,
      facility_rate, non_facility_rate,
      geographic_scope, mac_carrier, locality_code, code_description,
      effective_date, termination_date, fee_schedule_year, source_url
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT (hcpcs_code, modifier, schedule_type, geographic_scope, effective_date, fee_schedule_year) DO UPDATE SET
      facility_rate = EXCLUDED.facility_rate,
      non_facility_rate = EXCLUDED.non_facility_rate,
      code_description = EXCLUDED.code_description,
      ingested_at = NOW()
  `, vaRows, 500);
  console.log(`[va-ingest] VAFS: inserted/updated ${inserted}`);

  return { parsed, inserted };
}

// ──────────────────────────────────────────────────────────────────────────────
// Task 6: Resolve practice locality from DB data
// ──────────────────────────────────────────────────────────────────────────────
export async function resolveLocalityForOrg(pool: Pool, orgId: string): Promise<{
  localityCode: string; macCarrier: string; localityName: string;
} | null> {
  // First try to find from cms_locality_county using the practice's state and name
  // For now: look up by known county name from practice settings address
  const ps = await pool.query(
    `SELECT address, medicare_locality_code, medicare_mac_carrier FROM practice_settings WHERE organization_id = $1`,
    [orgId]
  );
  if (!ps.rows.length) return null;
  const row = ps.rows[0];
  if (row.medicare_locality_code && row.medicare_mac_carrier) {
    return { localityCode: row.medicare_locality_code, macCarrier: row.medicare_mac_carrier, localityName: "" };
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Task 6: Backfill Chajinel's locality (San Mateo → SF locality 05, MAC 01112)
// ──────────────────────────────────────────────────────────────────────────────
/**
 * Resolve Medicare locality for a single org by looking up their practice ZIP
 * in the cms_zip_locality crosswalk table (most authoritative — data-driven from
 * CMS quarterly crosswalk file, not a hardcoded guess).
 *
 * Falls back to cms_gpci state lookup if the crosswalk table is not yet populated.
 *
 * Source: CMS ZIP-to-Carrier-Locality File (quarterly)
 * URL: https://www.cms.gov/medicare/medicare-fee-for-service-payment/prospmedicarefeesvcpmtgen/index.html
 */
export async function resolveLocalityByZip(pool: Pool, orgId: string): Promise<{
  zip: string; locality_code: string; mac_carrier: string; method: string;
} | null> {
  // Get the org's practice ZIP from address JSONB
  const psRow = await pool.query(
    `SELECT address->>'zip' AS zip FROM practice_settings WHERE organization_id = $1 LIMIT 1`,
    [orgId]
  );
  if (!psRow.rows.length || !psRow.rows[0].zip) {
    console.warn(`[locality] No ZIP found for org ${orgId}`);
    return null;
  }
  const zip = (psRow.rows[0].zip as string).trim().slice(0, 5);

  // ── Primary: cms_zip_locality crosswalk ───────────────────────────────────
  const crosswalk = await pool.query(
    `SELECT locality_code, mac_carrier FROM cms_zip_locality
     WHERE zip_code = $1
     ORDER BY effective_date DESC LIMIT 1`,
    [zip]
  );
  if (crosswalk.rows.length) {
    const { locality_code, mac_carrier } = crosswalk.rows[0];
    console.log(`[locality] ${orgId} zip=${zip} → locality=${locality_code} MAC=${mac_carrier} (cms_zip_crosswalk)`);
    return { zip, locality_code, mac_carrier, method: "cms_zip_crosswalk_lookup" };
  }

  // ── Fallback: cms_gpci state lookup ──────────────────────────────────────
  // Used only when zip crosswalk table is empty (not yet ingested).
  const stateRow = await pool.query(
    `SELECT address->>'state' AS state FROM practice_settings WHERE organization_id = $1 LIMIT 1`,
    [orgId]
  );
  const state = stateRow.rows[0]?.state?.toUpperCase() || null;
  if (!state) return null;

  const gpci = await pool.query(
    `SELECT locality_code, mac_carrier FROM cms_gpci
     WHERE state = $1 AND pfs_year = $2
     ORDER BY locality_code ASC LIMIT 1`,
    [state, PFS_YEAR]
  );
  if (gpci.rows.length) {
    const { locality_code, mac_carrier } = gpci.rows[0];
    console.warn(`[locality] ${orgId} zip crosswalk empty — fell back to GPCI state lookup (state=${state})`);
    return { zip, locality_code, mac_carrier, method: "gpci_state_fallback" };
  }

  console.warn(`[locality] ${orgId} — no locality resolved from crosswalk or GPCI`);
  return null;
}

/**
 * Backfill Medicare locality for all orgs whose practice_settings have no
 * locality data yet. Uses resolveLocalityByZip() for each.
 * Designed to be idempotent — skips orgs already resolved.
 */
export async function backfillAllTenantLocalities(pool: Pool): Promise<{ resolved: number; skipped: number; failed: number }> {
  const orgs = await pool.query(
    `SELECT DISTINCT organization_id FROM practice_settings
     WHERE medicare_locality_code IS NULL OR medicare_mac_carrier IS NULL`
  );
  let resolved = 0, skipped = 0, failed = 0;
  for (const row of orgs.rows) {
    const orgId = row.organization_id;
    try {
      const result = await resolveLocalityByZip(pool, orgId);
      if (!result) { skipped++; continue; }
      await pool.query(`
        UPDATE practice_settings SET
          medicare_locality_code   = $1,
          medicare_mac_carrier     = $2,
          locality_resolved_at     = NOW(),
          locality_resolution_method = $3,
          locality_source_url      = 'https://www.cms.gov/medicare/medicare-fee-for-service-payment/prospmedicarefeesvcpmtgen/index.html'
        WHERE organization_id = $4
          AND (medicare_locality_code IS NULL OR medicare_mac_carrier IS NULL)
      `, [result.locality_code, result.mac_carrier, result.method, orgId]);
      resolved++;
    } catch (e: any) {
      console.error(`[locality] Failed for ${orgId}:`, e.message);
      failed++;
    }
  }
  console.log(`[locality] Backfill complete — resolved: ${resolved}, skipped: ${skipped}, failed: ${failed}`);
  return { resolved, skipped, failed };
}

/**
 * Backfill Chajinel specifically — convenience wrapper around resolveLocalityByZip.
 * Kept for backward compatibility with runFullIngest().
 */
export async function backfillChajinelLocality(pool: Pool): Promise<void> {
  const result = await resolveLocalityByZip(pool, "chajinel-org-001");
  if (!result) {
    console.warn("[locality] Could not resolve Chajinel locality — cms_zip_locality may not be populated yet");
    return;
  }
  await pool.query(`
    UPDATE practice_settings SET
      medicare_locality_code     = $1,
      medicare_mac_carrier       = $2,
      locality_resolved_at       = NOW(),
      locality_resolution_method = $3,
      locality_source_url        = 'https://www.cms.gov/medicare/medicare-fee-for-service-payment/prospmedicarefeesvcpmtgen/index.html'
    WHERE organization_id = 'chajinel-org-001'
      AND (medicare_locality_code IS NULL OR medicare_locality_code != $1)
  `, [result.locality_code, result.mac_carrier, result.method]);
  console.log(`[locality] Chajinel resolved: locality=${result.locality_code} MAC=${result.mac_carrier} via ${result.method}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Full ingest orchestrator (called from admin API)
// ──────────────────────────────────────────────────────────────────────────────
export async function runFullIngest(pool: Pool, opts: {
  cms?: boolean;
  va?: boolean;
  localityOnly?: boolean; // ingest VA rates for SF locality only (faster)
}): Promise<Record<string, any>> {
  const results: Record<string, any> = {};

  if (opts.cms) {
    console.log("[ingest] Starting CMS PFS + GPCI + LOCCO ingest...");
    results.cms = await ingestCMSData(pool);
  }

  if (opts.va) {
    const localityFilter = opts.localityOnly
      ? { macCarrier: "01112", localityCode: "05" }
      : undefined;
    console.log(`[ingest] Starting VA fee schedule ingest (${localityFilter ? "SF locality" : "all localities"})...`);
    results.va = await ingestVASchedule(pool, PFS_YEAR, localityFilter);
  }

  // Backfill locality for all tenants using ZIP crosswalk (data-driven, not hardcoded).
  // Falls back to GPCI state lookup if crosswalk not yet populated.
  try {
    const localityResult = await backfillAllTenantLocalities(pool);
    results.localityBackfill = { status: "ok", ...localityResult };
  } catch (e: any) {
    results.localityBackfill = { status: "error", message: e.message };
  }

  return results;
}
