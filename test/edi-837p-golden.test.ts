/**
 * G1 Golden-File: Outpatient 837P regression guard.
 *
 * Purpose: Ensure HH Phase A (and future) changes never silently mutate the
 * outpatient 837P EDI structure.  The test generates a claim using a fully
 * deterministic minimal fixture, normalises volatile fields (ISA timestamps,
 * GS timestamps, BHT timestamps, ST/SE/GE/IEA control numbers), and either:
 *   - Creates the golden file on first run (when the file is absent), or
 *   - Diffs the normalised output against the stored golden file.
 *
 * To update the golden file after an intentional change:
 *   rm test/fixtures/golden-outpatient-837p.edi && npx tsx test/edi-837p-golden.test.ts
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = path.join(__dirname, "fixtures", "golden-outpatient-837p.edi");

/** Strip fields that change every run so comparisons stay deterministic. */
function normalise(edi: string): string {
  const lines = edi.split("~").map(seg => seg.trim()).filter(Boolean);
  return lines
    .map(seg => {
      const els = seg.split("*");
      const id = els[0];
      switch (id) {
        case "ISA":
          // ISA09=date, ISA10=time, ISA13=control number — replace with placeholders
          if (els.length >= 14) {
            els[9]  = "YYMMDD";
            els[10] = "HHMM";
            els[13] = "000000000";
          }
          return els.join("*");
        case "GS":
          // GS04=date, GS05=time, GS06=control number
          if (els.length >= 7) {
            els[4] = "YYYYMMDD";
            els[5] = "HHMM";
            els[6] = "1";
          }
          return els.join("*");
        case "BHT":
          // BHT04=date, BHT05=time
          if (els.length >= 6) {
            els[4] = "YYYYMMDD";
            els[5] = "HHMM";
          }
          return els.join("*");
        case "ST":
        case "SE":
        case "GE":
        case "IEA":
          // Control numbers in positions 2 (ST/SE/GE) or 2 (IEA) — normalise last element
          if (els.length >= 3) {
            els[els.length - 1] = "CTRL";
          }
          return els.join("*");
        default:
          return seg;
      }
    })
    .join("~\n") + "~";
}

describe("G1 — outpatient 837P golden file", () => {
  test("generate837P produces stable normalised output for a minimal commercial claim", async () => {
    // Dynamic import so the module is resolved at runtime (ts-node / tsx path)
    const { generate837P } = await import(
      path.join(__dirname, "../server/services/edi-generator.ts")
    ) as typeof import("../server/services/edi-generator");

    const input: Parameters<typeof generate837P>[0] = {
      isa15: "T",
      claim: {
        id:                  "test-claim-0001-0000-0000-000000000001",
        patient_id:          "pt-0001",
        service_date:        "2026-01-15",
        place_of_service:    "11",
        auth_number:         null,
        payer:               "Blue Cross",
        amount:              250.00,
        claim_frequency_code: "1",
        orig_claim_number:   null,
        homebound_indicator: null,
        delay_reason_code:   null,
        statement_period_start: null,
        statement_period_end:   null,
        service_lines: [
          {
            hcpcs_code:        "99213",
            units:             1,
            charge:            250.00,
            modifier:          null,
            diagnosis_pointer: "A",
            service_date:      "2026-01-15",
          },
        ],
        icd10_codes: ["Z00.00"],
      },
      patient: {
        first_name:       "Jane",
        last_name:        "Doe",
        dob:              "1980-06-15",
        member_id:        "MEM123456789",
        insurance_carrier: "Blue Cross",
        sex:              "F",
        address:          "456 Oak Ave",
        city:             "Tampa",
        state:            "FL",
        zip:              "33601",
      },
      practice: {
        name:          "Outpatient Clinic LLC",
        legal_name:    "Outpatient Clinic LLC",
        npi:           "1234567890",
        tax_id:        "123456789",
        taxonomy_code: "207Q00000X",
        address:       "100 Clinic Blvd",
        city:          "Tampa",
        state:         "FL",
        zip:           "33602",
        phone:         "8135550100",
      },
      provider: {
        first_name:    "John",
        last_name:     "Smith",
        npi:           "9876543210",
        taxonomy_code: "207Q00000X",
      },
      payer: {
        name:           "Blue Cross Blue Shield",
        payer_id:       "BCBS01",
        referringProviderPolicy: "forbidden",
      },
    };

    const { edi } = generate837P(input);
    assert.ok(edi.length > 0, "generate837P should return non-empty EDI");
    assert.ok(edi.includes("ISA*"), "EDI should start with ISA segment");
    assert.ok(edi.includes("CLM*"), "EDI should contain CLM segment");
    assert.ok(edi.includes("SV1*"), "EDI should contain SV1 segment");
    assert.ok(edi.includes("IEA*"), "EDI should end with IEA segment");

    const normalised = normalise(edi);

    if (!fs.existsSync(GOLDEN_PATH)) {
      fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
      fs.writeFileSync(GOLDEN_PATH, normalised, "utf8");
      console.log(`[G1] Golden file created at ${GOLDEN_PATH}`);
      return;
    }

    const golden = fs.readFileSync(GOLDEN_PATH, "utf8");
    assert.equal(
      normalised,
      golden,
      "837P output has changed — if intentional, delete the golden file and re-run to update it"
    );
  });
});
