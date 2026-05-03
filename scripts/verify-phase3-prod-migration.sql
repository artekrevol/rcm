-- =============================================================================
-- Phase 3 Production Migration — Post-deploy Verification (read-only)
-- =============================================================================
-- Re-runnable SELECT-only checks. Apply against PRODUCTION_DATABASE_URL or
-- PRODUCTION_READONLY_DATABASE_URL after migration. No transaction needed.
--
-- Usage:
--   psql "$PRODUCTION_DATABASE_URL" -X -f scripts/verify-phase3-prod-migration.sql
-- =============================================================================

\echo === Q1: 6 Phase 3 tables present ===
SELECT COUNT(*) AS phase3_tables, string_agg(tablename, ', ' ORDER BY tablename) AS tables
  FROM pg_tables WHERE schemaname='public' AND tablename IN (
    'practice_profiles','organization_practice_profiles','provider_practice_relationships',
    'provider_payer_relationships','patient_insurance_enrollments','claim_provider_assignments'
  );

\echo
\echo === Q2: 12 RLS policies (tenant_isolation + service_role_bypass on each tenant table) ===
SELECT tablename, policyname,
       (qual IS NOT NULL) AS has_using,
       (with_check IS NOT NULL) AS has_with_check
  FROM pg_policies
 WHERE schemaname='public' AND tablename IN (
   'organization_practice_profiles','practice_payer_enrollments',
   'provider_practice_relationships','provider_payer_relationships',
   'patient_insurance_enrollments','claim_provider_assignments'
 )
 ORDER BY tablename, policyname;

\echo
\echo === Q3: RLS enabled + FORCE on the 6 tenant tables ===
SELECT c.relname AS tablename, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
  FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
 WHERE n.nspname='public' AND c.relkind='r'
   AND c.relname IN (
     'organization_practice_profiles','practice_payer_enrollments',
     'provider_practice_relationships','provider_payer_relationships',
     'patient_insurance_enrollments','claim_provider_assignments'
   )
 ORDER BY c.relname;

\echo
\echo === Q4: roles + memberships ===
SELECT rolname, rolsuper, rolcanlogin, rolinherit, rolbypassrls
  FROM pg_roles WHERE rolname IN ('claimshield_app_role','claimshield_service_role','postgres','replit_readonly')
  ORDER BY rolname;

\echo
\echo === Q4b: postgres MEMBER claimshield_app_role? ===
SELECT pg_has_role('postgres', 'claimshield_app_role', 'MEMBER') AS postgres_member_app_role;

\echo
\echo === Q5: org_voice_personas.compose_from_profile present + counts by value ===
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='org_voice_personas' AND column_name='compose_from_profile';

SELECT compose_from_profile, COUNT(*) AS rows
  FROM org_voice_personas GROUP BY compose_from_profile ORDER BY compose_from_profile;

\echo
\echo === Q6: practice_payer_enrollments columns (must be 20) ===
SELECT COUNT(*) AS column_count
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='practice_payer_enrollments';

\echo
\echo === Q7: data preservation ===
SELECT 'organizations' AS t, COUNT(*) AS n FROM organizations
UNION ALL SELECT 'org_voice_personas', COUNT(*) FROM org_voice_personas
UNION ALL SELECT 'practice_payer_enrollments (total)', COUNT(*) FROM practice_payer_enrollments
UNION ALL SELECT 'practice_payer_enrollments (chajinel)', COUNT(*)
  FROM practice_payer_enrollments WHERE organization_id='chajinel-org-001'
UNION ALL SELECT 'practice_payer_enrollments (demo)', COUNT(*)
  FROM practice_payer_enrollments WHERE organization_id='demo-org-001'
UNION ALL SELECT 'patients', COUNT(*) FROM patients
UNION ALL SELECT 'claims', COUNT(*) FROM claims
UNION ALL SELECT 'leads', COUNT(*) FROM leads
ORDER BY t;

\echo
\echo === Q8: seed presence ===
SELECT profile_code, display_name, is_active, version_label
  FROM practice_profiles WHERE profile_code='home_care_agency_personal_care';

SELECT organization_id, profile_code, is_primary, effective_from
  FROM organization_practice_profiles WHERE organization_id='chajinel-org-001';

\echo
\echo === Q9: total table count in public (expect 88 after migration; was 82 pre) ===
SELECT COUNT(*) AS public_table_count FROM pg_tables WHERE schemaname='public';
