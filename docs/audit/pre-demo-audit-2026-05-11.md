# Claim Shield Health — Pre-Demo Security & Stability Audit

**Date:** May 11, 2026
**Scope:** Full codebase — security, multi-tenancy, EDI, integrations, database, observability
**Auditor:** AI static analysis (no PHI accessed)

---

## Executive Summary

| Severity | Count | Action |
|----------|-------|--------|
| 🔴 BLOCKER | 3 | Fix before any live demo or production traffic |
| 🟠 HIGH | 8 | Fix before client-facing deployment |
| 🟡 MEDIUM | 7 | Fix within sprint |
| 🟢 LOW | 5 | Backlog — minor risk or polish |

**Recommended actions before tomorrow's demo:**

1. **ERA table split (B1)** — Stedi webhook ERAs are stored in `era_claim_lines`; the ERA Posting UI reads `era_lines`. Auto-ingested ERAs are completely invisible in the UI.
2. **Hardcoded session secret (B2)** — If `SESSION_SECRET` is unset in production, sessions can be forged with a public string in source code.
3. **Twilio webhook auth (H1)** — Both SMS webhook endpoints accept any POST without signature validation.

---

## What Is Confirmed Working Correctly

Before the findings, these critical paths were verified and are correct:

- **EDI 837P envelope** — BHT06=`CH`, ISA15 caller-controlled, GS03=ISA08, NM103=`PGBA VACCN`, SV101=`HC`, frequency code 7 + REF\*F8 on resubmits, PGBA region 4/5 tax ID split — all match the companion guide.
- **277CA parsing** — Status codes A1–A8 mapped, payer claim number extracted for REF\*F8, rejection code dictionary wired.
- **Stedi webhook idempotency** — `webhook_events.event_id` unique index prevents double-processing.
- **Rules engine** — `evaluateClaim()` returns a flat `RuleViolation[]`; all three callers handle it correctly.
- **Login rate limiting** — 10 attempts / 15 min per IP, cleared on success.
- **TWVACCN 270/271** — Intentionally falls back to VerifyTX; manual VOB path is correctly surfaced.
- **Office Ally SFTP** — New client per call (no connection reuse risk), graceful `sftp.end()` on errors.
- **Session cookie flags** — `httpOnly: true`, `secure: isProduction`, `sameSite: "lax"`.
- **Filing alerts cron** — Per-payer deadline calc, dedup via unique constraint on `(claim_id, alert_type)`.
- **Multi-tenancy enforcement** — `organization_id` present and enforced on all patient/claim/lead queries. Super-admin impersonation gated behind `requireSuperAdmin`.

---

## 🔴 BLOCKER — Fix Immediately

---

### B1 · ERA Table Name Split

| Field | Detail |
|-------|--------|
| **Area** | ERA Posting / Stedi Integration |
| **Files** | `server/services/stedi-webhooks.ts` (line 276), `server/routes.ts` (lines 4992, 5013, 5027–5163) |
| **Priority** | P0 — Demo-breaking |

**What's wrong:**
`process835ERA()` in `stedi-webhooks.ts` inserts claim lines into the `era_claim_lines` table. The ERA Posting UI and all manual ERA routes (`GET /api/billing/eras`, `GET /api/billing/eras/:id`, `PATCH /api/billing/eras/:id`) exclusively read from `era_lines`. These are two separate physical tables with different schemas.

**Why it matters:**
Every 835 ERA received via Stedi webhook is silently stored in the wrong table. The ERA Posting screen will always appear empty for auto-ingested ERAs. Manual uploads work; webhook-auto-processed ones do not.

**Fix:**
Change `era_claim_lines` to `era_lines` in `process835ERA`, adjusting the column list to match the `era_lines` schema (`era_id`, `org_id`, `dos`, `service_lines`), or add a UNION/cross-table join in the UI list query.

---

### B2 · Hardcoded Session Secret Fallback

