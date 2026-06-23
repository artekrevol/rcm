/**
 * HH MA Payer Scrapers — Phase B
 *
 * Five Medicare Advantage home health payers following the PayerScraper
 * interface established by UhcScraper. Each scraper targets its payer's
 * HH-specific billing guide portal using Playwright.
 *
 * Activation: registered in scrape-payer-documents.ts SCRAPERS map.
 * Cron: added to CRON_PAYERS in scraper-cron.ts for daily 03:00 UTC runs.
 */

import crypto from "crypto";
import { PayerScraper, DocumentManifest, FetchResult, BulletinManifest } from "./types";
import { withBrowser, rateLimit, fetchRobotsTxt, logRobotsDisallowed } from "./runtime";

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// ── Generic HH MA base helper ─────────────────────────────────────────────────
// Discovers linked PDF/HTML policy documents from a landing page URL.
async function discoverDocuments(
  payerCode: string,
  landingUrl: string,
  domain: string,
  docType: DocumentManifest["document_type"],
  docName: string,
): Promise<DocumentManifest[]> {
  const robots = await fetchRobotsTxt(domain);
  const discovered_at = new Date();
  const results: DocumentManifest[] = [];

  await withBrowser(async (page) => {
    await rateLimit(payerCode);
    logRobotsDisallowed(robots, landingUrl, payerCode);
    try {
      await page.goto(landingUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000);

      // Collect all links to PDF or known billing guide paths
      const links = await page.$$eval('a[href]', (anchors) =>
        anchors.map(a => ({
          href: (a as HTMLAnchorElement).href,
          text: (a as HTMLElement).innerText?.trim() ?? "",
        })),
      );

      for (const link of links) {
        const isPdf = link.href.toLowerCase().endsWith(".pdf");
        const isBilling = /billing|claim|reimburse|home.?health|hh.?guide|provider.?manual/i.test(
          link.text + link.href,
        );
        if ((isPdf || isBilling) && link.href.startsWith("http")) {
          results.push({
            url: link.href,
            document_type: docType,
            document_name: link.text || docName,
            discovered_at,
            requires_auth: !link.href.includes(".pdf"),
          });
          if (results.length >= 10) break; // rate-limit document discovery per run
        }
      }
    } catch (err) {
      console.warn(`[${payerCode}] Discovery warning: ${(err as Error).message}`);
    }
  }).catch(err => {
    console.warn(`[${payerCode}] Browser launch warning: ${(err as Error).message}`);
  });

  // Always include the canonical landing page itself so the source doc is registered
  if (results.length === 0) {
    results.push({
      url: landingUrl,
      document_type: docType,
      document_name: docName,
      discovered_at,
      requires_auth: false,
    });
  }
  return results;
}

async function fetchDocument(payerCode: string, url: string): Promise<FetchResult> {
  const fetched_at = new Date();
  let content: Buffer;
  let mimetype = "text/html";
  let final_url = url;

  await withBrowser(async (page) => {
    await rateLimit(payerCode);
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    final_url = page.url();
    const buf = response ? Buffer.from(await response.body()) : Buffer.alloc(0);
    content = buf;
    mimetype = response?.headers()["content-type"]?.split(";")[0] ?? "text/html";
  }).catch(() => {
    content = Buffer.alloc(0);
  });

  return {
    content: content!,
    mimetype,
    final_url,
    content_hash: sha256(content!),
    fetched_at,
  };
}

// ── UHC MA Home Health ────────────────────────────────────────────────────────

export class UhcHhScraper implements PayerScraper {
  readonly payer_code = "uhc-hh";
  readonly payer_name = "UnitedHealthcare MA Home Health";
  private readonly LANDING_URL =
    "https://www.uhcprovider.com/content/dam/provider/docs/public/policies/medicaid-comm-reimbursement/UHC-HH-Billing-and-Reimbursement-Guide.pdf";
  private readonly DOMAIN = "https://www.uhcprovider.com";

