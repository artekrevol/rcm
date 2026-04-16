# Claim Shield Health

## Overview

Claim Shield Health is a healthcare revenue cycle management (RCM) platform designed to streamline and optimize healthcare billing and patient intake processes. It consists of two primary modules:

1.  **Billing Module**: Manages claim creation, patient records, HCPCS code lookups, denial intelligence, prevention rules, reporting, and practice settings for RCM managers.
2.  **Intake Module**: Handles lead management, AI-driven patient outreach (voice, SMS, email), guided chat, insurance verification (VOB), appointment scheduling, and chat analytics for intake specialists.

The platform aims to enhance efficiency, reduce claim denials, and improve patient acquisition and management within healthcare practices. Administrators have full access to both modules.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

The frontend is built with React 18 and TypeScript, using Vite for development and bundling. Wouter handles lightweight client-side routing, segregating routes for the Billing and Intake modules, each with dedicated layouts and sidebars. Authentication guards redirect unauthorized users. State management primarily uses TanStack Query for server state, with local component state for UI. UI components are built with shadcn/ui, based on Radix UI, and styled with Tailwind CSS, following an enterprise SaaS design aesthetic with a custom color palette supporting light/dark themes. Recharts is used for data visualization on dashboards.

### Backend Architecture

The backend is an Express.js application running on Node.js with TypeScript. It provides RESTful API endpoints, prefixed with `/api/`, and uses a storage abstraction layer for database interactions. Billing-specific routes under `/api/billing/*` enforce role-based access control. During development, Vite middleware integrates with Express for hot module replacement; in production, static files are served from a `dist/public` directory.

### Data Storage

PostgreSQL is the primary database, with Drizzle ORM used for schema definition and querying. The Drizzle schema includes entities for Users, Leads, Patients, Encounters, Claims, Denials, Rules, Calls, Organizations, Practice Settings, Providers, Payers, HCPCS Codes, Claim Templates, Prior Authorizations, VOB Verifications, Activity Logs, Email Automation entities, Scheduling entities, and Chat features. Additionally, `icd10_codes` and `cpt_codes` tables are populated via SQL seeds. Critical performance indexes and GIN full-text search indexes are implemented for optimal query performance. Drizzle Kit manages schema migrations. Runtime validation is enforced using Zod schemas generated from Drizzle.

### Authentication & Authorization

The system uses Passport.js with a local strategy, bcrypt for password hashing, and express-session with a PostgreSQL session store. Role-based access control (`admin`, `rcm_manager`, `intake`) is enforced via middleware (`requireAuth`, `requireRole`) on all API endpoints, except public-facing chat widget functionalities. Frontend guards complement backend security by redirecting unauthenticated or unauthorized users.

## External Dependencies

### Database

-   **PostgreSQL**: Core relational database.
-   **Drizzle ORM**: Type-safe ORM for PostgreSQL.
-   **connect-pg-simple**: PostgreSQL-backed session store.

### Authentication

-   **Passport.js**: Authentication middleware.
-   **bcryptjs**: Password hashing library.

### UI Libraries

-   **Radix UI**: Headless UI components.
-   **shadcn/ui**: Pre-styled UI component library.
-   **Recharts**: Charting library.
-   **Lucide React**: Icon library.
-   **date-fns**: Date manipulation utilities.

### API & State

-   **TanStack Query**: Server state management.
-   **Zod**: Schema validation library.

### Build Tools

-   **Vite**: Frontend build tool and dev server.
-   **esbuild**: Server bundler.
-   **TypeScript**: Programming language.

### EDI / Office Ally Integration

-   **ssh2-sftp-client**: SFTP client for Office Ally file exchange (Phase 2).

## Production Notes

- **Server startup migrations**: `registerRoutes()` runs idempotent migrations at startup: creates `denial_patterns` and `va_location_rates` tables if missing, imports VA fee schedule data from SQL file if table is empty, backfills denied claim reasons, seeds default practice settings, seeds 22 VA/CARC prevention rules, updates provider credentials, and cleans up duplicate rules.
- **Office Ally / EDI Integration**: Three-phase integration:
  - Phase 1: 837P EDI generator at `server/services/edi-generator.ts`. API endpoint `GET /api/billing/claims/:id/edi` generates HIPAA 5010 837P files. Download available from claim detail page dropdown.
  - Phase 2: SFTP service at `server/services/office-ally.ts`. Submits 837P files and retrieves 277/835 responses. Requires `OA_SFTP_HOST`, `OA_SFTP_USERNAME`, `OA_SFTP_PASSWORD` env vars.
  - Phase 3: `denial_patterns` table stores real denial data from 835 ERA files. EDI parsers at `server/services/edi-parser.ts` handle 277 acknowledgments and 835 remittances.