| Field | Detail |
|-------|--------|
| **Area** | Authentication |
| **File** | `server/auth.ts` line 119 |
| **Priority** | P0 — Session forgery risk |

**What's wrong:**
```typescript
secret: sessionSecret || "claimshield-dev-secret",
```
If `SESSION_SECRET` is missing in production, all sessions are signed with a publicly-known string that exists in the git history.

**Why it matters:**
Anyone who reads this repository can forge a valid session cookie for any user, including super_admin, without a password.

**Diff:**
```diff
- secret: sessionSecret || "claimshield-dev-secret",
+ secret: sessionSecret!,
```
The existing `if (!sessionSecret && isProduction) throw new Error(...)` guard above this line must also call `process.exit(1)` or be verified to actually halt startup before the session middleware registers.

---

### B3 · Hardcoded Super-Admin Password Fallback

| Field | Detail |
|-------|--------|
| **Area** | Authentication |
| **File** | `server/routes.ts` line 527 |
| **Priority** | P0 — Credential exposure |

**What's wrong:**
```typescript
const superPwd = process.env.SUPER_ADMIN_PASSWORD || 'Apps@1986N';
```
The fallback password `Apps@1986N` is visible in source code and git history. If `SUPER_ADMIN_PASSWORD` is not set in production, the super admin account is accessible with this known credential.

**Why it matters:**
Super admin has access to every tenant's data and can impersonate any org. A compromised super admin account is a full data breach across all tenants.

**Diff:**
```diff
- const superPwd = process.env.SUPER_ADMIN_PASSWORD || 'Apps@1986N';
+ if (!process.env.SUPER_ADMIN_PASSWORD && process.env.NODE_ENV === 'production') {
+   throw new Error('SUPER_ADMIN_PASSWORD must be set in production');
+ }
+ const superPwd = process.env.SUPER_ADMIN_PASSWORD || 'Apps@1986N-dev-only';
```

---

## 🟠 HIGH — Fix Before Client-Facing Deployment

---

### H1 · Twilio Inbound SMS — No Signature Verification

| Field | Detail |
|-------|--------|
| **Area** | Webhooks / SMS |
| **Files** | `server/routes.ts` lines 10752–10825 (`/api/webhooks/sms`), lines 10826–10870 (`/api/twilio/inbound`) |
| **Priority** | P1 |

**What's wrong:**
Both Twilio webhook endpoints accept any POST request without validating the `X-Twilio-Signature` header.

**Why it matters:**
Any actor can forge an inbound SMS event with a fake `From` number and `Body`, injecting records, updating lead statuses, triggering auto-replies from the org's Twilio number, or unsubscribing patients.

**Diff:**
```diff
  app.post("/api/webhooks/sms", async (req, res) => {
+   if (process.env.TWILIO_AUTH_TOKEN) {
+     const sig = req.headers['x-twilio-signature'] as string;
+     const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
+     const valid = twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, sig, url, req.body);
+     if (!valid) return res.status(403).send('<Response/>');
+   }
    const { From, Body, MessageSid } = req.body;
```
Apply the same pattern to `/api/twilio/inbound`.

---

### H2 · Stedi Webhook — No Auth Enforcement When Secret Unset

| Field | Detail |
|-------|--------|
| **Area** | Webhooks / EDI |
| **File** | `server/routes.ts` lines 13796–13807 |
| **Priority** | P1 |

**What's wrong:**
If `STEDI_WEBHOOK_SECRET` is not configured, the endpoint logs a warning and accepts all POSTs:
```
[Webhook] STEDI_WEBHOOK_SECRET not configured — auth bypass active.
```

**Why it matters:**
A forged 277CA rejection can change a claim's status to `rejected`. A forged 835 ERA with CARC codes can trigger auto-write-off or appeal-flag actions on real claims, corrupting financial records.

