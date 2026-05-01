# Claim Shield Health — Pre-Demo QA Runbook

**Purpose:** Step-by-step test scenarios for every module in the platform. Run every section top to bottom before demo day. Mark each row ✅ Pass / ❌ Fail / ⚠️ Note.

---

## How to Use This Document

1. Log in as **QA Admin** (`qa-admin@claimshield.test`) unless a different role is specified.
2. Work through each section in order — later sections depend on data created earlier.
3. For every test case record the actual result and any screenshots of failures.
4. Clearinghouse note: the Stedi-connected environment shows LIVE EDI badges; Office Ally path is tested separately.

---

## 0. Authentication & Role-Based Access

### 0-A. Login / Logout

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 0-A-01 | Happy login | Go to `/auth/login`. Enter valid credentials. Click Sign In. | Redirects to module selector (`/`). |
| 0-A-02 | Wrong password | Enter correct email + wrong password. | Toast error. **No** redirect. |
| 0-A-03 | Empty fields | Submit empty form. | Toast or inline error; form stays. |
| 0-A-04 | Session persistence | Log in, close tab, reopen URL. | Still logged in (session cookie active). |
| 0-A-05 | Logout | Click user avatar → Logout. | Redirected to `/auth/login`. |

### 0-B. Role Gating

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 0-B-01 | Intake-only user sees no billing | Log in as `qa-intake@claimshield.test`. | Module selector shows Intake only. Navigating to `/billing/claims` redirects to unauthorized or login. |
| 0-B-02 | RCM user sees billing | Log in as `qa-rcm@claimshield.test`. | Module selector shows Billing. No Admin option. |
| 0-B-03 | Admin sees all modules | Log in as `qa-admin@claimshield.test`. | All three modules (Billing, Intake, Admin). |
| 0-B-04 | Super admin impersonation | Log in as `abeer@tekrevol.com`. Navigate to `/admin/clinics`. Click a tenant → Impersonate. | Session switches to that org. All data scoped to impersonated org. |

---

## 1. Module Selection & Navigation

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 1-01 | Billing module entry | Click "Billing" on module selector. | Redirects to `/billing/clinic` or `/billing/claims`. Billing sidebar is visible. |
| 1-02 | Intake module entry | Click "Intake" on module selector. | Redirects to `/intake/dashboard`. Intake sidebar is visible. |
| 1-03 | Sidebar links all resolve | Click every sidebar link in Billing module. | Each link loads its page without 404 or white screen. |
| 1-04 | Back to module selector | Click the ClaimShield logo or module-switch button in sidebar. | Returns to module selector. |

---

## 2. Patient Management

### 2-A. Create Patient (Happy Path)

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 2-A-01 | Minimum required fields | Go to `/billing/patients/new`. Fill **First Name**, **Last Name**, **DOB** only. Click Save. | Patient is created. Redirects to patient detail page. |
| 2-A-02 | Full profile | Fill all fields including insurance carrier (from enrolled payers dropdown), member ID, group number, referring provider NPI (valid 10-digit), address, phone, email. Click Save. | Patient created with all fields persisted. |
| 2-A-03 | With secondary insurance (COB) | Fill primary insurance + secondary payer, secondary member ID, secondary relationship. Save. | COB fields visible on patient detail "Secondary Insurance" tab. |
| 2-A-04 | With plan product + delegated entity | Select a plan product and delegated entity from dropdowns. Save. | Selections persist on detail page. |

### 2-B. Create Patient (Edge & Error Cases)

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 2-B-01 | Missing first name | Leave First Name blank. Click Save. | Toast error: required. No patient created. |
| 2-B-02 | Missing last name | Leave Last Name blank. | Toast error. |
| 2-B-03 | Missing DOB | Leave DOB blank. | Toast error. |
| 2-B-04 | Invalid referring provider NPI | Enter a 9-digit or malformed NPI. Click Save. | Inline "Invalid NPI" error. API returns 400. |
| 2-B-05 | Payer dropdown only shows enrolled payers | Open insurance carrier dropdown. | List shows only payers with active practice enrollments. If no enrollments exist, shows all active payers as fallback. |
| 2-B-06 | Referral partner fields appear conditionally | Set referral source to "Referral partner". | Referral partner name field appears. Set to anything else — field disappears. |

### 2-C. Patient Detail — View & Edit

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 2-C-01 | Tabs are all present | Open any patient. | Demographics, Insurance, Referral & Provider, Secondary Insurance (COB), Claims tabs all visible and clickable. |
| 2-C-02 | Edit and save demographics | Change phone number. Click Save. Reload page. | New phone number persisted. |
| 2-C-03 | Edit and save insurance | Change member ID. Click Save. Reload. | New member ID persisted. |
| 2-C-04 | Invalid NPI edit blocked | Change referring provider NPI to invalid. Click Save. | Blocked client-side with "Invalid NPI" message. |
| 2-C-05 | Claims tab shows patient's claims | Navigate to Claims tab. | List of claims belonging to this patient shown. Each links to claim detail. |
| 2-C-06 | Archive patient | Click Archive (three-dot menu or archive button). Confirm. | Patient no longer appears in active patient list. Shows in `/billing/patients/archived`. |

