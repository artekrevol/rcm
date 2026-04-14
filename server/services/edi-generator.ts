export interface EDI837PInput {
  claim: {
    id: string;
    patient_id: string;
    service_date: string;
    place_of_service: string;
    auth_number: string | null;
    payer: string;
    amount: number;
    service_lines: Array<{
      hcpcs_code: string;
      units: number;
      charge: number;
      modifier: string | null;
      diagnosis_pointer: string;
      service_date?: string;
    }>;
    icd10_codes: string[];
  };
  patient: {
    first_name: string;
    last_name: string;
    dob: string;
    member_id: string;
    insurance_carrier: string;
    sex?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  practice: {
    name: string;
    npi: string;
    tax_id: string;
    taxonomy_code: string;
    address: string;
    city: string;
    state: string;
    zip: string;
  };
  provider: {
    first_name: string;
    last_name: string;
    npi: string;
    taxonomy_code: string;
  };
  payer: {
    name: string;
    payer_id: string;
  };
}

function getPayerTypeCode(payerName: string): string {
  const name = payerName.toLowerCase();
  if (name.includes("medicare")) return "MB";
  if (name.includes("medicaid")) return "MC";
  if (name.includes("va") || name.includes("tricare") || name.includes("champva")) return "CH";
  if (name.includes("bcbs") || name.includes("blue cross")) return "BL";
  return "CI";
}

function formatDate8(dateStr: string): string {
  return dateStr.replace(/-/g, "").slice(0, 8);
}

function mapSex(sex?: string): string {
  if (!sex) return "U";
  const s = sex.toUpperCase().charAt(0);
  if (s === "M") return "M";
  if (s === "F") return "F";
  return "U";
}

export function generate837P(input: EDI837PInput): string {
  const { claim, patient, practice, provider, payer } = input;
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toTimeString().slice(0, 5).replace(":", "");
  const controlNumber = String(Date.now()).slice(-9).padStart(9, "0");
  const claimControlNumber = claim.id.replace(/-/g, "").slice(0, 20);

  const street = practice.address || "123 Main St";
  const city = practice.city || "Austin";
  const state = practice.state || "TX";
  const zip = practice.zip || "78701";

  const segments: string[] = [];

  segments.push(
    `ISA*00*          *00*          *ZZ*${practice.npi.padEnd(15)}*ZZ*${payer.payer_id.padEnd(15)}*${date.slice(2)}*${time}*^*00501*${controlNumber}*0*P*:`
  );

  segments.push(
    `GS*HC*${practice.npi}*${payer.payer_id}*${date}*${time}*1*X*005010X222A1`
  );

  segments.push(`ST*837*0001*005010X222A1`);

  segments.push(`BHT*0019*00*${claimControlNumber}*${date}*${time}*CH`);

  segments.push(
    `NM1*41*2*${practice.name}*****46*${practice.npi}`
  );
  segments.push(`PER*IC*Billing Contact*TE*5125550100`);

  segments.push(
    `NM1*40*2*${payer.name}*****46*${payer.payer_id}`
  );

  segments.push(`HL*1**20*1`);
  segments.push(`PRV*BI*PXC*${practice.taxonomy_code}`);
  segments.push(
    `NM1*85*2*${practice.name}*****XX*${practice.npi}`
  );
  segments.push(`N3*${street}`);
  segments.push(`N4*${city}*${state}*${zip}`);
  segments.push(`REF*EI*${practice.tax_id.replace("-", "")}`);

  segments.push(`HL*2*1*22*0`);

  segments.push(`SBR*P*18*******${getPayerTypeCode(payer.name)}`);

  segments.push(
    `NM1*IL*1*${patient.last_name}*${patient.first_name}****MI*${patient.member_id}`
  );
  const patientAddr = patient.address || street;
  const patientCity = patient.city || city;
  const patientState = patient.state || state;
  const patientZip = patient.zip || zip;
  segments.push(`N3*${patientAddr}`);
  segments.push(`N4*${patientCity}*${patientState}*${patientZip}`);
  segments.push(
    `DMG*D8*${formatDate8(patient.dob)}*${mapSex(patient.sex)}`
  );

  segments.push(
    `NM1*PR*2*${payer.name}*****PI*${payer.payer_id}`
  );

  const totalCharge = claim.service_lines.reduce(
    (sum, line) => sum + line.charge,
    0
  );
  segments.push(
    `CLM*${claimControlNumber}*${totalCharge.toFixed(2)}***${claim.place_of_service}:B:1*Y*A*Y*I`
  );

  if (claim.auth_number) {
    segments.push(`REF*G1*${claim.auth_number}`);
  }

  const diagCodes = claim.icd10_codes
    .map((code, i) => `${i === 0 ? "ABK" : "ABF"}:${code}`)
    .join("*");
  segments.push(`HI*${diagCodes}`);

  segments.push(
    `NM1*82*1*${provider.last_name}*${provider.first_name}****XX*${provider.npi}`
  );
  segments.push(`PRV*PE*PXC*${provider.taxonomy_code}`);

  claim.service_lines.forEach((line, index) => {
    const lineServiceDate = line.service_date || claim.service_date;
    segments.push(`LX*${index + 1}`);
    const modParts: string[] = [];
    if (line.modifier) {
      line.modifier.split(",").map(m => m.trim()).filter(Boolean).forEach(m => modParts.push(m));
    }
    while (modParts.length < 4) modParts.push("");
    const modStr = modParts.map(m => m).join("*");
    segments.push(
      `SV1*HC:${line.hcpcs_code}:${modStr}*${line.charge.toFixed(2)}*UN*${line.units}***${line.diagnosis_pointer}`
    );
    segments.push(
      `DTP*472*D8*${formatDate8(lineServiceDate)}`
    );
  });

  const segCount = segments.length - 2 + 1;
  segments.push(`SE*${segCount}*0001`);

  segments.push(`GE*1*1`);

  segments.push(`IEA*1*${controlNumber}`);

  return segments.join("~\n") + "~";
}
