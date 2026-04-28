# Claim Shield Health

## Overview
Claim Shield Health is a healthcare revenue cycle management (RCM) platform designed to streamline and optimize healthcare billing and patient intake processes. It features a Billing Module for managing claims, patient records, denial intelligence, and reporting, and an Intake Module for lead management, AI-driven patient outreach, insurance verification, and appointment scheduling. The platform aims to enhance efficiency, reduce claim denials, and improve patient acquisition and management for healthcare practices, with full access for administrators. The project's vision is to become a leading solution in healthcare RCM, significantly improving operational workflows and financial outcomes for healthcare providers.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
The frontend is built with React 18, TypeScript, and Vite. It uses Wouter for routing, with separate layouts and sidebars for Billing and Intake modules. TanStack Query manages server state, while local component state handles UI. UI components are built with shadcn/ui (based on Radix UI) and styled with Tailwind CSS, adhering to an enterprise SaaS aesthetic with custom theming. Recharts is used for data visualization. Authentication guards protect routes.

### Backend
The backend is an Express.js application developed with Node.js and TypeScript, exposing RESTful API endpoints under `/api/`. It utilizes a storage abstraction layer for database interactions and enforces role-based access control, particularly for billing-specific routes.

### Data Storage
PostgreSQL serves as the primary database, managed with Drizzle ORM for schema definition and querying. The schema includes comprehensive entities for users, leads, patients, claims, denials, rules, organizations, and various operational settings. Performance is optimized with critical indexes and GIN full-text search. Zod schemas provide runtime validation. Multi-tenancy is implemented through `organization_id` on all relevant data tables, allowing global reference tables.

### Authentication & Authorization
Authentication is handled by Passport.js with a local strategy, using bcrypt for password hashing and express-session with a PostgreSQL store. Role-based access control (`admin`, `rcm_manager`, `biller`, `coder`, `front_desk`, `auditor`, `appeals_specialist`, `intake`, `super_admin`) is enforced via middleware on API endpoints, complemented by frontend guards. Login rate limiting is backed by a `login_attempts` DB table (10 attempts per 15-minute window per IP). A `role_permissions` table defines allowed actions per role/resource. AuthGuard shows a proper "Access Restricted" page for unauthorized roles instead of silently redirecting. Public chat widget functionalities are exempt from these controls.

### UI/UX Decisions
The platform adopts an enterprise SaaS design aesthetic with shadcn/ui and Tailwind CSS, supporting both light and dark themes. Dashboards leverage Recharts for clear data visualization. The user interface prioritizes clarity and efficiency for healthcare professionals.

