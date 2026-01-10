# ClaimShield AI

## Overview

ClaimShield AI is a healthcare revenue cycle management (RCM) platform designed to prevent claim denials before they happen. The application provides pre-claim risk assessment, real-time claim tracking, denial pattern intelligence, and automated prevention rules. It serves healthcare revenue cycle professionals who need to reduce denied claims and protect revenue.

The platform demonstrates four core capabilities:
1. **Pre-Claim Prevention** - Eligibility and authorization risk scoring before claim submission
2. **Claim State Tracker** - Timeline-based claim monitoring with stuck claim detection
3. **Denial Pattern Intelligence** - Clustering denial reasons and auto-generating prevention rules
4. **Lead Management** - Patient intake with simulated AI voice agent integration

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework**: React 18 with TypeScript, using Vite as the build tool and dev server.

**Routing**: Wouter for lightweight client-side routing. Pages include dashboard, leads, claims, intelligence, rules, and demo scenarios.

**State Management**: TanStack Query (React Query) for server state management with a centralized query client. No global client state library - component-level state with useState.

**UI Components**: shadcn/ui component library built on Radix UI primitives. Components are copied into the codebase at `client/src/components/ui/`. Custom business components live in `client/src/components/`.

**Styling**: Tailwind CSS with a custom design system. CSS variables define the color palette supporting light/dark themes. The design follows enterprise SaaS patterns inspired by Linear and Stripe.

**Charts**: Recharts library for data visualization on the dashboard and intelligence pages.

### Backend Architecture

**Framework**: Express.js running on Node.js with TypeScript.

**API Design**: RESTful API endpoints under `/api/` prefix. Routes defined in `server/routes.ts` with a storage abstraction layer.

**Storage Pattern**: The storage interface in `server/storage.ts` abstracts all database operations. This allows swapping storage implementations without changing route handlers.

**Development Server**: Vite middleware is integrated with Express during development for hot module replacement. Production serves static files from the `dist/public` directory.

### Data Storage

**Database**: PostgreSQL with Drizzle ORM. Schema defined in `shared/schema.ts` using Drizzle's PostgreSQL column types.

**Schema Entities**:
- Users (authentication)
- Leads (patient intake pipeline)
- Patients (linked to leads with insurance info)
- Encounters (service requests)
- Claims (with risk scores and readiness status)
- ClaimEvents (timeline entries)
- Denials (denial records with root causes)
- Rules (prevention rules with trigger patterns)
- Calls (voice call logs)

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
- ~~Auto-Fill Lead Data~~ - Call-extracted info (service needed, insurance carrier, member ID) auto-populates lead records

### Future Enhancements
- Call Performance Dashboard - Track call completion rates, durations
- Revenue Impact Reporting - Estimated revenue protected
- Payer Performance Scorecard - Denial rates, payment speeds
- Bulk Call Campaigns - Queue multiple leads for AI calling
- Task Assignment Queue - Assign leads/claims to team members
- Automated Follow-up Reminders - Auth expiration alerts
- Real-time Eligibility API - Live insurance verification
- Claim Submission Integration - Connect to clearinghouse