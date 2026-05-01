import { Pool } from "pg";

export type RateSource = "medicare_pfs" | "va_fee_schedule" | "no_rate_found";
export type FacilityType = "facility" | "non_facility";
export type PayerType = "medicare" | "va_community_care" | "commercial";

export interface ExpectedPaymentResult {
  expected_amount: number | null;
  rate_source: RateSource;
  source_detail: string;
  calculation: string;
  locality_code?: string;
  mac_carrier?: string;
  locality_name?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main calculation function (Task 7)
// ──────────────────────────────────────────────────────────────────────────────
export async function calculateExpectedPayment(
  pool: Pool,
  hcpcsCode: string,
  modifier: string | null,
  organizationId: string,
  serviceDate: Date,
  facilityType: FacilityType = "non_facility",
  payerType: PayerType = "medicare"
): Promise<ExpectedPaymentResult> {
  const code = hcpcsCode.trim().toUpperCase();
  const year = serviceDate.getFullYear();

  // 1. Resolve practice locality
  const psRow = await pool.query(
    `SELECT medicare_locality_code, medicare_mac_carrier FROM practice_settings WHERE organization_id = $1`,
    [organizationId]
  );
  const localityCode = psRow.rows[0]?.medicare_locality_code ?? null;
  const macCarrier = psRow.rows[0]?.medicare_mac_carrier ?? null;

  // 2. Try Medicare PFS for Medicare or VA Community Care payers
  if (payerType === "medicare" || payerType === "va_community_care") {
    const pfsTry = await _tryMedicarePFS(pool, code, modifier, year, localityCode, macCarrier, facilityType);
    if (pfsTry) return pfsTry;

    // 3. Fall back to VA Fee Schedule
    const vaTry = await _tryVAFeeSchedule(pool, code, modifier, year, macCarrier, localityCode, facilityType);
    if (vaTry) return vaTry;
  }

  // 4. No rate found
  return {
    expected_amount: null,
    rate_source: "no_rate_found",
    source_detail: `No reference rate found for ${code}${modifier ? "-" + modifier : ""} (${year})`,
    calculation: "Not available — code not in Medicare PFS or VA Fee Schedule for this year/locality",
    locality_code: localityCode ?? undefined,
    mac_carrier: macCarrier ?? undefined,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Medicare PFS lookup + calculation
// ──────────────────────────────────────────────────────────────────────────────
async function _tryMedicarePFS(
  pool: Pool,
  code: string,
  modifier: string | null,
  year: number,
  localityCode: string | null,
  macCarrier: string | null,
  facilityType: FacilityType
): Promise<ExpectedPaymentResult | null> {
  // Look up RVUs
  const rvuQ = await pool.query(
    `SELECT work_rvu, practice_expense_rvu_non_facility, practice_expense_rvu_facility,
            malpractice_rvu, conversion_factor, status_indicator
     FROM cms_pfs_rvu
     WHERE hcpcs_code = $1
       AND pfs_year = $2
       AND ($3::text IS NULL OR modifier = $3 OR modifier IS NULL)
     ORDER BY (CASE WHEN modifier = $3 THEN 0 ELSE 1 END)
     LIMIT 1`,
    [code, year, modifier]
  );
  if (!rvuQ.rows.length) return null;
  const rvu = rvuQ.rows[0];

  // Status check: 'I' = bundled/not payable separately
  if (rvu.status_indicator === "I" || rvu.status_indicator === "B") return null;

  const workRvu: number = parseFloat(rvu.work_rvu ?? 0);
  const peRvu: number = parseFloat(
    facilityType === "facility" ? (rvu.practice_expense_rvu_facility ?? 0) : (rvu.practice_expense_rvu_non_facility ?? 0)
  );
  const mpRvu: number = parseFloat(rvu.malpractice_rvu ?? 0);
  const cf: number = parseFloat(rvu.conversion_factor ?? 33.4009);

  // Look up GPCI for the practice's locality
  let workGpci = 1.0, peGpci = 1.0, mpGpci = 1.0;
  let localityName = "National Average";
  if (localityCode && macCarrier) {
    const gpciQ = await pool.query(
      `SELECT work_gpci, practice_expense_gpci, malpractice_gpci, locality_name
       FROM cms_gpci WHERE mac_carrier = $1 AND locality_code = $2 AND pfs_year = $3 LIMIT 1`,
      [macCarrier, localityCode, year]
    );
    if (gpciQ.rows.length) {
      workGpci = parseFloat(gpciQ.rows[0].work_gpci ?? 1.0);
      peGpci = parseFloat(gpciQ.rows[0].practice_expense_gpci ?? 1.0);
      mpGpci = parseFloat(gpciQ.rows[0].malpractice_gpci ?? 1.0);
      localityName = gpciQ.rows[0].locality_name ?? localityName;
    }
  }

  const workComponent = workRvu * workGpci;
  const peComponent = peRvu * peGpci;
  const mpComponent = mpRvu * mpGpci;
  const total = (workComponent + peComponent + mpComponent) * cf;

  const localityLabel = localityCode ? `locality ${localityCode}${localityName ? " (" + localityName.split("(")[0].trim() + ")" : ""}` : "national average";
  const facilityLabel = facilityType === "facility" ? "facility PE" : "non-facility PE";

  return {
    expected_amount: Math.round(total * 100) / 100,
    rate_source: "medicare_pfs",
    source_detail: `Medicare PFS ${year} — ${localityLabel}, ${facilityLabel}`,
    calculation: [
      `Medicare PFS ${year}: (${workRvu.toFixed(2)} × ${workGpci.toFixed(3)} + ${peRvu.toFixed(2)} × ${peGpci.toFixed(3)} + ${mpRvu.toFixed(2)} × ${mpGpci.toFixed(3)}) × $${cf.toFixed(4)}`,
      `= ($${workComponent.toFixed(4)} + $${peComponent.toFixed(4)} + $${mpComponent.toFixed(4)}) × $${cf.toFixed(4)}`,
      `= $${total.toFixed(2)}`,
      `(Work RVU × Work GPCI + ${facilityType === "facility" ? "Fac " : "Non-Fac "}PE RVU × PE GPCI + MP RVU × MP GPCI) × Conversion Factor`,
    ].join("\n"),
    locality_code: localityCode ?? undefined,
    mac_carrier: macCarrier ?? undefined,
    locality_name: localityName,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// VA Fee Schedule lookup
// ──────────────────────────────────────────────────────────────────────────────
async function _tryVAFeeSchedule(
  pool: Pool,
  code: string,
  modifier: string | null,
  year: number,
  macCarrier: string | null,
  localityCode: string | null,
  facilityType: FacilityType
): Promise<ExpectedPaymentResult | null> {
  // Try locality-specific rate first, then national fallback
  const geoScope = macCarrier && localityCode ? `${macCarrier}_${localityCode}` : null;

  const vaQ = await pool.query(
    `SELECT facility_rate, non_facility_rate, code_description, geographic_scope, mac_carrier, locality_code
     FROM va_fee_schedule
     WHERE hcpcs_code = $1
       AND fee_schedule_year = $2
       AND ($3::text IS NULL OR modifier = $3 OR modifier IS NULL)
       AND (
         geographic_scope = $4
         OR geographic_scope = 'national'
       )
     ORDER BY
       CASE WHEN geographic_scope = $4 THEN 0 ELSE 1 END,
       CASE WHEN modifier = $3 THEN 0 ELSE 1 END
     LIMIT 1`,
    [code, year, modifier, geoScope]
  );
  if (!vaQ.rows.length) return null;

  const va = vaQ.rows[0];
  const rate: number = facilityType === "facility"
    ? parseFloat(va.facility_rate ?? va.non_facility_rate ?? 0)
    : parseFloat(va.non_facility_rate ?? va.facility_rate ?? 0);

  if (rate <= 0) return null;

  const localityLabel = va.geographic_scope !== "national"
    ? `locality ${va.locality_code ?? localityCode}`
    : "national";

  return {
    expected_amount: Math.round(rate * 100) / 100,
    rate_source: "va_fee_schedule",
    source_detail: `VA Fee Schedule ${year} — ${localityLabel}, ${facilityType} rate`,
    calculation: `VA Fee Schedule ${year}: ${facilityType} rate = $${rate.toFixed(2)}${va.code_description ? ` (${va.code_description})` : ""}`,
    locality_code: localityCode ?? undefined,
    mac_carrier: macCarrier ?? undefined,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Batch lookup for all service lines on a claim
// ──────────────────────────────────────────────────────────────────────────────
export async function calculateExpectedPaymentsForClaim(
  pool: Pool,
  serviceLines: Array<{ code: string; modifier?: string; charge: number }>,
  organizationId: string,
  serviceDate: Date,
  payerType: PayerType = "medicare"
): Promise<Array<{
  code: string;
  modifier?: string;
  billed: number;
  expected: ExpectedPaymentResult;
  variance_pct: number | null;
  flag: "over_billed" | "under_billed" | "reasonable" | "no_rate" | null;
}>> {
  const results = [];
  for (const line of serviceLines) {
    const expected = await calculateExpectedPayment(
      pool, line.code, line.modifier ?? null, organizationId, serviceDate, "non_facility", payerType
    );
    let variance_pct: number | null = null;
    let flag: "over_billed" | "under_billed" | "reasonable" | "no_rate" | null = null;
    if (expected.expected_amount !== null && expected.expected_amount > 0) {
      variance_pct = Math.round(((line.charge - expected.expected_amount) / expected.expected_amount) * 100);
      if (variance_pct > 200) flag = "over_billed";
      else if (variance_pct < -50) flag = "under_billed";
      else flag = "reasonable";
    } else {
      flag = "no_rate";
    }
    results.push({ code: line.code, modifier: line.modifier, billed: line.charge, expected, variance_pct, flag });
  }
  return results;
}

// ──────────────────────────────────────────────────────────────────────────────
// Coverage statistics (for admin dashboard)
// ──────────────────────────────────────────────────────────────────────────────
export async function getRateCoverageStats(pool: Pool): Promise<{
  pfs: { rows: number; year: number | null };
  gpci: { rows: number; year: number | null };
  locco: { rows: number; year: number | null };
  vafs: { rows: number; year: number | null; byType: Record<string, number> };
  chajinel: { localityCode: string | null; macCarrier: string | null; localityName: string | null };
  sampleCalcs: Array<{ code: string; result: ExpectedPaymentResult }>;
}> {
  const [pfs, gpci, locco, vafs, chajinel] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS rows, MAX(pfs_year) AS year FROM cms_pfs_rvu`),
    pool.query(`SELECT COUNT(*)::int AS rows, MAX(pfs_year) AS year FROM cms_gpci`),
    pool.query(`SELECT COUNT(*)::int AS rows, MAX(pfs_year) AS year FROM cms_locality_county`),
    pool.query(`SELECT COUNT(*)::int AS rows, MAX(fee_schedule_year) AS year FROM va_fee_schedule`),
    pool.query(`SELECT medicare_locality_code, medicare_mac_carrier FROM practice_settings WHERE organization_id = 'chajinel-org-001' LIMIT 1`),
  ]);

  const vafsByType = await pool.query(
    `SELECT schedule_type, COUNT(*)::int AS cnt FROM va_fee_schedule GROUP BY schedule_type`
  );

  const byType: Record<string, number> = {};
  for (const row of vafsByType.rows) byType[row.schedule_type] = row.cnt;

  let localityName: string | null = null;
  const cRow = chajinel.rows[0];
  if (cRow?.medicare_locality_code && cRow?.medicare_mac_carrier) {
    const locQ = await pool.query(
      `SELECT locality_name FROM cms_gpci WHERE mac_carrier = $1 AND locality_code = $2 ORDER BY pfs_year DESC LIMIT 1`,
      [cRow.medicare_mac_carrier, cRow.medicare_locality_code]
    );
    localityName = locQ.rows[0]?.locality_name ?? null;
  }

  // Sample calculations for common codes
  const sampleCodes = ["99213", "99214", "G0156", "T1019", "99491"];
  const sampleCalcs = [];
  const serviceDate = new Date();
  for (const code of sampleCodes) {
    try {
      const result = await calculateExpectedPayment(pool, code, null, "chajinel-org-001", serviceDate, "non_facility", "va_community_care");
      sampleCalcs.push({ code, result });
    } catch {
      sampleCalcs.push({ code, result: { expected_amount: null, rate_source: "no_rate_found" as RateSource, source_detail: "Error", calculation: "" } });
    }
  }

  return {
    pfs: { rows: pfs.rows[0].rows ?? 0, year: pfs.rows[0].year ?? null },
    gpci: { rows: gpci.rows[0].rows ?? 0, year: gpci.rows[0].year ?? null },
    locco: { rows: locco.rows[0].rows ?? 0, year: locco.rows[0].year ?? null },
    vafs: { rows: vafs.rows[0].rows ?? 0, year: vafs.rows[0].year ?? null, byType },
    chajinel: { localityCode: cRow?.medicare_locality_code ?? null, macCarrier: cRow?.medicare_mac_carrier ?? null, localityName },
    sampleCalcs,
  };
}