### Feature Specifications
- **Billing Module**: Includes claim tracking, follow-up work queues, ERA posting (including manual 835 upload), and an enhanced claim wizard with new fields (e.g., Claim Frequency Code, Ordering Provider, Delay Reason Code). It also features a Denial Recovery Agent panel for actionable insights, an Onboarding Checklist for new users, and an org-readiness banner on the dashboard.
- **Payer Classification (Class A)**: `payers` table has `payer_classification VARCHAR(32)` (e.g., `va_community_care`, `medicare_part_b`, `medicare_advantage`, `medicaid`, `commercial`, `tricare`) and `claim_filing_indicator VARCHAR(2)` columns. All EDI rules engine VA/Medicare heuristics use `payer_classification` instead of name-string matching. Claim filing indicator written to SBR09 of 837P. Both fields editable in the payer settings dialog.
- **Provider Entity Type (Class E)**: Provider form supports Type 1 (Individual) and Type 2 (Organization) entity types. Organization providers use organization name instead of first/last name. Field renders conditionally based on type. Backend POST/PATCH properly maps `organizationName` → `first_name` for organization providers.
- **Tenant Isolation (Class B)**: All `SELECT id FROM providers WHERE is_default = true` fallback queries in EDI routes (edi-validate, EDI download, OA submit, Stedi submit, Stedi test) are scoped with `AND organization_id = $1` to prevent cross-tenant provider leakage.
- **Org Readiness (Class D/F)**: `GET /api/billing/org-readiness` endpoint checks NPI, tax ID, practice name, active provider count, and payer-with-EDI-ID. Dashboard shows amber banner listing missing items with a "Go to Settings" link; dismissible per session.
- **Reports**: Four live reports (A/R Aging, Denial Analysis, Collections Rate, Clean Claim Rate) with date/payer/provider filters, Recharts charts, and CSV export.
- **Secondary Insurance (COB)**: Patient records support secondary payer (payer name, member ID, group number, plan name, relationship). DB columns: `secondary_payer_id`, `secondary_member_id`, `secondary_group_number`, `secondary_plan_name`, `secondary_relationship` on patients table. Secondary payer uses a proper Select dropdown linked to configured payers in both patient-create and patient-detail. Claim wizard review step shows COB secondary payer/member ID when present.
- **ERA Upload**: Manual 835 ERA file upload via text-based endpoint with parse preview showing payer, check number, payment date, total amount, and line count. ERA page has "Upload 835 File" button.
- **Code Lookup (HCPCS)**: Multi-payer rate display in search results: VA Community Care (live), Medicare Physician Fee Schedule (stub for future sync), and Custom Contracted Rate (stub). Non-VA focused empty state and placeholder.
- **Rules Specialty Tags**: `specialty_tags TEXT[]` column on rules table auto-seeded (VA Community Care, Medicare, Medicaid, Home Health, Behavioral Health, Universal). Filter pill bar on rules page. Tag selector in "New Rule" dialog. Tag chips displayed per row.
- **Prior Auth Two Modes**: Mode A — Record Received Auth (VA referrals, proactive auths). Mode B — Track PA Request (submit & track through approval/denial). Cards show mode badge, unit utilization %, and expiry warnings. New fields: mode, source, referring provider name/NPI, approved/used units, clinical justification.
- **Provider Taxonomy Auto-Suggest**: TAXONOMY_SUGGESTIONS lookup for 20 credential types. Selecting a credential shows clickable taxonomy code chips (code + specialty label). Single-suggestion credentials auto-fill the taxonomy field.
- **Intake Module**: Focuses on patient acquisition and management, including AI-driven outreach and insurance verification.
- **Payer Prior-Authorization Intelligence Layer**: Manages payer-specific authorization rules, including a `payer_auth_requirements` table and API endpoints to check and manage these rules. The claim wizard integrates this intelligence to guide users on authorization requirements.
- **EDI/Clearinghouse Integration**: Supports 837P EDI generation and submission via SFTP (Office Ally) and integrates with Stedi for real-time eligibility checks (270/271) and automated processing of 277 acknowledgments and 835 remittances.
- **Admin Module**: A `super_admin` role provides access to a dedicated admin module for platform overview, clinic management, user activity monitoring, and payer manual ingestion, bypassing organizational scope.
- **Payer Manual Ingestion (Phase 2)**: Admin pipeline to ingest payer provider manuals via URL (HTML or text-layer PDF). Tables: `payer_manuals`, `manual_extraction_items`. Service: `server/services/manual-extractor.ts` (fetch + section split), `server/services/claude-extractor.ts` (4-section Claude AI extraction with graceful fallback). Routes: GET/POST `/api/admin/payer-manuals`, GET `/:id/items`, POST `/:id/process`, PATCH `/api/admin/payer-manual-items/:id` (approve writes to payers/rules/payer_auth_requirements), DELETE `/:id`. UI: `/admin/payer-manuals` — review panel with approve/reject per section (timely_filing, prior_auth, modifiers, appeals), confidence badges, expand/collapse. Pre-seeded: TriWest, Medicare, Aetna with 12 approved extraction items. Requires `ANTHROPIC_API_KEY` env var for live Claude extraction; falls back gracefully otherwise.
- **CMS-1500 PDF Generation**: Enhanced to include new claim fields.
- **Test Claim Mode**: Free end-to-end EDI validation via Stedi's production API with ISA15='T' (Test indicator per X12 5010 spec). Claims are validated fully but never transmitted to the real payer. Available in: (1) claim wizard Review step — "Test This Claim First" button with pass/fail modal and plain-English error mapping; (2) claim detail page — "Run Test Validation" button. Results stored in `last_test_status`, `last_test_at`, `last_test_errors` on the claims table. Validation Status card shown in claim detail sidebar. Claim tracker shows validation badge (Passed/N errors/Not tested) for draft claims. "Test Validation" events rendered in grey in timeline to distinguish from real submissions. super_admin can test any claim across all orgs.
- **Submission Environment Guards**: Prevents phantom/demo claims from reaching real payers. Key components: (1) `server/lib/environment.ts` — `STEDI_ENV` env var drives `ISA15_INDICATOR` ('T' everywhere except production); (2) `server/services/edi-generator.ts` — ISA15 is no longer hardcoded 'P', must be passed explicitly via `resolveISA15()`; (3) `server/services/stedi-claims.ts` — `submitClaim()` reads ISA15 from EDI and refuses to mutate it, `AutomatedSubmissionBlocked` error for no-session calls; (4) `server/lib/test-data-detector.ts` — `looksLikeTestData()` blocks ISA15=P submissions with demo/fixture patient data; (5) Wizard UI — environment badge (red LIVE / blue TEST), test-mode override checkbox, FRCPB auto-lock, "SUBMIT TO PAYER" typed-confirmation modal for production submissions; (6) `submission_attempts` table — audit log of every Stedi submission attempt with ISA15, testMode, automated flag, and testDataResult. Set `STEDI_ENV=production` only in Railway/production deployments. Set `STEDI_AUTOMATED_TEST_MODE=true` to allow automated agents to submit ISA15=T claims only.

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
- **Stedi API**: For real-time eligibility (270/271) and EDI processing (277/835).
  - Webhook endpoints: POST /api/webhooks/stedi (277CA + 835 with idempotency via webhook_events table); POST /api/webhooks/stedi/enrollment (enrollment status events)
  - Polling: 277 every 4hr, 835 every 24hr (webhooks are primary delivery path)
  - GET /api/billing/stedi-status (hyphen) returns configured/mode/label; GET /api/billing/stedi/status (slash) also exists for backward compat
  - TriWest payer: payer_id=TWVACCN, timely_filing=180, enrollment_status_835/837=active
  - `webhook_events` table stores event_id for idempotency
  - `payers` table: enrollment_status_835, enrollment_status_837, enrollment_activated_at columns

