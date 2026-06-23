---
name: Demo seed safety
description: How to add org demo/sample data seeds without endangering the Railway production DB.
---

Org demo/sample data seeds must be **standalone, manually-run, dev-only** scripts.
Never import them from `server/index.ts` startup and never bundle them into the
production seed (`server/seed.ts` → `dist/seed.cjs`, run with `NODE_ENV=production`
on Railway).

**Why:** app startup and the production seed execute against the Railway
production database, which holds real patient PHI. Injecting demo patients there
would corrupt production data. `replit.md` forbids touching Railway from this
workspace at all.

**How to apply:**
- Guard the runner: refuse to run if `DATABASE_URL` host looks like prod
  (`rlwy.net` / `railway`).
- Resolve global FKs (e.g. `payers`) by name, not by id — global payer UUIDs are
  randomly generated per database by the reference-tables seed, so hardcoded ids
  break on a rebuilt DB. Fail loudly if a required payer is missing.
- Make it idempotent with FK-safe `DELETE`s scoped to the org before re-inserting.
- The `executeSql` tool mangles `$$` dollar-quoting (treats `$` as a param
  prefix); keep validation SQL free of `DO $$ ... $$` blocks — do such checks in
  the TS runner instead. `pool.query` handles `$$` fine.
