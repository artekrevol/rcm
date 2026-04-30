import { pool } from "../db";
import https from "https";
import http from "http";
import { createWriteStream, createReadStream, mkdirSync } from "fs";
import { unlink, readFile } from "fs/promises";
import path from "path";
import os from "os";
import { createGunzip } from "zlib";
import { pipeline } from "stream/promises";

// CMS publishes quarterly; URL pattern per their current schema
const CMS_BASE_URL = "https://www.cms.gov/files/zip";

function ncciVersion(year: number, quarter: number): string {
  return `${year}Q${quarter}`;
}

function currentQuarter(): { year: number; quarter: number } {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const quarter = Math.ceil(month / 3);
  return { year, quarter };
}

function cmsZipUrl(year: number, quarter: number): string {
  return `${CMS_BASE_URL}/medicare-ncci-practitioner-ptp-edits-${year}-q${quarter}.zip`;
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const proto = url.startsWith("https") ? https : http;
    const req = proto.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        const redirect = res.headers.location!;
        file.close();
        downloadFile(redirect, dest).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
    });
    req.on("error", (err) => { file.close(); reject(err); });
    req.setTimeout(60000, () => { req.destroy(); reject(new Error("Download timeout")); });
  });
}

async function extractZip(zipPath: string, destDir: string): Promise<string[]> {
  // Use the 'unzipper' package if available, otherwise try gunzip for .gz
  // CMS files are true ZIP archives — use the built-in unzipper
  try {
    const unzipper = await import("unzipper");
    const csvFiles: string[] = [];
    await new Promise<void>((resolve, reject) => {
      createReadStream(zipPath)
        .pipe(unzipper.Parse())
        .on("entry", (entry: any) => {
          const fileName: string = entry.path;
          if (fileName.toLowerCase().endsWith(".csv")) {
            const outPath = path.join(destDir, path.basename(fileName));
            csvFiles.push(outPath);
            entry.pipe(createWriteStream(outPath));
          } else {
            entry.autodrain();
          }
        })
        .on("close", resolve)
        .on("error", reject);
    });
    return csvFiles;
  } catch {
    throw new Error("unzipper package not available — cannot extract ZIP");
  }
}

interface IngestStats {
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  version: string;
  sourceFile: string;
}

/**
 * Parse and upsert a CCI CSV buffer.
 * CMS Practitioner PTP CSV columns (order may vary by release):
 * Column1, Column2, * Effective Date, Deletion Date, Modifier Indicator, PTP Edit Rationale
 *
 * We normalise the header to lowercase with underscores and handle both
 * comma-separated and tab-separated variants.
 */
export async function ingestCsvBuffer(
  csvBuffer: Buffer,
  sourceFile: string,
  version: string
): Promise<IngestStats> {
  const stats: IngestStats = { inserted: 0, updated: 0, skipped: 0, errors: 0, version, sourceFile };

  const text = csvBuffer.toString("utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error("CSV appears empty or has no data rows");

  // Detect delimiter
  const delim = lines[0].includes("\t") ? "\t" : ",";

  const rawHeaders = lines[0].split(delim).map((h) =>
    h.replace(/^"|"$/g, "").trim().toLowerCase()
      .replace(/\*/g, "")
      .replace(/\s+/g, "_")
  );

  // Map to canonical field names
  const colIdx = (candidates: string[]): number => {
    for (const c of candidates) {
      const i = rawHeaders.findIndex((h) => h.includes(c));
      if (i >= 0) return i;
    }
    return -1;
  };

  const col1Idx = colIdx(["column1", "column_1", "col1", "comprehensive"]);
  const col2Idx = colIdx(["column2", "column_2", "col2", "component"]);
  const modIdx  = colIdx(["modifier_indicator", "modifier", "mod"]);
  const effIdx  = colIdx(["effective_date", "effective"]);
  const delIdx  = colIdx(["deletion_date", "deletion"]);
  const ratIdx  = colIdx(["ptp_edit_rationale", "rationale", "reason"]);

  if (col1Idx < 0 || col2Idx < 0) {
    throw new Error(`Could not locate Column1/Column2 in CSV headers: ${rawHeaders.join(", ")}`);
  }

  const client = await pool.connect();
  try {
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(delim).map((v) => v.replace(/^"|"$/g, "").trim());
      if (parts.length < 2) continue;

      const col1 = parts[col1Idx]?.replace(/\s/g, "");
      const col2 = parts[col2Idx]?.replace(/\s/g, "");
      if (!col1 || !col2) { stats.skipped++; continue; }

      const modifier = modIdx >= 0 ? (parts[modIdx] || "9") : "9";
      const effDateRaw = effIdx >= 0 ? parts[effIdx] : "";
      const delDateRaw = delIdx >= 0 ? parts[delIdx] : null;
      const rationale = ratIdx >= 0 ? (parts[ratIdx] || null) : null;

      // Parse MM/DD/YYYY or YYYYMMDD or YYYY-MM-DD
      const parseDate = (raw: string | null): string | null => {
        if (!raw || raw.trim() === "" || raw === "N/A") return null;
        const mmddyyyy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (mmddyyyy) return `${mmddyyyy[3]}-${mmddyyyy[1].padStart(2,"0")}-${mmddyyyy[2].padStart(2,"0")}`;
        const yyyymmdd = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
        if (yyyymmdd) return `${yyyymmdd[1]}-${yyyymmdd[2]}-${yyyymmdd[3]}`;
        const iso = raw.match(/^\d{4}-\d{2}-\d{2}$/);
        if (iso) return raw;
        return null;
      };

      const effDate = parseDate(effDateRaw) || "1900-01-01";
      const delDate = parseDate(delDateRaw);

      try {
        const result = await client.query(
          `INSERT INTO cci_edits
             (column_1_code, column_2_code, modifier_indicator, effective_date, deletion_date,
              ptp_edit_rationale, ncci_version, source_file)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (column_1_code, column_2_code, effective_date, ncci_version)
           DO UPDATE SET
             modifier_indicator = EXCLUDED.modifier_indicator,
             deletion_date = EXCLUDED.deletion_date,
             ptp_edit_rationale = EXCLUDED.ptp_edit_rationale,
             source_file = EXCLUDED.source_file,
             ingested_at = NOW()
           RETURNING (xmax = 0) AS inserted`,
          [col1, col2, modifier, effDate, delDate, rationale, version, sourceFile]
        );
        if (result.rows[0]?.inserted) stats.inserted++;
        else stats.updated++;
      } catch (rowErr) {
        stats.errors++;
        if (stats.errors <= 5) console.error("[cci-ingest] row error:", rowErr);
      }
    }
  } finally {
    client.release();
  }

  console.log(`[cci-ingest] Done: inserted=${stats.inserted} updated=${stats.updated} skipped=${stats.skipped} errors=${stats.errors} version=${version}`);
  return stats;
}