**Fix:** Block requests (return 403) rather than warn in `NODE_ENV=production` when the secret is unset.

---

### H3 · Vapi Webhook — No Auth Enforcement When Secret Unset

| Field | Detail |
|-------|--------|
| **Area** | Webhooks / AI Calling |
| **File** | `server/routes.ts` lines 10134–10137 |
| **Priority** | P1 |

**What's wrong:**
Same pattern as H2 — `VAPI_WEBHOOK_SECRET` unset causes a warn-and-accept behavior.

**Why it matters:**
Forged end-of-call-report events can update lead records, inject transcript data, and advance automation flows to wrong states.

**Fix:** Block (not warn) in production when secret is unset.

---

### H4 · DDL Inside Live Webhook Handler

| Field | Detail |
|-------|--------|
| **Area** | Database / Performance |
| **File** | `server/services/stedi-webhooks.ts` lines 128–130 |
| **Priority** | P1 |

**What's wrong:**
```typescript
await db.query(
  `ALTER TABLE claims ADD COLUMN IF NOT EXISTS payer_claim_number VARCHAR`,
).catch(() => {});
```
This DDL runs inside the 277CA webhook handler — on every 277CA response.

**Why it matters:**
`ALTER TABLE` acquires an `AccessExclusiveLock` on the entire `claims` table for the duration of the DDL. On a system with active claim operations, this causes all concurrent reads and writes to block. During a demo this could cause visible hangs on any page loading claims.

**Diff:**
```diff
- if (payerClaimNumber) {
-   await db.query(
-     `ALTER TABLE claims ADD COLUMN IF NOT EXISTS payer_claim_number VARCHAR`,
-   ).catch(() => {});
-   await db.query(
+ if (payerClaimNumber) {
+   await db.query(
      `UPDATE claims SET payer_claim_number = $1, updated_at = NOW() WHERE id = $2`,
      [payerClaimNumber, claim.id]
    );
  }
```
The column is already added in the startup seeder. The DDL in this handler is redundant and dangerous.

---

### H5 · No CSRF Protection

| Field | Detail |
|-------|--------|
| **Area** | Security |
| **Files** | `server/routes.ts` (all mutation routes), `server/auth.ts` |
| **Priority** | P1 |

**What's wrong:**
No CSRF middleware (`csurf`, double-submit cookie, or custom token) is present anywhere in the request pipeline. The app uses session-based auth with `sameSite: "lax"` cookies.

**Why it matters:**
`sameSite: lax` prevents cross-site POST form submissions but does not protect against same-site attacks, or cross-site requests triggered by JavaScript (fetch from an embedded iframe/script). State-changing routes (`POST`, `PATCH`, `DELETE`) are exploitable from a malicious page if the user is authenticated.

**Fix:** Add CSRF token middleware (e.g., `csrf` npm package) on all state-changing routes, or at minimum enforce that all mutation routes verify a custom header (`X-Requested-With: XMLHttpRequest`).

---

### H6 · Impersonation Not Audit-Logged

| Field | Detail |
|-------|--------|
| **Area** | Multi-tenancy / Compliance |
| **File** | `server/routes.ts` lines 12799–12823 |
| **Priority** | P1 |

**What's wrong:**
The super-admin impersonation endpoints write only to the session object. No entry is created in `activity_logs` when impersonation starts or stops.

**Why it matters:**
HIPAA requires an audit trail for all access to PHI. When a super admin impersonates Chajinel (or any real-data org), there is currently no record that it happened — not the time, not which admin, not which org.

**Diff:**
```diff
  (req.session as any).impersonatingOrgId = orgId;
  (req.session as any).impersonatingOrgName = org.rows[0].name;
+ const adminId = (req.user as any)?.id;
+ await db.query(
+   `INSERT INTO activity_logs (id, activity_type, description, performed_by, organization_id)
+    VALUES (gen_random_uuid()::text, 'impersonation_start', $1, $2, $3)`,
+   [`Super-admin started impersonating org ${org.rows[0].name} (${orgId})`, adminId, orgId]
+ );
```
Apply equivalent log on `stop-impersonate`.

