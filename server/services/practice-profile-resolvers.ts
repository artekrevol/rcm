import { Pool } from "pg";

/**
 * Wave 2a — Practice Profile Resolvers
 *
 * All claim-time defaults that were previously hardcoded as schema-level
 * DEFAULT values (place_of_service='12', homebound_indicator='Y') are now
 * resolved at write-time from the organization's practice_settings row.
 *
 * In Wave 3q these will additionally consult a profile_settings JSONB column
 * so per-profile overrides can be stored without additional schema migrations.
 */

/**
 * Resolves the default place of service (POS) code for an organization.
 *
 * Returns practice_settings.default_pos when present, or null if the row
 * is missing or the column is unset.  Callers that need a hard value
 * (EDI generation, claim creation) should treat null as a validation error
 * rather than silently falling back to '12'.
 */
export async function resolvePos(
  organizationId: string | null | undefined,
  pool: Pool
): Promise<string | null> {
  if (!organizationId) return null;
  const { rows } = await pool.query(
    "SELECT default_pos FROM practice_settings WHERE organization_id = $1 LIMIT 1",
    [organizationId]
  );
  return rows[0]?.default_pos ?? null;
}

/**
 * Resolves whether homebound documentation is asserted by default for an
 * organization.  Reads practice_settings.homebound_default (BOOLEAN).
 * Returns false if the settings row is missing or the column is null.
 */
export async function resolveHomebound(
  organizationId: string | null | undefined,
  pool: Pool
): Promise<boolean> {
  if (!organizationId) return false;
  const { rows } = await pool.query(
    "SELECT homebound_default FROM practice_settings WHERE organization_id = $1 LIMIT 1",
    [organizationId]
  );
  return rows[0]?.homebound_default ?? false;
}

/**
 * Resolves the NPPES-registered legal name used in EDI NM1*41 (Submitter)
 * and NM1*85 (Billing Provider) segments.
 *
 * Returns legal_name when set, falls back to practice_name, returns '' if
 * neither is present.
 */
export async function resolveLegalName(
  organizationId: string | null | undefined,
  pool: Pool
): Promise<string> {
  if (!organizationId) return "";
  const { rows } = await pool.query(
    "SELECT COALESCE(legal_name, practice_name, '') AS resolved FROM practice_settings WHERE organization_id = $1 LIMIT 1",
    [organizationId]
  );
  return rows[0]?.resolved ?? "";
}
