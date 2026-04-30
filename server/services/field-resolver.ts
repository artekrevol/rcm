import { pool } from "../db";

export interface FieldResolverContext {
  organizationId: string;
  payerId?: string;
  planProductCode?: string;
  delegatedEntityId?: string;
  serviceDate?: Date;
  /** When true, includes rows with is_demo_seed=TRUE in the corpus query.
   *  Default false — production evaluations never see placeholder demo rows. */
  includeDemoSeed?: boolean;
}

export interface ActivatedField {
  code: string;
  label: string;
  applies_to: "patient" | "claim";
  data_type: string;
  required: boolean;
  activated_by: string[];
  source_documents: string[];
}

interface CacheEntry {
  fields: ActivatedField[];
  expiresAt: number;
}

const resolverCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(ctx: FieldResolverContext): string {
  return [
    ctx.organizationId,
    ctx.payerId ?? "",
    ctx.planProductCode ?? "",
    ctx.delegatedEntityId ?? "",
    ctx.includeDemoSeed ? "demo" : "live",
  ].join("|");
}

export function invalidateResolverCache(organizationId: string): void {
  for (const key of resolverCache.keys()) {
    if (key.startsWith(organizationId + "|")) {
      resolverCache.delete(key);
    }
  }
}

export async function getActivatedFieldsForContext(
  ctx: FieldResolverContext
): Promise<ActivatedField[]> {
  const key = cacheKey(ctx);
  const now = Date.now();
  const cached = resolverCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.fields;
  }

  const result = await _resolve(ctx);
  resolverCache.set(key, { fields: result, expiresAt: now + CACHE_TTL_MS });
  return result;
}

async function _resolve(ctx: FieldResolverContext): Promise<ActivatedField[]> {
  const { organizationId, payerId, planProductCode, includeDemoSeed = false } = ctx;

  // Step 1: universal fields (always_required = TRUE)
  const { rows: universalRows } = await pool.query<{
    code: string;
    label: string;
    applies_to: string;
    data_type: string;
    activated_by_rule_kinds: string[];
  }>(
    `SELECT code, label, applies_to, data_type, activated_by_rule_kinds
       FROM field_definitions
      WHERE always_required = TRUE
      ORDER BY applies_to, code`
  );

  const universalFields: ActivatedField[] = universalRows.map((r) => ({
    code: r.code,
    label: r.label,
    applies_to: r.applies_to as "patient" | "claim",
    data_type: r.data_type,
    required: true,
    activated_by: [],
    source_documents: [],
  }));

  // Step 2: no payerId → return only universals
  if (!payerId) {
    return universalFields;
  }

  // Step 3: enrollment gate — check if org is enrolled with this payer
  const { rows: enrollmentRows } = await pool.query<{ id: string }>(
    `SELECT id FROM practice_payer_enrollments
      WHERE organization_id = $1
        AND payer_id = $2
        AND disabled_at IS NULL
      LIMIT 1`,
    [organizationId, payerId]
  );

  if (enrollmentRows.length === 0) {
    // Not enrolled → return only universal fields
    return universalFields;
  }

  // Step 4: query the active rule corpus for rule_kinds present for this payer/plan
  // Build plan-product filter
  const planFilter =
    planProductCode
      ? `AND (mei.applies_to_plan_products IS NULL
              OR mei.applies_to_plan_products = '[]'::jsonb
              OR mei.applies_to_plan_products @> $3::jsonb
              OR mei.applies_to_plan_products @> '["all"]'::jsonb)`
      : "";

  const params: (string | undefined)[] = [organizationId, payerId];
  if (planProductCode) params.push(JSON.stringify([planProductCode]));

  // Inject includeDemoSeed as a SQL literal (safe — it is always a boolean from code, not user input)
  const demoSeedFilter = includeDemoSeed ? "" : "AND mei.is_demo_seed = FALSE";

  const corpusQuery = `
    SELECT DISTINCT mei.section_type AS rule_kind, psd.id AS source_doc_id
      FROM manual_extraction_items mei
      JOIN payer_source_documents psd ON psd.id = mei.source_document_id
      WHERE psd.payer_id = $2
        AND mei.review_status = 'approved'
        AND psd.organization_id = $1
        AND mei.section_type IS NOT NULL
        ${demoSeedFilter}
        ${planFilter}
  `;

  let activeRuleKinds: string[] = [];
  let sourceDocIds: string[] = [];
  try {
    const { rows: corpusRows } = await pool.query<{
      rule_kind: string;
      source_doc_id: string;
    }>(corpusQuery, params);
    activeRuleKinds = [...new Set(corpusRows.map((r) => r.rule_kind))];
    sourceDocIds = [...new Set(corpusRows.map((r) => r.source_doc_id))];
  } catch {
    // rule_kinds table or join column may not be populated yet — safe to ignore
    activeRuleKinds = [];
    sourceDocIds = [];
  }

  if (activeRuleKinds.length === 0) {
    // No approved corpus rules — only universals
    return universalFields;
  }

  // Step 5: find conditional fields activated by any of the present rule kinds
  const { rows: conditionalRows } = await pool.query<{
    code: string;
    label: string;
    applies_to: string;
    data_type: string;
    activated_by_rule_kinds: string[];
  }>(
    `SELECT code, label, applies_to, data_type, activated_by_rule_kinds
       FROM field_definitions
      WHERE always_required = FALSE
        AND activated_by_rule_kinds != '[]'::jsonb
      ORDER BY applies_to, code`
  );

  const conditionalFields: ActivatedField[] = [];
  for (const row of conditionalRows) {
    const kinds: string[] = row.activated_by_rule_kinds ?? [];
    const matchedKinds = kinds.filter((k) => activeRuleKinds.includes(k));
    if (matchedKinds.length > 0) {
      conditionalFields.push({
        code: row.code,
        label: row.label,
        applies_to: row.applies_to as "patient" | "claim",
        data_type: row.data_type,
        required: false,
        activated_by: matchedKinds,
        source_documents: sourceDocIds,
      });
    }
  }

  // ── Chained-disclosure pattern ────────────────────────────────────────────
  // If no planProductCode was provided but the payer has active corpus rules,
  // the resolver can't yet determine which plan-specific fields to activate.
  // Return universals + patient_plan_product only so the form prompts the user
  // to select a plan product before revealing the next layer.
  if (!planProductCode) {
    const planProductField = conditionalFields.find((f) => f.code === "patient_plan_product");
    if (planProductField) {
      const chainedFields = [...universalFields, planProductField];
      const seenChained = new Set<string>();
      return chainedFields.filter((f) => {
        if (seenChained.has(f.code)) return false;
        seenChained.add(f.code);
        return true;
      });
    }
    // No patient_plan_product defined yet — fall through to full set
  }

  // Deduplicate by code (universal takes priority), sort by applies_to then code
  const allFields = [...universalFields, ...conditionalFields];
  const seen = new Set<string>();
  const deduped = allFields.filter((f) => {
    if (seen.has(f.code)) return false;
    seen.add(f.code);
    return true;
  });

  return deduped.sort((a, b) =>
    a.applies_to !== b.applies_to
      ? a.applies_to.localeCompare(b.applies_to)
      : a.code.localeCompare(b.code)
  );
}
