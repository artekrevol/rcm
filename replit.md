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