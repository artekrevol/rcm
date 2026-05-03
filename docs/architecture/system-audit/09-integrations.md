# 09 — External Integrations

Each integration below is documented with: env vars, endpoint(s), call sites, and observed call patterns.

## Stedi (Healthcare clearinghouse)

- **Env:** `STEDI_API_KEY`, `STEDI_WEBHOOK_SECRET`, `STEDI_ENV` (T/P resolver), `STEDI_AUTOMATED_TEST_MODE`, `X_AUTOMATED_AGENT`.
- **Endpoints:** `https://healthcare.us.stedi.com/2024-04-01/...` (claims, eligibility, reports). See 08.
- **Sites:** `server/services/stedi-claims.ts`, `services/stedi-eligibility.ts`, `services/stedi-webhooks.ts`. Plus inline checks at `routes.ts:7044, 7078, 11710, 12747, 12767, 4770, 6397`.
- **Webhook target:** validated by `STEDI_WEBHOOK_SECRET` at `routes.ts:12767`.
- **Status check route:** `GET /api/billing/stedi/status` (`routes.ts:7829`).

## Vapi (AI outbound calls)

- **Env:** `VAPI_API_KEY`, `VAPI_PUBLIC_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_PHONE_NUMBER_ID`, `VAPI_WEBHOOK_SECRET`.
- **Sites:**
  - `routes.ts:9152-9154` — outbound call request (`/api/calls/...`).
  - `routes.ts:9279-9281` — webhook signature verification.
  - `flow-step-executor.ts:566-571` — voice_call step (per-org assistant id resolved via `org_voice_personas`).
  - `routes.ts:10843-10844` — public widget config exposed to client.
- **Per-org assistants:** `org_voice_personas.vapi_assistant_id` is read by `flow-step-executor.ts` per call. The `chajinel-org-001` org has placeholder `PLACEHOLDER_AWAITING_VAPI_CONFIG` and is therefore `is_active=false` (per `replit.md`).

## Twilio (SMS)

- **Env:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_MESSAGING_SERVICE_SID`.
- **Sites:**
  - `routes.ts:32-36` — initialize at module load.
  - `flow-step-executor.ts:10-14, 321, 534-535` — outbound SMS.
- **Inbound SMS webhook:** present per `_queries/20_routes_raw.txt`; **signature validation UNVERIFIED**.
- **Comm locks:** `server/services/comm-locks.ts` + `comm_locks` table (1 row) prevent duplicate SMS to a single recipient within a window.

## Gmail SMTP (email)

- **Env:** `GMAIL_USER`, `GMAIL_APP_PASSWORD`.
- **Sites:**
  - `routes.ts:39-50` — global `emailTransporter`.
  - `flow-step-executor.ts:16-24` — flow email steps.
  - `services/timely-filing-guardian.ts:212-213, 300` — daily digest.
- Send-as identity = `GMAIL_USER` or fallback `noreply@example.com` (`routes.ts:50`).

## Office Ally (SFTP EDI fallback)

- **Env:** `OA_SFTP_HOST`, `OA_SFTP_USERNAME`, `OA_SFTP_PASSWORD` (per `office-ally.ts:4-7`).
- **Sites:** `routes.ts:6168` (test connection), `routes.ts:6190` (submit-oa).

## VerifyTX (insurance verification)

- **Env:** `VERIFYTX_USERNAME`, `VERIFYTX_PASSWORD`, `VERIFYTX_CLIENT_ID`, `VERIFYTX_CLIENT_SECRET`, `VERIFYTX_FACILITY_ID` (`server/verifytx.ts:585-589`).
- **Missing secrets per `<missing_secrets>`:** `VERIFYTX_API_KEY`, `VERIFYTX_API_SECRET` — these are **UNVERIFIED** as required (the username/password/client-id flow is what the code actually reads).
- **Call sites:** `verifytx.ts` is imported on demand from VOB-related routes; specific routes **UNVERIFIED in this session**.

## Anthropic Claude (AI extraction)

- **Env:** `ANTHROPIC_API_KEY`.
- **Sites:**
  - `services/claude-extractor.ts:336, 340` — payer manual extraction.
  - `services/manual-extractor.ts:297, 384` — orchestrates extraction.
  - `services/transcript-extractor.ts:4` — Vapi call transcript → structured insurance fields.

## Playwright (web scraping)

- No env vars; uses bundled headless Chromium.
- **Sites:** `server/scrapers/{runtime,uhc,uhc-fallback-cache}.ts`, driven by `server/jobs/scrape-payer-documents.ts` and the cron at `jobs/scraper-cron.ts`.
- **Circuit breaker / monitoring:** `services/scraper-monitor.ts`. Webhook: `SCRAPER_ALERT_WEBHOOK_URL` (`scraper-monitor.ts:173`).

## CMS (NCCI)

- No env vars; downloads from public CMS URL.
- **Site:** `services/cci-ingest.ts`, scheduled by `jobs/cci-cron.ts` (5th of Jan/Apr/Jul/Oct).

## VA fee schedule

- `va_location_rates` table (2,180 rows) preloaded by reference seeds. Lookup in `server/lib/rate-lookup.ts`.
- Routes: `/api/billing/va-locations`, `/api/billing/va-rate`, `/api/billing/va-rates`, `/api/billing/va-rates-age`.

## PostgreSQL / Drizzle

- `DATABASE_URL` (`server/db.ts:7,13`).
- Pool initialized from `pg` driver; Drizzle ORM bridges typed schema in `shared/schema.ts`.

## Replit (hosting)

- `PORT` (`server/index.ts:103` — defaults to 5000); `REPLIT_DEV_DOMAIN`, `PUBLIC_URL` (`routes.ts:10973`) used to build absolute URLs for webhooks.
