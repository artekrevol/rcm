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
  payerName?: string;
  gender?: string;
  phone?: string;
  email?: string;
  clientType?: string;
}

interface Payer {
  payer_id: string;
  payer_name: string;
  claim_id?: string;
  featured?: boolean;
  archived?: boolean;
  _id?: string;
}

// Actual VerifyTX VOB response structure based on API docs
interface VerifyTxVobResponse {
  _id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  gender?: string;
  member_id: string;
  payer_id: string;
  payer_name: string;
  facility?: string;
  status: string;
  client_type?: string;
  phone?: string;
  email?: string;
  archived?: boolean;
  error?: string;
  error_status?: string;
  error_status_code?: string;
  response_status?: string;
  response_status_code?: string;
  request_duration?: number;
  as_of_date?: string;
  created_at?: string;
  updated_at?: string;
  cache?: {
    reference_number?: string;
    status?: string;
    insurance_details?: {
      coverage?: string;
      insurance_type?: {
        description?: string;
        label?: string;
        code?: string;
        level?: string;
        meta?: {
          code?: string;
          blimp?: string;
          description?: string;
          color?: string;
        };
      };
      coverage_dates?: {
        start?: string;
        end?: string;
      };
      premium_paid_to_end_date?: string | null;
      payer?: {
        payer_name?: string;
        payer_id?: string;
      };
      plan_name?: string | null;
      plan_sponsor?: string;
      plan_dates?: {
        start?: string | null;
        end?: string | null;
      };
      group_number?: string;
      notes?: Array<{
        type?: string;
        typeCode?: string;
        message?: string;
      }>;
    };
    subscriber_details?: {
      subscriber?: string;
      first_name?: string;
      last_name?: string;
      date_of_birth?: string;
      member_id?: string;
      address?: {
        address?: string;
        city?: string;
        state?: string;
        zip?: string;
        string?: string;
      };
    };
    client_details?: {
      name?: string;
      first_name?: string;
      last_name?: string;
      subscriber_relation?: string;
      date_of_birth?: string;
      address?: {
        address?: string;
        city?: string;
        state?: string;
        zip?: string;
        string?: string;
      };
      gender?: string;
    };
    primary_care_provider?: {
      name?: string | null;
      npi?: string | null;
      address?: string | null;
      contact?: string | null;
    };
    additional_payers?: Array<{
      type?: string;
      typeCode?: string;
      name?: string;
      thirdPartyAdministrator?: boolean;
      planNumber?: string;
      planNetworkId?: string;
      planNetworkName?: string;
      benefitBeginDate?: string;
      address?: {
        line1?: string;
        city?: string;
        state?: string;
        stateCode?: string;
        zipCode?: string;
      };
      contactInformation?: Array<{
        phone?: string;
        url?: string;
      }>;
    }>;
    benefits?: {
      no_network?: BenefitCategory[];
      in_network?: BenefitCategory[];
      out_of_network?: BenefitCategory[];
    };
  };
  facility_meta?: {
    _id?: string;
    name?: string;
    npi?: string;
    tax_id?: string;
    city?: string;
    state?: string;
    zip?: string;
    address_1?: string;
  };
  payer?: {
    payer_id?: string;
    claim_id?: string;
    featured?: boolean;
    archived?: boolean;
    payer_name?: string;
    _id?: string;
  };
  coverage?: string;
  insurance_type?: {
    description?: string;
    label?: string;
    code?: string;
    level?: string;
    meta?: {
      code?: string;
      blimp?: string;
      description?: string;
      color?: string;
    };
  };
  reference_number?: string;
  is_shared?: boolean;
}

