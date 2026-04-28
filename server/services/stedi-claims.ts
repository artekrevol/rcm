import { resolveISA15, isAutomatedContext } from "../lib/environment";

const STEDI_API_KEY = process.env.STEDI_API_KEY;
// Raw X12 endpoint — accepts a single { x12: "ISA*..." } body field.
// The structured-JSON /v3/submission endpoint does NOT accept raw EDI and
// rejects the 'x12' key with HTTP 500 "unknown field 'x12'".
const STEDI_CLAIMS_URL =
  "https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/professionalclaims/v3/raw-x12-submission";
const STEDI_POLL_URL =
  "https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/claims/reports";

/**
 * Thrown when an automated agent (no human session) tries to reach a real-
 * money Stedi endpoint. This is a defense-in-depth layer on top of ISA15.
 */
export class AutomatedSubmissionBlocked extends Error {
  constructor(reason: string) {
    super(`[AutomatedSubmissionBlocked] ${reason}`);
    this.name = "AutomatedSubmissionBlocked";
  }
}

export function isStediConfigured(): boolean {
  return !!STEDI_API_KEY;
}

export interface StediClaimSubmissionParams {
  ediContent: string;
  claimId: string;
  /**
   * When true the submission is a human-initiated test (ISA15='T' already
   * embedded by generate837P). No payer forwarding occurs.
   */
  isTest?: boolean;
  /**
   * Must be set to true by any human-session controller before calling
   * submitClaim. Automated agents must pass this explicitly AND have
   * STEDI_AUTOMATED_TEST_MODE=true in env.
   */
  hasUserSession?: boolean;
  userAgent?: string;
}

export interface StediValidationError {
  code: string;
  message: string;
  segment?: string;
  field?: string;
}

export interface StediSubmissionResult {
  success: boolean;
  transactionId?: string;
  controlNumber?: string;
  status?: string;
  validationErrors?: (string | StediValidationError)[];
  rawResponse?: Record<string, unknown>;
  error?: string;
}

/**
 * Extract ISA15 from an EDI envelope string.
 * Returns 'T', 'P', or null if the segment cannot be parsed.
 */
function readISA15(edi: string): "T" | "P" | null {
  const match = edi.match(/^ISA\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*([PT])\*/m);
  if (!match) return null;
  return match[1] as "T" | "P";
}

