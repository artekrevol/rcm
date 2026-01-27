import { VobVerification } from "@shared/schema";

// VerifyTX uses OAuth 2.0 with username/password grant type
interface VerifyTxConfig {
  username: string;
  password: string;
  clientId: string;
  clientSecret: string;
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
  private username: string;
  private password: string;
  private clientId: string;
  private clientSecret: string;
  private facilityId: string;
  private baseUrl = "https://api.verifytx.com";
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(config: VerifyTxConfig) {
    this.username = config.username;
    this.password = config.password;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.facilityId = config.facilityId || "";
  }

  private async authenticate(): Promise<string> {
    // Return cached token if still valid
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.accessToken;
    }

    // Try refresh token first if available
    if (this.refreshToken) {
      try {
        return await this.refreshAccessToken();
      } catch (e) {
        // Fall through to password grant if refresh fails
        console.log("Refresh token expired, re-authenticating...");
      }
    }

    // OAuth 2.0 password grant type
    const params = new URLSearchParams({
      grant_type: "password",
      username: this.username,
      password: this.password,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const response = await fetch(`${this.baseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`VerifyTX authentication failed: ${error}`);
    }

    const data = await response.json();
    
    // Handle VerifyTX response format: { code: 200, message: { access_token, refresh_token, expires_in } }
    const tokenData = data.message || data;
    this.accessToken = tokenData.access_token;
    this.refreshToken = tokenData.refresh_token;
    
    // Token expires in 24 hours, set expiry to 23 hours for safety
    const expiresIn = tokenData.expires_in || 86400;
    this.tokenExpiry = new Date(Date.now() + (expiresIn - 3600) * 1000);

    if (!this.accessToken) {
      throw new Error("No access token received from VerifyTX");
    }

    return this.accessToken;
  }

  private async refreshAccessToken(): Promise<string> {
    if (!this.refreshToken) {
      throw new Error("No refresh token available");
    }

    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const response = await fetch(`${this.baseUrl}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      this.refreshToken = null;
      throw new Error("Refresh token expired");
    }

    const data = await response.json();
    const tokenData = data.message || data;
    this.accessToken = tokenData.access_token;
    this.refreshToken = tokenData.refresh_token || this.refreshToken;
    
    const expiresIn = tokenData.expires_in || 86400;
    this.tokenExpiry = new Date(Date.now() + (expiresIn - 3600) * 1000);

    return this.accessToken!;
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

  const username = process.env.VERIFYTX_USERNAME;
  const password = process.env.VERIFYTX_PASSWORD;
  const clientId = process.env.VERIFYTX_CLIENT_ID;
  const clientSecret = process.env.VERIFYTX_CLIENT_SECRET;
  const facilityId = process.env.VERIFYTX_FACILITY_ID;

  if (!username || !password || !clientId || !clientSecret) {
    console.log("VerifyTX credentials not configured - need VERIFYTX_USERNAME, VERIFYTX_PASSWORD, VERIFYTX_CLIENT_ID, VERIFYTX_CLIENT_SECRET");
    return null;
  }

  clientInstance = new VerifyTxClient({
    username,
    password,
    clientId,
    clientSecret,
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