### 2-D. Eligibility / VOB Check

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 2-D-01 | Live Stedi check — happy path | Open a patient with full demographics (first name, last name, DOB, member ID, payer with EDI payer ID set). Click "Check Eligibility". | Result panel shows coverage status, copay, deductible, prior auth required flag. `vob_verified = true` on patient. |
| 2-D-02 | Missing member ID | Patient has no member ID. Click "Check Eligibility". | Error toast: "Patient has no member ID". No API call made (or 400 returned). |
| 2-D-03 | Missing practice NPI | Practice settings has no NPI. | Error: "Practice NPI not set in Settings". |
| 2-D-04 | Payer with no EDI payer ID | Payer record lacks `edi_payer_id`. Click "Check Eligibility". | Uses default `"00000"`. Stedi may return a payer-not-found error — verify toast shows meaningful message. |
| 2-D-05 | Manual VOB entry | Click "Manual VOB". Enter member ID and payer name. Save. | VOB record created with `verification_method = 'manual'`. Patient shows `vob_verified = true`. |
| 2-D-06 | Missing member ID in manual VOB | Submit manual VOB with no member ID. | Toast error: member ID required. |
| 2-D-07 | VOB history | After one or more checks, click "VOB History" tab. | All past verifications listed in descending order. Lead-linked verifications appear if `lead_id` matches. |

### 2-E. Patient List & Filters

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 2-E-01 | Search by name | Go to `/billing/patients`. Type partial last name in search. | List filters to matching patients. |
| 2-E-02 | Archived list | Go to `/billing/patients/archived`. | Shows only archived patients. Unarchive button present. |

---

## 3. Claim Creation Wizard

### 3-A. Step 0 — Patient Selection

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 3-A-01 | Select patient | Go to `/billing/claims/new`. Search and select a patient. | Patient card appears. "Next: Service Details" becomes clickable. |
| 3-A-02 | No patient selected | Click "Next: Service Details" without selecting a patient. | Button stays disabled. |
| 3-A-03 | HMO/POS plan — referral required | Select a patient with HMO or POS plan type. | Referral panel appears. "Next" blocked until referral is selected OR "Acknowledge missing referral" is checked. |
| 3-A-04 | HMO/POS — acknowledge missing referral | Check "Acknowledge missing referral" checkbox. | "Next" becomes enabled. Referral dropdown no longer blocks. |
| 3-A-05 | HMO/POS — select existing referral | Pick an active PCP referral from the dropdown. | "Next" enabled. Referral ID carried into claim. |
| 3-A-06 | Resume draft claim | Navigate to `/billing/claims/new?claimId=<existing-draft-id>`. | Wizard pre-fills with existing draft data. Patient, provider, service lines all restored. |

### 3-B. Step 1 — Service Details (Hard Validation)

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 3-B-01 | Missing rendering provider | Leave provider dropdown blank. Click "Next: Review". | Inline error: "Provider is required". |
| 3-B-02 | Missing service date | Leave service date blank. | Inline error: "Service date is required". |
| 3-B-03 | No service lines with code | No CPT/HCPCS code entered. | Inline error: "At least one service line with a code is required". |
| 3-B-04 | Service line units = 0 | Enter a code but leave units at 0 or blank. | Inline error per line: units must be > 0. |
| 3-B-05 | Missing ICD-10 primary | Leave diagnosis field blank. | Inline error: "Primary diagnosis required". |
| 3-B-06 | Happy path — all fields filled | Fill provider, service date, at least one service line with code/units/charge, ICD-10. Click "Next". | Wizard saves draft, runs validation, moves to Review step. |

### 3-C. Step 1 — Advisory Warnings

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 3-C-01 | Missing patient demographics | Patient has no DOB set. Proceed to step 1. | Warning: "Patient DOB missing". |
| 3-C-02 | Missing member ID | Patient has no member ID. | Warning: member ID required for electronic claims. |
| 3-C-03 | Provider NPI fails Luhn check | Provider record has a malformed NPI. | Warning: "NPI appears invalid". |
| 3-C-04 | VA payer — auth number required | Payer is a VA payer. Authorization number blank. | Hard **error** (not just warning). Submit blocked. |
| 3-C-05 | Non-VA payer — auth number blank when required | Payer requires prior auth, no auth number entered. | Warning (not hard block). User can acknowledge and proceed. |
| 3-C-06 | Acknowledge warnings | Warnings present. Check "I acknowledge these warnings". | Submit button becomes available. |
| 3-C-07 | CCI hard blocker | Service lines have a CCI PTP conflict with `modifier_indicator = "0"`. | Submit disabled with CCI conflict notice. Cannot override. |
| 3-C-08 | Charge overridden warning | Manually override the total charge on a line. | Warning shown on review. Does not hard-block. |
| 3-C-09 | Time-based units > 32 | Enter units > 32 on a 15-minute interval code. | Warning: unusual number of units. |

