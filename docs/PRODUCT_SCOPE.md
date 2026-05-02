# ClaimShield Health — Full Product Scope

> **Document purpose.** This is the canonical, end-to-end scope of ClaimShield Health: every module, use case, persona, scenario, integration, automation, data structure, and the strategic implementation roadmap behind it. It is written to be readable by an executive, a product manager, and a new engineer in equal measure. The numbers reference the live codebase as of May 2026: ~14,000 lines of routing logic, 31 first-class database tables (plus ~25 supporting `org_*` and reference tables), 261 API endpoints, 39 frontend pages, 4 cron jobs, and 3 product modules running on a single multi-tenant deployment.

---

## 1. Executive Summary

ClaimShield Health is a **multi-tenant Revenue Cycle Management (RCM) platform** that combines three traditionally separate categories of healthcare software into one product:

1. **Patient Intake & Lead Conversion** — capturing prospective patients, verifying their insurance, qualifying them, and converting them to active patients via AI-driven outbound calls, SMS, and email automation.
2. **Billing & Claims Lifecycle Management** — generating, validating, submitting, tracking, and recovering payment for medical claims, with first-party EDI generation/parsing rather than third-party clearinghouse middleware.
3. **Compliance & Intelligence Admin** — payer policy ingestion, scraping, rule extraction by Claude AI, NCCI edits ingestion, denial pattern analytics, and a rules engine that scores every claim before it leaves the building.

The product is built for the long tail of US healthcare providers that are currently glued together with spreadsheets, faxes, and manual phone calls — initially **home health agencies, behavioral health practices, and VA Community Care providers**, with architecture explicitly designed to extend into adjacent specialties.

**Core differentiator.** Unlike clearinghouse-thin platforms (Office Ally, Availity, Waystar) which submit whatever EDI the user produces, ClaimShield owns the EDI generation, the policy intelligence, and the patient capture. A claim that goes through ClaimShield is pre-flighted against payer-specific rules extracted from the payer's own published manuals, scored for risk, and only released when the readiness gate is green. Denials are then mapped back to the rule that was missed, which closes the loop on payer intelligence.

---

## 2. Product Vision & Target Markets

### 2.1 Vision

To be the **operating system for small-to-mid healthcare practices** that need both intake automation and billing automation under one roof, with payer intelligence as a built-in moat rather than a separate paid add-on.

### 2.2 Why now

- CMS NCCI edits, payer manuals, and EDI 5010 rules change quarterly. No small practice can keep up manually.
- Outbound calling is being radically reshaped by AI voice agents (Vapi, Retell, etc.). The intake side of an RCM is suddenly automatable.
- Stedi and modern API-first clearinghouses (replacing legacy SFTP gateways) make first-party 837/270/277/835 ownership feasible without becoming a clearinghouse.
- Multi-tenant SaaS is now the default expectation, even for clinical software.

### 2.3 Initial verticals

| Vertical | Why it's a fit | Anchor customer |
|---|---|---|
| **Home Health Agencies** | High claim volume, low per-claim margin, recurring statement-period billing, complex VA Community Care rules. | Caritas Senior Care, Chajinel Home Care |
| **Behavioral Health** | Authorizations are king, denials concentrated on a small set of rules, telehealth modifier complexity. | (planned) |
| **VA Community Care providers** | A single dominant payer (TriWest/PGBA) with a thick companion guide that rewards investment in payer-specific rules. | Caritas, Chajinel |
| **Specialty practices (PT/OT/SLP)** | Authorization-heavy, predictable code sets, ideal for rules-engine-led automation. | (planned) |

### 2.4 Out of scope (explicitly)

- Hospital inpatient billing (837I beyond simple cases)
- Pharmacy benefits / NCPDP transactions
- DME order management beyond claim filing
- Medical scheduling beyond intake appointment booking

---

## 3. Personas & Roles

The platform supports five primary user roles, enforced by role-based middleware on every API route and reflected in module-level navigation.

| Role | Module access | Typical workflows |
|---|---|---|
| **super_admin** | All modules across all orgs | Onboard new clinics, configure org_*, view cross-tenant analytics, debug failed claims, run scrapers, manage rules database. |
| **billing_admin** (Practice owner) | Billing + Intake (own org) | Approve claims, manage denials, run AR-aging reports, invite team members, configure payers and providers. |
| **biller** (RCM staff) | Billing (own org) | File claims, work the follow-up queue, post ERAs, respond to 277CA acks, write appeal letters. |
| **intake_coordinator** | Intake (own org) | Triage incoming leads, manage flow runs, monitor Vapi calls, schedule appointments, convert leads to patients. |
| **clinician / provider** | Read-only across own patients | View claim status, sign attestations, respond to questions on rejected claims. |

