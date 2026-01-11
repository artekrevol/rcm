import { db } from "./db";
import { users, leads, patients, encounters, claims, claimEvents, denials, rules } from "@shared/schema";
import { allPayers as realPayers } from "./payers";

const cptCodeDetails: Record<string, { description: string; avgAmount: number }> = {
  "99213": { description: "Office visit, established patient, 20-29 min", avgAmount: 125 },
  "99214": { description: "Office visit, established patient, 30-39 min", avgAmount: 185 },
  "99215": { description: "Office visit, established patient, 40-54 min", avgAmount: 250 },
  "99203": { description: "Office visit, new patient, 30-44 min", avgAmount: 175 },
  "99204": { description: "Office visit, new patient, 45-59 min", avgAmount: 265 },
  "99205": { description: "Office visit, new patient, 60-74 min", avgAmount: 350 },
  "90834": { description: "Psychotherapy, 45 minutes", avgAmount: 145 },
  "90837": { description: "Psychotherapy, 60 minutes", avgAmount: 190 },
  "90847": { description: "Family psychotherapy with patient", avgAmount: 175 },
  "90832": { description: "Psychotherapy, 30 minutes", avgAmount: 95 },
  "97110": { description: "Therapeutic exercises", avgAmount: 85 },
  "97140": { description: "Manual therapy techniques", avgAmount: 75 },
  "97530": { description: "Therapeutic activities", avgAmount: 80 },
  "99223": { description: "Initial hospital care, high severity", avgAmount: 425 },
  "99232": { description: "Subsequent hospital care, moderate", avgAmount: 165 },
  "99291": { description: "Critical care, first 30-74 min", avgAmount: 550 },
  "99285": { description: "Emergency dept visit, high severity", avgAmount: 475 },
  "99284": { description: "Emergency dept visit, moderate severity", avgAmount: 325 },
  "99283": { description: "Emergency dept visit, low-moderate", avgAmount: 195 },
  "90791": { description: "Psychiatric diagnostic evaluation", avgAmount: 275 },
  "90792": { description: "Psychiatric evaluation with medical", avgAmount: 325 },
  "99243": { description: "Outpatient consultation, moderate", avgAmount: 225 },
  "99244": { description: "Outpatient consultation, high", avgAmount: 325 },
};

const denialReasons = [
  { code: "CO-4", text: "Service not consistent with procedure code", category: "Clinical", rootCause: "Invalid Coding" },
  { code: "CO-11", text: "Diagnosis inconsistent with procedure", category: "Clinical", rootCause: "Invalid Coding" },
  { code: "CO-16", text: "Missing or invalid claim information", category: "Administrative", rootCause: "Missing Information" },
  { code: "CO-18", text: "Duplicate claim/service", category: "Technical", rootCause: "Duplicate Claim" },
  { code: "CO-22", text: "Coordination of benefits issue", category: "Administrative", rootCause: "COB Issue" },
  { code: "CO-27", text: "Expenses incurred after coverage terminated", category: "Administrative", rootCause: "Eligibility Issues" },
  { code: "CO-29", text: "Time limit for filing has expired", category: "Administrative", rootCause: "Timely Filing" },
  { code: "CO-50", text: "Medical necessity not established", category: "Clinical", rootCause: "Medical Necessity" },
  { code: "CO-96", text: "Non-covered charge(s)", category: "Clinical", rootCause: "Non-Covered Service" },
  { code: "CO-97", text: "Payment adjusted - bundling rules", category: "Technical", rootCause: "Bundling Issue" },
  { code: "CO-197", text: "Prior authorization required", category: "Administrative", rootCause: "Missing Auth" },
  { code: "PR-1", text: "Deductible amount", category: "Patient Responsibility", rootCause: "Patient Deductible" },
  { code: "PR-2", text: "Coinsurance amount", category: "Patient Responsibility", rootCause: "Patient Coinsurance" },
  { code: "PR-3", text: "Copayment amount", category: "Patient Responsibility", rootCause: "Patient Copay" },
];

