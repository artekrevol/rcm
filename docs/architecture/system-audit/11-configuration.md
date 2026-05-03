# 11 — Configuration

Comprehensive list of `process.env.*` references; full grep at `_queries/21_code_inventory.txt:204-282`.

## Required at boot

`server/index.ts:16-21` warns on missing values for:

| Var | Purpose |
|---|---|
| `STEDI_API_KEY` | Clearinghouse access |
| `STEDI_WEBHOOK_SECRET` | Inbound webhook signature |
| `SESSION_SECRET` | Express session signing |

Missing values produce a `⚠ Missing environment variable:` warning but **do not exit**. App will still start with degraded functionality.

## Database

| Var | Used in | Required |
|---|---|---|
| `DATABASE_URL` | `server/db.ts:7,13` | yes — pool will fail without it |

## Auth & sessions

| Var | Used in | Notes |
|---|---|---|
| `SESSION_SECRET` | `server/auth.ts:106` | session cookie signer |
| `NODE_ENV` | `auth.ts:105`, `index.ts:92`, `lib/environment.ts:13`, `routes.ts:13657` | gates dev vs prod behavior |
| `SUPER_ADMIN_PASSWORD` | `routes.ts:501,508,510` | seeds the super_admin account |
| `DANIELA_PASSWORD` | `routes.ts:540,541` | seeds Daniela account |
| `DANIELA_EMAIL` | `routes.ts:547` | Daniela account email |

## Stedi

| Var | Used in |
|---|---|
| `STEDI_API_KEY` | `services/stedi-claims.ts:3`, `stedi-eligibility.ts:1`, `stedi-webhooks.ts:3`, `routes.ts:11710,12747,7044,7078,4770` |
| `STEDI_ENV` | `lib/environment.ts:13` (T/P resolver) |
| `STEDI_WEBHOOK_SECRET` | `routes.ts:12767` |
| `STEDI_AUTOMATED_TEST_MODE` | `routes.ts:6397`, `services/stedi-claims.ts:92` |
| `X_AUTOMATED_AGENT` | `services/stedi-claims.ts:89` (header value, not env in usual sense — read from process.env for tests) |

## Vapi

| Var | Used in |
|---|---|
| `VAPI_API_KEY` | `routes.ts:9152,9243,9442`, `flow-step-executor.ts:566` |
| `VAPI_PUBLIC_KEY` | `routes.ts:10843` (browser widget) |
| `VAPI_ASSISTANT_ID` | `routes.ts:10844,9153`, `flow-step-executor.ts:571` |
| `VAPI_PHONE_NUMBER_ID` | `routes.ts:9154`, `flow-step-executor.ts:567` |
| `VAPI_WEBHOOK_SECRET` | `routes.ts:9279,9281` |

## Twilio

| Var | Used in |
|---|---|
| `TWILIO_ACCOUNT_SID` | `routes.ts:32,33`, `flow-step-executor.ts:11,12` |
| `TWILIO_AUTH_TOKEN` | same |
| `TWILIO_PHONE_NUMBER` | `routes.ts:35`, `flow-step-executor.ts:321,534,535` |
| `TWILIO_MESSAGING_SERVICE_SID` | `routes.ts:36`, `flow-step-executor.ts:14` |

## Gmail SMTP

| Var | Used in |
|---|---|
| `GMAIL_USER` | `routes.ts:39`, `flow-step-executor.ts:16`, `services/timely-filing-guardian.ts:212` |
| `GMAIL_APP_PASSWORD` | same locations |

## Office Ally

| Var | Used in |
|---|---|
| `OA_SFTP_HOST` | `services/office-ally.ts:4` |
| `OA_SFTP_USERNAME` | `office-ally.ts:6` |
| `OA_SFTP_PASSWORD` | `office-ally.ts:7` |

## VerifyTX

| Var | Used in |
|---|---|
| `VERIFYTX_USERNAME` | `server/verifytx.ts:585` |
| `VERIFYTX_PASSWORD` | `verifytx.ts:586` |
| `VERIFYTX_CLIENT_ID` | `verifytx.ts:587` |
| `VERIFYTX_CLIENT_SECRET` | `verifytx.ts:588` |
| `VERIFYTX_FACILITY_ID` | `verifytx.ts:589` |

`<missing_secrets>` lists `VERIFYTX_API_KEY` and `VERIFYTX_API_SECRET`, **but those names are not referenced anywhere in code**. UNVERIFIED whether the missing-secrets list is stale.

## Anthropic Claude

| Var | Used in |
|---|---|
| `ANTHROPIC_API_KEY` | `services/claude-extractor.ts:336,340`, `manual-extractor.ts:297,384`, `transcript-extractor.ts:4` |

## Scrapers / monitoring

| Var | Used in |
|---|---|
| `SCRAPER_ALERT_WEBHOOK_URL` | `services/scraper-monitor.ts:173` |

## Hosting / URLs

| Var | Used in |
|---|---|
| `PORT` | `server/index.ts:103` (default 5000) |
| `PUBLIC_URL` | `routes.ts:10973` (absolute webhook URL) |
| `REPLIT_DEV_DOMAIN` | `routes.ts:10973` (fallback for dev) |
| `APP_URL` | `services/timely-filing-guardian.ts:300` (digest deep links) |

## Runtime knobs

| Var | Used in |
|---|---|
| `CALL_WINDOW_OVERRIDE` | `services/flow-step-executor.ts:599` (override quiet-hours for testing) |

## Secrets currently provisioned (per `<available_secrets>`)

`GMAIL_APP_PASSWORD`, `GMAIL_USER`, `SESSION_SECRET`, `STEDI_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_PHONE_NUMBER`, `VAPI_API_KEY`, `VAPI_PUBLIC_KEY`, `VERIFYTX_CLIENT_ID`, `VERIFYTX_CLIENT_SECRET`, `VERIFYTX_PASSWORD`, `VERIFYTX_USERNAME`.

**Notably absent (will trigger warnings or null-feature behavior):**
- `STEDI_WEBHOOK_SECRET` — required at boot, currently unset → inbound webhooks would fail signature check.
- `ANTHROPIC_API_KEY` — manual extraction + transcript extraction will throw if invoked.
- `VAPI_ASSISTANT_ID`, `VAPI_PHONE_NUMBER_ID`, `VAPI_WEBHOOK_SECRET` — outbound calls + webhook would fail.
- `OA_SFTP_*` — Office Ally fallback unavailable.
- `VERIFYTX_FACILITY_ID` — VerifyTX requests would 400.
- `SUPER_ADMIN_PASSWORD`, `DANIELA_PASSWORD`, `DANIELA_EMAIL` — bootstrap seeders skip if absent (UNVERIFIED).
- `SCRAPER_ALERT_WEBHOOK_URL`, `APP_URL`, `PUBLIC_URL`/`REPLIT_DEV_DOMAIN` — degrade gracefully.

## .env.example

`.env.example` exists at repo root (read in earlier session). It enumerates the canonical set; if drift, take the code references above as authoritative.
