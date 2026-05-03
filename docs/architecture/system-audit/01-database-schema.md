# 01 — Database Schema

**Source of truth:** Drizzle ORM definitions in `shared/schema.ts` (720 lines) + live introspection in `_queries/01..12_*.tsv`.

## Database identity

PostgreSQL 16.10, database `heliumdb`, role `postgres`. Source: `_queries/00_db_identity.tsv`.

## Table census (82 public tables)

Full list with row counts: `_queries/01_tables_with_rowcounts.tsv`. Key tables grouped by domain:

### Tenancy + auth
| Table | Rows | Notes (file:line) |
|---|---:|---|
| `organizations` | 3 | `shared/schema.ts:31` — id, name, slug, is_active |
| `users` | 9 | `shared/schema.ts:39` — bcrypt hash, role, org FK |
| `role_permissions` | 32 | reference table, no org_id |
| `session` | 0 | created by `auth.ts:51` (`ensureSessionTable`) at startup |
| `login_attempts` | 3 | rate-limit table, `auth.ts:118` |

### Intake (lead → patient pipeline)
| Table | Rows | Notes |
|---|---:|---|
| `leads` | 33 | `shared/schema.ts` — has `organization_id`, `vob_score`, `vob_status` |
| `patients` | 111 | linked to `leads` via `lead_id`, has `is_demo`, `archived_at` |
| `calls` | 28 | Vapi-driven AI intake calls |
| `chat_sessions` | 12 | + 130 `chat_messages` |
| `appointments` | 0 | + 5 `availability_slots` |
| `flows` | 2 | + 17 `flow_steps`, 0 `flow_runs`, 0 `flow_run_events` |
| `step_types` | 9 | reference table (`wait`, `sms_message`, `voice_call`, `email_message`, `vob_check`, `provider_match`, `appointment_schedule`, `webhook`, plus one) |

### Org-scoped intake config (Phase A–E multi-tenancy)
| Table | Rows | FK |
|---|---:|---|
| `org_lead_sources` | 14 | CASCADE → organizations |
| `org_message_templates` | 11 | CASCADE → organizations |
| `org_payer_mappings` | 17 | CASCADE → organizations |
| `org_providers` | 1 | CASCADE → organizations |
| `org_service_types` | 15 | CASCADE → organizations |
| `org_voice_personas` | 2 | CASCADE → organizations |

### Billing core
| Table | Rows |
|---|---:|
| `claims` | 147 |
| `claim_events` | 507 |
| `claim_follow_up_notes` | 0 |
| `claim_templates` | 0 |
| `denials` | 69 |
| `denial_patterns` | 0 |
| `encounters` | 147 |
| `era_batches` / `era_lines` / `era_claim_lines` | 3 / 3 / 0 |
| `submission_attempts` | 0 |
| `prior_authorizations` | 0 |
| `pcp_referrals` | 0 |
| `practice_settings` | 2 |
| `practice_payer_enrollments` | 2 |
| `providers` | 5 |
| `timely_filing_alerts` | 0 |

### Reference / code sets
| Table | Rows |
|---|---:|
| `icd10_codes` | 97,584 |
| `cpt_codes` | 16,645 |
| `hcpcs_codes` | 8,259 |
| `cms_zip_locality` | 42,956 |
| `va_location_rates` | 2,180 |
| `taxonomy_codes` | 553 |
| `pos_codes` | 53 |
| `carc_codes` | 264 |
| `rarc_codes` | 229 |
| `carc_posting_rules` | 21 |
| `cci_edits` | 0 *(loaded by quarterly CCI cron — see 10)* |
| `cms_gpci`, `cms_locality_county`, `cms_pfs_rvu`, `va_fee_schedule` | 0 each |
| `hcpcs_rates` | 11 |

