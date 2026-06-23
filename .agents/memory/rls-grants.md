---
name: claimshield_app_role grants
description: RLS policies are invisible until the role has table-level GRANTs; HH tables were missing them.
---

## The rule
Postgres evaluates table-level access permissions BEFORE evaluating RLS policies. If `claimshield_app_role` has no GRANT on a table, every query via `withTenantTx` returns `permission denied for table` — RLS never even runs.

## Why
The HH tables (`episodes`, `billing_periods`, `episode_visits`, `noa_filings`, `pre_claim_reviews`) were created by the seeder with no explicit GRANT statements. Only the `postgres` superuser had access. The `claimshield_app_role` was created but never granted table permissions, so `withTenantTx` (which sets the role) could not read or write any HH table.

## How to apply
The seeder in `server/routes.ts` (inside `initializeDatabase`) now grants CRUD on all HH tables:

```ts
for (const tbl of ['episodes','billing_periods','episode_visits','noa_filings','pre_claim_reviews']) {
  await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${tbl} TO claimshield_app_role`).catch(() => {});
}
```

This runs after the tables are created and is idempotent (re-granting is a no-op).

When adding new HH tables, always add a matching GRANT line in this loop.