const serviceTypes = [
  "Outpatient Mental Health",
  "Inpatient Psychiatric",
  "Substance Abuse Treatment",
  "Physical Therapy",
  "Emergency Services",
  "Primary Care",
  "Specialist Consultation",
];

const facilityTypes = [
  "General Acute Care Hospital",
  "Behavioral Health Center",
  "Outpatient Clinic",
  "Skilled Nursing Facility",
  "Ambulatory Surgery Center",
  "Emergency Department",
  "Rehabilitation Center",
];

const states = ["CA", "TX", "NY", "FL", "IL", "PA", "OH", "GA", "NC", "MI", "NJ", "VA", "WA", "AZ", "MA"];

const firstNames = [
  "Sarah", "Michael", "Emily", "David", "Jennifer", "James", "Amanda", "Robert", "Jessica", "Christopher",
  "Ashley", "Matthew", "Stephanie", "Daniel", "Nicole", "Anthony", "Melissa", "Joseph", "Elizabeth", "William",
  "Lauren", "Andrew", "Megan", "Joshua", "Rachel", "Ryan", "Samantha", "Brandon", "Katherine", "Tyler",
  "Maria", "Carlos", "Linda", "Richard", "Patricia", "Thomas", "Barbara", "Steven", "Susan", "Mark",
];

const lastNames = [
  "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Anderson",
  "Taylor", "Thomas", "Hernandez", "Moore", "Martin", "Jackson", "Thompson", "White", "Lopez", "Lee",
  "Gonzalez", "Harris", "Clark", "Lewis", "Robinson", "Walker", "Perez", "Hall", "Young", "Allen",
  "Sanchez", "Wright", "King", "Scott", "Green", "Baker", "Adams", "Nelson", "Hill", "Ramirez",
];

function randomPhone(): string {
  const area = Math.floor(Math.random() * 900) + 100;
  const first = Math.floor(Math.random() * 900) + 100;
  const last = Math.floor(Math.random() * 9000) + 1000;
  return `(${area}) ${first}-${last}`;
}

