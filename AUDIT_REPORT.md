# Claim Shield Health — Full Codebase Audit Report
**Date:** May 1, 2026  
**Scope:** Billing module, Intake/Lead module, shared Patient database, multi-tenant isolation, data integrity, structural/logical issues  
**Status:** Pre-coding analysis only — no changes made

---

## Severity Legend
- 🔴 **CRITICAL** — Active security vulnerability; data from one tenant can be accessed or mutated by another
- 🟠 **HIGH** — Logical flaw causing incorrect behavior; data integrity risk
- 🟡 **MEDIUM** — Missing guard or inconsistent pattern; low exploitation likelihood but real risk
- 🟢 **LOW / STRUCTURAL** — Code quality, hardcoded values, unmaintainable patterns

---

## Section 1 — Multi-Tenant Isolation (Security)

### 🔴 CRIT-01 — Lead Sub-Resource Endpoints Miss `verifyOrg` on the Parent Lead

**Affected endpoints:**
| Route | Line(s) | Missing guard |
|---|---|---|
| `GET /api/leads/:id/calls` | 7991–7993 | No verifyOrg on lead before returning its calls |
| `GET /api/leads/:id/patient` | 7996–7999 | No verifyOrg on lead |
| `PATCH /api/leads/:id/patient` | 8002–8012 | No verifyOrg on lead |
| `POST /api/leads/:id/convert-to-patient` | 8130–8168 | No verifyOrg on lead |
| `GET /api/leads/:id/call-context` | 8219–8230 | No verifyOrg on lead |
| `POST /api/leads/:id/call` (trigger Vapi) | ~8310 | No verifyOrg on lead |
| `GET /api/leads/:id/claim-packet` | 8396–8410 | No verifyOrg on lead |
| `POST /api/leads/:id/sms` | 9169–9274 | No verifyOrg on lead |
| `POST /api/leads/:id/email` | 9563–9680 | No verifyOrg on lead |
| `POST /api/leads/:id/appointments` | 10186–10214 | No verifyOrg on lead |

**Impact:** An authenticated user from Org A can supply any lead UUID (guessable or obtained elsewhere) and read, write, or trigger actions against a lead belonging to Org B. Every sub-resource of a lead inherits this vulnerability — calls, patient records, AI calls, SMS, emails, and appointments.

**Root cause:** Each route calls `storage.getLead(req.params.id)` and only checks `if (!lead)`, not `if (!lead || !verifyOrg(lead, req))`.

**Fix pattern (apply to every route above):**
```ts
const lead = await storage.getLead(req.params.id);
if (!lead || !verifyOrg(lead, req)) return res.status(404).json({ error: "Lead not found" });
```

---

### 🔴 CRIT-02 — `convert-to-patient` Creates a Patient Record Without `organization_id`

**Location:** Line 8147–8154

The INSERT for the new patient row omits `organization_id`:
```sql
INSERT INTO patients (id, lead_id, first_name, last_name, dob, email, phone,
  insurance_carrier, member_id, plan_type, state, service_needed, referral_source, intake_completed)
SELECT gen_random_uuid()::text, $1, ...
```

**Impact:** The resulting patient has a NULL `organization_id`. That patient is invisible to the owning org (all list queries filter by org), yet billing claims and encounters will reference it. No tenant "owns" the record — it cannot be found, reported on, or deleted via normal org-scoped operations. Any claim created from this patient will be an orphaned cross-link.

**Fix:** Add `organization_id` to the INSERT column list and bind `getOrgId(req)` as a parameter.

---

### 🔴 CRIT-03 — `GET /api/billing/prior-auths` Returns All Orgs' Data

**Location:** Lines 4579–4595

```sql
SELECT pa.*, ...
FROM prior_authorizations pa
LEFT JOIN patients p ON pa.patient_id = p.id
LEFT JOIN claims c ON c.encounter_id = pa.encounter_id
ORDER BY pa.requested_date DESC
```

There is **no `WHERE organization_id = $1` clause**. Every org's billing team sees every other org's prior authorizations, including patient names, auth numbers, service types, and payer details.

**Fix:** Add `AND pa.organization_id = $1` with `requireOrgCtx(req, res)`.

---

### 🔴 CRIT-04 — `GET /api/billing/activity-logs` Has No Org Filter

**Location:** Lines 4598–4619

The query joins `activity_logs` with `users` but has no `organization_id` predicate. Any admin from any org can read the complete global audit trail — who viewed what claim, who exported what, and when.

