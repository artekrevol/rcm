-- =============================================================================
-- Phase 3 Production Migration — Sprint 0 + 1a + 1b consolidated
-- =============================================================================
-- Source of truth (verbatim copies, with Sprint 1a WITH CHECK collapsed into
-- the original CREATE POLICY so we never pass through a "no WITH CHECK" state):
--   docs/architecture/sprint0-snapshots/sprint0-ddl.sql
--   docs/architecture/sprint0-snapshots/sprint0-app-role.sql
--   docs/architecture/sprint1a-snapshots/sprint1a-with-check.sql
--   docs/architecture/migration-state.md §9.1 (Sprint 1b ALTER)
--
-- Properties:
--   * Idempotent — safe to re-run (IF NOT EXISTS / ON CONFLICT DO NOTHING /
--     DO blocks check pg_roles before CREATE ROLE).
--   * Single transaction (BEGIN/COMMIT) — any failure rolls back atomically.
--   * Additive only — no DROPs, no destructive ALTERs.
--   * Pre-commit verification (§6) RAISEs EXCEPTION on any expected-state mismatch,
--     forcing a ROLLBACK before the changes become visible.
--
-- Apply with:
--   psql "$PRODUCTION_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f scripts/phase3-prod-migration.sql
--
-- This script does NOT modify Chajinel's voice persona row
-- (`compose_from_profile` stays at the column DEFAULT of `false` for both
-- existing rows). Flipping Chajinel to `true` and updating its
-- `system_prompt` to end with `\n\n{{INTAKE_FIELDS}}` is a separate,
-- post-deploy data step — see `docs/architecture/phase3-deploy-preflight.md` §6.4.
-- =============================================================================

\set ON_ERROR_STOP on
\timing on

BEGIN;

-- =============================================================================
-- §0 — Preflight (informational; does not abort)
-- =============================================================================
SELECT
  'connected_as=' || current_user ||
  ' db=' || current_database() ||
  ' superuser=' || (SELECT rolsuper::text FROM pg_roles WHERE rolname = current_user) ||
  ' pg_version=' || split_part(version(), ' ', 2)
  AS preflight;

DO $$
DECLARE existing TEXT;
BEGIN
  SELECT string_agg(tablename, ', ') INTO existing
    FROM pg_tables
   WHERE schemaname='public' AND tablename IN (
     'practice_profiles','organization_practice_profiles',
     'provider_practice_relationships','provider_payer_relationships',
     'patient_insurance_enrollments','claim_provider_assignments'
   );
  IF existing IS NOT NULL THEN
    RAISE NOTICE 'Phase 3 tables already present: %. Idempotent run; treating as no-ops.', existing;
  ELSE
    RAISE NOTICE 'No Phase 3 tables present yet. Fresh migration.';
  END IF;
END $$;

