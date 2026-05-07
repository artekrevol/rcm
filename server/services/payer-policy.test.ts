import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─── Helpers shared with edi-generator ───────────────────────────────────────
function parseEdi(ediString: string): string[][] {
  return ediString
    .split(/~\s*/)
    .filter(Boolean)
    .map(seg => seg.split("*"));
}

// Minimal generate837P call to test Loop 2310A policy
// We import at runtime so TS transpiles first
async function gen(overrides: Record<string, unknown> = {}) {
  const { generate837P } = await import("./edi-generator");
  const base = {
    isa15: "T",
    claim: {
      id: "test-policy",
      patient_id: "p1",
      service_date: "2026-01-15",
      place_of_service: "12",
      auth_number: null,
      payer: "VA Test",
      amount: 100,
      homebound_indicator: false,
      delay_reason_code: null,
      claim_frequency_code: "1",
      orig_claim_number: null,
      statement_period_start: null,
      statement_period_end: null,
      service_lines: [{ hcpcs: "G0156", units: 1, charge: 100, modifier1: null, modifier2: null, modifier3: null, modifier4: null }],
      icd10_codes: ["Z74.09"],
    },
    patient: { first_name: "Rachel", last_name: "Mandler", dob: "1942-03-10", member_id: "123ICN", insurance_carrier: "VA", sex: "F", address: null, city: null, state: null, zip: null },
    practice: { name: "Test Agency", npi: "1234567890", tax_id: "123456789", taxonomy_code: "163W00000X", address: "123 Main", city: "SF", state: "CA", zip: "94102", phone: "4155550000", pgba_trading_partner_id: null },
    provider: { first_name: "Jane", last_name: "Doe", npi: "1234567890", taxonomy_code: "163W00000X", license_number: null, entity_type: null },
    referringProvider: null as unknown,
    payer: {
      name: "VA Test",
      payer_id: "TWVACCN",
      address: "PO Box 1",
      city: "Phoenix",
      state: "AZ",
      zip: "85001",
      phone: "",
      pgba_trading_partner_id: null,
      referringProviderPolicy: "required" as "required" | "situational" | "forbidden",
    },
    ...overrides,
  };
  return generate837P(base as any);
}

const VA_COMPOSITE_REGEX = /^\d{3}[_-]\d{6,8}$/;

// ─── VA composite ID regex ────────────────────────────────────────────────────
describe("VA composite ID regex", () => {
  it("matches 662_1375949 (underscore separator)", () => {
    assert.ok(VA_COMPOSITE_REGEX.test("662_1375949"));
  });
  it("matches 662-1375949 (hyphen separator)", () => {
    assert.ok(VA_COMPOSITE_REGEX.test("662-1375949"));
  });
  it("matches 3-digit station with 8-digit suffix", () => {
    assert.ok(VA_COMPOSITE_REGEX.test("688_12345678"));
  });
  it("rejects plain NPI 1234567890", () => {
    assert.ok(!VA_COMPOSITE_REGEX.test("1234567890"));
  });
  it("rejects random text", () => {
    assert.ok(!VA_COMPOSITE_REGEX.test("VACCN_ABC"));
  });
  it("rejects 2-digit station prefix", () => {
    assert.ok(!VA_COMPOSITE_REGEX.test("62_1375949"));
  });
  it("rejects too-short suffix (5 digits)", () => {
    assert.ok(!VA_COMPOSITE_REGEX.test("662_12345"));
  });
});

// ─── Payer policy: forbidden ──────────────────────────────────────────────────
describe("policy=forbidden", () => {
  it("omits NM1*DN even when referringProvider is supplied", async () => {
    const rp = { first_name: "John", last_name: "Smith", npi: "1234567890", provider_type: "1" };
    const { edi, rpTransmitted } = await gen({
      referringProvider: rp,
      payer: { name: "Forbidden Payer", payer_id: "FRBDN", address: "", city: "", state: "", zip: "", phone: "", pgba_trading_partner_id: null, referringProviderPolicy: "forbidden" },
    });
    const segs = parseEdi(edi);
    const nm1 = segs.find(s => s[0] === "NM1" && s[1] === "DN");
    assert.equal(nm1, undefined, "NM1*DN must be absent for policy=forbidden");
    assert.equal((rpTransmitted as any).omitted, true, "rpTransmitted.omitted should be true");
  });

  it("omits NM1*DN when referringProvider is null", async () => {
    const { edi } = await gen({
      referringProvider: null,
      payer: { name: "Forbidden Payer", payer_id: "FRBDN", address: "", city: "", state: "", zip: "", phone: "", pgba_trading_partner_id: null, referringProviderPolicy: "forbidden" },
    });
    const segs = parseEdi(edi);
    assert.equal(segs.find(s => s[0] === "NM1" && s[1] === "DN"), undefined);
  });
});

