# Claim Shield Health

## Overview
Claim Shield Health is a healthcare revenue cycle management (RCM) platform designed to optimize healthcare billing and patient intake. It features a Billing Module for claims, patient records, denial intelligence, and reporting, and an Intake Module for lead management, AI-driven patient outreach, insurance verification, and appointment scheduling. The platform aims to improve efficiency, reduce claim denials, and enhance patient acquisition for healthcare providers, with full administrator access. The vision is to become a leading RCM solution, improving operational workflows and financial outcomes for healthcare providers.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
The frontend is built with React 18, TypeScript, and Vite, using Wouter for routing. State management combines TanStack Query for server state and local component state. UI components are built with shadcn/ui (Radix UI based) and styled with Tailwind CSS, adhering to an enterprise SaaS aesthetic with custom theming. Recharts is used for data visualization. Authentication guards protect routes.

### Backend
The backend is an Express.js application using Node.js and TypeScript, exposing RESTful API endpoints under `/api/`. It features a storage abstraction layer for database interactions and enforces role-based access control.

### Data Storage
PostgreSQL is the primary database, managed with Drizzle ORM. The schema includes entities for users, leads, patients, claims, denials, rules, organizations, and operational settings. Multi-tenancy is implemented via `organization_id`. Zod schemas provide runtime validation. Database schema changes are handled idempotently via a startup seeder.

### Authentication & Authorization
Passport.js handles authentication with a local strategy, using bcrypt for password hashing and `express-session` with a PostgreSQL store. Role-based access control (e.g., `admin`, `rcm_manager`, `biller`, `super_admin`) is enforced via middleware and frontend guards. Login rate limiting is implemented.

### UI/UX Decisions
The platform uses an enterprise SaaS design aesthetic with shadcn/ui and Tailwind CSS, supporting light and dark themes. Dashboards utilize Recharts for clear data visualization, prioritizing clarity and efficiency for healthcare professionals.

### Feature Specifications
- **Billing Module**: Manages claim tracking, work queues, ERA posting, an enhanced claim wizard, denial recovery, onboarding, payer classification, provider entity types, and secondary insurance coordination.
- **Intake Module**: Focuses on patient acquisition, AI-driven outreach, and insurance verification, orchestrated by a 12-item flow engine.
- **Rules Engine**: Features universal rules with condition types and specialty tags, integrating with payer prior-authorization intelligence. It evaluates claims against payer rules, CCI edits, and sanity rules, generating a risk score based on violations.
- **Payer Manual Ingestion**: An admin pipeline to ingest payer source documents (e.g., guides, policies) via URL or PDF, extracting billing rules using AI. It supports a multi-document schema and expanded rule vocabularies.
- **EDI/Clearinghouse Integration**: Supports 837P EDI generation and SFTP submission (Office Ally), and integrates with Stedi for real-time eligibility (270/271) and automated processing of 277 acknowledgments and 835 remittances. Includes a "Test Claim Mode" for end-to-end EDI validation.
- **Admin Module**: Provides `super_admin` access for clinic management, user activity monitoring, and payer manual ingestion.
- **Timely Filing Guardian Agent**: A daily background agent that monitors claims against payer-specific timely filing deadlines, generates alerts, and sends email digests.
- **CCI Edits (NCCI) Ingestion**: Manages global CMS NCCI Practitioner PTP edits, with quarterly ingestion and an admin interface for statistics and lookup.
- **PCP Referral Capture**: Manages PCP referrals for patients, including new claims columns for referral linking and status checks.
- **Rules Versioning + Audit**: Captures rules snapshots and engine versions at claim creation. Maintains an immutable audit log for payer manual extraction item changes and provides an admin dashboard for rule freshness and history.
- **Prompt C0 — Practice-Payer Enrollment + Field Resolver**: Foundation for conditional field rendering by payer context. Two new tables: `field_definitions` (11 universal baseline fields, `always_required=TRUE`, `activated_by_rule_kinds JSONB DEFAULT '[]'`) and `practice_payer_enrollments` (org-scoped, soft-delete via `disabled_at`, `UNIQUE(organization_id, payer_id, plan_product_code)`). Service `server/services/field-resolver.ts` exports `getActivatedFieldsForContext(ctx)` — algorithm: universals → enrollment gate → corpus query → conditional activation → 5-min in-memory cache with `invalidateResolverCache(organizationId)`. Five API routes: `GET/POST/DELETE /api/practice/payer-enrollments`, `GET /api/practice/activated-fields`, `GET /api/admin/field-definitions`. Practice Settings → Payers tab: Enrollment column per row with Enroll/Unenroll buttons (tooltip), collapsible summary panel. Acceptance script `scripts/verify-c0.ts` passes 23/23 checks: enrollment gate, cache invalidation, universal-field stability. Prompt C will add conditional fields (HMO/IPA/PCP) and wire the patient form and claim wizard to the resolver.

## External Dependencies

### Database
- **PostgreSQL**: Relational database.
- **Drizzle ORM**: Type-safe ORM.
- **connect-pg-simple**: PostgreSQL session store for `express-session`.

### Authentication
- **Passport.js**: Authentication middleware.
- **bcryptjs**: Password hashing.

### UI Libraries
- **Radix UI**: Headless UI components.
- **shadcn/ui**: Pre-styled UI components.
- **Recharts**: Charting library.
- **Lucide React**: Icon library.

### API & State
- **TanStack Query**: Server state management.
- **Zod**: Schema validation.

### Build Tools
- **Vite**: Frontend build tool.
- **esbuild**: Server bundler.
- **TypeScript**: Programming language.

### EDI / Clearinghouse
- **ssh2-sftp-client**: SFTP client for Office Ally.
- **Stedi API**: For real-time eligibility (270/271) and EDI processing (277/835).

### Utilities
- **unzipper**: ZIP extraction.