-- =============================================================================
-- §1.1 — practice_profiles (global catalog; no RLS)
-- =============================================================================
CREATE TABLE IF NOT EXISTS practice_profiles (
  profile_code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  version_label TEXT NOT NULL DEFAULT 'v1',
  service_code_catalog JSONB NOT NULL DEFAULT '[]'::jsonb,
  intake_field_specs JSONB NOT NULL DEFAULT '[]'::jsonb,
  claim_field_specs JSONB NOT NULL DEFAULT '[]'::jsonb,
  payer_relationship_templates JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider_role_definitions JSONB NOT NULL DEFAULT '[]'::jsonb,
  authorization_templates JSONB NOT NULL DEFAULT '[]'::jsonb,
  rule_subscriptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ui_surface_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  edi_structural_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- §1.2 — Seed home_care_agency_personal_care profile
-- =============================================================================
INSERT INTO practice_profiles (
  profile_code, display_name, description, version_label,
  service_code_catalog, intake_field_specs, claim_field_specs,
  payer_relationship_templates, provider_role_definitions,
  authorization_templates, rule_subscriptions, ui_surface_config, edi_structural_rules
) VALUES (
  'home_care_agency_personal_care',
  'Home Care Agency — Personal Care',
  'Non-medical personal care agency profile. Caregivers are not individually credentialed (no individual NPI). Agency NPI is used as billing provider. Default place of service is Home (12). Typical payers include VA Community Care via TriWest, county IHSS programs, long-term care insurance, and private pay.',
  'v1',
  '[
    {"code":"T1019","description":"Personal care services per 15 min","modifiers_allowed":["U1","U2","U3","TT"]},
    {"code":"S5125","description":"Attendant care services per 15 min","modifiers_allowed":[]},
    {"code":"S5130","description":"Homemaker services per 15 min","modifiers_allowed":[]},
    {"code":"S5135","description":"Companion care per 15 min","modifiers_allowed":[]},
    {"code":"99509","description":"Home visit for assistance with ADLs","modifiers_allowed":[]}
  ]'::jsonb,
  '[
    {"field_name":"first_name","display_label":"Caller first name","field_group":"identity","display_order":10,"is_required":true},
    {"field_name":"last_name","display_label":"Caller last name","field_group":"identity","display_order":20,"is_required":true},
    {"field_name":"phone","display_label":"Phone","field_group":"identity","display_order":30,"is_required":true},
    {"field_name":"care_recipient_name","display_label":"Who needs care","field_group":"identity","display_order":40,"is_required":true},
    {"field_name":"care_recipient_relationship","display_label":"Relationship to caller","field_group":"identity","display_order":50,"is_required":false},
    {"field_name":"address","display_label":"Home address","field_group":"logistics","display_order":60,"is_required":true},
    {"field_name":"hours_needed_per_week","display_label":"Hours per week","field_group":"clinical","display_order":70,"is_required":true},
    {"field_name":"adl_assessment","display_label":"ADL needs (bathing, dressing, mobility, etc.)","field_group":"clinical","display_order":80,"is_required":false},
    {"field_name":"home_environment_notes","display_label":"Home environment notes","field_group":"clinical","display_order":90,"is_required":false},
    {"field_name":"considering_alf","display_label":"Considering assisted living","field_group":"routing","display_order":100,"is_required":false},
    {"field_name":"payer_intent","display_label":"How will care be paid for","field_group":"financial","display_order":110,"is_required":true},
    {"field_name":"va_authorization_number","display_label":"VA authorization number","field_group":"financial","display_order":120,"is_required":false},
    {"field_name":"ihss_county","display_label":"IHSS county (if applicable)","field_group":"financial","display_order":130,"is_required":false}
  ]'::jsonb,
  '[
    {"field_name":"caregiver_assignment","display_label":"Assigned caregiver","is_required":true,"applies_to":"service_line"},
    {"field_name":"authorization_number","display_label":"Authorization number","is_required":true,"applies_to":"claim","payer_scope":["TWVACCN"]},
    {"field_name":"place_of_service","display_label":"Place of service","is_required":true,"applies_to":"service_line","default":"12"},
    {"field_name":"hours_billed","display_label":"Hours billed","is_required":true,"applies_to":"service_line"}
  ]'::jsonb,
  '[
    {"payer_code":"TWVACCN","display_name":"TriWest VA Community Care","typical":true,"submission_method":"EDI","clearinghouse":"PGBA"},
    {"payer_code":"IHSS_SAN_MATEO","display_name":"San Mateo County IHSS","typical":true,"submission_method":"PORTAL"},
    {"payer_code":"LTC_PLACEHOLDER","display_name":"Long-Term Care Insurance","typical":true,"submission_method":"PAPER"},
    {"payer_code":"PRIVATE_PAY","display_name":"Private Pay","typical":true,"submission_method":"INVOICE"}
  ]'::jsonb,
  '[
    {"role_code":"caregiver","display_name":"Caregiver","requires_npi":false,"can_be_rendering_provider":false},
    {"role_code":"agency_billing","display_name":"Agency Billing Entity","requires_npi":true,"can_be_billing_provider":true},
    {"role_code":"scheduling_coordinator","display_name":"Scheduling Coordinator","requires_npi":false},
    {"role_code":"rn_supervisor","display_name":"RN Supervisor","requires_npi":true}
  ]'::jsonb,
  '[
    {"template_code":"hours_per_week","display_name":"Hours per week","unit":"hours","period":"week"},
    {"template_code":"hours_per_month","display_name":"Hours per month","unit":"hours","period":"month"},
    {"template_code":"visits_per_month","display_name":"Visits per month","unit":"visits","period":"month"}
  ]'::jsonb,
  '[
    {"tier":1,"rule_code":"structural_integrity_all","subscribed":true},
    {"tier":2,"rule_code":"hcpcs_validity","subscribed":true},
    {"tier":2,"rule_code":"icd10_validity","subscribed":true},
    {"tier":3,"rule_code":"twvaccn_auth_required","subscribed":true,"payer_scope":["TWVACCN"]},
    {"tier":4,"rule_code":"home_care_pos_12","subscribed":true},
    {"tier":4,"rule_code":"agency_billed_no_rendering_loop","subscribed":true}
  ]'::jsonb,
  '{
    "dashboards":["home_care_overview","authorization_burn_down","caregiver_utilization"],
    "reports":["weekly_hours_by_caregiver","payer_aging","authorization_status"],
    "hide":["surgical_bundling_dashboard","oasis_status","pdgm_episode_view"]
  }'::jsonb,
  '{
    "default_place_of_service":"12",
    "billing_provider_loop_2010AA":"agency_npi",
    "rendering_provider_loop_2310B":{"omit_when":"agency_billed","reason":"Caregivers are not individually credentialed"},
    "service_line_default_unit":"UN",
    "claim_frequency_codes_allowed":["1","7"]
  }'::jsonb
) ON CONFLICT (profile_code) DO NOTHING;

