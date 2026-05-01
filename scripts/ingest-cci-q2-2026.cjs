const { Pool } = require('pg');
const { createReadStream, createWriteStream, mkdirSync } = require('fs');
const { readFile, unlink } = require('fs/promises');
const path = require('path');
const os = require('os');

const pool = new Pool({ connectionString: process.env.PRODUCTION_DATABASE_URL });
const VERSION = '2026Q2';
const FILES = [
  '/tmp/cci-q2-2026/ccipra-v321r0-f1.zip',
  '/tmp/cci-q2-2026/ccipra-v321r0-f2.zip',
  '/tmp/cci-q2-2026/ccipra-v321r0-f3.zip',
  '/tmp/cci-q2-2026/ccipra-v321r0-f4.zip',
];

async function extractTxt(zipPath, destDir) {
  const unzipper = require('unzipper');
  const files = [];
  await new Promise((resolve, reject) => {
    createReadStream(zipPath)
      .pipe(unzipper.Parse())
      .on('entry', (entry) => {
        const name = entry.path;
        if (name.toLowerCase().endsWith('.txt') || name.toLowerCase().endsWith('.csv')) {
          const outPath = path.join(destDir, path.basename(name));
          files.push(outPath);
          entry.pipe(createWriteStream(outPath));
        } else { entry.autodrain(); }
      })
      .on('close', resolve).on('error', reject);
  });
  return files;
}

const parseDate = (raw) => {
  if (!raw || /^[\s\*]*$/.test(raw) || raw.trim() === 'N/A') return null;
  raw = raw.trim();
  const m1 = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return `${m1[3]}-${m1[1].padStart(2,'0')}-${m1[2].padStart(2,'0')}`;
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return null;
};

async function ingestFile(filePath) {
  const content = await readFile(filePath, 'utf8');
  const rawLines = content.split(/\r?\n/);
  const isTab = rawLines[0].includes('\t');
  const delim = isTab ? '\t' : ',';

  let dataStart = 0;
  for (let i = 0; i < Math.min(rawLines.length, 20); i++) {
    if (rawLines[i] && /^\d/.test(rawLines[i])) { dataStart = i; break; }
  }
  console.log(`  Data start row: ${dataStart}, total lines: ${rawLines.length.toLocaleString()}`);

  const deduped = new Map();
  let parsedTotal = 0;

  for (let i = dataStart; i < rawLines.length; i++) {
    const parts = rawLines[i].split(delim).map(s => s.replace(/^"|"$/g,'').trim());
    if (parts.length < 2) continue;
    const col1 = parts[0].replace(/\s/g,'');
    const col2 = parts[1].replace(/[\s\*]/g,'');
    if (!col1 || !col2 || !/^\d/.test(col1)) continue;

    const effRaw  = isTab ? parts[3] : parts[2];
    const delRaw  = isTab ? parts[4] : parts[3];
    const modRaw  = isTab ? parts[5] : parts[4];
    const rat     = isTab ? (parts[6] || null) : (parts[5] || null);

    const effDate = parseDate(effRaw) || '1900-01-01';
    const delDate = parseDate(delRaw);
    const modifier = (modRaw || '').split('=')[0].split('/')[0].trim() || '9';

    const key = `${col1}|${col2}|${effDate}`;
    deduped.set(key, [col1, col2, modifier, effDate, delDate, rat, VERSION, path.basename(filePath)]);
    parsedTotal++;
  }

  const rows = Array.from(deduped.values());
  console.log(`  Parsed: ${parsedTotal.toLocaleString()} | After dedup: ${rows.length.toLocaleString()}`);

  const client = await pool.connect();
  let done = 0, errors = 0;
  const BATCH = 500;
  try {
    for (let start = 0; start < rows.length; start += BATCH) {
      const batch = rows.slice(start, start + BATCH);
      const vals = batch.map((_, j) => {
        const b = j * 8;
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8})`;
      }).join(',');
      try {
        await client.query(
          `INSERT INTO cci_edits
             (column_1_code,column_2_code,modifier_indicator,effective_date,deletion_date,
              ptp_edit_rationale,ncci_version,source_file)
           VALUES ${vals}
           ON CONFLICT (column_1_code,column_2_code,effective_date,ncci_version)
           DO UPDATE SET modifier_indicator=EXCLUDED.modifier_indicator,
             deletion_date=EXCLUDED.deletion_date,
             ptp_edit_rationale=EXCLUDED.ptp_edit_rationale,
             source_file=EXCLUDED.source_file, ingested_at=NOW()`,
          batch.flat()
        );
        done += batch.length;
      } catch(e) {
        errors += batch.length;
        console.error(`  batch error @${start}: ${e.message.slice(0,120)}`);
      }
      if (start % 100000 < BATCH) process.stdout.write(`  ${start.toLocaleString()} / ${rows.length.toLocaleString()} upserted\n`);
    }
  } finally { client.release(); }

  return { done, errors };
}

async function main() {
  let grand = 0;
  for (let i = 0; i < FILES.length; i++) {
    const zipPath = FILES[i];
    console.log(`\n=== File ${i+1}/4: ${path.basename(zipPath)} ===`);
    const destDir = path.join(os.tmpdir(), `cci_q2_2026_f${i+1}`);
    mkdirSync(destDir, { recursive: true });
    const extracted = await extractTxt(zipPath, destDir);
    console.log(`  Extracted: ${extracted.map(f=>path.basename(f)).join(', ')}`);
    for (const fp of extracted) {
      const { done, errors } = await ingestFile(fp);
      grand += done;
      console.log(`  Done: upserted=${done.toLocaleString()} errors=${errors}`);
      await unlink(fp).catch(()=>{});
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Grand total upserted: ${grand.toLocaleString()}`);

  console.log('\n=== PRODUCTION VERIFICATION ===');
  const { rows } = await pool.query(`
    SELECT ncci_version,
      COUNT(*)::bigint AS total_edits,
      COUNT(*) FILTER (WHERE deletion_date IS NULL)::bigint AS active_edits,
      COUNT(*) FILTER (WHERE modifier_indicator='0')::bigint AS hard_blocks,
      COUNT(*) FILTER (WHERE modifier_indicator='1')::bigint AS soft_warnings,
      MIN(effective_date)::date AS oldest_effective,
      MAX(effective_date)::date AS newest_effective,
      COUNT(*) FILTER (WHERE effective_date >= '2026-04-01')::bigint AS q2_net_new
    FROM cci_edits GROUP BY ncci_version ORDER BY ncci_version
  `);
  console.table(rows);
  await pool.end();
}

main().catch(e => { console.error('Fatal:', e.message); pool.end(); process.exit(1); });