  async list_documents(): Promise<DocumentManifest[]> {
    return discoverDocuments(
      this.payer_code, this.LANDING_URL, this.DOMAIN,
      "admin_guide", "UHC MA HH Billing and Reimbursement Guide",
    );
  }

  async fetch_document(url: string): Promise<FetchResult> {
    return fetchDocument(this.payer_code, url);
  }

  async list_bulletins(): Promise<BulletinManifest[]> { return []; }
}

// ── Aetna MA Home Health ──────────────────────────────────────────────────────

export class AetnaHhScraper implements PayerScraper {
  readonly payer_code = "aetna-hh";
  readonly payer_name = "Aetna Medicare Advantage Home Health";
  private readonly LANDING_URL =
    "https://www.aetna.com/health-care-professionals/provider-education-manuals/home-health-billing.html";
  private readonly DOMAIN = "https://www.aetna.com";

  async list_documents(): Promise<DocumentManifest[]> {
    return discoverDocuments(
      this.payer_code, this.LANDING_URL, this.DOMAIN,
      "admin_guide", "Aetna MA HH Provider Billing Manual",
    );
  }

  async fetch_document(url: string): Promise<FetchResult> {
    return fetchDocument(this.payer_code, url);
  }

  async list_bulletins(): Promise<BulletinManifest[]> { return []; }
}

// ── Simply Healthcare Plans (Centene FL) ──────────────────────────────────────

export class SimplyHhScraper implements PayerScraper {
  readonly payer_code = "simply-hh";
  readonly payer_name = "Simply Healthcare Plans (Centene HH FL)";
  private readonly LANDING_URL = "https://www.simplyhealthcareplans.com/providers/billing-resources/";
  private readonly DOMAIN = "https://www.simplyhealthcareplans.com";

  async list_documents(): Promise<DocumentManifest[]> {
    return discoverDocuments(
      this.payer_code, this.LANDING_URL, this.DOMAIN,
      "admin_guide", "Simply Healthcare HH Billing Resources",
    );
  }

  async fetch_document(url: string): Promise<FetchResult> {
    return fetchDocument(this.payer_code, url);
  }

  async list_bulletins(): Promise<BulletinManifest[]> { return []; }
}

// ── Solis Health Plans (TX MA) ────────────────────────────────────────────────

export class SolisHhScraper implements PayerScraper {
  readonly payer_code = "solis-hh";
  readonly payer_name = "Solis Health Plans HH";
  private readonly LANDING_URL = "https://www.solishealthplans.com/providers/billing-and-claims/";
  private readonly DOMAIN = "https://www.solishealthplans.com";

  async list_documents(): Promise<DocumentManifest[]> {
    return discoverDocuments(
      this.payer_code, this.LANDING_URL, this.DOMAIN,
      "admin_guide", "Solis Health Plans HH Billing and Claims",
    );
  }

  async fetch_document(url: string): Promise<FetchResult> {
    return fetchDocument(this.payer_code, url);
  }

  async list_bulletins(): Promise<BulletinManifest[]> { return []; }
}

// ── Oscar Health Home Health ──────────────────────────────────────────────────

export class OscarHhScraper implements PayerScraper {
  readonly payer_code = "oscar-hh";
  readonly payer_name = "Oscar Health Home Health";
  private readonly LANDING_URL = "https://www.hioscar.com/provider-resources";
  private readonly DOMAIN = "https://www.hioscar.com";

  async list_documents(): Promise<DocumentManifest[]> {
    return discoverDocuments(
      this.payer_code, this.LANDING_URL, this.DOMAIN,
      "admin_guide", "Oscar Health HH Provider Resources",
    );
  }

  async fetch_document(url: string): Promise<FetchResult> {
    return fetchDocument(this.payer_code, url);
  }

  async list_bulletins(): Promise<BulletinManifest[]> { return []; }
}
