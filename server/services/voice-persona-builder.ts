/**
 * Voice persona system-prompt builder (Phase 3 Sprint 1b).
 *
 * Composes the assistant system prompt at call time. For personas with
 * `compose_from_profile = false` (the legacy default for every row at
 * sprint 1b ship), this returns the stored `system_prompt` byte-identical —
 * an opt-out, no-op contract. For personas with `compose_from_profile = true`,
 * the active practice profile's `intake_field_specs` array is rendered into
 * a "DATA TO CAPTURE DURING THE CALL" block, and either substituted into the
 * `{{INTAKE_FIELDS}}` placeholder or appended at the end of the static
 * prompt template.
 *
 * Why this lives here and not in `practice-profile-helpers.ts`:
 *   - `org_voice_personas` predates Phase 3. It has no RLS and no app-role
 *     grant routing — the global `pool` is used for the persona read.
 *   - Profile lookup uses `getActivePracticeProfile`, which already runs
 *     inside `withTenantTx` and respects the per-tenant RLS policies on
 *     `organization_practice_profiles`.
 *
 * Fail-safe rules (Hard Rule #5 in the sprint 1b prompt):
 *   - Persona row missing for the org → throw (caller must surface).
 *   - Persona opt-out (compose_from_profile=false) → return `system_prompt`
 *     verbatim. The `{{INTAKE_FIELDS}}` placeholder, if present in such a
 *     prompt, is left UN-substituted; opt-out personas should never have
 *     the placeholder in their stored prompt anyway.
 *   - Persona opt-in but org has no active profile → return `system_prompt`
 *     verbatim. Never send an unsubstituted `{{INTAKE_FIELDS}}` placeholder
 *     to Vapi.
 *   - Persona opt-in but profile has empty / missing `intakeFieldSpecs` →
 *     return `system_prompt` verbatim, no empty block appended.
 */
import { pool } from "../db";
import { getActivePracticeProfile } from "./practice-profile-helpers";

export interface IntakeFieldSpec {
  field_name?: string;
  display_label?: string;
  display_order?: number;
  field_group?: string;
  is_required?: boolean;
  /** Reserved — not present in seeded data as of sprint 1b but supported when it appears. */
  help_text?: string;
  /** Reserved — not present in seeded data as of sprint 1b but supported when it appears. */
  is_applicable?: boolean;
}

/**
 * Renders an `intake_field_specs` array into a Vapi-friendly system-prompt
 * block. Required fields are listed first, optional fields second. Specs
 * with `is_applicable === false` are excluded.
 *
 * Exported for unit tests; not called outside this module in production.
 */
export function renderIntakeFieldsForPrompt(specs: unknown): string {
  if (!Array.isArray(specs) || specs.length === 0) return "";

  const sorted = [...(specs as IntakeFieldSpec[])].sort((a, b) => {
    const ao = typeof a.display_order === "number" ? a.display_order : 999;
    const bo = typeof b.display_order === "number" ? b.display_order : 999;
    return ao - bo;
  });

  const required: string[] = [];
  const optional: string[] = [];

  for (const spec of sorted) {
    if (spec.is_applicable === false) continue;
    const label = spec.display_label || spec.field_name;
    if (!label) continue;
    let line = `- ${label}`;
    if (typeof spec.help_text === "string" && spec.help_text.trim().length > 0) {
      line += `\n  (${spec.help_text.trim()})`;
    }
    if (spec.is_required === true) required.push(line);
    else optional.push(line);
  }

  if (required.length === 0 && optional.length === 0) return "";

  const parts: string[] = ["DATA TO CAPTURE DURING THE CALL:"];
  if (required.length > 0) {
    parts.push("", "Required fields:", required.join("\n"));
  }
  if (optional.length > 0) {
    parts.push("", "Optional fields (capture if naturally offered):", optional.join("\n"));
  }
  return parts.join("\n");
}

/**
 * Returns the assembled system prompt for the org's primary intake voice
 * persona. See module-level fail-safe rules above.
 *
 * @throws when no `org_voice_personas` row exists for the org.
 */
export async function buildAssistantSystemPrompt(orgId: string): Promise<string> {
  // Persona read uses the global `pool` because `org_voice_personas` predates
  // Phase 3 RLS. Verified in sprint 1b §2: relrowsecurity=false, force_rls=false.
  const r = await pool.query(
    `SELECT system_prompt, compose_from_profile
       FROM org_voice_personas
      WHERE organization_id = $1
      ORDER BY persona_key
      LIMIT 1`,
    [orgId],
  );

  if (r.rowCount === 0) {
    throw new Error(`No voice persona configured for organization ${orgId}`);
  }

  const persona = r.rows[0] as { system_prompt: string | null; compose_from_profile: boolean };
  const systemPrompt: string = persona.system_prompt ?? "";

  // Opt-out (legacy default for every row at sprint 1b ship).
  if (!persona.compose_from_profile) {
    return systemPrompt;
  }

  // Opt-in. Resolve the active profile via the helper layer (RLS-aware).
  const active = await getActivePracticeProfile(orgId);
  const specs = active?.profile?.intakeFieldSpecs;

  // Fail-safe: no profile mapped, or specs missing/empty → return static prompt.
  if (!Array.isArray(specs) || specs.length === 0) {
    return systemPrompt;
  }

  const fieldsBlock = renderIntakeFieldsForPrompt(specs);
  if (fieldsBlock.length === 0) return systemPrompt;

  if (systemPrompt.includes("{{INTAKE_FIELDS}}")) {
    return systemPrompt.replaceAll("{{INTAKE_FIELDS}}", fieldsBlock);
  }
  return `${systemPrompt}\n\n${fieldsBlock}`;
}
