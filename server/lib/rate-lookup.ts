// ─────────────────────────────────────────────────────────────────────────────
// Unified HCPCS Rate Lookup — Task B
//
// Priority order (highest → lowest):
//   1. hcpcs_rates     — VA Community Care contracted rate for this practice
//   2. va_location_rates by locality — Medicare CMS fee schedule for a specific locality
//   3. va_location_rates national average — Medicare CMS fallback when locality unknown
//
// ALL rate surfaces (settings UI, wizard dropdown, rate auto-populate) must call
// lookupHcpcsRate() so a single update propagates everywhere.
//
// NOTE: hcpcs_rates.rate_per_unit is per 15-minute unit interval. Both tables
// store rates on that basis for VA home care codes.
// ─────────────────────────────────────────────────────────────────────────────

import { pool } from "../db";

export interface RateLookupResult {
  rate_per_unit: number;
  source: "contracted" | "locality" | "national_average";
  locality_name?: string;
  hcpcs_code: string;
}

/**
 * Look up the best available rate for a given HCPCS code and optional payer/locality.
 *
 * @param hcpcsCode   - HCPCS/CPT code (e.g. "G0299")
 * @param payerName   - Payer name string — used to match hcpcs_rates.payer_name
 * @param locality    - Location name or ZIP from practice billing_location (optional)
 * @param orgId       - Organization ID for org-scoped hcpcs_rates rows (optional)
 */
export async function lookupHcpcsRate(
  hcpcsCode: string,
  payerName?: string | null,
  locality?: string | null,
  orgId?: string | null,
): Promise<RateLookupResult | null> {
  const code = (hcpcsCode || "").trim().toUpperCase();
  if (!code) return null;

  // ── Step 1: VA Community Care contracted rate (hcpcs_rates) ─────────────
  // These are negotiated VA CC rates specific to this practice. They are the
  // canonical rate source for all VA Community Care claims.
  const isVaPayer = isVARelatedPayer(payerName);
  if (isVaPayer) {
    const contracted = await pool.query<{ rate_per_unit: string; payer_name: string }>(
      `SELECT rate_per_unit, payer_name
         FROM hcpcs_rates
        WHERE hcpcs_code = $1
          AND (
                LOWER(payer_name) LIKE '%va community care%'
             OR LOWER(payer_name) LIKE '%triwest%'
             OR LOWER(payer_name) LIKE '%vaccn%'
          )
        ORDER BY rate_per_unit DESC
        LIMIT 1`,
      [code],
    );
    if (contracted.rows.length > 0) {
      return {
        rate_per_unit: parseFloat(contracted.rows[0].rate_per_unit),
        source: "contracted",
        hcpcs_code: code,
      };
    }
  }

  // Non-VA payer: check hcpcs_rates with payer name match or generic row
  if (payerName && !isVaPayer) {
    const contracted = await pool.query<{ rate_per_unit: string }>(
      `SELECT rate_per_unit
         FROM hcpcs_rates
        WHERE hcpcs_code = $1
          AND LOWER(payer_name) LIKE $2
        ORDER BY rate_per_unit DESC
        LIMIT 1`,
      [code, `%${payerName.toLowerCase()}%`],
    );
    if (contracted.rows.length > 0) {
      return {
        rate_per_unit: parseFloat(contracted.rows[0].rate_per_unit),
        source: "contracted",
        hcpcs_code: code,
      };
    }
  }

  // ── Step 2: Medicare CMS locality rate (va_location_rates) ──────────────
  // Only attempt locality lookup when we have a meaningful location string
  // (i.e., not a ZIP code like "41884" which won't match location_name values).
  if (locality && !/^\d{5}(-\d{4})?$/.test(locality.trim())) {
    const localityRate = await pool.query<{ facility_rate: string; location_name: string }>(
      `SELECT facility_rate, location_name
         FROM va_location_rates
        WHERE hcpcs_code = $1
          AND UPPER(location_name) LIKE $2
          AND is_non_reimbursable = false
        ORDER BY facility_rate DESC
        LIMIT 1`,
      [code, `%${locality.toUpperCase()}%`],
    );
    if (localityRate.rows.length > 0) {
      return {
        rate_per_unit: parseFloat(localityRate.rows[0].facility_rate),
        source: "locality",
        locality_name: localityRate.rows[0].location_name,
        hcpcs_code: code,
      };
    }
  }

  // ── Step 3: National average from Medicare CMS fee schedule ─────────────
  // Last-resort fallback — surfaces in the wizard search dropdown only when
  // neither contracted nor locality rate is available.
  const avgRate = await pool.query<{ avg_rate: string }>(
    `SELECT ROUND(AVG(facility_rate)::numeric, 2) AS avg_rate
       FROM va_location_rates
      WHERE hcpcs_code = $1
        AND is_non_reimbursable = false`,
    [code],
  );
  if (avgRate.rows.length > 0 && avgRate.rows[0].avg_rate) {
    return {
      rate_per_unit: parseFloat(avgRate.rows[0].avg_rate),
      source: "national_average",
      hcpcs_code: code,
    };
  }

  return null;
}