Each user record carries an `organization_id`. Tenant isolation is enforced at the route layer via `requireOrgCtx()`, which 400's any list endpoint that is hit without an org context. Super-admins can impersonate orgs to support customers without losing tenant boundaries.

---

## 4. Module 1 — Intake (Lead-to-Patient)

### 4.1 What it does

Intake is the **funnel layer**. It captures inquiries from any channel (web form, phone, referral source, paid ads, partner integrations), runs them through a **configurable per-org flow**, and either converts the lead to a `patient` record (handing them off to Billing) or marks them lost with a reason.

### 4.2 Flow engine (the core innovation here)

The flow engine is a **per-org, DAG-style sequence of steps** stored in the `flows` and `flow_steps` tables and executed by `flow-step-executor.ts`. Critically, the executor is **completely org-agnostic** — there is zero hardcoded org data in the executor; everything is loaded from `org_*` tables via a 60-second TTL cache.

**Eight step types are supported:**

| Step type | Purpose | Config |
|---|---|---|
| `wait` | Pause for N minutes/hours/days before next step | `delay_minutes` |
| `sms_message` | Send SMS via Twilio | `template_key` → `org_message_templates` |
| `email_message` | Send email via Nodemailer/Gmail | `template_key` → `org_message_templates` |
| `voice_call` | Place outbound Vapi call with org-specific persona | `persona_key` → `org_voice_personas` |
| `vob_check` | Run Verification of Benefits via Stedi 270/271 | (auto) |
| `provider_match` | Match lead to credentialed provider by service + language | (auto, uses `org_providers`) |
| `appointment_schedule` | Notify staff to schedule appointment | (notifies admins via SMS+email) |
| `webhook` | Fire arbitrary outbound webhook | `url`, `method`, `headers` |

**Per-step conditional execution.** Every step has a `condition` JSONB column that supports `eq`, `neq`, `in`, `not_in`, `exists`, `not_exists`, `gt`, `gte`, `lt`, `lte`, `contains`. Example: only run `voice_call` if `lead.preferred_language == "en"` and `lead.dob` exists.

**Failure handling.** Permanent failures write `failed_at` + `failure_reason` to the `flow_runs` row. Transient failures retry with exponential backoff (5 min → 15 min → halt). The orchestrator runs every 30 seconds and sweeps overdue steps.

### 4.3 Use cases & scenarios

#### Scenario 4.3.1 — VA Community Care home health lead (Caritas)
1. **Lead arrives** via web form: name, phone, language, "needs home health aide".
2. **Step 1 (immediate):** SMS confirmation in lead's preferred language.
3. **Step 2 (1 min wait):** Vapi outbound call with persona = `caritas_intake_en` or `caritas_intake_es`. Call collects DOB, member ID, primary diagnosis, urgency, location.
4. **Step 3 (after call):** Transcript extracted by `transcript-extractor.ts` into structured fields (DOB, ID, etc.) on the lead record.
5. **Step 4 (auto):** VOB check via Stedi 270 → 271 stored in `vob_verifications`.
6. **Step 5 (conditional — VOB active):** `provider_match` finds a credentialed provider whose `service_types` includes `home_health` and whose `language` array includes the lead's preferred language.
7. **Step 6:** `appointment_schedule` notifies staff.
8. **Step 7:** Email confirmation with appointment details.
9. **Step 8 (manual):** Coordinator clicks "Convert to Patient" → lead becomes a `patient` record, which becomes available in the Billing module.

#### Scenario 4.3.2 — Bilingual Caritas (revised 11-step spec, pending)
Two parallel modes (Mode 1: aging in place, Mode 2: considering ALF), gated by ALF-consideration question, with Spanish-caregiver-preference branch and consultation scheduling preference.

#### Scenario 4.3.3 — Voicemail / no-answer recovery
If `voice_call` step returns `status="no-answer"`, conditional step fires another SMS at +30 min. Two more retries at +4 hr and +24 hr before lead is parked in "needs_manual_outreach" worklist.

#### Scenario 4.3.4 — Halt engagement
Lead replies "STOP" to any SMS → `POST /api/leads/:id/halt-engagement` is fired (manually or by inbound webhook), all pending flow runs are marked `halted`, no further automated outreach occurs.

