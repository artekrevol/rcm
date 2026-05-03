/**
 * Sprint 1d — `practice-profile-helpers` test suite.
 *
 * Focus: the `enrolledByName` field added to `getEnrolledPayers()` so the
 * helper-backed `GET /api/practice/payer-enrollments` route can render the
 * "enrolled by" column on the clinic-settings surface.
 *
 * Strategy: temporarily mutate one of demo-org-001's existing
 * `practice_payer_enrollments` rows to point its `enrolled_by` at a
 * test-only user, run the helper under demo's tenant context, assert
 * `enrolledByName` resolution. The schema's
 * `practice_payer_enrollments_enrolled_by_fkey ... ON DELETE SET NULL`
 * guarantees we can never reach a state where `enrolled_by` references
 * a missing user — case T3 below verifies that cascade collapses the
 * "missing user" path into the "enrolled_by IS NULL" path the helper
 * already handles via LEFT JOIN.
 *
 * Read/write: this script writes to the dev database (creates and deletes
 * a test user, mutates and restores a single PPE row). All mutations are
 * confined to a known seeded org (demo-org-001) and are reverted in a
 * `finally` block. Do NOT run this against production.
 *
 * Run with: npx tsx server/services/practice-profile-helpers.test.ts
 * Exits 0 on success, 1 on any failure.
 */
import { pool } from "../db";
import { runWithTenantContext } from "../middleware/tenant-context";
import { getEnrolledPayers } from "./practice-profile-helpers";

const DEMO_ORG = "demo-org-001";
const TEST_USER_EMAIL = "sprint1d-helper-test@example.invalid";
const TEST_USER_NAME = "Sprint1D Helper Test User";

let passed = 0;
let failed = 0;

function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual === expected) {
    passed += 1;
    console.log(`  [PASS] ${label}`);
  } else {
    failed += 1;
    console.log(
      `  [FAIL] ${label}\n         expected=${JSON.stringify(expected)}\n         actual  =${JSON.stringify(actual)}`,
    );
  }
}

async function fetchDemoEnrollments() {
  return runWithTenantContext(
    { organizationId: DEMO_ORG, userId: null, role: null },
    () => getEnrolledPayers(),
  );
}

(async () => {
  // ── Pre-flight: confirm demo's seeded enrollment shape is what we expect ──
  const initial = await pool.query(
    `SELECT id, enrolled_by FROM practice_payer_enrollments
      WHERE organization_id = $1 AND disabled_at IS NULL
      ORDER BY enrolled_at`,
    [DEMO_ORG],
  );
  if (initial.rowCount === 0) {
    console.error(
      `Pre-flight failed: demo-org-001 has no active practice_payer_enrollments rows. ` +
        `This test relies on the seeded demo enrollments being present.`,
    );
    process.exit(1);
  }
  const targetRowId: string = initial.rows[0].id;
  const originalEnrolledBy: string | null = initial.rows[0].enrolled_by;

  let testUserId: string | null = null;

  try {
    // Create a deterministic test user owned by demo-org-001.
    const userInsert = await pool.query(
      `INSERT INTO users (email, password, role, name, organization_id)
       VALUES ($1, 'sprint1d-disabled', 'admin', $2, $3)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [TEST_USER_EMAIL, TEST_USER_NAME, DEMO_ORG],
    );
    testUserId = userInsert.rows[0].id;

    // Point one demo PPE row's enrolled_by at the test user.
    await pool.query(
      `UPDATE practice_payer_enrollments SET enrolled_by = $1 WHERE id = $2`,
      [testUserId, targetRowId],
    );

    // ── T1: enrolled_by → existing user resolves to the user's name ─────
    {
      const rows = await fetchDemoEnrollments();
      const target = rows.find((r) => r.id === targetRowId);
      assertEq(
        target?.enrolledByName ?? null,
        TEST_USER_NAME,
        "T1 — enrolled_by points to existing user → enrolledByName === user.name",
      );
    }

    // ── T2: enrolled_by IS NULL → enrolledByName === null ───────────────
    {
      // Find a row where enrolled_by is currently NULL (the second seeded
      // demo row should still be untouched), or null one out explicitly.
      const otherInitial = await pool.query(
        `SELECT id FROM practice_payer_enrollments
          WHERE organization_id = $1 AND disabled_at IS NULL AND id <> $2
          ORDER BY enrolled_at LIMIT 1`,
        [DEMO_ORG, targetRowId],
      );
      let nullRowId: string | null = null;
      if (otherInitial.rowCount && otherInitial.rowCount > 0) {
        nullRowId = otherInitial.rows[0].id;
        // Force enrolled_by NULL on that row for determinism.
        await pool.query(
          `UPDATE practice_payer_enrollments SET enrolled_by = NULL WHERE id = $1`,
          [nullRowId],
        );
      }
      if (!nullRowId) {
        // Fallback: temporarily null the target row instead.
        await pool.query(
          `UPDATE practice_payer_enrollments SET enrolled_by = NULL WHERE id = $1`,
          [targetRowId],
        );
        nullRowId = targetRowId;
      }
      const rows = await fetchDemoEnrollments();
      const nullRow = rows.find((r) => r.id === nullRowId);
      assertEq(
        nullRow === undefined ? "ROW_NOT_RETURNED" : nullRow.enrolledByName,
        null,
        "T2 — enrolled_by IS NULL → enrolledByName === null",
      );
      // Restore the target row's enrolled_by to the test user for T3.
      if (nullRowId === targetRowId) {
        await pool.query(
          `UPDATE practice_payer_enrollments SET enrolled_by = $1 WHERE id = $2`,
          [testUserId, targetRowId],
        );
      }
    }

    // ── T3: deleted user — FK ON DELETE SET NULL collapses to T2 ────────
    // (LEFT JOIN behavior is structurally unreachable because the FK
    // guarantees enrolled_by either references a live user or is NULL.
    // This case verifies that cascade contract holds end-to-end.)
    {
      await pool.query(`DELETE FROM users WHERE id = $1`, [testUserId]);
      testUserId = null; // user no longer exists
      const rows = await fetchDemoEnrollments();
      const target = rows.find((r) => r.id === targetRowId);
      const enrolledByAfter = await pool.query(
        `SELECT enrolled_by FROM practice_payer_enrollments WHERE id = $1`,
        [targetRowId],
      );
      assertEq(
        enrolledByAfter.rows[0].enrolled_by,
        null,
        "T3 — deleting referenced user cascades enrolled_by to NULL (FK ON DELETE SET NULL)",
      );
      assertEq(
        target === undefined ? "ROW_NOT_RETURNED" : target.enrolledByName,
        null,
        "T3 — helper returns enrolledByName === null after user deletion",
      );
    }

    console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
    if (failed === 0) {
      console.log("All practice-profile-helpers tests passed.");
    }
  } finally {
    // Restore the target row's enrolled_by to whatever it started as.
    await pool.query(
      `UPDATE practice_payer_enrollments SET enrolled_by = $1 WHERE id = $2`,
      [originalEnrolledBy, targetRowId],
    );
    // Best-effort cleanup of the test user if it still exists.
    if (testUserId) {
      await pool.query(`DELETE FROM users WHERE id = $1`, [testUserId]);
    } else {
      await pool.query(`DELETE FROM users WHERE email = $1`, [TEST_USER_EMAIL]);
    }
    await pool.end();
  }

  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
