# Phase 3 Production Deploy — Preflight Report

**Status:** In progress (Phase 1a complete; awaiting sign-off to proceed to Phase 1b)
**Target environment:** Railway production database (`PRODUCTION_DATABASE_URL`)
**Read-only:** All queries in this document are SELECT-only against production. No DDL, no DML, no role changes.

---

## §1 — Connection Role Identity Check (Phase 1a)

**Run at:** 2026-05-03T04:51:12Z
**Connection string:** `PRODUCTION_DATABASE_URL` (Railway-managed)
**Tool:** `psql` from Replit dev workspace

### Query 1 — Identity

```sql
SELECT current_user, session_user, current_database(), version();
```

**Result:**

| current_user | session_user | current_database | version |
|---|---|---|---|
| `postgres` | `postgres` | `railway` | PostgreSQL 17.9 (Debian 17.9-1.pgdg13+1) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit |

### Query 2 — Role Attributes

```sql
SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
FROM pg_roles WHERE rolname = current_user;
```

**Result:**

| rolname | rolsuper | rolcreaterole | rolcreatedb | rolbypassrls |
|---|---|---|---|---|
| `postgres` | `t` | `t` | `t` | `t` |

### Findings

1. **Connected as `postgres` superuser.** `current_user = session_user = postgres`; no `SET ROLE` in effect.
2. **Database:** `railway` on PostgreSQL **17.9** (Debian build).
   - **Version drift vs dev:** dev runs PG **16.10** (per `replit.md` and prior audit). Prod is one major version ahead. Schema features used by Sprint 0 DDL (RLS, `FORCE ROW LEVEL SECURITY`, `SET LOCAL ROLE`, `current_setting(..., true)`) are supported on both.
3. **Role privileges (all `t` / true):**
   - `rolsuper` — superuser, bypasses every permission check including RLS regardless of `rolbypassrls` flag.
   - `rolcreaterole` — can create/drop other roles.
   - `rolcreatedb` — can create/drop databases.
   - `rolbypassrls` — explicitly bypasses RLS policies (redundant given `rolsuper`, but documented).
4. **RLS implication:** Any query run via `PRODUCTION_DATABASE_URL` **does not enforce RLS**. The Sprint 0 architecture pattern (`SET LOCAL ROLE claimshield_app_role` inside `withTenantTx`) relies on dropping superuser privileges per-transaction; that mechanism must be present and exercised by the application code path in production for tenant isolation to hold.
5. **Read-only attestation:** Both queries are SELECT-only. No row counts changed, no roles altered, no DDL emitted.

### Open questions / items for later phases

- **Whether `claimshield_app_role` already exists in prod** — to be checked in Phase 1b (role + RLS state inventory).
- **Whether `replit_readonly` role exists in prod** — `replit.md` notes it exists and has zero grants on `practice_payer_enrollments` + `org_voice_personas`. Needs confirmation against actual prod state.
- **PG 17 vs 16 schema/feature parity** — no known incompatibilities with our DDL, but worth a literature check before any DDL ships.

### Next step

**STOP. Do not proceed to Phase 1b until user signs off on Phase 1a findings.**

Phase 1b (when authorized) will inventory:
- All non-default roles in prod (`pg_roles` filtered to non-pg_* and non-rds_*)
- Existence of `claimshield_app_role`
- Existence of `replit_readonly` and its grant footprint
- Tables currently with `relrowsecurity = true` and `relforcerowsecurity = true`
- All RLS policies currently in `pg_policies`
