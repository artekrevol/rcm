# Claim Shield Health — Platform Scope & User Flows

**Version:** 2.0  
**Date:** April 2026  
**Platform URL:** www.claimshield.health

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [Authentication & User Roles](#2-authentication--user-roles)
3. [Module Selector](#3-module-selector)
4. [Intake Module](#4-intake-module)
5. [Billing Module](#5-billing-module)
6. [Cross-Module Handoff: Lead-to-Patient Conversion](#6-cross-module-handoff-lead-to-patient-conversion)
7. [Data & Compliance](#7-data--compliance)

---

## 1. Platform Overview

Claim Shield Health is a healthcare revenue cycle management (RCM) platform designed for home health, skilled nursing, and community-based care providers. The platform is split into two purpose-built modules:

- **Intake Module** — Captures, qualifies, and nurtures prospective patients from first contact through insurance verification, using AI-powered voice, SMS, email, and guided chat.
- **Billing Module** — Manages the full claim lifecycle from patient demographics and service documentation through claim submission, denial tracking, and compliance reporting.

Both modules share a common database, a unified authentication system, and a seamless handoff process that converts qualified leads into billable patients.

---

## 2. Authentication & User Roles

### Login

Users authenticate with an email and password at `/auth/login`. Sessions are stored server-side in PostgreSQL with encrypted cookies. Passwords are hashed using bcrypt.

### Roles

| Role | Access | Description |
|------|--------|-------------|
| **Admin** | Both Modules | Full access to Intake, Billing, User Management, Activity Logs, and Compliance Reports. |
| **RCM Manager** | Billing Only | Full access to all Billing features (patients, claims, codes, rules, reports, settings). No access to Activity Log or Compliance Reports. |
| **Intake** | Intake Only | Full access to lead management, AI outreach, chat analytics, and scheduling. |

### Security Features

- Session-based authentication with HTTP-only, secure cookies
- bcrypt password hashing with automatic legacy password rehashing
- Role-based middleware on every API endpoint
- Frontend route guards that redirect unauthorized users
- Production-enforced session secret

---

## 3. Module Selector

When a user logs in:

- **Single-role users** (Intake or RCM Manager) are automatically redirected to their module dashboard.
- **Admin users** see a Module Selector page with two cards — one for Intake, one for Billing — and can switch between modules at any time via a sidebar link.

---

## 4. Intake Module

### 4.1 Intake Dashboard (`/intake/dashboard`)

The central command center for intake operations.

- **Lead Pipeline Summary** — Five status cards showing lead counts for each stage: New, Attempting Contact, Contacted, Qualified, and Converted. Each card includes an SLA breach badge when leads exceed response time thresholds.
- **Today's Appointments** — List of scheduled admissions consultations and facility tours for the current day.
- **Recent Chat Sessions** — Latest guided chat conversations with completion status.
- **Add New Lead** — Quick-action button to manually create a lead.

### 4.2 Lead Worklist (`/intake/deals`)

The primary workspace for intake staff to manage their lead pipeline.

**Two Views:**
- **Worklist View** — A high-density table with sortable columns (Name, Status, Source, Insurance, VOB Score, Last Contact). Includes smart queue filters:
  - SLA Breach — Leads that have exceeded contact time limits
  - Not Contacted — Leads with no outreach attempts
  - Incomplete VOB — Leads missing insurance verification fields
  - Ready for Claim — Leads with 100% VOB that are ready for billing conversion
- **Board View** — A Kanban-style drag-and-drop interface for moving leads through pipeline stages.

**Quick Actions from the list:**
- Initiate AI voice call
- Send SMS message
- Send email
- Update lead status

### 4.3 Lead Detail Page (`/intake/deals/:id`)

A comprehensive 360-degree view of a single lead.

**Lead Information Panel:**
- Contact details (name, phone, email, address, state)
- Insurance information (carrier, member ID, plan type)
- Service interest and preferred care type
- Lead source tracking (website chat, referral, inbound call, etc.)
- VOB completeness score (0–100%)

**VOB Verification Card:**
- Visual progress indicator showing which fields are complete
- Missing field checklist (Insurance Carrier, Member ID, Service Needed, Plan Type)
- Risk classification (Low / Medium / High) based on data completeness
- Manual or automated verification trigger

**Activity Timeline:**
- Chronological log of all interactions with the lead:
  - AI voice calls with full transcripts and AI-generated summaries
  - SMS messages sent and received
  - Emails sent with open/click tracking
  - Status changes and notes
  - Chat sessions

**Outreach Tools (available directly on the detail page):**
- **AI Voice Call** — Initiates a Vapi-powered AI voice call. The AI assistant introduces itself, gathers insurance and care needs, and extracts structured data from the conversation. Call transcripts and extracted data are saved automatically.
- **SMS** — Send templated or custom text messages via Twilio.
- **Email** — Send templated or custom emails via Gmail SMTP. Templates include Welcome, Insurance Request, Document Request, and Appointment Reminder.
- **Nurture Sequences** — Automated multi-step follow-up campaigns for non-responsive leads.

**Auto-Fill from Calls:**
When an AI voice call extracts insurance or demographic data, the lead record is automatically updated with the extracted information — no manual data entry required.

**Conversion Actions:**
- **Convert to Patient** — One-click conversion that creates a patient record in the Billing module (see Section 6).
- **Create Claim (Pre-Filled)** — Available once VOB is 100% complete; generates a draft claim in Billing with all lead data pre-populated.

### 4.4 Guided Chat Widget

A web-embeddable chat widget that captures leads through guided conversation flows. Available on all Intake module pages.

**Chat Flows:**
- **Admissions** — Collects name, phone, email, insurance provider, and care needs
- **Pricing** — Gathers insurance details for cost estimation
- **Insurance Verification (VOB)** — Captures carrier, member ID, DOB, and plan type
- **General Questions** — Free-form conversation with data capture

**Key Features:**
- Branching logic adapts the conversation based on user responses
- Returning visitor recognition with personalized greetings ("Welcome back, [Name]!")
- Automatic lead creation with source tagged as "Website chat"
- Session persistence so users can resume interrupted conversations
- Real-time data extraction to populate lead records

### 4.5 Chat Analytics (`/intake/lead-analytics`)

Performance metrics for the guided chat widget.

- **Conversion Funnel** — Visualizes chat outcomes: Started → Completed → Lead Created
- **Drop-off Analysis** — Identifies which step in the chat flow users abandon
- **Session Metrics** — Total sessions, completion rate, average duration
- **Lead Generation Stats** — Correlates chat sessions with successful lead conversions and appointment bookings
- **Conversations Table** — Searchable list of all chat sessions with timestamps, status, and extracted data

### 4.6 Scheduling (`/intake/scheduling`)

Appointment management for admissions consultations and facility tours.

- Calendar view of upcoming appointments
- Availability slot management
- Appointment creation linked to leads

---

## 5. Billing Module

### 5.1 Billing Dashboard (`/billing/dashboard`)

The financial command center for the billing team.

**Claims Pipeline Cards:**
- **Paid** — Count and total dollar amount of paid claims
- **In Process** — Claims that are submitted, acknowledged, or pending
- **Drafts** — Claims saved but not yet submitted
- **Denied** — Claims that were denied or suspended

**Alert Cards (clickable, navigate to filtered claim views):**
- **Denied Claims** — Count of denied claims requiring attention
- **Stale Drafts** — Draft claims older than 7 days that need action
- **Timely Filing Risk** — Claims approaching payer filing deadlines (calculated per payer's filing limit)
- **High Risk Claims** — Claims flagged as RED risk that are still in process

**Recent Patients:**
- Horizontal scrollable row of the 8 most recently active patients (by latest claim activity)
- Each card shows patient name, last service date, insurance carrier, and a "New Claim" button

**Recent Claims Table:**
- The 10 most recent claims with Claim ID, Patient Name, Payer, Amount, Status, and Created Date
- Clickable rows navigate to the claim detail page

**Persistent "New Claim" Button:**
- Always visible in the billing header bar across all billing pages
- Navigates directly to the Claim Creation Wizard

### 5.2 Patient Management

#### Patient List (`/billing/patients`)
- Searchable table of all patients
- Search by name, date of birth, insurance carrier, or member ID
- Each row shows patient name, DOB, insurance carrier, member ID, and last claim status
- Patients converted from Intake are marked with a badge

#### Create Patient (`/billing/patients/new`)
- Comprehensive patient creation form with 15+ fields
- **Demographics:** First name, last name, preferred name, DOB, sex, phone, email, state
- **Insurance:** Carrier (searchable dropdown from master payer list), member ID, group number, insured name, relationship to insured
- **Referral:** Source dropdown (Clinical sources: VA Community Care, Physician office, Hospital discharge, SNF transition, Hospice transition; Marketing sources: Google, Facebook, Word of mouth, Website chat, etc.), referring provider name and NPI (validated)
- **Clinical:** Service needed, default provider assignment, authorization number
- NPI validation using the Luhn algorithm

#### Patient Detail (`/billing/patients/:id`)

Four tabs providing a complete patient record:

- **Profile Tab** — Editable demographics, insurance, and referral information. Pre-fills from linked lead data when available. Save changes with validation.
- **Claims Tab** — Complete claim history for this patient. "New Claim" button pre-selects this patient in the wizard.
- **Eligibility Tab** — List of VOB (Verification of Benefits) checks with coverage details (copay, deductible, authorization requirements, coverage percentages).
- **Notes Tab** — Internal notes with author tracking and timestamps. Notes are append-only for audit integrity.

### 5.3 Claim Creation Wizard (`/billing/claims/new`)

A guided 3-step wizard for creating CMS-1500-compliant claims.

#### Step 1: Select Patient
- Search for existing patients by name
- Select a patient to link to the claim
- A draft claim is automatically created upon patient selection
- Option to navigate to Create Patient if the patient doesn't exist

#### Step 2: Service Lines & Diagnosis
- **Service Lines** — Add one or more service lines, each with:
  - HCPCS/CPT code (searchable with inline code lookup)
  - Code description (auto-populated from the code database)
  - Modifier field (with warnings when commonly required)
  - Unit type (per-visit or time-based)
  - For time-based codes: Hours input with automatic unit calculation (e.g., 2.5 hours at 15-min intervals = 10 units)
  - Rate per unit (auto-populated from VA fee schedule based on practice location)
  - Total charge (units x rate, with manual override option)
  - **VA Location-Based Rates:** When the payer is VA Community Care, rates are automatically fetched based on the practice's configured billing location. If no location is configured, the national average rate is used with a warning banner.

- **ICD-10 Diagnosis Codes:**
  - Primary diagnosis search with 97,584 ICD-10-CM 2025 codes
  - Secondary diagnosis field
  - Common diagnosis quick-pick list for frequent codes

- **Additional Fields:**
  - Place of Service (Home, Office, Assisted Living, Telehealth, etc.)
  - Provider selection from practice roster
  - Payer selection
  - Authorization number
  - Service date

- **Auto-Save:** Progress is automatically saved as a draft when advancing between steps.

#### Step 3: Review & Submit
- Complete claim summary with all service lines, diagnosis codes, and calculated totals
- **Risk Scoring Panel:**
  - Automated risk assessment (GREEN / YELLOW / RED)
  - Validation errors and warnings with descriptions
  - Acknowledgment checkbox for warnings before submission
- **Actions:**
  - Save as Draft
  - Generate PDF (creates a downloadable Claim Summary PDF)
  - Submit to Availity (modal with submission confirmation)

### 5.4 Claim Detail (`/billing/claims/:id`)

Comprehensive view of a single claim after creation.

- **Claim Header:** Patient name, payer, amount, status badge, risk score
- **Risk Analysis Panel:** Risk score breakdown with an "Explainability Drawer" explaining why the claim was flagged
- **Event Timeline:** Chronological audit trail of all claim status changes (Created → Submitted → Acknowledged → Paid/Denied)
- **Service Lines:** Detailed breakdown of all billed services
- **PDF Generation:** Download a readable Claim Summary PDF or a populated CMS-1500 form
- **Status Actions:** Update claim status, add notes, link prior authorizations

### 5.5 Prior Authorization Tracking (`/billing/claims/prior-auth`)

Centralized view of all prior authorization requests across all patients and claims.

- Table with columns: Patient, Payer, Auth Number, Status, Requested Date, Expiration Date
- Status badges (Pending, Approved, Denied, Expired)
- Expiration tracking with visual warnings for approaching deadlines
- Links to associated claims and patients

### 5.6 Code Lookup (`/billing/codes`)

Searchable reference library for medical coding.

- **HCPCS Level II Codes** — 8,259 codes with official and plain-English descriptions
- **CPT/RVU Codes** — 16,645 codes with CMS 2025 work RVU values
- **ICD-10-CM Codes** — 97,584 diagnosis codes (used in claim wizard search)
- **VA Rates** — 2026 VA Community Care rates by location
- Expandable detail panels showing official descriptions, unit types, and applicable rates

### 5.7 Intelligence & Denial Prevention

#### Denial Pattern Intelligence (`/billing/intelligence`)
- AI-detected clusters of denied claims grouped by root cause (e.g., "Missing authorization," "Incorrect modifier," "Timely filing exceeded")
- Pattern visualization showing frequency and financial impact
- **"Generate Prevention Rule"** button — automatically creates a prevention rule from a detected pattern

#### Prevention Rules (`/billing/rules`)
- Library of proactive rules that flag or block claims before submission
- Each rule has: Trigger pattern, condition, action (warn or block), and active/inactive toggle
- Example rules: "Auth Required for Inpatient," "Modifier check for timed codes," "Duplicate claim detection"

### 5.8 Activity Log (`/billing/intelligence/logs`) — Admin Only

Audit trail for all billing actions.

- **Filterable table** with columns: Timestamp, User, Action, Record Link, Detail
- **Filters:**
  - Date range (start/end)
  - Activity type (Created, Updated, Exported, PDF Export, Status Change, View Patient, View Claim)
  - Performed by (search by email)
- Clickable links to associated claims and patients
- Empty state message when no activity exists for the selected filters

### 5.9 Compliance Reports (`/billing/intelligence/reports`) — Admin Only

HIPAA and audit compliance reporting with client-side PDF generation.

**Four Report Types:**

1. **Access Report** — Log of all patient and claim record access during the reporting period (who viewed what, when)
2. **Edit History Report** — Record of all field-level edits to billing data (old value → new value, who changed it)
3. **Export Report** — All claim exports and PDF generations (who downloaded what claim data)
4. **Claims Integrity Report** — All claims created during the period with status, risk score, amount, and submission method

Each report has:
- Configurable date range (From / To date pickers)
- "Generate PDF" button that fetches data and creates a downloadable PDF
- Up to 500 records per report with overflow notation

### 5.10 Reports (`/billing/reports`)

Standard billing reports and analytics dashboards.

### 5.11 Settings (`/billing/settings`)

Practice configuration organized into tabs:

#### Providers Tab
- Add, edit, and remove providers
- Fields: First Name, Last Name, Credentials (RN, LPN, PT, OT, SLP, HHA, PCA, Other), NPI (validated), Taxonomy Code
- Set a default provider (starred) for new claims
- Active/inactive toggle

#### Practice Info Tab
- **Practice Details:** Practice name, primary NPI (validated), Tax ID, Taxonomy Code, Phone
- **Default Place of Service:** Dropdown (Home, Office, Assisted Living, Telehealth, etc.)
- **VA Fee Schedule Location:** Searchable dropdown of all VA billing locations (e.g., "Albany, NY," "Chicago, IL"). This setting determines which VA reimbursement rate is used when creating claims for VA patients.
- **Rate Staleness Warning:** If VA rates are older than 90 days, a warning banner appears advising the user to update from CMS.gov.
- **Address:** Street, City, State, ZIP

#### Payers Tab
- Manage insurance carriers (add, edit, delete)
- Fields: Name, Payer ID, Timely Filing Days, Active/Inactive toggle
- 13 default payers pre-loaded (VA Community Care, Medicare, Medicaid, TRICARE, BCBS, Aetna, UHC, Cigna, Humana, etc.)

#### Rate Tables Tab
- View and manage payer-specific reimbursement rates by HCPCS code
- 90-day staleness warnings for outdated rates

### 5.12 User Management (`/billing/settings/users`) — Admin Only

- View all system users (name, email, role, created date)
- Create new users with email, name, role assignment, and password
- Edit existing users (name, role, password reset)
- Delete users (cannot delete your own account)
- Role assignment: Admin, RCM Manager, or Intake

---

## 6. Cross-Module Handoff: Lead-to-Patient Conversion

The platform's key differentiator is the seamless handoff between Intake and Billing.

### Flow

```
INTAKE MODULE                              BILLING MODULE
─────────────                              ──────────────
1. Lead captured                    
   (chat, call, manual)            
         │                          
2. Lead qualified                   
   (VOB verified, data complete)    
         │                          
3. "Convert to Patient" clicked     
         │                          
         ├──────────────────────────► 4. Patient record created
         │                               (demographics, insurance,
         │                                referral source from lead)
         │                          
5. Lead status → "Sent"                  
   Handoff status updated                 
         │                          
6. "Create Claim (Pre-Filled)"     ────► 7. Draft claim created
   (available at 100% VOB)               (patient, payer, service
                                           pre-populated from lead)
```

### Data Mapping (Lead → Patient)

| Lead Field | Patient Field |
|-----------|--------------|
| Name | First Name + Last Name (parsed) |
| Email | Email |
| Phone | Phone |
| Insurance Carrier | Insurance Carrier |
| Member ID | Member ID |
| Plan Type | Plan Type |
| State | State |
| Service Needed | Service Needed |
| Source | Referral Source |

### Handoff Statuses

| Status | Meaning |
|--------|---------|
| `not_sent` | Lead has not been converted |
| `sent` | Patient record created in Billing |
| `accepted` | Billing team has acknowledged the patient |

---

## 7. Data & Compliance

### Medical Code Databases

| Dataset | Record Count | Source |
|---------|-------------|--------|
| HCPCS Level II | 8,259 codes | CMS 2025 |
| ICD-10-CM | 97,584 codes | CMS 2025 |
| CPT/RVU | 16,645 codes | CMS 2025 |
| VA Location Rates | 2,160 rates | VA Community Care 2026 |

### Audit & Compliance Features

- **Activity logging** on all claim and patient interactions
- **Compliance PDF reports** for HIPAA audit readiness (Access, Edit History, Export, Claims Integrity)
- **Role-based access control** restricting sensitive reports and user management to administrators
- **Session security** with encrypted cookies, bcrypt password hashing, and production-enforced secrets
- **Append-only notes** on patient records for audit trail integrity

### External Integrations

| Service | Purpose |
|---------|---------|
| Vapi AI | AI-powered voice calls with transcription and data extraction |
| Twilio | SMS messaging for lead outreach |
| Gmail SMTP | Email communication and nurture sequences |
| PostgreSQL | Primary data store with session persistence |
