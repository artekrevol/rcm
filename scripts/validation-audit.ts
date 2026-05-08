/**
 * Validation audit script — one-time diagnostic tool.
 * Iterates every claim in a tenant, runs the validation engine,
 * and writes a CSV report.
 *
 * Usage:
 *   npx tsx scripts/validation-audit.ts --tenant chajinel > audit.csv
 *   npx tsx scripts/validation-audit.ts --tenant chajinel --output audit.csv
 *
 * The script prints a Markdown summary to stderr and the CSV to stdout
 * (or --output file) so both can be captured independently.
 */

import { Pool } from 'pg';
import * as fs from 'fs';

// ── Args ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const tenantArg = args[find(args, '--tenant') + 1];
const outputArg = args[find(args, '--output') + 1];
// --db <url> overrides DATABASE_URL; --dev uses DEV_DATABASE_URL secret
const dbUrlArg  = args[find(args, '--db') + 1];
const useDevDb  = args.includes('--dev');
const resolvedDbUrl =
  dbUrlArg   ? dbUrlArg :
  useDevDb   ? (process.env.DEV_DATABASE_URL ?? process.env.DATABASE_URL) :
  process.env.DATABASE_URL;

// Patch DATABASE_URL so the runner's internal Pool also targets the same DB.
// Must happen before any import of the runner module.
process.env.DATABASE_URL = resolvedDbUrl;

function find(arr: string[], flag: string): number {
  const idx = arr.indexOf(flag);
  return idx === -1 ? arr.length : idx;
}

if (!tenantArg) {
  console.error('Usage: npx tsx scripts/validation-audit.ts --tenant <chajinel|demo|all>');
  process.exit(1);
}

// ── DB helpers ────────────────────────────────────────────────────────────────
const pool = new Pool({ connectionString: resolvedDbUrl, ssl: { rejectUnauthorized: false } });

async function getOrgIds(tenant: string): Promise<string[]> {
  if (tenant === 'all') {
    const res = await pool.query('SELECT id FROM organizations');
    return res.rows.map(r => r.id);
  }
  // Try by org name (partial match) or by known slugs
  const slugMap: Record<string, string> = {
    chajinel: 'chajinel-org-001',
    demo: 'demo-org-001',
  };
  const orgId = slugMap[tenant.toLowerCase()];
  if (orgId) return [orgId];
  const res = await pool.query("SELECT id FROM organizations WHERE LOWER(name) LIKE $1", [`%${tenant.toLowerCase()}%`]);
  if (!res.rows.length) {
    console.error(`No organization found matching "${tenant}"`);
    process.exit(1);
  }
  return res.rows.map(r => r.id);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const { runValidation } = await import('../server/services/validation/engine/runner.js');

  const orgIds = await getOrgIds(tenantArg);

  const csvRows: string[] = [
    'claim_id,status,payer_id,packs_applied,error_count,warning_count,error_codes,summary',
  ];

  const stats = {
    total: 0,
    byErrorCount: new Map<number, number>(),
    codeFrequency: new Map<string, number>(),
    readyWithErrors: 0,
    submittedWithErrors: 0,
  };

  for (const orgId of orgIds) {
    const claimsRes = await pool.query(
      `SELECT c.id, c.status, p.payer_id
       FROM claims c
       LEFT JOIN payers p ON p.id = c.payer_id
       WHERE c.organization_id = $1
       ORDER BY c.created_at`,
      [orgId],
    );

    for (const row of claimsRes.rows) {
      stats.total++;
      let result;
      try {
        result = await runValidation(row.id, orgId);
      } catch (err: any) {
        const errRow = [
          row.id, row.status, row.payer_id || '',
          '', '1', '0', 'ENGINE-ERROR',
          `Engine error: ${err?.message ?? 'unknown'}`,
        ].map(escape).join(',');
        csvRows.push(errRow);
        continue;
      }

      const errors = result.violations.filter(v => v.severity === 'error');
      const warnings = result.violations.filter(v => v.severity === 'warning');
      const errorCodes = [...new Set(errors.map(v => v.code))].join(';');
      const summary = result.canSubmit
        ? `${warnings.length} warning(s) — ready`
        : `${errors.length} error(s): ${errorCodes}`;

      // Accumulate stats
      const ec = errors.length;
      stats.byErrorCount.set(ec, (stats.byErrorCount.get(ec) ?? 0) + 1);
      for (const v of errors) {
        stats.codeFrequency.set(v.code, (stats.codeFrequency.get(v.code) ?? 0) + 1);
      }
      if (!result.canSubmit) {
        if (row.status === 'ready') stats.readyWithErrors++;
        if (['submitted', 'accepted', 'paid'].includes(row.status)) stats.submittedWithErrors++;
      }

      const csvRow = [
        row.id,
        row.status,
        row.payer_id || '',
        result.packsApplied.join(';'),
        String(errors.length),
        String(warnings.length),
        errorCodes,
        summary,
      ].map(escape).join(',');
      csvRows.push(csvRow);
    }
  }

  // ── Output CSV ──────────────────────────────────────────────────────────────
  const csv = csvRows.join('\n');
  if (outputArg) {
    fs.writeFileSync(outputArg, csv, 'utf8');
    process.stderr.write(`\nCSV written to ${outputArg}\n`);
  } else {
    process.stdout.write(csv + '\n');
  }

  // ── Markdown summary to stderr ──────────────────────────────────────────────
  const sorted = [...stats.codeFrequency.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const cleanCount = stats.byErrorCount.get(0) ?? 0;
  const withErrors = stats.total - cleanCount;

  const md = `
## Validation Audit Summary
- **Tenant**: ${tenantArg}
- **Total claims audited**: ${stats.total}
- **Claims with zero errors**: ${cleanCount} (${pct(cleanCount, stats.total)}%)
- **Claims with ≥1 error**: ${withErrors} (${pct(withErrors, stats.total)}%)
- **"Ready" claims with current errors**: ${stats.readyWithErrors}
- **"Submitted/Accepted/Paid" claims with current errors**: ${stats.submittedWithErrors}

### Error distribution
${[...stats.byErrorCount.entries()]
  .filter(([n]) => n > 0)
  .sort((a, b) => a[0] - b[0])
  .map(([errors, count]) => `- ${errors} error(s): ${count} claim(s)`)
  .join('\n') || '  (none)'}

### Top 5 most common error codes
${sorted.map(([code, n], i) => `${i + 1}. \`${code}\` — ${n} occurrence(s)`).join('\n') || '  (none)'}
`;
  process.stderr.write(md + '\n');

  await pool.end();
}

function pct(n: number, total: number): string {
  if (total === 0) return '0';
  return ((n / total) * 100).toFixed(1);
}

function escape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

main().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