### Rules + payer policy
| Table | Rows |
|---|---:|
| `rules` | 6,238 |
| `rule_kinds` | 15 |
| `payers` | 238 |
| `payer_auth_requirements` | 32 |
| `payer_supported_plan_products` | 566 |
| `payer_source_documents` | 180 |
| `payer_manual_sources` | 20 |
| `manual_extraction_items` | 490 |
| `payer_manual_extraction_history` | 0 |
| `plan_products` | 16 |
| `delegated_entities` / `payer_delegated_entities` | 3 / 4 |
| `document_types` | 8 |

### Operations / monitoring
| Table | Rows |
|---|---:|
| `activity_logs` | 41 |
| `email_logs` | 7 |
| `comm_locks` | 1 |
| `webhook_events` | 0 |
| `scrape_runs` | 26 |
| `scraper_circuit_state` | 3 |
| `scraper_monitor_log` | 7 |
| `system_settings` | 2 |
| `field_definitions` | 15 |
| `vob_verifications` | 1 |

## Foreign-key topology (41 FKs)

Full list: `_queries/04_foreign_keys.tsv`. Highlights:

- **Org isolation** is enforced via FK on every org-scoped table:
  `claims_org_fk`, `patients_org_fk`, `users_org_fk`, `providers_org_fk`,
  `practice_settings_org_fk`, `org_*_organization_id_fkey` (6 of these),
  `pcp_referrals_organization_id_fkey`, `practice_payer_enrollments_organization_id_fkey`,
  `timely_filing_alerts_organization_id_fkey`. (`_queries/04_foreign_keys.tsv:3,13-18,20,30,34,36-37,40,41`)
- **No FK from `claims` to `patients`** — claims reference `patient_id` as a varchar without a constraint. **UNVERIFIED whether this is intentional or drift.** (`_queries/04_foreign_keys.tsv` — only `claims_org_fk` and `claims_pcp_referral_id_fkey` are present.)
- **No FK from `leads` → `organizations`** in `_queries/04_foreign_keys.tsv`. The `leads` table holds `organization_id` (per Drizzle schema and code filters) but **the FK constraint is missing in the DB**. Same gap for `calls`, `appointments`, `flows`, `flow_runs`, `denials`, `era_batches`, `activity_logs`, `email_logs`, `chat_sessions`. **Tenancy is enforced at the API layer only** for those tables.
- `flow_runs` cascades to `flow_run_events` (CASCADE), and `flow_steps` cascades from `flows` (CASCADE).
- `pcp_referrals` deletes cascade to claims via `claims.pcp_referral_id` set NULL on referral delete.

## Unique constraints (24)

`_queries/05_unique_constraints.tsv`. Common patterns include `(organization_id, slug)` style composites for `org_lead_sources` and similar org_ tables. **UNVERIFIED:** full list not narrated here; consult the TSV.

## Check constraints (18)

`_queries/06_check_constraints.tsv`. **UNVERIFIED** in detail; the Drizzle schema does not declare them, so they originate from migrations or seeder DDL.

## Indexes (204)

`_queries/07_indexes.tsv`. Bulk are auto-created PK/unique indexes plus org_id + foreign-key indexes.

## Triggers / Views / Functions / RLS — **none**

`_queries/08..12` are all empty. No PostgreSQL-side automation: no triggers, no views, no stored procedures, no row-level security policies. **All business logic lives in the Node.js layer.** This is a meaningful audit finding for tenancy hardening (see 06).

## Sequences (5)

`_queries/11_sequences.tsv`. Auto-generated for `bigserial`/identity columns. The dominant ID convention in `shared/schema.ts` is `varchar` IDs generated in app code (`crypto.randomUUID()` or domain-prefixed strings), not DB sequences — sequences only back the tables that explicitly use `bigserial`.

## Drift / open items

- `practice_settings` uses column `frcpb_enrolled` (referenced at `server/routes.ts:3520` route `/api/billing/practice-settings/frcpb-enrollment`). The `replit.md` reference to `billing_model` is **stale / UNVERIFIED**.
- `org_types` and `org_type_field_specs` referenced in some product copy **do not exist** in `_queries/01_tables_with_rowcounts.tsv`. **UNVERIFIED feature; not in DB.**
