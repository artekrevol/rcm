# Claim Shield Health — QA Audit Report

**Date:** April 8, 2026
**Scope:** Full platform audit covering UX, technical implementation, workflow optimization, performance, and first-time user experience.
**Codebase state:** Post-security hardening (commit `8b91bcc`)

---

## Section A — UX Scorecard

Each screen rated on 5 dimensions (1–5 scale):
- **Clarity** — Is the purpose/information immediately understandable?
- **Efficiency** — Can the user accomplish their goal with minimal steps?
- **Feedback** — Does the UI communicate state changes, loading, errors?
- **Error Recovery** — Can the user correct mistakes easily?
- **Consistency** — Does it follow platform-wide patterns?

---

### A1. Login Page
| Dimension | Score | Observation |
|-----------|-------|-------------|
| Clarity | 5 | Clean centered card, clear branding, HIPAA disclaimer. |
| Efficiency | 4 | Two fields + submit. Standard. |
| Feedback | 4 | Loading spinner on button, error alert with icon. |
| Error Recovery | 3 | Email is preserved on failure, but generic error message ("Invalid email or password") doesn't distinguish locked accounts, expired sessions, or connectivity issues. **No forgot-password flow exists.** |
| Consistency | 5 | Uses standard Card/Input components. |

**Notable gaps:** No forgot-password link. No "Remember me" option. No lockout warning after repeated failures. No rate limiting on login attempts.

---

### A2. Module Selector
| Dimension | Score | Observation |
|-----------|-------|-------------|
| Clarity | 5 | Welcome message with user name, two clearly labeled cards. |
| Efficiency | 5 | Single-role users auto-redirect — never see this page. |
| Feedback | 4 | Hover border effect on cards. |
| Error Recovery | 5 | No input, nothing to recover from. |
| Consistency | 5 | Standard card layout. |

**Notable gaps:** No onboarding for first-time users. No indication of which module was last used. No quick-stats preview on cards (e.g., "12 new leads" or "3 denied claims").

---

### A3. Intake Dashboard
| Dimension | Score | Observation |
|-----------|-------|-------------|
| Clarity | 4 | Pipeline cards with counts + SLA breach badges are clear. |
| Efficiency | 3 | **Pipeline cards are not clickable** — user sees "5 New" but can't click to see those 5 leads. Must navigate to worklist separately and mentally filter. "Add New Lead" button navigates to worklist page rather than opening a creation form directly. |
| Feedback | 3 | No loading skeleton — shows "0" during load which could be mistaken for empty data. Empty states for appointments and chat sessions are adequate. |
| Error Recovery | 4 | No destructive actions on this page. |
| Consistency | 4 | Uses same card patterns as billing dashboard. |

**Notable gaps:** Pipeline cards should link to filtered worklist views. "Add New Lead" should open the creation dialog inline rather than navigating away. No time-range selector for dashboard data.

---

### A4. Lead Worklist (Table + Board View)
| Dimension | Score | Observation |
|-----------|-------|-------------|
| Clarity | 4 | 11 columns provide comprehensive data. KPI strip highlights urgency. |
| Efficiency | 3 | **No column sorting** — users cannot sort by priority, date, or VOB completeness. Queue tabs filter effectively but lack a "Follow-up Today" view for daily workflow. |
| Feedback | 4 | VOB completeness progress bar is excellent visual feedback. Attempts counter opens timeline modal. |
| Error Recovery | 3 | **Board view has no drag-and-drop** — status can only be changed via the detail page or action menu, adding unnecessary clicks. |
| Consistency | 4 | Table follows platform patterns. Board view is simpler than typical Kanban. |

**Notable gaps:** No column sorting. No bulk actions (e.g., mass-assign, mass-status-change). Board view is read-only display, not interactive Kanban. No saved filters or custom views. No export-to-CSV.

---

