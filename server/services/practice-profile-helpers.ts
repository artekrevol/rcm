/**
 * Practice-profile-aware helper service layer (Phase 3 Sprint 0, Step 6).
 *
 * Reads tenant-scoped data through `withTenantTx` so RLS policies on the new
 * Phase-3 tables filter rows to the calling organization. **Every function
 * here connects via `withTenantTx`, NOT via the global `db` import**, because
 * the global `db` connects as the postgres superuser and bypasses RLS. New
 * helpers that need tenant isolation MUST follow this pattern.
 *
 * Sprint 0 status: helpers are not yet wired into any route or cron job.
 * Step 8's feature flag (`USE_PROFILE_AWARE_QUERIES`) gates the eventual
 * wiring. Sprint 0 includes a smoke test in `getActivePracticeProfile` —
 * calling it with `chajinel-org-001` returns the seeded
 * `home_care_agency_personal_care` profile.
 *
 * Sprint 1 prerequisite: the tenant_isolation policies use only USING (no
 * WITH CHECK). Helpers in this file are read-only; once Sprint 1 introduces
 * INSERT helpers, the WITH CHECK clauses must be added first — see
 * `docs/architecture/migration-state.md`.
 */
import { withTenantTx } from "../middleware/tenant-context";
import type {
  PracticeProfile,
  OrganizationPracticeProfile,
  PracticePayerEnrollment,
  ProviderPracticeRelationship,
  ProviderPayerRelationship,
  PatientInsuranceEnrollment,
  ClaimProviderAssignment,
} from "@shared/schema";

/**
 * Returns the organization's primary practice profile, joined with the
 * global catalog row. Returns null if no mapping exists for the tenant.
 *
 * Used by route handlers and the EDI generator (Sprint 2+) to drive
 * profile-aware behavior such as default place_of_service or whether to
 * omit the rendering provider loop.
 */
export async function getActivePracticeProfile(
  organizationIdOverride?: string,
): Promise<(OrganizationPracticeProfile & { profile: PracticeProfile }) | null> {
  return withTenantTx(async (client) => {
    // organization_practice_profiles is RLS-filtered. practice_profiles is a
    // global catalog (no RLS, granted SELECT to claimshield_app_role).
    const r = await client.query(
      `SELECT
         opp.organization_id, opp.profile_code, opp.is_primary,
         opp.effective_from, opp.effective_to, opp.created_at,
         pp.profile_code AS pp_code,
         pp.display_name, pp.description, pp.version_label,
         pp.service_code_catalog, pp.intake_field_specs, pp.claim_field_specs,
         pp.payer_relationship_templates, pp.provider_role_definitions,
         pp.authorization_templates, pp.rule_subscriptions,
         pp.ui_surface_config, pp.edi_structural_rules,
         pp.is_active, pp.created_at AS pp_created_at, pp.updated_at AS pp_updated_at
       FROM organization_practice_profiles opp
       JOIN practice_profiles pp ON pp.profile_code = opp.profile_code
       WHERE opp.is_primary = true
         AND (opp.effective_to IS NULL OR opp.effective_to >= CURRENT_DATE)
         AND pp.is_active = true
       LIMIT 1`,
    );
    if (r.rowCount === 0) return null;
    const row = r.rows[0];
    const mapping: OrganizationPracticeProfile = {
      organizationId: row.organization_id,
      profileCode: row.profile_code,
      isPrimary: row.is_primary,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      createdAt: row.created_at,
    };
    const profile: PracticeProfile = {
      profileCode: row.pp_code,
      displayName: row.display_name,
      description: row.description,
      versionLabel: row.version_label,
      serviceCodeCatalog: row.service_code_catalog,
      intakeFieldSpecs: row.intake_field_specs,
      claimFieldSpecs: row.claim_field_specs,
      payerRelationshipTemplates: row.payer_relationship_templates,
      providerRoleDefinitions: row.provider_role_definitions,
      authorizationTemplates: row.authorization_templates,
      ruleSubscriptions: row.rule_subscriptions,
      uiSurfaceConfig: row.ui_surface_config,
      ediStructuralRules: row.edi_structural_rules,
      isActive: row.is_active,
      createdAt: row.pp_created_at,
      updatedAt: row.pp_updated_at,
    };
    return { ...mapping, profile };
  }, organizationIdOverride);
}

/**
 * Returns active payer enrollments for the calling tenant, joined with the
 * payer name and the name of the user who created the enrollment. Excludes
 * soft-deleted (disabled_at IS NOT NULL) rows.
 *
 * Sprint 1d: `enrolledByName` was added so the helper-backed
 * `GET /api/practice/payer-enrollments` route can render the
 * "enrolled by" column on the clinic-settings surface without a second
 * round-trip. The field is `null` when the enrollment row's `enrolled_by`
 * is NULL (legacy rows pre-dating user attribution, or rows whose creating
 * user has been deleted — `users` FK on `practice_payer_enrollments`
 * `enrolled_by` is `ON DELETE SET NULL`).
 */
