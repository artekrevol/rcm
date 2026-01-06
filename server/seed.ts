import { db } from "./db";
import { users, leads, patients, encounters, claims, claimEvents, denials, rules } from "@shared/schema";

const payers = ["Payor A", "Payor B", "Payor C", "Payor D", "Payor E"];
const cptCodeGroups = [
  ["90834", "90837"],
  ["99213", "99214", "99215"],
  ["90847", "90832"],
  ["97110", "97140"],
  ["99223", "99291"],
];
const rootCauses = ["Missing Auth", "Invalid Coding", "Timely Filing", "Duplicate Claim", "Eligibility Issues"];
const serviceTypes = ["Outpatient Mental Health", "Inpatient", "Substance Abuse"];
const states = ["CA", "TX", "NY", "FL", "IL", "PA", "OH", "GA", "NC", "MI"];
const carriers = ["Blue Cross Blue Shield", "Aetna", "Cigna", "UnitedHealth", "Anthem", "Humana", "Kaiser"];

async function seed() {
  console.log("Seeding database...");

  await db.insert(users).values({
    email: "demo@claimshield.ai",
    password: "demo123",
    role: "admin",
    name: "Demo User",
  }).onConflictDoNothing();

  const leadData = [
    { name: "Sarah Johnson", phone: "(555) 123-4567", email: "sarah.j@email.com", source: "website", status: "new" },
    { name: "Michael Chen", phone: "(555) 234-5678", email: "m.chen@email.com", source: "referral", status: "contacted" },
    { name: "Emily Rodriguez", phone: "(555) 345-6789", email: "emily.r@email.com", source: "phone", status: "qualified" },
    { name: "David Kim", phone: "(555) 456-7890", email: "d.kim@email.com", source: "event", status: "new" },
    { name: "Lisa Thompson", phone: "(555) 567-8901", email: "lisa.t@email.com", source: "website", status: "converted" },
    { name: "James Wilson", phone: "(555) 678-9012", email: "j.wilson@email.com", source: "referral", status: "qualified" },
    { name: "Amanda Davis", phone: "(555) 789-0123", email: "amanda.d@email.com", source: "phone", status: "unqualified" },
    { name: "Robert Martinez", phone: "(555) 890-1234", email: "r.martinez@email.com", source: "website", status: "new" },
  ];

  const insertedLeads = await db.insert(leads).values(leadData).returning();
  console.log(`Created ${insertedLeads.length} leads`);

  const patientData = [];
  for (let i = 0; i < 40; i++) {
    patientData.push({
      leadId: insertedLeads[i % insertedLeads.length].id,
      dob: `${1960 + Math.floor(Math.random() * 40)}-${String(Math.floor(Math.random() * 12) + 1).padStart(2, "0")}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, "0")}`,
      state: states[Math.floor(Math.random() * states.length)],
      insuranceCarrier: carriers[Math.floor(Math.random() * carriers.length)],
      memberId: `MEM${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      planType: ["PPO", "HMO", "EPO", "POS"][Math.floor(Math.random() * 4)],
    });
  }
  const insertedPatients = await db.insert(patients).values(patientData).returning();
  console.log(`Created ${insertedPatients.length} patients`);

  const encounterData = [];
  for (const patient of insertedPatients) {
    encounterData.push({
      patientId: patient.id,
      serviceType: serviceTypes[Math.floor(Math.random() * serviceTypes.length)],
      facilityType: ["Hospital", "Clinic", "Outpatient Center"][Math.floor(Math.random() * 3)],
      admissionType: ["Scheduled", "Emergency", "Elective"][Math.floor(Math.random() * 3)],
      expectedStartDate: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    });
  }
  const insertedEncounters = await db.insert(encounters).values(encounterData).returning();
  console.log(`Created ${insertedEncounters.length} encounters`);

  const claimData = [];
  const statuses = ["created", "verified", "submitted", "acknowledged", "pending", "denied", "paid"];
  
  for (let i = 0; i < insertedPatients.length; i++) {
    const riskScore = Math.floor(Math.random() * 100);
    const readinessStatus = riskScore > 70 ? "RED" : riskScore > 40 ? "YELLOW" : "GREEN";
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    const cptGroup = cptCodeGroups[Math.floor(Math.random() * cptCodeGroups.length)];
    const selectedCpts = cptGroup.slice(0, Math.floor(Math.random() * 2) + 1);
    
    claimData.push({
      patientId: insertedPatients[i].id,
      encounterId: insertedEncounters[i].id,
      payer: payers[Math.floor(Math.random() * payers.length)],
      cptCodes: selectedCpts,
      amount: Math.floor(Math.random() * 15000) + 500,
      status,
      riskScore,
      readinessStatus,
    });
  }
  const insertedClaims = await db.insert(claims).values(claimData).returning();
  console.log(`Created ${insertedClaims.length} claims`);

  const eventData = [];
  for (const claim of insertedClaims) {
    eventData.push({
      claimId: claim.id,
      type: "Created",
      notes: "Claim created and risk assessed",
    });
    
    if (["verified", "submitted", "acknowledged", "pending", "denied", "paid"].includes(claim.status)) {
      eventData.push({
        claimId: claim.id,
        type: "Verified",
        notes: "Patient eligibility verified",
      });
    }
    if (["submitted", "acknowledged", "pending", "denied", "paid"].includes(claim.status)) {
      eventData.push({
        claimId: claim.id,
        type: "Submitted",
        notes: "Claim submitted to payer",
      });
    }
    if (["acknowledged", "pending", "denied", "paid"].includes(claim.status)) {
      eventData.push({
        claimId: claim.id,
        type: "Acknowledged",
        notes: "Payer acknowledged receipt",
      });
    }
    if (["pending", "denied", "paid"].includes(claim.status)) {
      eventData.push({
        claimId: claim.id,
        type: "Pending",
        notes: "Awaiting payer decision",
      });
    }
    if (claim.status === "denied") {
      eventData.push({
        claimId: claim.id,
        type: "Denied",
        notes: "Claim denied by payer",
      });
    }
    if (claim.status === "paid") {
      eventData.push({
        claimId: claim.id,
        type: "Paid",
        notes: "Payment received",
      });
    }
  }
  await db.insert(claimEvents).values(eventData);
  console.log(`Created ${eventData.length} claim events`);

  const denialData = [];
  const deniedClaims = insertedClaims.filter(c => c.status === "denied");
  for (const claim of deniedClaims) {
    const rootCause = rootCauses[Math.floor(Math.random() * rootCauses.length)];
    denialData.push({
      claimId: claim.id,
      denialCategory: "Administrative",
      denialReasonText: `Claim denied: ${rootCause}`,
      payer: claim.payer,
      cptCode: claim.cptCodes[0] as string,
      rootCauseTag: rootCause,
      resolved: Math.random() > 0.7,
    });
  }
  
  for (let i = 0; i < 15; i++) {
    const payer = payers[Math.floor(Math.random() * payers.length)];
    const cptGroup = cptCodeGroups[Math.floor(Math.random() * cptCodeGroups.length)];
    const rootCause = rootCauses[Math.floor(Math.random() * rootCauses.length)];
    
    denialData.push({
      claimId: insertedClaims[Math.floor(Math.random() * insertedClaims.length)].id,
      denialCategory: ["Administrative", "Clinical", "Technical"][Math.floor(Math.random() * 3)],
      denialReasonText: `Claim denied: ${rootCause}`,
      payer,
      cptCode: cptGroup[0],
      rootCauseTag: rootCause,
      resolved: Math.random() > 0.6,
    });
  }
  await db.insert(denials).values(denialData);
  console.log(`Created ${denialData.length} denials`);

  const ruleData = [
    {
      name: "Prior Auth Required for Inpatient",
      description: "Block inpatient claims without prior authorization",
      payer: "Payor A",
      cptCode: "99223",
      triggerPattern: "serviceType=Inpatient AND authStatus=missing",
      preventionAction: "Require prior authorization before submission",
      enabled: true,
      impactCount: 23,
    },
    {
      name: "Timely Filing Check",
      description: "Alert when claim approaches filing deadline",
      payer: null,
      cptCode: null,
      triggerPattern: "daysSinceService > 85 AND status=created",
      preventionAction: "Prioritize submission to avoid timely filing denial",
      enabled: true,
      impactCount: 45,
    },
    {
      name: "Duplicate Claim Prevention",
      description: "Detect potential duplicate claims before submission",
      payer: null,
      cptCode: null,
      triggerPattern: "matchingClaim(payer, cptCode, dateOfService) EXISTS",
      preventionAction: "Review for duplicate before submission",
      enabled: true,
      impactCount: 12,
    },
    {
      name: "Eligibility Verification Required",
      description: "Ensure patient eligibility is verified before submission",
      payer: "Payor B",
      cptCode: null,
      triggerPattern: "eligibilityStatus != verified",
      preventionAction: "Complete eligibility verification",
      enabled: true,
      impactCount: 67,
    },
    {
      name: "Mental Health Auth Rule",
      description: "Require authorization for mental health CPT codes",
      payer: "Payor C",
      cptCode: "90837",
      triggerPattern: "cptCode IN (90834, 90837) AND authStatus != approved",
      preventionAction: "Obtain mental health authorization",
      enabled: false,
      impactCount: 8,
    },
  ];
  await db.insert(rules).values(ruleData);
  console.log(`Created ${ruleData.length} rules`);

  console.log("Seeding completed!");
}

seed().catch(console.error).finally(() => process.exit(0));
