import { VobVerification } from "@shared/schema";

interface VerifyTxConfig {
  apiKey: string;
  apiSecret: string;
  facilityId?: string;
}

interface VerifyRequest {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  memberId: string;
  payerId: string;
}

interface Payer {
  payerId: string;
  payerName: string;
}

interface VerifyTxVobResponse {
  code: number;
  message: string;
  data?: {
    id: string;
    status: string;
    policyStatus?: string;
    policyType?: string;
    planName?: string;
    effectiveDate?: string;
    termDate?: string;
    copay?: number;
    deductible?: number;
    deductibleMet?: number;
    coinsurance?: number;
    outOfPocketMax?: number;
    outOfPocketMet?: number;
    priorAuthRequired?: boolean;
    networkStatus?: string;
    coverageLimits?: string;
    payerNotes?: string;
    benefitsRemaining?: number;
    rawData?: Record<string, unknown>;
  };
}

class VerifyTxClient {
  private apiKey: string;
  private apiSecret: string;
  private facilityId: string;
  private baseUrl = "https://api.verifytx.com";
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(config: VerifyTxConfig) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.facilityId = config.facilityId || "default";
  }

  private async authenticate(): Promise<string> {
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.accessToken;
    }

    const response = await fetch(`${this.baseUrl}/auth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        apiKey: this.apiKey,
        apiSecret: this.apiSecret,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`VerifyTX authentication failed: ${error}`);
    }

    const data = await response.json();
    this.accessToken = data.accessToken || data.access_token || data.token;
    this.tokenExpiry = new Date(Date.now() + 55 * 60 * 1000);

    if (!this.accessToken) {
      throw new Error("No access token received from VerifyTX");
    }

    return this.accessToken;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    const token = await this.authenticate();

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`VerifyTX API error (${response.status}): ${error}`);
    }

    return response.json();
  }

  async searchPayers(query: string): Promise<Payer[]> {
    const result = await this.request<{ code: number; message: Payer[] }>(
      "GET",
      `/payers/search/${encodeURIComponent(query)}`
    );
    return result.message || [];
  }

  async getAllPayers(): Promise<Payer[]> {
    const result = await this.request<{ code: number; message: Payer[] }>(
      "GET",
      "/payers"
    );
    return result.message || [];
  }

  async verify(request: VerifyRequest): Promise<VerifyTxVobResponse> {
    const result = await this.request<VerifyTxVobResponse>(
      "POST",
      "/vobs/verify",
      {
        date_of_birth: request.dateOfBirth,
        first_name: request.firstName.toUpperCase(),
        last_name: request.lastName.toUpperCase(),
        member_id: request.memberId,
        payer_id: request.payerId,
        facility: this.facilityId,
      }
    );
    return result;
  }

  async getVob(vobId: string): Promise<VerifyTxVobResponse> {
    return this.request<VerifyTxVobResponse>("GET", `/vobs/${vobId}`);
  }

  async reverify(vobId: string): Promise<VerifyTxVobResponse> {
    return this.request<VerifyTxVobResponse>("POST", `/vobs/reverify/${vobId}`);
  }

  async exportPdf(vobId: string): Promise<{ code: number; message: string }> {
    return this.request<{ code: number; message: string }>(
      "GET",
      `/vobs/export/${vobId}`
    );
  }

  async getVobHistory(
    vobId: string
  ): Promise<{ code: number; message: unknown[] }> {
    return this.request<{ code: number; message: unknown[] }>(
      "GET",
      `/vobs/history/${vobId}`
    );
  }
}

let clientInstance: VerifyTxClient | null = null;

export function getVerifyTxClient(): VerifyTxClient | null {
  if (clientInstance) {
    return clientInstance;
  }

  const apiKey = process.env.VERIFYTX_API_KEY;
  const apiSecret = process.env.VERIFYTX_API_SECRET;
  const facilityId = process.env.VERIFYTX_FACILITY_ID;

  if (!apiKey || !apiSecret) {
    console.log("VerifyTX credentials not configured");
    return null;
  }

  clientInstance = new VerifyTxClient({
    apiKey,
    apiSecret,
    facilityId,
  });

  return clientInstance;
}

export function resetVerifyTxClient(): void {
  clientInstance = null;
}

export function mapVerifyTxResponse(
  response: VerifyTxVobResponse,
  request: { payerId: string; payerName: string; memberId: string }
): Partial<VobVerification> {
  const data = response.data;

  if (!data) {
    return {
      payerId: request.payerId,
      payerName: request.payerName,
      memberId: request.memberId,
      status: "error",
      errorMessage: response.message || "No data returned",
    };
  }

  return {
    verifytxVobId: data.id,
    payerId: request.payerId,
    payerName: request.payerName,
    memberId: request.memberId,
    status: data.status === "complete" ? "verified" : data.status || "pending",
    policyStatus: data.policyStatus,
    policyType: data.policyType,
    planName: data.planName,
    effectiveDate: data.effectiveDate,
    termDate: data.termDate,
    copay: data.copay,
    deductible: data.deductible,
    deductibleMet: data.deductibleMet,
    coinsurance: data.coinsurance,
    outOfPocketMax: data.outOfPocketMax,
    outOfPocketMet: data.outOfPocketMet,
    benefitsRemaining: data.benefitsRemaining,
    priorAuthRequired: data.priorAuthRequired,
    networkStatus: data.networkStatus,
    coverageLimits: data.coverageLimits,
    payerNotes: data.payerNotes,
    rawResponse: data.rawData || data as unknown as Record<string, unknown>,
    verifiedAt: new Date(),
  };
}

export type { VerifyTxClient, VerifyRequest, Payer, VerifyTxVobResponse };