**Fix:** Add `AND al.organization_id = $1` using `requireOrgCtx`.

---

### 🔴 CRIT-05 — `GET /api/billing/compliance-report/:type` Has No Org Filter

**Location:** Lines 4622–4648

All four report variants (`access`, `edit-history`, `export`, `claims-integrity`) query `activity_logs` and `claims` with only a date range — no `organization_id` predicate. A compliance auditor at Org A can read Org B's full HIPAA access logs and claim history.

**Fix:** Pass `requireOrgCtx` into each query variant as an additional WHERE predicate.

---

### 🔴 CRIT-06 — `GET /api/prior-auth/encounter/:encounterId` and `/patient/:patientId` Have No Org Guard

**Location:** Lines 9108–9116

```ts
app.get("/api/prior-auth/encounter/:encounterId", requireRole("admin", "rcm_manager"), async (req, res) => {
  const auths = await storage.getPriorAuthsByEncounterId(req.params.encounterId);
  res.json(auths);  // ← no verifyOrg on anything returned
```

The storage methods fetch by encounter/patient ID with no org filter. Any rcm_manager can query any patient's or encounter's prior authorizations by UUID.

**Fix:** Verify the parent encounter or patient belongs to the caller's org before returning data.

---

### 🔴 CRIT-07 — `POST /api/billing/claims/draft` Fetches Patient Without an Org Check

**Location:** Line 4746

```ts
const patient = await db.query("SELECT * FROM patients WHERE id = $1", [patientId]);
```

No `AND organization_id = $1`. A billing user can create a draft claim referencing a patient from a completely different organization. The resulting claim is stamped with the *caller's* org_id while the patient belongs to another — cross-linking two tenants' clinical data.

**Fix:** Add `AND organization_id = $1` using `requireOrgCtx`.

---

### 🟠 HIGH-01 — `GET /api/billing/eras` Uses an Optional Org Filter Instead of Enforcing One

**Location:** Lines 3893–3897

```ts
if (orgId) { query += ` AND eb.org_id = $${idx}`; params.push(orgId); idx++; }
```

A super_admin who is not currently impersonating an org gets `getOrgId(req)` = `null`. When `orgId` is null, the `if` is skipped and the query returns **every ERA batch from every organization**. This is the old un-hardened pattern that has been corrected in other endpoints with `requireOrgCtx`.

**Fix:** Replace with `requireOrgCtx(req, res)` and return 400 if no org context is set.

---

### 🟠 HIGH-02 — `GET /api/billing/claims/wizard-data` Returns Global Providers and Payers

**Location:** Lines 4724–4730

```ts
db.query("SELECT ... FROM providers WHERE is_active = true ORDER BY last_name"),
db.query("SELECT ... FROM payers ORDER BY name"),
```

Neither query filters by `organization_id`. The claim creation wizard populates its provider and payer dropdowns from the full global tables — a biller at Org A sees Org B's contracted providers and payers when building a claim.

**Note:** Both `providers` and `payers` tables have `organization_id` columns (confirmed in schema migrations). The read path simply never uses them.

**Fix:** Add `WHERE is_active = true AND organization_id = $1` to both queries.

---

### 🟠 HIGH-03 — `storage.getPatientByLeadId()` Has No Org Filter at the Storage Layer

**Location:** `server/storage.ts` — `getPatientByLeadId(leadId)` method

The function fetches a patient solely by `lead_id` with no `organization_id` parameter. This means the storage layer itself is unguarded — protection depends entirely on the calling route having already validated lead ownership. Any future route that calls this method without the CRIT-01 fix in place will silently return cross-org patient data.

**Fix:** Add `organizationId` as a second parameter and include it in the WHERE clause.

---

## Section 2 — Data Integrity Issues

### 🟠 HIGH-04 — Patient Created from Lead Has a Blank DOB (`""`)

**Location:** Line 8152

```ts
[lead.id, firstName, lastName, "", lead.email || null, ...]
//                              ^^
```

The `dob` field is hardcoded to an empty string `""` for every patient created via `convert-to-patient`. This causes downstream failures:
- The EDI 837P generator requires DOB in a specific date format for the NM1 loop — an empty string will produce a malformed claim file.
- The claim wizard reads DOB for eligibility pre-checks — an empty DOB will produce incorrect results.
- The patients table will accumulate records with blank DOBs that are invisible until a claim is attempted.

