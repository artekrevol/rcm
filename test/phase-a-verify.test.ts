/**
 * Phase A Runtime Verification Harness
 *
 * Proves the guardrails BEHAVE, not just that the app compiles.
 * Run with: NODE_OPTIONS='--import tsx/esm' node --test test/phase-a-verify.test.ts
 *
 * Checks covered:
 *   1 — outpatient org sees ZERO home-health surfaces (resolveSegmentFeatures)
 *   2 — episode-completeness gate blocks (RED not YELLOW) for unsigned visits
 *   3 — NOA 5-day clock + late penalty (computeNoaStatus)
 *   4 — cross-tenant read returns nothing (RLS via withTenantTx)
 *
 * Check 0 (care_model DB enum) is a psql one-liner; run it separately.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ── Check 1 — resolveSegmentFeatures ────────────────────────────────────────

describe("Check 1 — segment feature isolation", async () => {
  const { resolveSegmentFeatures } = await import(
    "../shared/segment-features.js"
  ) as typeof import("../shared/segment-features");

  test("outpatient org exposes no HH features", () => {
    const features = resolveSegmentFeatures({ care_model: "outpatient_professional" });
    assert.equal(features.showEpisodes, false, "showEpisodes must be false for outpatient");
    assert.equal(features.showNoaDashboard, false, "showNoaDashboard must be false for outpatient");
    assert.equal(features.showRcdPanel, false, "showRcdPanel must be false for outpatient");
    assert.equal(features.showHippsEntry, false, "showHippsEntry must be false for outpatient");
    assert.equal(features.showVisitLog, false, "showVisitLog must be false for outpatient");
  });

  test("home_health_skilled org exposes all HH features", () => {
    const features = resolveSegmentFeatures({ care_model: "home_health_skilled" });
    assert.equal(features.showEpisodes, true, "showEpisodes must be true for HH");
    assert.equal(features.showNoaDashboard, true, "showNoaDashboard must be true for HH");
    assert.equal(features.showRcdPanel, true, "showRcdPanel must be true for HH");
    assert.equal(features.showHippsEntry, true, "showHippsEntry must be true for HH");
    assert.equal(features.showVisitLog, true, "showVisitLog must be true for HH");
  });

  test("home_health_personal_care (501 guarded) exposes no HH features", () => {
    const features = resolveSegmentFeatures({ care_model: "home_health_personal_care" });
    assert.equal(features.showEpisodes, false, "501-guarded segment must not show HH features");
    assert.equal(features.showNoaDashboard, false);
  });
});

// ── Check 2 — completeness gate (must be RED not YELLOW) ────────────────────

describe("Check 2 — episode completeness gate", async () => {
  const { runHhEpisodeCompleteness } = await import(
    "../server/services/validation/packs/hh-episode-completeness.js"
  ) as typeof import("../server/services/validation/packs/hh-episode-completeness");

  const periodWithUnsignedVisit = {
    episode: { soc_date: "2026-06-01", primary_diagnosis: "Z00.00" },
    poc_present: true,
    orders_present: true,
    soc_present: true,
    visits: [
      { id: "v1", documented: true,  signed: true  },
      { id: "v2", documented: true,  signed: false }, // the problem
    ],
  };

  test("period with an unsigned visit cannot reach ready_to_bill (ERROR severity)", () => {
    const result = runHhEpisodeCompleteness(periodWithUnsignedVisit);
    const hasBlockingError = result.findings.some((f) => f.severity === "error");
    assert.equal(hasBlockingError, true,
      "Unsigned visit must produce an ERROR (blocking) finding, not just a warning");
  });

  test("period with undocumented visit also returns an ERROR", () => {
    const periodWithUndocumented = {
      ...periodWithUnsignedVisit,
      visits: [
        { id: "v1", documented: false, signed: false },
        { id: "v2", documented: true,  signed: true  },
      ],
    };
    const result = runHhEpisodeCompleteness(periodWithUndocumented);
    const hasBlockingError = result.findings.some((f) => f.severity === "error");
    assert.equal(hasBlockingError, true,
      "Undocumented visit must produce an ERROR (blocking) finding");
  });

  test("fully documented + signed period passes (no blocking error)", () => {
    const clean = {
      ...periodWithUnsignedVisit,
      visits: [
        { id: "v1", documented: true, signed: true },
        { id: "v2", documented: true, signed: true },
      ],
    };
    const result = runHhEpisodeCompleteness(clean);
    const hasBlockingError = result.findings.some((f) => f.severity === "error");
    assert.equal(hasBlockingError, false,
      "Fully documented+signed period must have zero blocking errors");
  });

  test("empty visit list passes (no visits = no documentation gaps)", () => {
    const empty = { ...periodWithUnsignedVisit, visits: [] };
    const result = runHhEpisodeCompleteness(empty);
    const hasBlockingError = result.findings.some((f) => f.severity === "error");
    assert.equal(hasBlockingError, false);
  });
});

// ── Check 3 — NOA 5-day clock + late penalty (calendar days) ────────────────

describe("Check 3 — NOA clock and penalty", async () => {
  const { computeNoaStatus } = await import(
    "../server/services/hh/noa.js"
  ) as typeof import("../server/services/hh/noa");

  test("NOA due date is SOC + 5 calendar days", () => {
    const { due_date } = computeNoaStatus({ soc_date: "2026-06-01", filed_date: null });
    assert.equal(due_date, "2026-06-06",
      "due_date must be SOC + 5 calendar days (2026-06-01 + 5 = 2026-06-06)");
  });

  test("NOA filed on day 7 after SOC is late with 2 penalty days", () => {
    // SOC 2026-06-01 → due 2026-06-06, filed 2026-06-08 → 2 days late
    const status = computeNoaStatus({ soc_date: "2026-06-01", filed_date: "2026-06-08" });
    assert.equal(status.status, "late", "Filing after due date must mark status as 'late'");
    assert.equal(status.penalty_days, 2, "2 penalty days: filed 06-08, due 06-06");
  });

  test("NOA filed on due date is on time with no penalty", () => {
    // SOC 2026-06-01 → due 2026-06-06, filed on due date
    const status = computeNoaStatus({ soc_date: "2026-06-01", filed_date: "2026-06-06" });
    assert.notEqual(status.status, "late", "Filing on due date must not be 'late'");
    assert.equal(status.penalty_days, 0, "No penalty when filed on due date");
  });

  test("NOA filed before due date is on time with no penalty", () => {
    // SOC 2026-06-01 → due 2026-06-06, filed 2026-06-05
    const status = computeNoaStatus({ soc_date: "2026-06-01", filed_date: "2026-06-05" });
    assert.notEqual(status.status, "late");
    assert.equal(status.penalty_days, 0);
  });

  test("NOA not yet filed is pending with no penalty", () => {
    const status = computeNoaStatus({ soc_date: "2026-06-01", filed_date: null });
    assert.equal(status.status, "pending");
    assert.equal(status.penalty_days, 0);
  });

  test("month-boundary: SOC 2026-06-28, due is 2026-07-03", () => {
    const { due_date } = computeNoaStatus({ soc_date: "2026-06-28", filed_date: null });
    assert.equal(due_date, "2026-07-03");
  });
});

// ── Check 4 — cross-tenant RLS (requires live DB) ───────────────────────────

describe("Check 4 — cross-tenant RLS isolation", { skip: !process.env.DATABASE_URL }, async () => {
  const crypto = await import("node:crypto");

  const { withTenantTx } = await import(
    "../server/middleware/tenant-context.js"
  ) as typeof import("../server/middleware/tenant-context");

  const ORG_A = "chajinel-org-001";
  const ORG_B = "caritas-org-001";
  const TEST_PATIENT = "chajinel-patient-001";

  const episodeId = crypto.default.randomUUID();

  test("org B cannot read org A's episode (RLS enforced)", async () => {
    // Insert episode as org A
    await withTenantTx(async (client) => {
      await client.query(
        `INSERT INTO episodes
           (id, organization_id, patient_id, cert_period_start, cert_period_end,
            start_of_care_date, episode_status, created_at, updated_at)
         VALUES ($1,$2,$3,'2026-06-01','2026-07-30','2026-06-01','active',NOW(),NOW())`,
        [episodeId, ORG_A, TEST_PATIENT]
      );
    }, ORG_A);

    // Org A can read its own episode
    const seenByA = await withTenantTx(async (client) => {
      const { rows } = await client.query(
        `SELECT id FROM episodes WHERE id = $1`,
        [episodeId]
      );
      return rows;
    }, ORG_A);
    assert.equal(seenByA.length, 1, "Org A must be able to read its own episode");

    // Org B must see zero rows (RLS blocks cross-tenant reads)
    const seenByB = await withTenantTx(async (client) => {
      const { rows } = await client.query(
        `SELECT id FROM episodes WHERE id = $1`,
        [episodeId]
      );
      return rows;
    }, ORG_B);
    assert.equal(seenByB.length, 0,
      "RLS must prevent org B from reading org A's episode. " +
      "If this fails: episodes table may have RLS enabled but not FORCED, " +
      "or withTenantTx is not setting app.current_organization_id correctly.");

    // Clean up
    await withTenantTx(async (client) => {
      await client.query(`DELETE FROM episodes WHERE id = $1`, [episodeId]);
    }, ORG_A);
  });
});
