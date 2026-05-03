# Phase 3 Migration Apply Log — 2026-05-03T05:30:10Z

Captured stdout+stderr from `bash scripts/apply-phase3-prod-migration.sh` against `$PRODUCTION_DATABASE_URL` (Railway prod, PG 17.9).

Renamed from `.log` to `.md` for inclusion in Replit checkpoint (system `/etc/.gitignore` excludes `*.log`). Content below is verbatim runner output, fenced for readability.

```
Using: psql (PostgreSQL) 17.6

=================================================================
Phase 3 Production Migration — applying
  migration:    /home/runner/workspace/scripts/phase3-prod-migration.sql
  verification: /home/runner/workspace/scripts/verify-phase3-prod-migration.sql
  target:       PRODUCTION_DATABASE_URL
  start:        2026-05-03T05:30:23Z
=================================================================


--- Applying migration ---
Timing is on.
BEGIN
Time: 40.382 ms
                            preflight                            
-----------------------------------------------------------------
 connected_as=postgres db=railway superuser=true pg_version=17.9
(1 row)

Time: 41.929 ms
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:80: NOTICE:  No Phase 3 tables present yet. Fresh migration.
DO
Time: 46.914 ms
CREATE TABLE
Time: 43.254 ms
INSERT 0 1
Time: 41.150 ms
CREATE TABLE
Time: 42.581 ms
CREATE INDEX
Time: 41.215 ms
INSERT 0 1
Time: 40.950 ms
ALTER TABLE
Time: 40.643 ms
ALTER TABLE
Time: 40.535 ms
ALTER TABLE
Time: 40.869 ms
ALTER TABLE
Time: 40.561 ms
ALTER TABLE
Time: 40.880 ms
CREATE TABLE
Time: 42.417 ms
CREATE INDEX
Time: 41.059 ms
CREATE TABLE
Time: 41.959 ms
CREATE TABLE
Time: 42.062 ms
CREATE INDEX
Time: 40.694 ms
CREATE INDEX
Time: 40.722 ms
CREATE TABLE
Time: 42.435 ms
CREATE INDEX
Time: 43.223 ms
CREATE INDEX
Time: 40.771 ms
ALTER TABLE
Time: 40.654 ms
ALTER TABLE
Time: 40.843 ms
ALTER TABLE
Time: 40.913 ms
ALTER TABLE
Time: 40.617 ms
ALTER TABLE
Time: 40.648 ms
ALTER TABLE
Time: 40.278 ms
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:329: NOTICE:  policy "tenant_isolation" for relation "organization_practice_profiles" does not exist, skipping
DROP POLICY
Time: 41.151 ms
CREATE POLICY
Time: 41.627 ms
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:334: NOTICE:  policy "tenant_isolation" for relation "practice_payer_enrollments" does not exist, skipping
DROP POLICY
Time: 41.055 ms
CREATE POLICY
Time: 41.560 ms
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:339: NOTICE:  policy "tenant_isolation" for relation "provider_practice_relationships" does not exist, skipping
DROP POLICY
Time: 41.321 ms
CREATE POLICY
Time: 40.845 ms
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:344: NOTICE:  policy "tenant_isolation" for relation "provider_payer_relationships" does not exist, skipping
DROP POLICY
Time: 41.094 ms
CREATE POLICY
Time: 40.577 ms
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:349: NOTICE:  policy "tenant_isolation" for relation "patient_insurance_enrollments" does not exist, skipping
DROP POLICY
Time: 41.311 ms
CREATE POLICY
Time: 40.872 ms
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:354: NOTICE:  policy "tenant_isolation" for relation "claim_provider_assignments" does not exist, skipping
DROP POLICY
Time: 40.990 ms
CREATE POLICY
Time: 40.704 ms
DO
Time: 41.528 ms
GRANT
Time: 42.222 ms
GRANT
Time: 43.187 ms
GRANT
Time: 40.511 ms
GRANT
Time: 41.764 ms
GRANT
Time: 40.540 ms
GRANT
Time: 40.810 ms
ALTER TABLE
Time: 40.918 ms
ALTER TABLE
Time: 40.491 ms
ALTER TABLE
Time: 42.035 ms
ALTER TABLE
Time: 40.318 ms
ALTER TABLE
Time: 41.014 ms
ALTER TABLE
Time: 40.519 ms
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:382: NOTICE:  policy "service_role_bypass" for relation "organization_practice_profiles" does not exist, skipping
DROP POLICY
Time: 41.195 ms
CREATE POLICY
Time: 40.499 ms
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:387: NOTICE:  policy "service_role_bypass" for relation "practice_payer_enrollments" does not exist, skipping
DROP POLICY
Time: 41.054 ms
CREATE POLICY
Time: 42.299 ms
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:392: NOTICE:  policy "service_role_bypass" for relation "provider_practice_relationships" does not exist, skipping
DROP POLICY
Time: 40.910 ms
CREATE POLICY
Time: 42.893 ms
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:397: NOTICE:  policy "service_role_bypass" for relation "provider_payer_relationships" does not exist, skipping
DROP POLICY
Time: 44.109 ms
CREATE POLICY
Time: 47.402 ms
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:402: NOTICE:  policy "service_role_bypass" for relation "patient_insurance_enrollments" does not exist, skipping
DROP POLICY
Time: 46.712 ms
CREATE POLICY
Time: 42.666 ms
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:407: NOTICE:  policy "service_role_bypass" for relation "claim_provider_assignments" does not exist, skipping
DROP POLICY
Time: 44.554 ms
CREATE POLICY
Time: 40.686 ms
DO
Time: 40.912 ms
GRANT ROLE
Time: 45.351 ms
GRANT
Time: 42.724 ms
GRANT
Time: 42.489 ms
GRANT
Time: 42.520 ms
ALTER TABLE
Time: 40.842 ms
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:566: NOTICE:  === migration verification PASS ===
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:566: NOTICE:    phase3 tables: 6 / 6
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:566: NOTICE:    RLS policies: 12 / 12
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:566: NOTICE:    policies with WITH CHECK: 0 / 6 missing (must be 0)
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:566: NOTICE:    claimshield_app_role: t
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:566: NOTICE:    claimshield_service_role: t
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:566: NOTICE:    postgres MEMBER claimshield_app_role: t
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:566: NOTICE:    org_voice_personas.compose_from_profile: t
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:566: NOTICE:    practice_payer_enrollments cols: 20 / 20
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:566: NOTICE:    organizations preserved: 3 / 3
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:566: NOTICE:    chajinel enrollments preserved: 3 / 3
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:566: NOTICE:    total enrollments preserved: 5 / 5
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:566: NOTICE:    home_care profile seeded: 1
psql:/home/runner/workspace/scripts/phase3-prod-migration.sql:566: NOTICE:    chajinel primary mapping: 1
DO
Time: 57.336 ms
COMMIT
Time: 42.707 ms

--- Running post-deploy verification ---
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


=================================================================
Migration + verification complete at 2026-05-03T05:30:28Z
=================================================================
```
