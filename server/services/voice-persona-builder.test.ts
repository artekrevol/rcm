/**
 * Tests for `voice-persona-builder.ts` (Phase 3 Sprint 1b, Step 8).
 *
 * Run: `npx tsx server/services/voice-persona-builder.test.ts`
 *
 * Strategy:
 *   - Direct renderer tests are unit-style (no DB).
 *   - Builder tests use existing Caritas (opt-out) + Chajinel (post-migration
 *     opt-in with placeholder) plus three synthetic test orgs that are
 *     INSERTed in setup and DELETEd in finally (no pollution of seeded data).
 *   - Synthetic test orgs require a row in `organizations` first because
 *     `organization_practice_profiles.organization_id` is FK-referenced.
 */
import { pool } from "../db";
import {
  buildAssistantSystemPrompt,
  renderIntakeFieldsForPrompt,
} from "./voice-persona-builder";

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

async function run(): Promise<void> {
  console.log("=== voice-persona-builder tests ===\n");

  // ─── Renderer (pure, no DB) ─────────────────────────────────────────────
  console.log("Renderer:");

  const sample = [
    { field_name: "first_name", display_label: "First name", display_order: 10, is_required: true },
    { field_name: "phone", display_label: "Phone", display_order: 20, is_required: true },
    { field_name: "notes", display_label: "Notes", display_order: 30, is_required: false },
  ];
  const r = renderIntakeFieldsForPrompt(sample);

  // T7: required/optional sections present and ordered
  assert(r.includes("Required fields:"), "T7a: 'Required fields:' header present");
  assert(r.includes("Optional fields"), "T7b: 'Optional fields' header present");
  assert(r.indexOf("Required") < r.indexOf("Optional"), "T7c: required section before optional");

  // T8: display_label rendered, NOT internal field_name
  assert(r.includes("First name"), "T8a: rendered display_label 'First name'");
  assert(!r.includes("first_name"), "T8b: did NOT render internal field_name 'first_name'");

  // T5: empty / missing
  assert(renderIntakeFieldsForPrompt([]) === "", "T5a: [] → empty string");
  assert(renderIntakeFieldsForPrompt(null) === "", "T5b: null → empty string");
  assert(renderIntakeFieldsForPrompt(undefined) === "", "T5c: undefined → empty string");

  // is_applicable=false skipping
  const withSkip = [
    { field_name: "x", display_label: "X", is_required: true },
    { field_name: "y", display_label: "Y", is_required: true, is_applicable: false },
  ];
  const r2 = renderIntakeFieldsForPrompt(withSkip);
  assert(r2.includes("X"), "T-applicable: includes applicable label");
  assert(!r2.includes("Y"), "T-applicable: skipped is_applicable=false");

  // ─── Builder against existing seeded orgs ───────────────────────────────
  console.log("\nBuilder (existing seeded orgs):");

  // T6: missing persona → throws
  const FAKE_ORG = "sprint1b-test-nonexistent-" + Date.now();
  let threw = false;
  let thrownMsg = "";
  try {
    await buildAssistantSystemPrompt(FAKE_ORG);
  } catch (e: any) {
    threw = true;
    thrownMsg = String(e?.message || e);
  }
  assert(threw, "T6a: throws for missing persona");
  assert(thrownMsg.includes("No voice persona configured"), "T6b: error message identifies cause");

  // T1: Caritas (opt-out, real seeded persona) → byte-identical to stored
  const caritas = await buildAssistantSystemPrompt("caritas-org-001");
  const storedCaritas = await pool.query(
    "SELECT system_prompt FROM org_voice_personas WHERE organization_id='caritas-org-001'",
  );
  assert(
    caritas === storedCaritas.rows[0].system_prompt,
    "T1: opt-out (Caritas) returns stored system_prompt byte-identical",
  );
  assert(!caritas.includes("DATA TO CAPTURE DURING THE CALL:"), "T1b: opt-out has no fields block");

  // T2: Chajinel (post-migration, opt-in, has {{INTAKE_FIELDS}}) → substituted
  const chajinel = await buildAssistantSystemPrompt("chajinel-org-001");
  assert(!chajinel.includes("{{INTAKE_FIELDS}}"), "T2a: {{INTAKE_FIELDS}} placeholder substituted");
  assert(chajinel.includes("DATA TO CAPTURE DURING THE CALL:"), "T2b: rendered block present");
  assert(chajinel.includes("Caller first name"), "T2c: known display_label substituted in");
  assert(
    chajinel.startsWith("You are an intake coordinator for Chajinel Clinic"),
    "T2d: greeting/conversation structure preserved",
  );

  // ─── Synthetic test orgs ────────────────────────────────────────────────
  console.log("\nBuilder (synthetic test orgs):");

  const stamp = Date.now();
  const ORG_NO_PROFILE = `sprint1b-test-noprof-${stamp}`;
  const ORG_NO_PLACEHOLDER = `sprint1b-test-noph-${stamp}`;
  const TEST_ORGS: string[] = [ORG_NO_PROFILE, ORG_NO_PLACEHOLDER];

  try {
    // Setup: organizations rows (FK target for organization_practice_profiles)
    for (const id of TEST_ORGS) {
      await pool.query(
        `INSERT INTO organizations (id, name, status, updated_at)
         VALUES ($1, $2, 'active', NOW())
         ON CONFLICT (id) DO NOTHING`,
        [id, `Test ${id}`],
      );
    }

    // Setup: persona rows
    await pool.query(
      `INSERT INTO org_voice_personas
         (organization_id, persona_key, vapi_assistant_id, persona_name, system_prompt, compose_from_profile, is_active)
       VALUES
         ($1, 'intake_coordinator', 'TEST_ASSISTANT', 'Test', 'OPTIN_NO_PROFILE_PROMPT {{INTAKE_FIELDS}}', true, true),
         ($2, 'intake_coordinator', 'TEST_ASSISTANT', 'Test', 'OPTIN_NO_PLACEHOLDER_PROMPT', true, true)`,
      [ORG_NO_PROFILE, ORG_NO_PLACEHOLDER],
    );

    // Setup: only ORG_NO_PLACEHOLDER gets a profile mapping
    await pool.query(
      `INSERT INTO organization_practice_profiles
         (organization_id, profile_code, is_primary, effective_from)
       VALUES ($1, 'home_care_agency_personal_care', true, CURRENT_DATE)`,
      [ORG_NO_PLACEHOLDER],
    );

    // T4: opt-in but no profile mapping → returns system_prompt verbatim
    //     (per Hard Rule #5 fail-safe: never throw, never send empty prompt)
    const noProf = await buildAssistantSystemPrompt(ORG_NO_PROFILE);
    assert(
      noProf === "OPTIN_NO_PROFILE_PROMPT {{INTAKE_FIELDS}}",
      "T4: opt-in + no profile → returns system_prompt verbatim (fail-safe)",
    );

    // T3: opt-in without placeholder → block appended at end
    const noPh = await buildAssistantSystemPrompt(ORG_NO_PLACEHOLDER);
    assert(noPh.startsWith("OPTIN_NO_PLACEHOLDER_PROMPT\n\n"), "T3a: original prompt prefix preserved");
    assert(noPh.includes("DATA TO CAPTURE DURING THE CALL:"), "T3b: rendered block appended");
    assert(noPh.includes("Caller first name"), "T3c: known display_label appended");
    assert(!noPh.includes("{{INTAKE_FIELDS}}"), "T3d: no placeholder leaked");
  } finally {
    // Cleanup in reverse FK order
    await pool.query(
      `DELETE FROM organization_practice_profiles WHERE organization_id = ANY($1::text[])`,
      [TEST_ORGS],
    );
    await pool.query(
      `DELETE FROM org_voice_personas WHERE organization_id = ANY($1::text[])`,
      [TEST_ORGS],
    );
    await pool.query(
      `DELETE FROM organizations WHERE id = ANY($1::text[])`,
      [TEST_ORGS],
    );
  }

  console.log(`\n${passed} passed, ${failed} failed (${passed + failed} total)`);
  await pool.end();
  if (failed > 0) {
    console.error("\nVoice persona builder tests FAILED.");
    process.exit(1);
  }
  console.log("\nAll voice-persona-builder tests passed.");
}

run().catch(async (e) => {
  console.error(e);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