### A5. Lead Detail Page
| Dimension | Score | Observation |
|-----------|-------|-------------|
| Clarity | 4 | Activity timeline, VOB card, and action buttons provide clear context. |
| Efficiency | 4 | Quick-action buttons for status changes in header. Call/SMS/Email accessible from header. |
| Feedback | 4 | Activity feed updates in real-time. VOB completeness percentage updates on data entry. |
| Error Recovery | 3 | **Editing requires a separate dialog** — inline editing would be faster. No undo for status changes. |
| Consistency | 4 | Follows detail-page patterns. |

**Notable gaps:** No inline editing — every edit opens a modal. No undo for accidental status changes. "Convert to Patient" confirmation modal is good but doesn't preview what data will transfer vs. what won't.

---

### A6. Billing Dashboard
| Dimension | Score | Observation |
|-----------|-------|-------------|
| Clarity | 5 | Pipeline cards with counts + dollar amounts are immediately useful. Alert cards with specific counts and links. |
| Efficiency | 4 | Alert cards link directly to filtered claim views. Recent patients each have a "New Claim" shortcut. |
| Feedback | 5 | Full loading skeleton during fetch. Color-coded status dots on patient cards. |
| Error Recovery | 5 | No destructive actions on dashboard. |
| Consistency | 5 | MetricCard variants used consistently. |

**Notable gaps:** No date-range selector for pipeline data. No trend indicators (up/down vs. prior period). No revenue chart or aging graph. "Recent Patients" section hides entirely when empty rather than showing a helpful empty state.

---

### A7. Claim Wizard — Step 1 (Patient Selection)
| Dimension | Score | Observation |
|-----------|-------|-------------|
| Clarity | 4 | Search box with result cards showing name, DOB, insurance. |
| Efficiency | 4 | Patient search is fast. Pre-fills if `patientId` is in URL. |
| Feedback | 4 | Next button disabled without patient. Draft created on advance. |
| Error Recovery | 3 | **No way to resume a previous draft.** If user navigates away and returns, they start fresh — no "You have 2 pending drafts" prompt. |
| Consistency | 4 | Step indicator shows progress. |

### A7. Claim Wizard — Step 2 (Service Details)
| Dimension | Score | Observation |
|-----------|-------|-------------|
| Clarity | 4 | Service lines, ICD-10, auth number, provider dropdown — well organized. |
| Efficiency | 3 | **No duplicate-line shortcut** — if all 6 lines use the same code, each must be entered individually. Time-based unit calculator is excellent for home health. |
| Feedback | 4 | VA average-rate warning banner when location isn't configured. |
| Error Recovery | 3 | **Step 2 → Step 3 is not blocked by missing required fields.** Validation only surfaces on Step 3, forcing user to go back. Should validate in-line on Step 2. |
| Consistency | 4 | Follows form patterns. |

### A7. Claim Wizard — Step 3 (Review)
| Dimension | Score | Observation |
|-----------|-------|-------------|
| Clarity | 5 | Full claim summary, risk panel with GREEN/YELLOW/RED, validation errors and warnings clearly separated. |
| Efficiency | 3 | **"Submit to Availity" is a placeholder modal** — tells user to download PDF and manually upload. This is the single largest efficiency gap in the billing module. |
| Feedback | 4 | Risk score explanation is detailed. Error/warning counts visible. |
| Error Recovery | 3 | Errors list which step they belong to, but **no "Jump to Step X" link** — user must click Back manually. Warning acknowledgment checkbox is a good pattern. |
| Consistency | 4 | Review layout is clean. |

---

### A8. Patient Detail Page
| Dimension | Score | Observation |
|-----------|-------|-------------|
| Clarity | 5 | 4-tab layout (Profile, Claims, Eligibility, Notes) is logical. Header shows key identifiers. |
| Efficiency | 4 | Inline editing on Profile tab. "New Claim" button pre-fills patient. |
| Feedback | 5 | Loading spinners per tab. Toast notifications on save. "From Intake" badge for converted patients. |
| Error Recovery | 4 | NPI validation with error messages. All fields editable. |
| Consistency | 5 | Standard tab/form patterns. |

