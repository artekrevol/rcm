import type { SectionType } from "./manual-extractor";

// ── Existing result interfaces (unchanged) ────────────────────────────────────

export interface TimelyFilingResult {
  days: number;
  exceptions: string[];
  source_text: string;
}

export interface PriorAuthResult {
  cpt_codes: string[];
  requires_auth: boolean;
  criteria: string;
  threshold_units: number | null;
  source_text: string;
}

// Upgraded from flat ModifierResult — old rows flagged needs_manual_remap
export interface ModifiersAndLiabilityResult {
  modifier_code: string;
  description: string;
  conditions_required: string[];
  conditions_excluded: string[];
  liability_assignment: "member" | "provider" | "payer";
  payer_rule: string;
  appeal_path_if_denied: string;
  source_quote: string;
}

export interface AppealsResult {
  deadline_days: number;
  level: string;
  submission_method: string;
  requirements: string[];
  source_text: string;
}

// ── Prompt B1: new result interfaces ─────────────────────────────────────────

export interface ReferralsResult {
  applies_to_plan_products: string[];
  referral_required: boolean;
  referral_source: "PCP" | "specialist" | "any_network" | "not_required";
  referral_format: "electronic_278" | "manual_form" | "verbal" | "not_specified";
  liability_if_missing: "provider" | "member" | "payer";
  exceptions: string[];
  state_overrides: Record<string, string>;
  source_quote: string;
}

export interface CoordinationOfBenefitsResult {
  cob_scenario: "Medicare_crossover" | "MSP" | "dual_coverage" | "tertiary" | "general";
  primary_payer_rule: string;
  documentation_required: string[];
  billing_order: string;
  crossover_process: string;
  requires_primary_eob_attached: boolean;
  source_quote: string;
}

export interface PayerSpecificEditsResult {
  edit_name: string;
  edit_category: "Return-and-Documentation" | "Rejection" | "Documentation";
  trigger_condition: string;
  response_window_days: number | null;
  auto_process_if_no_response: boolean;
  auto_remediation_available: boolean;
  remediation: string;
  source_quote: string;
}

export interface EdiConstructionResult {
  field_name: string;
  segment_or_loop: string;
  format_requirement: string;
  applies_to_claim_type: string;
  source_quote: string;
}

export interface PlaceOfServiceResult {
  pos_codes: string[];
  applicable_cpts: string[];
  restriction: "allowed" | "denied" | "requires_modifier" | "requires_specific_pos";
  modifier_required: string;
  source_quote: string;
}

export interface SubmissionTimeframeResult {
  event_name: string;
  days_advance_required: number | null;
  days_type: "calendar" | "business";
  applies_to_service_type: string;
  applies_to_cpts: string[];
  source_quote: string;
}

export interface DecisionTimeframeResult {
  decision_type: "standard" | "expedited" | "urgent" | "concurrent";
  days_allowed: number | null;
  days_type: "calendar" | "business" | "hours";
  applies_to_plan_products: string[];
  source_quote: string;
}

export interface DocumentationTimeframeResult {
  record_type: string;
  days_allowed: number | null;
  days_type: "calendar" | "business" | "hours";
  trigger_event: "request_received" | "discharge" | "audit_initiated" | "lab_completed" | "other";
  transfer_method: string;
  source_quote: string;
}

export interface NotificationEventResult {
  event_name: string;
  notification_trigger: string;
  days_advance_required: number | null;
  recipient: "payer" | "member" | "both";
  format_required: string;
  failure_consequence: "provider_liability" | "denial" | "warning_only" | "informational";
  source_quote: string;
}

export interface MemberNoticeResult {
  notice_type: string;
  days_before_required: number | null;
  circumstance: string;
  written_consent_required: boolean;
  source_quote: string;
}

export type ExtractionResult =
  | TimelyFilingResult
  | PriorAuthResult
  | ModifiersAndLiabilityResult
  | AppealsResult
  | ReferralsResult
  | CoordinationOfBenefitsResult
  | PayerSpecificEditsResult
  | EdiConstructionResult
  | PlaceOfServiceResult
  | SubmissionTimeframeResult
  | DecisionTimeframeResult
  | DocumentationTimeframeResult
  | NotificationEventResult
  | MemberNoticeResult;

