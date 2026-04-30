import { chromium } from "playwright";

const BASE = "http://localhost:5000";

async function run() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/auth/login`);
  await page.waitForTimeout(2000);
  const email = process.env.SCREENSHOT_EMAIL;
  const password = process.env.SCREENSHOT_PASSWORD;
  if (!email || !password) throw new Error("SCREENSHOT_EMAIL and SCREENSHOT_PASSWORD env vars are required");
  await page.fill('[data-testid="input-email"]', email);
  await page.fill('[data-testid="input-password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/^http:\/\/localhost:5000\/(?!auth)/, { timeout: 20000 });
  console.log("Logged in:", page.url());

  await page.goto(`${BASE}/admin/scrapers`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3000);

  await page.screenshot({ path: "/tmp/crawler-01-initial.png", fullPage: true });
  console.log("SS1: initial state saved");

  const btn = page.locator('[data-testid="button-run-live-demo"]');
  await btn.waitFor({ state: "visible", timeout: 10000 });
  await btn.click();
  console.log("Demo button clicked");

  await page.waitForTimeout(15000);
  await page.screenshot({ path: "/tmp/crawler-02-midrun.png", fullPage: true });
  console.log("SS2: mid-run saved");

  for (let i = 0; i < 60; i++) {
    const disabled = await btn.getAttribute("disabled");
    if (disabled === null) { console.log("Run completed at iteration", i); break; }
    await page.waitForTimeout(3000);
  }

  await page.screenshot({ path: "/tmp/crawler-03-complete.png", fullPage: true });
  console.log("SS3: completion saved");

  await page.evaluate(() => window.scrollBy(0, 800));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: "/tmp/crawler-04-discovery.png", fullPage: true });
  console.log("SS4: discovery feed saved");

  await browser.close();
  console.log("Done.");
}
run().catch(e => { console.error(e); process.exit(1); });