function randomDOB(): string {
  const year = 1945 + Math.floor(Math.random() * 55);
  const month = String(Math.floor(Math.random() * 12) + 1).padStart(2, "0");
  const day = String(Math.floor(Math.random() * 28) + 1).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function randomMemberId(payer: string): string {
  const prefixes: Record<string, string> = {
    "UnitedHealthcare": "UHC",
    "Anthem Blue Cross Blue Shield": "ANT",
    "Aetna": "AET",
    "Cigna": "CGN",
    "Humana": "HUM",
    "Kaiser Permanente": "KP",
    "Centene": "CEN",
    "Molina Healthcare": "MOL",
    "CVS Health / Aetna": "CVS",
    "Elevance Health": "ELV",
    "Medicare": "1EG4",
    "Medicare Advantage": "1EG4",
    "Medicaid": "MCD",
    "Tricare": "TRI",
    "Veterans Affairs (VA)": "VA",
  };
  
  // Generate prefix from payer name if not in map
  let prefix = prefixes[payer];
  if (!prefix) {
    if (payer.includes("Blue Cross") || payer.includes("BCBS")) {
      prefix = "BCBS";
    } else if (payer.includes("Medicare")) {
      prefix = "1EG4";
    } else if (payer.includes("Medicaid")) {
      prefix = "MCD";
    } else {
      // Take first 3 consonants or letters
      prefix = payer.replace(/[^A-Z]/gi, "").slice(0, 3).toUpperCase() || "MEM";
    }
  }
  
  const num = Math.random().toString().slice(2, 11);
  return `${prefix}${num}`;
}

async function seed() {
  console.log("Seeding database with realistic healthcare data...");

  // Check if data already exists
  const existingUsers = await db.select().from(users).limit(1);
  const existingLeads = await db.select().from(leads).limit(1);
  
  if (existingUsers.length > 0 && existingLeads.length > 0) {
    console.log("Database already contains data. Skipping seed.");
    console.log("To re-seed, clear the database first.");
    process.exit(0);
  }

  await db.insert(users).values({
    email: "admin@claimshield.ai",
    password: "admin123",
    role: "admin",
    name: "System Administrator",
  }).onConflictDoNothing();

  const leadData = [];
  for (let i = 0; i < 12; i++) {
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    const statuses = ["new", "contacted", "qualified", "unqualified", "converted"];
    const sources = ["website", "referral", "phone", "insurance_portal", "physician_referral", "marketing"];
    
    leadData.push({
      name: `${firstName} ${lastName}`,
      phone: randomPhone(),
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@email.com`,
      source: sources[Math.floor(Math.random() * sources.length)],
      status: statuses[Math.floor(Math.random() * statuses.length)],
    });
  }
  const insertedLeads = await db.insert(leads).values(leadData).returning();
  console.log(`Created ${insertedLeads.length} leads`);

  const patientData = [];
  for (let i = 0; i < 50; i++) {
    const payer = realPayers[Math.floor(Math.random() * realPayers.length)];
    const planTypes = ["PPO", "HMO", "EPO", "POS", "Medicare Advantage", "Medicaid Managed Care"];
    
    patientData.push({
      leadId: insertedLeads[i % insertedLeads.length].id,
      dob: randomDOB(),
      state: states[Math.floor(Math.random() * states.length)],
      insuranceCarrier: payer,
      memberId: randomMemberId(payer),
      planType: planTypes[Math.floor(Math.random() * planTypes.length)],
    });
  }
  const insertedPatients = await db.insert(patients).values(patientData).returning();
  console.log(`Created ${insertedPatients.length} patients`);

  const encounterData = [];
  for (const patient of insertedPatients) {
    const daysAgo = Math.floor(Math.random() * 60);
    encounterData.push({
      patientId: patient.id,
      serviceType: serviceTypes[Math.floor(Math.random() * serviceTypes.length)],
      facilityType: facilityTypes[Math.floor(Math.random() * facilityTypes.length)],
      admissionType: ["Scheduled", "Urgent", "Emergency", "Elective"][Math.floor(Math.random() * 4)],
      expectedStartDate: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    });
  }
  const insertedEncounters = await db.insert(encounters).values(encounterData).returning();
  console.log(`Created ${insertedEncounters.length} encounters`);

  const cptCodes = Object.keys(cptCodeDetails);
  const claimData = [];
  const statuses = ["created", "verified", "submitted", "acknowledged", "pending", "suspended", "denied", "appealed", "paid"];
  
  for (let i = 0; i < insertedPatients.length; i++) {
    const patient = insertedPatients[i];
    const numCodes = Math.floor(Math.random() * 3) + 1;
    const selectedCpts: string[] = [];
    for (let j = 0; j < numCodes; j++) {
      const code = cptCodes[Math.floor(Math.random() * cptCodes.length)];
      if (!selectedCpts.includes(code)) selectedCpts.push(code);
    }
    
    const baseAmount = selectedCpts.reduce((sum, code) => sum + cptCodeDetails[code].avgAmount, 0);
    const amount = Math.round(baseAmount * (0.8 + Math.random() * 0.4));
    
    const riskScore = Math.floor(Math.random() * 100);
    const readinessStatus = riskScore > 70 ? "RED" : riskScore > 40 ? "YELLOW" : "GREEN";
    
    const statusWeights = [0.08, 0.1, 0.15, 0.15, 0.12, 0.05, 0.1, 0.05, 0.2];
    let rand = Math.random();
    let statusIndex = 0;
    for (let w = 0; w < statusWeights.length; w++) {
      rand -= statusWeights[w];
      if (rand <= 0) {
        statusIndex = w;
        break;
      }
    }
    
    claimData.push({
      patientId: patient.id,
      encounterId: insertedEncounters[i].id,
      payer: patient.insuranceCarrier,
      cptCodes: selectedCpts,
      amount,
      status: statuses[statusIndex],
      riskScore,
      readinessStatus,
    });
  }
  const insertedClaims = await db.insert(claims).values(claimData).returning();
  console.log(`Created ${insertedClaims.length} claims`);

  const eventData: Array<{ claimId: string; type: string; notes: string; timestamp?: Date }> = [];
  for (const claim of insertedClaims) {
    const baseDate = new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000);
    let eventDate = new Date(baseDate);
    
    const addEvent = (type: string, notes: string, hoursLater: number) => {
      eventDate = new Date(eventDate.getTime() + hoursLater * 60 * 60 * 1000);
      eventData.push({
        claimId: claim.id,
        type,
        notes,
        timestamp: eventDate,
      });
    };

    addEvent("Created", "Claim created from encounter data, risk assessment initiated", 0);
    
    if (["verified", "submitted", "acknowledged", "pending", "suspended", "denied", "appealed", "paid"].includes(claim.status)) {
      addEvent("Verified", "Patient eligibility confirmed, coverage active through plan year", 4 + Math.random() * 20);
    }
    if (["submitted", "acknowledged", "pending", "suspended", "denied", "appealed", "paid"].includes(claim.status)) {
      addEvent("Submitted", `Claim submitted electronically via EDI 837P to ${claim.payer}`, 2 + Math.random() * 8);
    }
    if (["acknowledged", "pending", "suspended", "denied", "appealed", "paid"].includes(claim.status)) {
      addEvent("Acknowledged", `${claim.payer} confirmed receipt, assigned ICN for tracking`, 1 + Math.random() * 24);
    }
    if (["pending", "suspended", "denied", "appealed", "paid"].includes(claim.status)) {
      addEvent("Pending", "Claim in adjudication queue, awaiting medical review", 24 + Math.random() * 72);
    }
    if (claim.status === "suspended") {
      addEvent("Suspended", "Additional documentation requested by payer medical review", 12 + Math.random() * 48);
    }
    if (claim.status === "denied") {
      addEvent("Denied", "Claim denied - see denial reason code for details", 24 + Math.random() * 120);
    }
    if (claim.status === "appealed") {
      addEvent("Denied", "Initial claim denied", 24 + Math.random() * 72);
      addEvent("Appealed", "Appeal submitted with supporting clinical documentation", 48 + Math.random() * 96);
    }
    if (claim.status === "paid") {
      addEvent("Paid", `Payment received via EFT, deposited to operating account`, 48 + Math.random() * 168);
    }
  }
  await db.insert(claimEvents).values(eventData);
  console.log(`Created ${eventData.length} claim events`);

  const denialData: Array<{ claimId: string; denialCategory: string; denialReasonText: string; payer: string; cptCode: string; rootCauseTag: string; resolved: boolean }> = [];
  const deniedClaims = insertedClaims.filter(c => c.status === "denied" || c.status === "appealed");
  
  for (const claim of deniedClaims) {
    const denial = denialReasons[Math.floor(Math.random() * denialReasons.length)];
    denialData.push({
      claimId: claim.id,
      denialCategory: denial.category,
      denialReasonText: `${denial.code}: ${denial.text}`,
      payer: claim.payer,
      cptCode: claim.cptCodes[0] as string,
      rootCauseTag: denial.rootCause,
      resolved: claim.status === "appealed" ? Math.random() > 0.5 : false,
    });
  }
  
  for (let i = 0; i < 25; i++) {
    const payer = realPayers[Math.floor(Math.random() * realPayers.length)];
    const cptCode = cptCodes[Math.floor(Math.random() * cptCodes.length)];
    const denial = denialReasons[Math.floor(Math.random() * denialReasons.length)];
    const randomClaim = insertedClaims[Math.floor(Math.random() * insertedClaims.length)];
    
    denialData.push({
      claimId: randomClaim.id,
      denialCategory: denial.category,
      denialReasonText: `${denial.code}: ${denial.text}`,
      payer,
      cptCode,
      rootCauseTag: denial.rootCause,
      resolved: Math.random() > 0.6,
    });
  }
  await db.insert(denials).values(denialData);
  console.log(`Created ${denialData.length} denials`);

  const ruleData = [
    {
      name: "UHC Prior Auth - Behavioral Health",
      description: "UnitedHealthcare requires prior authorization for all behavioral health CPT codes 90834-90847",
      payer: "UnitedHealthcare",
      cptCode: "90837",
      triggerPattern: "payer='UnitedHealthcare' AND cptCode IN ('90834','90837','90847') AND authStatus IS NULL",
      preventionAction: "Submit prior authorization request via UHC Provider Portal before claim submission",
      enabled: true,
      impactCount: 34,
    },
    {
      name: "BCBS Timely Filing - 90 Days",
      description: "Blue Cross Blue Shield has strict 90-day timely filing limit from date of service",
      payer: "Blue Cross Blue Shield",
      cptCode: null,
      triggerPattern: "payer='Blue Cross Blue Shield' AND daysSinceService > 75",
      preventionAction: "Escalate for immediate submission - approaching BCBS 90-day filing deadline",
      enabled: true,
      impactCount: 52,
    },
    {
      name: "Medicare Medical Necessity - E/M Codes",
      description: "Medicare requires ABN for E/M codes when medical necessity documentation is incomplete",
      payer: "Medicare",
      cptCode: "99215",
      triggerPattern: "payer='Medicare' AND cptCode IN ('99214','99215','99205') AND abnStatus != 'signed'",
      preventionAction: "Obtain signed ABN from patient before proceeding with high-level E/M service",
      enabled: true,
      impactCount: 78,
    },
    {
      name: "Aetna COB Verification",
      description: "Verify coordination of benefits for Aetna patients with potential secondary coverage",
      payer: "Aetna",
      cptCode: null,
      triggerPattern: "payer='Aetna' AND cobStatus != 'verified' AND planType='PPO'",
      preventionAction: "Contact Aetna to verify primary/secondary coverage before submission",
      enabled: true,
      impactCount: 23,
    },
    {
      name: "Cigna Bundling - PT Services",
      description: "Cigna bundles 97110 with 97140 when performed same day - bill only primary code",
      payer: "Cigna",
      cptCode: "97110",
      triggerPattern: "payer='Cigna' AND cptCodes CONTAINS ('97110','97140') AND sameDay=true",
      preventionAction: "Remove bundled code 97140 or append modifier 59 if distinct service",
      enabled: true,
      impactCount: 19,
    },
    {
      name: "Humana Eligibility - Monthly Check",
      description: "Humana Medicaid plans require monthly eligibility verification",
      payer: "Humana",
      cptCode: null,
      triggerPattern: "payer='Humana' AND planType='Medicaid Managed Care' AND eligibilityAge > 30",
      preventionAction: "Re-verify patient eligibility through Humana provider portal",
      enabled: false,
      impactCount: 12,
    },
    {
      name: "Kaiser Referral Required",
      description: "Kaiser HMO requires referral authorization for specialist consultations",
      payer: "Kaiser Permanente",
      cptCode: "99244",
      triggerPattern: "payer='Kaiser Permanente' AND cptCode IN ('99243','99244','99245') AND referralStatus IS NULL",
      preventionAction: "Obtain Kaiser referral authorization before scheduling consultation",
      enabled: true,
      impactCount: 41,
    },
    {
      name: "Duplicate Claim Detection",
      description: "Prevent duplicate claim submissions across all payers",
      payer: null,
      cptCode: null,
      triggerPattern: "EXISTS(claim WHERE payer=current.payer AND cptCode=current.cptCode AND dos=current.dos AND patientId=current.patientId)",
      preventionAction: "Review potential duplicate - check if correction/void needed for original claim",
      enabled: true,
      impactCount: 67,
    },
  ];
  await db.insert(rules).values(ruleData);
  console.log(`Created ${ruleData.length} prevention rules`);

  console.log("\nSeeding completed with realistic healthcare data!");
  console.log(`Summary: ${insertedLeads.length} leads, ${insertedPatients.length} patients, ${insertedClaims.length} claims, ${denialData.length} denials, ${ruleData.length} rules`);
}

seed().catch(console.error).finally(() => process.exit(0));
