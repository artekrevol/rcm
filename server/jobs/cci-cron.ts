import { ingestFromCms } from "../services/cci-ingest";

// CMS releases new NCCI quarterly files roughly on Jan 1, Apr 1, Jul 1, Oct 1.
// We run on the 5th of each quarter month to give CMS time to publish.
const QUARTER_MONTHS = [1, 4, 7, 10]; // Jan, Apr, Jul, Oct
const RUN_ON_DAY = 5;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // check every hour

let lastRunYearQuarter = "";

function currentYearQuarter(): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const quarter = Math.ceil(month / 3);
  return `${year}Q${quarter}`;
}

async function maybeRunIngest(): Promise<void> {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const yq = currentYearQuarter();

  if (!QUARTER_MONTHS.includes(month)) return;
  if (day < RUN_ON_DAY) return;
  if (lastRunYearQuarter === yq) return; // already ran this quarter

  console.log(`[cci-cron] Quarterly ingest triggered for ${yq}`);
  lastRunYearQuarter = yq; // set before async so concurrent ticks don't double-run

  try {
    const stats = await ingestFromCms();
    console.log(`[cci-cron] Ingest complete: ${JSON.stringify(stats)}`);
  } catch (err: any) {
    console.error("[cci-cron] Ingest failed:", err.message);
    lastRunYearQuarter = ""; // allow retry next tick
  }
}

export function startCciCron(): void {
  console.log("[cci-cron] CCI quarterly ingest cron started");
  setInterval(() => {
    maybeRunIngest().catch((e) => console.error("[cci-cron] error:", e));
  }, CHECK_INTERVAL_MS);

  // Check once shortly after startup (won't actually run unless it's the 5th of a quarter month)
  setTimeout(() => {
    maybeRunIngest().catch((e) => console.error("[cci-cron] startup check error:", e));
  }, 10_000);
}
