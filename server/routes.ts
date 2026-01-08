import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import {
  insertLeadSchema,
  insertRuleSchema,
  insertCallSchema,
} from "@shared/schema";
import { allPayers } from "./payers";

export async function registerRoutes(server: Server, app: Express): Promise<void> {
  
  app.get("/api/payers", async (req, res) => {
    res.json(allPayers);
  });

  app.get("/api/dashboard/metrics", async (req, res) => {
    const metrics = await storage.getDashboardMetrics();
    res.json(metrics);
  });

  app.get("/api/dashboard/alerts", async (req, res) => {
    const claims = await storage.getClaims();
    const alerts = [];
    
    for (const claim of claims.filter(c => c.readinessStatus === "RED").slice(0, 3)) {
      alerts.push({
        id: claim.id,
        type: "risk",
        title: "High-Risk Claim Blocked",
        description: `Claim ${claim.id.slice(0, 8)} for ${claim.payer} requires prior authorization`,
        claimId: claim.id,
        severity: "high",
        timestamp: claim.createdAt,
      });
    }
    
    const events = [];
    for (const claim of claims.slice(0, 5)) {
      const claimEvents = await storage.getClaimEvents(claim.id);
      const pendingEvent = claimEvents.find(e => e.type === "Pending");
      if (pendingEvent) {
        const daysPending = Math.floor((Date.now() - new Date(pendingEvent.timestamp).getTime()) / (1000 * 60 * 60 * 24));
        if (daysPending > 7) {
          alerts.push({
            id: `stuck-${claim.id}`,
            type: "stuck",
            title: "Claim Stuck in Pending",
            description: `Claim ${claim.id.slice(0, 8)} has been pending for ${daysPending} days`,
            claimId: claim.id,
            severity: "medium",
            timestamp: pendingEvent.timestamp,
          });
        }
      }
    }
    
    res.json(alerts.slice(0, 5));
  });

  app.get("/api/leads", async (req, res) => {
    const leads = await storage.getLeads();
    res.json(leads);
  });

  app.get("/api/leads/:id", async (req, res) => {
    const lead = await storage.getLead(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }
    res.json(lead);
  });

  app.post("/api/leads", async (req, res) => {
    const parsed = insertLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    const lead = await storage.createLead(parsed.data);
    res.status(201).json(lead);
  });

  app.get("/api/leads/:id/calls", async (req, res) => {
    const calls = await storage.getCallsByLeadId(req.params.id);
    res.json(calls);
  });

  app.get("/api/leads/:id/patient", async (req, res) => {
    const patient = await storage.getPatientByLeadId(req.params.id);
    res.json(patient || null);
  });

  app.post("/api/leads/:id/call", async (req, res) => {
    const lead = await storage.getLead(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const callData = {
      leadId: req.params.id,
      vapiCallId: null,
      transcript: req.body.transcript || generateIntakeTranscript(lead.name),
      summary: req.body.summary || `VOB call completed with ${lead.name}. Insurance verified.`,
      disposition: req.body.disposition || "qualified",
      extractedData: req.body.extractedData || generateIntakeData(),
    };

    const call = await storage.createCall(callData);

    if (callData.extractedData?.qualified) {
      await storage.updateLead(req.params.id, { status: "qualified" });
      
      const existingPatient = await storage.getPatientByLeadId(req.params.id);
      if (!existingPatient && callData.extractedData) {
        await storage.createPatient({
          leadId: req.params.id,
          dob: "1985-03-15",
          state: callData.extractedData.state || "CA",
          insuranceCarrier: callData.extractedData.insuranceCarrier || "Blue Cross",
          memberId: callData.extractedData.memberId || "MEM" + Math.random().toString(36).slice(2, 10).toUpperCase(),
          planType: "PPO",
        });
      }
    }

    res.status(201).json(call);
  });

  app.post("/api/leads/:id/claim-packet", async (req, res) => {
    const lead = await storage.getLead(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const patient = await storage.getPatientByLeadId(req.params.id);
    if (!patient) {
      return res.status(400).json({ error: "Patient info not available. Complete VOB call first." });
    }

    const encounter = await storage.createEncounter({
      patientId: patient.id,
      serviceType: "Outpatient",
      facilityType: "Hospital",
      admissionType: "Elective",
      expectedStartDate: new Date().toISOString().split("T")[0],
    });

    const payers = ["Payor A", "Payor B", "Payor C", "Payor D", "Payor E"];
    const cptCodes = ["90834", "90837", "99213", "99214", "99215"];
    const randomCpts = [cptCodes[Math.floor(Math.random() * cptCodes.length)]];
    const riskScore = Math.floor(Math.random() * 100);
    const readinessStatus = riskScore > 70 ? "RED" : riskScore > 40 ? "YELLOW" : "GREEN";

    const claim = await storage.createClaim({
      patientId: patient.id,
      encounterId: encounter.id,
      payer: patient.insuranceCarrier.includes("Blue") ? "Payor A" : payers[Math.floor(Math.random() * payers.length)],
      cptCodes: randomCpts,
      amount: Math.floor(Math.random() * 5000) + 1000,
      status: "created",
      riskScore,
      readinessStatus,
    });

    await storage.createClaimEvent({
      claimId: claim.id,
      type: "Created",
      notes: "Claim packet created from lead intake",
    });

    await storage.updateLead(req.params.id, { status: "converted" });

    res.status(201).json({ claimId: claim.id });
  });

  app.get("/api/claims/recent", async (req, res) => {
    const claims = await storage.getClaims();
    res.json(claims.slice(0, 10));
  });

  app.get("/api/claims", async (req, res) => {
    const claims = await storage.getClaims();
    res.json(claims);
  });

  app.get("/api/claims/:id", async (req, res) => {
    const claim = await storage.getClaim(req.params.id);
    if (!claim) {
      return res.status(404).json({ error: "Claim not found" });
    }
    res.json(claim);
  });

  app.get("/api/claims/:id/events", async (req, res) => {
    const events = await storage.getClaimEvents(req.params.id);
    res.json(events);
  });

  app.get("/api/claims/:id/explanation", async (req, res) => {
    const explanation = await storage.getRiskExplanation(req.params.id);
    res.json(explanation || null);
  });

  app.get("/api/claims/:id/patient", async (req, res) => {
    const patient = await storage.getClaimPatient(req.params.id);
    res.json(patient || null);
  });

  app.post("/api/claims/:id/submit", async (req, res) => {
    const claim = await storage.getClaim(req.params.id);
    if (!claim) {
      return res.status(404).json({ error: "Claim not found" });
    }

    if (claim.readinessStatus === "RED") {
      return res.status(400).json({ error: "Claim is blocked. Resolve issues before submission." });
    }

    await storage.updateClaim(req.params.id, { status: "submitted" });
    await storage.createClaimEvent({
      claimId: req.params.id,
      type: "Submitted",
      notes: "Claim submitted to payer",
    });

    res.json({ success: true });
  });

  app.get("/api/intelligence/clusters", async (req, res) => {
    const clusters = await storage.getDenialClusters();
    res.json(clusters);
  });

  app.get("/api/intelligence/top-patterns", async (req, res) => {
    const patterns = await storage.getTopPatterns();
    res.json(patterns);
  });

  app.get("/api/rules", async (req, res) => {
    const rules = await storage.getRules();
    res.json(rules);
  });

  app.post("/api/rules", async (req, res) => {
    const parsed = insertRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    const rule = await storage.createRule(parsed.data);
    res.status(201).json(rule);
  });

  app.post("/api/rules/generate", async (req, res) => {
    const { payer, cptCode, rootCause, suggestedRule } = req.body;
    
    const rule = await storage.createRule({
      name: suggestedRule?.name || `Prevent ${rootCause} for ${payer}`,
      description: suggestedRule?.description || `Auto-generated rule to prevent ${rootCause} denials`,
      payer: payer || null,
      cptCode: cptCode || null,
      triggerPattern: suggestedRule?.triggerPattern || `payer=${payer} AND cptCode=${cptCode}`,
      preventionAction: suggestedRule?.preventionAction || "Block submission pending review",
      enabled: true,
    });

    res.status(201).json(rule);
  });

  app.patch("/api/rules/:id", async (req, res) => {
    const rule = await storage.updateRule(req.params.id, req.body);
    if (!rule) {
      return res.status(404).json({ error: "Rule not found" });
    }
    res.json(rule);
  });

  app.delete("/api/rules/:id", async (req, res) => {
    await storage.deleteRule(req.params.id);
    res.json({ success: true });
  });

}

function generateIntakeTranscript(patientName: string): string {
  return `Agent: Good morning! This is Sarah from ClaimShield calling to verify insurance benefits. May I speak with ${patientName}?

Patient: Yes, this is ${patientName}.

Agent: Thank you. I'm calling to verify your insurance information for your upcoming appointment. Can you confirm your insurance carrier?

Patient: Yes, I have Blue Cross Blue Shield.

Agent: Perfect. And what is your member ID?

Patient: It's BCB-8847562.

Agent: Thank you. I see you have a PPO plan. Can you confirm the service you're seeking is outpatient mental health services?

Patient: Yes, that's correct.

Agent: Great. I need to let you know that I'll be recording this call for quality purposes and to document your consent for verification. Do you consent to having your insurance benefits verified?

Patient: Yes, I consent.

Agent: Thank you, ${patientName}. Based on my initial check, your plan appears to cover outpatient mental health services with a $40 copay per visit. A detailed verification will be completed, and someone from our office will reach out if there are any issues.

Patient: That sounds good. Thank you!

Agent: You're welcome! Have a great day.`;
}

function generateIntakeData() {
  const carriers = ["Blue Cross Blue Shield", "Aetna", "Cigna", "UnitedHealth", "Anthem"];
  const states = ["CA", "TX", "NY", "FL", "IL"];
  const services = ["Outpatient Mental Health", "Physical Therapy", "Substance Abuse Treatment"];
  
  return {
    insuranceCarrier: carriers[Math.floor(Math.random() * carriers.length)],
    memberId: "MEM" + Math.random().toString(36).slice(2, 10).toUpperCase(),
    serviceType: services[Math.floor(Math.random() * services.length)],
    state: states[Math.floor(Math.random() * states.length)],
    consent: true,
    qualified: true,
    notes: "Patient verified and qualified for services",
  };
}
