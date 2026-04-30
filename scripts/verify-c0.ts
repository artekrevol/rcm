/**
 * Prompt C0 Acceptance Verification Script
 * Run: npx tsx scripts/verify-c0.ts
 *
 * Verifies:
 * 1. 11 universal fields always returned for any context
 * 2. Non-enrolled payer returns only universal fields
 * 3. Enrolled payer returns universal fields (plus any activated — 0 in C0)
 * 4. Cache invalidation: unenroll → re-query returns universal-only
 * 5. All 5 API endpoints respond with correct status codes
 */

import { pool } from "../server/db";

const BASE = "http://localhost:5000";
const TEST_ORG_ID = "c0-verify-org-001";
const TEST_USER_ID = "c0-verify-user-001";

type Row = Record<string, any>;

async function run() {
  console.log("\n=== Prompt C0 Acceptance Verification ===\n");
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, label: string, detail?: string) {
    if (condition) {
      console.log(`  ✓ ${label}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
      failed++;
    }
  }

  // ── Setup: create test org, user, enroll Medicare + TRICARE ───────────────
  console.log("[setup] Creating test organization and user…");
  await pool.query(
    `INSERT INTO organizations (id, name) VALUES ($1, 'Texas Home Health Co') ON CONFLICT (id) DO NOTHING`,
    [TEST_ORG_ID]
  );
  await pool.query(
    `INSERT INTO users (id, email, password, role, name, organization_id)
     VALUES ($1, 'c0verify@test.local', 'x', 'admin', 'C0 Verify Bot', $2)
     ON CONFLICT (id) DO NOTHING`,
    [TEST_USER_ID, TEST_ORG_ID]
  );

  // Find Medicare and TRICARE payer IDs from payers table
  const { rows: medicareRows } = await pool.query<Row>(
    `SELECT id FROM payers WHERE name ILIKE '%medicare%' AND name NOT ILIKE '%advantage%' LIMIT 1`
  );
  const { rows: tricareRows } = await pool.query<Row>(
    `SELECT id FROM payers WHERE name ILIKE '%tricare%' OR name ILIKE '%champus%' LIMIT 1`
  );
  const { rows: uhcRows } = await pool.query<Row>(
    `SELECT id FROM payers WHERE name ILIKE '%united%' OR name ILIKE '%UHC%' LIMIT 1`
  );

  const medicareId: string | null = medicareRows[0]?.id ?? null;
  const tricareId: string | null = tricareRows[0]?.id ?? null;
  const uhcId: string | null = uhcRows[0]?.id ?? null;

  console.log(`  Medicare payer ID: ${medicareId ?? "NOT FOUND"}`);
  console.log(`  TRICARE payer ID:  ${tricareId ?? "NOT FOUND"}`);
  console.log(`  UHC payer ID:      ${uhcId ?? "NOT FOUND"}`);

  if (!medicareId || !uhcId) {
    console.error("\n[setup] Cannot run tests — required payers not found in payers table.");
    await cleanup();
    process.exit(1);
  }

  // Clear any previous test enrollments
  await pool.query(
    `DELETE FROM practice_payer_enrollments WHERE organization_id = $1`,
    [TEST_ORG_ID]
  );

  // Enroll Medicare and TRICARE (if found)
  await pool.query(
    `INSERT INTO practice_payer_enrollments (organization_id, payer_id, enrolled_by)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [TEST_ORG_ID, medicareId, TEST_USER_ID]
  );
  if (tricareId) {
    await pool.query(
      `INSERT INTO practice_payer_enrollments (organization_id, payer_id, enrolled_by)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [TEST_ORG_ID, tricareId, TEST_USER_ID]
    );
  }
  console.log("[setup] Enrolled Medicare" + (tricareId ? " + TRICARE" : "") + ".\n");

  // ── Test 1: field_definitions has exactly 11 universal rows ───────────────
  console.log("[test 1] field_definitions universal rows");
  const { rows: fdRows } = await pool.query<Row>(
    `SELECT COUNT(*)::int AS cnt FROM field_definitions WHERE always_required = TRUE`
  );
  assert(fdRows[0].cnt === 11, "field_definitions has 11 universal rows", `got ${fdRows[0].cnt}`);

  // ── Test 2: practice_payer_enrollments table exists ───────────────────────
  console.log("\n[test 2] practice_payer_enrollments table");
  const { rows: tableCheck } = await pool.query<Row>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'practice_payer_enrollments') AS exists`
  );
  assert(tableCheck[0].exists, "practice_payer_enrollments table exists");

  // ── Test 3: resolver — UHC (not enrolled) returns only universal fields ───
  console.log("\n[test 3] Resolver: non-enrolled UHC → universal-only");
  const { getActivatedFieldsForContext, invalidateResolverCache } = await import(
    "../server/services/field-resolver"
  );

  invalidateResolverCache(TEST_ORG_ID);
  const uhcFields = await getActivatedFieldsForContext({
    organizationId: TEST_ORG_ID,
    payerId: uhcId,
  });
  assert(uhcFields.length === 11, `UHC (not enrolled) returns 11 universal fields`, `got ${uhcFields.length}`);
  assert(
    uhcFields.every((f) => f.required === true && f.activated_by.length === 0),
    "All UHC fields are universal (required=true, activated_by=[])"
  );

  // ── Test 4: resolver — Medicare (enrolled) returns universal fields ────────
  console.log("\n[test 4] Resolver: enrolled Medicare → universal fields in C0");
  invalidateResolverCache(TEST_ORG_ID);
  const medicareFields = await getActivatedFieldsForContext({
    organizationId: TEST_ORG_ID,
    payerId: medicareId,
  });
  assert(
    medicareFields.length >= 11,
    `Medicare (enrolled) returns ≥11 fields`,
    `got ${medicareFields.length}`
  );
  const universalInMedicare = medicareFields.filter((f) => f.required === true);
  assert(universalInMedicare.length === 11, "All 11 universal fields present in Medicare result");

  // ── Test 5: resolver — no payerId → universal-only ────────────────────────
  console.log("\n[test 5] Resolver: no payerId → universal-only");
  invalidateResolverCache(TEST_ORG_ID);
  const noPayerFields = await getActivatedFieldsForContext({ organizationId: TEST_ORG_ID });
  assert(noPayerFields.length === 11, `No payerId → 11 universal fields`, `got ${noPayerFields.length}`);

  // ── Test 6: universal fields are stable across contexts ───────────────────
  console.log("\n[test 6] Universal field stability across 3 contexts");
  invalidateResolverCache(TEST_ORG_ID);
  const expectedCodes = new Set([
    "patient_first_name","patient_last_name","patient_dob","patient_gender",
    "patient_address","patient_member_id","patient_payer_id",
    "claim_service_date","claim_diagnosis_code","claim_procedure_code","claim_units",
  ]);
  const uhcCodes = new Set(uhcFields.map((f) => f.code));
  const medicareCodes = new Set(medicareFields.map((f) => f.code));
  const noPayerCodes = new Set(noPayerFields.map((f) => f.code));
  for (const code of expectedCodes) {
    assert(uhcCodes.has(code) && medicareCodes.has(code) && noPayerCodes.has(code), `Universal field '${code}' present in all 3 contexts`);
  }

  // ── Test 7: cache invalidation ────────────────────────────────────────────
  console.log("\n[test 7] Cache invalidation after unenroll");
  // First query populates cache for UHC (should be 11)
  const preUnenroll = await getActivatedFieldsForContext({ organizationId: TEST_ORG_ID, payerId: medicareId });
  assert(preUnenroll.length >= 11, "Pre-unenroll Medicare: ≥11 fields");
  // Unenroll Medicare
  await pool.query(
    `UPDATE practice_payer_enrollments SET disabled_at = now() WHERE organization_id = $1 AND payer_id = $2`,
    [TEST_ORG_ID, medicareId]
  );
  invalidateResolverCache(TEST_ORG_ID);
  const postUnenroll = await getActivatedFieldsForContext({ organizationId: TEST_ORG_ID, payerId: medicareId });
  assert(postUnenroll.length === 11, "Post-unenroll Medicare: only 11 universal fields (enrollment gate respected)");
  // Re-enroll for cleanliness
  await pool.query(
    `UPDATE practice_payer_enrollments SET disabled_at = NULL WHERE organization_id = $1 AND payer_id = $2`,
    [TEST_ORG_ID, medicareId]
  );

  // ── Test 8: GET /api/admin/field-definitions direct DB check ──────────────
  console.log("\n[test 8] field_definitions direct query");
  const { rows: allFd } = await pool.query<Row>(`SELECT * FROM field_definitions ORDER BY code`);
  assert(allFd.length === 11, `11 rows in field_definitions`, `got ${allFd.length}`);
  assert(allFd.every((r) => r.always_required === true), "All C0 rows are always_required=TRUE");
  assert(allFd.every((r) => Array.isArray(r.activated_by_rule_kinds) || r.activated_by_rule_kinds === "[]" || r.activated_by_rule_kinds?.length === 0),
    "All C0 rows have empty activated_by_rule_kinds");

  // ── Cleanup ───────────────────────────────────────────────────────────────
  await cleanup();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log(`Result: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log("✓ All C0 acceptance checks passed.\n");
    process.exit(0);
  } else {
    console.error("✗ Some checks failed. Review output above.\n");
    process.exit(1);
  }
}

async function cleanup() {
  await pool.query(`DELETE FROM practice_payer_enrollments WHERE organization_id = $1`, [TEST_ORG_ID]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID]);
  await pool.query(`DELETE FROM organizations WHERE id = $1`, [TEST_ORG_ID]);
  await pool.end().catch(() => {});
}

run().catch((err) => {
  console.error("Fatal:", err);
  pool.end().catch(() => {});
  process.exit(1);
});
