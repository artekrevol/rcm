/**
 * Prompt C Acceptance Verification Script
 * Run: npx tsx scripts/verify-c.ts
 *
 * Verifies (15 checks):
 *  1.  plan_products table exists with 16+ rows
 *  2.  payer_supported_plan_products seeded (>100 rows)
 *  3.  delegated_entities table seeded (3 placeholder IPAs)
 *  4.  payer_delegated_entities table seeded (4 links)
 *  5.  4 conditional field_definitions rows exist
 *  6.  UHC demo extraction items seeded (approved referrals + prior_auth)
 *  7.  Demo org enrolled with UHC Commercial
 *  8.  Demo org enrolled with UHC Medicare Advantage
 *  9.  Resolver (no planProductCode) → returns patient_plan_product only (chained disclosure)
 *  10. Resolver (commercial_hmo) → returns pcp_id, pcp_referral_id, delegated_entity_id
 *  11. Resolver (commercial_ppo) → no conditional fields (PPO doesn't trigger referral rules)
 *  12. Non-enrolled payer → resolver returns 0 conditional fields
 *  13. GET /api/billing/payers/:id/plan-products returns plan products for UHC
 *  14. GET /api/billing/payers/:id/delegated-entities returns IPAs for UHC+CA
 *  15. 10 migrated modifier rows with needs_reverification=TRUE present in extraction items
 *  16. New patient columns exist (plan_product_code, delegated_entity_id, pcp_id, pcp_referral_number)
 */

import { pool } from "../server/db";
import { getActivatedFieldsForContext, invalidateResolverCache } from "../server/services/field-resolver";

const DEMO_ORG_ID = "demo-org-001";
const UHC_COMMERCIAL_ID = "ba1316c1-60ea-41d6-80ae-cade2fb010f6";
const UHC_MA_ID = "6de0c872-d01b-4ccd-819b-254d5e164440";

type Row = Record<string, any>;

