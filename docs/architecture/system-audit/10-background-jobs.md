# 10 — Background Jobs

All jobs are started from `server/index.ts:113-119` after `httpServer.listen()`:

```ts
seedCaritasFlow();    // one-shot idempotent seeder
startOrchestrator();  // every 30s
startCciCron();       // hourly check, fires on the 5th of Jan/Apr/Jul/Oct
startTimelyFilingCron();  // every 1 min, fires once at 06:00 UTC
startScraperCron();   // every 1 min, fires daily 03:00 UTC + Sun 03:30 synthetic
```

There is **no external scheduler** (no cron container, no Replit cron). Every job is an in-process `setInterval`. Multi-instance deploys would race; the project assumes a single Node instance.

## Flow orchestrator

- **File:** `server/jobs/flow-orchestrator.ts` (82 lines).
- **Tick:** every 30 s (`flow-orchestrator.ts:4`).
- **Query:** picks up to 20 `flow_runs` where `status='running' AND next_action_at <= NOW()` (`flow-orchestrator.ts:11-23`).
- **Race-safety:** optimistic claim by bumping `next_action_at = NOW()+60s` and only proceeds if the UPDATE returns a row (`flow-orchestrator.ts:48-56`).
- **Attempt cap:** force-fails any run where `attempt_count >= max_attempts` (defaulted to 3 via the `flow_steps.max_attempts` join, `flow-orchestrator.ts:13-19,33-43`).
- **Dispatch:** `executeStep(run.id, run.lead_id)` from `services/flow-step-executor.ts:58`.
- **Initial tick:** also fires once 5 s after startup (`flow-orchestrator.ts:76-80`).
- **Logs:** `[orchestrator] Processing N due flow run(s)`.

## Timely filing cron

- **File:** `server/jobs/timely-filing-cron.ts` (76 lines).
- **Schedule:** check every minute; fire once when `now.getUTCHours()===6` and not already run today (`timely-filing-cron.ts:15,41-49`).
- **Two responsibilities:**
  1. `evaluateAllActiveClaims()` — walks active claims, computes TF status, returns `{ evaluated, updated, alertsCreated, byStatus, payersWithNoRule }`. Logs per-org stats.
  2. `maintainReferralStatuses()` (`timely-filing-cron.ts:19-39`) — `UPDATE pcp_referrals SET status='expired'` for past `expiration_date`; `SET status='used_up'` when `visits_used >= visits_authorized`.
- **Email digest:** `sendEmailDigests(stats)` after evaluation.
- **Concurrency guard:** `running` boolean (`timely-filing-cron.ts:13,42-48,67-69`); `lastRunDate` for once-per-day.

## Scraper cron

- **File:** `server/jobs/scraper-cron.ts` (159 lines).
- **Daily scrape:** 03:00 UTC for every payer in `CRON_PAYERS` array — currently `["uhc"]` only (`scraper-cron.ts:39`). Calls `scrapePayerDocuments(payerCode, { triggeredBy: 'cron', allowFallback: true })`.
- **Status classification:** `success` (no errors) | `partial` (some new/updated despite errors) | `failed` (`scraper-cron.ts:59-61`).
- **Run ID resolution:** queries `scrape_runs` for the most recent cron-triggered row of that payer (`scraper-cron.ts:65-71`).
- **Monitoring:** `runMonitorForCronScrape(runId, report, finalStatus, 'cron')` runs SQL assertions + fires webhook.
- **Weekly synthetic E2E test:** Sunday 03:30 UTC. `runWeeklySyntheticTest('uhc')` returns a payload, then both `fireWebhook(payload)` and `logMonitorEvent(payload)` (`scraper-cron.ts:86-105`).
- **Race-safety:** `dailyRunning` and `weeklyRunning` booleans + `lastDailyDate` / `lastWeeklyKey` ISO-week markers (`scraper-cron.ts:25-26,21-22`).
- **Manual triggers:** `triggerDailyScrapeNow()` and `triggerSyntheticTestNow()` exported for admin endpoints (`scraper-cron.ts:148-158`).

## CCI quarterly cron

- **File:** `server/jobs/cci-cron.ts` (52 lines).
- **Schedule:** check hourly; only fires on day 5 of months Jan/Apr/Jul/Oct (`cci-cron.ts:5-7`).
- **Year-quarter guard:** `lastRunYearQuarter = "${year}Q${quarter}"` set before async work; cleared on failure to allow retry (`cci-cron.ts:30,37`).
- **Action:** `ingestFromCms()` from `services/cci-ingest.ts`.
- **Startup probe:** runs `maybeRunIngest` once 10 s after boot — won't actually do work unless the calendar matches (`cci-cron.ts:48-50`).

## Caritas seeder

- **File:** `server/seeds/caritas-flow.ts` (referenced from `index.ts:7`).
- **Idempotent:** safely re-runs every startup. Per `replit.md`, it provisions the 8-step Standard Intake flow plus `org_*` reference rows.
- **Parallel:** runs alongside `seeds/reference-tables.ts` for code-set bootstrapping (UNVERIFIED — not directly read this session).

## Startup schema seeder

- **File:** inline in `server/routes.ts:209-220+` (start of `registerRoutes`).
- Helper `seederLog(type, table, column?)` checks information_schema and emits "applied" vs "already present" — used to surface drift on high-risk objects. **Read-only diagnostics; UNVERIFIED whether any DDL is applied here.** (Common pattern: idempotent column-add via `ALTER TABLE IF NOT EXISTS` outside of Drizzle migrations.)

## Observations

- **All schedules use UTC.** No DST handling needed.
- **No retry mechanism for failed scraper runs** — the next daily tick simply runs again.
- **Single-instance assumption** is the dominant operational risk: any multi-replica deploy will fire each cron once per replica.
- **In-memory dedupe** (`lastRunDate`, `lastWeeklyKey`, `lastRunYearQuarter`) is **lost on restart** — a process crash during a cron window followed by restart could re-fire the job.
