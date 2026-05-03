# Claim Shield Health — System Audit

**Audit date:** 2026-05-03 (refreshed post-Sprint-1b)
**Audit mode:** Read-only. No mutations were performed against the codebase or database.
**Database queried:** Development database only (`heliumdb`, PostgreSQL 16.10, captured in `_queries/00_db_identity.tsv`). **No production queries were run.**
**Sprint coverage:** post-Sprint-0 + Sprint-1a (`WITH CHECK` on RLS) + Sprint-1b (voice persona builder + Tier 1 wired into `evaluateClaim`). The five Sprint 1b commits (`d797b89`, `0df22b5`, `1fabf5d`, `0c6f35e`, `a38b3d7`) post-date the original audit and are reflected in 01, 03, 06, 07, 09, 12.
**Standing order honored:** No deploys to production. No DB writes. All findings below are diagnostic only and require Abeer's review before any remediation.

## How this audit was produced

1. **Schema data** — read-only `information_schema` / `pg_catalog` queries against the dev DB; raw output staged in `_queries/00..12_*.tsv`. The exact SQL is in `_queries/run_all.sh`.
2. **Code data** — `rg` / `grep` extraction of routes, role checks, env vars, frontend structure, and auth wiring; staged in `_queries/20..25_*.txt`.
3. **Narrative reads** — direct `read` of authoritative source files (auth, services, jobs, schema, App.tsx, layouts).
4. **Synthesis** — every claim in 01–12 is cited as `path/to/file.ts:LINE`. Anything not directly verified is marked **UNVERIFIED**.

## Scope counts (verified, post-Sprint-0)

| Surface | Count | Source |
|---|---:|---|
| Public tables | **88** | live count via `information_schema.tables`; `_queries/01_tables.txt` (was 82 pre-Sprint-0; Sprint 0 added 6 Phase 3 tables) |
| Foreign keys | **54** | live count via `information_schema.table_constraints`; `_queries/03_fks.txt` (was 41; Sprint 0 added 13 FKs across the 6 new tables) |
| `org_voice_personas` rows | **2** | live count; **1 row has `compose_from_profile = true`** (Chajinel, post-Sprint-1b migration). See 09 |
| Unique constraints | **28** | live count |
| Check constraints | **18** | `_queries/06_check_constraints.tsv` |
| Indexes | **220** | live count |
| Triggers | **0** | `_queries/08_triggers.tsv` |
| Views | **0** | `_queries/09_views.tsv` |
| Stored functions/procs | **0** | `_queries/10_functions.tsv` |
| Sequences | **5** | `_queries/11_sequences.tsv` |
| RLS policies | **12** | `_queries/11_rls.txt` (Sprint 0 added 2 policies × 6 tables; was 0) |
| RLS-enabled tables | **6** | `_queries/11_rls.txt` (Phase 3 tables only — see 06) |
| App-role principals | **2** (`claimshield_app_role`, `claimshield_service_role`) | Sprint 0 DDL — see 06 |
| Express routes (raw grep) | **261** | `_queries/20_routes_raw.txt` (file has 263 lines incl. headers) |
| Frontend routes (App.tsx) | 41 `<Route>` blocks | `client/src/App.tsx:55-308` |
| Configured organizations | **3** | `organizations` row count |

**Sprint 0 baseline:** Phase 3 / Sprint 0 (completed 2026-05-03) introduced `practice_profiles`, `organization_practice_profiles`, `provider_practice_relationships`, `provider_payer_relationships`, `patient_insurance_enrollments`, `claim_provider_assignments` — see `docs/architecture/migration-state.md` and `docs/architecture/sprint0-audit-report.md`. This audit reflects the **post-Sprint-0** state of the dev DB.

## Document index

| # | File | Topic |
|---|---|---|
| 01 | `01-database-schema.md` | All 88 tables, FK graph, constraints, sequences |
| 02 | `02-data-flows.md` | Lead→patient→claim, intake flow runner, EDI cycle, ERA cycle |
| 03 | `03-module-boundaries.md` | Intake / Billing / Admin / Shared boundaries |
| 04 | `04-api-surface.md` | Express route inventory grouped by module + auth |
| 05 | `05-frontend-routes.md` | Wouter route table + AuthGuard role gates |
| 06 | `06-auth-and-tenancy.md` | Passport, session store, multi-tenancy enforcement |
| 07 | `07-rules-engine.md` | Sanity rules, DB-backed rules, severity, scoring |
| 08 | `08-edi-pipeline.md` | 837P generation, Stedi submission, 277/835 parsing |
| 09 | `09-integrations.md` | Stedi, Vapi, Twilio, Gmail, Office Ally, VerifyTX, Claude, Playwright |
| 10 | `10-background-jobs.md` | Flow orchestrator, TF cron, scraper cron, CCI cron |
| 11 | `11-configuration.md` | Required + optional env vars, secrets, runtime knobs |
| 12 | `12-known-issues-and-tech-debt.md` | UNVERIFIED items, gaps, drift, cleanup candidates |

## Verification footer (Section 5 — "no rows modified")

Per the prompt's Section 5: the audit pipeline only issues `SELECT` statements (see `_queries/run_all.sh`). No `INSERT`/`UPDATE`/`DELETE`/`ALTER`/`CREATE`/`DROP` statements are present in any query file. Re-run `_queries/run_all.sh` to reproduce all TSVs without side effects.

**Empirical attestation:** A pre-audit baseline of `pg_stat_user_tables` was captured at `_queries/_pre_audit_table_stats.txt`. The audit pipeline issues only `SELECT` against `information_schema` / `pg_catalog` / public tables; no `INSERT`/`UPDATE`/`DELETE`/`ALTER`/`CREATE`/`DROP` is present in any query in `_queries/run_all.sh`. **Any deltas observed in `pg_stat_user_tables` between the baseline and a later snapshot reflect concurrent app-runtime activity (the workflow continues to serve requests during the audit window) — not audit-issued writes.** A fresh post-edit baseline was captured at `/tmp/baseline_v2.txt` for the Sprint-1b refresh.

**Standing order honored throughout:** No production deploy was performed; no production DB query was issued; no code was modified to produce this audit. All findings require Abeer review before any remediation.
