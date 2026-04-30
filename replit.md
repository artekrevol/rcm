# Claim Shield Health

## Overview
Claim Shield Health is a healthcare revenue cycle management (RCM) platform designed to streamline and optimize healthcare billing and patient intake processes. It features a Billing Module for managing claims, patient records, denial intelligence, and reporting, and an Intake Module for lead management, AI-driven patient outreach, insurance verification, and appointment scheduling. The platform aims to enhance efficiency, reduce claim denials, and improve patient acquisition and management for healthcare practices, with full access for administrators. The project's vision is to become a leading solution in healthcare RCM, significantly improving operational workflows and financial outcomes for healthcare providers.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
The frontend is built with React 18, TypeScript, and Vite, using Wouter for routing. State management uses TanStack Query for server state and local component state for UI. UI components are built with shadcn/ui (Radix UI based) and styled with Tailwind CSS, adhering to an enterprise SaaS aesthetic with custom theming. Recharts is used for data visualization. Authentication guards protect routes.

### Backend
The backend is an Express.js application developed with Node.js and TypeScript, exposing RESTful API endpoints under `/api/`. It utilizes a storage abstraction layer for database interactions and enforces role-based access control.

### Data Storage
PostgreSQL serves as the primary database, managed with Drizzle ORM. The schema includes entities for users, leads, patients, claims, denials, rules, organizations, and operational settings. Multi-tenancy is implemented through `organization_id` on relevant data tables. Zod schemas provide runtime validation. Schema governance ensures all new database tables or columns are added idempotently via a startup seeder.

### Authentication & Authorization
Passport.js handles authentication with a local strategy, using bcrypt for password hashing and express-session with a PostgreSQL store. Role-based access control (e.g., `admin`, `rcm_manager`, `biller`, `super_admin`) is enforced via middleware on API endpoints and complemented by frontend guards. Login rate limiting is implemented.

### UI/UX Decisions
The platform adopts an enterprise SaaS design aesthetic with shadcn/ui and Tailwind CSS, supporting both light and dark themes. Dashboards leverage Recharts for clear data visualization, prioritizing clarity and efficiency for healthcare professionals.

