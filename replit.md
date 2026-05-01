# Claim Shield Health

## Overview
Claim Shield Health is a healthcare revenue cycle management (RCM) platform designed to optimize healthcare billing and patient intake. It features a Billing Module for claims, patient records, denial intelligence, and reporting, and an Intake Module for lead management, AI-driven patient outreach, insurance verification, and appointment scheduling. The platform aims to improve efficiency, reduce claim denials, and enhance patient acquisition for healthcare providers, with full administrator access. The vision is to become a leading RCM solution, improving operational workflows and financial outcomes for healthcare providers.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
### Frontend
The frontend uses React 18, TypeScript, and Vite, with Wouter for routing. State management is handled by TanStack Query and local component state. UI components are built with shadcn/ui (Radix UI based) and styled with Tailwind CSS, supporting custom theming and an enterprise SaaS aesthetic. Recharts is used for data visualization. Authentication guards protect routes. A `PageErrorBoundary` component (`client/src/components/page-error-boundary.tsx`) wraps high-risk admin routes (Payer Manuals, Data Tools) to catch render errors without crashing the whole app.

### Backend
The backend is an Express.js application built with Node.js and TypeScript, exposing RESTful API endpoints. It includes a storage abstraction layer for database interactions and enforces role-based access control.

### Data Storage
PostgreSQL is the primary database, managed with Drizzle ORM. The schema supports multi-tenancy via `organization_id` and includes entities for users, leads, patients, claims, denials, rules, organizations, and operational settings. Zod schemas provide runtime validation. Database schema changes are handled idempotently via a startup seeder.

### Authentication & Authorization
Passport.js handles authentication using a local strategy with bcrypt for password hashing and `express-session` with a PostgreSQL store. Role-based access control (e.g., `admin`, `rcm_manager`, `biller`, `super_admin`) is enforced through middleware and frontend guards. Login rate limiting is implemented. The startup seeder does **not** reset passwords for existing admin accounts — it only syncs the `super_admin` password from `SUPER_ADMIN_PASSWORD` env var, preventing accidental credential overwrite in production.

### UI/UX Decisions
The platform features an enterprise SaaS design aesthetic with shadcn/ui and Tailwind CSS, supporting light and dark themes. Dashboards leverage Recharts for clear data visualization, prioritizing clarity and efficiency.

### Feature Specifications

- **Billing Module**: Manages claim tracking, work queues, ERA posting, denial recovery, payer classification, provider entity types, and secondary insurance coordination. Supports payer-level `payer_classification` (e.g., `commercial`, `medicare_part_b`, `medicare_advantage`, `medicaid`, `bcbs`, `tricare`, `va_community_care`) and `claim_filing_indicator` (X12 SBR09 codes: `CI`, `MB`, `HM`, `MC`, `BL`, `CH`), with seeder backfill that maps known payer names and IDs to the correct values. The `claim_filing_indicator` is used directly in 837P SBR09 generation.

- **Intake Module**: Handles patient acquisition, AI-driven outreach, and insurance verification via a 12-item flow engine. Outbound AI calling is powered by Vapi (requires `VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_PHONE_NUMBER_ID`). Call records are stored in a `calls` table and exposed via `GET /api/calls-analytics/stats` (roles: `admin`, `intake`). Vapi webhooks are authenticated with `VAPI_WEBHOOK_SECRET`.

- **Rules Engine**: Provides universal rules with condition types and specialty tags, integrating with payer prior-authorization intelligence. It evaluates claims against payer rules, CCI edits, and sanity rules, generating a risk score. Claims store `last_risk_evaluation_at` (timestamp) and `last_risk_factors` (JSONB) that are updated on every evaluation so audit trails and dashboards can surface the latest risk picture without re-running the engine.

- **Payer Manual Ingestion**: An admin pipeline that ingests payer source documents (URL or PDF) using AI to extract billing rules, supporting a multi-document schema and expanded rule vocabularies (15 section types). The "Link to Payer Record" Select uses sentinel value `__none__` internally to satisfy Radix UI's constraint that SelectItem values cannot be empty strings.

- **EDI/Clearinghouse Integration**: Supports 837P EDI generation and SFTP submission (Office Ally). Integrates with Stedi for real-time eligibility (270/271) and automated processing of 277 acknowledgments and 835 remittances. Includes a "Test Claim Mode" (`ISA15=T`) for EDI validation without forwarding to real payers. When `ISA15=P` (production), the system blocks claims that contain synthetic/demo data.

- **Admin Module**: Provides `super_admin` access for clinic management, user activity monitoring, and payer manual ingestion. Admin routes for Payer Manuals and Data Tools are wrapped in `PageErrorBoundary` so JavaScript render errors display a friendly fallback instead of a white screen.

- **Timely Filing Guardian Agent**: A daily background agent (06:00 UTC) monitoring claims against payer-specific deadlines, generating alerts (`timely_filing_alerts` table) and email digests to billers, admins, and RCM managers. Also runs `maintainReferralStatuses()` to expire/close PCP referrals on the same cycle.

- **CCI Edits (NCCI) Ingestion**: Manages CMS NCCI Practitioner PTP edits, with quarterly ingestion and an admin interface. Current data: 2026Q1 (1,821,352 rows, max_eff=2026-01-01) and 2026Q2 (2,581,309 total rows, max_eff=2026-04-01, 3,488 Q2 net-new). Ingest script: `scripts/ingest-cci-q2-2026.cjs`. Quarterly cron (`startCciCron`) checks for CMS ZIP updates and falls back to a direct download URL on S3-access failures.