---

### H7 · Error Boundaries Cover Only 2 of ~50 Routes

| Field | Detail |
|-------|--------|
| **Area** | Frontend Stability |
| **File** | `client/src/App.tsx` lines 138–153 |
| **Priority** | P1 — Demo-visible |

**What's wrong:**
`<PageErrorBoundary>` wraps only 2 routes (Payer Manuals, Data Tools). All 40+ billing, intake, and admin routes are unprotected.

**Why it matters:**
Any unhandled React render error in the billing module — a missing prop, a `null` dereference, a data shape mismatch — crashes the entire app to a blank white screen with no user-visible message. This is highly visible during a demo.

**Fix:** Wrap every top-level `<Route>` group in `App.tsx` with `<PageErrorBoundary pageName="...">`.

---

### H8 · PHI Logged to Console

| Field | Detail |
|-------|--------|
| **Area** | Observability / HIPAA |
| **File** | `server/routes.ts` lines 10142, 10755 |
| **Priority** | P1 |

**What's wrong:**
- Line 10142: `console.log("Vapi webhook received:", eventType, JSON.stringify(event).slice(0, 1000))` — logs up to 1,000 chars of transcript content, which may contain patient name, DOB, insurance details.
- Line 10755: `console.log(\`Incoming SMS from ${From}: ${Body}\`)` — logs full SMS body from a patient's phone number.

**Why it matters:**
Console logs in production environments (Railway, Replit deployments) are retained and searchable. Logging PHI violates HIPAA's minimum necessary rule and may constitute a reportable breach if log stores are not separately secured.

**Fix:** Replace with structured event logs that record only event type, call ID, and timestamp — never body, transcript, or message content.

---

## 🟡 MEDIUM — Fix Within Sprint

---

### M1 · ERA `allowed_amount` Set to `paid_amount`

| Field | Detail |
|-------|--------|
| **Area** | ERA / Data Integrity |
| **File** | `server/services/stedi-webhooks.ts` lines 282–283 |

**What's wrong:**
```typescript
allowed_amount: paidAmount, // ← should be the actual allowed amount
paid_amount: paidAmount,
```
Both columns are set to the same value. The ERA's `totalClaimChargeAmount` (billed) and `claimPaymentAmount` (paid) are parsed, but the actual allowed amount (contractual rate before patient responsibility) is not extracted.

**Impact:** Contractual adjustments are missing from ERA records. Reports showing billed vs. allowed vs. paid will be inaccurate.

---

### M2 · bcrypt Cost Factor Is 10

| Field | Detail |
|-------|--------|
| **Area** | Authentication |
| **File** | `server/auth.ts` line 90 |

**What's wrong:**
```typescript
return bcrypt.hash(password, 10);
```
OWASP 2024 recommends a minimum cost factor of 12 for bcrypt. At factor 10, brute-force time is ~4× faster than recommended.

**Fix:** Change to `bcrypt.hash(password, 12)`. Existing hashes will upgrade automatically via the `rehashIfNeeded` path already in place.

---

### M3 · Chajinel User Hardcoded Password Fallback

| Field | Detail |
|-------|--------|
| **Area** | Authentication |
| **File** | `server/routes.ts` line 566–567 |

**What's wrong:**
```typescript
const chajinelPwd = process.env.DANIELA_PASSWORD || 'clinic123';
```
`'clinic123'` is a guessable default and is in the git history. Anyone with read access to the repo can log in to the Chajinel demo account.

---

### M4 · Missing Variables in `.env.example`

| Field | Detail |
|-------|--------|
| **Area** | Configuration |
| **File** | `.env.example` |

The following secrets are used in code but not documented in `.env.example`:

| Variable | Used In |
|----------|---------|
| `VAPI_WEBHOOK_SECRET` | `server/routes.ts:10134` |
| `SUPER_ADMIN_PASSWORD` | `server/routes.ts:527` |
| `DANIELA_PASSWORD` | `server/routes.ts:566` |
| `ANTHROPIC_API_KEY` | `server/services/claude-extractor.ts:340` |
| `APP_URL` | `server/services/timely-filing-guardian.ts:300` |
| `SCRAPER_ALERT_WEBHOOK_URL` | `server/services/scraper-monitor.ts:173` |
| `CALL_WINDOW_OVERRIDE` | `server/services/flow-step-executor.ts:599` |
| `OA_SFTP_HOST` | `server/services/office-ally.ts:4` |
| `OA_SFTP_USERNAME` | `server/services/office-ally.ts:6` |
| `OA_SFTP_PASSWORD` | `server/services/office-ally.ts:7` |

---

### M5 · Source Maps Not Explicitly Disabled in Build

| Field | Detail |
|-------|--------|
| **Area** | Build / Security |
| **File** | `vite.config.ts` |

**What's wrong:**
`build.sourcemap` is not set in `vite.config.ts`. Vite defaults to `false` for production builds, but the custom build entry point (`tsx script/build.ts`) may override this.

**Fix:** Explicitly add `build: { sourcemap: false }` to `vite.config.ts` to prevent accidental source map exposure.

---

### M6 · `storage.getClaims()` Full-Table Load

| Field | Detail |
|-------|--------|
| **Area** | Database / Performance |
| **File** | `server/storage.ts` lines 217, 341 |

**What's wrong:**
`getClaims(orgId)` and `getLeads(orgId)` load all records for an org into memory. Line 341 calls `this.getClaims(orgId)` for in-memory filtering. For orgs with >200 claims this causes noticeable latency on any endpoint that uses this path.

**Fix:** Push filters into the SQL query with parameterized `WHERE` clauses rather than filtering in JavaScript.

---

### M7 · Stedi Raw Response Logged During Early Setup

| Field | Detail |
|-------|--------|
| **Area** | Observability / PHI |
| **File** | `server/services/stedi-webhooks.ts` lines 30–36 |

**What's wrong:**
When fewer than 10 webhook events exist, the raw Stedi 277/835 JSON (up to 1,000 chars) is printed to console. This includes member IDs, claim amounts, and patient names.

**Fix:** Remove the conditional log entirely or replace with a structured metadata-only log.

---

## 🟢 LOW — Backlog

---

### L1 · Placeholder Payer Visible in Demo UI

| Field | Detail |
|-------|--------|
| **File** | `server/routes.ts` line 682–684 |

"LTC Insurance (configure per claim)" is seeded as an active payer in the demo and Chajinel orgs, visible in all payer dropdowns. Confusing during a demo. Remove or mark as `is_active = false`.

---

### L2 · `pgba_trading_partner_id` Silently Unused in EDI

| Field | Detail |
|-------|--------|
| **File** | `server/services/edi-generator.ts` lines 188–190 |

The field is documented as "NOT currently used in EDI generation." If PGBA later requires it in ISA06, it will be silently ignored. Add a `console.warn` if the field is set but not used.

---

### L3 · `chajinel-org-001` Hardcoded in Seeder SQL

| Field | Detail |
|-------|--------|
| **File** | `server/routes.ts` lines 717–740 |

Multiple raw SQL queries use `organization_id = 'chajinel-org-001'` as a string literal in the startup seeder. If the org is ever recreated with a different ID, cleanup queries silently no-op.

---

### L4 · `routes.ts` Is ~14,900 Lines

| Field | Detail |
|-------|--------|
| **File** | `server/routes.ts` |

Zero modularization — every route, middleware helper, background cron, and seeder lives in one file. Not an immediate stability risk but makes debugging and code review impractical at this scale.