### 3-D. Step 1 — Additional Fields

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 3-D-01 | Claim frequency code "7" (replacement) | Select frequency code "7 – Replacement". | ICN/TCN field appears and is labelled as required. |
| 3-D-02 | Delay reason | Select a delay reason code. | Stored in draft. Visible in review summary. |
| 3-D-03 | External ordering provider | Set ordering provider to "External". | External first name, last name, NPI, org fields appear. |
| 3-D-04 | Homebound indicator | Toggle homebound indicator. | Value persists in draft payload. |
| 3-D-05 | Multiple service lines | Add a second service line with a different CPT and dates. | Both lines appear in review summary. |

### 3-E. Step 2 — Review & Risk Panel

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 3-E-01 | Risk panel shows | Advance to Review. | Risk score (GREEN / YELLOW / RED) panel visible. |
| 3-E-02 | GREEN readiness | All validations pass. | Green badge. No blocking errors. Submit button enabled. |
| 3-E-03 | RED readiness | Missing key fields (member ID, auth, etc.). | Red badge. `validationErrors` list shows. Submit disabled. |
| 3-E-04 | YELLOW readiness with acknowledged warnings | Warnings present, acknowledged. | Yellow badge. Submit enabled. |
| 3-E-05 | Patient summary shown | Review step shows patient name, DOB, payer, member ID. | Matches what was entered. |
| 3-E-06 | Service lines summary shown | Service dates, codes, charges in summary. | All service lines from step 1 present. |
| 3-E-07 | PDF / download actions available at Review | Click the "Download" dropdown. | Claim summary PDF option visible. EDI 837P option hidden if still draft. |

### 3-F. Stedi Submission Path

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 3-F-01 | Environment badge — TEST mode | Dev environment. Reach Review step. | Blue badge: "TEST — ISA15=T — No payer forwarding". |
| 3-F-02 | Environment badge — LIVE mode | Production environment with Stedi key, non-FRCPB payer. | Red pulsing badge: "LIVE — ISA15=P — Payer receives claim". |
| 3-F-03 | FRCPB payer locks test mode | Select FRCPB as payer. | Badge says "FRCPB is Stedi's E2E test payer. Test mode locked." Checkbox disabled. |
| 3-F-04 | Test-mode override in production | Production env, non-FRCPB. Check "Submit as test (ISA15=T)" box. | Badge switches to TEST. No confirmation dialog on submit. |
| 3-F-05 | Free test validation ("Test First — Free") | Click "Test This Claim First — Free". | Stedi validates EDI. Result modal shows pass/fail. `last_test_status` saved on claim. |
| 3-F-06 | Test validation — already passed | Test passed. | "Test This Claim First" button disabled. |
| 3-F-07 | Submit in test mode | TEST environment. Click "Submit Claim". | Claim submitted to Stedi with ISA15=T. Toast shows transaction ID. Claim status → submitted. |
| 3-F-08 | Submit in live mode — confirmation dialog | LIVE environment. Click "Submit Claim". | Confirmation dialog appears with ISA15=P warning. |
| 3-F-09 | Live submit — type CONFIRM | In dialog, type "CONFIRM". Click Submit. | Claim submitted. Payer receives claim. Toast with transaction ID. |
| 3-F-10 | Live submit — wrong confirmation text | Type something other than "CONFIRM". | Submit button in dialog stays disabled. |
| 3-F-11 | EDI payer routing banner | Claim has a matched payer. | Banner shows payer EDI routing info (green for FRCPB, red for live, amber for test). |

### 3-G. Office Ally Submission Path

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 3-G-01 | OA configured — submit | OA is connected in Settings. Stedi is NOT configured. Reach Review. Click "Submit via Office Ally". | Loading spinner. On success: toast "Claim submitted via Office Ally". Redirect to claim detail. |
| 3-G-02 | Neither Stedi nor OA configured | Both clearinghouses absent. Click "Submit via Office Ally". | Dialog: "No Clearinghouse Configured". "Go to Settings" button navigates to settings/clearinghouse. "Cancel" closes modal. |
| 3-G-03 | OA submit with validation errors | `validationErrors` still present. | "Submit via Office Ally" button disabled. Cannot submit. |

---

## 4. Claim Detail Page

### 4-A. General Display

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 4-A-01 | Header fields | Open a submitted claim. | Patient name, claim ID, payer, amount, status badge, created date all visible. |
| 4-A-02 | Status badge color | Check status badge for each status. | draft=gray, created=blue, ready=emerald, submitted=gray, acknowledged=blue, pending=yellow, returned=amber, denied=red, rejected=red, appealed=purple, paid=green, void=muted, exported=indigo. |
| 4-A-03 | Timeline / events | Scroll to claim events section. | Events in chronological order (Created, Submitted, Acknowledged, etc.). |
| 4-A-04 | Risk score panel | Panel shows score and readiness. | GREEN / YELLOW / RED color matches rules engine output. |
| 4-A-05 | Activity log | Scroll to activity log section. | Actions performed by users (created, submitted, downloaded, etc.) listed with timestamp. |