- **PCP Referral Capture**: Manages PCP referrals for patients, including new claim fields (`pcp_referral_id`, `pcp_referral_required`, `pcp_referral_check_status`) for referral linking and status checks. The timely filing cron expires referrals past `expiration_date` and marks them `used_up` when `visits_used >= visits_authorized`.

- **Rules Versioning + Audit**: Captures rule snapshots (`rules_snapshot` JSONB) and engine versions (`rules_engine_version`, `ncci_version_at_creation`) at claim creation, maintaining an immutable audit log. Payer manual extraction history is tracked in `payer_manual_extraction_history`.

- **Practice-Payer Enrollment + Field Resolver**: Enables conditional field rendering based on payer context, using `field_definitions` and `practice_payer_enrollments` tables. Conditional fields activate when a patient's payer enrollment record exists.

- **Plan Products + Delegated Entities + Conditional Form Activation**: Extends conditional field rendering to drive per-payer conditional field rendering for patients based on plan products and delegated entities. Tables: `plan_products`, `payer_supported_plan_products`, `delegated_entities`, `payer_delegated_entities`. Patient fields: `plan_product_code`, `delegated_entity_id`, `pcp_id`, `pcp_referral_number`.

- **Demo Seed Mode**: Seeded demo data is flagged with `is_demo_seed = TRUE` on `manual_extraction_items` and marked `[demo_seed]` in notes fields. Demo delegated entities (3 IPA/Medical Group records) and UHC extraction items are seeded for conditional field activation demos. Demo data is excluded from live claim evaluation by default. The public `/cascade-demo` route (no auth required, `client/src/pages/cascade-demo.tsx`) demonstrates cascading plan product → IPA → delegated entity behavior for stakeholder walkthroughs.

- **Crawler Kit (UHC Adapter)**: Automated document discovery and corpus enrichment for UHC payer documents, implementing an adapter pattern with Playwright for web scraping and a circuit breaker for reliability. Files: `server/scrapers/uhc.ts`, `server/scrapers/runtime.ts`, `server/scrapers/uhc-fallback-cache.ts`, `server/scrapers/types.ts`. Main job: `server/jobs/scrape-payer-documents.ts`.

- **Source Document Architecture**: Tracks acquisition provenance for payer source documents via `source_acquisition_method` (`manual_upload`, `scraped`, `bulletin_triggered`, `manus_agent`, `cms_structured`). Additional columns: `source_url_canonical`, `content_hash`, `last_scraped_at`, `scrape_status`.

- **Crawler Monitoring Layer**: Three-tier observability around the scraper cron: (1) post-scrape SQL assertions validating data integrity after each run (`runPostScrapeAssertions` — 4 checks: `new_docs_have_required_fields`, `pending_docs_have_extraction_items`, `no_silent_extraction_failures`, `no_orphan_supplements`); (2) webhook alerts posting a `MonitorPayload` JSON to `SCRAPER_ALERT_WEBHOOK_URL` on completion (`fireWebhook` — no-op if env var unset); (3) weekly synthetic E2E canary test inserting a transient payer document + extraction item and verifying the pipeline (`runWeeklySyntheticTest`). All events are persisted to `scraper_monitor_log`. Admin APIs: `GET /api/admin/scrapers/monitor/log`, `POST /api/admin/scrapers/monitor/assertions`, `POST /api/admin/scrapers/monitor/synthetic-test`, `POST /api/admin/scrapers/monitor/daily-scrape`. Cron: daily 03:00 UTC scrape + Sunday 03:30 UTC synthetic test via `startScraperCron()` in `server/jobs/scraper-cron.ts`.

- **Flow Orchestrator Reliability**: The flow orchestrator (`server/jobs/flow-orchestrator.ts`) enforces a bounded retry cap per flow step via `max_attempts` (default 3, stored per `flow_steps` row). On each tick, the orchestrator auto-fails any run where `attempt_count >= max_attempts` before the step executor can re-pick it, preventing infinite loops. Failed runs record a `failure_reason`.

### Pending / In-Progress
- **Practice-Level Billing Model** (P0 — not yet implemented): Schema additions planned — `practice_settings.billing_model` (`individual_provider_billed` | `agency_billed`), `practice_settings.agency_npi`, nullable `providers.npi` for agency-billed practices, and conditional 837P EDI routing to use `agency_npi` as the billing provider NPI when `billing_model = 'agency_billed'`. Planning doc: `.local/` checkpoint `fc8b4de`.

## External Dependencies
- **PostgreSQL**: Relational database.
- **Drizzle ORM**: Type-safe ORM.
- **connect-pg-simple**: PostgreSQL session store.
- **Passport.js**: Authentication middleware.
- **bcryptjs**: Password hashing.
- **Radix UI**: Headless UI components.
- **shadcn/ui**: Pre-styled UI components.
- **Recharts**: Charting library.
- **Lucide React**: Icon library.
- **TanStack Query**: Server state management.
- **Zod**: Schema validation.
- **Vite**: Frontend build tool.
- **esbuild**: Server bundler.
- **TypeScript**: Programming language.
- **ssh2-sftp-client**: SFTP client for Office Ally.
- **Stedi API**: For real-time eligibility (270/271) and EDI processing (277/835).
- **Vapi API**: AI-powered outbound calling for patient intake (VAPI_API_KEY, VAPI_ASSISTANT_ID, VAPI_PHONE_NUMBER_ID, VAPI_WEBHOOK_SECRET).
- **unzipper**: ZIP extraction for CMS NCCI file processing.
- **Playwright**: Headless browser for UHC payer document scraping.
