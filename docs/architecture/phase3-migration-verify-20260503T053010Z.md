# Phase 3 Migration Verification Log — 2026-05-03T05:30:10Z

Captured stdout from `psql "$PRODUCTION_DATABASE_URL" -X -f scripts/verify-phase3-prod-migration.sql`, run immediately after the apply script exited (independent re-run for audit trail).

Renamed from `.log` to `.md` for inclusion in Replit checkpoint. Content below is verbatim psql output, fenced for readability.

```
=== Q1: 6 Phase 3 tables present ===
 phase3_tables |                                                                                   tables                                                                                    
---------------+-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------
             6 | claim_provider_assignments, organization_practice_profiles, patient_insurance_enrollments, practice_profiles, provider_payer_relationships, provider_practice_relationships
(1 row)


=== Q2: 12 RLS policies (tenant_isolation + service_role_bypass on each tenant table) ===
            tablename            |     policyname      | has_using | has_with_check 
---------------------------------+---------------------+-----------+----------------
 claim_provider_assignments      | service_role_bypass | t         | t
 claim_provider_assignments      | tenant_isolation    | t         | t
 organization_practice_profiles  | service_role_bypass | t         | t
 organization_practice_profiles  | tenant_isolation    | t         | t
 patient_insurance_enrollments   | service_role_bypass | t         | t
 patient_insurance_enrollments   | tenant_isolation    | t         | t
 practice_payer_enrollments      | service_role_bypass | t         | t
 practice_payer_enrollments      | tenant_isolation    | t         | t
 provider_payer_relationships    | service_role_bypass | t         | t
 provider_payer_relationships    | tenant_isolation    | t         | t
 provider_practice_relationships | service_role_bypass | t         | t
 provider_practice_relationships | tenant_isolation    | t         | t
(12 rows)


=== Q3: RLS enabled + FORCE on the 6 tenant tables ===
            tablename            | rls_enabled | rls_forced 
---------------------------------+-------------+------------
 claim_provider_assignments      | t           | t
 organization_practice_profiles  | t           | t
 patient_insurance_enrollments   | t           | t
 practice_payer_enrollments      | t           | t
 provider_payer_relationships    | t           | t
 provider_practice_relationships | t           | t
(6 rows)


=== Q4: roles + memberships ===
         rolname          | rolsuper | rolcanlogin | rolinherit | rolbypassrls 
--------------------------+----------+-------------+------------+--------------
 claimshield_app_role     | f        | f           | f          | f
 claimshield_service_role | f        | f           | f          | f
 postgres                 | t        | t           | t          | t
 replit_readonly          | f        | t           | t          | f
(4 rows)


=== Q4b: postgres MEMBER claimshield_app_role? ===
 postgres_member_app_role 
--------------------------
 t
(1 row)


=== Q5: org_voice_personas.compose_from_profile present + counts by value ===
     column_name      | data_type | is_nullable | column_default 
----------------------+-----------+-------------+----------------
 compose_from_profile | boolean   | NO          | false
(1 row)

 compose_from_profile | rows 
----------------------+------
 f                    |    2
(1 row)


=== Q6: practice_payer_enrollments columns (must be 20) ===
 column_count 
--------------
           20
(1 row)


=== Q7: data preservation ===
                   t                   | n  
---------------------------------------+----
 claims                                | 96
 leads                                 | 28
 organizations                         |  3
 org_voice_personas                    |  2
 patients                              | 65
 practice_payer_enrollments (chajinel) |  3
 practice_payer_enrollments (demo)     |  2
 practice_payer_enrollments (total)    |  5
(8 rows)


=== Q8: seed presence ===
          profile_code          |           display_name           | is_active | version_label 
--------------------------------+----------------------------------+-----------+---------------
 home_care_agency_personal_care | Home Care Agency — Personal Care | t         | v1
(1 row)

 organization_id  |          profile_code          | is_primary | effective_from 
------------------+--------------------------------+------------+----------------
 chajinel-org-001 | home_care_agency_personal_care | t          | 2026-05-03
(1 row)


=== Q9: total table count in public (expect 88 after migration; was 82 pre) ===
 public_table_count 
--------------------
                 88
(1 row)

```