---

### L5 · Demo Seed Data Mixed With Schema Migrations

| Field | Detail |
|-------|--------|
| **File** | `server/routes.ts` line 2882 |

`// Seed 3 placeholder IPAs for demo` — demo data seeding is interleaved with `ALTER TABLE` schema migration code. A future schema migration that inadvertently runs demo seeding in production would be hard to detect.

---

## Summary Table

| # | Severity | Area | Issue | File | Lines |
|---|----------|------|-------|------|-------|
| B1 | 🔴 BLOCKER | ERA Posting | `era_claim_lines` vs `era_lines` table split — webhook ERAs invisible in UI | `stedi-webhooks.ts` | 240–295 |
| B2 | 🔴 BLOCKER | Auth | Hardcoded session secret fallback `"claimshield-dev-secret"` | `auth.ts` | 119 |
| B3 | 🔴 BLOCKER | Auth | Hardcoded super-admin password fallback `'Apps@1986N'` in source | `routes.ts` | 527 |
| H1 | 🟠 HIGH | Webhooks | Twilio SMS webhooks — no signature validation | `routes.ts` | 10752, 10826 |
| H2 | 🟠 HIGH | Webhooks | Stedi webhook accepts all POSTs when secret unset | `routes.ts` | 13796–13807 |
| H3 | 🟠 HIGH | Webhooks | Vapi webhook accepts all POSTs when secret unset | `routes.ts` | 10134–10137 |
| H4 | 🟠 HIGH | Database | `ALTER TABLE` inside live 277CA webhook handler | `stedi-webhooks.ts` | 128–130 |
| H5 | 🟠 HIGH | Security | No CSRF protection on any state-changing route | `routes.ts`, `auth.ts` | — |
| H6 | 🟠 HIGH | Compliance | Super-admin impersonation not audit-logged | `routes.ts` | 12799–12823 |
| H7 | 🟠 HIGH | Frontend | `PageErrorBoundary` covers only 2 of ~50 routes | `App.tsx` | 138–153 |
| H8 | 🟠 HIGH | HIPAA | PHI (transcript, SMS body) logged to console | `routes.ts` | 10142, 10755 |
| M1 | 🟡 MEDIUM | ERA | `allowed_amount` set to `paid_amount` — wrong value | `stedi-webhooks.ts` | 282–283 |
| M2 | 🟡 MEDIUM | Auth | bcrypt cost factor 10, OWASP recommends 12 | `auth.ts` | 90 |
| M3 | 🟡 MEDIUM | Auth | Chajinel user hardcoded password `'clinic123'` fallback | `routes.ts` | 566–567 |
| M4 | 🟡 MEDIUM | Config | 10 secrets used in code missing from `.env.example` | `.env.example` | — |
| M5 | 🟡 MEDIUM | Build | `build.sourcemap` not explicitly disabled | `vite.config.ts` | — |
| M6 | 🟡 MEDIUM | Performance | `getClaims()` / `getLeads()` full-table memory loads | `storage.ts` | 217, 341 |
| M7 | 🟡 MEDIUM | HIPAA | Raw Stedi response (member IDs, amounts) logged during setup | `stedi-webhooks.ts` | 30–36 |
| L1 | 🟢 LOW | UX | Placeholder "LTC Insurance" payer visible in demo | `routes.ts` | 682–684 |
| L2 | 🟢 LOW | EDI | `pgba_trading_partner_id` silently unused | `edi-generator.ts` | 188–190 |
| L3 | 🟢 LOW | Data | `chajinel-org-001` hardcoded in seeder SQL | `routes.ts` | 717–740 |
| L4 | 🟢 LOW | Tech Debt | `routes.ts` is 14,900 lines, zero modularization | `routes.ts` | — |
| L5 | 🟢 LOW | Tech Debt | Demo seed data mixed with schema migrations | `routes.ts` | 2882 |
