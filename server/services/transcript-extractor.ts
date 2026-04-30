import Anthropic from "@anthropic-ai/sdk";

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

export interface ExtractedInsurance {
  carrier: string | null;
  memberId: string | null;
  dob: string | null;
  state: string | null;
  urgency: "immediate" | "within_week" | "within_month" | "exploring" | null;
  serviceType: string | null;
  consent: boolean | null;
}

export async function extractInsuranceFromTranscript(
  transcript: string
): Promise<ExtractedInsurance> {
  const empty: ExtractedInsurance = {
    carrier: null,
    memberId: null,
    dob: null,
    state: null,
    urgency: null,
    serviceType: null,
    consent: null,
  };

  if (!transcript || transcript.trim().length < 20) return empty;

  const anthropic = getAnthropicClient();
  if (!anthropic) {
    console.warn("[transcript-extractor] ANTHROPIC_API_KEY not set; skipping extraction");
    return empty;
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: `Extract structured data from this intake call transcript. Return ONLY a JSON object with these keys: carrier (string), memberId (string), dob (YYYY-MM-DD), state (2-letter), urgency (immediate|within_week|within_month|exploring), serviceType (string), consent (boolean). If a field is unknown, use null. Do not include markdown or explanation, only JSON.

Transcript:
${transcript}`,
        },
      ],
    });

    const text =
      response.content.find((b) => b.type === "text")?.text || "{}";
    const cleaned = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      carrier: parsed.carrier || null,
      memberId: parsed.memberId || null,
      dob: parsed.dob || null,
      state: parsed.state || null,
      urgency: parsed.urgency || null,
      serviceType: parsed.serviceType || null,
      consent: typeof parsed.consent === "boolean" ? parsed.consent : null,
    };
  } catch (err) {
    console.error("[transcript-extractor] Claude extraction failed:", err);
    return empty;
  }
}