### 4-B. PDF & Download Dropdown (Context-Sensitive)

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 4-B-01 | Draft claim — EDI 837P hidden | Open a draft claim. Open download dropdown. | "Download 837P EDI" option is **absent**. |
| 4-B-02 | Submitted claim — EDI 837P visible | Open a submitted claim. | "Download 837P EDI" option present and clickable. |
| 4-B-03 | Draft claim — timely filing hidden | Draft status. | "Proof of timely filing letter" option **absent**. |
| 4-B-04 | Submitted/denied/paid claim — timely filing visible | Status is submitted, denied, or paid. | "Proof of timely filing letter" visible. Click → PDF downloads. |
| 4-B-05 | Draft/submitted claim — appeal letter hidden | Status is not denied or appealed. | "Appeal letter" option **absent**. |
| 4-B-06 | Denied claim — appeal letter visible | Status = denied. | "Appeal letter" option present. Click → PDF downloads. |
| 4-B-07 | Appealed claim — appeal letter visible | Status = appealed. | "Appeal letter" present. |
| 4-B-08 | Claim summary PDF — always visible | Any status. | "Claim summary" option always present. Click → PDF downloads. |
| 4-B-09 | CMS-1500 form | Click "Generate CMS-1500". | CMS-1500 PDF generated in browser and downloads. |

### 4-C. Submit Claim Button (from Detail Page)

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 4-C-01 | Stedi configured, claim is ready | Claim status is draft/created/ready. Stedi configured. | "Submit Claim" button visible. Click → `POST /api/billing/claims/:id/submit-stedi`. Toast with transaction ID. |
| 4-C-02 | Stedi NOT configured | Stedi not set up. | "Submit Claim" button either hidden or shows Office Ally path. |
| 4-C-03 | Already submitted | Claim status = submitted. | Submit button hidden or disabled. |
| 4-C-04 | Submit error | Stedi returns a validation error. | Toast with error detail. Claim status NOT changed. |

### 4-D. 277CA Acknowledgment Check

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 4-D-01 | Check for 277 | Claim is submitted via Stedi. Click "Check Acknowledgment". | Polls Stedi for 277CA. If found: status updated, event logged, toast shows acknowledgment result. |
| 4-D-02 | No acknowledgment yet | 277 not yet returned by payer. | Toast: "No acknowledgment yet". |
| 4-D-03 | Button hidden unless Stedi + submitted + stedi method | Claim submitted via OA or claim is draft. | "Check Acknowledgment" button not visible. |

### 4-E. Denial Recovery Panel

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 4-E-01 | Panel visible on denied claim | Open a claim with status = denied. | Orange "Denial Recovery Agent" card appears below claim detail. |
| 4-E-02 | Denial code shown | Claim has denial reason from ERA or claim events. | Primary CARC code displayed. |
| 4-E-03 | Root cause + recommended action | Known CARC code mapped in CARC_MAP. | Root cause description + action guidance shown. |
| 4-E-04 | Unknown code fallback | Denial reason is an unknown CARC. | Default message: "Payer-specific denial reason" + "Contact payer" guidance. |
| 4-E-05 | ERA payment history | ERA line exists for this claim. | Up to 3 ERA payment lines shown with check number, paid amount, billed amount. |
| 4-E-06 | "Fix This Claim" button | CARC code has a `fixField` mapped. | "Fix This Claim" button visible. Click → wizard opens at `/billing/claims/new?claimId=...`. |
| 4-E-07 | "Review & Resubmit" button | Always shown on denied claim. | Click → navigates to wizard with claim pre-loaded for editing and resubmission. |
| 4-E-08 | Panel hidden on non-denied claim | Claim is paid or submitted. | Denial Recovery panel not shown. |
| 4-E-09 | No denial data | Claim is denied but no ERA/denial records exist yet. | Panel shows "Unknown" code with default action guidance. No crash. |

### 4-F. Stedi EDI Validation Panel

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 4-F-01 | EDI validation summary | Open a submitted claim. | EDI validation card shows pass/fail status and any warnings from last Stedi test run. |
| 4-F-02 | No test run yet | Draft claim never tested. | Validation card either hidden or shows "Not yet validated". |

---

