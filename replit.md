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