export async function getEnrolledPayers(): Promise<
  Array<
    PracticePayerEnrollment & {
      payerName: string | null;
      enrolledByName: string | null;
    }
  >
> {
  return withTenantTx(async (client) => {
    const r = await client.query(
      `SELECT ppe.*, p.name AS payer_name, u.name AS enrolled_by_name
       FROM practice_payer_enrollments ppe
       LEFT JOIN payers p ON p.id = ppe.payer_id
       LEFT JOIN users u ON u.id = ppe.enrolled_by
       WHERE ppe.disabled_at IS NULL
       ORDER BY p.name`,
    );
    return r.rows.map((row: any) => ({
      id: row.id,
      organizationId: row.organization_id,
      payerId: row.payer_id,
      planProductCode: row.plan_product_code,
      enrolledAt: row.enrolled_at,
      enrolledBy: row.enrolled_by,
      disabledAt: row.disabled_at,
      notes: row.notes,
      enrollmentStatus: row.enrollment_status,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      billingNpi: row.billing_npi,
      taxonomyCode: row.taxonomy_code,
      submissionMethod: row.submission_method,
      clearinghouse: row.clearinghouse,
      timelyFilingDays: row.timely_filing_days,
      priorAuthRequired: row.prior_auth_required,
      contractedRateTableId: row.contracted_rate_table_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      payerName: row.payer_name,
      enrolledByName: row.enrolled_by_name,
    }));
  });
}

/** Returns active provider→practice relationships for the calling tenant, joined with provider identity. */
export async function getActiveProviders(): Promise<
  Array<ProviderPracticeRelationship & { firstName: string; lastName: string; npi: string | null }>
> {
  return withTenantTx(async (client) => {
    const r = await client.query(
      `SELECT ppr.*, pr.first_name, pr.last_name, pr.npi
       FROM provider_practice_relationships ppr
       JOIN providers pr ON pr.id = ppr.provider_id
       WHERE ppr.is_active = true
       ORDER BY pr.last_name, pr.first_name`,
    );
    return r.rows.map((row: any) => ({
      id: row.id,
      providerId: row.provider_id,
      organizationId: row.organization_id,
      roleCode: row.role_code,
      npiUsedAtPractice: row.npi_used_at_practice,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      firstName: row.first_name,
      lastName: row.last_name,
      npi: row.npi,
    }));
  });
}

/** Returns provider↔payer participation rows for the calling tenant. */
export async function getProviderPayerParticipation(): Promise<ProviderPayerRelationship[]> {
  return withTenantTx(async (client) => {
    const r = await client.query(
      `SELECT * FROM provider_payer_relationships ORDER BY created_at DESC`,
    );
    return r.rows.map((row: any) => ({
      id: row.id,
      providerId: row.provider_id,
      payerId: row.payer_id,
      organizationId: row.organization_id,
      participates: row.participates,
      taxonomySubmitted: row.taxonomy_submitted,
      credentialingStatus: row.credentialing_status,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  });
}

/**
 * Returns active insurance coverages for a patient (tenant-scoped).
 * Patient must belong to the calling tenant — RLS prevents cross-tenant reads.
 */
export async function getPatientCoverages(patientId: string): Promise<
  Array<PatientInsuranceEnrollment & { payerName: string | null }>
> {
  return withTenantTx(async (client) => {
    const r = await client.query(
      `SELECT pie.*, p.name AS payer_name
       FROM patient_insurance_enrollments pie
       LEFT JOIN payers p ON p.id = pie.payer_id
       WHERE pie.patient_id = $1
         AND pie.is_active = true
       ORDER BY
         CASE pie.coverage_priority WHEN 'primary' THEN 1 WHEN 'secondary' THEN 2 ELSE 3 END`,
      [patientId],
    );
    return r.rows.map((row: any) => ({
      id: row.id,
      patientId: row.patient_id,
      payerId: row.payer_id,
      organizationId: row.organization_id,
      memberId: row.member_id,
      groupNumber: row.group_number,
      coveragePriority: row.coverage_priority,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      subscriberRelationship: row.subscriber_relationship,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      payerName: row.payer_name,
    }));
  });
}

/** Returns all provider assignments for a claim (tenant-scoped via RLS). */
export async function getClaimProviderAssignments(claimId: string): Promise<
  Array<ClaimProviderAssignment & { firstName: string; lastName: string; npi: string | null }>
> {
  return withTenantTx(async (client) => {
    const r = await client.query(
      `SELECT cpa.*, pr.first_name, pr.last_name, pr.npi
       FROM claim_provider_assignments cpa
       JOIN providers pr ON pr.id = cpa.provider_id
       WHERE cpa.claim_id = $1
       ORDER BY cpa.role_code`,
      [claimId],
    );
    return r.rows.map((row: any) => ({
      id: row.id,
      claimId: row.claim_id,
      providerId: row.provider_id,
      organizationId: row.organization_id,
      roleCode: row.role_code,
      npiUsed: row.npi_used,
      taxonomyCode: row.taxonomy_code,
      createdAt: row.created_at,
      firstName: row.first_name,
      lastName: row.last_name,
      npi: row.npi,
    }));
  });
}
