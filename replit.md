# Claim Shield Health — Full Reference Document

## Overview
Claim Shield Health is a multi-tenant healthcare Revenue Cycle Management (RCM) platform. It provides comprehensive solutions for billing and patient intake, targeting home care agencies, behavioral health organizations, and specialty practices. The platform aims to streamline operations through modules covering claims lifecycle management, denial recovery, EDI submission, lead management, AI-driven patient outreach, and insurance verification. Its core vision is to enhance efficiency and financial performance for healthcare providers.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture
Claim Shield Health is built on a modern web stack. The frontend utilizes React 18 with TypeScript, Vite, and Wouter for routing. State management is handled by TanStack Query for server state and React's `useState` for local component state. The UI components are built using `shadcn/ui` and Radix UI, styled with Tailwind CSS, and enhanced with Recharts for data visualization and Lucide for icons.

The backend is developed with Express.js and Node.js, also in TypeScript. PostgreSQL serves as the primary database, accessed via Drizzle ORM. Authentication is managed using Passport.js with a local strategy, `bcryptjs` for password hashing, and `express-session` with `pg-session-store` for session management.

Key technical implementations include:
- **EDI Generation and Parsing**: An internal 837P generator creates claim files, and parsers handle 835 ERA and 277 acknowledgment files.
- **AI-powered Intake**: Integration with Vapi API for outbound patient intake calls and transcript extraction.
- **Payer Document Scraping**: Playwright is used for scraping payer policy documents, with an orchestrator for managing scraper runs, circuit breaking, and rate limiting.
- **Rules Engine**: A sophisticated engine evaluates claims against a comprehensive set of rules, including CMS NCCI PTP edits and payer-specific manual extractions, to calculate risk scores and readiness statuses.
- **Multi-tenancy**: Achieved by including an `organization_id` column in every database table and enforcing tenant isolation at the API level.
- **Cron Jobs**: Scheduled tasks manage intake flow orchestration, timely filing alerts, payer document scraping, and CCI quarterly data ingestion.
- **Conditional Field Management**: Dynamically resolves patient form fields based on payer and plan contexts.
- **Client-side PDF Generation**: Generates CMS-1500 forms and appeal letters directly in the browser.

UI/UX Design:
- Uses `shadcn/ui` and Radix UI for a consistent and accessible component library.
- Tailwind CSS for utility-first styling.
- Modular layouts for different sections (Admin, Billing, Intake) with dedicated sidebars for navigation.
- Data visualization through Recharts on dashboards for KPIs and analytics.

## External Dependencies
- **PostgreSQL**: Primary database.
- **Drizzle ORM**: Database interaction layer.
- **Stedi API**: Real-time 270/271 eligibility checks and 837P claim submissions, including webhook handling for 835/277 responses.
- **Office Ally**: SFTP gateway for EDI claim submissions.
- **Vapi API**: AI-powered outbound calling for patient intake, including webhook integration for call events.
- **Twilio**: SMS capabilities for patient outreach and inbound SMS handling.
- **Nodemailer (with Gmail)**: For sending email notifications and timely filing digests.
- **Playwright**: Headless browser automation for payer document scraping.
- **Claude AI**: Used for extracting structured information from payer manual documents.
- **Passport.js**: Authentication middleware.
- **bcryptjs**: Password hashing.
- **express-session & pg-session-store**: Session management.
- **TanStack Query**: Server state management in the frontend.
- **Radix UI & shadcn/ui**: UI component libraries.
- **Recharts**: Data visualization library.
- **Lucide Icons**: Icon library.