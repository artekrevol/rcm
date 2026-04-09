function getCARCDescription(code: string): string {
  const carcs: Record<string, string> = {
    "1": "Deductible amount",
    "2": "Coinsurance amount",
    "4": "The service/claim requires a valid modifier",
    "16": "Claim/service lacks information needed for adjudication",
    "18": "Exact duplicate claim",
    "29": "The time limit for filing has expired",
    "50": "These are non-covered services",
    "97": "The benefit for this service is included in another service",
    "167": "This does not meet the medical necessity criteria",
    "170": "Payment is denied when performed by this type of provider",
    "236":
      "This procedure or procedure/modifier combination is not compatible with another procedure",
  };
  return carcs[code] || `CARC ${code}`;
}

export function parse277(
  ediContent: string
): Array<{
  claimId: string;
  status: "accepted" | "rejected";
  statusCode: string;
  statusDescription: string;
  rejectReasons?: string[];
}> {
  const segments = ediContent.split("\n").map((s) => s.trim());
  const results: Array<{
    claimId: string;
    status: "accepted" | "rejected";
    statusCode: string;
    statusDescription: string;
    rejectReasons: string[];
  }> = [];
  let currentClaim: any = null;

  for (const segment of segments) {
    const elements = segment.split("*");

    if (elements[0] === "CLM") {
      currentClaim = { claimId: elements[1], rejectReasons: [] };
    }

    if (elements[0] === "STC" && currentClaim) {
      const statusCode = elements[1]?.split(":")[0];
      currentClaim.status = statusCode === "A1" ? "accepted" : "rejected";
      currentClaim.statusCode = statusCode;
      currentClaim.statusDescription = elements[2] || "";
    }

    if (elements[0] === "REF" && currentClaim && elements[1] === "D9") {
      currentClaim.rejectReasons.push(elements[2]);
    }

    if (elements[0] === "SE" && currentClaim) {
      results.push(currentClaim);
      currentClaim = null;
    }
  }

  return results;
}

export function parse835(
  ediContent: string
): Array<{
  claimId: string;
  paidAmount: number;
  denialReasonCode: string | null;
  denialReasonDescription: string | null;
  remarkCode: string | null;
  patientResponsibility: number;
  adjustments: Array<{
    groupCode: string;
    reasonCode: string;
    amount: number;
  }>;
}> {
  const segments = ediContent.split("\n").map((s) => s.trim());
  const results: Array<{
    claimId: string;
    paidAmount: number;
    denialReasonCode: string | null;
    denialReasonDescription: string | null;
    remarkCode: string | null;
    patientResponsibility: number;
    adjustments: Array<{
      groupCode: string;
      reasonCode: string;
      amount: number;
    }>;
  }> = [];
  let currentClaim: any = null;

  for (const segment of segments) {
    const elements = segment.split("*");

    if (elements[0] === "CLP") {
      if (currentClaim) results.push(currentClaim);
      currentClaim = {
        claimId: elements[1],
        paidAmount: parseFloat(elements[4]) || 0,
        denialReasonCode: null,
        denialReasonDescription: null,
        remarkCode: null,
        patientResponsibility: 0,
        adjustments: [],
      };
    }

    if (elements[0] === "CAS" && currentClaim) {
      const groupCode = elements[1];
      const reasonCode = elements[2];
      const amount = parseFloat(elements[3]) || 0;

      currentClaim.adjustments.push({ groupCode, reasonCode, amount });

      if (!currentClaim.denialReasonCode && groupCode === "CO") {
        currentClaim.denialReasonCode = reasonCode;
        currentClaim.denialReasonDescription = getCARCDescription(reasonCode);
      }

      if (groupCode === "PR") {
        currentClaim.patientResponsibility += amount;
      }
    }

    if (elements[0] === "MOA" && currentClaim) {
      currentClaim.remarkCode = elements[2] || null;
    }
  }

  if (currentClaim) results.push(currentClaim);
  return results;
}