- **VA Location Rates**: 2160 rows from CY26 Fee Schedule. SQL source at `server/va_location_rates.sql`. Table created at startup if missing.
- **Session**: Requires `SESSION_SECRET` env var in production. Session table created inline (no SQL file dependency).
- **Passwords**: Test users use `demo123`. Bcrypt-hashed. Plaintext passwords auto-rehashed on login.
- **Multi-tenancy**: Organization-based data isolation via `organization_id` column on all data tables (users, leads, patients, encounters, claims, denials, rules, providers, practice_settings, prior_authorizations, vob_verifications, email_templates, nurture_sequences, activity_logs, appointments, availability_slots, chat_sessions, chat_messages, chat_analytics, claim_events, email_logs, claim_templates). Reference tables remain global (icd10_codes, cpt_codes, hcpcs_codes, va_location_rates, payers). Demo org ID: `demo-org-001`. All storage list methods accept optional `orgId` parameter. Routes use `getOrgId(req)` helper to extract `organization_id` from session user. New orgs start empty; demo org retains all seed data.
- **NEVER add connect-pg-simple back** — reads `table.sql` from disk, fails in bundled builds.
- **New Billing Pages** (pilot-ready features): Claim Tracker (`/billing/claim-tracker`), Follow-Up Work Queue (`/billing/follow-up`), ERA Posting (`/billing/era`) — all added to sidebar and App.tsx routes.
- **Claim wizard** enhanced: 6 new fields — Claim Frequency Code (CLM05-3), Original Claim Number (REF*F8 for freq 7/8), Homebound Indicator (NTE*ADD), Ordering Provider (NM1*DQ), Delay Reason Code (REF*4N), DX Pointers per service line.
- **EDI generator** updated: wires new fields into 837P output — CLM05-3 frequency code, REF*F8 orig claim, NTE homebound, NM1*DQ ordering provider, REF*4N delay reason.
- **Dashboard** benchmark overlay: 3 KPI cards added — A/R Days, Denial Rate %, FPRR % (First Pass Resolution Rate).
- **Claim detail** letter generators: "Proof of Timely Filing" and "Appeal Letter" PDFs generated client-side via pdf-lib from `/api/billing/claims/:id/letter-data`. Letter generator at `client/src/lib/generate-letters.ts`.
- **DB tables**: `claim_follow_up_notes`, `era_batches`, `era_lines` created at startup. New columns on `claims`: `claim_frequency_code`, `orig_claim_number`, `homebound_indicator`, `ordering_provider_id`, `delay_reason_code`, `follow_up_date`, `follow_up_status`.
- **Sprint 3 additions**:
  - **Super Admin role** (`super_admin`): Bypasses all org scoping and role checks. User `abeer@tekrevol.com` seeded at startup (password from `SUPER_ADMIN_PASSWORD` env var, default `admin123`). `requireRole` middleware auto-passes super_admin. `getOrgId()` returns `null` for super_admin.
  - **Admin module** at `/admin`: Separate `AdminLayout` with its own sidebar. Three pages: Platform Overview (clinic cards + vitals), All Clinics table, and Clinic Detail (profile, users, feature usage, friction feed). Routes protected with `requireSuperAdmin` middleware.
  - **Clinic Home page** (`/billing/clinic`): Admin-only page in billing module. Shows practice profile (read-only), team table with last_active_at, Clinic Setup Health (permanent 6-step checklist), and Quick Stats (30-day claims/paid/followups/denials). `GET /api/billing/clinic/stats` endpoint added.
  - **Chajinel Clinic org** seeded at startup (id: `chajinel-org-001`, Daniela admin user from `DANIELA_EMAIL`/`DANIELA_PASSWORD` env vars).
  - **`last_active_at` column** on users table; updated on every successful login.
  - **Module selector**: Platform Admin card added for `super_admin`. AuthGuard updated to pass super_admin through all role checks.
  - **Billing sidebar**: "My Practice" link added (admin-only) between Dashboard and Patients.
  - **Super Admin API routes**: `GET /api/super-admin/vitals`, `GET /api/super-admin/orgs`, `GET /api/super-admin/orgs/:orgId`.

- **Sprint 2 additions**:
  - **Claim Defaults tab** in Practice Settings (`/billing/settings?tab=claim-defaults`): Default TOS, default ordering provider, homebound default toggle, exclude facility toggle. Saves via `PUT /api/billing/practice-settings`. Claim wizard pre-populates from these defaults.
  - **Payer edit dialog enhanced**: Added `auto_followup_days` field + ERA Auto-Posting Rules section (5 toggles). OA submit handler sets `follow_up_date` from payer's `auto_followup_days`. ERA PATCH supports `auto-post` action with per-payer rules.
  - **CMS-1500 PDF new fields**: Box 22 (frequency code + original claim number), Box 17/17b (ordering provider name/NPI), Box 10d (homebound indicator Y). Coordinates in `cms1500-fields.ts`, wired in `generate-cms1500.ts`.
  - **Denial Recovery Agent panel** on claim detail page: CARC code → root cause + recommended action mapping (13 codes), "Fix This Claim" + "Validate & Resubmit" buttons. Endpoint: `GET /api/billing/claims/:id/denial-recovery`.
  - **Onboarding Checklist** on billing dashboard: 6-step progress card above KPI pipeline. Steps link to relevant settings pages. Dismiss button appears when all 6 steps complete. Endpoint: `GET /api/billing/onboarding-checklist`, `POST /api/billing/onboarding-checklist/dismiss`.