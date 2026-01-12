import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import {
  insertLeadSchema,
  insertRuleSchema,
  insertCallSchema,
  type Lead,
  type Patient,
} from "@shared/schema";
import { allPayers } from "./payers";

// Helper function to sync patient data to lead and recalculate VOB score
// clearedFields: array of field names that were explicitly cleared in the update
async function syncPatientToLeadWithClears(patient: Patient, extractedData?: any, clearedFields: string[] = []): Promise<void> {
  const lead = await storage.getLead(patient.leadId);
  if (!lead) return;
  
  const leadUpdate: Record<string, any> = {};
  
  // Sync patient values to lead - only copy truthy values
  if (patient.insuranceCarrier) leadUpdate.insuranceCarrier = patient.insuranceCarrier;
  if (patient.memberId) leadUpdate.memberId = patient.memberId;
  if (patient.planType) leadUpdate.planType = patient.planType;
  if (patient.state) leadUpdate.state = patient.state;
  
  // Explicitly clear lead fields that were cleared in the patient update
  for (const field of clearedFields) {
    leadUpdate[field] = null;
  }
  
  // Backfill serviceNeeded from extracted call data
  if (extractedData) {
    const service = extractedData.serviceType || extractedData.serviceNeeded;
    if (service && service !== "Unknown") {
      leadUpdate.serviceNeeded = service;
    }
  }
  
  // Calculate VOB score based on the final lead state after updates
  const finalState = { ...lead, ...leadUpdate };
  const vobMissingFields: string[] = [];
  if (!finalState.insuranceCarrier) vobMissingFields.push("Insurance Carrier");
  if (!finalState.memberId) vobMissingFields.push("Member ID");
  if (!finalState.serviceNeeded) vobMissingFields.push("Service Needed");
  if (!finalState.planType) vobMissingFields.push("Plan Type");
  
  const totalVobFields = 4;
  const completedFields = totalVobFields - vobMissingFields.length;
  leadUpdate.vobScore = Math.round((completedFields / totalVobFields) * 100);
  leadUpdate.vobMissingFields = vobMissingFields;
  
  // Update VOB status based on completeness
  if (vobMissingFields.length === 0) {
    leadUpdate.vobStatus = "verified";
  } else if (lead.vobStatus === "verified" || clearedFields.length > 0) {
    // Downgrade if was verified or if fields were explicitly cleared
    leadUpdate.vobStatus = "in_progress";
  }
  
  if (Object.keys(leadUpdate).length > 0) {
    await storage.updateLead(patient.leadId, leadUpdate);
  }
}