## 5. Claim Tracker

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 5-01 | All claims listed | Go to `/billing/claim-tracker`. | Table shows all non-archived claims. |
| 5-02 | Status badge colors | Inspect badges for a mix of statuses. | Every status maps to correct color (see section 4-A-02 above). No badge falls back to gray when it shouldn't. |
| 5-03 | Filter by status | Use the status filter dropdown. | Table filters to selected status. |
| 5-04 | Filter by payer | Use the payer filter. | Only claims from that payer shown. |
| 5-05 | Search by patient name | Type in search box. | Live filter on patient name. |
| 5-06 | Validation badge | Claim with last_test_status = "pass". | Green badge shown on that row. |
| 5-07 | Validation badge — fail | Claim with test errors. | Red badge with error count shown. |
| 5-08 | Click row → claim detail | Click any row. | Navigates to `/billing/claims/:id`. |
| 5-09 | Timely filing indicator | Claim with days_remaining < 7. | Urgency badge shown (critical/urgent/caution color). |
| 5-10 | Sort by date | Click column header for service date or created date. | Rows re-sort. |

---

## 6. ERA (835) Posting

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 6-01 | Upload ERA file | Go to `/billing/era`. Click "Upload ERA". Select a valid `.835` file. | Preview parsed claim lines. Confirm upload. Toast: "N claim lines parsed and queued for review". |
| 6-02 | Upload non-ERA file | Select a `.pdf` or invalid file. | Error message. No ERA created. |
| 6-03 | View unposted ERA | Click an ERA in the list with status "unposted". | Claim lines table shown. "Post This ERA", "Review Manually", "Skip" buttons visible. |
| 6-04 | Post ERA — happy path | Unposted ERA. Click "Post This ERA". Confirm in dialog. | ERA status → posted. Matched claims updated (status/paid amount). Claim event logged. |
| 6-05 | Post ERA — unmatched claim | ERA line has no matching claim ID. | ERA line still marked posted but no claim updated. No crash. |
| 6-06 | Post ERA — auto-writeoff | CARC code maps to `auto_writeoff` and no denial or payment mismatch. | Claim updated accordingly. |
| 6-07 | Post ERA — denial triggers review | ERA line shows `paid_amount = 0` and non-contractual CARC. | Dominant action = `flag_appeal` or `flag_review`. Claim status updated to denied/review. |
| 6-08 | "Review Manually" | Click "Review Manually" on an unposted ERA. | ERA status → review. Action buttons disappear. |
| 6-09 | "Skip" | Click "Skip". | ERA status → skipped. Removed from unposted list. |
| 6-10 | Already-posted ERA | Click a posted ERA. | Action buttons (Post, Review, Skip) not shown. |
| 6-11 | ERA detail — service lines expand | Click expand icon on an ERA line. | Individual service line details shown (procedure code, billed, allowed, paid, CARC codes). |

---

## 7. Filing Alerts (Timely Filing)

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 7-01 | Page loads with alerts | Go to `/billing/filing-alerts`. | Alerts grouped by severity: Critical, Urgent, Caution, Expired. |
| 7-02 | Sidebar badge count | Check billing sidebar. | Badge on "Filing Alerts" shows count of unacknowledged alerts. |
| 7-03 | No snoozed alerts shown | A previously snoozed alert (snoozed_until in future). | Alert not visible in list. |
| 7-04 | Snooze alert 7 days | Click "Snooze 7d" on any alert. | Alert disappears from list. Reappears after snooze period. |
| 7-05 | Acknowledge alert | Click "Acknowledge" on any alert. | Alert permanently removed from unacknowledged list. |
| 7-06 | "Take Action" links to claim | Click "Take Action" on an alert. | Navigates to `/billing/claims/:id`. |
| 7-07 | Filter by severity | Click "Critical" filter tab. | Only critical alerts shown. |
| 7-08 | Filter by payer | Use payer filter dropdown. | Alerts filtered to selected payer. |
| 7-09 | Expired alerts show overdue | An alert with `days_remaining <= 0`. | Shows "X days overdue" instead of "X days remaining". Red styling. |
| 7-10 | Archived claim not shown | Claim attached to alert is archived. | Alert does not appear in list (backend filter: `archived_at IS NULL`). |
| 7-11 | Auto-refresh | Wait 60 seconds on the page. | Page re-fetches alerts automatically (refetchInterval = 60s). |

---

## 8. ERA Posting + Denial Workflow End-to-End

This is a combined integration test — run after sections 3, 4, 6 pass individually.

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 8-01 | Create claim → submit → ERA posts denial → denial panel shows | Create claim, submit via Stedi/OA. Upload ERA with a denial CARC for that claim. Post ERA. Open claim detail. | Claim status = denied. Denial Recovery panel visible with correct CARC code and guidance. |
| 8-02 | Resubmit denied claim | From denial panel, click "Review & Resubmit". | Wizard opens with claim data pre-loaded. Edit, save, re-run validation, submit. |
| 8-03 | Resubmitted claim appears in tracker | After resubmission, go to claim tracker. | Claim status updated (submitted or appealed). |

---

## 9. Prior Authorization

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 9-01 | PA workspace loads | Go to `/billing/claims/prior-auth`. | Page loads with list of claims requiring or having prior auth. |
| 9-02 | Auth number on claim | Patient has `authorization_number`. Claim detail page. | Auth number displayed in claim summary. |
| 9-03 | PA check in wizard — required | Payer rules require prior auth for the selected code. | Warning (or hard error for VA) in wizard review. |
| 9-04 | PA validity window | Auth number present but expired per validity days rule. | Warning shown in wizard. |