### 4.4 Lead worklist & analytics

- **`/api/leads/worklist`** — coordinator's daily queue, filterable by stage and last-activity age.
- **`/api/lead-analytics`** — conversion funnel: leads → contacted → VOB-verified → matched → appointment → patient.
- **`/api/calls-analytics/stats`** — Vapi call outcomes, average duration, transcript completion rate.
- **`/api/chat-analytics/stats`** — for inbound web chat sessions.

### 4.5 Implementation status

| Phase | Status |
|---|---|
| A — Schema audit + extensions | ✅ Complete |
| B — Caritas org + flow + constants migration | ✅ Complete |
| C — Refactor step executor org-agnostic | ✅ Complete |
| D — Chajinel intake flow | ✅ Complete (pending Vapi assistant ID) |
| E — UI (org badge, dynamic dropdowns) | ✅ Complete |
| F — Acceptance testing | ✅ Complete (queries verified) |
| Bilingual revised Caritas spec | ⏳ Awaiting spec doc + 13 leads columns |

---

## 5. Module 2 — Billing & Claims

This is the heart of the platform — every claim's lifecycle from creation through payment, with 837P generation, Stedi/Office Ally submission, ERA posting, denial recovery, and follow-up automation all in-house.

### 5.1 Claim lifecycle (end-to-end)

```
DRAFT  →  PRE-FLIGHT  →  RISK SCORED  →  READINESS GATE  →  TEST SUBMIT  →  LIVE SUBMIT  →  277CA ACK  →  ERA/835 POSTED  →  PAID / DENIED
```

Every state transition writes to `claim_events` (audit trail) and `submission_attempts` (per-attempt EDI snapshot). Denials trigger entry into the `denials` table with CARC/RARC codes parsed from the 835.

### 5.2 The Claim Wizard (`claim-wizard.tsx`)

A 3-step UX: **Patient → Service → Review**.

- **Patient step:** select existing or create new; loads patient demographics, insurance, member ID, plan product. Conditional fields appear based on payer (e.g., VA-specific veteran ID type, EDIPI vs MVI ICN vs SSN).
- **Service step:** add service lines with HCPCS/CPT codes (autocomplete via `/api/billing/hcpcs/search`), modifiers, units, dates, ICD-10 diagnoses (autocomplete via `/api/billing/icd10/search`), place of service, billing period (statement dates for home health), authorization number.
- **Review step:** shows claim readiness GREEN/YELLOW/RED, risk score 0-100, all warnings (missing modifiers, telehealth GT/95, NCCI conflicts), and submission options (Test via Stedi T mode, Live via Stedi or Office Ally, Save as Draft, Download CMS-1500 PDF).

Real-time pre-flight as the user types: every change calls `/api/billing/claims/preflight` which re-runs the full rules engine against the in-memory claim and returns warnings, errors, risk factors, and CCI conflicts.

### 5.3 EDI generation (837P) — first-party

`server/services/edi-generator.ts` implements an internal, spec-compliant 837P generator with no third-party EDI library dependency.

**Key technical features:**
- Full ISA → GS → ST → BHT → loops 1000A/1000B/2000A/2010AA/2000B/2010BA/2010BB/2300/2310B/2400 → SE → GE → IEA envelope
- X12 5010 TR3 segment ordering enforced (e.g., DTP*434 must precede HI in Loop 2300 — this was a real bug discovered and fixed in production, May 2026)
- PGBA-specific compliance per PGBA 837P Companion Guide v1.0:
  - REF qualifier `G2` instead of `1C` for rendering and ordering provider secondary IDs
  - Region 5 (TriWest VA CCN) trading partner ID support
  - `validateForPGBA()` pre-flight that throws before generation if claim violates PGBA rules
  - 37-code rejection dictionary (`server/data/pgba_rejection_codes.json`) for human-readable error mapping
- Veteran ID resolution: explicit `veteran_id_type` (ssn/edipi/mvi_icn) → NM108 qualifier (SY/MI), with length-heuristic fallback
- Agency-worker support: omits Loop 2310B (rendering provider) entirely when provider has no NPI
- Claim frequency 7/8 (replacement/void) with REF*F8 original claim ICN handling
- Up to 12 ICD-10 codes per claim in one HI segment

### 5.4 Submission paths

