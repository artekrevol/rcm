import { pool } from "../db";

export interface OrgTemplate {
  id: string;
  template_key: string;
  channel: string;
  subject: string | null;
  body: string;
  variables: string[];
  is_active: boolean;
}

export interface OrgPersona {
  id: string;
  persona_key: string;
  vapi_assistant_id: string;
  persona_name: string;
  greeting: string | null;
  system_prompt: string | null;
  metadata: Record<string, unknown>;
  is_active: boolean;
  /**
   * Sprint 1b: when true, the voice-persona-builder service composes the
   * assembled prompt at call time (substituting the {{INTAKE_FIELDS}} block
   * from the active practice profile). When false (legacy default), the
   * outbound payload sends no system-message override and Vapi's static
   * dashboard prompt is used as-is.
   */
  compose_from_profile: boolean;
}

export interface OrgServiceType {
  id: string;
  service_code: string;
  service_name: string;
  description: string | null;
  metadata: Record<string, unknown>;
  is_active: boolean;
}

export interface OrgPayerMapping {
  id: string;
  payer_name: string;
  payer_id: string;
  payer_type: string | null;
  is_primary: boolean;
  is_active: boolean;
  metadata: Record<string, unknown>;
}

export interface OrgLeadSource {
  id: string;
  slug: string;
  label: string;
  source_type: string;
  is_active: boolean;
}

export interface OrgProvider {
  id: string;
  first_name: string;
  last_name: string;
  npi: string | null;
  email: string | null;
  phone: string | null;
  specialties: string[];
  service_types: string[];
  languages: string[];
  availability: Record<string, unknown>;
  metadata: Record<string, unknown>;
  is_active: boolean;
}

export interface OrgContext {
  organization_id: string;
  templates: Record<string, OrgTemplate>;
  personas: Record<string, OrgPersona>;
  service_types: OrgServiceType[];
  payers: OrgPayerMapping[];
  lead_sources: OrgLeadSource[];
  providers: OrgProvider[];
}

interface CacheEntry {
  context: OrgContext;
  expires_at: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 1000;

function makeTemplateKey(template_key: string, channel: string): string {
  return `${template_key}::${channel}`;
}

export async function getOrgContext(organizationId: string): Promise<OrgContext> {
  const now = Date.now();
  const cached = cache.get(organizationId);
  if (cached && cached.expires_at > now) {
    return cached.context;
  }

  const [tmplRes, personaRes, stRes, payerRes, lsRes, provRes] = await Promise.all([
    pool.query(
      `SELECT id, template_key, channel, subject, body, variables, is_active
       FROM org_message_templates
       WHERE organization_id = $1 AND is_active = true`,
      [organizationId]
    ),
    pool.query(
      `SELECT id, persona_key, vapi_assistant_id, persona_name, greeting, system_prompt, metadata, is_active, compose_from_profile
       FROM org_voice_personas
       WHERE organization_id = $1 AND is_active = true`,
      [organizationId]
    ),
    pool.query(
      `SELECT id, service_code, service_name, description, metadata, is_active
       FROM org_service_types
       WHERE organization_id = $1 AND is_active = true`,
      [organizationId]
    ),
    pool.query(
      `SELECT id, payer_name, payer_id, payer_type, is_primary, is_active, metadata
       FROM org_payer_mappings
       WHERE organization_id = $1 AND is_active = true`,
      [organizationId]
    ),
    pool.query(
      `SELECT id, slug, label, source_type, is_active
       FROM org_lead_sources
       WHERE organization_id = $1 AND is_active = true`,
      [organizationId]
    ),
    pool.query(
      `SELECT id, first_name, last_name, npi, email, phone, specialties,
              service_types, languages, availability, metadata, is_active
       FROM org_providers
       WHERE organization_id = $1 AND is_active = true`,
      [organizationId]
    ),
  ]);

  const templates: Record<string, OrgTemplate> = {};
  for (const row of tmplRes.rows) {
    templates[makeTemplateKey(row.template_key, row.channel)] = row;
    templates[row.template_key] = row;
  }

  const personas: Record<string, OrgPersona> = {};
  for (const row of personaRes.rows) {
    personas[row.persona_key] = row;
  }

  const context: OrgContext = {
    organization_id: organizationId,
    templates,
    personas,
    service_types: stRes.rows,
    payers: payerRes.rows,
    lead_sources: lsRes.rows,
    providers: provRes.rows,
  };

  cache.set(organizationId, { context, expires_at: now + CACHE_TTL_MS });
  return context;
}

export function invalidateOrgContext(organizationId: string): void {
  cache.delete(organizationId);
}

export function resolveCarrierToPayerId(
  carrierName: string,
  payers: OrgPayerMapping[]
): string {
  const n = carrierName.toLowerCase();
  for (const p of payers) {
    if (n.includes(p.payer_name.toLowerCase())) return p.payer_id;
  }
  return "00010";
}