// Simple sync that only adds data, never removes
async function syncPatientToLead(patient: Patient, extractedData?: any): Promise<void> {
  const lead = await storage.getLead(patient.leadId);
  if (!lead) return;
  
  const leadUpdate: Record<string, any> = {};
  
  // Sync patient values to lead - only copy truthy values
  // Patient data supplements lead data, doesn't replace it with nulls
  if (patient.insuranceCarrier) leadUpdate.insuranceCarrier = patient.insuranceCarrier;
  if (patient.memberId) leadUpdate.memberId = patient.memberId;
  if (patient.planType) leadUpdate.planType = patient.planType;
  if (patient.state) leadUpdate.state = patient.state;
  
  // Backfill serviceNeeded from extracted call data
  if (extractedData) {
    const service = extractedData.serviceType || extractedData.serviceNeeded;
    if (service && service !== "Unknown") {
      leadUpdate.serviceNeeded = service;
    }
  }
  
  // Calculate VOB score based on the final lead state after updates
  const finalState = { ...lead, ...leadUpdate };
  const vobMissingFields: string[] = [];
  if (!finalState.insuranceCarrier) vobMissingFields.push("Insurance Carrier");
  if (!finalState.memberId) vobMissingFields.push("Member ID");
  if (!finalState.serviceNeeded) vobMissingFields.push("Service Needed");
  if (!finalState.planType) vobMissingFields.push("Plan Type");
  
  const totalVobFields = 4;
  const completedFields = totalVobFields - vobMissingFields.length;
  leadUpdate.vobScore = Math.round((completedFields / totalVobFields) * 100);
  leadUpdate.vobMissingFields = vobMissingFields;
  
  // Update VOB status based on completeness
  if (vobMissingFields.length === 0) {
    leadUpdate.vobStatus = "verified";
  } else if (lead.vobStatus === "verified") {
    // Only downgrade if was previously verified
    leadUpdate.vobStatus = "in_progress";
  }
  
  if (Object.keys(leadUpdate).length > 0) {
    await storage.updateLead(patient.leadId, leadUpdate);
  }
}

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

  // Worklist API with queue filtering
  app.get("/api/leads/worklist", async (req, res) => {
    const allLeads = await storage.getLeads();
    const queue = req.query.queue as string || "all";
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    // Queue filter functions
    const queueFilters: Record<string, (lead: typeof allLeads[0]) => boolean> = {
      all: () => true,
      sla_breach: (lead) => {
        // Use slaDeadlineAt if present, otherwise fallback to legacy logic
        if (lead.slaDeadlineAt) {
          const deadline = new Date(lead.slaDeadlineAt);
          const isOverdue = deadline < now;
          const isNotConverted = lead.status !== "converted" && lead.status !== "lost";
          return isOverdue && isNotConverted;
        }
        // Legacy fallback for leads without slaDeadlineAt
        const isNew = lead.status === "new" || lead.status === "attempting_contact";
        const createdRecently = new Date(lead.createdAt) >= oneDayAgo;
        const notContacted = !lead.lastContactedAt;
        const createdOverHourAgo = new Date(lead.createdAt) <= oneHourAgo;
        return isNew && createdRecently && notContacted && createdOverHourAgo;
      },
      not_contacted: (lead) => lead.status === "new" && lead.attemptCount === 0,
      incomplete_vob: (lead) => {
        return lead.vobScore < 100 || !lead.insuranceCarrier || !lead.memberId || !lead.planType;
      },
      vob_complete_needs_admissions: (lead) => {
        return lead.vobStatus === "verified" && lead.handoffStatus === "not_sent";
      },
      follow_up_today: (lead) => {
        if (!lead.nextActionAt) return false;
        const actionAt = new Date(lead.nextActionAt);
        return actionAt <= endOfToday && !["converted", "lost"].includes(lead.status);
      },
    };

    // Calculate counts for each queue
    const countsByQueue: Record<string, number> = {};
    for (const [queueName, filterFn] of Object.entries(queueFilters)) {
      countsByQueue[queueName] = allLeads.filter(filterFn).length;
    }

    // Apply selected queue filter
    const filterFn = queueFilters[queue] || queueFilters.all;
    let filteredLeads = allLeads.filter(filterFn);

    // Sort by priority (P0 first), then by createdAt (newest first)
    filteredLeads.sort((a, b) => {
      const priorityOrder = { P0: 0, P1: 1, P2: 2 };
      const aPriority = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 2;
      const bPriority = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 2;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    // Pagination
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 50;
    const startIndex = (page - 1) * pageSize;
    const paginatedLeads = filteredLeads.slice(startIndex, startIndex + pageSize);

    res.json({
      rows: paginatedLeads,
      countsByQueue,
      total: filteredLeads.length,
      page,
      pageSize,
    });
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
    
    // Auto-assign SLA deadline based on priority
    const priority = parsed.data.priority || "P2";
    const now = new Date();
    let slaDeadlineAt: Date;
    
    if (priority === "P0") {
      slaDeadlineAt = new Date(now.getTime() + 1 * 60 * 60 * 1000); // 1 hour
    } else if (priority === "P1") {
      slaDeadlineAt = new Date(now.getTime() + 4 * 60 * 60 * 1000); // 4 hours
    } else {
      slaDeadlineAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
    }
    
    // Compute VOB missing fields and score
    const vobMissingFields: string[] = [];
    if (!parsed.data.insuranceCarrier) vobMissingFields.push("Insurance Carrier");
    if (!parsed.data.memberId) vobMissingFields.push("Member ID");
    if (!parsed.data.serviceNeeded) vobMissingFields.push("Service Needed");
    if (!parsed.data.planType) vobMissingFields.push("Plan Type");
    
    const totalVobFields = 4;
    const completedFields = totalVobFields - vobMissingFields.length;
    const vobScore = Math.round((completedFields / totalVobFields) * 100);
    
    const leadData = {
      ...parsed.data,
      slaDeadlineAt,
      vobMissingFields,
      vobScore,
      nextActionType: parsed.data.nextActionType || "call",
    };
    
    const lead = await storage.createLead(leadData as any);
    res.status(201).json(lead);
  });

  // PATCH endpoint for quick actions and lead updates
  app.patch("/api/leads/:id", async (req, res) => {
    const lead = await storage.getLead(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    // Validation schemas for enum fields
    const validStatuses = ["new", "attempting_contact", "contacted", "qualified", "unqualified", "converted", "lost"];
    const validPriorities = ["P0", "P1", "P2"];
    const validVobStatuses = ["not_started", "in_progress", "verified", "incomplete"];
    const validHandoffStatuses = ["not_sent", "sent", "accepted"];
    const validNextActionTypes = ["call", "callback", "verify_insurance", "request_docs", "create_claim", "none"];
    const validOutcomeCodes = ["no_answer", "left_voicemail", "contacted", "qualified", "unqualified", "insurance_missing", "wrong_number"];

    const updates: Record<string, any> = {};
    const errors: string[] = [];

    // Validate and collect updates
    if (req.body.status !== undefined) {
      if (validStatuses.includes(req.body.status)) {
        updates.status = req.body.status;
      } else {
        errors.push(`Invalid status: ${req.body.status}`);
      }
    }
    if (req.body.priority !== undefined) {
      if (validPriorities.includes(req.body.priority)) {
        updates.priority = req.body.priority;
      } else {
        errors.push(`Invalid priority: ${req.body.priority}`);
      }
    }
    if (req.body.vobStatus !== undefined) {
      if (validVobStatuses.includes(req.body.vobStatus)) {
        updates.vobStatus = req.body.vobStatus;
      } else {
        errors.push(`Invalid vobStatus: ${req.body.vobStatus}`);
      }
    }
    if (req.body.handoffStatus !== undefined) {
      if (validHandoffStatuses.includes(req.body.handoffStatus)) {
        updates.handoffStatus = req.body.handoffStatus;
      } else {
        errors.push(`Invalid handoffStatus: ${req.body.handoffStatus}`);
      }
    }
    if (req.body.nextActionType !== undefined) {
      if (validNextActionTypes.includes(req.body.nextActionType)) {
        updates.nextActionType = req.body.nextActionType;
      } else {
        errors.push(`Invalid nextActionType: ${req.body.nextActionType}`);
      }
    }
    if (req.body.outcomeCode !== undefined) {
      if (req.body.outcomeCode === null || validOutcomeCodes.includes(req.body.outcomeCode)) {
        updates.outcomeCode = req.body.outcomeCode;
      } else {
        errors.push(`Invalid outcomeCode: ${req.body.outcomeCode}`);
      }
    }

    // String fields (no validation needed beyond type)
    const stringFields = ["nextAction", "lastOutcome", "serviceNeeded", "insuranceCarrier", "memberId", "planType", "ownerUserId"];
    for (const field of stringFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field] === null ? null : String(req.body[field]);
      }
    }

    // Numeric fields
    if (req.body.attemptCount !== undefined) {
      const count = parseInt(req.body.attemptCount);
      if (!isNaN(count) && count >= 0) {
        updates.attemptCount = count;
      } else {
        errors.push("Invalid attemptCount: must be non-negative integer");
      }
    }
    if (req.body.vobScore !== undefined) {
      const score = parseInt(req.body.vobScore);
      if (!isNaN(score) && score >= 0 && score <= 100) {
        updates.vobScore = score;
      } else {
        errors.push("Invalid vobScore: must be 0-100");
      }
    }

    // Timestamp fields
    if (req.body.nextActionAt !== undefined) {
      if (req.body.nextActionAt === null) {
        updates.nextActionAt = null;
      } else {
        const date = new Date(req.body.nextActionAt);
        if (!isNaN(date.getTime())) {
          updates.nextActionAt = date;
        } else {
          errors.push("Invalid nextActionAt: must be valid date");
        }
      }
    }
    if (req.body.lastContactedAt !== undefined) {
      if (req.body.lastContactedAt === null) {
        updates.lastContactedAt = null;
      } else {
        const date = new Date(req.body.lastContactedAt);
        if (!isNaN(date.getTime())) {
          updates.lastContactedAt = date;
        } else {
          errors.push("Invalid lastContactedAt: must be valid date");
        }
      }
    }
    if (req.body.slaDeadlineAt !== undefined) {
      if (req.body.slaDeadlineAt === null) {
        updates.slaDeadlineAt = null;
      } else {
        const date = new Date(req.body.slaDeadlineAt);
        if (!isNaN(date.getTime())) {
          updates.slaDeadlineAt = date;
        } else {
          errors.push("Invalid slaDeadlineAt: must be valid date");
        }
      }
    }

    // JSONB array field
    if (req.body.vobMissingFields !== undefined) {
      if (Array.isArray(req.body.vobMissingFields)) {
        updates.vobMissingFields = req.body.vobMissingFields;
      } else if (req.body.vobMissingFields === null) {
        updates.vobMissingFields = [];
      } else {
        errors.push("Invalid vobMissingFields: must be array");
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join("; ") });
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    // Recalculate SLA deadline if priority changes
    if (updates.priority) {
      const now = new Date();
      if (updates.priority === "P0") {
        updates.slaDeadlineAt = new Date(now.getTime() + 1 * 60 * 60 * 1000); // 1 hour
      } else if (updates.priority === "P1") {
        updates.slaDeadlineAt = new Date(now.getTime() + 4 * 60 * 60 * 1000); // 4 hours
      } else {
        updates.slaDeadlineAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
      }
    }

    // Recalculate VOB score if VOB-related fields change
    const vobFields = ["insuranceCarrier", "memberId", "serviceNeeded", "planType"];
    const hasVobUpdate = vobFields.some(f => updates[f] !== undefined);
    if (hasVobUpdate) {
      // Merge current lead data with updates
      const merged = { ...lead, ...updates };
      const vobMissingFields: string[] = [];
      if (!merged.insuranceCarrier) vobMissingFields.push("Insurance Carrier");
      if (!merged.memberId) vobMissingFields.push("Member ID");
      if (!merged.serviceNeeded) vobMissingFields.push("Service Needed");
      if (!merged.planType) vobMissingFields.push("Plan Type");
      
      const totalVobFields = 4;
      const completedFields = totalVobFields - vobMissingFields.length;
      updates.vobScore = Math.round((completedFields / totalVobFields) * 100);
      updates.vobMissingFields = vobMissingFields;
    }

    const updated = await storage.updateLead(req.params.id, updates);
    res.json(updated);
  });

  app.get("/api/leads/:id/calls", async (req, res) => {
    const calls = await storage.getCallsByLeadId(req.params.id);
    res.json(calls);
  });

  app.get("/api/leads/:id/patient", async (req, res) => {
    const patient = await storage.getPatientByLeadId(req.params.id);
    res.json(patient || null);
  });

  // Update patient and sync to lead
  app.patch("/api/leads/:id/patient", async (req, res) => {
    const patient = await storage.getPatientByLeadId(req.params.id);
    if (!patient) {
      return res.status(404).json({ error: "Patient not found for this lead" });
    }
    
    // Store original values for comparison
    const originalValues: Record<string, any> = {
      insuranceCarrier: patient.insuranceCarrier,
      memberId: patient.memberId,
      planType: patient.planType,
    };
    
    const allowedFields = ["dob", "state", "insuranceCarrier", "memberId", "planType"];
    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }
    
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }
    
    const updatedPatient = await storage.updatePatient(patient.id, updates);
    if (updatedPatient) {
      // Fetch calls and sort by most recent first to get latest extractedData
      const calls = await storage.getCallsByLeadId(req.params.id);
      const sortedCalls = [...calls].sort((a, b) => {
        const dateA = a.startedAt ? new Date(a.startedAt).getTime() : 0;
        const dateB = b.startedAt ? new Date(b.startedAt).getTime() : 0;
        return dateB - dateA;
      });
      
      let extractedData: any = null;
      for (const call of sortedCalls) {
        if (call.extractedData && typeof call.extractedData === 'object') {
          const data = call.extractedData as any;
          if (data.serviceType || data.serviceNeeded) {
            extractedData = data;
            break;
          }
        }
      }
      
      // Detect which VOB fields were cleared by comparing before/after
      const clearedFields: string[] = [];
      const vobFields = ["insuranceCarrier", "memberId", "planType"] as const;
      for (const field of vobFields) {
        const wasSet = !!originalValues[field];
        const isNowEmpty = !updatedPatient[field];
        if (wasSet && isNowEmpty) {
          clearedFields.push(field);
        }
      }
      
      await syncPatientToLeadWithClears(updatedPatient, extractedData, clearedFields);
    }
    
    res.json(updatedPatient);
  });

  // Manual sync of patient data to lead
  app.post("/api/leads/:id/sync-patient", async (req, res) => {
    const patient = await storage.getPatientByLeadId(req.params.id);
    if (!patient) {
      return res.status(404).json({ error: "No patient record found for this lead" });
    }
    
    const lead = await storage.getLead(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }
    
    // Fetch calls and sort by most recent first to get latest extractedData
    const calls = await storage.getCallsByLeadId(req.params.id);
    const sortedCalls = [...calls].sort((a, b) => {
      const dateA = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const dateB = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return dateB - dateA;
    });
    
    let extractedData: any = null;
    for (const call of sortedCalls) {
      if (call.extractedData && typeof call.extractedData === 'object') {
        const data = call.extractedData as any;
        if (data.serviceType || data.serviceNeeded) {
          extractedData = data;
          break;
        }
      }
    }
    
    // Detect fields that were cleared on patient but lead still has data
    // (syncing should make lead match patient state)
    const clearedFields: string[] = [];
    const vobFields = ["insuranceCarrier", "memberId", "planType"] as const;
    for (const field of vobFields) {
      const leadHasValue = !!(lead as any)[field];
      const patientEmpty = !patient[field];
      if (leadHasValue && patientEmpty) {
        clearedFields.push(field);
      }
    }
    
    await syncPatientToLeadWithClears(patient, extractedData, clearedFields);
    const updatedLead = await storage.getLead(req.params.id);
    res.json({ success: true, lead: updatedLead });
  });

  // Get lead context for call prep preview
  app.get("/api/leads/:id/call-context", async (req, res) => {
    const lead = await storage.getLead(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }
    
    // Also fetch patient data for additional context
    const patient = await storage.getPatientByLeadId(req.params.id);
    
    // Parse name into first/last if not already split
    const nameParts = lead.name.split(' ');
    const firstName = lead.firstName || nameParts[0] || "Unknown";
    const lastName = lead.lastName || nameParts.slice(1).join(' ') || "";
    const fullName = lead.name || `${firstName} ${lastName}`.trim();
    
    // Format service type for display
    const formatServiceType = (service: string | null): string => {
      if (!service) return "Unknown";
      const serviceMap: Record<string, string> = {
        "IOP": "Intensive Outpatient",
        "iop": "Intensive Outpatient",
        "PHP": "Partial Hospitalization",
        "php": "Partial Hospitalization",
        "detox": "Detox",
        "Detox": "Detox",
        "residential": "Residential Treatment",
        "Residential": "Residential Treatment",
        "outpatient": "Outpatient",
        "Outpatient": "Outpatient",
        "inpatient": "Inpatient",
        "Inpatient": "Inpatient",
      };
      return serviceMap[service] || service;
    };
    
    // Merge lead and patient data (lead takes priority, patient fills gaps)
    const state = lead.state || patient?.state || "Unknown";
    const insuranceCarrier = lead.insuranceCarrier || patient?.insuranceCarrier || "Unknown";
    const memberId = lead.memberId || patient?.memberId || null;
    const planType = lead.planType || patient?.planType || null;
    
    // Infer timezone from state if not set
    const stateTimezones: Record<string, string> = {
      "CA": "Pacific", "WA": "Pacific", "OR": "Pacific", "NV": "Pacific",
      "TX": "Central", "IL": "Central", "MN": "Central", "WI": "Central", "MO": "Central", "LA": "Central", "OK": "Central",
      "NY": "Eastern", "FL": "Eastern", "PA": "Eastern", "OH": "Eastern", "GA": "Eastern", "NC": "Eastern", "VA": "Eastern", "MA": "Eastern", "NJ": "Eastern", "MI": "Eastern",
      "AZ": "Mountain", "CO": "Mountain", "UT": "Mountain", "NM": "Mountain",
      "HI": "Hawaii", "AK": "Alaska",
    };
    const timezone = lead.timezone || (state !== "Unknown" ? stateTimezones[state] : null) || "Unknown";
    
    // Calculate time since lead
    const getTimeSinceLead = (createdAt: Date): string => {
      const now = new Date();
      const diffMs = now.getTime() - createdAt.getTime();
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      
      if (diffMins < 60) return `${diffMins} minutes ago`;
      if (diffHours < 24) return `${diffHours} hours ago`;
      if (diffDays === 1) return "yesterday";
      if (diffDays < 7) return `${diffDays} days ago`;
      return `${Math.floor(diffDays / 7)} weeks ago`;
    };

    res.json({
      name: fullName,
      firstName,
      lastName,
      preferredName: lead.preferredName || firstName,
      phone: lead.phone || "Unknown",
      email: lead.email || "Unknown",
      state,
      timezone,
      source: lead.source || "Website",
      serviceNeeded: formatServiceType(lead.serviceNeeded),
      insuranceCarrier,
      memberId,
      planType,
      attempts: lead.attemptCount || 0,
      lastOutcome: lead.lastOutcome || "First contact",
      bestTimeToCall: lead.bestTimeToCall || "Anytime",
      priority: lead.priority || "P2",
      notes: lead.notes || null,
      hasConsent: lead.consentToCall !== false,
      timeSinceLead: getTimeSinceLead(lead.createdAt),
      leadCreatedAt: lead.createdAt.toISOString(),
    });
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
      duration: req.body.duration || null,
      notes: req.body.notes || null,
      vobData: req.body.vobData || null,
    };

    const call = await storage.createCall(callData);

    // Auto-fill lead with extracted call data
    const extracted = callData.extractedData;
    if (extracted) {
      const leadUpdate: Record<string, any> = {};
      
      if (extracted.qualified) {
        leadUpdate.status = "qualified";
      }
      const service = extracted.serviceType || extracted.serviceNeeded;
      if (service && service !== "Unknown") {
        leadUpdate.serviceNeeded = service;
      }
      if (extracted.insuranceCarrier) {
        leadUpdate.insuranceCarrier = extracted.insuranceCarrier;
      }
      if (extracted.memberId) {
        leadUpdate.memberId = extracted.memberId;
      }
      
      if (Object.keys(leadUpdate).length > 0) {
        await storage.updateLead(req.params.id, leadUpdate);
      }
      
      // Create or update patient record
      const existingPatient = await storage.getPatientByLeadId(req.params.id);
      if (!existingPatient && extracted.qualified) {
        const newPatient = await storage.createPatient({
          leadId: req.params.id,
          dob: "1985-03-15",
          state: extracted.state || "CA",
          insuranceCarrier: extracted.insuranceCarrier || "Blue Cross",
          memberId: extracted.memberId || "MEM" + Math.random().toString(36).slice(2, 10).toUpperCase(),
          planType: "PPO",
        });
        // Sync patient data to lead to update VOB score (pass extractedData for serviceNeeded)
        await syncPatientToLead(newPatient, extracted);
      } else if (existingPatient) {
        // Update existing patient with new extracted data
        const patientUpdate: Record<string, any> = {};
        if (extracted.insuranceCarrier) patientUpdate.insuranceCarrier = extracted.insuranceCarrier;
        if (extracted.memberId) patientUpdate.memberId = extracted.memberId;
        if (extracted.state) patientUpdate.state = extracted.state;
        
        if (Object.keys(patientUpdate).length > 0) {
          const updatedPatient = await storage.updatePatient(existingPatient.id, patientUpdate);
          // Sync updated patient data to lead (pass extractedData for serviceNeeded)
          if (updatedPatient) {
            await syncPatientToLead(updatedPatient, extracted);
          }
        } else {
          // Even if no patient updates, sync to ensure serviceNeeded gets backfilled
          await syncPatientToLead(existingPatient, extracted);
        }
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

  // Build Vapi call payload with lead context for personalized calls
  const buildVapiCallPayload = (lead: Lead, assistantId: string, phoneNumberId: string) => {
    // Format phone number to E.164 format
    const formatToE164 = (phone: string): string => {
      const digits = phone.replace(/\D/g, '');
      if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
      if (digits.length === 10) return `+1${digits}`;
      if (phone.startsWith('+')) return phone;
      return `+1${digits}`;
    };

    // Parse name into first/last if not already split
    const nameParts = lead.name.split(' ');
    const firstName = lead.firstName || nameParts[0] || "Unknown";
    const lastName = lead.lastName || nameParts.slice(1).join(' ') || "";

    // Format service type for natural speech
    const formatServiceType = (service: string | null): string => {
      if (!service) return "Unknown";
      const serviceMap: Record<string, string> = {
        "IOP": "intensive outpatient",
        "iop": "intensive outpatient",
        "PHP": "partial hospitalization",
        "php": "partial hospitalization",
        "detox": "detox",
        "Detox": "detox",
        "residential": "residential treatment",
        "Residential": "residential treatment",
        "outpatient": "outpatient",
        "Outpatient": "outpatient",
        "inpatient": "inpatient",
        "Inpatient": "inpatient",
      };
      return serviceMap[service] || service.toLowerCase();
    };

    // Calculate time since lead was created
    const getTimeSinceLead = (createdAt: Date): string => {
      const now = new Date();
      const diffMs = now.getTime() - createdAt.getTime();
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      
      if (diffMins < 60) return `${diffMins} minutes ago`;
      if (diffHours < 24) return `${diffHours} hours ago`;
      if (diffDays === 1) return "yesterday";
      if (diffDays < 7) return `${diffDays} days ago`;
      return `${Math.floor(diffDays / 7)} weeks ago`;
    };

    // Format timezone for display
    const formatTimezone = (tz: string | null, state: string | null): string => {
      if (tz) return tz;
      // Infer from state if timezone not set
      const stateTimezones: Record<string, string> = {
        "CA": "Pacific", "WA": "Pacific", "OR": "Pacific", "NV": "Pacific",
        "TX": "Central", "IL": "Central", "MN": "Central", "WI": "Central", "MO": "Central", "LA": "Central", "OK": "Central",
        "NY": "Eastern", "FL": "Eastern", "PA": "Eastern", "OH": "Eastern", "GA": "Eastern", "NC": "Eastern", "VA": "Eastern", "MA": "Eastern", "NJ": "Eastern", "MI": "Eastern",
        "AZ": "Mountain", "CO": "Mountain", "UT": "Mountain", "NM": "Mountain",
        "HI": "Hawaii", "AK": "Alaska",
      };
      return state ? (stateTimezones[state] || "Unknown") : "Unknown";
    };

    return {
      assistantId,
      phoneNumberId,
      customer: {
        number: formatToE164(lead.phone),
        name: lead.name || "Patient",
      },
      metadata: {
        leadId: lead.id,
      },
      assistantOverrides: {
        variableValues: {
          patient_first_name: firstName,
          patient_last_name: lastName,
          patient_full_name: lead.name || `${firstName} ${lastName}`.trim(),
          patient_preferred_name: lead.preferredName || firstName,
          patient_phone: lead.phone || "Unknown",
          patient_email: lead.email || "Unknown",
          patient_state: lead.state || "Unknown",
          patient_timezone: formatTimezone(lead.timezone, lead.state),
          patient_source: lead.source || "Website",
          service_needed: formatServiceType(lead.serviceNeeded),
          insurance_carrier: lead.insuranceCarrier || "Unknown",
          attempts: String(lead.attemptCount || 0),
          last_outcome: lead.lastOutcome || "First contact",
          best_time_to_call: lead.bestTimeToCall || "anytime",
          priority_level: lead.priority || "P2",
          time_since_lead: getTimeSinceLead(lead.createdAt),
          lead_created_at: lead.createdAt.toISOString(),
          clinic_name: "Kemah Palms Recovery",
          clinic_callback_number: "(866) 488-8684",
        },
      },
    };
  };

  app.post("/api/vapi/outbound-call", async (req, res) => {
    const { leadId } = req.body;
    
    const vapiApiKey = process.env.VAPI_API_KEY;
    const assistantId = process.env.VAPI_ASSISTANT_ID;
    const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
    
    if (!vapiApiKey || !assistantId || !phoneNumberId) {
      return res.status(500).json({ 
        error: "Vapi configuration missing. Please set VAPI_API_KEY, VAPI_ASSISTANT_ID, and VAPI_PHONE_NUMBER_ID." 
      });
    }
    
    if (!leadId) {
      return res.status(400).json({ error: "Lead ID is required" });
    }

    // Fetch full lead data for context
    const lead = await storage.getLead(leadId);
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    if (!lead.phone) {
      return res.status(400).json({ error: "Lead has no phone number" });
    }
    
    try {
      // Build personalized call payload with lead context
      const vapiPayload = buildVapiCallPayload(lead, assistantId, phoneNumberId);
      
      const response = await fetch("https://api.vapi.ai/call/phone", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${vapiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(vapiPayload),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error("Vapi API error:", errorData);
        return res.status(response.status).json({ 
          error: errorData.message || "Failed to initiate call" 
        });
      }
      
      const callData = await response.json();
      
      const call = await storage.createCall({
        leadId,
        vapiCallId: callData.id,
        transcript: "",
        summary: "Call initiated",
        disposition: "in_progress",
        extractedData: {},
      });
      
      res.status(201).json({ 
        success: true, 
        callId: call.id,
        vapiCallId: callData.id,
        status: callData.status,
      });
    } catch (error) {
      console.error("Error initiating Vapi call:", error);
      res.status(500).json({ error: "Failed to initiate outbound call" });
    }
  });

  app.get("/api/vapi/call-status/:vapiCallId", async (req, res) => {
    const vapiApiKey = process.env.VAPI_API_KEY;
    
    if (!vapiApiKey) {
      return res.status(500).json({ error: "Vapi API key not configured" });
    }
    
    try {
      const response = await fetch(`https://api.vapi.ai/call/${req.params.vapiCallId}`, {
        headers: {
          "Authorization": `Bearer ${vapiApiKey}`,
        },
      });
      
      if (!response.ok) {
        return res.status(response.status).json({ error: "Failed to get call status" });
      }
      
      const callData = await response.json();
      res.json({
        status: callData.status,
        transcript: callData.transcript || "",
        summary: callData.summary || "",
        endedReason: callData.endedReason,
        duration: callData.duration,
      });
    } catch (error) {
      console.error("Error getting call status:", error);
      res.status(500).json({ error: "Failed to get call status" });
    }
  });

  // Vapi Webhook for call updates (recording, transcript, etc.)
  app.post("/api/vapi/webhook", async (req, res) => {
    try {
      const event = req.body;
      const eventType = event.message?.type || event.type;
      console.log("Vapi webhook received:", eventType, JSON.stringify(event).slice(0, 1000));
      
      // Handle end-of-call-report with recording
      if (eventType === "end-of-call-report" || eventType === "call.completed" || eventType === "call-ended") {
        const callData = event.message?.call || event.message || event.call || event;
        const vapiCallId = callData.id || callData.callId || event.callId;
        
        // Handle Vapi's deeply nested artifacts structure - check all possible paths
        const artifacts = callData.artifact || callData.artifacts || {};
        const latest = artifacts.latest || {};
        const latestArtifacts = latest.artifacts || latest.artifact || {};
        
        // Recording URL can be in deeply nested locations - check all paths
        const recordingUrl = latestArtifacts.recordingUrl
          || (Array.isArray(latestArtifacts.recordings) && latestArtifacts.recordings[0]?.url)
          || latest.recordingUrl
          || (Array.isArray(latest.recordings) && latest.recordings[0]?.url)
          || callData.recordingUrl 
          || callData.recording?.url 
          || artifacts.recordingUrl
          || (Array.isArray(callData.recordings) && callData.recordings[0]?.url)
          || (artifacts.recordings && artifacts.recordings[0]?.url);
        
        // Transcript from various locations - check deepest first
        const transcript = latestArtifacts.transcript
          || (latestArtifacts.messages?.map((m: any) => `${m.role}: ${m.content}`).join('\n'))
          || latest.transcript
          || (latest.messages?.map((m: any) => `${m.role}: ${m.content}`).join('\n'))
          || callData.transcript 
          || artifacts.transcript 
          || (artifacts.messages?.map((m: any) => `${m.role}: ${m.content}`).join('\n'))
          || "";
        
        // Summary from all possible locations
        const summary = latestArtifacts.summary
          || latest.summary
          || callData.summary 
          || callData.analysis?.summary 
          || artifacts.summary 
          || "";
        
        console.log("Processing call end:", { vapiCallId, hasRecording: !!recordingUrl, hasTranscript: !!transcript, hasSummary: !!summary });
        
        if (vapiCallId) {
          // Find and update the call by vapiCallId
          const calls = await storage.getCallsByVapiId(vapiCallId);
          
          if (calls && calls.length > 0) {
            const updateData: any = {};
            if (recordingUrl) updateData.recordingUrl = recordingUrl;
            if (transcript) updateData.transcript = transcript;
            if (summary) updateData.summary = summary;
            // Only set disposition if Vapi provides one, otherwise leave as-is
            if (callData.endedReason) {
              updateData.disposition = callData.endedReason;
            } else if (callData.status === "ended") {
              updateData.disposition = "completed";
            }
            if (callData.duration) updateData.duration = Math.round(callData.duration);
            
            if (Object.keys(updateData).length > 0) {
              await storage.updateCall(calls[0].id, updateData);
              console.log(`Updated call ${calls[0].id} with data:`, Object.keys(updateData));
            }
          } else {
            console.warn(`No matching call found for vapiCallId: ${vapiCallId}`);
          }
        } else {
          console.warn("Webhook event missing vapiCallId");
        }
      }
      
      res.status(200).json({ received: true });
    } catch (error) {
      console.error("Error processing Vapi webhook:", error);
      res.status(200).json({ received: true }); // Always return 200 to avoid retries
    }
  });

  // Manually refresh call data from Vapi API
  app.post("/api/calls/:id/refresh", async (req, res) => {
    const call = await storage.getCall(req.params.id);
    if (!call) {
      return res.status(404).json({ error: "Call not found" });
    }
    
    if (!call.vapiCallId) {
      return res.status(400).json({ error: "Call has no Vapi call ID" });
    }
    
    const vapiApiKey = process.env.VAPI_API_KEY;
    if (!vapiApiKey) {
      return res.status(500).json({ error: "Vapi API key not configured" });
    }
    
    try {
      const response = await fetch(`https://api.vapi.ai/call/${call.vapiCallId}`, {
        headers: {
          "Authorization": `Bearer ${vapiApiKey}`,
        },
      });
      
      if (!response.ok) {
        console.error(`Vapi API returned ${response.status} for call ${call.vapiCallId}`);
        return res.status(response.status).json({ error: "Failed to fetch call from Vapi" });
      }
      
      const callData = await response.json();
      const updateData: any = {};
      
      // Handle Vapi's deeply nested artifacts structure - check all possible paths
      const artifacts = callData.artifact || callData.artifacts || {};
      const latest = artifacts.latest || {};
      const latestArtifacts = latest.artifacts || latest.artifact || {};
      
      // Recording URL can be in deeply nested locations - check all paths
      const recordingUrl = latestArtifacts.recordingUrl
        || (Array.isArray(latestArtifacts.recordings) && latestArtifacts.recordings[0]?.url)
        || latest.recordingUrl
        || (Array.isArray(latest.recordings) && latest.recordings[0]?.url)
        || callData.recordingUrl 
        || callData.recording?.url 
        || artifacts.recordingUrl
        || (Array.isArray(callData.recordings) && callData.recordings[0]?.url)
        || (artifacts.recordings && artifacts.recordings[0]?.url);
      
      // Transcript from various locations - check deepest first
      const transcript = latestArtifacts.transcript
        || (latestArtifacts.messages?.map((m: any) => `${m.role}: ${m.content}`).join('\n'))
        || latest.transcript
        || (latest.messages?.map((m: any) => `${m.role}: ${m.content}`).join('\n'))
        || callData.transcript 
        || artifacts.transcript 
        || (artifacts.messages?.map((m: any) => `${m.role}: ${m.content}`).join('\n'));
      
      // Summary from all possible locations
      const summary = latestArtifacts.summary
        || latest.summary
        || callData.summary 
        || callData.analysis?.summary 
        || artifacts.summary;
      
      if (recordingUrl) updateData.recordingUrl = recordingUrl;
      if (transcript) updateData.transcript = transcript;
      if (summary) updateData.summary = summary;
      if (callData.endedReason) updateData.disposition = callData.endedReason;
      if (callData.duration) updateData.duration = Math.round(callData.duration);
      if (callData.status === "ended" && !updateData.disposition) {
        updateData.disposition = "completed";
      }
      
      if (Object.keys(updateData).length > 0) {
        const updatedCall = await storage.updateCall(call.id, updateData);
        console.log(`Refreshed call ${call.id} with:`, Object.keys(updateData));
        res.json({ ...updatedCall, refreshed: true });
      } else {
        // No new data available - return 200 with explicit payload (204 can't have body)
        console.log(`No new data for call ${call.id} from Vapi (status: ${callData.status})`);
        res.status(200).json({ ...call, refreshed: false, message: "No new data available from Vapi yet" });
      }
    } catch (error) {
      console.error("Error refreshing call from Vapi:", error);
      res.status(500).json({ error: "Failed to refresh call" });
    }
  });

  // Call history and notes
  app.get("/api/calls/:id", async (req, res) => {
    const call = await storage.getCall(req.params.id);
    if (!call) {
      return res.status(404).json({ error: "Call not found" });
    }
    res.json(call);
  });

  app.patch("/api/calls/:id", async (req, res) => {
    const call = await storage.updateCall(req.params.id, req.body);
    if (!call) {
      return res.status(404).json({ error: "Call not found" });
    }
    res.json(call);
  });

  // Prior Authorization routes
  app.get("/api/prior-auth/encounter/:encounterId", async (req, res) => {
    const auths = await storage.getPriorAuthsByEncounterId(req.params.encounterId);
    res.json(auths);
  });

  app.get("/api/prior-auth/patient/:patientId", async (req, res) => {
    const auths = await storage.getPriorAuthsByPatientId(req.params.patientId);
    res.json(auths);
  });

  app.get("/api/prior-auth/:id", async (req, res) => {
    const auth = await storage.getPriorAuth(req.params.id);
    if (!auth) {
      return res.status(404).json({ error: "Prior authorization not found" });
    }
    res.json(auth);
  });

  app.post("/api/prior-auth", async (req, res) => {
    const auth = await storage.createPriorAuth(req.body);
    res.status(201).json(auth);
  });

  app.patch("/api/prior-auth/:id", async (req, res) => {
    const auth = await storage.updatePriorAuth(req.params.id, req.body);
    if (!auth) {
      return res.status(404).json({ error: "Prior authorization not found" });
    }
    res.json(auth);
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