| Path | When | Endpoint |
|---|---|---|
| **Stedi (test, ISA15=T)** | Always available — Stedi validates X12 compliance without payer forwarding. Free. | `POST /api/billing/claims/:id/test-stedi` |
| **Stedi (live, ISA15=P)** | After enrollment with payer; submits and tracks 999/277CA via webhook. | `POST /api/billing/claims/:id/submit-stedi` |
| **Office Ally (SFTP)** | Fallback for payers not on Stedi or for orgs with existing OA agreement. | `POST /api/billing/claims/:id/submit-oa` |

Stedi webhooks (`stedi-webhooks.ts`) handle async 277CA and 835 deliveries. The 835 ERA upload also supports manual file upload (`POST /api/billing/eras/upload`) for payers that mail/email ERAs.

### 5.5 EDI parsing

- **835 ERA parser** (`edi-parser.ts`) — extracts payer, patient, claim, service-line adjudication, CARC/RARC codes, payment amounts, adjustments. Auto-posts to claim records and creates `denials` rows for non-paid amounts.
- **277CA parser** — extracts acknowledgment status (accepted/rejected at clearinghouse, accepted/rejected at payer) and surfaces in the claim tracker UI.

### 5.6 Rules engine

`server/services/rules-engine.ts` evaluates every claim against:

1. **CMS NCCI PTP edits** (`cci_edits` table, ingested quarterly) — code-pair conflicts with modifier indicators (0=never, 1=allowed-with-modifier, 9=deleted).
2. **CMS Medically Unlikely Edits (MUEs)** — units-per-day caps.
3. **Payer manual extractions** (`manual_extraction_items`) — rules like "TriWest requires GT modifier on telehealth", "PGBA requires G2 qualifier on referring provider REF".
4. **Org-defined custom rules** (`rules`) — practice overrides and house policies.
5. **Plan-product-specific rules** (`payer_supported_plan_products`, `applies_to_plan_products`) — e.g., a rule applies only to "Medicare Advantage" not "Medicare FFS".
6. **Timely filing** — days-since-DOS vs payer's filing deadline.
7. **Authorization required** — checks `payer_auth_requirements` and `pcp_referrals`.

Output: `risk_score 0-100`, `readiness_status GREEN/YELLOW/RED`, an array of warnings/errors with the rule that triggered them, and a `rules_snapshot` of every rule evaluated (stored on the claim row for audit).

### 5.7 Denial recovery & appeals

- **`/api/billing/claims/:id/denial-recovery`** — analyzes the denial CARC/RARC and proposes a fix (e.g., CO-197 → "Auth missing — file appeal with auth number").
- **Appeal letter generator** — client-side PDF, pre-filled with patient demographics, claim ICN, denial codes, and a templated argument paragraph.
- **`/api/billing/follow-up`** — work queue of denials and pended claims with last-touched-date sorting.
- **Mark fixed** — `POST /api/billing/claims/:id/mark-fixed` re-evaluates and re-files.

### 5.8 Other billing surfaces

| Page | Purpose |
|---|---|
| `dashboard.tsx` | KPIs: claims this month, $ submitted, $ paid, $ in AR, denial rate, clean-claim rate. |
| `claim-tracker.tsx` | Real-time status of every in-flight claim with 277CA/835 timestamps. |
| `era.tsx` | ERA inbox: list, view detail, upload manual ERAs. |
| `filing-alerts.tsx` | Timely-filing risk alerts (ack/snooze actions). |
| `follow-up.tsx` | Denial work queue with notes. |
| `prior-auth.tsx` | Prior authorization tracker. |
| `reports.tsx` | AR aging, collections, denial analysis, clean-claim rate. |
| `compliance-reports.tsx` | Per-payer compliance scorecards. |
| `hcpcs.tsx` | Code lookup with org-specific contracted rates. |
| `patient-list.tsx` / `patient-detail.tsx` | Patient roster with VOB history, claim history, referrals. |
| `settings.tsx` | Practice settings: NPI, taxonomy, addresses, FRCPB enrollment. |
| `user-management.tsx` | Invite/edit/delete users, reset passwords. |

### 5.9 Rate lookup

`server/lib/rate-lookup.ts` resolves expected payment for any HCPCS code by walking, in order:
1. `va_location_rates` (VA home health G/S/T codes × locality)
2. `hcpcs_rates` (org-contracted rates from CSV ingest)
3. `va_fee_schedule` (VA fee schedule, when populated)
4. `medicare_pfs` (national Medicare Physician Fee Schedule)

When no rate is found, the wizard shows an INFO message rather than blocking submission, so providers can still bill at their own rate (with the audit trail preserved).

---

## 6. Module 3 — Admin & Intelligence