export async function submitClaim(
  params: StediClaimSubmissionParams
): Promise<StediSubmissionResult> {
  if (!STEDI_API_KEY) {
    throw new Error("STEDI_API_KEY not configured");
  }

  // ── Automated-agent gate (Task 5) ────────────────────────────────────────
  // Block any automated process from reaching the production submission path
  // unless STEDI_AUTOMATED_TEST_MODE=true (which only ever runs test claims).
  const automated = isAutomatedContext({
    hasUserSession: params.hasUserSession ?? false,
    userAgent: params.userAgent,
    xAutomatedAgent: process.env.X_AUTOMATED_AGENT,
  });
  if (automated) {
    const automatedTestMode = process.env.STEDI_AUTOMATED_TEST_MODE === "true";
    if (!automatedTestMode) {
      throw new AutomatedSubmissionBlocked(
        "No human session detected. Set STEDI_AUTOMATED_TEST_MODE=true if you need automated test submissions."
      );
    }
    // Automated + test mode: must NOT be ISA15=P
    const isa15 = readISA15(params.ediContent);
    if (isa15 === "P") {
      throw new AutomatedSubmissionBlocked(
        "STEDI_AUTOMATED_TEST_MODE is set but EDI contains ISA15='P'. Automated agents may only submit ISA15='T' claims."
      );
    }
  }

  // ── ISA15 safety assertion (Task 1) ──────────────────────────────────────
  // The caller is responsible for embedding the correct ISA15 via generate837P
  // with resolveISA15(). We read ISA15 from the EDI and refuse to silently
  // upgrade 'T' to 'P' the way the old code did — that was the root cause of
  // the Megan Perez production submission.
  const isa15 = readISA15(params.ediContent);
  if (!isa15) {
    return {
      success: false,
      error: "EDI envelope is malformed — cannot determine ISA15. Submission blocked.",
    };
  }

  console.log(
    `[Stedi] submitClaim claimId=${params.claimId} ISA15=${isa15} ` +
    `session=${params.hasUserSession ? "human" : "automated"}`
  );

  const response = await fetch(STEDI_CLAIMS_URL, {
    method: "POST",
    headers: {
      Authorization: `Key ${STEDI_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": params.claimId,
    },
    body: JSON.stringify({ x12: params.ediContent }),
  });

  const rawText = await response.text();
  let data: any = {};
  try { data = JSON.parse(rawText); } catch { data = { message: rawText || `Stedi API error: ${response.status}` }; }

  if (!response.ok) {
    return {
      success: false,
      rawResponse: data,
      error:
        data.message ||
        data.errors?.[0]?.description ||
        data.errors?.[0]?.message ||
        `Stedi API error: ${response.status}`,
    };
  }

  const ref = (data as any).claimReference || {};
  const transactionId = ref.correlationId || ref.rhclaimNumber || (data as any).transactionId;
  const accepted = response.status === 200;

  return {
    success: accepted,
    transactionId,
    controlNumber: ref.customerClaimNumber || ref.patientControlNumber || (data as any).controlNumber,
    status: accepted ? "Accepted" : "Rejected",
    validationErrors: (data as any).errors || [],
    rawResponse: data as Record<string, unknown>,
    error: accepted ? undefined : (data.message || "Claim rejected by Stedi"),
  };
}

export async function testClaim(
  params: StediClaimSubmissionParams
): Promise<StediSubmissionResult> {
  if (!STEDI_API_KEY) {
    throw new Error("STEDI_API_KEY not configured");
  }

  let edi = params.ediContent;

  // Always force ISA15='T' for test validation — this is the only endpoint
  // that may safely mutate ISA15, and it can only ever downgrade P→T, never T→P.
  edi = edi.replace(
    /^(ISA\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*)[PT](\*)/m,
    "$1T$2"
  );

  console.log(`[Stedi] testClaim claimId=${params.claimId} ISA15=T (forced)`);

  const response = await fetch(STEDI_CLAIMS_URL, {
    method: "POST",
    headers: {
      Authorization: `Key ${STEDI_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `test-${params.claimId}-${Date.now()}`,
    },
    body: JSON.stringify({ x12: edi }),
  });

  const rawText = await response.text();
  let data: any = {};
  try { data = JSON.parse(rawText); } catch { data = { message: rawText || `Stedi test validation error: ${response.status}` }; }

  if (!response.ok) {
    const rawErrors: any[] = data.errors || [];
    const structuredErrors: StediValidationError[] = rawErrors.map((e: any) => ({
      code: e.code || e.errorCode || "UNKNOWN",
      message: e.message || e.description || String(e),
      segment: e.segment || e.loopId || undefined,
      field: e.field || e.elementId || undefined,
    }));
    return {
      success: false,
      rawResponse: data as Record<string, unknown>,
      validationErrors: structuredErrors.length > 0 ? structuredErrors : undefined,
      error:
        (data as any).message ||
        rawErrors[0]?.description ||
        rawErrors[0]?.message ||
        `Stedi test validation error: ${response.status}`,
    };
  }

  const ref = (data as any).claimReference || {};
  const transactionId = ref.correlationId || ref.rhclaimNumber || (data as any).transactionId;
  const accepted = response.status === 200;

  const rawErrors: any[] = (data as any).errors || [];
  const structuredErrors: StediValidationError[] = rawErrors.map((e: any) => ({
    code: e.code || e.errorCode || "UNKNOWN",
    message: e.message || e.description || String(e),
    segment: e.segment || e.loopId || undefined,
    field: e.field || e.elementId || undefined,
  }));

  return {
    success: accepted,
    transactionId,
    status: accepted ? "Accepted" : "Rejected",
    validationErrors: structuredErrors.length > 0 ? structuredErrors : [],
    rawResponse: data as Record<string, unknown>,
    error: accepted
      ? undefined
      : rawErrors[0]?.message || (data as any).message || "Claim failed Stedi validation",
  };
}

export async function poll277Acknowledgments(since?: string): Promise<{
  acknowledgments: Array<{
    transactionId: string;
    claimControlNumber: string;
    status: "1" | "3" | "4" | "5";
    statusDescription: string;
    payer: string;
    receivedAt: string;
    rawData: Record<string, unknown>;
  }>;
  lastCheckTimestamp: string;
}> {
  if (!STEDI_API_KEY) throw new Error("STEDI_API_KEY not configured");

  const url = new URL(STEDI_POLL_URL);
  url.searchParams.set("transactionSetType", "277");
  if (since) url.searchParams.set("startDate", since);

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Key ${STEDI_API_KEY}` },
  });

  if (response.status === 404) {
    console.log("[277 Poll] No new 277CA reports found");
    return { acknowledgments: [], lastCheckTimestamp: new Date().toISOString() };
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    console.warn("[277 Poll] Poll failed:", response.status, (err as any).message || "");
    return { acknowledgments: [], lastCheckTimestamp: new Date().toISOString() };
  }

  const data = await response.json().catch(() => ({}));
  const reports = (data as any).reports || (data as any).transactionSets || [];

  return {
    acknowledgments: reports.map((r: any) => ({
      transactionId: r.transactionId || r.id,
      claimControlNumber:
        r.claimReference?.patientControlNumber || r.patientControlNumber || "",
      status: r.status || "1",
      statusDescription: r.statusDescription || mapStatusCode(r.status),
      payer: r.payer?.name || r.payerName || "Unknown",
      receivedAt: r.receivedAt || r.createdAt || new Date().toISOString(),
      rawData: r,
    })),
    lastCheckTimestamp: new Date().toISOString(),
  };
}

export async function poll835ERA(since?: string): Promise<{
  eras: Array<{
    eraId: string;
    checkNumber: string;
    checkDate: string;
    payerName: string;
    totalPayment: number;
    claimLines: Array<{
      claimControlNumber: string;
      patientName: string;
      billedAmount: number;
      allowedAmount: number;
      paidAmount: number;
      adjustments: Array<{
        code: string;
        amount: number;
        reason: string;
      }>;
    }>;
    rawData: Record<string, unknown>;
  }>;
  lastCheckTimestamp: string;
}> {
  if (!STEDI_API_KEY) throw new Error("STEDI_API_KEY not configured");

  const url = new URL(STEDI_POLL_URL);
  url.searchParams.set("transactionSetType", "835");
  if (since) url.searchParams.set("startDate", since);

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Key ${STEDI_API_KEY}` },
  });

  if (response.status === 404) {
    console.log("[835 Poll] No new 835 ERA reports found");
    return { eras: [], lastCheckTimestamp: new Date().toISOString() };
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    console.warn("[835 Poll] Poll failed:", response.status, (err as any).message || "");
    return { eras: [], lastCheckTimestamp: new Date().toISOString() };
  }

  const data = await response.json().catch(() => ({}));
  const reports = (data as any).reports || (data as any).transactionSets || [];

  return {
    eras: reports.map((r: any) => parseERAResponse(r)),
    lastCheckTimestamp: new Date().toISOString(),
  };
}

