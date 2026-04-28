import type { SectionType } from "./manual-extractor";

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

export interface ModifierResult {
  modifier_code: string;
  description: string;
  payer_rule: string;
  source_text: string;
}

export interface AppealsResult {
  deadline_days: number;
  level: string;
  submission_method: string;
  requirements: string[];
  source_text: string;
}

export type ExtractionResult = TimelyFilingResult | PriorAuthResult | ModifierResult | AppealsResult;

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

  modifiers: `You are a healthcare billing expert. Extract billing modifier requirements from the provided payer manual text.
Return ONLY valid JSON with this structure:
{
  "modifier_code": <string — the modifier code e.g. "59", "GT", "GP">,
  "description": <string — what the modifier means>,
  "payer_rule": <string — when this payer requires or prohibits this modifier>,
  "source_text": <string — exact sentence(s) from the text containing the rule>
}
Extract ONE modifier per response. If multiple modifiers appear, focus on the most significant one.`,

  appeals: `You are a healthcare billing expert. Extract the claims appeal process from the provided payer manual text.
Return ONLY valid JSON with this structure:
{
  "deadline_days": <integer — days from remittance/denial to file appeal>,
  "level": <string — e.g. "Redetermination", "Reconsideration", "Level 1", "First Level">,
  "submission_method": <string — how to submit: mail, fax, online portal, etc.>,
  "requirements": [<string — list of documents/info required>],
  "source_text": <string — exact sentence(s) from the text containing the rule>
}`,
};

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
  if (sectionType === "timely_filing") {
    const r = result as TimelyFilingResult;
    if (r.days > 0 && r.source_text && !r.source_text.includes("Not found")) return 0.92;
    return 0.4;
  }
  if (sectionType === "prior_auth") {
    const r = result as PriorAuthResult;
    if (r.criteria && r.source_text) return 0.88;
    return 0.5;
  }
  if (sectionType === "modifiers") {
    const r = result as ModifierResult;
    if (r.modifier_code && r.payer_rule) return 0.85;
    return 0.45;
  }
  if (sectionType === "appeals") {
    const r = result as AppealsResult;
    if (r.deadline_days > 0 && r.submission_method) return 0.9;
    return 0.5;
  }
  return 0.6;
}
