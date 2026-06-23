/**
 * Validation engine runner.
 * Loads a claim with all relations, resolves applicable rule packs,
 * runs every rule, and returns a structured ValidationResult.
 *
 * This is a pure read — no DB writes, no side effects.
 */

import { Pool } from 'pg';
import type {
  ValidationResult,
  ClaimWithRelations,
  RuleContext,
  Violation,
  NormalizedServiceLine,
  PatientRecord,
  PayerRecord,
  AuthRecord,
  ReferringProviderRecord,
  PracticeRecord,
} from './types.js';
import { resolvePacksForClaim } from '../pack-loader.js';

// Re-use the application pool via env var
function getPool(): Pool {
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

// ─── Normalizers ─────────────────────────────────────────────────────────────

function normalizeAddress(raw: unknown): { line1?: string; city?: string; state?: string; zip?: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, string>;
  return {
    line1: a.line1 || a.street || a.address1 || undefined,
    city: a.city || undefined,
    state: a.state || undefined,
    zip: a.zip || a.zipCode || a.postal_code || undefined,
  };
}

function normalizeServiceLines(raw: unknown[]): NormalizedServiceLine[] {
  return raw.map((sl: any, i) => ({
    index: i,
    hcpcsCode: sl.hcpcsCode || sl.hcpcs_code || sl.code || '',
    units: Number(sl.units) || 0,
    charge: Number(sl.charge) || Number(sl.amount) || Number(sl.total_charge) || 0,
    modifier: sl.modifier || null,
    diagnosisPointer: sl.diagnosisPointers || sl.diagnosisPointer || sl.diagnosis_pointer || 'A',
    serviceDate: sl.service_date_from || sl.service_date || sl.serviceDate || null,
    serviceDateTo: sl.service_date_to || null,
  }));
}

function buildIcd10Codes(primary: string | null, secondary: unknown): string[] {
  const codes: string[] = [];
  if (primary?.trim()) codes.push(primary.trim());
  if (Array.isArray(secondary)) {
    for (const c of secondary) {
      if (c && typeof c === 'string' && c.trim() && !codes.includes(c.trim())) {
        codes.push(c.trim());
      }
    }
  }
  return codes;
}

// ─── DB loaders ──────────────────────────────────────────────────────────────

async function loadClaimWithRelations(
  claimId: string,
  orgId: string,
  pool: Pool,
): Promise<ClaimWithRelations | null> {
  // Load claim
  const claimRes = await pool.query(
    'SELECT * FROM claims WHERE id = $1 AND organization_id = $2',
    [claimId, orgId],
  );
  if (!claimRes.rows.length) return null;
  const c = claimRes.rows[0];

  // Load patient
  const patRes = await pool.query('SELECT * FROM patients WHERE id = $1', [c.patient_id]);
  const pat = patRes.rows[0] ?? null;

  // Load payer
  let payerRecord: PayerRecord | null = null;
  if (c.payer_id) {
    const payerRes = await pool.query(
      `SELECT id, name, payer_id, payer_classification, claim_filing_indicator,
              member_id_qualifier, referring_provider_policy, auth_required
       FROM payers WHERE id = $1`,
      [c.payer_id],
    );
    if (payerRes.rows.length) {
      const p = payerRes.rows[0];
      payerRecord = {
        id: p.id,
        name: p.name,
        payerId: p.payer_id,
        payerClassification: p.payer_classification,
        claimFilingIndicator: p.claim_filing_indicator,
        memberIdQualifier: p.member_id_qualifier,
        referringProviderPolicy: p.referring_provider_policy ?? 'required',
        authRequired: !!p.auth_required,
      };
    }
  }

  // Load auth (by authorization_number)
  let auth: AuthRecord | null = null;
  if (c.authorization_number) {
    const authRes = await pool.query(
      `SELECT id, auth_number, expiration_date, requested_date
       FROM prior_authorizations
       WHERE auth_number = $1 AND organization_id = $2
       LIMIT 1`,
      [c.authorization_number, orgId],
    );
    if (authRes.rows.length) {
      const a = authRes.rows[0];
      auth = {
        id: a.id,
        authNumber: a.auth_number,
        expirationDate: a.expiration_date ? new Date(a.expiration_date).toISOString() : null,
        issuedDate: a.requested_date ? new Date(a.requested_date).toISOString() : null,
      };
    }
  }

  // Load referring provider
  let referringProvider: ReferringProviderRecord | null = null;
  if (c.referring_provider_id) {
    const rpRes = await pool.query(
      `SELECT id, first_name, last_name, npi, va_composite_id, verification_status
       FROM referring_providers WHERE id = $1`,
      [c.referring_provider_id],
    );
    if (rpRes.rows.length) {
      const rp = rpRes.rows[0];
      referringProvider = {
        id: rp.id,
        firstName: rp.first_name,
        lastName: rp.last_name,
        npi: rp.npi ?? null,
        vaCompositeId: rp.va_composite_id ?? null,
        verificationStatus: rp.verification_status ?? 'verified',
      };
    }
  }

  // Build patient record
  const patRecord: PatientRecord = pat ? {
    id: pat.id,
    firstName: pat.first_name ?? null,
    lastName: pat.last_name ?? null,
    middleName: pat.middle_name ?? null,
    dob: pat.dob ?? '',
    sex: pat.sex ?? null,
    memberId: pat.member_id ?? null,
    veteranIdType: pat.veteran_id_type ?? null,
    address: normalizeAddress(pat.address),
  } : {
    id: c.patient_id,
    firstName: null,
    lastName: null,
    middleName: null,
    dob: '',
    sex: null,
    memberId: null,
    veteranIdType: null,
    address: null,
  };

  const rawLines = Array.isArray(c.service_lines) ? c.service_lines : [];

  const base: ClaimWithRelations = {
    id: c.id,
    patientId: c.patient_id,
    organizationId: c.organization_id,
    status: c.status,
    payerFkId: c.payer_id ?? null,
    payerName: c.payer ?? payerRecord?.name ?? '',
    serviceDate: c.service_date ? new Date(c.service_date).toISOString().slice(0, 10) : null,
    placeOfService: c.place_of_service ?? '12',
    authorizationNumber: c.authorization_number ?? null,
    referringProviderId: c.referring_provider_id ?? null,
    icd10Codes: buildIcd10Codes(c.icd10_primary, c.icd10_secondary),
    serviceLines: normalizeServiceLines(rawLines),
    claimFrequencyCode: c.claim_frequency_code ?? '1',
    claimTransactionSet: c.claim_transaction_set ?? null,
    amount: Number(c.amount) || 0,
    patient: patRecord,
    payerRecord,
    auth,
    referringProvider,
  };

  // ── HH context enrichment (837I claims only) ─────────────────────────────
  // Loads episode / billing-period / NOA / PCR / practice data so HH packs
  // can evaluate rules without casting to 'any' with missing data.
  if (c.claim_transaction_set === '837I' && c.billing_period_id) {
    const [bpRes, psRes] = await Promise.all([
      pool.query(
        `SELECT episode_id, hipps_code, oasis_date, fips_county, cbsa_code
         FROM billing_periods WHERE id = $1 AND organization_id = $2`,
        [c.billing_period_id, orgId],
      ),
      pool.query(
        `SELECT rcd_review_choice FROM practice_settings WHERE organization_id = $1 LIMIT 1`,
        [orgId],
      ),
    ]);
    const bp = bpRes.rows[0] ?? null;
    const ps = psRes.rows[0] ?? null;

    if (bp) {
      const episodeId: string = bp.episode_id;

      const [visitRes, noaRes, epRes, pcrRes] = await Promise.all([
        pool.query(
          `SELECT discipline, COUNT(*) AS visit_count FROM episode_visits
           WHERE billing_period_id = $1 AND organization_id = $2 GROUP BY discipline`,
          [c.billing_period_id, orgId],
        ),
        pool.query(
          `SELECT status, penalty_days, filed_date FROM noa_filings
           WHERE episode_id = $1 AND organization_id = $2 ORDER BY created_at DESC LIMIT 1`,
          [episodeId, orgId],
        ),
        pool.query(
          `SELECT start_of_care_date FROM episodes WHERE id = $1 AND organization_id = $2`,
          [episodeId, orgId],
        ),
        pool.query(
          `SELECT utn_number FROM pre_claim_reviews
           WHERE episode_id = $1 AND organization_id = $2
             AND review_status IN ('affirmed','accepted','approved')
             AND utn_number IS NOT NULL
           ORDER BY created_at DESC LIMIT 1`,
          [episodeId, orgId],
        ),
      ]);

      const noa = noaRes.rows[0] ?? null;
      const ep  = epRes.rows[0] ?? null;
      const pcr = pcrRes.rows[0] ?? null;

      const REV_CODE: Record<string, string> = {
        'SN': '0551', 'skilled_nursing': '0551', 'skilled-nursing': '0551',
        'PT': '0421', 'physical_therapy': '0421', 'physical-therapy': '0421',
        'OT': '0431', 'occupational_therapy': '0431', 'occupational-therapy': '0431',
        'ST': '0441', 'speech_therapy': '0441', 'speech-therapy': '0441',
        'HHA': '0571', 'home_health_aide': '0571', 'home-health-aide': '0571',
        'MSW': '0561', 'medical_social_work': '0561', 'medical-social-work': '0561',
      };

      base.hippsCode       = bp.hipps_code ?? null;
      base.oasisDate       = bp.oasis_date ? new Date(bp.oasis_date).toISOString().slice(0, 10) : null;
      base.fipsCounty      = bp.fips_county ?? null;
      base.cbsaCode        = bp.cbsa_code ?? null;
      base.visitLines      = visitRes.rows.map((r: any) => ({
        revenueCode: REV_CODE[r.discipline as string] ?? '0559',
        visitCount: Number(r.visit_count),
      }));
      base.noaStatus       = noa?.status ?? null;
      base.noaPenaltyDays  = noa?.penalty_days ?? 0;
      base.noaFiledDate    = noa?.filed_date ? new Date(noa.filed_date).toISOString().slice(0, 10) : null;
      base.socDate         = ep?.start_of_care_date ? new Date(ep.start_of_care_date).toISOString().slice(0, 10) : null;
      base.rcdReviewChoice = ps?.rcd_review_choice ?? null;
      base.utnAffirmed     = !!pcr;
      base.utnNumber       = pcr?.utn_number ?? null;

      // visits_approved / visits_used from linked prior authorization
      if (c.authorization_number) {
        const authVRes = await pool.query(
          `SELECT visits_approved, visits_used FROM prior_authorizations
           WHERE auth_number = $1 AND organization_id = $2 LIMIT 1`,
          [c.authorization_number, orgId],
        );
        if (authVRes.rows.length) {
          base.visitsApproved = authVRes.rows[0].visits_approved ?? null;
          base.visitsUsed     = authVRes.rows[0].visits_used ?? null;
        }
      }
    }
  }

  return base;
}

async function loadPractice(orgId: string, pool: Pool): Promise<(PracticeRecord & { careModel: string }) | null> {
  const res = await pool.query(
    'SELECT * FROM practice_settings WHERE organization_id = $1 LIMIT 1',
    [orgId],
  );
  if (!res.rows.length) return null;
  const ps = res.rows[0];
  return {
    id: ps.id,
    practiceName: ps.practice_name ?? '',
    primaryNpi: ps.primary_npi ?? null,
    taxId: ps.tax_id ?? null,
    taxonomyCode: ps.taxonomy_code ?? null,
    address: normalizeAddress(ps.address),
    agencyNpi: ps.agency_npi ?? null,
    careModel: ps.care_model ?? 'outpatient_professional',
  };
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export async function runValidation(
  claimId: string,
  orgId: string,
  options?: { packIds?: string[] },
): Promise<ValidationResult> {
  const pool = getPool();
  try {
    const claim = await loadClaimWithRelations(claimId, orgId, pool);
    if (!claim) {
      return {
        claimId,
        packsApplied: [],
        violations: [{
          ruleId: 'ENGINE-NOT-FOUND',
          code: 'ENGINE-NOT-FOUND',
          severity: 'error',
          message: `Claim ${claimId} not found or access denied.`,
          fieldPath: 'id',
          packId: 'engine',
        }],
        canSubmit: false,
        checkedAt: new Date().toISOString(),
      };
    }

    const practice = await loadPractice(orgId, pool);
    if (!practice) {
      return {
        claimId,
        packsApplied: [],
        violations: [{
          ruleId: 'ENGINE-NO-PRACTICE',
          code: 'ENGINE-NO-PRACTICE',
          severity: 'error',
          message: 'Practice settings not configured. Cannot validate claim without billing provider info.',
          fieldPath: 'practice',
          packId: 'engine',
        }],
        canSubmit: false,
        checkedAt: new Date().toISOString(),
      };
    }

    const packs = resolvePacksForClaim(claim, options?.packIds, practice.careModel);

    // Build deduped, ordered rule list — more-specific (later) pack wins on duplicate id
    const ruleMap = new Map<string, { rule: typeof packs[0]['rules'][0]; packId: string }>();
    for (const pack of packs) {
      for (const rule of pack.rules) {
        if (ruleMap.has(rule.id)) {
          console.log(
            `[validation] Rule "${rule.id}" overridden by pack "${pack.id}" ` +
            `(was from "${ruleMap.get(rule.id)!.packId}")`,
          );
        }
        ruleMap.set(rule.id, { rule, packId: pack.id });
      }
    }

    const ctx: RuleContext = { claim, practice, today: new Date() };
    const violations: Violation[] = [];

    for (const { rule } of ruleMap.values()) {
      try {
        // Skip if appliesWhen gate is closed
        if (rule.appliesWhen && !rule.appliesWhen(ctx)) continue;

        const result = rule.check(ctx);
        if (result && result.length > 0) {
          violations.push(...result);
        }
      } catch (err: any) {
        console.error(`[validation] Rule "${rule.id}" threw an error:`, err?.message ?? err);
        violations.push({
          ruleId: rule.id,
          code: rule.code,
          severity: 'info',
          message: `Rule "${rule.id}" could not be evaluated: ${err?.message ?? 'unknown error'}. This is an engine bug — please report it.`,
          fieldPath: '',
          packId: 'engine',
        });
      }
    }

    const canSubmit = !violations.some(v => v.severity === 'error');

    return {
      claimId,
      packsApplied: packs.map(p => p.id),
      violations,
      canSubmit,
      checkedAt: new Date().toISOString(),
    };
  } finally {
    await pool.end();
  }
}
