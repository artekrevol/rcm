# 02 — Data Flows

Every flow below is traced through code; line citations follow each step.

## Flow A — Lead intake → Patient → Claim

1. **Lead created** via `POST /api/leads` (route exists per `_queries/20_routes_raw.txt`) or via the Vapi inbound-call webhook. The lead row carries `organization_id` (set from `req.user.organization_id` per the standard pattern in `server/routes.ts:153-160`, `getOrgId`).
2. **Flow trigger** — `triggerMatchingFlows(leadId)` is called from intake creation paths (`server/routes.ts:24` import from `services/flow-trigger`). It selects active flows where `organization_id = lead.organizationId` (or NULL for legacy globals) per the Phase D spec captured in `replit.md`.
3. **Flow runner ticks** every 30 s (`server/jobs/flow-orchestrator.ts:4`):
   - `SELECT FROM flow_runs WHERE status='running' AND next_action_at <= NOW() LIMIT 20` (`flow-orchestrator.ts:11-23`)
   - Optimistic claim by bumping `next_action_at` to `NOW()+60s` (`flow-orchestrator.ts:48-54`)
   - `executeStep(run.id, lead.id)` (`flow-orchestrator.ts:58`)
4. **Step execution** — `server/services/flow-step-executor.ts` loads `getOrgContext(orgId)` (60 s TTL, `services/org-context.ts:82-156`) and dispatches by step type. All comms (SMS/email/voice) resolve their copy via `org_message_templates.template_key` and `org_voice_personas.persona_key`. Twilio config: `flow-step-executor.ts:10-14`. Gmail: `flow-step-executor.ts:16-24`. Vapi outbound: `flow-step-executor.ts:566-571`. Permanent failure writes `failed_at` + `failure_reason`; transient retries at 5 min then 15 min (per `replit.md` and step executor logic).
5. **VOB check step** — calls `checkEligibility()` from `services/stedi-eligibility.ts:41` (270 → 271 round-trip).
6. **Patient promotion** — once intake completes, a patient row is created and linked back via `patients.lead_id` (FK present per `shared/schema.ts:66`). `syncPatientToLead()` at `server/routes.ts:106` recomputes `vobScore` and `vobMissingFields` and may flip `vobStatus`.
7. **Claim creation** — billing flow at `POST /api/billing/claims/draft` (`server/routes.ts:5139`) and the wizard pages (`client/src/pages/billing/claim-wizard.tsx`).

## Flow B — Outbound 837P (claim submission)

1. **Generate EDI** — `generate837P()` in `server/services/edi-generator.ts` produces the X12 envelope. The PGBA VA CCN constants are pinned at `edi-generator.ts:11-36`. The diagnosis-pointer serializer is the single source of truth at `edi-generator.ts:75-90+` (`serializeDiagnosisPointer`), re-exported from `routes.ts:29`.
2. **Test path** — `POST /api/billing/claims/:id/test-stedi` (`server/routes.ts:6623`). Forces ISA15='T' regardless of input (`stedi-claims.ts:178-183`).
3. **Submit path** — `POST /api/billing/claims/:id/submit-stedi` (`server/routes.ts:6348`). Calls `submitClaim()` (`stedi-claims.ts:76`).
4. **Automated-agent gate** — `stedi-claims.ts:86-105` blocks any non-human session unless `STEDI_AUTOMATED_TEST_MODE=true`, AND further blocks ISA15='P' even in that mode.
5. **ISA15 read-only assertion** — `stedi-claims.ts:112-119` refuses to fire if it cannot parse ISA15 (root-cause mitigation for the prior "Megan Perez" production miss-fire incident; comments at `stedi-claims.ts:108-111`).
6. **Stedi raw-X12 endpoint** — `https://healthcare.us.stedi.com/2024-04-01/.../raw-x12-submission` (`stedi-claims.ts:7-8`). Idempotency key = `claimId` (`stedi-claims.ts:131`).
7. **Submission attempt persistence** — written to `submission_attempts` (table exists, 0 rows currently). **UNVERIFIED** insert path; not directly read.