/**
 * Batch version: look up rates for multiple HCPCS codes in two queries.
 * Returns a map of hcpcs_code → RateLookupResult.
 */
export async function lookupHcpcsRateBatch(
  hcpcsCodes: string[],
  payerName?: string | null,
  locality?: string | null,
): Promise<Map<string, RateLookupResult>> {
  const codes = [...new Set(hcpcsCodes.map((c) => c.trim().toUpperCase()))].filter(Boolean);
  const result = new Map<string, RateLookupResult>();
  if (codes.length === 0) return result;

  const isVA = isVARelatedPayer(payerName);

  // Step 1: contracted rates for all codes
  if (isVA) {
    const contracted = await pool.query<{ hcpcs_code: string; rate_per_unit: string }>(
      `SELECT hcpcs_code, rate_per_unit
         FROM hcpcs_rates
        WHERE hcpcs_code = ANY($1)
          AND (
                LOWER(payer_name) LIKE '%va community care%'
             OR LOWER(payer_name) LIKE '%triwest%'
             OR LOWER(payer_name) LIKE '%vaccn%'
          )
        ORDER BY hcpcs_code, rate_per_unit DESC`,
      [codes],
    );
    for (const row of contracted.rows) {
      if (!result.has(row.hcpcs_code)) {
        result.set(row.hcpcs_code, {
          rate_per_unit: parseFloat(row.rate_per_unit),
          source: "contracted",
          hcpcs_code: row.hcpcs_code,
        });
      }
    }
  }

  // Step 2: locality rates for remaining codes
  const remaining = codes.filter((c) => !result.has(c));
  if (remaining.length > 0 && locality && !/^\d{5}(-\d{4})?$/.test(locality.trim())) {
    const localityRates = await pool.query<{
      hcpcs_code: string;
      facility_rate: string;
      location_name: string;
    }>(
      `SELECT DISTINCT ON (hcpcs_code) hcpcs_code, facility_rate, location_name
         FROM va_location_rates
        WHERE hcpcs_code = ANY($1)
          AND UPPER(location_name) LIKE $2
          AND is_non_reimbursable = false
        ORDER BY hcpcs_code, facility_rate DESC`,
      [remaining, `%${locality.toUpperCase()}%`],
    );
    for (const row of localityRates.rows) {
      if (!result.has(row.hcpcs_code)) {
        result.set(row.hcpcs_code, {
          rate_per_unit: parseFloat(row.facility_rate),
          source: "locality",
          locality_name: row.location_name,
          hcpcs_code: row.hcpcs_code,
        });
      }
    }
  }

  // Step 3: national average fallback for any still-missing codes
  const stillMissing = codes.filter((c) => !result.has(c));
  if (stillMissing.length > 0) {
    const avgRates = await pool.query<{ hcpcs_code: string; avg_rate: string }>(
      `SELECT hcpcs_code, ROUND(AVG(facility_rate)::numeric, 2) AS avg_rate
         FROM va_location_rates
        WHERE hcpcs_code = ANY($1)
          AND is_non_reimbursable = false
        GROUP BY hcpcs_code`,
      [stillMissing],
    );
    for (const row of avgRates.rows) {
      if (!result.has(row.hcpcs_code) && row.avg_rate) {
        result.set(row.hcpcs_code, {
          rate_per_unit: parseFloat(row.avg_rate),
          source: "national_average",
          hcpcs_code: row.hcpcs_code,
        });
      }
    }
  }

  return result;
}

/**
 * Detect whether a payer name refers to a VA-related payer.
 * Used to decide whether to prefer hcpcs_rates (VA CC contracted rates)
 * over va_location_rates (Medicare CMS fee schedule).
 */
export function isVARelatedPayer(payerName?: string | null): boolean {
  if (!payerName) return false;
  const lc = payerName.toLowerCase();
  return (
    lc.includes("triwest") ||
    lc.includes("va community care") ||
    lc.includes("vaccn") ||
    lc.includes("pgba") ||
    lc.includes("optumva") ||
    lc.includes("community care") ||
    lc.includes(" va ") ||
    lc.startsWith("va ")
  );
}
