# Claim Shield Health

## Overview
Claim Shield Health is a multi-tenant Revenue Cycle Management (RCM) platform designed for healthcare providers such as home care agencies, behavioral health organizations, and specialty practices. Its primary purpose is to streamline billing and patient intake processes. Key capabilities include claims lifecycle management, denial recovery, EDI submission, lead management, AI-driven patient outreach, and insurance verification. The platform aims to improve operational efficiency and financial performance for healthcare organizations.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Claim Shield Health is built with a modern web stack. The frontend uses React 18 with TypeScript, Vite, Wouter for routing, and TanStack Query for server state management. UI components are developed with `shadcn/ui` and Radix UI, styled using Tailwind CSS, and incorporate Recharts for data visualization and Lucide for icons.

The backend is developed using Express.js and Node.js, also in TypeScript. PostgreSQL is the primary database, accessed via Drizzle ORM. Authentication relies on Passport.js with a local strategy, `bcryptjs` for password hashing, and `express-session` with `pg-session-store` for session management.

**Key Technical Implementations:**
-   **EDI Generation and Parsing**: Internal 837P claim file generation and parsing for 835 ERA and 277 acknowledgment files.
-   **AI-powered Intake**: Integration with Vapi API for outbound patient intake calls and transcript extraction.
-   **Payer Document Scraping**: Utilizes Playwright for automated scraping of payer policy documents, managed by an orchestrator that handles circuit breaking and rate limiting.
-   **Rules Engine**: Evaluates claims against comprehensive rulesets, including CMS NCCI PTP edits and payer-specific rules, to calculate risk scores and readiness.
-   **Multi-tenancy**: Achieved through an `organization_id` column in all database tables, enforced both at the API level and (for Phase 3 helper-routed reads) at the database level via Postgres RLS. RLS-protected reads run as `claimshield_app_role` with the tenant's org id pinned in `app.current_organization_id` by the `withTenantTx` wrapper. As of Sprint 1d, `GET /api/practice/payer-enrollments` is the latest read endpoint migrated onto this path.
-   **Cron Jobs**: Manages scheduled tasks such as intake flow orchestration, timely filing alerts, payer document scraping, and CCI quarterly data ingestion.
-   **Conditional Field Management**: Dynamically resolves patient form fields based on payer and plan contexts.
-   **Client-side PDF Generation**: Generates CMS-1500 forms and appeal letters directly in the browser.

**UI/UX Design:**
-   Employs `shadcn/ui` and Radix UI for a consistent and accessible component library.
-   Uses Tailwind CSS for a utility-first styling approach.
-   Features modular layouts for different sections (Admin, Billing, Intake) with dedicated sidebars for navigation.
-   Includes dashboards with Recharts for KPI and analytics visualization.

## External Dependencies
-   **PostgreSQL**: Primary database.
-   **Drizzle ORM**: Object-relational mapper for database interaction.
-   **Stedi API**: Handles real-time 270/271 eligibility checks, 837P claim submissions, and webhook processing for 835/277 responses.
-   **Office Ally**: SFTP gateway for EDI claim submissions.
-   **Vapi API**: Provides AI-powered outbound calling for patient intake and integrates call event webhooks.
-   **Twilio**: Enables SMS capabilities for patient outreach and inbound message handling.
-   **Nodemailer (with Gmail)**: Used for sending email notifications and digests.
-   **Playwright**: Utilized for headless browser automation in payer document scraping.
-   **Claude AI**: Employed for extracting structured information from payer manual documents.
-   **Passport.js**: Authentication middleware.
-   **bcryptjs**: Library for password hashing.
-   **express-session & pg-session-store**: For managing user sessions.
-   **TanStack Query**: Frontend server state management library.
-   **Radix UI & shadcn/ui**: UI component libraries.
-   **Recharts**: Data visualization library.
-   **Lucide Icons**: Icon library.