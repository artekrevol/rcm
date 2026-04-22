const STEDI_API_KEY = process.env.STEDI_API_KEY;
const STEDI_CLAIMS_URL =
  "https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/professionalclaims/v3/submission";
const STEDI_POLL_URL =
  "https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/claims/reports";

export function isStediConfigured(): boolean {
  return !!STEDI_API_KEY;
}

export interface StediClaimSubmissionParams {
  ediContent: string;
  claimId: string;
  isTest?: boolean;
}

export interface StediSubmissionResult {
  success: boolean;
  transactionId?: string;
  controlNumber?: string;
  status?: string;
  validationErrors?: string[];
  rawResponse?: Record<string, unknown>;
  error?: string;
}

export async function submitClaim(
  params: StediClaimSubmissionParams
): Promise<StediSubmissionResult> {
  if (!STEDI_API_KEY) {
    throw new Error("STEDI_API_KEY not configured");
  }

  let edi = params.ediContent;

  // Ensure ISA15 is 'P' (Production) — replace test indicator if present
  // ISA15 is the 15th element of the ISA segment (index 14, 0-based)
  edi = edi.replace(/^(ISA\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*[^*]*\*)T(\*)/m, "$1P$2");

  const response = await fetch(STEDI_CLAIMS_URL, {
    method: "POST",
    headers: {
      Authorization: `Key ${STEDI_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": params.claimId,
    },
    body: JSON.stringify({
      transactionSets: [edi],
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      success: false,
      rawResponse: data,
      error:
        (data as any).message ||
        (data as any).errors?.[0]?.description ||
        `Stedi API error: ${response.status}`,
    };
  }

  const txn = (data as any).transactionSets?.[0] || data;
  const accepted =
    txn.status === "Accepted" ||
    (data as any).status === "Accepted" ||
    response.status === 200;

  return {
    success: accepted,
    transactionId: txn.transactionId || (data as any).transactionId,
    controlNumber: txn.controlNumber || (data as any).controlNumber,
    status: txn.status || (accepted ? "Accepted" : "Rejected"),
    validationErrors: txn.errors || (data as any).errors || [],
    rawResponse: data as Record<string, unknown>,
    error: accepted
      ? undefined
      : txn.errors?.[0]?.message || "Claim rejected by Stedi",
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

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as any).message || `277 poll failed: ${response.status}`
    );
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

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as any).message || `835 poll failed: ${response.status}`
    );
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

function parseERAResponse(r: any) {
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