---

## 10. Intelligence & Rules Engine

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 10-01 | Intelligence page loads | Go to `/billing/intelligence`. | Page loads. No white screen or error. |
| 10-02 | Activity log | Go to `/billing/intelligence/logs`. | Activity events listed (claim created, submitted, etc.) with timestamp and user. |
| 10-03 | Compliance reports | Go to `/billing/intelligence/reports`. | Report data visible. |
| 10-04 | Rules page | Go to `/billing/rules`. | List of rules visible. |
| 10-05 | Rule detail / edit | Click a rule. | Rule detail shown. Edit fields available (if admin). Save persists. |
| 10-06 | HCPCS code lookup | Go to `/billing/codes`. Type a CPT/HCPCS code. | Matches shown with description. |
| 10-07 | Risk explanation on claim | On claim detail, click "Explain Risk Score". | Explainer modal or panel shows which rules fired and why. |

---

## 11. Follow-Up Queue

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 11-01 | Follow-up page loads | Go to `/billing/follow-up`. | Claims requiring follow-up listed. |
| 11-02 | Actions available | Click a follow-up item. | Links to claim detail. Action buttons relevant to claim stage (call payer, resubmit, etc.). |

---

## 12. Settings & Clearinghouse Configuration

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 12-01 | Billing settings page | Go to `/billing/settings`. | Practice name, NPI, billing location, address fields editable. |
| 12-02 | Save practice settings | Change a field. Click Save. Reload. | Change persisted. |
| 12-03 | Stedi status badge | On settings page or wizard, `/api/billing/stedi/status` reflects configured=true if Stedi key present. | "Stedi connected" badge visible. |
| 12-04 | Office Ally connect | Enter OA SFTP credentials. Save. | `oa_connected = true`. Wizard shows OA as submit path when Stedi is absent. |
| 12-05 | No clearinghouse — wizard modal | Neither Stedi nor OA configured. Open wizard → Review → click Submit. | "No Clearinghouse Configured" dialog with "Go to Settings" button. |
| 12-06 | User management | Go to `/billing/settings/users`. | List of users in the organization. Invite/role-change actions available. |

---

## 13. Claim Status Lifecycle — Full End-to-End

Walk a single claim through every expected status transition to verify nothing breaks.

| Status | How to get there | Verify |
|--------|-----------------|--------|
| `draft` | Create via wizard, don't complete. | Visible in claim list and tracker with gray badge. |
| `created` | Wizard saves draft after step 1. | Blue badge. |
| `ready` | Passes all validations. | Emerald badge. |
| `submitted` | Submit via Stedi or OA. | Gray badge. Transaction ID in events. |
| `acknowledged` | 277CA received from Stedi. | Blue badge. 277 event logged. |
| `pending` | Payer set to pending adjudication. | Yellow badge. |
| `denied` | ERA posted with denial CARC. | Red badge. Denial Recovery panel appears. |
| `appealed` | Claim resubmitted after denial. | Purple badge. Appeal letter PDF available. |
| `paid` | ERA posted with payment. | Green badge. Paid amount shown. |
| `rejected` | Hard Stedi rejection (not denial). | Red badge. |
| `returned` | Clearinghouse returns claim (format error). | Amber badge. |
| `void` | Claim voided. | Muted gray badge. |

---

## 14. Intake Module

### 14-A. Intake Dashboard

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 14-A-01 | Dashboard loads | Go to `/intake/dashboard`. | Pipeline cards for: new, attempting_contact, contacted, qualified, converted. |
| 14-A-02 | Pipeline counts | Cards show count per status. | Counts match actual leads in each status. |
| 14-A-03 | SLA breach badge | Leads with `sla_deadline_at < NOW()` in attempting_contact or contacted. | Red SLA breach badge on those pipeline cards. |
| 14-A-04 | Today's appointments | Appointments scheduled for today. | Listed in "Today's Appointments" section. |
| 14-A-05 | Recent chat sessions | Sessions exist. | Last 5 sessions shown with status + time. |
| 14-A-06 | Card click navigates | Click "Contacted" card. | Navigates to `/intake/deals?status=contacted`. |

### 14-B. Deals / Lead Pipeline

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 14-B-01 | Worklist loads | Go to `/intake/deals`. | Leads displayed in worklist or board view. |
| 14-B-02 | Queue tabs | Switch between queue tabs: SLA Breach, Not Contacted, Incomplete VOB, VOB Complete Needs Admissions, Follow Up Today. | Each tab filters to the correct set of leads. |
| 14-B-03 | VOB completeness bar | Lead with partial insurance info. | Progress bar shows VOB score. Tooltip lists missing fields. |
| 14-B-04 | Next Action badge | Lead with `nextActionType = "call"`. | "Call" badge shown. |
| 14-B-05 | "Add to Deals" action | Click "Add to Deals" on a new lead. | Lead status → contacted. Moves out of "Not Contacted" queue. |
| 14-B-06 | Open lead detail | Click a lead. | Navigates to `/intake/deals/:id`. Lead info, timeline, and action buttons visible. |

