# Claim Shield Health

## Overview

Claim Shield Health is a healthcare revenue cycle management (RCM) platform split into two modules:

1. **Billing Module** (`/billing/*` routes, `rcm_manager` role) — Claim creation, patient management, HCPCS code lookup, denial intelligence, prevention rules, reports, and practice settings.
2. **Intake Module** (`/intake/*` routes, `intake` role) — Lead management, AI voice/SMS/email outreach, guided chat widget, VOB insurance verification, appointment scheduling, and chat analytics.

Admin users (`admin` role) can access both modules via a Module Selector page.

## User Preferences

Preferred communication style: Simple, everyday language.

## Authentication & Authorization

**Auth system**: Passport.js local strategy with bcrypt-hashed passwords, express-session with connect-pg-simple PostgreSQL session store.

**Routes**:
- `POST /api/auth/login` — Login with email/password
- `POST /api/auth/logout` — Destroy session
- `GET /api/auth/me` — Current user (returns 401 if unauthenticated)

**Roles**: `admin` (both modules), `rcm_manager` (billing only), `intake` (intake only)

**Middleware**: `requireAuth` (any authenticated user) and `requireRole(...roles)` (role-based access) in `server/auth.ts`, applied to `/api/billing/*` endpoints.

**Frontend guards**: `AuthGuard` component wraps protected routes in `App.tsx`, redirecting unauthenticated users to `/auth/login` and unauthorized users to `/`.

**Test users** (all password `demo123`):
- `demo@claimshield.ai` — admin
- `billing@claimshield.ai` — rcm_manager
- `intake@claimshield.ai` — intake

## System Architecture

### Frontend Architecture

**Framework**: React 18 with TypeScript, using Vite as the build tool and dev server.

**Routing**: Wouter for lightweight client-side routing. Two module route groups:
- `/billing/*` — BillingLayout with BillingSidebar (Dashboard, Patients, Claims, Code Lookup, Intelligence, Rules, Reports, Settings)
- `/intake/*` — IntakeLayout with IntakeSidebar + GuidedChatWidget (Dashboard, Chat Analytics, Lead Worklist, Scheduling)
- `/` — ModuleSelector (admin sees both, single-role users auto-redirect)
- `/auth/login` — Login page

**State Management**: TanStack Query (React Query) for server state management with a centralized query client. No global client state library - component-level state with useState.

**UI Components**: shadcn/ui component library built on Radix UI primitives. Components are copied into the codebase at `client/src/components/ui/`. Custom business components live in `client/src/components/`.

**Styling**: Tailwind CSS with a custom design system. CSS variables define the color palette supporting light/dark themes. The design follows enterprise SaaS patterns inspired by Linear and Stripe.

**Charts**: Recharts library for data visualization on the dashboard and intelligence pages.

### Backend Architecture

**Framework**: Express.js running on Node.js with TypeScript.

**API Design**: RESTful API endpoints under `/api/` prefix. Routes defined in `server/routes.ts` with a storage abstraction layer. Billing-specific routes under `/api/billing/*` with role-based middleware.

**Storage Pattern**: The storage interface in `server/storage.ts` abstracts all database operations. Billing API routes use direct SQL via `pool.query` for new tables.

**Development Server**: Vite middleware is integrated with Express during development for hot module replacement. Production serves static files from the `dist/public` directory.

### Data Storage

**Database**: PostgreSQL with Drizzle ORM. Schema defined in `shared/schema.ts` using Drizzle's PostgreSQL column types.

**Schema Entities**:
- Users (authentication with bcrypt passwords)
- Leads (patient intake pipeline)
- Patients (linked to leads with full demographics, insurance, referral info)
- Encounters (service requests with provider and place of service)
- Claims (with risk scores, service lines, ICD-10 codes, authorization, PDF URL)
- ClaimEvents (timeline entries)
- Denials (denial records with root causes)
- Rules (prevention rules with trigger patterns)
- Calls (voice call logs)
- Organizations, PracticeSettings, Providers, Payers (billing configuration)
- HcpcsCodes, HcpcsRates (service code lookup with payer-specific rates)
- ClaimTemplates (reusable claim configurations)
- PriorAuthorizations (auth tracking per encounter)
- VobVerifications (insurance verification results with context field)
- ActivityLogs (timeline with claim_id and patient_id)
- EmailTemplates, NurtureSequences, EmailLogs (email automation)
- AvailabilitySlots, Appointments (scheduling)
- ChatSessions, ChatMessages, ChatAnalytics (chat widget persistence)

**Seeded Data**:
- 13 default payers (VA Community Care, Medicare, Medicaid, TRICARE, BCBS, Aetna, UHC, Cigna, etc.)
- 10 HCPCS priority codes (G0299, G0300, G0151-G0156, T1019, T1020, S9123, S9124)
- 9 VA Community Care 2025 rates

**Migrations**: Drizzle Kit for schema migrations with `db:push` command.

**Validation**: Zod schemas generated from Drizzle schemas using drizzle-zod for runtime validation.