**Fix:** Map `lead.dob` (if the field exists on the lead) to the insert, or leave it NULL rather than `""`.

---

### 🟠 HIGH-05 — `encounters` Created by Claim Draft Wizard Has No `organization_id`

**Location:** Lines 4754–4757

```sql
INSERT INTO encounters (id, patient_id, service_type, facility_type, admission_type, expected_start_date, created_by, created_at)
VALUES ($1, $2, ...)
```

`organization_id` is absent. The `encounters` table has both an `organization_id` column and an index on it. This encounter will be invisible to org-scoped encounter queries and will surface in the unguarded prior-auth by encounter endpoint (CRIT-06) for any org.

**Fix:** Add `organization_id` to the INSERT and bind `getOrgId(req)`.

---

### 🟠 HIGH-06 — `claim_events` INSERT in Claim Draft Wizard Has No `organization_id`

**Location:** Lines 4766–4769

```sql
INSERT INTO claim_events (id, claim_id, type, timestamp, notes)
VALUES ($1, $2, 'Created', $3, 'Claim created via wizard')
```

Every other claim event INSERT in the codebase (lines 3874, 4017, 6177, 13169) includes `organization_id`. This single omission means wizard-created claim events are excluded from any org-scoped audit log or compliance query.

---

### 🟠 HIGH-07 — `activity_logs` INSERT in Claim Draft Wizard Has No `organization_id`

**Location:** Lines 4772–4774

```sql
INSERT INTO activity_logs (id, claim_id, patient_id, activity_type, description, performed_by)
VALUES ($1, $2, $3, $4, $5, $6)
```

Same omission pattern as HIGH-06. These activity records will be excluded from the org-scoped activity log query (CRIT-04 fix will expose this further). The compliance reports (CRIT-05) will also never see them.

---

### 🟡 MED-03 — `avgArDays` Is Hardcoded to `34` in Dashboard Metrics

**Location:** `server/storage.ts` — `getDashboardMetrics()` method

The "Average A/R Days" KPI displayed on the executive dashboard is a hardcoded constant `34`. It has nothing to do with actual claim ages. Finance teams relying on this metric for cash flow analysis are working with fabricated data.

**Fix:** Calculate the real value: average of `(NOW() - service_date)` for open claims filtered by org, excluding drafts and archived claims.

---

### 🟡 MED-04 — `getTopPatterns` Uses `Math.random()` for the `change` Trend Field

**Location:** `server/storage.ts` — `getTopPatterns()` method

The denial pattern trend indicator (e.g., "+12% from last period") is generated using `Math.random()`. This fabricated value appears as a real metric in the Denial Analysis UI. Every page refresh shows a different percentage.

**Fix:** Calculate `change` by comparing the denial count in the current period against the equivalent prior period using a real SQL query.

---

### 🟡 MED-05 — ERA Line Posting Can Cross-Link Payments to Claims from a Different Org

**Location:** Lines 3960–3979 (PATCH `/api/billing/eras/:id` — post action)

When an ERA is posted, each line is linked to a claim by the `claim_id` stored on the era line. There is no validation that `line.claim_id` belongs to the same org as the ERA batch. A manually created or malformed ERA batch could post payment events against claims owned by a different organization.

**Fix:** During the posting loop, verify `claims.organization_id = era_batches.org_id` before updating claim status.

---

## Section 3 — Logical / Behavioral Issues

### 🟠 HIGH-08 — Dashboard Alerts Uses an N+1 Query and Has an Incorrect Description

**Location:** Lines 7585–7623

```ts
const claims = await storage.getClaims(orgId);      // fetches up to 200 claims
for (const claim of claims.slice(0, 5)) {
  const claimEvents = await storage.getClaimEvents(claim.id);  // 1 query per claim
```

200 claims are fetched to use 5 of them. Then `getClaimEvents` is called in a serial loop — 6 sequential round-trips total per dashboard load. Additionally, the alert description for every RED-readiness claim says "requires prior authorization" regardless of the actual reason the claim is RED.

**Fix:** Replace with a single JOIN query that fetches the needed claims with their first `Pending` event in one round-trip, and derive the alert message from `last_test_errors` rather than hardcoding the prior auth reason.

---

### 🟡 MED-01 — `GET /api/availability/slots` Has No Authentication

**Location:** Line 10264

```ts
app.get("/api/availability/slots", async (req, res) => {
```

No `requireRole(...)` and no session check. Any unauthenticated user can query the org's appointment availability calendar, revealing scheduling patterns and operational hours.