// ── Claude prompts ────────────────────────────────────────────────────────────

const SYSTEM_PROMPTS: Record<SectionType, string> = {
  timely_filing: `You are a healthcare billing expert. Extract timely filing rules from the provided payer manual text.
Return ONLY valid JSON with this structure:
{
  "days": <integer — number of days from service date to submit claim>,
  "exceptions": [<string — any noted exceptions>],
  "source_text": <string — the exact sentence(s) from the text that contain the rule>
}
If you cannot find a clear timely filing deadline, return {"days": 0, "exceptions": [], "source_text": "Not found in provided text"}.`,

  prior_auth: `You are a healthcare billing expert. Extract prior authorization requirements from the provided payer manual text.
Return ONLY valid JSON with this structure:
{
  "cpt_codes": [<string — CPT/HCPCS codes that require auth, or [] if applies broadly>],
  "requires_auth": <boolean — true if auth is required>,
  "criteria": <string — describe what services or conditions require auth>,
  "threshold_units": <integer or null — visit/unit limit before auth required, null if not specified>,
  "source_text": <string — exact sentence(s) from the text containing the rule>
}`,

  modifiers_and_liability: `You are a healthcare billing expert. Extract billing modifier rules from the provided payer manual text.
Focus on the conditional logic that determines WHO is financially liable for the service.
Return ONLY valid JSON with this structure:
{
  "modifier_code": <string — the modifier code e.g. "GA", "GZ", "GY", "59", "25", "26", "TC", "95">,
  "description": <string — what the modifier means clinically and administratively>,
  "conditions_required": [<string — conditions that must ALL be true for this modifier to apply, e.g. "noncovered_service", "advance_written_consent_signed", "IDN_issued">],
  "conditions_excluded": [<string — conditions that PREVENT this modifier from applying>],
  "liability_assignment": <"member" | "provider" | "payer" — who pays when this modifier is used>,
  "payer_rule": <string — the specific payer policy about when to use or not use this modifier>,
  "appeal_path_if_denied": <string — what to do if a claim using this modifier is denied, or "" if not stated>,
  "source_quote": <string — verbatim sentence(s) from the source text>
}
Extract ONE modifier per response. Focus on the modifier with the clearest liability implications.`,

  appeals: `You are a healthcare billing expert. Extract the claims appeal process from the provided payer manual text.
Return ONLY valid JSON with this structure:
{
  "deadline_days": <integer — days from remittance/denial to file appeal>,
  "level": <string — e.g. "Redetermination", "Reconsideration", "Level 1", "First Level">,
  "submission_method": <string — how to submit: mail, fax, online portal, etc.>,
  "requirements": [<string — list of documents/info required>],
  "source_text": <string — exact sentence(s) from the text containing the rule>
}`,

  referrals: `You are a healthcare billing expert. Extract referral requirements from the provided payer manual text.
Focus on which plan products require referrals, what type of referral is needed, and what happens when one is missing.
Return ONLY valid JSON with this structure:
{
  "applies_to_plan_products": [<string — plan product names, e.g. "HMO", "HMO-POS", "MA HMO", "Individual Exchange" — or [] if applies to all>],
  "referral_required": <boolean — true if a referral is required>,
  "referral_source": <"PCP" | "specialist" | "any_network" | "not_required">,
  "referral_format": <"electronic_278" | "manual_form" | "verbal" | "not_specified">,
  "liability_if_missing": <"provider" | "member" | "payer" — who bears financial liability when referral is absent>,
  "exceptions": [<string — services or situations exempt from referral requirement, e.g. "OB self-referral", "emergency services">],
  "state_overrides": {<state_code>: <string description of override>},
  "source_quote": <string — verbatim sentence(s) from the source text>
}
If referrals are not discussed, return {"referral_required": false, "referral_source": "not_required", "referral_format": "not_specified", "liability_if_missing": "provider", "applies_to_plan_products": [], "exceptions": [], "state_overrides": {}, "source_quote": "Not found in provided text"}.`,

  coordination_of_benefits: `You are a healthcare billing expert. Extract coordination of benefits (COB) rules from the provided payer manual text.
Focus on Medicare Secondary Payer (MSP), Medicare crossover claims, dual-coverage billing order, and required EOB documentation.
Return ONLY valid JSON with this structure:
{
  "cob_scenario": <"Medicare_crossover" | "MSP" | "dual_coverage" | "tertiary" | "general">,
  "primary_payer_rule": <string — rule determining who is primary payer>,
  "documentation_required": [<string — documents required, e.g. "primary EOB", "MSP questionnaire", "remittance advice">],
  "billing_order": <string — description of the billing sequence>,
  "crossover_process": <string — how crossover/coordination claims must be submitted, or "" if not stated>,
  "requires_primary_eob_attached": <boolean — true if EOB from primary payer must be attached>,
  "source_quote": <string — verbatim sentence(s) from the source text>
}`,

  payer_specific_edits: `You are a healthcare billing expert. Extract payer-specific clearinghouse edit rules from the provided payer manual text.
Focus on Smart Edits, Return-and-Documentation edits, Rejection edits, and response windows.
Do NOT include universal HIPAA edits or CCI edits — only payer-specific edits.
Return ONLY valid JSON with this structure:
{
  "edit_name": <string — name or code of the specific edit, e.g. "Smart Edit", "Return Smart Edit">,
  "edit_category": <"Return-and-Documentation" | "Rejection" | "Documentation">,
  "trigger_condition": <string — what causes this edit to fire>,
  "response_window_days": <integer or null — days to respond before auto-processing, e.g. 5>,
  "auto_process_if_no_response": <boolean — true if payer auto-processes when no response received>,
  "auto_remediation_available": <boolean — true if payer offers automated correction tooling>,
  "remediation": <string — steps to resolve this edit>,
  "source_quote": <string — verbatim sentence(s) from the source text>
}`,

  edi_construction: `You are a healthcare billing expert. Extract EDI field-level construction requirements from the provided payer manual text.
Focus on 837 transaction-specific requirements: field formats, segment/loop specs, NDC formatting, qualifier codes, taxonomy requirements.
Do NOT include general HIPAA transaction requirements — only payer-specific EDI construction rules.
Return ONLY valid JSON with this structure:
{
  "field_name": <string — descriptive name of the field or data element, e.g. "NDC code", "DEX Z-code for molecular pathology">,
  "segment_or_loop": <string — EDI segment or loop reference, e.g. "Loop 2400 LIN03", "CTP04-05", "MEA segment">,
  "format_requirement": <string — exact formatting rule, e.g. "11-digit NDC in 5-4-2 format without hyphens">,
  "applies_to_claim_type": <string — claim type this applies to, e.g. "837P professional", "all claim types">,
  "source_quote": <string — verbatim sentence(s) from the source text>
}`,

  place_of_service: `You are a healthcare billing expert. Extract place of service (POS) rules from the provided payer manual text.
Focus on POS code requirements, facility vs non-facility distinctions, telehealth site rules, and POS restrictions by service type.
Return ONLY valid JSON with this structure:
{
  "pos_codes": [<string — POS codes this rule applies to, e.g. "02", "10", "11", "22", "23">],
  "applicable_cpts": [<string — CPT/HCPCS codes this POS rule applies to, or [] if applies broadly>],
  "restriction": <"allowed" | "denied" | "requires_modifier" | "requires_specific_pos">,
  "modifier_required": <string — modifier required when this POS is used, e.g. "GT", "95", or "" if none>,
  "source_quote": <string — verbatim sentence(s) from the source text>
}`,

  submission_timeframe: `You are a healthcare billing expert. Extract advance submission deadline rules from the provided payer manual text.
Focus on how far in ADVANCE a request must be submitted BEFORE a service occurs.
This is NOT about timely filing (post-service). This is about pre-service submission windows.
Return ONLY valid JSON with this structure:
{
  "event_name": <string — descriptive name, e.g. "Prior Authorization Request", "Home Health Advance Notice", "DME Prior Notice">,
  "days_advance_required": <integer or null — number of days advance submission required, null if not stated as a number>,
  "days_type": <"calendar" | "business">,
  "applies_to_service_type": <string — type of service this deadline applies to, e.g. "elective surgery", "home health", "DME">,
  "applies_to_cpts": [<string — specific CPT/HCPCS codes, or [] if applies to a service category>],
  "source_quote": <string — verbatim sentence(s) from the source text>
}`,

  decision_timeframe: `You are a healthcare billing expert. Extract payer decision turnaround requirements from the provided payer manual text.
Focus on how quickly the PAYER must decide on authorization requests. These are payer obligations, not provider obligations.
Return ONLY valid JSON with this structure:
{
  "decision_type": <"standard" | "expedited" | "urgent" | "concurrent">,
  "days_allowed": <integer or null — number of days/hours the payer has to decide, null if not clearly stated>,
  "days_type": <"calendar" | "business" | "hours">,
  "applies_to_plan_products": [<string — plan products this applies to, e.g. "Medicare Advantage", "Commercial" — or [] if all>],
  "source_quote": <string — verbatim sentence(s) from the source text>
}`,

  documentation_timeframe: `You are a healthcare billing expert. Extract documentation and medical records submission deadlines from the provided payer manual text.
Focus on deadlines for supplying records after a request — audits, appeals, HEDIS, discharge summaries.
Return ONLY valid JSON with this structure:
{
  "record_type": <string — type of record, e.g. "medical record for audit", "discharge summary", "lab results", "clinical notes for appeal">,
  "days_allowed": <integer or null — days/hours to supply the records after the triggering event, null if not stated>,
  "days_type": <"calendar" | "business" | "hours">,
  "trigger_event": <"request_received" | "discharge" | "audit_initiated" | "lab_completed" | "other">,
  "transfer_method": <string — required delivery method, e.g. "electronic file transfer", "fax", "mail", "portal">,
  "source_quote": <string — verbatim sentence(s) from the source text>
}`,

  notification_event: `You are a healthcare billing expert. Extract provider-to-payer notification requirements from the provided payer manual text.
Focus on events where a provider MUST notify the payer: hospital admissions, discharges, demographic changes, network exits.
Return ONLY valid JSON with this structure:
{
  "event_name": <string — name of the triggering clinical/administrative event, e.g. "Inpatient Admission", "Concurrent Inpatient Stay", "Provider Demographic Change">,
  "notification_trigger": <string — specific condition that triggers the notification requirement>,
  "days_advance_required": <integer or null — how many days advance or post-event the notification is due; negative for post-event, null if immediate or unclear>,
  "recipient": <"payer" | "member" | "both">,
  "format_required": <string — how notification must be submitted, e.g. "phone", "web portal", "form 276", or "" if not specified>,
  "failure_consequence": <"provider_liability" | "denial" | "warning_only" | "informational">,
  "source_quote": <string — verbatim sentence(s) from the source text>
}`,

  member_notice: `You are a healthcare billing expert. Extract required provider-to-member notice rules from the provided payer manual text.
Focus on ABN (Advance Beneficiary Notice), NOMNC (Notice of Medicare Non-Coverage), IDN (Integrated Denial Notice), termination of service notices, and advance written consent requirements.
Do NOT include general balance billing rules or COB rules — only formal notice documents.
Return ONLY valid JSON with this structure:
{
  "notice_type": <string — name of the specific notice, e.g. "ABN", "NOMNC", "IDN", "Termination of Services Notice">,
  "days_before_required": <integer or null — calendar days before the event the notice must be given; null if timing not specified>,
  "circumstance": <string — clinical or administrative situation requiring this notice>,
  "written_consent_required": <boolean — true if member must sign or acknowledge receipt>,
  "source_quote": <string — verbatim sentence(s) from the source text>
}`,

  // risk_adjustment_hcc deferred to Phase 3 — no prompt here; extraction loop skips it
  risk_adjustment_hcc: `You are a healthcare billing expert. Extract HCC risk adjustment and RAF score documentation rules from the provided payer manual text.
Return ONLY valid JSON with this structure:
{
  "guidance_type": <string>,
  "documentation_requirement": <string>,
  "source_quote": <string>
}`,
};