### Schema Governance Rule (CRITICAL)
Every new database table or column addition **must** be placed in the startup seeder inside `server/routes.ts` (the `try` block at the top of `registerRoutes`). Use `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE … ADD COLUMN IF NOT EXISTS` so the statement is idempotent. **Never add raw DDL only to `scripts/post-merge.sh`** — that script only runs on Replit task-branch merges, not on Railway production deployments.

- The startup seeder runs on every server start in all environments (Replit and Railway).
- The seeder logs `[SEEDER] Starting startup schema seeder…` at the beginning and `[SEEDER] Startup schema seeder complete.` at the end so you can confirm it ran.
- For schema objects at high risk of environment drift, a `seederLog('table'|'column', …)` check is called just before the DDL statement to log whether the object was already present or is being created for the first time.
- `scripts/post-merge.sh` now only installs dependencies (`npm install`); the seeder owns all DDL.

### Rules Engine (ClaimShield 2.0)
- Universal rules seeded with `condition_type` schema (12 rules: missing NPI, diagnosis, charges, payer, service date, VA auth, timely filing, duplicate, etc.)
- `rules` table new columns: condition_type, condition_value, action, is_active
- EDI validate endpoint runs both legacy trigger_pattern rules AND new condition_type rules engine
- VOB check filters by payer_id/payer_name to avoid false positives
- HCPCS VA rate lookup uses `default_va_locality` from practice_settings (fallback: SF Bay Area locality)
### Phase 4: Top 20 Commercial Payer Ingestion
- **`payer_manual_sources` table**: Registry of top 20 commercial payers with their known public billing guideline URLs, priority order, last_verified_date, notes, and linked_manual_id (FK to payer_manuals).
- Seeded with all 20 payers (UHC, BCBS, Cigna, Humana, Aetna, Centene/WellCare, Molina, Elevance, Kaiser, Health Net, AmeriHealth, Tufts, HCSC, Highmark, Capital BlueCross, Medica, Priority Health, IBX, Oscar, Bright Health) in priority order by US covered-lives market share.
- **New API endpoints** (all require super_admin):
  - `GET /api/admin/payer-manual-sources` — list all 20 payer sources with linked manual status
  - `PATCH /api/admin/payer-manual-sources/:id` — update canonical_url, last_verified_date, notes, linked_manual_id
  - `GET /api/admin/payer-manual-coverage` — aggregate coverage data: summary (total_sources, ingested_count, section coverage %) + per-payer coverage (timely_filing ✓/✗, prior_auth ✓/✗, modifiers ✓/✗, appeals ✓/✗)
- **Updated Payer Manuals admin page** (`client/src/pages/admin/payer-manuals.tsx`):
  - "Manual Coverage" dashboard widget shows: Payers Ingested count, section coverage % for each type, and a full payer-by-payer status table with ✓/✗ indicators for each section type
  - New "Source Registry" tab shows all 20 payers with their URLs, ingestion status, and "Ingest" button that pre-fills the Add Manual dialog with payer name + URL (auto-links the source to the created manual on success)
  - Existing "Manuals" tab retains all existing manual review functionality