-- =============================================================================
-- §1.3 — organization_practice_profiles + Chajinel mapping
-- =============================================================================
CREATE TABLE IF NOT EXISTS organization_practice_profiles (
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_code TEXT NOT NULL REFERENCES practice_profiles(profile_code) ON DELETE RESTRICT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, profile_code)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_primary_profile_per_org
  ON organization_practice_profiles(organization_id)
  WHERE is_primary = true;

INSERT INTO organization_practice_profiles (organization_id, profile_code, is_primary)
VALUES ('chajinel-org-001', 'home_care_agency_personal_care', true)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- §1.4 — practice_payer_enrollments additive ALTERs (8 cols → 20 cols)
-- =============================================================================
ALTER TABLE practice_payer_enrollments
  ADD COLUMN IF NOT EXISTS enrollment_status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE practice_payer_enrollments
  ADD COLUMN IF NOT EXISTS effective_from DATE,
  ADD COLUMN IF NOT EXISTS effective_to DATE;

ALTER TABLE practice_payer_enrollments
  ADD COLUMN IF NOT EXISTS billing_npi TEXT,
  ADD COLUMN IF NOT EXISTS taxonomy_code TEXT,
  ADD COLUMN IF NOT EXISTS submission_method TEXT,
  ADD COLUMN IF NOT EXISTS clearinghouse TEXT,
  ADD COLUMN IF NOT EXISTS timely_filing_days INTEGER,
  ADD COLUMN IF NOT EXISTS prior_auth_required BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE practice_payer_enrollments
  ADD COLUMN IF NOT EXISTS contracted_rate_table_id UUID;

ALTER TABLE practice_payer_enrollments
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- =============================================================================
-- §1.5 — provider_practice_relationships
-- =============================================================================
CREATE TABLE IF NOT EXISTS provider_practice_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id VARCHAR NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_code TEXT NOT NULL,
  npi_used_at_practice TEXT,
  effective_from DATE,
  effective_to DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider_id, organization_id, role_code)
);

CREATE INDEX IF NOT EXISTS idx_provider_practice_org
  ON provider_practice_relationships(organization_id, is_active);

-- =============================================================================
-- §1.6 — provider_payer_relationships
-- =============================================================================
CREATE TABLE IF NOT EXISTS provider_payer_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id VARCHAR NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  payer_id VARCHAR NOT NULL REFERENCES payers(id) ON DELETE RESTRICT,
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  participates BOOLEAN NOT NULL DEFAULT false,
  taxonomy_submitted TEXT,
  credentialing_status TEXT,
  effective_from DATE,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider_id, payer_id, organization_id)
);

-- =============================================================================
-- §1.7 — patient_insurance_enrollments
-- =============================================================================
CREATE TABLE IF NOT EXISTS patient_insurance_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id VARCHAR NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  payer_id VARCHAR NOT NULL REFERENCES payers(id) ON DELETE RESTRICT,
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,
  group_number TEXT,
  coverage_priority TEXT NOT NULL DEFAULT 'primary',
  effective_from DATE,
  effective_to DATE,
  subscriber_relationship TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(patient_id, payer_id, coverage_priority)
);

