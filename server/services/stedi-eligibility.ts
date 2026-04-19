const STEDI_API_KEY = process.env.STEDI_API_KEY;
const STEDI_ELIGIBILITY_URL =
  "https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/eligibility/v3";

export function isStediConfigured(): boolean {
  return !!STEDI_API_KEY;
}

export interface EligibilityRequest {
  controlNumber: string;
  tradingPartnerServiceId: string;
  providerNpi: string;
  providerName: string;
  subscriberFirstName: string;
  subscriberLastName: string;
  subscriberDob: string;
  subscriberMemberId: string;
  serviceTypeCodes?: string[];
}

export interface EligibilityResult {
  status: "active" | "inactive" | "error";
  policyStatus: string;
  policyType: string;
  planName: string | null;
  effectiveDate: string | null;
  termDate: string | null;
  copay: number | null;
  deductible: number | null;
  deductibleMet: number | null;
  coinsurance: number | null;
  outOfPocketMax: number | null;
  outOfPocketMet: number | null;
  priorAuthRequired: boolean;
  networkStatus: string;
  rawResponse: Record<string, unknown>;
  stediTransactionId: string | null;
  errorMessage: string | null;
}

export async function checkEligibility(
  req: EligibilityRequest
): Promise<EligibilityResult> {
  if (!STEDI_API_KEY) {
    throw new Error("Stedi API key not configured");
  }

  const body = {
    controlNumber: req.controlNumber,
    tradingPartnerServiceId: req.tradingPartnerServiceId,
    provider: {
      organizationName: req.providerName,
      npi: req.providerNpi,
    },
    subscriber: {
      firstName: req.subscriberFirstName.toUpperCase(),
      lastName: req.subscriberLastName.toUpperCase(),
      dateOfBirth: req.subscriberDob,
      memberId: req.subscriberMemberId,
    },
    encounter: {
      serviceTypeCodes: req.serviceTypeCodes || ["42"],
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  let response: Response;
  try {
    response = await fetch(STEDI_ELIGIBILITY_URL, {
      method: "POST",
      headers: {
        Authorization: `Key ${STEDI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json();

  if (!response.ok || data.status === "ERROR") {
    return {
      status: "error",
      policyStatus: "error",
      policyType: "",
      planName: null,
      effectiveDate: null,
      termDate: null,
      copay: null,
      deductible: null,
      deductibleMet: null,
      coinsurance: null,
      outOfPocketMax: null,
      outOfPocketMet: null,
      priorAuthRequired: false,
      networkStatus: "unknown",
      rawResponse: data,
      stediTransactionId: data.meta?.traceId || null,
      errorMessage:
        data.errors?.[0]?.description ||
        data.message ||
        "Eligibility check failed",
    };
  }

  const benefits = data.benefitsInformation || [];
  const planInfo = data.planInformation || {};
  const subscriber = data.subscriber || {};

  const coverageBenefit = benefits.find((b: any) => b.code === "1");
  const isActive =
    !!coverageBenefit || data.planStatus?.[0]?.statusCode === "1";

  const copayBenefit =
    benefits.find(
      (b: any) => b.code === "B" && b.serviceTypeCodes?.includes("42")
    ) || benefits.find((b: any) => b.code === "B");

  const deductibleBenefit =
    benefits.find(
      (b: any) => b.code === "C" && b.inPlanNetworkIndicatorCode === "Y"
    ) || benefits.find((b: any) => b.code === "C");

  const deductibleMetBenefit = benefits.find((b: any) => b.code === "G");

  const oopBenefit = benefits.find(
    (b: any) => b.code === "G" && b.serviceTypeCodes?.includes("30")
  );

  const coinsuranceBenefit = benefits.find((b: any) => b.code === "A");

  const priorAuthBenefit = benefits.find((b: any) => b.code === "AR");

  const networkIndicator =
    subscriber.inPlanNetworkIndicatorCode ||
    coverageBenefit?.inPlanNetworkIndicatorCode;

  const eligDates = data.planDateInformation || {};

  return {
    status: isActive ? "active" : "inactive",
    policyStatus: isActive ? "Active" : "Inactive",
    policyType: planInfo.groupDescription || subscriber.groupDescription || "",
    planName: planInfo.planDescription || data.planName || null,
    effectiveDate: eligDates.eligibilityBegin || eligDates.planBegin || null,
    termDate: eligDates.eligibilityEnd || eligDates.planEnd || null,
    copay: copayBenefit?.benefitAmount
      ? parseFloat(copayBenefit.benefitAmount)
      : null,
    deductible: deductibleBenefit?.benefitAmount
      ? parseFloat(deductibleBenefit.benefitAmount)
      : null,
    deductibleMet: deductibleMetBenefit?.benefitAmount
      ? parseFloat(deductibleMetBenefit.benefitAmount)
      : null,
    coinsurance: coinsuranceBenefit?.benefitPercent
      ? parseFloat(coinsuranceBenefit.benefitPercent)
      : null,
    outOfPocketMax: oopBenefit?.benefitAmount
      ? parseFloat(oopBenefit.benefitAmount)
      : null,
    outOfPocketMet: null,
    priorAuthRequired: !!priorAuthBenefit,
    networkStatus:
      networkIndicator === "Y"
        ? "in-network"
        : networkIndicator === "N"
        ? "out-of-network"
        : "unknown",
    rawResponse: data,
    stediTransactionId: data.meta?.traceId || null,
    errorMessage: null,
  };
}