interface BenefitCategory {
  name?: string;
  status?: string;
  type?: string;
  description?: string[];
  coInsurance?: Array<{
    insuranceType?: string;
    insuranceTypeCode?: string;
    amount?: string;
    units?: string;
    amountTimePeriod?: string;
    amountTimePeriodCode?: string;
    coverageStartDate?: string;
    coverageEndDate?: string;
    noNetwork?: boolean;
  }>;
  deductibles?: Array<{
    insuranceType?: string;
    insuranceTypeCode?: string;
    amount?: string;
    units?: string;
    amountTimePeriod?: string;
    amountTimePeriodCode?: string;
    remaining?: string;
    remainingTimePeriod?: string;
    remainingTimePeriodCode?: string;
    total?: string;
    totalTimePeriod?: string;
    totalTimePeriodCode?: string;
    level?: string;
    levelCode?: string;
    coverageStartDate?: string;
    coverageEndDate?: string;
    payerNotes?: string[];
    notApplicableNetwork?: boolean;
    noNetwork?: boolean;
  }>;
  outOfPocket?: Array<{
    amount?: string;
    units?: string;
    amountTimePeriod?: string;
    amountTimePeriodCode?: string;
    remaining?: string;
    remainingTimePeriod?: string;
    remainingTimePeriodCode?: string;
    total?: string;
    totalTimePeriod?: string;
    totalTimePeriodCode?: string;
    level?: string;
    levelCode?: string;
    payerNotes?: string[];
    notApplicableNetwork?: boolean;
  }>;
  coPayment?: Array<{
    insuranceType?: string;
    insuranceTypeCode?: string;
    amount?: string;
    units?: string;
    amountTimePeriod?: string;
    amountTimePeriodCode?: string;
    admissionDate?: string;
    deliveryInformation?: Array<{
      per?: string;
      perCode?: string;
      timePeriod?: string;
      timePeriodCode?: string;
      timePeriods?: string;
    }>;
    noNetwork?: boolean;
  }>;
  coverageBasis?: unknown[];
  limitations?: unknown[];
  nonCovered?: unknown[];
  contacts?: Array<{
    type?: string | null;
    name?: string | null;
    category?: string;
    payer_id?: string | null;
    address?: string | null;
    notes?: string[];
    info?: string | null;
  }>;
}

// Separate type for benefits to avoid TypeScript issues with nested optional properties
interface VobBenefits {
  no_network?: BenefitCategory[];
  in_network?: BenefitCategory[];
  out_of_network?: BenefitCategory[];
}

interface VobListResponse {
  sort?: {
    updated_at?: number;
  };
  total?: number;
  data?: VerifyTxVobResponse[];
}

interface PayerSearchResponse {
  data?: Payer[];
  total?: number;
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
    // or direct format: { access_token, refresh_token, expires_in }
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

  // Search payers by name
  async searchPayers(query: string): Promise<Payer[]> {
    try {
      // Try the search endpoint first
      const result = await this.request<PayerSearchResponse | Payer[]>(
        "GET",
        `/payers/search?q=${encodeURIComponent(query)}`
      );
      
      // Handle different response formats
      if (Array.isArray(result)) {
        return result;
      }
      return result.data || [];
    } catch (error) {
      console.log("Payer search endpoint failed, trying alternate:", error);
      
      // Try alternate endpoint format
      try {
        const result = await this.request<PayerSearchResponse | Payer[]>(
          "GET",
          `/payers?search=${encodeURIComponent(query)}`
        );
        
        if (Array.isArray(result)) {
          return result;
        }
        return result.data || [];
      } catch (altError) {
        console.log("Alternate payer search also failed:", altError);
        throw error;
      }
    }
  }

  // Get all payers
  async getAllPayers(): Promise<Payer[]> {
    const result = await this.request<PayerSearchResponse | Payer[]>(
      "GET",
      "/payers"
    );
    
    if (Array.isArray(result)) {
      return result;
    }
    return result.data || [];
  }

  // Get featured/common payers
  async getFeaturedPayers(): Promise<Payer[]> {
    try {
      const result = await this.request<PayerSearchResponse | Payer[]>(
        "GET",
        "/payers?featured=true"
      );
      
      if (Array.isArray(result)) {
        return result;
      }
      return result.data || [];
    } catch (error) {
      // Fall back to all payers if featured endpoint doesn't work
      return this.getAllPayers();
    }
  }