### 14-C. Lead Creation (Manual)

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 14-C-01 | Create lead | On deals page, click "New Lead" or equivalent. Fill required fields. Submit. | Lead created. Matching intake flows triggered automatically. |
| 14-C-02 | SLA computed from priority | Set priority to "urgent". Submit. | `sla_deadline_at` set to a near-term deadline. |
| 14-C-03 | Duplicate flow prevention | Same lead already has a running flow for a given flow config. | Triggering flows again does NOT create a second `flow_run` row for that flow. |

### 14-D. Intake Flows

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 14-D-01 | Flows list | Go to `/intake/flows`. | All configured intake sequences listed with status (active/inactive). |
| 14-D-02 | Flow detail | Click a flow. | Step list visible with type, delay, and description. |
| 14-D-03 | Flow step types visible | | Supported types appear in UI: call, sms, email, wait, vob_check, branch, human_task. |
| 14-D-04 | Active flow run visible | A lead has a running flow. | "Live Activity" section on flows list shows the active run with current step. |
| 14-D-05 | Flow run advances after SMS | SMS step completes (Twilio configured). | `current_step_index` increments. Next step scheduled per delay. |
| 14-D-06 | Flow run advances after call | Vapi call completes and webhook fires. | `flow_runs.status` advances. `next_action_at` updated to next step. |
| 14-D-07 | Missing Twilio config | Twilio not configured. SMS step reached. | Step skipped or marked failed gracefully. Flow does not crash. |
| 14-D-08 | Missing Vapi config | Vapi not configured. Call step reached. | Step skipped gracefully. No crash. |
| 14-D-09 | Retry with backoff | Step fails on first attempt. | Rescheduled +5 min (2nd attempt), +15 min (3rd+). |
| 14-D-10 | Max retry → flow fails | All retry attempts exhausted. | `flow_runs.status = 'failed'`. |

### 14-E. AI Calling (Vapi)

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 14-E-01 | Outbound call from deal detail | Open a deal. Click "Start AI Call" (or equivalent). | Vapi call initiated. In-page call UI connects. |
| 14-E-02 | Transcript captured | Call completes. | Final transcript stored. Lead data fields updated from extracted transcript (carrier, member ID, DOB, etc.). |
| 14-E-03 | Call status polling | During active call, check call status. | `GET /api/vapi/call-status/:vapiCallId` returns in_progress → then completed. |
| 14-E-04 | Call end webhook fires | Vapi sends end-of-call webhook. | `calls` row updated. If part of flow, `flow_runs` advances to next step. Lock released. |
| 14-E-05 | Webhook never fires | +4 hour timeout passes. | Orchestrator can re-fire the step or mark failed on next run cycle. |
| 14-E-06 | Concurrent call prevention | Orchestrator ticks twice while call is in-progress. | `acquireLock` prevents a second call being initiated for the same lead/step. |

### 14-F. VOB Check Step in Flow

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 14-F-01 | VOB check step with full data | Lead has carrier, member ID, DOB, first/last name. Stedi configured. `vob_check` step executes. | `leads.vob_score` and `leads.vob_status` updated. Activity log: `vob_completed`. |
| 14-F-02 | VOB check step with incomplete data | Lead missing member ID or DOB. | Step skipped. Flow advances as failure. No crash. |
| 14-F-03 | Stedi not configured | Stedi API key absent. | `isStediConfigured()` returns false. Step skipped gracefully. |

### 14-G. Lead Analytics

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 14-G-01 | Analytics page loads | Go to `/intake/lead-analytics`. | Page loads with stats cards and charts. |
| 14-G-02 | Session stats | Stats cards show: completed sessions, abandoned, active. | Numbers match backend analytics data. |
| 14-G-03 | Conversion chart | Time-series chart visible. | Chart renders without errors. Date filter controls work. |
| 14-G-04 | Call stats | Call stats section visible. | Call counts, connection rates shown. |

---

## 15. Admin Module (Super Admin Only)

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 15-01 | Admin overview | Log in as super_admin. Go to `/admin`. | Platform overview loads. Tenant count, claims count, etc. |
| 15-02 | Clinic list | Go to `/admin/clinics`. | All organizations listed. |
| 15-03 | Clinic detail | Click a clinic. | Org details, settings, user list visible. |
| 15-04 | Impersonation | Click "Impersonate" on a clinic. | Session scoped to that org. All billing data filtered to that tenant. |
| 15-05 | Impersonation exit | Click "Exit Impersonation". | Returns to super_admin scope. |
| 15-06 | Payer manuals | Go to `/admin/payer-manuals`. | List of 20 commercial payer manual sources visible. |
| 15-07 | Rules database | Go to `/admin/rules-database`. | Rules browser with filter/search. |
| 15-08 | Scraper management | Go to `/admin/scrapers`. | Scraper runs history, circuit state, schedule visible. |
| 15-09 | Data tools | Go to `/admin/data-tools`. | Data tooling page loads. |