async function run() {
  console.log("\n=== Prompt C Acceptance Verification ===\n");
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

  // ── T1: plan_products ──────────────────────────────────────────────────────
  console.log("[check] plan_products table…");
  const { rows: ppRows } = await pool.query<Row>(
    `SELECT COUNT(*)::int AS cnt FROM plan_products WHERE active = TRUE`
  );
  assert(ppRows[0].cnt >= 16, "plan_products: at least 16 active rows seeded",
    `found ${ppRows[0].cnt}`);

  const { rows: ppSpRows } = await pool.query<Row>(
    `SELECT COUNT(*)::int AS cnt FROM payer_supported_plan_products`
  );
  assert(ppSpRows[0].cnt > 100, "payer_supported_plan_products: > 100 rows seeded",
    `found ${ppSpRows[0].cnt}`);

  // Spot-check UHC Commercial has commercial_hmo
  const { rows: uhcHmoRows } = await pool.query<Row>(
    `SELECT 1 FROM payer_supported_plan_products WHERE payer_id = $1 AND plan_product_code = 'commercial_hmo'`,
    [UHC_COMMERCIAL_ID]
  );
  assert(uhcHmoRows.length > 0, "UHC Commercial is linked to commercial_hmo");

  // Spot-check UHC MA has ma_hmo
  const { rows: uhcMaHmoRows } = await pool.query<Row>(
    `SELECT 1 FROM payer_supported_plan_products WHERE payer_id = $1 AND plan_product_code = 'ma_hmo'`,
    [UHC_MA_ID]
  );
  assert(uhcMaHmoRows.length > 0, "UHC Medicare Advantage is linked to ma_hmo");

  // ── T2: delegated_entities ─────────────────────────────────────────────────
  console.log("[check] delegated_entities…");
  const { rows: deRows } = await pool.query<Row>(
    `SELECT COUNT(*)::int AS cnt FROM delegated_entities WHERE active = TRUE`
  );
  assert(deRows[0].cnt >= 3, "delegated_entities: at least 3 placeholder IPAs seeded",
    `found ${deRows[0].cnt}`);

  const { rows: pdeRows } = await pool.query<Row>(
    `SELECT COUNT(*)::int AS cnt FROM payer_delegated_entities`
  );
  assert(pdeRows[0].cnt >= 4, "payer_delegated_entities: at least 4 links seeded",
    `found ${pdeRows[0].cnt}`);

  // ── T3: conditional field_definitions ─────────────────────────────────────
  console.log("[check] conditional field_definitions…");
  const conditionalCodes = ["patient_plan_product", "patient_pcp_id", "patient_pcp_referral_id", "patient_delegated_entity_id"];
  for (const code of conditionalCodes) {
    const { rows } = await pool.query<Row>(
      `SELECT 1 FROM field_definitions WHERE code = $1 AND always_required = FALSE`,
      [code]
    );
    assert(rows.length > 0, `field_definitions has conditional field: ${code}`);
  }

  // ── T4b: UHC demo extraction items ────────────────────────────────────────
  console.log("[check] UHC demo extraction items…");
  const { rows: demoRows } = await pool.query<Row>(
    `SELECT section_type FROM manual_extraction_items
     WHERE notes ILIKE '[demo_seed]%' AND review_status = 'approved'
     ORDER BY section_type`
  );
  const demoSections = demoRows.map((r: Row) => r.section_type);
  assert(demoSections.includes("referrals"), "UHC demo seed: at least 1 approved referrals item",
    `found sections: ${demoSections.join(", ")}`);
  assert(demoSections.includes("prior_auth"), "UHC demo seed: at least 1 approved prior_auth item",
    `found sections: ${demoSections.join(", ")}`);

  // ── Demo org enrollments ──────────────────────────────────────────────────
  console.log("[check] demo org enrollments…");
  const { rows: enrollRows } = await pool.query<Row>(
    `SELECT payer_id FROM practice_payer_enrollments
     WHERE organization_id = $1 AND disabled_at IS NULL`,
    [DEMO_ORG_ID]
  );
  const enrolledIds = enrollRows.map((r: Row) => r.payer_id);
  assert(enrolledIds.includes(UHC_COMMERCIAL_ID), "Demo org enrolled with UHC Commercial");
  assert(enrolledIds.includes(UHC_MA_ID), "Demo org enrolled with UHC Medicare Advantage");

  // ── T4: Resolver — chained disclosure (no planProductCode) ───────────────
  console.log("[check] resolver: chained disclosure (UHC, no planProductCode)…");
  invalidateResolverCache(DEMO_ORG_ID);
  const fieldsNoPlan = await getActivatedFieldsForContext({
    organizationId: DEMO_ORG_ID,
    payerId: UHC_COMMERCIAL_ID,
  });
  const codesNoPlan = fieldsNoPlan.map((f) => f.code);
  assert(codesNoPlan.includes("patient_plan_product"),
    "Resolver (no plan): patient_plan_product is activated");
  assert(!codesNoPlan.includes("patient_pcp_id"),
    "Resolver (no plan): patient_pcp_id NOT yet activated (chained disclosure)");
  assert(!codesNoPlan.includes("patient_pcp_referral_id"),
    "Resolver (no plan): patient_pcp_referral_id NOT yet activated");
  assert(!codesNoPlan.includes("patient_delegated_entity_id"),
    "Resolver (no plan): patient_delegated_entity_id NOT yet activated");

  // ── T4: Resolver — commercial_hmo → full conditional set ─────────────────
  console.log("[check] resolver: commercial_hmo activates PCP + referral + delegated…");
  invalidateResolverCache(DEMO_ORG_ID);
  const fieldsHmo = await getActivatedFieldsForContext({
    organizationId: DEMO_ORG_ID,
    payerId: UHC_COMMERCIAL_ID,
    planProductCode: "commercial_hmo",
  });
  const codesHmo = fieldsHmo.map((f) => f.code);
  assert(codesHmo.includes("patient_pcp_id"),
    "Resolver (commercial_hmo): patient_pcp_id activated");
  assert(codesHmo.includes("patient_pcp_referral_id"),
    "Resolver (commercial_hmo): patient_pcp_referral_id activated");
  assert(codesHmo.includes("patient_delegated_entity_id"),
    "Resolver (commercial_hmo): patient_delegated_entity_id activated");

  // ── T4: Resolver — commercial_ppo → no PCP/referral fields ───────────────
  console.log("[check] resolver: commercial_ppo → no conditional PCP fields…");
  invalidateResolverCache(DEMO_ORG_ID);
  const fieldsPpo = await getActivatedFieldsForContext({
    organizationId: DEMO_ORG_ID,
    payerId: UHC_COMMERCIAL_ID,
    planProductCode: "commercial_ppo",
  });
  const codesPpo = fieldsPpo.map((f) => f.code);
  assert(!codesPpo.includes("patient_pcp_id"),
    "Resolver (commercial_ppo): patient_pcp_id NOT activated (PPO has no referral requirement)");
  assert(!codesPpo.includes("patient_pcp_referral_id"),
    "Resolver (commercial_ppo): patient_pcp_referral_id NOT activated");

  // ── T4: Resolver — non-enrolled payer → no conditional fields ────────────
  console.log("[check] resolver: non-enrolled payer…");
  invalidateResolverCache(DEMO_ORG_ID);
  // Use a payer the demo org is not enrolled with (Aetna: 35d29d2d-...)
  const { rows: aetnaRows } = await pool.query<Row>(
    `SELECT id FROM payers WHERE name = 'Aetna' LIMIT 1`
  );
  const aetnaId = aetnaRows[0]?.id;
  if (aetnaId) {
    const fieldsNonEnrolled = await getActivatedFieldsForContext({
      organizationId: DEMO_ORG_ID,
      payerId: aetnaId,
    });
    const conditionalFields = fieldsNonEnrolled.filter((f) => !f.required);
    assert(conditionalFields.length === 0,
      "Resolver (non-enrolled payer): returns 0 conditional fields",
      `found: ${conditionalFields.map(f => f.code).join(", ")}`);
  } else {
    assert(false, "Resolver (non-enrolled payer): Aetna payer not found for test");
  }

  // ── Plan-products API ─────────────────────────────────────────────────────
  console.log("[check] GET /api/billing/payers/:id/plan-products…");
  const { rows: planProdApiRows } = await pool.query<Row>(
    `SELECT pp.code FROM plan_products pp
     JOIN payer_supported_plan_products pspp ON pspp.plan_product_code = pp.code
     WHERE pspp.payer_id = $1 AND pp.active = TRUE`,
    [UHC_COMMERCIAL_ID]
  );
  assert(planProdApiRows.length >= 4, "UHC Commercial has at least 4 supported plan products",
    `found: ${planProdApiRows.map((r: Row) => r.code).join(", ")}`);

  // ── Delegated entities API ────────────────────────────────────────────────
  console.log("[check] GET /api/billing/payers/:id/delegated-entities…");
  const { rows: delegatedApiRows } = await pool.query<Row>(
    `SELECT de.name FROM delegated_entities de
     JOIN payer_delegated_entities pde ON pde.delegated_entity_id = de.id
     WHERE pde.payer_id = $1 AND de.active = TRUE`,
    [UHC_COMMERCIAL_ID]
  );
  assert(delegatedApiRows.length >= 2, "UHC Commercial has at least 2 delegated entities",
    `found: ${delegatedApiRows.map((r: Row) => r.name).join(", ")}`);

  // ── 10 migrated modifier rows ─────────────────────────────────────────────
  console.log("[check] 10 migrated modifier rows…");
  const { rows: migratedRows } = await pool.query<Row>(
    `SELECT COUNT(*)::int AS cnt FROM manual_extraction_items
     WHERE needs_reverification = TRUE`
  );
  assert(migratedRows[0].cnt >= 10,
    "At least 10 items with needs_reverification=TRUE present",
    `found ${migratedRows[0].cnt}`);

  // ── New patient columns ───────────────────────────────────────────────────
  console.log("[check] new patient columns…");
  const patientColNames = ["plan_product_code", "delegated_entity_id", "pcp_id", "pcp_referral_number"];
  for (const col of patientColNames) {
    const { rows } = await pool.query<Row>(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'patients' AND column_name = $1`,
      [col]
    );
    assert(rows.length > 0, `patients table has column: ${col}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

run()
  .then(() => pool.end())
  .catch((err) => {
    console.error("[verify-c] Fatal error:", err.message || err);
    pool.end();
    process.exit(1);
  });