  // Create a new VOB verification request
  async createVob(request: VerifyRequest): Promise<VerifyTxVobResponse> {
    const result = await this.request<VerifyTxVobResponse>(
      "POST",
      "/vobs",
      {
        first_name: request.firstName.toUpperCase(),
        last_name: request.lastName.toUpperCase(),
        date_of_birth: request.dateOfBirth,
        member_id: request.memberId,
        payer_id: request.payerId,
        payer_name: request.payerName,
        facility: this.facilityId || undefined,
        gender: request.gender,
        phone: request.phone,
        email: request.email,
        client_type: request.clientType || "prospect",
      }
    );
    return result;
  }

  // Get VOB by ID
  async getVob(vobId: string): Promise<VerifyTxVobResponse> {
    return this.request<VerifyTxVobResponse>("GET", `/vobs/${vobId}`);
  }

  // List all VOBs
  async listVobs(params?: { 
    page?: number; 
    limit?: number; 
    status?: string;
    archived?: boolean;
  }): Promise<VobListResponse> {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.set("page", params.page.toString());
    if (params?.limit) queryParams.set("limit", params.limit.toString());
    if (params?.status) queryParams.set("status", params.status);
    if (params?.archived !== undefined) queryParams.set("archived", params.archived.toString());
    
    const queryString = queryParams.toString();
    const endpoint = queryString ? `/vobs?${queryString}` : "/vobs";
    
    return this.request<VobListResponse>("GET", endpoint);
  }

  // Re-verify an existing VOB
  async reverify(vobId: string): Promise<VerifyTxVobResponse> {
    return this.request<VerifyTxVobResponse>("POST", `/vobs/${vobId}/reverify`);
  }

  // Export VOB as PDF
  async exportPdf(vobId: string): Promise<{ url?: string; data?: string }> {
    return this.request<{ url?: string; data?: string }>(
      "GET",
      `/vobs/${vobId}/export`
    );
  }

  // Get VOB history
  async getVobHistory(vobId: string): Promise<{ data?: unknown[] }> {
    return this.request<{ data?: unknown[] }>(
      "GET",
      `/vobs/${vobId}/history`
    );
  }