**Fix:** Add `requireRole("admin", "intake")` and scope results by `requireOrgCtx`.

---

### 🟡 MED-02 — Chat Session Init Is Public and the Returning-Lead Email Contains a Dev URL

**Location:** Lines 10405–10526 and Line 10485

The `/api/chat-sessions/init` endpoint is intentionally public for the website widget, which is correct. However, the returning-lead notification email builds the "View Conversation" button URL as:

```ts
`https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:5000'
```

In production, this link in the notification email will either be the Replit dev domain or `localhost` — both are wrong for a deployed environment. Staff will receive broken links in every returning-lead alert.

**Fix:** Use a `PUBLIC_URL` environment variable, or read the configured domain from `practice_settings`.

---

### 🟡 MED-06 — `facility_name` Is Hardcoded to `"Claim Shield Health"` in All Outbound Emails

**Location:** Line 9621

```ts
facility_name: "Claim Shield Health",
```

This string is substituted into every outbound email — welcome, insurance verification, appointment confirmation, documents request, and re-engagement templates. In a multi-tenant deployment, each organization has its own name. Every tenant's patients receive emails signed from "Claim Shield Health" rather than the actual facility.

**Fix:** Read `facility_name` from `practice_settings.practice_name` for the caller's org.

---

### 🟡 MED-07 — Appointment Confirmation Email Has Unresolved Template Variables

**Location:** Lines 9514–9527

The `appointment_confirmation` preset email template uses `{{appointment_date}}` and `{{appointment_time}}` in both subject and body. The variable substitution map at lines 9617–9624 does not define those keys. They will appear verbatim as `{{appointment_date}}` and `{{appointment_time}}` in every sent appointment email.

**Fix:** Add `appointment_date` and `appointment_time` to the variable substitution map, populated from the appointment record.

---

### 🟢 LOW-01 — `organizations` Table Has No `updated_at` Column

**Location:** `shared/schema.ts` — `organizations` table definition

The table has `created_at` and `onboarding_dismissed_at` but no `updated_at`. Any change to an org's name, plan, or settings leaves no timestamp trace. This makes it impossible to audit when an org's configuration last changed or to detect unauthorized modifications.

---

### 🟢 LOW-02 — Providers and Payers Are Seeded With `organization_id` but Queried Without It

**Location:** Schema migrations vs. Lines 4724–4730

Seed scripts correctly insert providers and payers with `organization_id`. The wizard-data read path ignores that column entirely. This is a design inconsistency — the schema is multi-tenant-aware but the query is not.

---

### 🟢 LOW-03 — `mark-fixed` Bypasses the Claim State Machine

**Location:** Lines 3871–3882

The mark-fixed action sets status to `'submitted'` unconditionally on resubmit, regardless of the prior status. A claim in `'draft'` state (which has never passed pre-submission readiness checks) can be resubmitted directly, skipping all risk scoring and GREEN/YELLOW/RED validation.

**Fix:** Validate that the claim's current status is `'denied'` or `'error'` before allowing resubmission.

---

### 🟢 LOW-04 — SMS Records Are Stored in the `calls` Table

**Location:** Lines 9234–9245

Outbound SMS messages are stored in the `calls` table with `vapiCallId = 'sms_' + twilioMessage.sid`. This conflates two different communication channels. Call analytics, the call history UI, Vapi webhook handlers, and duration metrics all operate on this table. Any query filtering by `vapiCallId IS NOT NULL` will inadvertently include SMS records. Call duration averages will be skewed by SMS records with `duration = 0`.

**Fix:** Create a dedicated `sms_messages` table, or add a `channel` discriminator column to `calls` and filter all Vapi-specific queries to `WHERE channel = 'vapi'`.

---

### 🟢 LOW-05 — Post-VOB Insert Re-Fetch Can Silently Return `undefined`

**Location:** Line 7571

```ts
const { rows } = await db.query("SELECT * FROM vob_verifications WHERE id = $1", [vobId]);
res.json(rows[0]);
```

If the immediately-preceding INSERT somehow fails silently or races, `rows[0]` is `undefined` and `res.json(undefined)` sends an empty response body with a 200 status. The client receives no data and no error signal.

**Fix:** Check `if (!rows[0]) return res.status(500).json({ error: "VOB save failed" })`.

---

## Section 4 — Summary Table

| ID | Severity | Area | Title |
|---|---|---|---|
| CRIT-01 | 🔴 CRITICAL | Intake | 10 lead sub-resource endpoints missing `verifyOrg` |
| CRIT-02 | 🔴 CRITICAL | Intake → Billing | `convert-to-patient` creates patient without `organization_id` |
| CRIT-03 | 🔴 CRITICAL | Billing | `GET /billing/prior-auths` returns all orgs' data |
| CRIT-04 | 🔴 CRITICAL | Billing | Activity logs endpoint has no org filter |
| CRIT-05 | 🔴 CRITICAL | Billing | Compliance reports have no org filter |
| CRIT-06 | 🔴 CRITICAL | Billing | Prior-auth by encounter/patient has no org guard |
| CRIT-07 | 🔴 CRITICAL | Billing | Claim draft fetches patient without org check |
| HIGH-01 | 🟠 HIGH | Billing | ERAs list uses optional org filter (super_admin sees all) |
| HIGH-02 | 🟠 HIGH | Billing | Wizard-data returns global providers and payers |
| HIGH-03 | 🟠 HIGH | Shared | `getPatientByLeadId` unguarded at storage layer |
| HIGH-04 | 🟠 HIGH | Intake | Converted patient always gets blank DOB |
| HIGH-05 | 🟠 HIGH | Billing | Encounter created without `organization_id` |
| HIGH-06 | 🟠 HIGH | Billing | `claim_events` in wizard created without `organization_id` |
| HIGH-07 | 🟠 HIGH | Billing | `activity_logs` in wizard created without `organization_id` |
| HIGH-08 | 🟠 HIGH | Billing | Dashboard alerts N+1 query; wrong alert copy |
| MED-01 | 🟡 MEDIUM | Intake | Availability slots endpoint has no authentication |
| MED-02 | 🟡 MEDIUM | Intake | Returning-lead email contains dev/localhost URL |
| MED-03 | 🟡 MEDIUM | Billing | A/R Days KPI is hardcoded to 34 |
| MED-04 | 🟡 MEDIUM | Billing | Denial pattern trend uses `Math.random()` |
| MED-05 | 🟡 MEDIUM | Billing | ERA posting can cross-link payments to wrong-org claims |
| MED-06 | 🟡 MEDIUM | Intake | `facility_name` hardcoded in all outbound emails |
| MED-07 | 🟡 MEDIUM | Intake | Appointment email template has two unresolved variables |
| LOW-01 | 🟢 LOW | Admin | `organizations` table has no `updated_at` |
| LOW-02 | 🟢 LOW | Billing | Providers/payers seeded with org_id but queried without it |
| LOW-03 | 🟢 LOW | Billing | `mark-fixed` bypasses claim state machine |
| LOW-04 | 🟢 LOW | Billing | Post-VOB insert re-fetch can silently return undefined |
| LOW-05 | 🟢 LOW | Intake | SMS messages stored in `calls` table with mixed semantics |

---

## Section 5 — Recommended Fix Order

**Immediate — before any production data is written:**
1. CRIT-01 — Add `verifyOrg` to all 10 lead sub-resource routes
2. CRIT-02 — Add `organization_id` to `convert-to-patient` patient INSERT
3. CRIT-03, CRIT-04, CRIT-05 — Add org filter to prior-auths list, activity-logs, and compliance reports
4. CRIT-06 — Guard prior-auth by encounter/patient with org verification
5. CRIT-07 — Add org check to patient fetch in claim draft wizard
6. HIGH-05, HIGH-06, HIGH-07 — Add `organization_id` to encounter/claim_events/activity_logs inserts in wizard

**Short-term — before multi-tenant onboarding:**
7. HIGH-01 — Replace optional ERA org filter with `requireOrgCtx`
8. HIGH-02 — Add org filter to wizard-data providers and payers queries
9. HIGH-04 — Fix blank DOB (use NULL or lead.dob) on patient conversion
10. HIGH-03 — Add org parameter to `getPatientByLeadId` in storage layer
11. MED-01 — Add auth to `/api/availability/slots`
12. MED-05 — Validate claim org during ERA line posting

**Before general availability:**
13. MED-06, MED-07, MED-08 — Fix email template variable and URL issues
14. MED-03 — Replace hardcoded A/R Days with a real SQL calculation
15. MED-04 — Replace `Math.random()` with real period-over-period denial comparison
16. HIGH-08 — Refactor dashboard alerts to a single JOIN query
17. LOW-01 through LOW-05 — Structural cleanup