function mapStatusCode(code: string): string {
  const map: Record<string, string> = {
    "1": "Accepted",
    "3": "Accepted with Changes",
    "4": "Rejected — Payer did not accept",
    "5": "Payer acknowledgment pending",
  };
  return map[code] || `Status code: ${code}`;
}

export function parseERAResponse(r: any) {
  const paymentInfo = r.paymentInfo || r.financialInformation || {};
  const claims = r.claims || r.claimPaymentInfo || [];

  return {
    eraId: r.transactionId || r.id,
    checkNumber:
      paymentInfo.checkNumber || paymentInfo.traceNumber || r.checkNumber || "",
    checkDate:
      paymentInfo.checkDate ||
      paymentInfo.effectiveDate ||
      r.checkDate ||
      new Date().toISOString().slice(0, 10),
    payerName: r.payer?.name || r.payerName || "Unknown",
    totalPayment: parseFloat(
      paymentInfo.totalActualProviderPaymentAmount || paymentInfo.amount || 0
    ),
    claimLines: claims.map((c: any) => ({
      claimControlNumber:
        c.claimPaymentInfo?.patientControlNumber || c.patientControlNumber || "",
      patientName:
        [c.patient?.firstName, c.patient?.lastName].filter(Boolean).join(" ") ||
        "Unknown",
      billedAmount: parseFloat(
        c.claimPaymentInfo?.totalClaimChargeAmount || 0
      ),
      allowedAmount: parseFloat(c.claimPaymentInfo?.claimPaymentAmount || 0),
      paidAmount: parseFloat(c.claimPaymentInfo?.claimPaymentAmount || 0),
      adjustments: (c.claimAdjustments || []).map((adj: any) => ({
        code: `${adj.claimAdjustmentGroupCode}-${adj.claimAdjustmentReasonCode}`,
        amount: parseFloat(adj.claimAdjustmentAmount || 0),
        reason:
          adj.reasonDescription || adj.claimAdjustmentReasonCode || "",
      })),
    })),
    rawData: r,
  };
}
