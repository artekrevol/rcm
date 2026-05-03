import { pool } from "../server/db";
import { withTenantTx, runWithTenantContext } from "../server/middleware/tenant-context";

const cases = [
  { caseName: "Case 1 — no ctx",       orgId: null,               table: "practice_payer_enrollments",      expected: 0 },
  { caseName: "Case 1 — no ctx",       orgId: null,               table: "organization_practice_profiles",  expected: 0 },
  { caseName: "Case 1 — no ctx",       orgId: null,               table: "patient_insurance_enrollments",   expected: 0 },
  { caseName: "Case 1 — no ctx",       orgId: null,               table: "provider_practice_relationships", expected: 0 },
  { caseName: "Case 1 — no ctx",       orgId: null,               table: "provider_payer_relationships",    expected: 0 },
  { caseName: "Case 1 — no ctx",       orgId: null,               table: "claim_provider_assignments",      expected: 0 },
  { caseName: "Case 2 — demo-org-001", orgId: "demo-org-001",     table: "practice_payer_enrollments",      expected: 2 },
  { caseName: "Case 2 — demo-org-001", orgId: "demo-org-001",     table: "organization_practice_profiles",  expected: 0 },
  { caseName: "Case 3 — chajinel",     orgId: "chajinel-org-001", table: "organization_practice_profiles",  expected: 1 },
  { caseName: "Case 3 — chajinel",     orgId: "chajinel-org-001", table: "practice_payer_enrollments",      expected: 3 },
  { caseName: "Case 4 — fake org",     orgId: "fake-org-xyz",     table: "practice_payer_enrollments",      expected: 0 },
  { caseName: "Case 4 — fake org",     orgId: "fake-org-xyz",     table: "organization_practice_profiles",  expected: 0 },
];

async function countRows(orgId: string | null, table: string) {
  const run = async () => withTenantTx(async (client) => {
    const r = await client.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
    return r.rows[0].n as number;
  });
  if (orgId === null) return run();
  return runWithTenantContext({ organizationId: orgId, userId: null, role: null }, run);
}

async function main() {
  console.log("Sprint 0 Step 5f — Tenant Isolation Verification (PROD expectations)");
  console.log("=====================================================================\n");
  let passed = 0, failed = 0; const failures: string[] = [];
  for (const c of cases) {
    const actual = await countRows(c.orgId, c.table);
    const ok = actual === c.expected;
    const line = `  [${ok ? "PASS" : "FAIL"}] ${c.caseName.padEnd(28)} ${c.table.padEnd(34)} expected=${c.expected} actual=${actual}`;
    console.log(line);
    ok ? passed++ : (failed++, failures.push(line.trim()));
  }
  console.log(`\n${passed} passed, ${failed} failed (${cases.length} total)`);
  if (failed > 0) { console.log("\nFailures:"); for (const f of failures) console.log("  - " + f); await pool.end(); process.exit(1); }
  console.log("\nAll tenant-isolation checks passed.");
  await pool.end(); process.exit(0);
}
main().catch((err) => { console.error("crashed:", err); pool.end().finally(() => process.exit(2)); });
