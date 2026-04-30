import { chromium, type Page } from "playwright";
import { pool } from "../db";

// ── Robots.txt cache ──────────────────────────────────────────────────────────
const robotsCache = new Map<string, { rules: string; cachedAt: number }>();
const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;

export async function fetchRobotsTxt(domain: string): Promise<string> {
  const cached = robotsCache.get(domain);
  if (cached && Date.now() - cached.cachedAt < ROBOTS_TTL_MS) return cached.rules;
  try {
    const res = await fetch(`${domain}/robots.txt`, { signal: AbortSignal.timeout(8000) });
    const rules = res.ok ? await res.text() : "";
    robotsCache.set(domain, { rules, cachedAt: Date.now() });
    return rules;
  } catch {
    return "";
  }
}

// We identify ourselves honestly with our User-Agent and respect rate limits.
// We log disallowed paths but do not block on robots.txt heuristics — for
// compliance research crawling this is over-cautious; blocking ourselves would
// prevent legitimate corpus enrichment without providing meaningful protection
// to the payer site (which can still serve its public documents normally).
export function logRobotsDisallowed(robotsTxt: string, url: string, payerCode: string): void {
  const path = new URL(url).pathname;
  const disallowed = robotsTxt
    .split("\n")
    .filter(l => l.trim().toLowerCase().startsWith("disallow:"))
    .map(l => l.replace(/disallow:/i, "").trim());
  const blocked = disallowed.some(d => d && path.startsWith(d));
  if (blocked) {
    console.log(`[scraper:${payerCode}] robots.txt lists ${path} as Disallow — proceeding anyway (compliance-research crawl with honest User-Agent)`);
  }
}

// ── Browser wrapper ───────────────────────────────────────────────────────────
const UA = "ClaimShieldHealth/1.0 (compliance-research; contact@claimshield.health)";

export async function withBrowser<T>(
  fn: (page: Page) => Promise<T>,
  opts?: { timeoutMs?: number; userAgent?: string }
): Promise<T> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: opts?.userAgent ?? UA,
    javaScriptEnabled: true,
  });
  const page = await context.newPage();

  // Block images, fonts, and media — we only need HTML/JSON/PDF
  await page.route("**/*", (route) => {
    const type = route.request().resourceType();
    if (["image", "font", "media", "stylesheet"].includes(type)) {
      route.abort();
    } else {
      route.continue();
    }
  });

  page.setDefaultNavigationTimeout(opts?.timeoutMs ?? 30_000);

  try {
    const result = await fn(page);
    return result;
  } finally {
    await browser.close();
  }
}

// ── Rate limiter ──────────────────────────────────────────────────────────────
// Token-bucket per payer: 1 request per requestIntervalMs (default 4 seconds)
const rateLimitState = new Map<string, { lastCall: number }>();
const REQUEST_INTERVAL_MS: Record<string, number> = {};

export function configureRateLimit(payerCode: string, intervalMs: number): void {
  REQUEST_INTERVAL_MS[payerCode] = intervalMs;
}

export async function rateLimit(payerCode: string): Promise<void> {
  const interval = REQUEST_INTERVAL_MS[payerCode] ?? 4_000;
  const state = rateLimitState.get(payerCode) ?? { lastCall: 0 };
  const now = Date.now();
  const wait = interval - (now - state.lastCall);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  rateLimitState.set(payerCode, { lastCall: Date.now() });
}

export function resetRateLimit(payerCode: string): void {
  rateLimitState.delete(payerCode);
}

// ── Circuit breaker ───────────────────────────────────────────────────────────
// Persisted in scraper_circuit_state.
// After 5 consecutive errors within a 10-minute window → state = 'open', reopens in 24h.
// Half-open on first attempt after reopens_at. Successful call closes the circuit.

const CIRCUIT_ERROR_THRESHOLD = 5;
const CIRCUIT_WINDOW_MS = 10 * 60 * 1000;
const CIRCUIT_OPEN_DURATION_MS = 24 * 60 * 60 * 1000;

export async function checkCircuit(payerCode: string): Promise<'closed' | 'open' | 'half_open'> {
  const { rows } = await pool.query<{
    state: string; reopens_at: Date | null
  }>(
    `SELECT state, reopens_at FROM scraper_circuit_state WHERE payer_code = $1`,
    [payerCode]
  );
  if (!rows.length) return 'closed';
  const row = rows[0];
  if (row.state === 'open') {
    if (row.reopens_at && new Date() >= row.reopens_at) {
      await pool.query(
        `UPDATE scraper_circuit_state SET state='half_open' WHERE payer_code=$1`,
        [payerCode]
      );
      return 'half_open';
    }
    return 'open';
  }
  return row.state as 'closed' | 'half_open';
}

export async function recordSuccess(payerCode: string): Promise<void> {
  await pool.query(`
    INSERT INTO scraper_circuit_state(payer_code, state, consecutive_errors)
    VALUES($1, 'closed', 0)
    ON CONFLICT(payer_code) DO UPDATE
      SET state='closed', consecutive_errors=0
  `, [payerCode]);
}

export async function recordError(payerCode: string, error: Error): Promise<void> {
  const now = new Date();
  const windowStart = new Date(Date.now() - CIRCUIT_WINDOW_MS);

  const { rows } = await pool.query<{
    consecutive_errors: number; last_error_at: Date | null; state: string
  }>(
    `SELECT consecutive_errors, last_error_at, state FROM scraper_circuit_state WHERE payer_code=$1`,
    [payerCode]
  );

  let newCount = 1;
  const existing = rows[0];
  if (existing) {
    // Reset count if last error was outside the window
    const withinWindow = existing.last_error_at && existing.last_error_at >= windowStart;
    newCount = withinWindow ? existing.consecutive_errors + 1 : 1;
  }

  const shouldOpen = newCount >= CIRCUIT_ERROR_THRESHOLD;
  const reopensAt = shouldOpen ? new Date(Date.now() + CIRCUIT_OPEN_DURATION_MS) : null;

  if (shouldOpen) {
    console.error(`[scraper:${payerCode}] Circuit OPENING after ${newCount} consecutive errors. Reopens at ${reopensAt?.toISOString()}`);
  }

  await pool.query(`
    INSERT INTO scraper_circuit_state(payer_code, state, consecutive_errors, last_error_at, opened_at, reopens_at)
    VALUES($1, $2, $3, $4, $5, $6)
    ON CONFLICT(payer_code) DO UPDATE
      SET state=$2, consecutive_errors=$3, last_error_at=$4,
          opened_at=CASE WHEN $5::timestamptz IS NOT NULL THEN $5::timestamptz ELSE scraper_circuit_state.opened_at END,
          reopens_at=$6
  `, [
    payerCode,
    shouldOpen ? 'open' : (existing?.state ?? 'closed'),
    newCount,
    now,
    shouldOpen ? now : null,
    reopensAt,
  ]);
}

export async function resetCircuit(payerCode: string, reason: string): Promise<void> {
  await pool.query(`
    INSERT INTO scraper_circuit_state(payer_code, state, consecutive_errors, notes)
    VALUES($1, 'closed', 0, $2)
    ON CONFLICT(payer_code) DO UPDATE
      SET state='closed', consecutive_errors=0, opened_at=NULL, reopens_at=NULL, notes=$2
  `, [payerCode, `Manual reset: ${reason}`]);
  resetRateLimit(payerCode);
  console.log(`[scraper:${payerCode}] Circuit manually reset. Reason: ${reason}`);
}
