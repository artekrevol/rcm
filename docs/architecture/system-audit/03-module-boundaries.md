# 03 — Module Boundaries

The codebase is organized into three product modules (Intake, Billing, Admin) plus shared/cross-cutting code. Boundaries are physical (folder layout) and logical (route prefixes + AuthGuard role gates).

## Frontend module layout

`client/src/pages/` (per `_queries/25_frontend_structure.txt`):

- `pages/intake/*` — Intake module (dashboard, flows, flow-detail). Imports: `client/src/App.tsx:24-26`.
- `pages/billing/*` — Billing module (dashboard, patient list/create/detail, archived-patients, claim-wizard, settings, reports, prior-auth, activity-log, compliance-reports, user-management, claim-tracker, era, follow-up, filing-alerts, hcpcs, clinic-home). Imports: `client/src/App.tsx:22, 32-52`.
- `pages/admin/*` — Admin (super_admin only): overview, clinics, clinic-detail, payer-manuals, data-tools, rules-database, scrapers. Imports: `client/src/App.tsx:15-21`.
- `pages/` (root) — cross-module: `dashboard`, `deals`, `deal-detail`, `lead-analytics`, `claims`, `claim-detail`, `intelligence`, `rules`, `not-found`, `login`, `module-selector`, `cascade-demo`. Most are redirected to module-prefixed paths (`App.tsx:281-305`).

### Layout components (one per module)

- `client/src/components/intake-layout.tsx`
- `client/src/components/billing-layout.tsx`
- `client/src/components/admin-layout.tsx`

Each provides a sidebar specific to its module. **UNVERIFIED:** sidebar source files not directly read this session.

## Backend module layout

`server/` (47 files inferred from imports):

| Folder | Purpose |
|---|---|
| `server/routes.ts` | Mega-router, 13,867 lines — **monolithic**, all 261 routes registered here. |
| `server/services/` | Business logic units: `edi-generator.ts`, `rules-engine.ts`, `flow-step-executor.ts`, `flow-trigger.ts`, `flow-events.ts`, `stedi-claims.ts`, `stedi-eligibility.ts`, `stedi-webhooks.ts`, `edi-parser.ts`, `manual-extractor.ts`, `claude-extractor.ts`, `transcript-extractor.ts`, `timely-filing-guardian.ts`, `scraper-monitor.ts`, `comm-locks.ts`, `field-resolver.ts`, `org-context.ts`, `cci-ingest.ts`, `office-ally.ts`, `rejectionCodeLookup.ts`. |
| `server/jobs/` | `flow-orchestrator.ts`, `cci-cron.ts`, `scraper-cron.ts`, `timely-filing-cron.ts`, `scrape-payer-documents.ts`. |
| `server/scrapers/` | `runtime`, `uhc`, `uhc-fallback-cache`. |
| `server/lib/` | `environment.ts` (ISA15/automated-context), `rate-lookup.ts`, `test-data-detector.ts`. |
| `server/seeds/` | `caritas-flow.ts`, `reference-tables.ts`. |
| `server/auth.ts` | Passport + session setup. |
| `server/storage.ts` | `IStorage` data-access façade. |
| `server/db.ts` | Pool + Drizzle init. |
| `server/payers.ts` | Static payer list (`allPayers` imported at `routes.ts:21`). |
| `server/verifytx.ts` | VerifyTX integration. |
| `server/index.ts` | App bootstrap (122 lines). |
| `shared/schema.ts` | Drizzle table + Zod insert schemas (~720 lines, ~31 pgTables). |

## Route-prefix conventions

- `/api/admin/*` — admin-only (super_admin or admin role). Examples: `/api/admin/users` (`routes.ts:5053-5119`).
- `/api/billing/*` — billing module endpoints (admin / rcm_manager / biller / coder / front_desk depending on operation).
- `/api/intake/*` — intake module endpoints (admin, intake).
- `/api/dashboard/*` — cross-module metrics (admin, rcm_manager, intake) at `routes.ts:7983`.
- `/api/orgs/:slug/*` — public-ish org-scoped endpoints (e.g. `lead-sources`, `service-types`) per `replit.md`.
- `/api/auth/*` — Passport login/logout/session.
- `/api/webhooks/*` — Vapi/Twilio/Stedi inbound. Vapi webhook signature: `routes.ts:9279-9281` (`VAPI_WEBHOOK_SECRET`). Stedi: `routes.ts:12767`.

## Cross-module imports

- `routes.ts` imports from every service folder (`routes.ts:7-29`). This is the boundary-violation hotspot — there is no per-module router file. **Tech-debt candidate** (see 12).
- Frontend `pages/` directly call `/api/...` via TanStack Query — no per-module API client.

## Demo / placeholder seams

- `practice_settings` rows include a demo flag pattern (`is_demo` columns appear on `patients`).
- `_autoArchiveDemoPatients()` at `server/routes.ts:188-205` archives demo patients once an org has ≥5 real patients.
- `pages/cascade-demo` — public route (no AuthGuard) at `App.tsx:67`.