**Notable gaps:** "Run Eligibility Check" button is disabled with "Coming in next update" tooltip — should be hidden or better communicated. "Clone Claim" button says "coming soon." Two permanently disabled features visible to users.

---

### A9. Claims List
| Dimension | Score | Observation |
|-----------|-------|-------------|
| Clarity | 4 | Columns include risk score, readiness badge, and status — dense but informative. |
| Efficiency | 3 | **No column sorting.** Filter dropdowns work but no saved filter presets. No batch actions (e.g., bulk export, bulk status change). |
| Feedback | 4 | High-risk alert banner at top when RED claims exist. |
| Error Recovery | 4 | Filters are independently clearable. |
| Consistency | 4 | Uses shared DataTable component. |

**Notable gaps:** No sortable columns. No pagination controls visible (relies on full data load). No batch export. No "New Claim" button on this page — must go to dashboard or direct URL.

---

### A10. Claim Detail Page
| Dimension | Score | Observation |
|-----------|-------|-------------|
| Clarity | 5 | Risk assessment, timeline, action checklist, patient info all well-organized. |
| Efficiency | 3 | **"File Appeal" button is a non-functional placeholder.** No edit capability — claim detail is entirely read-only after creation. |
| Feedback | 4 | "Stuck" indicator after 7 days pending. Re-download label changes after first PDF generation. |
| Error Recovery | 2 | **No way to edit a submitted claim.** No way to correct errors on a created claim without going back through the wizard flow (and there's no "Edit Claim" link that takes you back). **No void/cancel claim action.** |
| Consistency | 4 | Layout consistent with detail pages. |

**Notable gaps:** Read-only after creation with no edit path. "File Appeal" is non-functional. No void/cancel claim. No claim-to-claim navigation (prev/next).

---

### A11. Practice Settings
| Dimension | Score | Observation |
|-----------|-------|-------------|
| Clarity | 5 | 4 tabs clearly labeled (Providers, Practice Info, Payers, Rate Tables). |
| Efficiency | 4 | Inline CRUD for providers and payers. VA location dropdown with search. |
| Feedback | 4 | 90-day staleness warning on VA rates. NPI checksum validation. |
| Error Recovery | 4 | Validation messages on save. Delete confirmations. |
| Consistency | 5 | Standard settings pattern. |

**Notable gaps:** No "Test connection" for payer configurations. No import/export for provider lists. No audit trail of settings changes.

---

### A12. Intelligence / Denial Prevention
| Dimension | Score | Observation |
|-----------|-------|-------------|
| Clarity | 4 | Bar chart and pattern cards with trend sparklines. |
| Efficiency | 4 | "Generate Prevention Rule" one-click from pattern to rule. |
| Feedback | 4 | Rule toggle with instant enable/disable. Impact counts (triggered, prevented, revenue protected). |
| Error Recovery | 4 | Rules can be toggled off without deleting. |
| Consistency | 4 | Card and table patterns consistent. |

**Notable gaps:** No date-range filter on denial patterns. No drill-down from pattern to specific denied claims. Pattern data is seeded/simulated rather than computed from real denial history.

---

### A13. Compliance Reports
| Dimension | Score | Observation |
|-----------|-------|-------------|
| Clarity | 4 | 4 report cards with clear descriptions. |
| Efficiency | 4 | Date range pickers + one-click PDF generation. |
| Feedback | 3 | **No preview before download.** User must generate and open the PDF to see if the date range captured the right data. No row-count indicator before generation. |
| Error Recovery | 3 | If wrong date range is selected, user must re-generate. No "last generated" timestamp visible. |
| Consistency | 4 | Card layout consistent. |

**Notable gaps:** No on-screen preview table. No record count shown before PDF generation. No scheduled/automatic report generation. No email delivery option.

---

## Section B — Claim Wizard Technical Findings

### B1. Unit Calculator — VA Location Rates
**Finding: Uses live `va_location_rates` table data.**

When a HCPCS code is selected and the patient's payer contains "VA":
1. The wizard calls `GET /api/billing/va-rate?code={code}&location={billingLocation}`
2. The server queries `va_location_rates` for an exact match on `hcpcs_code` and `location_name`
3. If a location-specific rate is found, it returns that rate
4. If no location match is found, it computes a national average across all locations and returns it with `is_average: true`
5. The wizard updates the service line with the returned rate

**No hardcoded rate values are used.** The database contains 2,160 rates across 108 locations and 20 HCPCS codes.

### B2. ICD-10 Search — Full Database
**Finding: Queries the full 97,584-code database via API.**

- The `ICD10Search` component calls `GET /api/billing/icd10/search?q={query}` after a 300ms debounce
- The server runs: `SELECT code, description FROM icd10_codes WHERE (LOWER(code) LIKE $1 OR LOWER(description) LIKE $1) AND is_header = false AND is_active = true LIMIT 15`
- This searches across all 97,584 codes
- **Fallback:** If the API call fails or returns zero results, the UI falls back to a hardcoded list of 20 common ICD-10 codes (`ICD10_COMMON`)
- **Performance:** GIN full-text search index exists on `icd10_codes(description)` but the current query uses `LIKE` (prefix match), not `to_tsvector`. The LIKE query still completes in ~155ms which is acceptable.

### B3. Billing Location Warning
**Finding: Warning is shown when no location-specific rate is found.**

When the VA rate API returns `is_average: true`, the wizard displays a yellow warning banner:
> *"VA billing location not configured. Using national average rate. Set your location in Practice Settings for accurate rates."*

This warning appears inline next to the service line. However, there is **no proactive warning at the start of the wizard** — the user only discovers the issue after selecting a code. A better pattern would be to check for location configuration on wizard load and warn upfront.

### B4. Draft Auto-Save on Browser Close
**Finding: Partial — draft exists but wizard state is lost.**

- A draft claim record is created in the database as soon as the user selects a patient and clicks "Next" on Step 1
- The draft includes `patient_id`, `payer`, and initial metadata
- Moving from Step 2 → Step 3 triggers `saveMutation` which persists service lines, ICD codes, and other Step 2 data
- **However:** If the browser closes during Step 2 before clicking "Next," any unsaved Step 2 data (service lines, ICD codes) is lost. Only the draft shell from Step 1 survives.
- **There is no "resume draft" flow.** Returning to `/billing/claims/new` always starts fresh. There is no "You have X pending drafts" notification. Orphaned drafts accumulate silently.

### B5. Advancing Without Required Fields
**Finding: Step 2 → Step 3 is not blocked by missing fields.**

| Transition | Blocked? | Mechanism |
|-----------|----------|-----------|
| Step 1 → Step 2 | **Yes** | "Next" button is disabled if no patient is selected |
| Step 2 → Step 3 | **No** | `handleStep2Next` saves whatever is entered and advances. Missing fields surface as validation errors on Step 3. |
| Step 3 → Submit | **Yes** | Submit button is disabled if `validationErrors.length > 0`. Also blocked if warnings exist and acknowledgment checkbox is unchecked. |

The gap is Step 2 → Step 3: a user can advance with no service lines, no ICD-10 code, and no provider selected. They only learn these are required when they see the error list on the Review step.

---

## Section C — Flow Optimization

### C1. New Patient Intake → First Claim (End-to-End)

**Current Flow (14 steps):**
1. Intake user creates lead via "New Lead" form (Name + Phone required)
2. Lead appears in worklist with status "New"
3. User opens lead detail, initiates AI voice call or manual call
4. Call data auto-populates lead fields (insurance, service needed)
5. User reviews/edits lead data in edit dialog
6. User triggers VOB verification via VerifyTX
7. User changes lead status to "Qualified"
8. User clicks "Convert to Patient" — confirmation modal
9. Patient record created in billing module with lead data
10. Billing user navigates to patient in billing module
11. Billing user clicks "New Claim" on patient card
12. Claim wizard: Step 1 (patient pre-selected), Step 2 (service details), Step 3 (review)
13. User clicks "Generate CMS-1500" → PDF downloads
14. User manually uploads PDF to Availity portal

**Friction Points:**
- Step 5: Edit dialog is a separate modal — could be inline
- Step 8-9: Conversion is a one-way door with no preview of what transfers
- Step 10: Billing user has no notification that a new patient was converted
- Step 12: No service details carry over from intake (service needed, auth number from VOB)
- Step 14: Manual Availity upload is the biggest friction point

**Proposed Ideal Flow (10 steps):**
1. Lead created via chat widget, phone, or manual entry
2. ⚖️ AI call extracts insurance and service data → auto-populates
3. ⚖️ VOB verification runs (auto-triggered when insurance data is complete)
4. User reviews pre-filled lead data inline (no dialog needed)
5. User clicks "Qualify & Convert" — single action creates patient
6. ⚖️ System auto-creates draft claim with service details from intake
7. Billing user receives notification → opens pre-filled claim wizard
8. ⚖️ User reviews and adjusts service lines, adds ICD-10
9. ⚖️ User submits → system generates CMS-1500 and queues for clearinghouse
10. ⚖️ Claim submitted electronically

**Step reduction: 14 → 10 steps (29% reduction)**

---

### C2. Claim Creation Wizard

**Current Flow (9 steps):**
1. Navigate to `/billing/claims/new` (or click "New Claim" on patient)
2. Search and select patient
3. Click "Next" → draft created in database
4. Select rendering provider from dropdown
5. Enter service date, place of service
6. Add service lines (code search → select → units → rate)
7. Search and select ICD-10 diagnosis codes
8. Click "Next" → validation runs, risk score calculated
9. Review errors/warnings → Generate PDF → Download

**Friction Points:**
- Step 2: No "recent patients" shortcut in search
- Step 4: If only one provider exists, should auto-select
- Step 6: No duplicate-line shortcut for repeated codes
- Step 7: ICD-10 search requires typing ≥2 chars; no "recent/frequent" codes
- Step 8: Validation runs after leaving Step 2, not inline
- Step 9: "Submit to Availity" is a placeholder

**Proposed Ideal Flow (6 steps):**
1. Navigate or click "New Claim" (patient auto-selected if from patient page)
2. ⚖️ Provider auto-selected if default exists; service date defaults to today
3. ⚖️ Add service lines with code search + smart defaults (frequent codes pinned)
4. ⚖️ ICD-10 search with inline validation (errors shown immediately, not deferred)
5. ⚖️ Review panel with real-time risk score + one-click submit
6. ⚖️ System generates CMS-1500 + submits electronically

**Step reduction: 9 → 6 steps (33% reduction)**

---

### C3. Denial → Resubmission

**Current Flow (incomplete — 4+ manual steps):**
1. User sees denied claim in claims list or dashboard alert
2. Clicks claim → reads timeline for denial reason
3. Clicks "File Appeal" button → **button is non-functional placeholder**
4. User must manually create a new claim or correct the issue outside the system

**Friction Points:**
- "File Appeal" does nothing — complete dead end
- No denial reason codes captured from payer
- No corrective action suggestions based on denial pattern
- No claim cloning to create a corrected version
- No tracking of appeal status or deadlines

**Proposed Ideal Flow (7 steps):**
1. Denied claim triggers alert + notification
2. User opens claim → sees denial reason with AI-suggested corrections
3. ⚖️ User clicks "Appeal" → system clones claim as new draft
4. ⚖️ Corrective edits applied (code changes, documentation additions)
5. ⚖️ Re-validation confirms corrections address denial reason
6. ⚖️ Appeal submitted with supporting documentation
7. ⚖️ Appeal status tracked with deadline monitoring

**Step reduction: Dead-end → 7 functional steps (currently 0% functional)**

---

### C4. Lead Follow-Up Outreach

**Current Flow (7 steps):**
1. Open lead worklist
2. Identify lead needing follow-up (scan "Next Action" column)
3. Click lead row → opens detail page
4. Click "Call" or "SMS" or "Email" button
5. For email: select template from dropdown, preview, send
6. For call: system initiates Vapi AI call
7. Update lead status based on outcome

**Friction Points:**
- Step 2: No "Follow-up Today" queue filter (must manually identify)
- Step 3: Must navigate to detail page — no inline call/SMS from worklist
- Step 5: Email templates require manual variable review
- No automatic follow-up scheduling (e.g., "call again in 2 days")
- No sequence automation (e.g., Day 1: call, Day 3: SMS, Day 7: email)

**Proposed Ideal Flow (4 steps):**
1. "Today's Follow-ups" queue pre-filtered on dashboard
2. ⚖️ Click lead → inline action panel (call/SMS/email without page navigation)
3. Action executed → disposition recorded → next follow-up auto-scheduled
4. Automated nurture sequence handles unresponsive leads

**Step reduction: 7 → 4 steps (43% reduction)**

---

### C5. Compliance Reporting

**Current Flow (5 steps):**
1. Navigate to `/billing/intelligence/reports` (admin-only)
2. Select report type card
3. Adjust date range using From/To pickers
4. Click "Generate PDF"
5. Open downloaded PDF to review

**Friction Points:**
- Step 3: Date range defaults to last 30 days — adequate but no presets ("This Quarter," "YTD")
- Step 5: No on-screen preview — must download to see content
- No record count shown before generation (could generate empty report)
- No scheduled generation or email delivery
- No report history (what was generated when, by whom)

**Proposed Ideal Flow (3 steps):**
1. Navigate to reports → see report cards with record counts pre-computed
2. ⚖️ Select report → on-screen preview table with export options (PDF, CSV)
3. ⚖️ Optionally schedule recurring generation + email delivery

**Step reduction: 5 → 3 steps (40% reduction)**

---

## Section D — First-Time User Experience

**Scenario:** Brand-new office manager, admin role, first login, goal: configure practice and export first claim.

**Rating: 5/10**

**Step-by-step experience:**

1. **Login (smooth):** Clear login form, branded, HIPAA disclaimer. No friction.

2. **Module Selector (clear):** "Welcome, [Name]" with two cards. Billing is the obvious choice. ✓

3. **Billing Dashboard (confusing):** Dashboard shows all zeros for a new practice — Paid: $0 (0), In Process: $0 (0), etc. **No "Getting Started" guide, checklist, or wizard.** User sees an empty dashboard with no indication of what to do first.
   - *Confusion point: Where do I start? What do I configure first?*

4. **Finding Settings (moderate):** Sidebar has "Settings" at the bottom. User might click it. Four tabs: Providers, Practice Info, Payers, Rate Tables.
   - *Confusion point: No indication that Providers must be set up before creating claims.*
   - *Required prior knowledge: Understanding of NPI numbers, taxonomy codes, place-of-service codes.*

5. **Adding a Provider (friction):** User must know their NPI (10-digit number with checksum validation), credentials abbreviation, and taxonomy code.
   - *Confusion point: What taxonomy code should I use? No guidance or lookup.*
   - *Confusion point: What does "Default" provider mean?*

6. **Practice Info (friction):** Must enter Practice NPI (different from provider NPI), Tax ID/EIN, taxonomy code (again, no lookup).
   - *Confusion point: The VA Fee Schedule Location dropdown is visible but irrelevant for non-VA practices. No explanation of when/why to use it.*

7. **Adding Payers (smooth):** Default payers are pre-seeded (Medicare, BCBS, etc.). User can add more.

8. **Creating First Patient (friction):** User must navigate to Patients → "New Patient". Form has 15+ fields.
   - *Confusion point: Which fields are actually required? The form doesn't visually distinguish required vs. optional.*
   - *Required prior knowledge: Understanding of referral source categories, authorization numbers.*

9. **Creating First Claim (moderate):** User navigates to "New Claim" via dashboard patient card or direct URL.
   - *Confusion point: Service line "Hours" field — user must understand the hours→units→rate conversion for home health billing.*
   - *Good: VA rate auto-populates when selecting codes for VA patients.*
   - *Confusion point: ICD-10 search returns medical terminology — requires clinical knowledge to select correct codes.*

10. **Generating PDF (smooth):** CMS-1500 generation works. PDF downloads immediately.
    - *Confusion point: "Submit to Availity" button opens a modal that says "Coming soon" — user expected electronic submission.*

**Points of confusion / required prior knowledge:**
1. No getting-started checklist or onboarding wizard
2. No explanation of configuration order (Settings → Provider → Patient → Claim)
3. NPI validation requires users to already know their NPI
4. Taxonomy code field has no lookup or guidance
5. Place of Service codes require prior billing knowledge
6. ICD-10 search requires clinical coding knowledge
7. "Submit to Availity" implies electronic submission that doesn't exist yet
8. VA-specific features visible to all practices without context
9. No sample data or "Try with demo data" option for learning
10. No tooltips or help icons on complex fields

---

## Section E — Performance Findings

### Indexes Created (Post-Audit)

| Table | Index | Status |
|-------|-------|--------|
| `claims` | `idx_claims_patient_id` | ✅ Created |
| `claims` | `idx_claims_status` | ✅ Created |
| `claims` | `idx_claims_created_at` | ✅ Created |
| `claims` | `idx_claims_payer` | ✅ Created |
| `patients` | `idx_patients_lead_id` | ✅ Created |
| `patients` | `idx_patients_first_name` | ✅ Created |
| `patients` | `idx_patients_last_name` | ✅ Created |
| `activity_logs` | `idx_activity_logs_created_at` | ✅ Created |
| `activity_logs` | `idx_activity_logs_claim_id` | ✅ Created |
| `activity_logs` | `idx_activity_logs_patient_id` | ✅ Created |
| `leads` | `idx_leads_status` | ✅ Created |
| `leads` | `idx_leads_email` | ✅ Created |
| `hcpcs_codes` | GIN `idx_hcpcs_codes_description` | ✅ Created |
| `icd10_codes` | GIN `idx_icd10_codes_description` | ✅ Created |
| `cpt_codes` | GIN `idx_cpt_codes_description` | ✅ Created |

### Search Query Performance (Measured)

| Query | Time | Index Used? | Notes |
|-------|------|-------------|-------|
| HCPCS search "G02" | 96ms | Yes (code unique index) | Fast |
| HCPCS search "skilled nursing" | — | Partial | Uses `ILIKE` not `to_tsvector`, so GIN index is available but not used by current query. Consider rewriting to use full-text search. |
| ICD-10 search "hypertension" | 287ms | Partial | Same issue — uses `LIKE` pattern, not GIN FTS. Acceptable performance but could be faster. |
| ICD-10 search "I10" | 155ms | Yes (code unique index) | Code-prefix searches are fast. |
| Dashboard stats | 61ms | Yes (claims indexes) | Excellent. |
| CPT search "97110" | 99ms | Yes (code unique index) | Fast. |

### Remaining Performance Gaps

1. **HCPCS/ICD-10/CPT description searches** use `ILIKE '%term%'` instead of `to_tsvector` full-text search. The GIN indexes exist but the queries don't use them. Rewriting to use `WHERE to_tsvector('english', description) @@ plainto_tsquery('english', $1)` would improve description search performance significantly for large result sets.

2. **Call analytics endpoint** (`GET /api/calls-analytics/stats`) iterates over ALL leads and fetches calls for each one in a loop (N+1 query pattern). Should be rewritten as a single SQL query joining `leads` and `calls`.

3. **Chat analytics timeseries** loads ALL chat sessions and ALL leads into memory for client-side date grouping. Should be a SQL `GROUP BY DATE(created_at)` query.

---

## Section F — Priority Fix List (Top 20)

Items ranked by **Severity × Frequency of user impact**.

| # | Issue | Screen/Location | Severity | Effort | Phase |
|---|-------|-----------------|----------|--------|-------|
| 1 | **"File Appeal" button is non-functional** — denied claims have no recovery path | Claim Detail | Critical | L | Phase 2 |
| 2 | **No claim editing after creation** — errors cannot be corrected | Claim Detail | Critical | L | Phase 2 |
| 3 | **"Submit to Availity" is a placeholder** — core billing workflow incomplete | Claim Wizard Step 3 | Critical | L | Phase 2 |
| 4 | **Step 2→3 allows advancing without required fields** — validation deferred to Review | Claim Wizard Step 2 | Major | S | Immediate |
| 5 | **No draft resume flow** — orphaned drafts accumulate, user restarts from scratch | Claim Wizard | Major | M | Immediate |
| 6 | **No forgot-password flow** — locked-out users cannot self-service | Login Page | Major | M | Immediate |
| 7 | **No first-time onboarding** — new users see empty dashboard with no guidance | Billing Dashboard | Major | M | Phase 2 |
| 8 | **Intake pipeline cards not clickable** — dashboard shows counts but no navigation to filtered view | Intake Dashboard | Major | S | Immediate |
| 9 | **No column sorting on worklist tables** — users can't prioritize by date, amount, or risk | Claims List, Lead Worklist | Major | S | Immediate |
| 10 | **No login rate limiting** — brute-force vulnerability on production | Login API | Major | S | Immediate |
| 11 | **Board view has no drag-and-drop** — status changes require navigating to detail page | Lead Worklist | Minor | M | Phase 2 |
| 12 | **N+1 query in call analytics** — performance degrades with more leads | Call Analytics API | Major | S | Immediate |
| 13 | **"Run Eligibility Check" permanently disabled** — confusing placeholder | Patient Detail | Minor | S | Immediate (hide) |
| 14 | **"Clone Claim" says "coming soon"** — another visible placeholder | Patient Detail | Minor | S | Immediate (hide) |
| 15 | **No compliance report preview** — must download PDF to verify content | Compliance Reports | Minor | M | Phase 2 |
| 16 | **HCPCS/ICD-10 description search doesn't use GIN indexes** — LIKE instead of FTS | Search API | Minor | S | Immediate |
| 17 | **No notification when lead converts to patient** — billing team has no trigger | Lead Conversion | Major | M | Phase 2 |
| 18 | **Scheduling page is a placeholder** — inline text only, no calendar | Intake Scheduling | Major | L | Phase 2 |
| 19 | **Reports page (`/billing/reports`) is a placeholder** — shows text only | Billing Reports | Minor | L | Phase 2 |
| 20 | **No data export** — no CSV/Excel export from any list view | All list pages | Minor | M | Phase 2 |

### Effort Key
- **S** = Small (< 4 hours)
- **M** = Medium (4–16 hours)
- **L** = Large (16+ hours)

### Recommended Immediate Fixes (before Phase 2 planning)
Items 4, 5, 6, 8, 9, 10, 12, 13, 14, 16 — these are all S/M effort and directly impact daily usability or security.

### Phase 2 Priorities
Items 1, 2, 3, 7, 11, 15, 17, 18, 19, 20 — these require larger design/engineering effort and represent the next tier of platform maturity.

---

*End of Audit Report*
