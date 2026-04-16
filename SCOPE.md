# Claim Shield Health — Full Platform Scope
**Version:** ClaimShield 2.0 (Sprint 2 Complete)
**Stack:** React 18 + TypeScript / Express.js / PostgreSQL / Drizzle ORM / Vite

---

## Table of Contents
1. [Platform Architecture](#1-platform-architecture)
2. [Authentication & Access Control](#2-authentication--access-control)
3. [Module Selector (Home)](#3-module-selector-home)
4. [Intake Module](#4-intake-module)
5. [Billing (RCM) Module](#5-billing-rcm-module)
6. [Database Schema](#6-database-schema)
7. [External Integrations](#7-external-integrations)
8. [Multi-Tenancy](#8-multi-tenancy)
9. [API Reference](#9-api-reference)
10. [Test Credentials & Demo Data](#10-test-credentials--demo-data)

---

## 1. Platform Architecture

### Frontend
- **Framework:** React 18 with TypeScript
- **Build Tool:** Vite (hot module replacement in dev, static bundle in prod)
- **Routing:** Wouter (lightweight, no dependency on React Router)
- **State Management:** TanStack Query v5 for all server state; local `useState` for UI-only state
- **Component Library:** shadcn/ui (Radix UI primitives styled with Tailwind CSS)
- **Charts:** Recharts
- **Icons:** Lucide React + react-icons/si
- **PDF Generation:** pdf-lib (client-side CMS-1500 and letter PDFs)
- **Dark Mode:** Supported via Tailwind `dark:` classes; persisted in localStorage

### Backend
- **Runtime:** Node.js with TypeScript (transpiled via esbuild)
- **Framework:** Express.js
- **API Prefix:** All routes live under `/api/`
- **Dev Server:** Vite middleware is embedded in Express so frontend and backend share port 5000
- **Production:** Express serves the Vite-built static files from `dist/public`

### Data Layer
- **Database:** PostgreSQL (Replit-managed)
- **ORM:** Drizzle ORM — schema defined in `shared/schema.ts`
- **Migrations:** Idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements run at server startup inside `registerRoutes()`; no separate migration runner required
- **Session Store:** Custom inline PostgreSQL session table (connect-pg-simple is intentionally absent — it reads from disk and fails in bundled builds)
- **Validation:** Zod schemas derived from Drizzle via `drizzle-zod`

---

## 2. Authentication & Access Control

### How It Works
1. User submits email + password to `POST /api/auth/login`.
2. Passport.js LocalStrategy looks up the user by email, verifies the bcrypt hash.
3. On success, Passport serializes the user ID into an Express session backed by PostgreSQL.
4. All subsequent requests use `GET /api/auth/me` to hydrate the frontend with role and org data.
5. `requireAuth` middleware rejects unauthenticated requests with HTTP 401.
6. `requireRole(roles[])` middleware rejects users whose role isn't in the allowed list with HTTP 403.

### Roles
| Role | Access |
|---|---|
| `admin` | Full access to both Billing and Intake modules, plus user management and compliance reports |
| `rcm_manager` | Full Billing module access; no Intake access |
| `intake` | Full Intake module access; no Billing access |

### Frontend Guards
`AuthGuard` wraps every protected route. If the session is missing it redirects to `/auth/login`. If the role isn't allowed it redirects back to `/`.

### Endpoints
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Authenticate, create session |
| `POST` | `/api/auth/logout` | Destroy session |
| `GET` | `/api/auth/me` | Return current user object |

---

## 3. Module Selector (Home)

**Route:** `/`

After login, users land on a module selector card grid. Cards shown depend on role:
- Admins see both **Billing** and **Intake** cards.
- `rcm_manager` sees only Billing.
- `intake` sees only Intake.

Clicking a card routes to the respective module dashboard.

---

## 4. Intake Module

**Role Access:** `admin`, `intake`
**Layout:** `IntakeLayout` — sidebar with navigation links, consistent header

### 4.1 Intake Dashboard
**Route:** `/intake/dashboard`

**What it shows:**
- Top KPI cards: Total Leads, Qualified Leads, Scheduled Appointments, VOB Completion Rate
- Recent calls log with Vapi transcript summaries
- Lead pipeline breakdown by status (New, Contacted, Qualified, Scheduled, etc.)
- Recent activity feed

**How it works:**
`GET /api/intake/dashboard/stats` returns all aggregated metrics in a single call. The frontend uses TanStack Query to cache and display. Recharts renders the pipeline breakdown as a bar chart.

---

### 4.2 Deals (Lead Pipeline)
**Route:** `/intake/deals`

A CRM-style Kanban/list view of all leads in the organization. Each lead card shows name, phone, insurance carrier, VOB score badge, and current status.

**Filtering:** Status filter dropdown, search bar (by name/phone).

**Lead Statuses:** `new`, `contacted`, `qualified`, `scheduled`, `enrolled`, `disqualified`

**Endpoints:**
- `GET /api/leads` — list leads for org, supports status filter
- `POST /api/leads` — create new lead

---

### 4.3 Deal Detail (Lead Profile)
**Route:** `/intake/deals/:id`

Full lead record with tabbed sections:

| Tab | Content |
|---|---|
| **Overview** | Contact info, insurance carrier, status controls, notes |
| **VOB** | Insurance verification history, VOB score, missing fields |
| **Calls** | Vapi call transcripts and AI-extracted data |
| **Email** | Template-based email send + email history log |
| **Appointments** | Scheduled appointments, ability to book new |

**VOB Score** is a computed percentage indicating how complete the insurance verification is (0–100). A score ≥ 80 means the lead is ready for billing.

**Verify Insurance Button:** Triggers `POST /api/leads/:id/verify-insurance` which calls the VerifyTX API using stored credentials to perform a real-time eligibility (RTE) check. Results populate the VOB tab.

**VOB PDF Download:** `GET /api/vob-verifications/:id/pdf` generates a downloadable PDF report of the verification.

**Manual Email:** User selects an email template and sends via `POST /api/leads/:id/email`. Uses Gmail SMTP (configured via `GMAIL_USER` + `GMAIL_APP_PASSWORD` secrets).

---

### 4.4 Lead Analytics
**Route:** `/intake/lead-analytics`

Visualizes AI agent and chat session performance:
- Conversion funnel (Sessions → Completed → Leads → Qualified)
- Daily session volume chart
- Top call disposition breakdown
- Average chat completion rate

**Endpoint:** `GET /api/chat-analytics/stats`

---

### 4.5 Scheduling
**Route:** `/intake/scheduling`

Placeholder page for appointment management. The data layer is fully implemented (availability_slots and appointments tables, API endpoints below), with the UI ready for expansion.

**Endpoints:**
- `GET /api/availability` — list configured slots
- `POST /api/availability` / `PATCH /api/availability/:id` — create/update slots
- `GET /api/appointments` — list booked appointments
- `POST /api/appointments` — book new appointment

---

### 4.6 AI Chat Widget
A public-facing chat widget (no auth required) powers automated lead intake.

**How it works:**
1. Visitor triggers `POST /api/chat-sessions/init` — returns a session token stored in the visitor's browser.
2. Each message goes to `POST /api/chat/message` with the session token.
3. The bot follows a configured intake script (step IDs in `chat_sessions.currentStepId`), collects patient info, insurance data, and qualification answers.
4. Completed sessions are converted to leads automatically.

---

### 4.7 Email Templates & Nurture Sequences
Managed via API (no dedicated UI page currently):
- `GET/POST/PATCH /api/email-templates` — template CRUD
- `GET /api/nurture-sequences` — automated follow-up sequence configuration

Templates support variable interpolation (e.g., `{{patient_name}}`, `{{insurance_carrier}}`).

---

## 5. Billing (RCM) Module

**Role Access:** `admin`, `rcm_manager`
**Layout:** `BillingLayout` — sidebar with full RCM navigation

---

### 5.1 Billing Dashboard
**Route:** `/billing/dashboard`

**Onboarding Checklist** *(Sprint 2)*
A "Get Started with ClaimShield" card appears above the KPI pipeline until dismissed. It tracks 6 setup steps:
1. Practice information configured
2. At least one provider added
3. At least one payer in the system
4. Office Ally clearinghouse connected
5. Claim defaults saved
6. First claim created

Each step shows a green checkmark when complete. A progress badge shows `X/6`. The card shows a "Dismiss" button once all 6 steps are complete. Dismiss saves a timestamp to `organizations.onboarding_dismissed_at`.

**Endpoint:** `GET /api/billing/onboarding-checklist`, `POST /api/billing/onboarding-checklist/dismiss`

**Financial KPI Cards:**
- Total Billed (MTD)
- Total Collected (MTD)
- Denial Rate %
- A/R Days
- First Pass Resolution Rate (FPRR) %

**Benchmark Overlay:** Each metric card shows a colored indicator (green/yellow/red) based on industry benchmarks (A/R Days < 30 = green, 30–45 = yellow, > 45 = red; Denial Rate < 5% = green, etc.)

**Claim Status Pipeline:** Horizontal bar chart showing claim counts by status (Draft → Submitted → Acknowledged → Paid → Denied).

**Recent Activity Feed:** Last 10 claim events with timestamps.

**Endpoint:** `GET /api/billing/dashboard/stats`

---

### 5.2 Patients
**Routes:** `/billing/patients`, `/billing/patients/new`, `/billing/patients/:id`

**Patient List:** Searchable table of all patients in the org. Columns: Name, DOB, Insurance Carrier, Member ID, Last Encounter Date.

**New Patient Form:** Collects first name, last name, DOB (text field, YYYY-MM-DD format), insurance carrier, member ID, group number, address fields, phone, email. Saves via `POST /api/billing/patients`.

**Patient Detail:** Full patient chart with:
- Demographics and insurance info (editable inline)
- Encounter history table
- Claim history with status badges
- Prior authorization status

---

### 5.3 Claims Manager
**Route:** `/billing/claims`

Full-featured claims table with:
- Status filter tabs (All, Draft, Submitted, Denied, Paid)
- Search by patient name or claim ID
- Risk score badge (Low/Medium/High) — calculated from rule violations and payer history
- Readiness indicator — green check or yellow warning based on claim completeness
- Quick-action dropdown per row: View, Edit, Generate EDI, Download CMS-1500

**Endpoints:**
- `GET /api/billing/claims` — list claims for org
- `PATCH /api/billing/claims/:id` — update claim fields

---

### 5.4 Claim Wizard (New Claim)
**Route:** `/billing/claims/new`

A multi-step guided form for creating a new claim. Steps:

**Step 1 — Patient & Payer**
- Patient search/select (autocomplete from existing patients)
- Payer select (from global payers table)
- Claim Frequency Code (CLM05-3): 1=Original, 7=Replacement, 8=Void
- Original Claim Number (REF*F8) — shown only when frequency is 7 or 8

**Step 2 — Service Info**
- Type of Service (pre-populated from Claim Defaults if set)
- Place of Service code
- Service date range
- Facility/Non-facility toggle
- Homebound Indicator toggle (pre-populated from Claim Defaults)
- Delay Reason Code (REF*4N)

**Step 3 — Provider & Ordering Provider**
- Rendering provider select (from org's providers)
- Ordering Provider (NM1*DQ) — pre-populated from Claim Defaults if set
- VA ICN (Internal Control Number) field for VA billing

**Step 4 — Service Lines**
- Add up to 6 service lines
- Each line: HCPCS code (searchable), modifier 1-4, units, rate (auto-looked up from VA fee schedule for VA billing), diagnosis pointer(s) (checkbox per ICD-10 code)
- Running total displayed

**Step 5 — Diagnosis Codes**
- Add ICD-10 codes (searchable)
- Up to 12 diagnosis pointers

**Claim Defaults Pre-population** *(Sprint 2)*
When the wizard loads for a fresh claim, it fetches practice defaults from `GET /api/billing/practice-settings` and automatically fills:
- Default Type of Service → Step 2 TOS field
- Default Ordering Provider → Step 3 Ordering Provider field
- Homebound Default → Step 2 Homebound toggle
- A `defaultsApplied` guard prevents re-applying when navigating between wizard steps

**Endpoints:**
- `GET /api/billing/claims/wizard-data` — returns providers, payers, patients, practice settings, and claim templates in one call
- `POST /api/billing/claims` — save new claim
- `GET /api/billing/va-rate` — lookup VA fee schedule rate by HCPCS + location

---

### 5.5 Claim Detail
**Route:** `/billing/claims/:id`

Comprehensive claim record page with:

**Header Section:** Claim ID, patient name, payer, status badge, total amount, risk score, readiness status.

**Action Dropdown** (top-right):
- Edit Claim → opens wizard pre-filled
- Download EDI (837P) → `GET /api/billing/claims/:id/edi`
- Download CMS-1500 PDF → generates PDF client-side
- Generate Proof of Timely Filing Letter → PDF generated via pdf-lib
- Generate Appeal Letter → PDF generated via pdf-lib
- Submit to Office Ally → `POST /api/billing/claims/:id/submit`

**Office Ally Submit Logic:**
1. Validates OA connection is configured.
2. Reads payer's `auto_followup_days` — if set, calculates and writes `follow_up_date` on the claim.
3. Generates 837P EDI and (in phase 2) sends via SFTP.
4. Updates claim status to `submitted`, logs a claim event.

**Claim Info Cards:**
- Patient and insurance info
- Service lines table (HCPCS, modifier, units, rate, total)
- Diagnosis codes list
- Prior auth reference

**Denial Info Card** (shown when claim is denied):
- Denial reason text (CARC/RARC code)
- Denial category
- Root cause tag

**Denial Recovery Agent Panel** *(Sprint 2)*
Appears below the denial info card on denied/appealed claims. Maps 13 CARC codes to:
- Root cause description (plain English)
- Recommended action (specific next step)
- "Fix This Claim" button → navigates to claim wizard for editing
- "Validate & Resubmit" button → calls `POST /api/billing/claims/:id/mark-fixed` and resets status

CARC codes covered: CO-4, CO-11, CO-16, CO-18, CO-22, CO-29, CO-45, CO-96, CO-97, N30, N180, PR-1, PR-2

**Endpoint:** `GET /api/billing/claims/:id/denial-recovery`

**Claim Event Timeline:** Chronological log of all status changes, notes, and actions.

---

### 5.6 Claim Tracker
**Route:** `/billing/claim-tracker`

A pipeline board view (similar to Kanban) showing claims grouped by status. Each card shows patient name, payer, amount, and days since submission.

Useful for at-a-glance AR management.

**Endpoint:** `GET /api/billing/claim-tracker`

---

### 5.7 Follow-Up Work Queue
**Route:** `/billing/follow-up`

A prioritized list of claims requiring action, sorted by follow-up due date. Columns: Patient, Payer, Amount, Status, Follow-Up Date, Assigned To.

AR specialists can:
- Mark a claim as contacted
- Add a follow-up note (stored in `claim_follow_up_notes`)
- Reschedule the follow-up date

**Per-Payer Auto Follow-Up** *(Sprint 2)*
When a claim is submitted and the payer has `auto_followup_days` configured, the system automatically sets `claims.follow_up_date = TODAY + auto_followup_days`. This ensures the claim appears in the work queue at the right time without manual scheduling.

**Endpoint:** `GET /api/billing/follow-up`, `POST /api/billing/claims/:id/follow-up-note`

---

### 5.8 ERA (Electronic Remittance Advice) Posting
**Route:** `/billing/era`

Manages incoming 835 remittance files from payers.

**ERA List:** Table of all ERA batches with payer name, check date, total amount, and posting status.

**ERA Detail:** Expands to show individual service lines — each line has HCPCS code, billed amount, allowed amount, patient responsibility, adjustment codes (CARC/RARC), and posting status.

**Posting Actions:**
- **Post Individual Line:** Marks one line as posted, updates the linked claim's paid amount.
- **Auto-Post ERA** *(Sprint 2)*: For payers with ERA auto-posting rules configured, clicking "Auto-Post" applies the following logic per line:
  - `era_auto_post_clean`: Post lines with no adjustments automatically.
  - `era_auto_post_contractual`: Auto-accept CO-45 (contractual adjustment) lines.
  - `era_auto_post_secondary`: Auto-post lines with secondary payer credits (OA codes).
  - `era_auto_post_refunds`: Auto-post overpayment/refund lines.
  - `era_hold_if_mismatch`: Hold lines where allowed amount differs from contracted rate by > $0.01.
  - Lines that don't match an auto-post rule remain `pending` for manual review.

**Endpoints:** `GET /api/billing/eras`, `POST /api/billing/eras`, `PATCH /api/billing/eras/:id`

---

### 5.9 Prior Auth
**Route:** `/billing/claims/prior-auth`

Tracks authorization requests linked to encounters and claims. Columns: Patient, Auth Number, Service Type, Expiration Date, Status (Pending/Approved/Denied/Expired).

**Endpoint:** `GET /api/billing/prior-auths`

---

### 5.10 Denial Intelligence
**Route:** `/billing/intelligence`

AI-assisted denial pattern analysis:
- Top denial reasons by CARC code (bar chart)
- Denial trend over time (line chart)
- Payer-level denial rate table
- Root cause tag breakdown (Prior Auth Required, Timely Filing, Documentation, Bundling, etc.)

**Endpoints:** `GET /api/billing/denial-patterns`, `GET /api/carc-codes`, `GET /api/rarc-codes`

**Sub-routes (Admin only):**
- `/billing/intelligence/logs` → Full activity audit log (every field change, every action)
- `/billing/intelligence/reports` → Compliance reports (AR aging, denial summary, FPRR)

---

### 5.11 Claim Scrubber (Rules Engine)
**Route:** `/billing/rules`

22 pre-seeded denial prevention rules that run before claim submission. Each rule has:
- Name and description
- Trigger pattern (e.g., "CO-29", "NCCI bundling pair")
- Prevention action (what to warn or block)
- Enabled/disabled toggle
- Payer-specific or universal scope

Rules currently seeded include VA-specific timely filing rules, NCCI bundling checks, prior auth requirements, and modifier validation.

**Endpoints:** `GET /api/billing/rules`, `PATCH /api/billing/rules/:id`

---

### 5.12 HCPCS / CPT / ICD-10 Codes
**Route:** `/billing/codes`

Three-tab reference lookup:
- **HCPCS Tab:** Search the HCPCS code table, view official description, unit type, modifier requirement. Payer-specific rates shown inline.
- **CPT Tab:** CPT procedure code search.
- **ICD-10 Tab:** Diagnosis code search with full-text GIN index for fast lookups.
- **VA Rates Tab:** Browse the full CY26 VA Fee Schedule (2,160 rows) by location and HCPCS code.

**Endpoints:** `GET /api/billing/hcpcs`, `GET /api/billing/cpt`, `GET /api/billing/icd10`, `GET /api/billing/va-rate`

---

### 5.13 Reports
**Route:** `/billing/reports`

Standard RCM reports:
- AR Aging Report (0-30, 31-60, 61-90, 90+ days buckets)
- Monthly Collections Summary
- Denial Rate Trend
- Provider Productivity

Reports are generated from live data via aggregate SQL queries.

---

### 5.14 Practice Settings
**Route:** `/billing/settings`

Tabbed settings interface for the organization. Tabs:

#### General Tab
- Practice Name, Primary NPI, Tax ID, Taxonomy Code
- Practice address (street, city, state, zip)
- Phone number
- Default Place of Service code

**How it saves:** `PUT /api/billing/practice-settings` — the endpoint does an upsert (insert or update) keyed on `organization_id`.

#### Providers Tab
- List of all providers for the org
- Add Provider dialog: First Name, Last Name, NPI, Credentials, Taxonomy Code, Is Active toggle
- Edit Provider: same fields, inline dialog
- Endpoints: `GET /api/billing/providers`, `POST /api/billing/providers`, `PATCH /api/billing/providers/:id`

#### Payers Tab
- Global payers table (not org-scoped — shared across all orgs)
- Edit Payer dialog includes:
  - Name, Payer ID, Timely Filing Days, Auth Required toggle, Billing Type
  - **Auto Follow-Up After (days)** *(Sprint 2)*: Number of days after OA submission before the claim appears in the follow-up work queue. Leave blank to disable auto-scheduling.
  - **ERA Auto-Posting Rules** *(Sprint 2)*: Five toggles:
    1. Auto-post clean lines (no adjustments)
    2. Auto-post contractual adjustments (CO-45)
    3. Auto-post secondary payer credits
    4. Auto-post refunds/overpayments
    5. Hold for review if amount mismatch
- Endpoints: `GET /api/payers`, `PATCH /api/payers/:id`

#### Claim Defaults Tab *(Sprint 2)*
- **Default Type of Service:** Select dropdown — pre-fills TOS field in every new claim
- **Default Ordering Provider:** Select from org's providers — pre-fills Ordering Provider in every new claim
- **Homebound Default:** Toggle — if on, new claims start with the homebound indicator checked (Box 10d on CMS-1500 will print "Y")
- **Exclude Facility:** Toggle — if on, new claims default to non-facility billing
- Saves via `PUT /api/billing/practice-settings`

#### Clearinghouse Tab
- Office Ally SFTP connection setup
- Enter SFTP username and password → test connection → save
- Connection status shown (Connected / Not Connected)
- Once connected, "Submit to Office Ally" button becomes active on claim detail pages

---

### 5.15 User Management (Admin Only)
**Route:** `/billing/settings/users`

- List all users in the org
- Invite new user: Name, Email, Role (admin / rcm_manager / intake)
- Edit role
- Deactivate user

**Endpoints:** `GET /api/admin/users`, `POST /api/admin/users`, `PATCH /api/admin/users/:id`, `DELETE /api/admin/users/:id`

---

### 5.16 CMS-1500 PDF Generation
Generated entirely client-side using pdf-lib. Loads a blank CMS-1500 template image and overlays text at precise coordinates.

**Fields populated:**

| Box | Field | Source |
|---|---|---|
| 1a | Insured's ID # | Patient member ID |
| 2 | Patient Name | Patient first/last |
| 3 | Patient DOB | Patient DOB |
| 4 | Insured's Name | Same as patient |
| 10 | Patient condition (a/b/c) | Fixed: No |
| 10d | Homebound Indicator | Claim homebound_indicator → "Y" *(Sprint 2)* |
| 11 | Insured's Group # | Patient group number |
| 17 | Referring Provider Name | Ordering provider name *(Sprint 2)* |
| 17b | Referring Provider NPI | Ordering provider NPI *(Sprint 2)* |
| 21 | Diagnosis Codes | ICD-10 codes A–L |
| 22 | Resubmission Code | Claim frequency code *(Sprint 2)* |
| 22 (Orig Ref #) | Original Claim # | orig_claim_number when freq is 7 or 8 *(Sprint 2)* |
| 24A | Service Dates | From/to dates |
| 24B | Place of Service | POS code |
| 24D | Procedures | HCPCS + modifiers |
| 24E | Diagnosis Pointer | A–L mapped from ICD-10 index |
| 24F | Charges | Line amount |
| 24G | Units | Line units |
| 25 | Tax ID | Practice Tax ID |
| 26 | Patient Account # | Claim ID |
| 28 | Total Charge | Claim total amount |
| 31 | Physician Signature | "Signature on File" |
| 32 | Service Facility | Practice address |
| 33 | Billing Provider | Practice name + NPI |

---

### 5.17 837P EDI Generation
**Endpoint:** `GET /api/billing/claims/:id/edi`

Generates a HIPAA 5010 compliant 837P EDI file server-side. Returns the raw EDI text for download.

Fields wired from claim data:
- CLM05-3: Claim frequency code
- REF*F8: Original claim number (replacement/void claims)
- NTE*ADD: Homebound indicator
- NM1*DQ: Ordering provider
- REF*4N: Delay reason code
- DX pointers per service line

---

### 5.18 Letter Generation (Client-Side PDF)
**Triggered from:** Claim detail page action dropdown

**Proof of Timely Filing Letter:**
Fetches claim data from `GET /api/billing/claims/:id/letter-data`, then generates a formal letter PDF using pdf-lib with:
- Practice letterhead
- Patient name, claim ID, service dates
- Date of original submission
- Payer timely filing deadline reference

**Appeal Letter:**
Same data source, different template. Formal appeal letter with denial reason, supporting documentation checklist, and regulatory cite.

---

## 6. Database Schema

All tables (except reference tables) carry an `organization_id` column for multi-tenant isolation.

### Core Tables

| Table | Purpose | Key Columns |
|---|---|---|
| `users` | Accounts and roles | id, email, password (bcrypt), role, name, organizationId |
| `organizations` | Tenant entities | id, name, createdAt, onboarding_dismissed_at |
| `practice_settings` | Org billing config | practiceName, primaryNpi, taxId, defaultPos, defaultTos, defaultOrderingProviderId, homeboundDefault, excludeFacility, oa_sftp_username, oa_connected |
| `providers` | Rendering physicians | id, firstName, lastName, npi, credentials, taxonomyCode, isActive |
| `payers` | Insurance carriers (global) | id, name, payerId, timelyFilingDays, authRequired, billingType, auto_followup_days, era_auto_post_clean, era_auto_post_contractual, era_auto_post_secondary, era_auto_post_refunds, era_hold_if_mismatch |
| `patients` | Patient demographics | id, firstName, lastName, dob (text), insuranceCarrier, memberId, groupNumber, address |
| `encounters` | Clinical visits | id, patientId, serviceType, facilityType, expectedStartDate, providerId |
| `claims` | Billing claims | id, patientId, payerId, status, cptCodes, amount, riskScore, readinessStatus, claimFrequencyCode, origClaimNumber, homeboundIndicator, orderingProviderId, delayReasonCode, followUpDate, followUpStatus |
| `claim_events` | Claim history log | id, claimId, type, notes, timestamp |
| `claim_follow_up_notes` | AR notes | id, claimId, note, createdBy, createdAt |
| `denials` | Denial tracking | id, claimId, denialCategory, denialReasonText, payer, cptCode, rootCauseTag |
| `rules` | Scrubber rules | id, name, triggerPattern, preventionAction, payer, enabled |
| `prior_authorizations` | Auth tracking | id, encounterId, patientId, authNumber, status, expirationDate |
| `vob_verifications` | Insurance verification | id, leadId, payerId, status, copay, deductible, priorAuthRequired |
| `era_batches` | ERA file imports | id, payerId, checkDate, totalAmount, status |
| `era_lines` | ERA service lines | id, eraBatchId, claimId, hcpcsCode, billedAmount, allowedAmount, adjustmentCode, status |
| `leads` | Intake pipeline | id, name, phone, email, status, vobStatus, vobScore, insuranceCarrier |
| `calls` | Vapi call logs | id, leadId, transcript, summary, disposition, extractedData |
| `email_templates` | Communication templates | id, name, subject, body, category, variables |
| `nurture_sequences` | Automated email flows | id, name, triggerEvent, steps (JSON), enabled |
| `email_logs` | Email history | id, leadId, templateId, subject, status, sentAt, openedAt |
| `appointments` | Booked appointments | id, leadId, title, scheduledAt, duration, status |
| `availability_slots` | Bookable slots | id, dayOfWeek, startTime, endTime, timezone, enabled |
| `chat_sessions` | Web chat sessions | id, visitorToken, status, currentStepId, collectedData, qualificationScore |
| `chat_messages` | Chat message log | id, sessionId, type, content, stepId |
| `chat_analytics` | Chat metrics | id, date, totalSessions, completedSessions, leadsGenerated, conversionRate |
| `activity_logs` | Audit trail | id, leadId, claimId, activityType, field, oldValue, newValue, performedBy |

### Reference Tables (Global, no org_id)

| Table | Purpose |
|---|---|
| `hcpcs_codes` | HCPCS procedure code definitions |
| `hcpcs_rates` | Payer-specific rates per HCPCS code |
| `icd10_codes` | ICD-10 diagnosis codes (full-text GIN index) |
| `cpt_codes` | CPT procedure codes |
| `va_location_rates` | CY26 VA Fee Schedule — 2,160 rows by location + HCPCS |
| `denial_patterns` | Real-world denial patterns from processed 835 ERAs |

---

## 7. External Integrations

### Office Ally (Clearinghouse)
- **Phase 1 (Live):** EDI generator at `server/services/edi-generator.ts` creates HIPAA 5010 837P files on demand. Download from claim detail.
- **Phase 2 (Implemented, needs SFTP creds):** `server/services/office-ally.ts` submits via SFTP and retrieves 277/835 responses. Requires `OA_SFTP_HOST`, `OA_SFTP_USERNAME`, `OA_SFTP_PASSWORD` environment variables.
- **Phase 3 (Parser ready):** `server/services/edi-parser.ts` handles 277 acknowledgments and 835 remittances. Writes results to `denial_patterns` table.

### Vapi (AI Voice)
- Outbound and inbound AI voice calls for lead intake.
- Transcripts and extracted data stored in `calls` table.
- Secrets: `VAPI_API_KEY`, `VAPI_PUBLIC_KEY`

### VerifyTX (Insurance Eligibility)
- Real-time eligibility (RTE) checks triggered from lead detail page.
- Results stored in `vob_verifications` table and contribute to VOB score.
- Secrets: `VERIFYTX_CLIENT_ID`, `VERIFYTX_CLIENT_SECRET`, `VERIFYTX_USERNAME`, `VERIFYTX_PASSWORD`

### Gmail (Email)
- Template-based emails sent via Gmail SMTP with Nodemailer.
- Secrets: `GMAIL_USER`, `GMAIL_APP_PASSWORD`

### Twilio (SMS)
- SMS outreach capability wired in.
- Secrets: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_PHONE_NUMBER`

---

## 8. Multi-Tenancy

Every user belongs to exactly one organization (via `users.organizationId`). All queries for org-scoped tables apply a `WHERE organization_id = $orgId` filter. The `getOrgId(req)` helper extracts the org from the session on every request.

Reference tables (payers, hcpcs_codes, icd10_codes, cpt_codes, va_location_rates) are global and never filtered by org.

**Demo Org:** ID `demo-org-001`. Pre-seeded with 4 VA claims, 3 ERA batches, 1 patient (Megan Perez — VA651254344), the VA CC payer, 22 scrubber rules, and practice settings.

New orgs created via user management start empty and populate through normal use.

---

## 9. API Reference (Complete)

### Auth
| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/api/auth/login` | Public | Login |
| POST | `/api/auth/logout` | Any | Logout |
| GET | `/api/auth/me` | Any | Current user |

### Lookup / Reference
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/npi-lookup` | Any auth | NPI registry search |
| GET | `/api/taxonomy-codes` | Any auth | Provider taxonomy list |
| GET | `/api/carc-codes` | Any auth | CARC code list |
| GET | `/api/rarc-codes` | Any auth | RARC code list |
| GET | `/api/payers` | Any auth | Payer list |
| PATCH | `/api/payers/:id` | rcm_manager/admin | Update payer settings |

### Billing — Dashboard & Settings
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/billing/dashboard/stats` | rcm_manager/admin | Financial KPIs |
| GET | `/api/billing/onboarding-checklist` | rcm_manager/admin | Step completion status |
| POST | `/api/billing/onboarding-checklist/dismiss` | rcm_manager/admin | Dismiss checklist |
| GET | `/api/billing/practice-settings` | rcm_manager/admin | Get org settings |
| PUT | `/api/billing/practice-settings` | rcm_manager/admin | Save org settings |
| POST | `/api/billing/test-oa-connection` | rcm_manager/admin | Validate OA SFTP creds |
| GET | `/api/billing/providers` | rcm_manager/admin | List providers |
| POST | `/api/billing/providers` | rcm_manager/admin | Add provider |
| PATCH | `/api/billing/providers/:id` | rcm_manager/admin | Update provider |

### Billing — Claims
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/billing/claims` | rcm_manager/admin | List claims |
| POST | `/api/billing/claims` | rcm_manager/admin | Create claim |
| GET | `/api/billing/claims/wizard-data` | rcm_manager/admin | Aggregated wizard data |
| GET | `/api/billing/claims/:id` | rcm_manager/admin | Get claim detail |
| PATCH | `/api/billing/claims/:id` | rcm_manager/admin | Update claim |
| POST | `/api/billing/claims/:id/submit` | rcm_manager/admin | Submit to Office Ally |
| POST | `/api/billing/claims/:id/mark-fixed` | rcm_manager/admin | Mark denial resolved |
| GET | `/api/billing/claims/:id/edi` | rcm_manager/admin | Download 837P EDI |
| GET | `/api/billing/claims/:id/letter-data` | rcm_manager/admin | Data for PDF letters |
| GET | `/api/billing/claims/:id/denial-recovery` | rcm_manager/admin | CARC root cause + action |
| GET | `/api/billing/claim-tracker` | rcm_manager/admin | Pipeline view |
| GET | `/api/billing/follow-up` | rcm_manager/admin | AR work queue |
| POST | `/api/billing/claims/:id/follow-up-note` | rcm_manager/admin | Add follow-up note |

### Billing — ERA
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/billing/eras` | rcm_manager/admin | List ERA batches |
| POST | `/api/billing/eras` | rcm_manager/admin | Import ERA batch |
| PATCH | `/api/billing/eras/:id` | rcm_manager/admin | Post/auto-post ERA lines |

### Billing — Patients
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/billing/patients` | rcm_manager/admin | List patients |
| POST | `/api/billing/patients` | rcm_manager/admin | Create patient |
| GET | `/api/billing/patients/:id` | rcm_manager/admin | Patient detail |
| PATCH | `/api/billing/patients/:id` | rcm_manager/admin | Update patient |

### Billing — Intelligence & Rules
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/billing/denial-patterns` | rcm_manager/admin | Denial trend data |
| GET | `/api/billing/rules` | rcm_manager/admin | Scrubber rules |
| PATCH | `/api/billing/rules/:id` | rcm_manager/admin | Toggle/update rule |
| GET | `/api/billing/activity-logs` | admin | Audit log |
| GET | `/api/billing/compliance-report/:type` | admin | Compliance reports |
| GET | `/api/billing/prior-auths` | rcm_manager/admin | Prior auth list |

### Billing — Codes
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/billing/hcpcs` | rcm_manager/admin | HCPCS code search |
| GET | `/api/billing/cpt` | rcm_manager/admin | CPT code search |
| GET | `/api/billing/icd10` | rcm_manager/admin | ICD-10 code search |
| GET | `/api/billing/va-rate` | rcm_manager/admin | VA fee schedule lookup |
| GET | `/api/billing/va-locations` | rcm_manager/admin | VA location list |

### Intake — Leads & Deals
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/leads` | intake/admin | List leads |
| POST | `/api/leads` | intake/admin | Create lead |
| GET | `/api/leads/:id` | intake/admin | Lead detail |
| PATCH | `/api/leads/:id` | intake/admin | Update lead |
| POST | `/api/leads/:id/verify-insurance` | intake/admin | Run RTE check |
| GET | `/api/leads/:id/vob-verifications` | intake/admin | VOB history |
| GET | `/api/vob-verifications/:id/pdf` | intake/admin | VOB PDF download |
| POST | `/api/leads/:id/email` | intake/admin | Send template email |
| GET | `/api/intake/dashboard/stats` | intake/admin | Intake KPIs |

### Intake — Scheduling
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/availability` | intake/admin | Get availability slots |
| POST | `/api/availability` | intake/admin | Add slot |
| PATCH | `/api/availability/:id` | intake/admin | Update slot |
| GET | `/api/appointments` | intake/admin | List appointments |
| POST | `/api/appointments` | intake/admin | Book appointment |

### Intake — Chat (Public)
| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/api/chat-sessions/init` | Public | Start chat session |
| POST | `/api/chat/message` | Public | Send message |
| GET | `/api/chat-analytics/stats` | intake/admin | Chat metrics |

### Email Templates & Nurture
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/email-templates` | Any auth | List templates |
| POST | `/api/email-templates` | Any auth | Create template |
| PATCH | `/api/email-templates/:id` | Any auth | Update template |
| GET | `/api/nurture-sequences` | Any auth | List sequences |

### Admin — Users
| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/api/admin/users` | admin | List all users |
| POST | `/api/admin/users` | admin | Create user |
| PATCH | `/api/admin/users/:id` | admin | Update user/role |
| DELETE | `/api/admin/users/:id` | admin | Remove user |

---

## 10. Test Credentials & Demo Data

### Login Credentials
| Email | Password | Role |
|---|---|---|
| `demo@claimshield.ai` | `demo123` | admin |
| `billing@claimshield.ai` | `demo123` | rcm_manager |

### Demo Data (Org: `demo-org-001`)
| Entity | ID / Value |
|---|---|
| Patient | Megan Perez — VA651254344 |
| Claims | demo-claim-va-001 through demo-claim-va-004 |
| ERA Batches | demo-era-001 through demo-era-003 |
| Payer | VA Community Care (pre-configured with ERA auto-post rules) |
| Practice | Demo Practice, NPI 1234567890 |
| Provider | Sample rendering provider (active) |

### Claim Statuses in Demo
| Claim | Status | Notes |
|---|---|---|
| demo-claim-va-001 | submitted | Clean claim, no denial |
| demo-claim-va-002 | denied | CO-96 denial — triggers Denial Recovery Agent panel |
| demo-claim-va-003 | paid | ERA posted |
| demo-claim-va-004 | draft | Ready to submit |
