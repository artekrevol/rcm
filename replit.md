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
- **Payer Manual Ingestion**: Admin pipeline to ingest payer provider manuals via URL, extracting and processing information using AI with graceful fallback.
- **Plan Product Dimension**: `plan_product` column (HMO/PPO/POS/EPO/Indemnity/unknown/NULL) on both `patients` and `claims` tables. Captured inline in the claim wizard Step 1 (patient selection card) with an HMO-referral info banner. Displayed and editable on the patient detail page Insurance card. Snapshotted from patient record into claim at draft creation. `applies_to_plan_products` JSONB column on `manual_extraction_items` lets admins scope rules to specific plan products via multi-select. Backfill tool at `/admin/data-tools` for bulk-setting existing patient records.
- **CMS-1500 PDF Generation**: Enhanced to include new claim fields.
- **Test Claim Mode**: Provides end-to-end EDI validation via Stedi's production API with a test indicator, preventing phantom claims from reaching real payers.
- **Intake Flow Engine**: A 12-item flow orchestration layer on top of the intake module. Includes 5 new DB tables (`flows`, `flow_steps`, `flow_runs`, `flow_run_events`, `comm_locks`), a 30-second polling orchestrator, a Caritas Senior Care 8-step demo flow (wait → SMS → wait → call → VOB → call → SMS → email), concurrency locking via advisory locks, Vapi webhook integration for call-end advancement, inbound SMS endpoint, and a Flow Inspector UI tab on the lead detail page.

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