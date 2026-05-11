import type { TextractAnalysisResult } from "./textract-extractor.js";

export interface QbLineItem {
  service_date: string;
  description: string;
  hours: number;
  rate: number;
  total: number;
}

export interface QbInvoiceExtraction {
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  customer_name: string;
  account_designation: string | null;
  agency_name: string;
  agency_address: string;
  line_items: QbLineItem[];
  services_rendered_total: number;
  caregiver_tips: number | null;
  grand_total: number;
  confidence: Record<string, number>;
  extraction_method: "textract-sync";
}

// ─── Date normalizer ──────────────────────────────────────────────────────────

const QB_MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
  jan: "01", feb: "02", mar: "03", apr: "04",
  jun: "06", jul: "07", aug: "08",
  sep: "09", oct: "10", nov: "11", dec: "12",
};

function parseToIso(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  // MM/DD/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  // YYYY-MM-DD already
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // DD-Mon-YYYY (e.g. "02-Apr-2026") — QuickBooks default export format
  const dmy = s.match(/^(\d{1,2})-([A-Za-z]{3,9})-(\d{4})$/);
  if (dmy) {
    const m = QB_MONTHS[dmy[2].toLowerCase()];
    if (m) return `${dmy[3]}-${m}-${dmy[1].padStart(2, "0")}`;
  }
  // Month DD, YYYY
  const longDate = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (longDate) {
    const m = QB_MONTHS[longDate[1].toLowerCase()];
    if (m) return `${longDate[3]}-${m}-${longDate[2].padStart(2, "0")}`;
  }
  return null;
}

/**
 * Try to extract a date string embedded at the start of a description cell.
 * QB sometimes merges date + description into one column.
 */
function extractDateFromDescription(desc: string): { date: string | null; cleanDesc: string } {
  // "02-Apr-2026 Home Health Aide" or "02/04/2026 ..."
  const prefixDmy = desc.match(/^(\d{1,2}-[A-Za-z]{3,9}-\d{4})\s+([\s\S]*)/);
  if (prefixDmy) {
    const date = parseToIso(prefixDmy[1]);
    if (date) return { date, cleanDesc: prefixDmy[2].trim() };
  }
  const prefixMdy = desc.match(/^(\d{1,2}\/\d{1,2}\/\d{4})\s+([\s\S]*)/);
  if (prefixMdy) {
    const date = parseToIso(prefixMdy[1]);
    if (date) return { date, cleanDesc: prefixMdy[2].trim() };
  }
  return { date: null, cleanDesc: desc };
}

// ─── KV lookup ────────────────────────────────────────────────────────────────

function kv(
  map: Map<string, { value: string; confidence: number }>,
  ...keys: string[]
): { value: string; confidence: number } | undefined {
  for (const key of keys) {
    const normalized = key.toLowerCase().replace(/[:\s]+$/g, "").trim();
    const entry = map.get(normalized);
    if (entry?.value) return entry;
    for (const [k, v] of Array.from(map.entries())) {
      if (k.includes(normalized) || normalized.includes(k)) return v;
    }
  }
  return undefined;
}

// ─── Parse money string → number ─────────────────────────────────────────────