This module is for the platform itself and for super-admins. It is where the **payer intelligence moat** is built and maintained.

### 6.1 Payer manual ingestion (Phase 4 — top-20 commercial payer registry)

- **Source registry:** `payer_manual_sources` — 20 seeded top commercial payers (Aetna, BCBS, Cigna, Humana, UHC, etc.) plus VA/PGBA.
- **Acquisition:** Playwright scrapers (`server/jobs/scrape-payer-documents.ts`) fetch PDFs into `payer_source_documents`.
- **Extraction:** Claude AI (`server/services/claude-extractor.ts`) parses the PDF and produces a JSON of structured `manual_extraction_items` (rule_kind, applies_to, action_required, source_url, source_acquisition_method).
- **Verification:** Items have `last_verified_at` and `needs_reverification` flags. The Phase-2 Provider Manual Ingestion Agent (planned follow-up #44) will continuously re-verify against fresh scrapes.
- **Demo seeding:** `is_demo_seed=true` items can be excluded from real evaluation runs.

### 6.2 Rules database UI

`/admin/rules-database` exposes:
- **Overview** — count by payer, rule_kind, demo vs real.
- **Freshness** — items not verified in N days.
- **History** — change log per item.
- **Leaderboard** — payers with the most rules (proxy for intelligence depth).
- **CMS conflicts** — flags where extracted payer rules conflict with CMS NCCI baseline.
- **Coverage validator** — `/api/admin/payer-manual-coverage/validate` runs cross-checks.

### 6.3 NCCI quarterly ingest

`server/services/cci-ingest.ts` + `server/jobs/cci-cron.ts`:
- Cron fires on the 5th of Jan/Apr/Jul/Oct (quarterly) — gives CMS time to publish.
- Downloads CMS NCCI PTP edits ZIP, parses to `cci_edits` table.
- Records `ncci_version_at_creation` on every claim for audit.
- Manual triggers: `POST /api/admin/cci/ingest`, `POST /api/admin/cci/upload`.

### 6.4 Scraper orchestration

`scraper-monitor.ts` provides:
- Per-payer **circuit breaker** (3 consecutive failures → opens circuit, requires manual reset).
- **Rate limiting** (`scraper_circuit_state`).
- **Post-scrape SQL assertions** validate data integrity.
- **Weekly synthetic E2E canary** runs Sunday 03:30 UTC against a known stable payer to detect upstream selector breakage.
- **Webhook alerts** fire on failure or canary regression.

### 6.5 VA fee schedule + rate ingest

`server/services/rate-ingest.ts`:
- Downloads CMS Medicare PFS by year.
- Downloads VA fee schedule by year.
- Locality-aware ingest (e.g., SF locality only, or all-localities).
- Idempotent UPSERT keyed by (hcpcs, modifier, schedule_type, geographic_scope, effective_date, year).

### 6.6 Intelligence layer

- **`/api/intelligence/clusters`** — clusters denials by pattern (CARC/RARC × payer × code) to surface the highest-leverage rules to add.
- **`/api/intelligence/top-patterns`** — top denial reasons across the tenant base.
- **Leaderboard** — feeds back into rule extraction prioritization.

---

## 7. Multi-Tenancy Architecture

### 7.1 Tenant isolation model

- Every business table carries `organization_id`.
- Every API list/write endpoint enforces tenant boundary via `requireOrgCtx()` middleware that resolves org from the authenticated session.
- Super-admins must **impersonate** an org to access org-scoped data — there is no cross-tenant view from regular endpoints. Cross-tenant aggregation is exposed only via explicit `/api/super-admin/*` endpoints.

### 7.2 Per-org configuration tables (`org_*`)

| Table | Purpose | Example for Caritas |
|---|---|---|
| `org_message_templates` | SMS/email body keyed by `template_key` + `channel` + `locale` | `intake_confirmation_sms_en`, `intake_confirmation_sms_es` |
| `org_service_types` | Service codes the org offers | `home_health`, `va_community_care` |
| `org_payer_mappings` | Carrier name → Stedi trading partner ID | `"VA Community Care"` → `TRIWEST_R5` |
| `org_voice_personas` | Vapi assistant ID + system prompt per persona key | `caritas_intake_en`, `caritas_intake_es` |
| `org_lead_sources` | Lead source slugs/labels for forms | `web_form`, `partner_referral`, `paid_ads` |
| `org_providers` | Credentialed providers with `service_types[]` + `languages[]` | (Caritas RNs, aides) |
| `step_types` | Reference table of valid step type keys | (global, not per-org) |

All `org_*` tables are seeded **idempotently at startup** via the seeder block in `server/routes.ts` — every deployment self-heals missing rows via `ON CONFLICT DO NOTHING`.

### 7.3 Currently configured tenants

| `organization_id` | Org name | Status | Notes |
|---|---|---|---|
| `caritas-org-001` | Caritas Senior Care | `is_active=true` | 8-step intake flow live; 11-step bilingual revision pending |
| `chajinel-org-001` | Chajinel Clinic | `is_active=false` | Awaiting Vapi assistant ID |
| (demo) | Demo Org | `is_active=true` | Holds historical/orphan data assigned during multi-tenancy migration |

### 7.4 Onboarding a new tenant (the playbook)

1. Insert row into `organizations`.
2. Seed `org_lead_sources`, `org_service_types`, `org_message_templates`, `org_voice_personas`, `org_payer_mappings` for the new org.
3. Create at least one user with role `billing_admin` for the org.
4. Configure `practice_settings` (NPI, taxonomy, address, FRCPB enrollment if VA).
5. Add credentialed `providers` with NPIs, taxonomy codes, license numbers.
6. Seed/clone an intake flow.
7. Enroll the org with each payer they bill (ERA enrollment, EDIG enrollment for PGBA).
8. Verify with one test claim through Stedi T mode end-to-end.

This entire playbook is the basis for the **post-merge setup script** that runs after every project-task merge.

---

## 8. Data Model (Top-Level)

31 first-party tables in `shared/schema.ts`, plus ~25 reference and `org_*` tables. Below is the top-level grouping.

### 8.1 Identity & tenancy
`users`, `organizations`, `practice_settings`

### 8.2 Intake
`leads`, `calls`, `chat_sessions`, `chat_messages`, `chat_analytics`, `appointments`, `availability_slots`, `email_templates`, `email_logs`, `nurture_sequences`, `vob_verifications`

### 8.3 Patients & clinical
`patients`, `encounters`, `pcp_referrals`, `delegated_entities`, `payer_delegated_entities`

### 8.4 Claims
`claims`, `claim_events`, `submission_attempts`, `denials`, `prior_authorizations`, `claim_templates`, `timely_filing_alerts`

### 8.5 Reference data
`payers`, `payer_supported_plan_products`, `plan_products`, `field_definitions`, `hcpcs_codes`, `hcpcs_rates`, `va_fee_schedule`, `va_location_rates`, `cci_edits`, `payer_auth_requirements`, `practice_payer_enrollments`

### 8.6 Rules & intelligence
`rules`, `rule_kinds`, `payer_manuals`, `payer_manual_sources`, `manual_extraction_items`, `payer_manual_extraction_history`, `payer_source_documents`, `document_types`

### 8.7 Operations
`activity_logs`, `flows`, `flow_steps`, `flow_runs`, `flow_events`, `step_types`, `scrape_runs`, `scraper_circuit_state`, `scraper_monitor_log`

### 8.8 Per-org configuration
`org_message_templates`, `org_service_types`, `org_payer_mappings`, `org_voice_personas`, `org_lead_sources`, `org_providers`

---

## 9. Integration Surface

| Integration | Purpose | Direction | Auth |
|---|---|---|---|
| **Stedi** | 270/271 eligibility, 837P submission, 999/277CA/835 webhooks | Bidirectional REST + webhook | API key |
| **Office Ally** | EDI claim SFTP gateway (fallback) | Outbound SFTP, inbound polling for 999/277/835 | SFTP credentials |
| **Vapi** | AI outbound voice calls + webhooks | Bidirectional REST + webhook | API key (public + private) |
| **Twilio** | SMS send + inbound MO webhook | Bidirectional REST + webhook | Account SID + Auth Token + Messaging Service SID |
| **Nodemailer / Gmail** | Transactional email + daily digests | Outbound SMTP | Gmail App Password |
| **Claude AI (Anthropic)** | Payer manual extraction → structured rules | Outbound REST | API key |
| **VerifyTx** | Behavioral health VOB (alternate to Stedi for some payers) | Outbound REST | Client ID + secret + username + password |
| **Playwright** | Headless scraping of payer manuals | Internal | (none — runs in-process) |
| **CMS public files** | NCCI quarterly + Medicare PFS + VA fee schedule | Inbound HTTP download | (none — public) |

---

## 10. Background Automation (Cron Jobs)

| Job | Schedule | Purpose |
|---|---|---|
| **Flow orchestrator** | Every 30 sec | Sweep flow runs, execute due steps, retry transient failures |
| **CCI quarterly ingest** | 5th of Jan/Apr/Jul/Oct | Download + parse CMS NCCI PTP edits |
| **Timely filing guardian** | Daily 06:00 UTC | Re-evaluate `timely_filing_status` on all active claims; expire stale `pcp_referrals`; send daily email digest |
| **Daily payer scraper** | Daily 03:00 UTC | Scrape every registered payer manual source; run post-scrape SQL assertions; webhook alert on regression |
| **Weekly synthetic canary** | Sunday 03:30 UTC | E2E test against a stable known payer to detect selector drift |
| **277CA poll** | (event-driven) | Poll Stedi for new 277CA reports |
| **835 poll** | (event-driven) | Poll Stedi for new 835 ERA reports |

---

## 11. Conditional Field Resolver

`server/services/field-resolver.ts` and `field_definitions` table together implement a **dynamic patient-form schema** that adapts to payer + plan context:

- For VA Community Care patients, the form shows `veteran_id_type` (SSN/EDIPI/MVI ICN) and `veteran_id` fields.
- For Medicare Advantage patients, the form shows `delegated_entity` (HMO delegate) and `pcp_referral_number`.
- For commercial payers, no additional fields beyond standard demographics.

The frontend calls `/api/practice/activated-fields` to get the current effective field set for the patient's payer/plan/org combination, and the form renders accordingly. This means new payer-specific fields can be added by inserting `field_definitions` rows + `payer_supported_plan_products` mapping, with no frontend code changes.

---

## 12. Client-Side PDF Generation

To avoid server-side PDF infrastructure and keep PHI in the browser session:

- **CMS-1500** — generated client-side from the claim payload via `/api/billing/claims/:id/pdf-data`, rendered into a CMS-1500 form template, and downloaded.
- **Appeal letters** — generated from `/api/billing/claims/:id/letter-data`, rendered with patient + claim + denial context.
- **VOB verification report** — `/api/vob-verifications/:id/pdf`.

---

## 13. Implementation Strategy & Phasing

### 13.1 Completed phases (as of May 2026)

| Phase | Scope | Status |
|---|---|---|
| **Phase 1** | Core billing foundation: patients, claims, EDI generation, Stedi submission, ERA posting | ✅ |
| **Phase 2** | Rules engine + NCCI ingest + readiness gate | ✅ |
| **Phase 3** | Intake module: leads, flows, Vapi, Twilio, VOB | ✅ |
| **Phase 4** | Top-20 commercial payer registry + Claude extraction pipeline | ✅ (registry seeded) |
| **Phase 5 (A–F)** | Multi-tenancy refactor of intake module: `org_*` tables, org-agnostic executor, Caritas + Chajinel onboarding | ✅ |
| **PGBA 837P CG v1.0 audit** | 8 EDI-generator fixes + 37-code rejection dictionary + verified test EDI | ✅ |
| **DTP*434 ordering bug** | Fixed Loop 2300 segment order (CLM → DTP → REF → NTE → HI) | ✅ (in dev, awaiting prod deploy) |

### 13.2 Imminent / pending Abeer review

1. **Prod deploy of `5c5bab7`** — DTP*434 ordering fix (unblocks every Chajinel home health claim).
2. **Chajinel Vapi assistant ID** — replace placeholder, then `is_active=true`.
3. **PGBA EDIG enrollment** — replace ISA06/GS02 placeholder with EDIG-assigned submitter ID.
4. **NM103 ambiguity** — confirm `"PGBA VA CCN"` vs `"PGBA VACCN"` with PGBA support.
5. **ISA16 ambiguity** — confirm `:` vs `>` separator with PGBA support.
6. **13 missing leads columns** — `care_recipient_name`, `preferred_language`, `recommended_path`, `requested_services`, `consultation_preference`, `consultation_scheduled_at`, `matched_provider_id`, `considering_alf`, `start_urgency`, `insurance_status`, `payment_method`, `location_city`, `spanish_caregiver_preferred`. Blocks the revised Caritas bilingual spec.
7. **Caritas revised bilingual 11-step spec** — awaiting spec doc from Abeer.
8. **99509 (and other unlisted-by-rate) HCPCS codes** — decide whether to add a contracted rate to `hcpcs_rates` or use G-code equivalent.

### 13.3 Next phases (planned)

| Phase | Scope | Why |
|---|---|---|
| **Phase 6 — Provider Manual Ingestion Agent v2** | Continuous re-verification of `manual_extraction_items` against fresh scrapes; auto-flag drift; auto-PR rule changes for human review | Closes the loop on payer intelligence freshness |
| **Phase 7 — Multi-tenancy of Billing module** | Apply the same `org_*` refactor pattern to billing-side hardcoded data (rate sources, default payers, etc.) | Onboard Tenant #4+ without code changes |
| **Phase 8 — Behavioral Health vertical** | Add BH-specific service codes, BH payer profiles (Beacon, Magellan, Optum BH), BH auth workflows, telehealth modifier rules | Open second vertical |
| **Phase 9 — Patient portal** | Patient-facing portal: view claims, statements, pay balances | Reduce phone volume on practice |
| **Phase 10 — Reporting & BI** | Cross-tenant benchmarking (anonymized), payer-level scorecards, predictive denial scoring | Increase platform stickiness |
| **Phase 11 — Open API + webhooks for partners** | Expose `/api/partners/*` for EHR integrations and referral source partners | Grow inbound lead volume |

---

## 14. Operational Concerns

### 14.1 Security
- `bcryptjs` password hashing (12 rounds).
- Session-based auth via `express-session` + `pg-session-store`.
- `SESSION_SECRET` rotated on platform-managed schedule.
- No PHI in logs (audited at every log point).
- All third-party credentials in environment secrets — never in code.
- Tenant isolation enforced at the route layer; super-admin impersonation logged in `activity_logs`.

### 14.2 Audit & compliance
- `activity_logs` records every meaningful state transition (claim status change, user invite, password reset, claim submission, ERA post, etc.).
- `claim_events` records every per-claim event with timestamp, user, and event type.
- `submission_attempts` snapshots the exact EDI payload submitted on every attempt — never overwritten.
- `payer_manual_extraction_history` records every change to a rule with diff and source.

### 14.3 Disaster recovery
- PostgreSQL daily backups managed by Replit infrastructure.
- `gitsafe-backup/main` mirror branch for code.
- Automatic checkpoints on every meaningful change, restorable via the diagnostics rollback flow.

### 14.4 Production gating (standing order)
- **No production deploys without Abeer review.** This is a permanent guardrail for the project. Every prod deploy is queued behind explicit owner approval.

### 14.5 Observability
- Workflow logs via Replit's log mapping system.
- Browser console logs captured for every session.
- Stedi/Office Ally errors surfaced to the user with both raw payload and interpreted human-readable message (via `pgba_rejection_codes.json`).
- Scraper monitor webhook alerts on assertion failures or canary regressions.

---

## 15. Glossary

| Term | Meaning |
|---|---|
| **837P** | X12 EDI transaction set for professional medical claims (CMS-1500 equivalent). |
| **270/271** | Eligibility request / response transactions for Verification of Benefits. |
| **277CA** | Claim acknowledgment transaction returned by clearinghouse/payer. |
| **835 / ERA** | Electronic Remittance Advice — the payer's payment + adjudication breakdown. |
| **999** | Functional acknowledgment confirming EDI envelope was syntactically valid. |
| **CARC / RARC** | Claim Adjustment Reason Code / Remittance Advice Remark Code (denial reasons). |
| **NCCI PTP** | National Correct Coding Initiative Procedure-to-Procedure edits — code-pair conflict rules. |
| **MUE** | Medically Unlikely Edit — units-per-day cap per code. |
| **PGBA** | Palmetto GBA — TriWest's Region 5 VA Community Care claims processor. |
| **EDIG** | Electronic Data Interchange Gateway — PGBA's EDI submitter portal. |
| **VOB** | Verification of Benefits — confirming patient has active coverage and what it covers. |
| **VA CCN** | VA Community Care Network — Veterans Affairs program for civilian providers. |
| **EDIPI** | Electronic Data Interchange Personal Identifier — 10-byte DoD member ID. |
| **MVI ICN** | Master Veteran Index Identity Control Number — 17-byte VA ID. |
| **POS** | Place of Service code (e.g., 11=office, 12=home, 02=telehealth). |
| **HCPCS** | Healthcare Common Procedure Coding System — service codes (CPT + HCPCS Level II). |
| **HL** | Hierarchical Level segment in X12 — defines billing/subscriber/patient hierarchy. |
| **FRCPB** | Practice setting flag for orgs enrolled with PGBA's filing system. |

---

*Document version: 1.0 · Generated May 2026 · Source: codebase at commit `7f74f18`*
