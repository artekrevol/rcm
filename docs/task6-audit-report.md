# Task 6 — Production Submission Audit Report
**Date:** 2026-04-28  
**Scope:** Claims submitted to Stedi production in the past 30 days

---

## Summary

This audit was performed to document the extent of claims submitted with ISA15='P' (real-payer forwarding) via Stedi, and to identify any phantom/demo-data submissions.

The confirmed incident is:
- **Claim:** democlaimva004 (Megan Perez, $240, TriWest/TWVACCN)  
- **Submitted by:** Task #24 automated agent (background agent, no human session)  
- **ISA15:** P (production — payer received the claim)  
- **Root cause:** ISA15 was hardcoded `'P'` in edi-generator.ts:108 with no environment awareness  
- **Secondary cause:** `submitClaim()` had a regex that silently upgraded ISA15 T→P, making test mode appear to work while actually forwarding to payers

---

## SQL Queries Run (Dev DB — Production DB Not Accessible from Sandbox)

The following queries were designed to run against PRODUCTION_READONLY_DATABASE_URL. They are recorded here for reference and should be run manually against the production database.

### Q1: All claims submitted to Stedi in the past 30 days

```sql
SELECT 
    c.id,
    c.organization_id,
    c.status,
    c.total_amount,
    c.submitted_at,
    c.stedi_transaction_id,
    c.submission_method,
    p.first_name || ' ' || p.last_name AS patient_name,
    p.member_id,
    pay.name AS payer_name,
    pay.payer_id
FROM claims c
LEFT JOIN patients p ON p.id = c.patient_id
LEFT JOIN payers pay ON pay.id = c.payer_id
WHERE 
    c.submission_method = 'stedi'
    AND c.submitted_at > NOW() - INTERVAL '30 days'
ORDER BY c.submitted_at DESC;
```

### Q2: All claim events tagged as Stedi submissions in the past 30 days

```sql
SELECT 
    ce.id,
    ce.claim_id,
    ce.type,
    ce.notes,
    ce.timestamp,
    ce.organization_id
FROM claim_events ce
WHERE 
    ce.timestamp > NOW() - INTERVAL '30 days'
    AND (ce.type ILIKE '%stedi%' OR ce.type ILIKE '%submitted%' OR ce.notes ILIKE '%ISA15%')
ORDER BY ce.timestamp DESC;
```

### Q3: Claims whose patient name or member_id matches demo/fixture patterns

```sql
SELECT 
    c.id,
    c.organization_id,
    c.status,
    c.stedi_transaction_id,
    p.first_name,
    p.last_name,
    p.member_id,
    pay.payer_id
FROM claims c
JOIN patients p ON p.id = c.patient_id
LEFT JOIN payers pay ON pay.id = c.payer_id
WHERE 
    c.submission_method = 'stedi'
    AND (
        -- Known fixture name
        LOWER(p.first_name || ' ' || p.last_name) IN (
            'megan perez', 'john doe', 'jane doe', 'test patient', 'demo patient', 'qa test'
        )
        -- Member ID looks like demo seed data
        OR p.member_id ~* '^(democlaim|testclaim|VA\d{9}|[A-Z]{3}\d{9})'
        -- Member ID has test/demo prefix
        OR LOWER(p.member_id) LIKE 'demo%'
        OR LOWER(p.member_id) LIKE 'test%'
    )
ORDER BY c.submitted_at DESC NULLS LAST;
```

### Q4: Activity log entries for EDI submissions

```sql
SELECT 
    al.id,
    al.claim_id,
    al.activity_type,
    al.description,
    al.performed_by,
    al.timestamp,
    u.email AS performed_by_email
FROM activity_logs al
LEFT JOIN users u ON u.id = al.performed_by
WHERE 
    al.timestamp > NOW() - INTERVAL '30 days'
    AND al.activity_type = 'edi_submitted'
ORDER BY al.timestamp DESC;
```

---

## Confirmed Incidents

### Incident #1 — Megan Perez / democlaimva004

| Field | Value |
|---|---|
| Patient | Megan Perez |
| Claim PCN | democlaimva004 |
| Amount | $240 |
| Payer | TriWest VA Community Care (TWVACCN) |
| ISA15 | P (production) |
| Submitted by | Task #24 automated agent (no human session) |
| Organization | demo-org-001 |
| Root cause | ISA15 hardcoded 'P' in edi-generator.ts:108 |

**Stedi portal status:** Claim received by Stedi; forwarded to TriWest.  
**Resolution required:** Contact TriWest claims operations to void/withdraw claim democlaimva004.  
**ERA watch:** Monitor FRCPB or TWVACCN 835 for any ERA referencing democlaimva004.

---

## democlaimva001, democlaimva002, democlaimva003

These claim control numbers are referenced in prior test runs. They should be audited in the Stedi portal directly under the Chajinel organization's submission history.  

**Recommended action:** Log into the Stedi portal → Claims → All Submissions and filter by date range (last 30 days) to view all claimed submitted from the API key and their current ISA15/status.

---

## Remediation Summary

All fixes implemented in this session (2026-04-28):

| Fix | File | Description |
|---|---|---|
| ISA15 environment-aware | server/lib/environment.ts | STEDI_ENV drives ISA15_INDICATOR; default 'T' in non-production |
| ISA15 safe default | server/services/edi-generator.ts | No longer hardcoded 'P'; defaults to 'T' if not explicitly set |
| submitClaim ISA15 assertion | server/services/stedi-claims.ts | Reads ISA15 from EDI; refuses to mutate it; never silently upgrades T→P |
| Automated agent block | server/services/stedi-claims.ts + routes.ts | AutomatedSubmissionBlocked class; no-session check; STEDI_AUTOMATED_TEST_MODE gate |
| Synthetic data gate | server/lib/test-data-detector.ts + routes.ts | looksLikeTestData() blocks ISA15=P submissions with demo/fixture data |
| Wizard environment badge | client/src/pages/billing/claim-wizard.tsx | Shows red LIVE / blue TEST badge before submit buttons |
| Wizard test-mode override | client/src/pages/billing/claim-wizard.tsx | Checkbox to force ISA15=T even in production environment |
| Wizard production confirm | client/src/pages/billing/claim-wizard.tsx | Typed "SUBMIT TO PAYER" confirmation modal for ISA15=P submissions |
| FRCPB auto-lock | client/src/pages/billing/claim-wizard.tsx + routes.ts | FRCPB payer automatically locks test mode |
| Submission audit trail | shared/schema.ts + DB | submission_attempts table logs every attempt with ISA15, testMode, automated, testDataResult |
