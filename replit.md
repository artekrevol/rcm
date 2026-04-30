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
- **Prompt C0 — Practice-Payer Enrollment + Field Resolver**: Foundation for conditional field rendering by payer context. Two new tables: `field_definitions` (11 universal baseline fields, `always_required=TRUE`, `activated_by_rule_kinds JSONB DEFAULT '[]'`) and `practice_payer_enrollments` (org-scoped, soft-delete via `disabled_at`, `UNIQUE(organization_id, payer_id, plan_product_code)`). Service `server/services/field-resolver.ts` exports `getActivatedFieldsForContext(ctx)` — algorithm: universals → enrollment gate → corpus query → conditional activation → 5-min in-memory cache with `invalidateResolverCache(organizationId)`. Five API routes: `GET/POST/DELETE /api/practice/payer-enrollments`, `GET /api/practice/activated-fields`, `GET /api/admin/field-definitions`. Practice Settings → Payers tab: Enrollment column per row with Enroll/Unenroll buttons (tooltip), collapsible summary panel. Acceptance script `scripts/verify-c0.ts` passes 23/23 checks.
- **Prompt C — Plan Products + Delegated Entities + Conditional Form Activation**: Builds on C0 to drive per-payer conditional field rendering for patients. Six new/extended tables: `plan_products` (16 active product types e.g. `commercial_hmo`, `ma_hmo`), `payer_supported_plan_products` (566 payer→product links), `delegated_entities` (IPA/delegated management entities), `payer_delegated_entities` (payer→IPA links, UNIQUE NULLS NOT DISTINCT). Four conditional `field_definitions` rows added: `patient_plan_product`, `patient_pcp_id`, `patient_pcp_referral_id`, `patient_delegated_entity_id`. Resolver enhanced with chained-disclosure pattern: when payer has corpus rules but no `planProductCode` provided, returns universals + `patient_plan_product` only; once plan selected, full conditional set activates. Corpus query fixed to join on `mei.section_type` (not deprecated `rule_kind_id`). Three new API routes: `GET /api/billing/payers/:id/plan-products`, `GET /api/billing/payers/:id/delegated-entities`, `GET /api/billing/plan-products`. Patients table extended with `plan_product_code`, `delegated_entity_id`, `pcp_id`, `pcp_referral_number`. Patient create/edit form (`patient-create.tsx`) rewritten with FadeField animation and resolver-driven conditional fields. UHC demo seed: demo org enrolled with UHC Commercial + MA, 3 approved extraction items (referrals×2, prior_auth×1). Acceptance script `scripts/verify-c.ts` passes 31/31 checks.

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