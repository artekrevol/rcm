/**
 * Sprint 0 Step 5f — Tenant isolation verification.
 *
 * Exercises the four key paths through the new RLS policies:
 *
 *   Case 1 — No tenant context. Expect 0 rows from every tenant-scoped table.
 *            (RLS fails closed when current_setting(...) returns NULL.)
 *   Case 2 — ctx = 'demo-org-001'. Expect 2 rows from practice_payer_enrollments
 *            (the existing demo-seed UHC + UHC Medicare Advantage rows) and 0
 *            rows from organization_practice_profiles (no demo mapping).
 *   Case 3 — ctx = 'chajinel-org-001'. Expect 1 row from
 *            organization_practice_profiles (the home_care mapping seeded in
 *            Step 4a) and 0 rows from practice_payer_enrollments (no chajinel
 *            enrollments yet).
 *   Case 4 — ctx = 'fake-org-xyz-does-not-exist'. Expect 0 rows everywhere.
 *
 * Run with: npx tsx scripts/verify-tenant-isolation.ts
 * Exits 0 on success, 1 on any failure.
 *
 * Read-only: only SELECTs, no DML.
 */
import { pool } from "../server/db";
import { withTenantTx, runWithTenantContext } from "../server/middleware/tenant-context";

interface Expectation {
  caseName: string;
  orgId: string | null;
  table: string;
  expected: number;
}

const cases: Expectation[] = [
  { caseName: "Case 1 — no ctx",        orgId: null,                  table: "practice_payer_enrollments",      expected: 0 },
  { caseName: "Case 1 — no ctx",        orgId: null,                  table: "organization_practice_profiles",  expected: 0 },
  { caseName: "Case 1 — no ctx",        orgId: null,                  table: "patient_insurance_enrollments",   expected: 0 },
  { caseName: "Case 1 — no ctx",        orgId: null,                  table: "provider_practice_relationships", expected: 0 },
  { caseName: "Case 1 — no ctx",        orgId: null,                  table: "provider_payer_relationships",    expected: 0 },
  { caseName: "Case 1 — no ctx",        orgId: null,                  table: "claim_provider_assignments",      expected: 0 },
  { caseName: "Case 2 — demo-org-001",  orgId: "demo-org-001",        table: "practice_payer_enrollments",      expected: 2 },
  { caseName: "Case 2 — demo-org-001",  orgId: "demo-org-001",        table: "organization_practice_profiles",  expected: 0 },
  { caseName: "Case 3 — chajinel",      orgId: "chajinel-org-001",    table: "organization_practice_profiles",  expected: 1 },
  { caseName: "Case 3 — chajinel",      orgId: "chajinel-org-001",    table: "practice_payer_enrollments",      expected: 0 },
  { caseName: "Case 4 — fake org",      orgId: "fake-org-xyz",        table: "practice_payer_enrollments",      expected: 0 },
  { caseName: "Case 4 — fake org",      orgId: "fake-org-xyz",        table: "organization_practice_profiles",  expected: 0 },
];

async function countRows(orgId: string | null, table: string): Promise<number> {
  const run = async () =>
    withTenantTx(async (client) => {
      // Identifier interpolated, not a parameter — safe because `table` comes
      // from this file's own constants, never user input.
      const r = await client.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
      return r.rows[0].n as number;
    });

  if (orgId === null) {
    return run();
  }
  return runWithTenantContext(
    { organizationId: orgId, userId: null, role: null },
    run,
  );
}

async function main() {
  console.log("Sprint 0 Step 5f — Tenant Isolation Verification");
  console.log("=================================================\n");

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const c of cases) {
    const actual = await countRows(c.orgId, c.table);
    const ok = actual === c.expected;
    const status = ok ? "PASS" : "FAIL";
    const line = `  [${status}] ${c.caseName.padEnd(28)} ${c.table.padEnd(34)} expected=${c.expected} actual=${actual}`;
    console.log(line);
    if (ok) {
      passed++;
    } else {
      failed++;
      failures.push(line.trim());
    }
  }

  console.log(`\n${passed} passed, ${failed} failed (${cases.length} total)`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log("  - " + f);
    await pool.end();
    process.exit(1);
  }

  console.log("\nAll tenant-isolation checks passed.");
  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("Verification script crashed:", err);
  pool.end().finally(() => process.exit(2));
});
