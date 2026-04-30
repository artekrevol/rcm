# Claim Shield Health

## Overview
Claim Shield Health is a healthcare revenue cycle management (RCM) platform designed to optimize healthcare billing and patient intake. It features a Billing Module for claims, patient records, denial intelligence, and reporting, and an Intake Module for lead management, AI-driven patient outreach, insurance verification, and appointment scheduling. The platform aims to improve efficiency, reduce claim denials, and enhance patient acquisition for healthcare providers, with full administrator access. The vision is to become a leading RCM solution, improving operational workflows and financial outcomes for healthcare providers.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
### Frontend
The frontend uses React 18, TypeScript, and Vite, with Wouter for routing. State management is handled by TanStack Query and local component state. UI components are built with shadcn/ui (Radix UI based) and styled with Tailwind CSS, supporting custom theming and an enterprise SaaS aesthetic. Recharts is used for data visualization. Authentication guards protect routes.

### Backend
The backend is an Express.js application built with Node.js and TypeScript, exposing RESTful API endpoints. It includes a storage abstraction layer for database interactions and enforces role-based access control.

### Data Storage
PostgreSQL is the primary database, managed with Drizzle ORM. The schema supports multi-tenancy via `organization_id` and includes entities for users, leads, patients, claims, denials, rules, organizations, and operational settings. Zod schemas provide runtime validation. Database schema changes are handled idempotently via a startup seeder.

### Authentication & Authorization
Passport.js handles authentication using a local strategy with bcrypt for password hashing and `express-session` with a PostgreSQL store. Role-based access control (e.g., `admin`, `rcm_manager`, `biller`, `super_admin`) is enforced through middleware and frontend guards. Login rate limiting is implemented.

### UI/UX Decisions
The platform features an enterprise SaaS design aesthetic with shadcn/ui and Tailwind CSS, supporting light and dark themes. Dashboards leverage Recharts for clear data visualization, prioritizing clarity and efficiency.

### Feature Specifications
- **Billing Module**: Manages claim tracking, work queues, ERA posting, denial recovery, payer classification, provider entity types, and secondary insurance coordination.
- **Intake Module**: Handles patient acquisition, AI-driven outreach, and insurance verification via a 12-item flow engine.
- **Rules Engine**: Provides universal rules with condition types and specialty tags, integrating with payer prior-authorization intelligence. It evaluates claims against payer rules, CCI edits, and sanity rules, generating a risk score.
- **Payer Manual Ingestion**: An admin pipeline that ingests payer source documents (URL or PDF) using AI to extract billing rules, supporting a multi-document schema and expanded rule vocabularies.
- **EDI/Clearinghouse Integration**: Supports 837P EDI generation and SFTP submission (Office Ally). Integrates with Stedi for real-time eligibility (270/271) and automated processing of 277 acknowledgments and 835 remittances. Includes a "Test Claim Mode" for EDI validation.
- **Admin Module**: Provides `super_admin` access for clinic management, user activity monitoring, and payer manual ingestion.
- **Timely Filing Guardian Agent**: A daily background agent monitoring claims against payer-specific deadlines, generating alerts and email digests.
- **CCI Edits (NCCI) Ingestion**: Manages CMS NCCI Practitioner PTP edits, with quarterly ingestion and an admin interface.
- **PCP Referral Capture**: Manages PCP referrals for patients, including new claim fields for referral linking and status checks.
- **Rules Versioning + Audit**: Captures rule snapshots and engine versions at claim creation, maintaining an immutable audit log for payer manual extraction changes.
- **Practice-Payer Enrollment + Field Resolver**: Enables conditional field rendering based on payer context, using `field_definitions` and `practice_payer_enrollments` tables.
- **Plan Products + Delegated Entities + Conditional Form Activation**: Extends conditional field rendering to drive per-payer conditional field rendering for patients based on plan products and delegated entities.
- **Crawler Kit (UHC Adapter)**: Automated document discovery and corpus enrichment for UHC payer documents, implementing an adapter pattern with Playwright for web scraping and a circuit breaker for reliability.
- **Source Document Architecture**: Tracks acquisition provenance for payer source documents via `source_acquisition_method` (`manual_upload`, `scraped`, `bulletin_triggered`, `manus_agent`, `cms_structured`).
- **Crawler Monitoring Layer**: Three-tier observability around the scraper cron: (1) post-scrape SQL assertions validating data integrity after each run (`runPostScrapeAssertions` — 4 checks); (2) webhook alerts posting a `MonitorPayload` JSON to `SCRAPER_ALERT_WEBHOOK_URL` on completion (`fireWebhook`); (3) weekly synthetic E2E canary test inserting a transient payer document + extraction item and verifying the pipeline (`runWeeklySyntheticTest`). All events are persisted to `scraper_monitor_log`. Admin APIs: `GET /api/admin/scrapers/monitor/log`, `POST /api/admin/scrapers/monitor/assertions`, `POST /api/admin/scrapers/monitor/synthetic-test`, `POST /api/admin/scrapers/monitor/daily-scrape`. Cron: daily 03:00 UTC scrape + Sunday 03:30 UTC synthetic test via `startScraperCron()` in `server/jobs/scraper-cron.ts`.

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
- **Stedi API**: For real-time eligibility and EDI processing.
- **unzipper**: ZIP extraction.