  // Archive a VOB
  async archiveVob(vobId: string): Promise<VerifyTxVobResponse> {
    return this.request<VerifyTxVobResponse>(
      "PATCH",
      `/vobs/${vobId}`,
      { archived: true }
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

// Helper to extract deductible info from benefits
function extractDeductible(benefits?: VobBenefits): { deductible?: number; deductibleMet?: number } {
  if (!benefits) return {};
  
  // Check in_network first, then no_network
  const networks = [benefits.in_network, benefits.no_network, benefits.out_of_network];
  
  for (const network of networks) {
    if (!network) continue;
    
    // Find Health Benefit Plan Coverage or first benefit with deductibles
    const healthBenefit = network.find((b: BenefitCategory) => b.type === "30" || b.name === "Health Benefit Plan Coverage");
    if (healthBenefit?.deductibles?.length) {
      const ded = healthBenefit.deductibles[0];
      return {
        deductible: ded.total ? parseFloat(ded.total) : undefined,
        deductibleMet: ded.amount ? parseFloat(ded.amount) : undefined,
      };
    }
  }
  
  return {};
}

// Helper to extract out of pocket info from benefits
function extractOutOfPocket(benefits?: VobBenefits): { outOfPocketMax?: number; outOfPocketMet?: number } {
  if (!benefits) return {};
  
  const networks = [benefits.in_network, benefits.no_network, benefits.out_of_network];
  
  for (const network of networks) {
    if (!network) continue;
    
    const healthBenefit = network.find((b: BenefitCategory) => b.type === "30" || b.name === "Health Benefit Plan Coverage");
    if (healthBenefit?.outOfPocket?.length) {
      const oop = healthBenefit.outOfPocket[0];
      return {
        outOfPocketMax: oop.total ? parseFloat(oop.total) : undefined,
        outOfPocketMet: oop.amount ? parseFloat(oop.amount) : undefined,
      };
    }
  }
  
  return {};
}

// Helper to extract copay info from benefits
function extractCopay(benefits?: VobBenefits): number | undefined {
  if (!benefits) return undefined;
  
  const networks = [benefits.in_network, benefits.no_network, benefits.out_of_network];
  
  for (const network of networks) {
    if (!network) continue;
    
    // Look for Office Visit or Mental Health copay
    for (const benefit of network) {
      if (benefit.coPayment?.length) {
        const copay = benefit.coPayment[0];
        if (copay.amount) {
          return parseFloat(copay.amount);
        }
      }
    }
  }
  
  return undefined;
}

// Helper to extract coinsurance
function extractCoinsurance(benefits?: VobBenefits): number | undefined {
  if (!benefits) return undefined;
  
  const networks = [benefits.in_network, benefits.no_network, benefits.out_of_network];
  
  for (const network of networks) {
    if (!network) continue;
    
    for (const benefit of network) {
      if (benefit.coInsurance?.length) {
        const coins = benefit.coInsurance[0];
        if (coins.amount) {
          // Convert from decimal (0.2) to percentage (20)
          const amount = parseFloat(coins.amount);
          return amount < 1 ? amount * 100 : amount;
        }
      }
    }
  }
  
  return undefined;
}

// Helper to collect payer notes
function collectPayerNotes(response: VerifyTxVobResponse): string | undefined {
  const notes: string[] = [];
  
  // Add insurance notes
  if (response.cache?.insurance_details?.notes) {
    for (const note of response.cache.insurance_details.notes) {
      if (note.message) {
        notes.push(note.message);
      }
    }
  }
  
  // Add any error messages
  if (response.error) {
    notes.push(response.error);
  }
  
  return notes.length > 0 ? notes.join("\n\n") : undefined;
}

export function mapVerifyTxResponse(
  response: VerifyTxVobResponse,
  request: { payerId: string; payerName: string; memberId: string }
): Partial<VobVerification> {
  const cache = response.cache;
  const insuranceDetails = cache?.insurance_details;
  const benefits = cache?.benefits;
  
  // Determine status based on response
  let status: VobVerification["status"] = "pending";
  if (response.error || response.error_status) {
    status = "error";
  } else if (cache?.status === "Complete") {
    status = "verified";
  }
  
  // Extract financial details from benefits
  const deductibleInfo = extractDeductible(benefits);
  const oopInfo = extractOutOfPocket(benefits);
  const copay = extractCopay(benefits);
  const coinsurance = extractCoinsurance(benefits);
  
  return {
    verifytxVobId: response._id,
    payerId: response.payer_id || request.payerId,
    payerName: response.payer_name || request.payerName,
    memberId: response.member_id || request.memberId,
    status,
    policyStatus: insuranceDetails?.coverage || response.coverage,
    policyType: insuranceDetails?.insurance_type?.label || response.insurance_type?.label,
    planName: insuranceDetails?.plan_sponsor || insuranceDetails?.plan_name || undefined,
    effectiveDate: insuranceDetails?.coverage_dates?.start || undefined,
    termDate: insuranceDetails?.coverage_dates?.end || undefined,
    copay,
    deductible: deductibleInfo.deductible,
    deductibleMet: deductibleInfo.deductibleMet,
    coinsurance,
    outOfPocketMax: oopInfo.outOfPocketMax,
    outOfPocketMet: oopInfo.outOfPocketMet,
    benefitsRemaining: oopInfo.outOfPocketMax && oopInfo.outOfPocketMet 
      ? oopInfo.outOfPocketMax - oopInfo.outOfPocketMet 
      : undefined,
    priorAuthRequired: undefined, // VerifyTX doesn't seem to include this directly
    networkStatus: insuranceDetails?.insurance_type?.code 
      ? `${insuranceDetails.insurance_type.label} (${insuranceDetails.insurance_type.code})` 
      : undefined,
    coverageLimits: insuranceDetails?.group_number 
      ? `Group: ${insuranceDetails.group_number}` 
      : undefined,
    payerNotes: collectPayerNotes(response),
    rawResponse: response as unknown as Record<string, unknown>,
    errorMessage: response.error || response.error_status || undefined,
    verifiedAt: new Date(),
  };
}

export type { VerifyTxClient, VerifyRequest, Payer, VerifyTxVobResponse, BenefitCategory };