function previousQuarter(year: number, quarter: number): { year: number; quarter: number } {
  if (quarter === 1) return { year: year - 1, quarter: 4 };
  return { year, quarter: quarter - 1 };
}

async function isVersionAlreadyLoaded(version: string): Promise<boolean> {
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM cci_edits WHERE ncci_version = $1 LIMIT 1`,
      [version]
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function tryDownload(year: number, quarter: number): Promise<{ zipPath: string; version: string } | null> {
  const version = ncciVersion(year, quarter);
  const url = cmsZipUrl(year, quarter);
  const zipPath = path.join(os.tmpdir(), `cci_${version}.zip`);
  console.log(`[cci-ingest] Trying ${url}`);
  try {
    await downloadFile(url, zipPath);
    return { zipPath, version };
  } catch {
    return null;
  }
}

export async function ingestFromCms(): Promise<IngestStats> {
  const { year, quarter } = currentQuarter();
  const tmpDir = os.tmpdir();

  // Try current quarter first, then fall back to previous quarter if CMS hasn't published yet.
  let resolved = await tryDownload(year, quarter);
  if (!resolved) {
    const prev = previousQuarter(year, quarter);
    console.log(`[cci-ingest] Current quarter (${year}Q${quarter}) not available — trying previous quarter (${prev.year}Q${prev.quarter})`);
    resolved = await tryDownload(prev.year, prev.quarter);
  }

  if (!resolved) {
    const msg = `CMS NCCI file unavailable for ${year}Q${quarter} and ${previousQuarter(year, quarter).year}Q${previousQuarter(year, quarter).quarter}. Manual upload required at /admin/data-tools/cci-upload.`;
    console.warn(`[cci-ingest] ${msg}`);
    throw new Error(msg);
  }

  const { zipPath, version } = resolved;

  // Skip silently if this version is already fully loaded in the DB.
  if (await isVersionAlreadyLoaded(version)) {
    console.log(`[cci-ingest] Version ${version} already loaded — skipping ingest.`);
    await unlink(zipPath).catch(() => {});
    return { inserted: 0, updated: 0, skipped: 0, errors: 0, version, sourceFile: "already_loaded" };
  }

  const extractDir = path.join(tmpDir, `cci_${version}`);
  mkdirSync(extractDir, { recursive: true });

  let csvFiles: string[] = [];
  try {
    csvFiles = await extractZip(zipPath, extractDir);
  } catch (err: any) {
    throw new Error(`ZIP extraction failed: ${err.message}`);
  } finally {
    await unlink(zipPath).catch(() => {});
  }

  // Pick the practitioner PTP CSV (largest or first if only one)
  const practitionerCsv = csvFiles.find((f) =>
    f.toLowerCase().includes("pract") || f.toLowerCase().includes("physician")
  ) || csvFiles[0];

  if (!practitionerCsv) throw new Error("No CSV found in CMS ZIP");

  const buf = await readFile(practitionerCsv);
  const stats = await ingestCsvBuffer(buf, path.basename(practitionerCsv), version);

  // Cleanup
  for (const f of csvFiles) await unlink(f).catch(() => {});

  return stats;
}