---

## 16. Multi-Tenancy Isolation

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 16-01 | Org A cannot see Org B's patients | Log in as Org A user. Manually request `/api/billing/patients` in browser. | Returns only Org A patients. |
| 16-02 | Org A cannot see Org B's claims | Same approach for `/api/billing/claims`. | Only Org A claims returned. |
| 16-03 | Super admin impersonation switches org scope | Impersonate Org B. Navigate to patients. | See only Org B patients. |
| 16-04 | Impersonation exits cleanly | Exit impersonation. Navigate to patients. | Back to super_admin scope (all orgs or no org depending on super_admin handling). |

---

## 17. Corner Cases & Gotchas (Regression Checks)

| # | Test case | Steps | Expected |
|---|-----------|-------|----------|
| 17-01 | Claim with no ERA — denial panel shows "Unknown" | Denied claim with no ERA records. | Denial panel shows, code = "Unknown", default guidance. No crash. |
| 17-02 | ERA line with no claim ID | Upload ERA with a payer check number that matches no claim. | ERA posts. No claim updated. No crash. |
| 17-03 | VOB history when lead_id is null | Patient has no lead_id. Open VOB history. | VOB history shows patient-level checks only. No SQL error. |
| 17-04 | Payer EDI ID missing → default "00000" | Payer has no edi_payer_id. Run eligibility check. | Uses `"00000"`. Stedi may error — verify meaningful error toast, not crash. |
| 17-05 | Wizard for replacement claim (freq code 7) | Select freq code 7. Leave ICN blank. Attempt to submit. | ICN field highlighted as required. Submission blocked. |
| 17-06 | HMO patient — acknowledge missing referral then proceed | Acknowledge missing referral. Wizard proceeds. | Claim saved with referral_acknowledged flag. No crash at step 2. |
| 17-07 | Two tabs — submit same claim twice | Open claim detail in two browser tabs. Submit from one tab. Submit from the other immediately after. | Second submit either errors gracefully ("already submitted") or is idempotent. No duplicate Stedi calls. |
| 17-08 | Upload identical ERA twice | Upload the same 835 file a second time. | Second upload creates a new ERA batch in "unposted" state — or system de-duplicates. Either way: no crash. |
| 17-09 | Filing alert for archived claim | Archive a claim that had an open filing alert. | Alert no longer appears in filing alerts list. |
| 17-10 | Session expiry mid-workflow | Let session expire. Try to submit a claim. | Redirected to login. Session-protected API returns 401 (not 500). |
| 17-11 | Service line total charge = 0 | Enter units and rate but override total to 0. | Warning about zero charge shown. Submit not hard-blocked (warning only). |
| 17-12 | CCI modifier_indicator="0" — hard block | Claim has CCI hard block. | Submit button disabled. Warning card explains the conflict. |
| 17-13 | Empty denial CARC map match | CARC code is a number not in CARC_MAP (e.g., "999"). | Default fallback shown — "Payer-specific denial reason" + "Contact payer". |
| 17-14 | Snooze filing alert then alert reappears | Snooze a critical alert for 7 days. Manually advance time past snooze. | Alert reappears in the unacknowledged list. |
| 17-15 | Claim tracker — unknown status badge | A claim arrives with a status string not in STATUS_COLORS (e.g., a future new status). | Badge renders with draft gray fallback (no crash). |

---

## Pre-Demo Checklist Summary

Before the demo, verify each of the following is true:

- [ ] Can log in and switch between Billing and Intake modules without errors.
- [ ] Can create a patient with full demographics and verify eligibility live.
- [ ] Can create a claim from scratch through the 3-step wizard.
- [ ] EDI validation ("Test First — Free") runs and shows a result.
- [ ] Can submit a claim (Stedi test mode or OA based on environment).
- [ ] Claim detail shows correct status badge, events, and risk score.
- [ ] PDF dropdown shows only contextually relevant options per status.
- [ ] Denied claim shows Denial Recovery panel with real guidance.
- [ ] "Review & Resubmit" navigates to wizard with pre-loaded claim data.
- [ ] Claim tracker shows all statuses with the correct badge color.
- [ ] Can upload and post an ERA, and it updates the matching claim's status.
- [ ] Filing alerts list loads; can snooze and acknowledge alerts.
- [ ] Intake dashboard shows pipeline cards and today's appointments.
- [ ] Deals worklist shows queue tabs and VOB completeness scores.
- [ ] Intake flows list shows configured sequences and any active runs.
- [ ] Multi-tenant isolation: Org A user cannot see Org B data.
- [ ] All sidebar navigation links load without 404.
- [ ] Session expiry redirects to login without crashing.

---

*Document generated: May 2026 — update after any UI or routing change.*
