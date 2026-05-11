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

function parseToIso(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const months: Record<string, string> = {
    january: "01", february: "02", march: "03", april: "04",
    may: "05", june: "06", july: "07", august: "08",
    september: "09", october: "10", november: "11", december: "12",
  };
  const longDate = s.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (longDate) {
    const m = months[longDate[1].toLowerCase()];
    if (m) return `${longDate[3]}-${m}-${longDate[2].padStart(2, "0")}`;
  }
  return null;
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
      const description = row[descIdx]?.text?.trim() ?? "";
      if (!description) continue;

      const rawDate = dateIdx >= 0 ? row[dateIdx]?.text : null;
      const service_date = parseToIso(rawDate) ?? invoice_date;

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
  const subtotalEntry = kv(kvm, "subtotal", "services rendered", "services total", "total services");
  const services_rendered_total = subtotalEntry
    ? parseMoney(subtotalEntry.value)
    : Math.round(line_items.reduce((s, l) => s + l.total, 0) * 100) / 100;

  const tipsEntry = kv(kvm, "caregiver tips", "tips", "gratuity");
  const caregiver_tips = tipsEntry ? parseMoney(tipsEntry.value) : null;

  const totalEntry = kv(kvm, "total", "grand total", "amount due", "balance due", "invoice total");
  const grand_total = totalEntry
    ? parseMoney(totalEntry.value)
    : Math.round((services_rendered_total + (caregiver_tips ?? 0)) * 100) / 100;

  conf.grand_total = totalEntry?.confidence ?? 0.6;

  // ── Sanity check ──────────────────────────────────────────────────────────────
  const lineSum = Math.round(line_items.reduce((s, l) => s + l.total, 0) * 100) / 100;
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