### Build System

**Client Build**: Vite bundles the React application to `dist/public`.

**Server Build**: esbuild bundles the Express server to `dist/index.cjs`. Select dependencies are bundled to reduce cold start times; others remain external.

**Build Script**: Custom build script at `script/build.ts` orchestrates both builds.

## External Dependencies

### Database
- **PostgreSQL** - Primary database, connection via `DATABASE_URL` environment variable
- **Drizzle ORM** - Type-safe database client and query builder
- **connect-pg-simple** - PostgreSQL session store for Express sessions

### Authentication
- **Passport.js** - Authentication framework with local strategy
- **bcryptjs** - Password hashing

### UI Libraries
- **Radix UI** - Headless UI primitives (dialog, dropdown, tabs, etc.)
- **shadcn/ui** - Pre-styled component collection using Radix
- **Recharts** - Charting library for dashboard visualizations
- **Lucide React** - Icon library
- **date-fns** - Date formatting utilities

### API & State
- **TanStack Query** - Server state management and caching
- **Zod** - Runtime schema validation

### Build Tools
- **Vite** - Frontend build tool and dev server
- **esbuild** - Server bundling
- **TypeScript** - Type checking across client, server, and shared code

### Replit-Specific
- **@replit/vite-plugin-runtime-error-modal** - Error overlay for development
- **@replit/vite-plugin-cartographer** - Code navigation plugin
- **@replit/vite-plugin-dev-banner** - Development environment indicator

## Feature Roadmap

### Completed Features
- ~~Pre-Claim Prevention~~ - Eligibility and authorization risk scoring
- ~~Claim State Tracker~~ - Timeline-based claim monitoring
- ~~Denial Pattern Intelligence~~ - Clustering and auto-generating rules
- ~~Lead Management~~ - Patient intake pipeline
- ~~Vapi AI Voice Integration~~ - Real outbound calls with transcripts
- ~~Call Notes & Transcript Viewer~~ - Display transcripts/summaries, manual notes
- ~~Insurance Verification Display~~ - VOB results (copay, deductible, coverage)
- ~~Prior Authorization Tracker~~ - Auth requests per encounter with status/expiration
- ~~Auto-Fill Lead Data~~ - Call-extracted info auto-populates lead records
- ~~Guided Chat Widget~~ - TalkFurther-style guided conversation (intake module only)
- ~~Chat Analytics Dashboard~~ - Metrics/charts and conversations table
- ~~Returning Lead Notifications~~ - Email notification for returning leads
- ~~Welcome Back Personalization~~ - Returning leads see personalized greeting
- ~~Enterprise Design System~~ - MetricCard variants, trend indicators, export buttons
- ~~Real Auth System~~ - Passport.js + bcrypt + session-based authentication
- ~~Module Split~~ - Separate billing and intake modules with role-based routing
- ~~Billing API Routes~~ - HCPCS codes, payers, providers, practice settings
- ~~Database Expansion~~ - 7 new tables, 40+ new columns across existing tables
- ~~Practice Settings UI~~ - 4-tab settings page (Providers, Practice Info, Payers, Rate Tables) with NPI validation, default provider management, payer CRUD, rate table management with 90-day staleness warnings
- ~~Patient Management UI~~ - Patient list with live search (name, DOB, carrier, member ID), create patient form (15+ fields, NPI validation, referral source dropdown), patient detail page with 4 tabs (Profile, Claims, Eligibility, Notes), atomic server-side note append, graceful handling of seeded patients with null names

- ~~Claim Creation Wizard~~ - 3-step wizard at `/billing/claims/new` with patient search/select, draft claim auto-creation, service lines with time-based unit calculator (hours→units→rate→total), ICD-10 diagnosis search, authorization, auto-save on step advance, risk scoring panel (GREEN/YELLOW/RED), validation errors/warnings with acknowledgment, Save Draft / Generate PDF placeholder / Submit to Availity modal
- ~~Claim Summary PDF~~ - Client-side PDF generation via @react-pdf/renderer with ClaimSummaryDocument component, buildClaimPdfData helper for both wizard-created and legacy seeded claims, auto-download with filename, status update to 'exported', claim_event logging, "Re-download PDF" label after first generation, PDF button on claim detail page, legacy claim fallback with footnote
- ~~Billing Dashboard Real Data~~ - GET /api/billing/dashboard/stats with pipeline (paid/in-process/draft/denied counts + amounts), 4 alert cards (denied, stale drafts, timely filing risk, high risk), recent patients by latest claim activity, recent claims table; persistent "New Claim" button in BillingLayout header
- ~~Activity Log~~ - /billing/intelligence/logs, admin-only, filterable table (date range, activity type, performer) with claim/patient links
- ~~Compliance Reports~~ - /billing/intelligence/reports, admin-only, 4 PDF report types (Access, Edit History, Export, Claims Integrity) with date range pickers and client-side PDF generation

### Future Enhancements
- Intake → Billing handoff API
- VerifyTX timeout/retry fix