// ─── Payer policy: situational ────────────────────────────────────────────────
describe("policy=situational", () => {
  it("emits NM1*DN when referringProvider is supplied (no auth_number)", async () => {
    const rp = { first_name: "John", last_name: "Smith", npi: "1184288680", provider_type: "1" };
    const { edi } = await gen({
      referringProvider: rp,
      claim: {
        id: "test-sit", patient_id: "p1", service_date: "2026-01-15", place_of_service: "12",
        auth_number: null, payer: "VA", amount: 100, homebound_indicator: false,
        delay_reason_code: null, claim_frequency_code: "1", orig_claim_number: null,
        statement_period_start: null, statement_period_end: null,
        service_lines: [{ hcpcs: "G0156", units: 1, charge: 100, modifier1: null, modifier2: null, modifier3: null, modifier4: null }],
        icd10_codes: ["Z74.09"],
      },
      payer: { name: "VA Test", payer_id: "TWVACCN", address: "", city: "", state: "", zip: "", phone: "", pgba_trading_partner_id: null, referringProviderPolicy: "situational" },
    });
    const segs = parseEdi(edi);
    const nm1 = segs.find(s => s[0] === "NM1" && s[1] === "DN");
    assert.ok(nm1, "NM1*DN must be present when RP supplied");
    assert.equal(nm1![3], "Smith");
  });

  it("omits NM1*DN when no referringProvider but auth_number present", async () => {
    const { edi, rpTransmitted } = await gen({
      referringProvider: null,
      claim: {
        id: "test-sit2", patient_id: "p1", service_date: "2026-01-15", place_of_service: "12",
        auth_number: "VA0056843497", payer: "VA", amount: 100, homebound_indicator: false,
        delay_reason_code: null, claim_frequency_code: "1", orig_claim_number: null,
        statement_period_start: null, statement_period_end: null,
        service_lines: [{ hcpcs: "G0156", units: 1, charge: 100, modifier1: null, modifier2: null, modifier3: null, modifier4: null }],
        icd10_codes: ["Z74.09"],
      },
      payer: { name: "VA Test", payer_id: "TWVACCN", address: "", city: "", state: "", zip: "", phone: "", pgba_trading_partner_id: null, referringProviderPolicy: "situational" },
    });
    const segs = parseEdi(edi);
    assert.equal(segs.find(s => s[0] === "NM1" && s[1] === "DN"), undefined, "NM1*DN must be absent when omitted by situational policy");
    assert.ok((rpTransmitted as any).omitted, "rpTransmitted.omitted should be true");
  });

  it("throws when no referringProvider AND no auth_number (situational)", async () => {
    await assert.rejects(
      gen({
        referringProvider: null,
        payer: { name: "VA Test", payer_id: "TWVACCN", address: "", city: "", state: "", zip: "", phone: "", pgba_trading_partner_id: null, referringProviderPolicy: "situational" },
      }),
      /situational.*no auth|referring provider.*required/i,
    );
  });
});

// ─── Payer policy: required ───────────────────────────────────────────────────
describe("policy=required", () => {
  it("emits NM1*DN when referringProvider is supplied", async () => {
    const rp = { first_name: "Mary", last_name: "Jones", npi: "1184288680", provider_type: "1" };
    const { edi } = await gen({ referringProvider: rp, payer: { name: "Required Payer", payer_id: "REQ01", address: "", city: "", state: "", zip: "", phone: "", pgba_trading_partner_id: null, referringProviderPolicy: "required" } });
    const segs = parseEdi(edi);
    const nm1 = segs.find(s => s[0] === "NM1" && s[1] === "DN");
    assert.ok(nm1, "NM1*DN must be present");
    assert.equal(nm1![3], "Jones");
  });

  it("throws when referringProvider is null (required)", async () => {
    await assert.rejects(
      gen({ referringProvider: null, payer: { name: "Required Payer", payer_id: "REQ01", address: "", city: "", state: "", zip: "", phone: "", pgba_trading_partner_id: null, referringProviderPolicy: "required" } }),
      /referring provider.*required|required.*referring/i,
    );
  });
});

// ─── NPPES response parsing (unit test of shape) ──────────────────────────────
describe("NPPES response shape", () => {
  it("parses a well-formed NPPES result object", () => {
    const raw = {
      number: "1234567890",
      basic: { first_name: "JOHN", last_name: "SMITH", credential: "MD" },
      taxonomies: [{ primary: true, desc: "Internal Medicine" }],
      addresses: [{ city: "San Francisco", state: "CA" }],
    };
    const parsed = {
      npi: raw.number,
      first_name: raw.basic?.first_name || "",
      last_name: raw.basic?.last_name || "",
      credential: raw.basic?.credential || "",
      taxonomy: raw.taxonomies?.find((t: any) => t.primary)?.desc || "",
      city: raw.addresses?.[0]?.city || "",
      state: raw.addresses?.[0]?.state || "",
    };
    assert.equal(parsed.npi, "1234567890");
    assert.equal(parsed.first_name, "JOHN");
    assert.equal(parsed.taxonomy, "Internal Medicine");
    assert.equal(parsed.city, "San Francisco");
  });

  it("handles missing optional fields gracefully", () => {
    const raw = { number: "9876543210", basic: { first_name: "JANE", last_name: "DOE" } };
    const parsed = {
      npi: raw.number,
      first_name: (raw.basic as any)?.first_name || "",
      last_name: (raw.basic as any)?.last_name || "",
      credential: (raw.basic as any)?.credential || "",
      taxonomy: (raw as any).taxonomies?.find((t: any) => t.primary)?.desc || "",
      city: (raw as any).addresses?.[0]?.city || "",
      state: (raw as any).addresses?.[0]?.state || "",
    };
    assert.equal(parsed.credential, "");
    assert.equal(parsed.taxonomy, "");
    assert.equal(parsed.city, "");
  });
});
