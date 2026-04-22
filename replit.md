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
Authentication is handled by Passport.js with a local strategy, using bcrypt for password hashing and express-session with a PostgreSQL store. Role-based access control (`admin`, `rcm_manager`, `intake`, `super_admin`) is enforced via middleware on API endpoints, complemented by frontend guards. Public chat widget functionalities are exempt from these controls.

### UI/UX Decisions
The platform adopts an enterprise SaaS design aesthetic with shadcn/ui and Tailwind CSS, supporting both light and dark themes. Dashboards leverage Recharts for clear data visualization. The user interface prioritizes clarity and efficiency for healthcare professionals.

### Feature Specifications
- **Billing Module**: Includes claim tracking, follow-up work queues, ERA posting, and an enhanced claim wizard with new fields (e.g., Claim Frequency Code, Ordering Provider, Delay Reason Code). It also features a Denial Recovery Agent panel for actionable insights and an Onboarding Checklist for new users.
- **Intake Module**: Focuses on patient acquisition and management, including AI-driven outreach and insurance verification.
- **Payer Prior-Authorization Intelligence Layer**: Manages payer-specific authorization rules, including a `payer_auth_requirements` table and API endpoints to check and manage these rules. The claim wizard integrates this intelligence to guide users on authorization requirements.
- **EDI/Clearinghouse Integration**: Supports 837P EDI generation and submission via SFTP (Office Ally) and integrates with Stedi for real-time eligibility checks (270/271) and automated processing of 277 acknowledgments and 835 remittances.
- **Admin Module**: A `super_admin` role provides access to a dedicated admin module for platform overview, clinic management, and user activity monitoring, bypassing organizational scope.
- **CMS-1500 PDF Generation**: Enhanced to include new claim fields.

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