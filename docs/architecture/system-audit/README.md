# Claim Shield Health — System Audit

**Audit date:** 2026-05-03
**Audit mode:** Read-only. No mutations were performed against the codebase or database.
**Database queried:** Development database only (`heliumdb`, PostgreSQL 16.10, captured in `_queries/00_db_identity.tsv`). **No production queries were run.**
**Standing order honored:** No deploys to production. No DB writes. All findings below are diagnostic only and require Abeer's review before any remediation.

## How this audit was produced

1. **Schema data** — read-only `information_schema` / `pg_catalog` queries against the dev DB; raw output staged in `_queries/00..12_*.tsv`. The exact SQL is in `_queries/run_all.sh`.
2. **Code data** — `rg` / `grep` extraction of routes, role checks, env vars, frontend structure, and auth wiring; staged in `_queries/20..25_*.txt`.
3. **Narrative reads** — direct `read` of authoritative source files (auth, services, jobs, schema, App.tsx, layouts).
4. **Synthesis** — every claim in 01–12 is cited as `path/to/file.ts:LINE`. Anything not directly verified is marked **UNVERIFIED**.

## Scope counts (verified)

| Surface | Count | Source |
|---|---:|---|
| Public tables | **82** | `_queries/01_tables_with_rowcounts.tsv` |
| Foreign keys | **41** | `_queries/04_foreign_keys.tsv` |
| Unique constraints | **24** | `_queries/05_unique_constraints.tsv` |
| Check constraints | **18** | `_queries/06_check_constraints.tsv` |
| Indexes | **204** | `_queries/07_indexes.tsv` |
| Triggers | **0** | `_queries/08_triggers.tsv` |
| Views | **0** | `_queries/09_views.tsv` |
| Stored functions/procs | **0** | `_queries/10_functions.tsv` |
| Sequences | **5** | `_queries/11_sequences.tsv` |
| RLS policies | **0** | `_queries/12_rls_policies.tsv` |
| Express routes (raw grep) | **261** | `_queries/20_routes_raw.txt` |
| Frontend routes (App.tsx) | 41 `<Route>` blocks | `client/src/App.tsx:55-308` |
| Configured organizations | **3** | `organizations` row count |

## Document index

| # | File | Topic |
|---|---|---|
| 01 | `01-database-schema.md` | All 82 tables, FK graph, constraints, sequences |
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

## Verification footer

Per the prompt's Section 5 ("no rows modified" check): the audit pipeline only issues `SELECT` statements (see `_queries/run_all.sh`). No `INSERT`/`UPDATE`/`DELETE`/`ALTER`/`CREATE`/`DROP` statements are present in any query file. Re-run `_queries/run_all.sh` to reproduce all TSVs without side effects.
