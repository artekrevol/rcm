/**
 * PGBA VA CCN 837P Companion Guide v1.0, March 2021 — Table 5
 * Business-level rejection codes that appear on RPT/RSP response reports
 * and in 277CA status information when a claim fails PGBA's business edits.
 *
 * Usage:
 *   lookupRejectionCode("NP1")      → { code, description, segment, detail, action }
 *   enrichStatusNotes("A2", "NP1", "PGBA") → human-readable enriched string for timeline
 */

import fs from "fs";
import path from "path";

interface RejectionCodeEntry {
  code: string;
  description: string;
  segment: string;
  detail: string;
  action: string;
}

interface RejectionCodeFile {
  _source: string;
  _note: string;
  codes: Record<string, RejectionCodeEntry>;
}

let _codeMap: Record<string, RejectionCodeEntry> | null = null;

function loadCodes(): Record<string, RejectionCodeEntry> {
  if (_codeMap) return _codeMap;
  try {
    const filePath = path.join(__dirname, "../data/pgba_rejection_codes.json");
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed: RejectionCodeFile = JSON.parse(raw);
    _codeMap = parsed.codes || {};
  } catch (err) {
    console.warn("[RejectionCodeLookup] Could not load pgba_rejection_codes.json:", err);
    _codeMap = {};
  }
  return _codeMap;
}

export function lookupRejectionCode(code: string): RejectionCodeEntry | null {
  if (!code) return null;
  const codes = loadCodes();
  return codes[code.trim().toUpperCase()] || null;
}

/**
 * Builds a rich timeline note for a 277CA event.
 * @param statusCategoryCode  High-level category (A1, A2, A3...)
 * @param statusCode          PGBA business edit code, if present (NP1, AAT, DP1...)
 * @param payerName           Payer name for context
 * @param payerClaimNumber    PGBA's assigned claim control number, if returned
 */
export function enrichStatusNotes(
  statusCategoryCode: string,
  statusCode: string | null | undefined,
  payerName: string,
  payerClaimNumber?: string | null
): string {
  const categoryLabels: Record<string, string> = {
    A1: "Accepted",
    A2: "Rejected — Business Edit Failure",
    A3: "Rejected — Technical Failure",
    A4: "Pending",
    A6: "Acknowledged",
    A7: "Received",
    A8: "Incomplete",
  };
  const categoryLabel = categoryLabels[statusCategoryCode] || statusCategoryCode;

  const parts: string[] = [
    `Payer acknowledgment via webhook. Status: ${categoryLabel} (${statusCategoryCode}). Payer: ${payerName}.`,
  ];

  if (payerClaimNumber) {
    parts.push(`Payer claim number: ${payerClaimNumber}.`);
  }

  if (statusCode) {
    const entry = lookupRejectionCode(statusCode);
    if (entry) {
      parts.push(
        `Rejection code ${statusCode}: ${entry.description}.`,
        `Segment: ${entry.segment}.`,
        `Detail: ${entry.detail}`,
        `Action: ${entry.action}`
      );
    } else {
      parts.push(`Status code: ${statusCode}.`);
    }
  }

  return parts.join(" ");
}