function parseMoney(s: string): number {
  if (!s) return 0;
  const cleaned = s.replace(/[$,\s]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export function parseQbInvoice(result: TextractAnalysisResult): QbInvoiceExtraction {
  const kvm = result.keyValuePairs;
  const conf: Record<string, number> = {};

  // ── Header fields ─────────────────────────────────────────────────────────────
  const invoiceNoEntry = kv(kvm, "invoice no", "invoice number", "invoice #", "invoice");
  const invoice_number = invoiceNoEntry?.value?.trim() ?? "";
  conf.invoice_number = invoiceNoEntry?.confidence ?? 0.5;

  const dateEntry = kv(kvm, "invoice date", "date", "bill date");
  const invoice_date = parseToIso(dateEntry?.value) ?? new Date().toISOString().slice(0, 10);
  conf.invoice_date = dateEntry?.confidence ?? 0.5;

  const dueDateEntry = kv(kvm, "due date", "payment due", "terms");
  const due_date = parseToIso(dueDateEntry?.value);

  const billToEntry = kv(kvm, "bill to", "customer", "client", "name");
  const customer_name = billToEntry?.value?.trim() ?? "";
  conf.customer_name = billToEntry?.confidence ?? 0.5;

  const accountEntry = kv(kvm, "account", "account designation", "account type");
  const account_designation = accountEntry?.value?.trim() ?? null;

  // ── Agency info from LINE blocks (top of invoice) ─────────────────────────────
  const topLines = result.lines
    .filter((l) => l.page === 1 && l.top < 0.2)
    .sort((a, b) => a.top - b.top);
  const agency_name = topLines[0]?.text?.trim() ?? "";
  const agency_address = topLines.slice(1, 3).map((l) => l.text.trim()).join(", ");

  // ── Line items from tables ─────────────────────────────────────────────────────
  const line_items: QbLineItem[] = [];

  for (const table of result.tables) {
    if (table.rows.length < 2) continue;
    const header = table.rows[0].map((c) => c.text.toLowerCase());

    const dateIdx = header.findIndex((h) => h.includes("date") || h.includes("service date"));
    const descIdx = header.findIndex((h) => h.includes("description") || h.includes("item") || h.includes("service"));
    const qtyIdx = header.findIndex((h) => h.includes("qty") || h.includes("quantity") || h.includes("hours") || h.includes("hrs"));
    const rateIdx = header.findIndex((h) => h.includes("rate") || h.includes("price") || h.includes("unit price"));
    const amtIdx = header.findIndex((h) => h.includes("amount") || h.includes("total") || h.includes("subtotal"));

    if (descIdx === -1) continue;

    for (let i = 1; i < table.rows.length; i++) {
      const row = table.rows[i];
      let description = row[descIdx]?.text?.trim() ?? "";
      if (!description) continue;

      // Primary date source: dedicated date column
      let rawDate = dateIdx >= 0 ? row[dateIdx]?.text?.trim() : null;
      let service_date = parseToIso(rawDate);

      // Fallback: date may be embedded at the start of the description cell
      if (!service_date) {
        const extracted = extractDateFromDescription(description);
        if (extracted.date) {
          service_date = extracted.date;
          description = extracted.cleanDesc || description;
        }
      }

      // Last resort: use the invoice header date
      service_date = service_date ?? invoice_date;

      const hoursRaw = qtyIdx >= 0 ? row[qtyIdx]?.text ?? "0" : "0";
      const hours = parseFloat(hoursRaw.replace(/[^\d.]/g, "")) || 0;

      const rateRaw = rateIdx >= 0 ? row[rateIdx]?.text ?? "0" : "0";
      const rate = parseMoney(rateRaw);

      const amtRaw = amtIdx >= 0 ? row[amtIdx]?.text ?? "0" : "0";
      const total = parseMoney(amtRaw) || Math.round(hours * rate * 100) / 100;

      if (total === 0 && hours === 0) continue;

      line_items.push({ service_date, description, hours, rate, total });
    }
  }

  // ── Totals ─────────────────────────────────────────────────────────────────────
  const lineSum = Math.round(line_items.reduce((s, l) => s + l.total, 0) * 100) / 100;

  const subtotalEntry = kv(kvm, "subtotal", "services rendered", "services total", "total services");
  const subtotalRaw = subtotalEntry ? parseMoney(subtotalEntry.value) : 0;
  // Prefer extracted subtotal only when it's non-zero and close to the line-item sum; otherwise use line sum.
  const services_rendered_total = subtotalRaw > 0 && Math.abs(subtotalRaw - lineSum) < lineSum * 0.05
    ? subtotalRaw
    : lineSum;

  const tipsEntry = kv(kvm, "caregiver tips", "tips", "gratuity");
  const tipsRaw = tipsEntry ? parseMoney(tipsEntry.value) : null;
  const caregiver_tips = tipsRaw != null && tipsRaw > 0 ? tipsRaw : null;

  const totalEntry = kv(kvm, "total", "grand total", "amount due", "balance due", "invoice total");
  const totalRaw = totalEntry ? parseMoney(totalEntry.value) : 0;
  const grand_total = totalRaw > 0
    ? totalRaw
    : Math.round((services_rendered_total + (caregiver_tips ?? 0)) * 100) / 100;

  conf.grand_total = totalEntry?.confidence ?? 0.6;

  // ── Sanity check ──────────────────────────────────────────────────────────────
  if (line_items.length > 0 && Math.abs(lineSum - services_rendered_total) > 0.02) {
    console.warn(
      `[qb-parser] Line item sum mismatch: field=services_rendered_total expected=${lineSum}`
    );
  }

  return {
    invoice_number,
    invoice_date,
    due_date,
    customer_name,
    account_designation,
    agency_name,
    agency_address,
    line_items,
    services_rendered_total,
    caregiver_tips,
    grand_total,
    confidence: conf,
    extraction_method: "textract-sync",
  };
}