CREATE INDEX IF NOT EXISTS idx_patient_insurance_patient
  ON patient_insurance_enrollments(patient_id, is_active);
CREATE INDEX IF NOT EXISTS idx_patient_insurance_org
  ON patient_insurance_enrollments(organization_id);

-- =============================================================================
-- §1.8 — claim_provider_assignments
-- =============================================================================
CREATE TABLE IF NOT EXISTS claim_provider_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id VARCHAR NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  provider_id VARCHAR NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
  organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_code TEXT NOT NULL,
  npi_used TEXT,
  taxonomy_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(claim_id, role_code, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_claim_provider_claim
  ON claim_provider_assignments(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_provider_org
  ON claim_provider_assignments(organization_id);

-- =============================================================================
-- §2 — Enable RLS on the 6 tenant-scoped tables
-- (practice_profiles is global — no RLS)
-- =============================================================================
ALTER TABLE organization_practice_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_payer_enrollments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_practice_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_payer_relationships    ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_insurance_enrollments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_provider_assignments      ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- §3 — Tenant-isolation policies (Sprint 0 + Sprint 1a WITH CHECK collapsed)
-- current_setting(..., true) returns NULL when unset → policy fails closed.
-- WITH CHECK is identical to USING so INSERTs cannot write cross-tenant rows.
-- =============================================================================
DROP POLICY IF EXISTS tenant_isolation ON organization_practice_profiles;
CREATE POLICY tenant_isolation ON organization_practice_profiles
  USING       (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK  (organization_id = current_setting('app.current_organization_id', true));

DROP POLICY IF EXISTS tenant_isolation ON practice_payer_enrollments;
CREATE POLICY tenant_isolation ON practice_payer_enrollments
  USING       (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK  (organization_id = current_setting('app.current_organization_id', true));

DROP POLICY IF EXISTS tenant_isolation ON provider_practice_relationships;
CREATE POLICY tenant_isolation ON provider_practice_relationships
  USING       (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK  (organization_id = current_setting('app.current_organization_id', true));

DROP POLICY IF EXISTS tenant_isolation ON provider_payer_relationships;
CREATE POLICY tenant_isolation ON provider_payer_relationships
  USING       (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK  (organization_id = current_setting('app.current_organization_id', true));

DROP POLICY IF EXISTS tenant_isolation ON patient_insurance_enrollments;
CREATE POLICY tenant_isolation ON patient_insurance_enrollments
  USING       (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK  (organization_id = current_setting('app.current_organization_id', true));

DROP POLICY IF EXISTS tenant_isolation ON claim_provider_assignments;
CREATE POLICY tenant_isolation ON claim_provider_assignments
  USING       (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK  (organization_id = current_setting('app.current_organization_id', true));

-- =============================================================================
-- §4 — claimshield_service_role + FORCE RLS + service-role bypass policies
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'claimshield_service_role') THEN
    CREATE ROLE claimshield_service_role NOINHERIT;
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON organization_practice_profiles TO claimshield_service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON practice_payer_enrollments      TO claimshield_service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON provider_practice_relationships TO claimshield_service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON provider_payer_relationships    TO claimshield_service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON patient_insurance_enrollments   TO claimshield_service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON claim_provider_assignments      TO claimshield_service_role;

ALTER TABLE organization_practice_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE practice_payer_enrollments      FORCE ROW LEVEL SECURITY;
ALTER TABLE provider_practice_relationships FORCE ROW LEVEL SECURITY;
ALTER TABLE provider_payer_relationships    FORCE ROW LEVEL SECURITY;
ALTER TABLE patient_insurance_enrollments   FORCE ROW LEVEL SECURITY;
ALTER TABLE claim_provider_assignments      FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_bypass ON organization_practice_profiles;
CREATE POLICY service_role_bypass ON organization_practice_profiles
  AS PERMISSIVE FOR ALL TO claimshield_service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_bypass ON practice_payer_enrollments;
CREATE POLICY service_role_bypass ON practice_payer_enrollments
  AS PERMISSIVE FOR ALL TO claimshield_service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_bypass ON provider_practice_relationships;
CREATE POLICY service_role_bypass ON provider_practice_relationships
  AS PERMISSIVE FOR ALL TO claimshield_service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_bypass ON provider_payer_relationships;
CREATE POLICY service_role_bypass ON provider_payer_relationships
  AS PERMISSIVE FOR ALL TO claimshield_service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_bypass ON patient_insurance_enrollments;
CREATE POLICY service_role_bypass ON patient_insurance_enrollments
  AS PERMISSIVE FOR ALL TO claimshield_service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_bypass ON claim_provider_assignments;
CREATE POLICY service_role_bypass ON claim_provider_assignments
  AS PERMISSIVE FOR ALL TO claimshield_service_role
  USING (true) WITH CHECK (true);

-- =============================================================================
-- §5 — claimshield_app_role (the RLS-subject role used by withTenantTx)
-- =============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'claimshield_app_role') THEN
    CREATE ROLE claimshield_app_role NOLOGIN NOINHERIT;
  END IF;
END $$;

-- Allow connecting superuser to SET ROLE into the app role.
GRANT claimshield_app_role TO postgres;

-- Tenant-scoped tables: full DML (filtered by RLS).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  organization_practice_profiles,
  practice_payer_enrollments,
  provider_practice_relationships,
  provider_payer_relationships,
  patient_insurance_enrollments,
  claim_provider_assignments
  TO claimshield_app_role;

-- Global catalog: SELECT only — no tenant column, no RLS.
GRANT SELECT ON practice_profiles TO claimshield_app_role;

-- Parent tables that helper joins read from. SELECT only.
GRANT SELECT ON organizations, payers, providers, patients, claims
  TO claimshield_app_role;

-- =============================================================================
-- §6 — Sprint 1b: org_voice_personas.compose_from_profile
--      Existing 2 rows take the DEFAULT (false), preserving Caritas' static
--      Vapi-dashboard prompt behavior. Chajinel's flip to true is a separate
--      post-deploy data step (not in this script).
-- =============================================================================
ALTER TABLE org_voice_personas
  ADD COLUMN IF NOT EXISTS compose_from_profile BOOLEAN NOT NULL DEFAULT false;

-- =============================================================================
-- §7 — Pre-commit verification (RAISES EXCEPTION ⇒ ROLLBACK on any mismatch)
-- =============================================================================
DO $$
DECLARE
  v_phase3_count int;
  v_policy_count int;
  v_with_check_missing int;
  v_app_role_exists bool;
  v_service_role_exists bool;
  v_app_role_can_set bool;
  v_compose_col_exists bool;
  v_ppe_cols int;
  v_orgs int;
  v_chajinel_enrollments int;
  v_total_enrollments int;
  v_chajinel_mapping int;
  v_home_care_profile int;
BEGIN
  -- 6 new Phase 3 tables present
  SELECT COUNT(*) INTO v_phase3_count FROM pg_tables
   WHERE schemaname='public' AND tablename IN (
     'practice_profiles','organization_practice_profiles','provider_practice_relationships',
     'provider_payer_relationships','patient_insurance_enrollments','claim_provider_assignments'
   );
  IF v_phase3_count <> 6 THEN
    RAISE EXCEPTION 'expected 6 Phase 3 tables, got %', v_phase3_count;
  END IF;

  -- 12 RLS policies (2 per table × 6) on tenant-scoped tables
  SELECT COUNT(*) INTO v_policy_count FROM pg_policies
   WHERE schemaname='public' AND tablename IN (
     'organization_practice_profiles','practice_payer_enrollments',
     'provider_practice_relationships','provider_payer_relationships',
     'patient_insurance_enrollments','claim_provider_assignments'
   );
  IF v_policy_count <> 12 THEN
    RAISE EXCEPTION 'expected 12 RLS policies, got %', v_policy_count;
  END IF;

  -- WITH CHECK present on every tenant_isolation policy
  SELECT COUNT(*) INTO v_with_check_missing FROM pg_policies
   WHERE schemaname='public' AND policyname='tenant_isolation' AND with_check IS NULL;
  IF v_with_check_missing > 0 THEN
    RAISE EXCEPTION '% tenant_isolation policy/policies missing WITH CHECK', v_with_check_missing;
  END IF;

  -- Role assertions
  SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='claimshield_app_role') INTO v_app_role_exists;
  IF NOT v_app_role_exists THEN RAISE EXCEPTION 'claimshield_app_role missing'; END IF;

  SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='claimshield_service_role') INTO v_service_role_exists;
  IF NOT v_service_role_exists THEN RAISE EXCEPTION 'claimshield_service_role missing'; END IF;

  -- postgres can SET ROLE claimshield_app_role (membership granted)
  SELECT pg_has_role('postgres', 'claimshield_app_role', 'MEMBER') INTO v_app_role_can_set;
  IF NOT v_app_role_can_set THEN RAISE EXCEPTION 'postgres lacks MEMBER on claimshield_app_role'; END IF;

  -- Sprint 1b column
  SELECT EXISTS(SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='org_voice_personas'
                  AND column_name='compose_from_profile') INTO v_compose_col_exists;
  IF NOT v_compose_col_exists THEN
    RAISE EXCEPTION 'org_voice_personas.compose_from_profile missing';
  END IF;

  -- practice_payer_enrollments now 20 cols
  SELECT COUNT(*) INTO v_ppe_cols FROM information_schema.columns
   WHERE table_schema='public' AND table_name='practice_payer_enrollments';
  IF v_ppe_cols <> 20 THEN
    RAISE EXCEPTION 'expected 20 practice_payer_enrollments cols, got %', v_ppe_cols;
  END IF;

  -- Existing data preserved
  SELECT COUNT(*) INTO v_orgs FROM organizations;
  IF v_orgs <> 3 THEN RAISE EXCEPTION 'expected 3 organizations preserved, got %', v_orgs; END IF;

  SELECT COUNT(*) INTO v_chajinel_enrollments FROM practice_payer_enrollments
   WHERE organization_id='chajinel-org-001';
  IF v_chajinel_enrollments <> 3 THEN
    RAISE EXCEPTION 'expected 3 chajinel enrollments preserved, got %', v_chajinel_enrollments;
  END IF;

  SELECT COUNT(*) INTO v_total_enrollments FROM practice_payer_enrollments;
  IF v_total_enrollments <> 5 THEN
    RAISE EXCEPTION 'expected 5 total enrollments preserved, got %', v_total_enrollments;
  END IF;

  -- Seeds present
  SELECT COUNT(*) INTO v_home_care_profile FROM practice_profiles
   WHERE profile_code='home_care_agency_personal_care';
  IF v_home_care_profile <> 1 THEN
    RAISE EXCEPTION 'home_care_agency_personal_care profile not seeded';
  END IF;

  SELECT COUNT(*) INTO v_chajinel_mapping FROM organization_practice_profiles
   WHERE organization_id='chajinel-org-001'
     AND profile_code='home_care_agency_personal_care' AND is_primary=true;
  IF v_chajinel_mapping <> 1 THEN
    RAISE EXCEPTION 'chajinel→home_care primary mapping not seeded';
  END IF;

  RAISE NOTICE '=== migration verification PASS ===';
  RAISE NOTICE '  phase3 tables: % / 6', v_phase3_count;
  RAISE NOTICE '  RLS policies: % / 12', v_policy_count;
  RAISE NOTICE '  policies with WITH CHECK: % / 6 missing (must be 0)', v_with_check_missing;
  RAISE NOTICE '  claimshield_app_role: %', v_app_role_exists;
  RAISE NOTICE '  claimshield_service_role: %', v_service_role_exists;
  RAISE NOTICE '  postgres MEMBER claimshield_app_role: %', v_app_role_can_set;
  RAISE NOTICE '  org_voice_personas.compose_from_profile: %', v_compose_col_exists;
  RAISE NOTICE '  practice_payer_enrollments cols: % / 20', v_ppe_cols;
  RAISE NOTICE '  organizations preserved: % / 3', v_orgs;
  RAISE NOTICE '  chajinel enrollments preserved: % / 3', v_chajinel_enrollments;
  RAISE NOTICE '  total enrollments preserved: % / 5', v_total_enrollments;
  RAISE NOTICE '  home_care profile seeded: %', v_home_care_profile;
  RAISE NOTICE '  chajinel primary mapping: %', v_chajinel_mapping;
END $$;

COMMIT;

-- End of migration.