### Feature Specifications
- **Billing Module**: Includes claim tracking, follow-up work queues, ERA posting (manual 835 upload), an enhanced claim wizard, a Denial Recovery Agent panel, an Onboarding Checklist, and org-readiness banner. Supports payer classification, provider entity types, and secondary insurance (COB).
- **Intake Module**: Focuses on patient acquisition and management, including AI-driven outreach and insurance verification.
- **Rules Engine**: Features universal rules with `condition_type` schema and specialty tags.
- **Payer Prior-Authorization Intelligence Layer**: Manages payer-specific authorization rules and integrates with the claim wizard.
- **EDI/Clearinghouse Integration**: Supports 837P EDI generation and submission via SFTP (Office Ally) and integrates with Stedi for real-time eligibility checks (270/271) and automated processing of 277 acknowledgments and 835 remittances.
- **Admin Module**: A `super_admin` role provides access to clinic management, user activity monitoring, and payer manual ingestion.
- **Provider Guide Ingestion** (formerly "Payer Manual Ingestion"): Admin pipeline to ingest payer source documents via URL or PDF upload, extracting billing rules using AI. Phase 1 multi-document schema: `payer_manuals` table now carries `document_type` (admin_guide / supplement / pa_list / reimbursement_policy / medical_policy / bulletin / contract / fee_schedule), `parent_document_id` (nullable self-ref FK for supplements), `effective_start` (DATE), `effective_end` (DATE nullable = currently in effect). GET list returns `parent_document_name` (JOIN) and `supplement_count` (subquery). UI renamed to "Provider Guide Ingestion" with document-type color badges, effective-date display, supplement indentation, and an expanded Add Source Document dialog.
- **Plan Product Dimension**: `plan_product` column (HMO/PPO/POS/EPO/Indemnity/unknown/NULL) on both `patients` and `claims` tables. Captured inline in the claim wizard Step 1 (patient selection card) with an HMO-referral info banner. Displayed and editable on the patient detail page Insurance card. Snapshotted from patient record into claim at draft creation. `applies_to_plan_products` JSONB column on `manual_extraction_items` lets admins scope rules to specific plan products via multi-select. Backfill tool at `/admin/data-tools` for bulk-setting existing patient records.
- **CMS-1500 PDF Generation**: Enhanced to include new claim fields.
- **Test Claim Mode**: Provides end-to-end EDI validation via Stedi's production API with a test indicator, preventing phantom claims from reaching real payers.
- **Intake Flow Engine**: A 12-item flow orchestration layer on top of the intake module. Includes 5 new DB tables (`flows`, `flow_steps`, `flow_runs`, `flow_run_events`, `comm_locks`), a 30-second polling orchestrator, a Caritas Senior Care 8-step demo flow (wait → SMS → wait → call → VOB → call → SMS → email), concurrency locking via advisory locks, Vapi webhook integration for call-end advancement, inbound SMS endpoint, and a Flow Inspector UI tab on the lead detail page.
- **Timely Filing Guardian Agent**: A daily background agent (cron at 6 AM UTC) that monitors all active claims against payer-specific timely filing deadlines. Calculates `timely_filing_deadline`, `timely_filing_days_remaining`, `timely_filing_status` (safe/caution/urgent/critical/expired) and `timely_filing_last_evaluated_at` on the `claims` table. Writes alerts to `timely_filing_alerts` table (UNIQUE per claim+status, supports acknowledge/snooze). Sends email digests to biller/admin users via nodemailer. API routes: `GET /api/billing/filing-alerts`, `POST /api/billing/filing-alerts/:id/acknowledge`, `POST /api/billing/filing-alerts/:id/snooze`, `POST /api/billing/claims/:id/timely-filing-evaluate`. Filing Alerts page at `/billing/filing-alerts` shows grouped alerts by severity with Acknowledge/Snooze/Take Action. Billing sidebar shows live unacknowledged badge count. Claim detail page shows inline `TimelyFilingWidget` card with Re-evaluate and Snooze actions.
- **CCI Edits (NCCI) Ingestion**: Global `cci_edits` table (no org scope) stores CMS NCCI Practitioner PTP edits with modifier_indicator (0=hard block, 1=soft/modifier, 9=historical). `server/services/cci-ingest.ts` parses CMS ZIP/CSV (flexible column header detection, tab and comma delimited). `server/jobs/cci-cron.ts` runs quarterly ingest on day 5 of Jan/Apr/Jul/Oct. API routes: `GET /api/admin/cci/stats`, `GET /api/admin/cci/search`, `POST /api/admin/cci/ingest`, `POST /api/admin/cci/upload`, `GET /api/billing/cci/check`. Admin CCI tab added to `/admin/payer-manuals` with stats cards, ingest-from-CMS button, manual CSV/ZIP upload, and code conflict lookup.
- **Rules Engine**: `server/services/rules-engine.ts` implements `ClaimContext` + `RuleViolation` interfaces and `evaluateClaim()` which queries payer manual extraction items (timely-filing, prior-auth, modifier, appeals rules), CCI edits (hard-block & soft), sanity rules (date, data-quality, plan-product), and PCP referral check. `scoreViolations()` converts violations to a 0-100 risk score (block=+40, warn=+15, info=+5) with GREEN/YELLOW/RED thresholds (0-30/31-70/71+). `claims` table has `last_risk_evaluation_at TIMESTAMP` and `last_risk_factors JSONB` (persisted on every risk run). `POST /api/billing/claims/:id/risk` now delegates to the rules engine and maintains backward-compatible `cciFactors[]`. `POST /api/billing/claims/preflight` accepts a partial ClaimContext and returns `{factors}` without requiring an existing claim ID. Claim wizard step 2 shows a debounced (500ms) real-time preflight violations banner and field-level hints on Service Date and ICD-10. Step 3 risk panel groups `RuleViolation[]` by severity (Blockers → Warnings → Info) with ruleType badges, italic fix suggestions, and a "View source" dialog for payer-manual violations with raw `sourceQuote`.
- **PCP Referral Capture**: Global `pcp_referrals` table (org-scoped) stores PCP referrals for patients with fields: pcp_name/npi/phone/practice_name, referral_number, issue_date, expiration_date, visits_authorized, visits_used, specialty_authorized, diagnosis_authorized, captured_via (manual_entry/card_scan/fax/phone_verification), status (active/expired/used_up/revoked/pending_verification). 3 new claims columns: `pcp_referral_id` (FK), `pcp_referral_required` (boolean), `pcp_referral_check_status` (CHECK constraint enum). API routes: `GET /api/billing/patients/:id/referrals`, `POST /api/billing/patients/:id/referrals`, `PATCH /api/billing/referrals/:id`, `POST /api/billing/claims/:id/link-referral` (links referral + increments visits_used + sets missing flag). Patient detail page has a 5th "Referrals" tab (amber highlight for HMO/POS patients) with active/historical referral cards, revoke action, and Add Referral form. Claim wizard Step 0 shows a PCP Referral Check card for HMO/POS patients — lists active referrals as selectable options or offers "Acknowledge missing" flow; "Next" button is gated until selection is made; selected referral is linked after draft creation. Daily cron at 6AM UTC runs `maintainReferralStatuses()` to expire/used-up stale referrals. Rules engine `evaluatePCPReferral()` produces block for missing/expired/used-up, warn for unknown status.
- **Rules Versioning + Audit Polish**: Three new `claims` columns (`rules_snapshot JSONB`, `rules_engine_version TEXT`, `ncci_version_at_creation TEXT`) capture the full approved-rules context at draft creation time. `payer_manual_extraction_history` table (UUID PK, `extraction_id`, `changed_by`, `change_type`, `state_snapshot JSONB`, `change_notes`, `payer_name`, `section_type`) is an immutable audit log written on every extraction-item review-status change. `manual_extraction_items` gets `last_verified_at TIMESTAMP` (backfilled from `reviewed_at`) and `needs_reverification BOOLEAN`. Admin API routes: `GET /api/admin/rules-database/overview`, `/freshness`, `/history`, `/leaderboard`, `/cms-conflicts`; `GET /api/admin/extraction-items/:id/history`; `PATCH /api/admin/extraction-items/:id/reverify`. Admin Rules Database dashboard at `/admin/rules-database` (super_admin only) shows overview KPI cards, rule freshness table (color-coded by days-since-verification), filterable activity log, top-contributors leaderboard, and CMS validation conflict panel. Per-rule provenance panel added to `ExtractionItemCard` in Payer Manuals: shows reviewer name, last-verified date, needs-reverification badge, and "Rule history" dialog with per-item timeline. Enhanced "View source" citation dialog in claim wizard now shows `reviewedBy` and `lastVerifiedAt` from the rules engine's `RuleViolation` interface. `RuleViolation` has two optional provenance fields populated for all payer-manual violations.

## External Dependencies

### Database
- **PostgreSQL**: Relational database.
- **Drizzle ORM**: Type-safe ORM.
- **connect-pg-simple**: PostgreSQL session store.

### Authentication
- **Passport.js**: Authentication middleware.
- **bcryptjs**: Password hashing.

### UI Libraries
- **Radix UI**: Headless UI components.
- **shadcn/ui**: Pre-styled UI components.
- **Recharts**: Charting library.
- **Lucide React**: Icon library.
- **date-fns**: Date utilities.

### API & State
- **TanStack Query**: Server state management.
- **Zod**: Schema validation.

### Build Tools
- **Vite**: Frontend build tool.
- **esbuild**: Server bundler.
- **TypeScript**: Programming language.

### EDI / Clearinghouse
- **ssh2-sftp-client**: SFTP client for Office Ally.
- **Stedi API**: For real-time eligibility (270/271) and EDI processing (277/835), including webhooks for event delivery.

### Utilities
- **unzipper**: ZIP extraction for CMS NCCI quarterly file downloads and manual uploads.