## Flow C — 277CA acknowledgment

1. **Webhook delivery** — Stedi posts to a webhook secured by `STEDI_WEBHOOK_SECRET` (`server/routes.ts:12767`).
2. **Polling fallback** — `poll277Acknowledgments(since?)` at `stedi-claims.ts:245-294` calls `https://healthcare.us.stedi.com/2024-04-01/.../claims/reports?transactionSetType=277`.
3. **Parser** — `process277CA()` at `stedi-webhooks.ts:45+` extracts `claimReference.patientControlNumber`, `statusCategoryCode`, `statusCode`, `payerClaimNumber` (`stedi-webhooks.ts:58-83+`); enriches with `enrichStatusNotes` from `services/rejectionCodeLookup.ts` (`stedi-webhooks.ts:50`).
4. **Manual refresh** — `POST /api/billing/refresh-responses` (`server/routes.ts:4891`), `POST /api/billing/claims/:id/check-277` (`server/routes.ts:6821`).

## Flow D — 835 ERA ingestion

1. **Polling** — `poll835ERA(since?)` at `stedi-claims.ts:296-347`.
2. **Parsing** — `parseERAResponse()` at `stedi-claims.ts:359-396` produces `{ eraId, checkNumber, checkDate, payerName, totalPayment, claimLines[].adjustments[]}`.
3. **Persistence** — `era_batches` (3 rows) → `era_lines` (CASCADE FK at `_queries/04_foreign_keys.tsv:5`).
4. **UI** — `/billing/era` page (`client/src/App.tsx:235`).
5. **Upload alternative** — `POST /api/billing/eras/upload` (`server/routes.ts:12715`) for manual file ingest.

## Flow E — Timely filing guardian

1. **Daily cron** — `server/jobs/timely-filing-cron.ts:15` fires at 06:00 UTC.
2. `evaluateAllActiveClaims()` (`services/timely-filing-guardian.ts`) walks active claims, computes status per payer rule.
3. **PCP referral maintenance** — same cron also expires/uses-up referrals (`timely-filing-cron.ts:19-39`): UPDATE `pcp_referrals` SET status='expired'/'used_up'.
4. **Email digest** — `sendEmailDigests(stats)` (`timely-filing-cron.ts:60`) via Gmail SMTP.
5. **Alerts** — written to `timely_filing_alerts` (table exists, 0 rows).

## Flow F — Payer document scraping

1. **Daily cron** — `server/jobs/scraper-cron.ts:15` 03:00 UTC; weekly synthetic test Sunday 03:30 (`scraper-cron.ts:17`). Currently the only payer in `CRON_PAYERS` is `"uhc"` (`scraper-cron.ts:39`).
2. `scrapePayerDocuments(payerCode)` runs via Playwright (`server/jobs/scrape-payer-documents.ts`).
3. **Run record** — `scrape_runs` row written; resolved by id at `scraper-cron.ts:65-71`.
4. **Monitoring** — `runMonitorForCronScrape()` (`services/scraper-monitor.ts:73`); webhook alert via `SCRAPER_ALERT_WEBHOOK_URL` (`scraper-monitor.ts:173`).
5. **Manual extraction** — Claude AI extracts structured items into `manual_extraction_items` (490 rows).

## Flow G — CCI quarterly ingest

1. Cron `server/jobs/cci-cron.ts` runs hourly check; only fires on the 5th of January/April/July/October (`cci-cron.ts:5-6`).
2. `ingestFromCms()` (`services/cci-ingest.ts`) loads CMS NCCI PTP edits into `cci_edits` (currently 0 rows — never run on this DB).

## Flow H — Login + session

1. `POST /api/auth/login` (Passport local) — `server/auth.ts` setupAuth.
2. Rate limit: 10 attempts / 15 min via `login_attempts` table.
3. Session cookie: 24 h, signed with `SESSION_SECRET`, stored in `session` table via custom `PgSessionStore`.
4. Bcrypt rounds = 10 (`auth.ts` per progress notes).
