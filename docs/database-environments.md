# Database Environments

## The Three Databases

### 1. Replit Built-in (`DATABASE_URL`)

| Property | Value |
|----------|-------|
| Secret name | `DATABASE_URL` |
| Host | `helium` → `172.31.75.36` (Replit-internal private IP) |
| Database name | `heliumdb` |
| PostgreSQL version | Replit-managed |
| `inet_server_addr()` | `null` (Unix socket) |
| Claims | ~152 |
| Real PHI | No |
| Purpose | Replit workspace development sandbox |

This is what `server/db.ts` connects to at all times. The running application in development uses this database. It contains test fixtures and development data only.

### 2. Railway PostgreSQL (`RAILWAY_PRODUCTION_DATABASE_URL`)

| Property | Value |
|----------|-------|
| Secret name | `RAILWAY_PRODUCTION_DATABASE_URL` |
| Host | `hopper.proxy.rlwy.net:45126` |
| Database name | `railway` |
| PostgreSQL version | 17.x |
| `inet_server_addr()` | `10.182.252.64/32` |
| Claims | ~107 |
| Real PHI | Yes — real patient data including PETER Mandler |
| Purpose | Production data store for claimshield.health |

This is where real customer data lives. The deployed claimshield.health app reads `DATABASE_URL` from its deployment environment, which is wired to this Railway instance in production deployment configuration.

### 3. Replit KV Store (`REPLIT_DB_URL`)

| Property | Value |
|----------|-------|
| Secret name | `REPLIT_DB_URL` |
| Type | Key-value store (not PostgreSQL) |
| Purpose | Replit-managed KV — not used for claims or patient data |

No SQL tables. Not relevant for RCM functionality.

---

## Deprecated Secrets — Delete These

Two secrets were created with misleading names that inverted the prod/dev labels. Both pointed at Railway production (`hopper.proxy.rlwy.net`):

- **`DEV_DATABASE_URL`** — delete it. It was Railway production, not dev.
- **`PRODUCTION_DATABASE_URL`** — delete it. Identical to `RAILWAY_PRODUCTION_DATABASE_URL`, just redundantly named.

To delete: Replit sidebar → Secrets tab → find the key → delete.

---

## Which Database Each Script Uses

| Script | Default target | Railway opt-in |
|--------|---------------|----------------|
| `server/db.ts` (live app) | `DATABASE_URL` (Replit sandbox) | n/a — never changes |
| `scripts/validation-audit.ts` | `DATABASE_URL` | `--prod --confirm-production` |
| `scripts/backfill-referring-providers.ts` | `DATABASE_URL` | `DATABASE_URL=$RAILWAY_PRODUCTION_DATABASE_URL --confirm-production` |
| `scripts/backfill-extraction-history.ts` | `DATABASE_URL` | `DATABASE_URL=$RAILWAY_PRODUCTION_DATABASE_URL --confirm-production` |
| `scripts/backfill-risk-evaluation.ts` | `DATABASE_URL` | `DATABASE_URL=$RAILWAY_PRODUCTION_DATABASE_URL --confirm-production` |
| `scripts/ingest-cci-production.cjs` | requires `RAILWAY_PRODUCTION_DATABASE_URL` | `--confirm-production` |
| `scripts/ingest-cci-q2-2026.cjs` | requires `RAILWAY_PRODUCTION_DATABASE_URL` | `--confirm-production` |
| `scripts/ingest-cci-production.py` | requires `RAILWAY_PRODUCTION_DATABASE_URL` | `--confirm-production` |
| `scripts/apply-phase3-prod-migration.sh` | requires `RAILWAY_PRODUCTION_DATABASE_URL` | `--confirm-production` + interactive `APPLY` prompt |

---

## Production Guard Behaviour

Every script that can reach Railway checks the connection string hostname at startup:

```
if hostname contains rlwy.net OR railway.internal:
    require --confirm-production flag
    else: exit 1 with error message
```

This means: **accidentally running a script against Railway without intent is impossible.** You must pass `--confirm-production` explicitly. There is no default path that reaches Railway.

---

## How to Verify Which Database You Are Connected To

```sql
SELECT current_database(), inet_server_addr()::text, inet_server_port();
```

| Result | Database |
|--------|----------|
| `heliumdb`, `null`, `null` | Replit sandbox (safe) |
| `railway`, `10.182.252.64/32`, `5432` | Railway production (real data) |

---

## Hard Rules

1. **`server/db.ts` never changes.** It always reads `DATABASE_URL`. This means the live Replit dev server always hits the sandbox.
2. **No agent-driven script modifies Railway production.** If a data change is needed in Railway, a human runs it manually via the Railway dashboard → database tab → query interface.
3. **Always dry-run first.** Any backfill or migration script supports `--dry-run`. Use it.
4. **Verify before writing.** Before any Railway write operation, run `SELECT inet_server_addr()` and confirm you see `10.182.252.64/32`.
5. **No new secrets named `*_DEV_*` that point at Railway.** The naming convention is `RAILWAY_*` for Railway URLs.