// ── Confidence estimator ──────────────────────────────────────────────────────

function isConfigured(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY);
}

async function callClaude(systemPrompt: string, userContent: string): Promise<ExtractionResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json() as any;
  const text = data.content?.[0]?.text || "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Claude returned no JSON object");
  return JSON.parse(jsonMatch[0]) as ExtractionResult;
}

export interface ClaudeExtractionOutput {
  sectionType: SectionType;
  result: ExtractionResult | null;
  confidence: number;
  error?: string;
  skipped?: boolean;
}

export async function extractSection(
  sectionType: SectionType,
  textChunk: string
): Promise<ClaudeExtractionOutput> {
  if (!isConfigured()) {
    return { sectionType, result: null, confidence: 0, skipped: true };
  }

  try {
    const result = await callClaude(SYSTEM_PROMPTS[sectionType], textChunk);
    const confidence = estimateConfidence(sectionType, result);
    return { sectionType, result, confidence };
  } catch (err: any) {
    return { sectionType, result: null, confidence: 0, error: err.message };
  }
}

function estimateConfidence(sectionType: SectionType, result: ExtractionResult | null): number {
  if (!result) return 0;

  switch (sectionType) {
    case "timely_filing": {
      const r = result as TimelyFilingResult;
      if (r.days > 0 && r.source_text && !r.source_text.includes("Not found")) return 0.92;
      return 0.4;
    }
    case "prior_auth": {
      const r = result as PriorAuthResult;
      if (r.criteria && r.source_text) return 0.88;
      return 0.5;
    }
    case "modifiers_and_liability": {
      const r = result as ModifiersAndLiabilityResult;
      if (r.modifier_code && r.liability_assignment && r.source_quote) return 0.87;
      if (r.modifier_code && r.payer_rule) return 0.70;
      return 0.45;
    }
    case "appeals": {
      const r = result as AppealsResult;
      if (r.deadline_days > 0 && r.submission_method) return 0.9;
      return 0.5;
    }
    case "referrals": {
      const r = result as ReferralsResult;
      if (r.source_quote && !r.source_quote.includes("Not found") && r.applies_to_plan_products?.length) return 0.85;
      if (r.source_quote && !r.source_quote.includes("Not found")) return 0.72;
      return 0.4;
    }
    case "coordination_of_benefits": {
      const r = result as CoordinationOfBenefitsResult;
      if (r.source_quote && r.billing_order) return 0.83;
      return 0.5;
    }
    case "payer_specific_edits": {
      const r = result as PayerSpecificEditsResult;
      if (r.edit_name && r.edit_category && r.source_quote) return 0.85;
      return 0.5;
    }
    case "edi_construction": {
      const r = result as EdiConstructionResult;
      if (r.field_name && r.format_requirement && r.source_quote) return 0.82;
      return 0.5;
    }
    case "place_of_service": {
      const r = result as PlaceOfServiceResult;
      if (r.pos_codes?.length && r.restriction && r.source_quote) return 0.84;
      return 0.5;
    }
    case "submission_timeframe": {
      const r = result as SubmissionTimeframeResult;
      if (r.days_advance_required !== null && r.event_name && r.source_quote) return 0.86;
      return 0.5;
    }
    case "decision_timeframe": {
      const r = result as DecisionTimeframeResult;
      if (r.days_allowed !== null && r.decision_type && r.source_quote) return 0.85;
      return 0.5;
    }
    case "documentation_timeframe": {
      const r = result as DocumentationTimeframeResult;
      if (r.days_allowed !== null && r.record_type && r.source_quote) return 0.84;
      return 0.5;
    }
    case "notification_event": {
      const r = result as NotificationEventResult;
      if (r.event_name && r.failure_consequence && r.source_quote) return 0.83;
      return 0.5;
    }
    case "member_notice": {
      const r = result as MemberNoticeResult;
      if (r.notice_type && r.source_quote) return 0.84;
      return 0.5;
    }
    case "risk_adjustment_hcc":
      return 0.5;
    default:
      return 0.6;
  }
}
