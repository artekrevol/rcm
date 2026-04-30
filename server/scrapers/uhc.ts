import crypto from "crypto";
import { PayerScraper, DocumentManifest, FetchResult, BulletinManifest } from "./types";
import {
  withBrowser, rateLimit, fetchRobotsTxt, logRobotsDisallowed
} from "./runtime";
import {
  saveManifestCache, saveSampleFetch, loadManifestCache, loadSampleFetch
} from "./uhc-fallback-cache";

const UHC_DOMAIN = "https://www.uhcprovider.com";
const ADMIN_GUIDES_URL = `${UHC_DOMAIN}/en/admin-guides.html`;
const PRIOR_AUTH_URL = `${UHC_DOMAIN}/en/prior-auth-advance-notification.html`;
const NEWS_URL = `${UHC_DOMAIN}/en/resource-library/news/news-updates.html`;

// ── Capitation/Delegation Supplement — the primary demo document ──────────────
// UHC supplements for the main commercial/MA Admin Guide appear in the
// JavaScript-rendered content on admin-guides.html. The Capitation/Delegation
// supplement is the canonical demo target referenced in the fallback cache.
export const DEMO_SUPPLEMENT_URL = `${UHC_DOMAIN}/content/dam/provider/docs/public/admin-guides/UHC-Capitation-and-Delegation-Guide.pdf`;

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export class UhcScraper implements PayerScraper {
  readonly payer_code = "uhc";
  readonly payer_name = "UnitedHealthcare";

  // ── list_documents ─────────────────────────────────────────────────────────
  async list_documents(opts?: { since?: Date }): Promise<DocumentManifest[]> {
    const robots = await fetchRobotsTxt(UHC_DOMAIN);
    const discovered_at = new Date();
    const results: DocumentManifest[] = [];

    // UHC's admin guides and supplements are partially in static HTML (main guide)
    // and partially JS-rendered (supplements). We use Playwright to get the full list.
    await withBrowser(async (page) => {
      // ── Admin Guide page ────────────────────────────────────────────────────
      await rateLimit(this.payer_code);
      logRobotsDisallowed(robots, ADMIN_GUIDES_URL, this.payer_code);
      await page.goto(ADMIN_GUIDES_URL, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500); // allow JS-rendered content to hydrate

      const adminLinks = await page.$$eval('a[href]', (anchors) =>
        anchors.map(a => ({
          href: (a as HTMLAnchorElement).href,
          text: (a as HTMLElement).innerText?.trim() ?? "",
        }))
      );

      const seen = new Set<string>();
      for (const { href, text } of adminLinks) {
        if (!href || seen.has(href)) continue;
        if (!href.includes("/admin-guides/") && !href.includes("/content/dam/provider/docs/public/admin-guides")) continue;
        if (!href.match(/\.(pdf|html)$/i) && !href.includes(".pdf")) continue;
        seen.add(href);

        let document_type: DocumentManifest['document_type'] = 'supplement';
        let parent_document_url: string | undefined;

        if (/administrative.guide/i.test(text) || /care.provider.administrative/i.test(text)) {
          document_type = 'admin_guide';
        } else if (/supplement/i.test(text) || /supplement/i.test(href)) {
          document_type = 'supplement';
          // Resolve parent by year-prefix matching (see parent_document_id resolution in scrape job)
          parent_document_url = ADMIN_GUIDES_URL;
        } else if (/manual/i.test(text)) {
          document_type = 'supplement'; // community-plan manuals are grouped as supplements
        }

        const document_name = text || href.split("/").pop() || href;
        results.push({
          url: href,
          document_type,
          document_name,
          discovered_at,
          parent_document_url: document_type === 'supplement' ? ADMIN_GUIDES_URL : undefined,
          requires_auth: false,
        });
      }

      // ── Prior Authorization list ────────────────────────────────────────────
      await rateLimit(this.payer_code);
      logRobotsDisallowed(robots, PRIOR_AUTH_URL, this.payer_code);
      await page.goto(PRIOR_AUTH_URL, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);

      const paLinks = await page.$$eval('a[href]', (anchors) =>
        anchors.map(a => ({
          href: (a as HTMLAnchorElement).href,
          text: (a as HTMLElement).innerText?.trim() ?? "",
        }))
      );

      for (const { href, text } of paLinks) {
        if (!href || seen.has(href)) continue;
        if (!href.match(/\.(pdf|html)$/i)) continue;
        if (!/prior.auth|crosswalk|advance.notif|pa.list|authorization/i.test(text) &&
            !/prior.auth|crosswalk/i.test(href)) continue;
        seen.add(href);
        results.push({
          url: href,
          document_type: 'pa_list',
          document_name: text || href.split("/").pop() || href,
          discovered_at,
          requires_auth: false,
        });
      }
    });

    // Save successful manifest to fallback cache
    saveManifestCache(results);
    return results;
  }

  // ── fetch_document ─────────────────────────────────────────────────────────
  async fetch_document(url: string): Promise<FetchResult> {
    await rateLimit(this.payer_code);

    const fetched_at = new Date();
    let finalUrl = url;
    let content: Buffer;
    let mimetype = "application/octet-stream";

    // Use Playwright to follow redirects and capture the final binary content.
    // PDFs on UHC's CDN sometimes redirect through download handlers; Playwright
    // resolves these transparently.
    const response = await withBrowser(async (page) => {
      let downloadBuffer: Buffer | null = null;

      // Intercept PDF responses to capture their binary data
      page.on("response", async (resp) => {
        const ct = resp.headers()["content-type"] ?? "";
        if (ct.includes("pdf") && resp.status() === 200) {
          try {
            downloadBuffer = Buffer.from(await resp.body());
            finalUrl = resp.url();
            mimetype = "application/pdf";
          } catch { /* body already consumed */ }
        }
      });

      await page.goto(url, { waitUntil: "load" });
      await page.waitForTimeout(1000);
      finalUrl = page.url();

      if (downloadBuffer) return { content: downloadBuffer, finalUrl };

      // Fallback: get page content as buffer
      const html = await page.content();
      const ct = "text/html";
      return { content: Buffer.from(html), finalUrl, ct };
    });

    content = response.content;
    if (response.finalUrl) finalUrl = response.finalUrl;

    const content_hash = sha256(content);

    // Cache the Capitation/Delegation supplement as the demo fallback sample
    if (url === DEMO_SUPPLEMENT_URL || url.toLowerCase().includes("capitation")) {
      saveSampleFetch(url, { content, mimetype, final_url: finalUrl, content_hash, fetched_at });
    }

    return { content, mimetype, final_url: finalUrl, content_hash, fetched_at };
  }

  // ── list_bulletins ─────────────────────────────────────────────────────────
  async list_bulletins(opts?: { since?: Date }): Promise<BulletinManifest[]> {
    const since = opts?.since ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // default 90 days
    const robots = await fetchRobotsTxt(UHC_DOMAIN);
    const results: BulletinManifest[] = [];

    await withBrowser(async (page) => {
      await rateLimit(this.payer_code);
      logRobotsDisallowed(robots, NEWS_URL, this.payer_code);
      await page.goto(NEWS_URL, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);

      const articles = await page.$$eval('a[href]', (anchors) =>
        anchors
          .filter(a => (a as HTMLAnchorElement).href.includes("/resource-library/news/20"))
          .map(a => ({
            href: (a as HTMLAnchorElement).href,
            text: (a as HTMLElement).innerText?.trim() ?? "",
          }))
      );

      for (const { href, text } of articles) {
        if (!text || !href) continue;
        // Parse year from URL like /news/2026/article-slug.html
        const yearMatch = href.match(/\/news\/(\d{4})\//);
        if (!yearMatch) continue;
        const year = parseInt(yearMatch[1]);
        // Use Jan 1 of the year as a conservative published_at estimate
        // (exact date extraction would require fetching each article)
        const published_at = new Date(`${year}-01-01`);
        if (published_at < since) continue;

        results.push({
          url: href,
          title: text,
          published_at,
          summary: undefined,
          announces_changes_to: [],
        });
      }
    });

    return results;
  }
}
