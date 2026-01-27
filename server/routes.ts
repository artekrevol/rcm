import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import {
  insertLeadSchema,
  insertRuleSchema,
  insertCallSchema,
  insertEmailTemplateSchema,
  insertNurtureSequenceSchema,
  insertAvailabilitySlotSchema,
  insertAppointmentSchema,
  type Lead,
  type Patient,
} from "@shared/schema";
import { allPayers } from "./payers";
import twilio from "twilio";
import nodemailer from "nodemailer";

// Initialize Twilio client
const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
const twilioMessagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

// Initialize Gmail SMTP transporter
const gmailUser = process.env.GMAIL_USER;
const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;
const emailTransporter = gmailUser && gmailAppPassword
  ? nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: gmailUser,
        pass: gmailAppPassword,
      },
    })
  : null;
const fromEmail = gmailUser || "noreply@example.com";

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
  
  // Backfill serviceNeeded from extracted call data (check multiple field name formats)
  if (extractedData) {
    const service = extractedData.serviceType || extractedData.serviceNeeded || extractedData.service_interest || extractedData.service_type;
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
  
  // Backfill serviceNeeded from extracted call data (check multiple field name formats)
  if (extractedData) {
    const service = extractedData.serviceType || extractedData.serviceNeeded || extractedData.service_interest || extractedData.service_type;
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

    // Log property changes to activity log (HubSpot-style)
    const fieldLabels: Record<string, string> = {
      status: "Status",
      priority: "Priority",
      vobStatus: "VOB Status",
      handoffStatus: "Handoff Status",
      nextActionType: "Next Action Type",
      outcomeCode: "Outcome Code",
      nextAction: "Next Action",
      lastOutcome: "Last Outcome",
      serviceNeeded: "Service Needed",
      insuranceCarrier: "Insurance Carrier",
      memberId: "Member ID",
      planType: "Plan Type",
      ownerUserId: "Owner",
      attemptCount: "Attempt Count",
      vobScore: "VOB Score",
      nextActionAt: "Next Action Date",
      lastContactedAt: "Last Contacted",
      slaDeadlineAt: "SLA Deadline",
    };

    for (const [field, newValue] of Object.entries(updates)) {
      // Skip computed fields that change as side effects
      if (field === "vobMissingFields") continue;
      
      const oldValue = (lead as any)[field];
      const oldStr = oldValue === null || oldValue === undefined ? "(empty)" : String(oldValue);
      const newStr = newValue === null || newValue === undefined ? "(empty)" : String(newValue);
      
      // Only log if value actually changed
      if (oldStr !== newStr) {
        const label = fieldLabels[field] || field;
        await storage.createActivityLog({
          leadId: req.params.id,
          activityType: field === "status" ? "status_change" : "property_change",
          field,
          oldValue: oldStr,
          newValue: newStr,
          description: `${label} changed from "${oldStr}" to "${newStr}"`,
          performedBy: "user",
        });
      }
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
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
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
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });
    
    let extractedData: any = null;
    for (const call of sortedCalls) {
      if (call.extractedData && typeof call.extractedData === 'object') {
        const data = call.extractedData as any;
        if (data.serviceType || data.serviceNeeded || data.service_interest) {
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
      // Check multiple field name formats (camelCase and snake_case from Vapi)
      const service = extracted.serviceType || extracted.serviceNeeded || extracted.service_interest || extracted.service_type;
      if (service && service !== "Unknown") {
        leadUpdate.serviceNeeded = service;
      }
      const carrier = extracted.insuranceCarrier || extracted.insurance_carrier;
      if (carrier) {
        leadUpdate.insuranceCarrier = carrier;
      }
      const member = extracted.memberId || extracted.member_id;
      if (member) {
        leadUpdate.memberId = member;
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
          insuranceCarrier: extracted.insuranceCarrier || extracted.insurance_carrier || "Blue Cross",
          memberId: extracted.memberId || extracted.member_id || "MEM" + Math.random().toString(36).slice(2, 10).toUpperCase(),
          planType: "PPO",
        });
        // Sync patient data to lead to update VOB score (pass extractedData for serviceNeeded)
        await syncPatientToLead(newPatient, extracted);
      } else if (existingPatient) {
        // Update existing patient with new extracted data
        const patientUpdate: Record<string, any> = {};
        const extractedCarrier = extracted.insuranceCarrier || extracted.insurance_carrier;
        const extractedMemberId = extracted.memberId || extracted.member_id;
        if (extractedCarrier) patientUpdate.insuranceCarrier = extractedCarrier;
        if (extractedMemberId) patientUpdate.memberId = extractedMemberId;
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

  // ============================================
  // SMS Endpoints (Twilio Integration)
  // ============================================

  // Send SMS to a lead
  app.post("/api/leads/:id/sms", async (req, res) => {
    if (!twilioClient || !twilioMessagingServiceSid) {
      return res.status(503).json({ error: "SMS service not configured" });
    }

    const lead = await storage.getLead(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    if (!lead.phone) {
      return res.status(400).json({ error: "Lead has no phone number" });
    }

    const { message, template } = req.body;
    
    // Template-based messages
    let smsBody = message;
    if (template) {
      const templates: Record<string, string> = {
        "welcome": `Hi ${lead.name || "there"}! Thank you for reaching out to us. We're here to help with your healthcare needs. Reply to this message anytime.`,
        "insurance_request": `Hi ${lead.name || "there"}, to complete your intake we need your insurance information. Please reply with your Member ID or text CALL to schedule a call.`,
        "appointment_reminder": `Hi ${lead.name || "there"}, this is a reminder about your upcoming appointment. Reply YES to confirm or RESCHEDULE to change.`,
        "document_request": `Hi ${lead.name || "there"}, we need a photo of your insurance card. Please reply with an image of the front and back.`,
        "followup": `Hi ${lead.name || "there"}, we wanted to follow up on your inquiry. Do you have any questions? Reply anytime or text CALL for a callback.`,
      };
      smsBody = templates[template] || message;
    }

    if (!smsBody) {
      return res.status(400).json({ error: "Message or template required" });
    }

    try {
      // Format phone number for Twilio (must start with +1 for US)
      let toPhone = lead.phone.replace(/\D/g, "");
      if (toPhone.length === 10) {
        toPhone = "+1" + toPhone;
      } else if (!toPhone.startsWith("+")) {
        toPhone = "+" + toPhone;
      }

      const twilioMessage = await twilioClient.messages.create({
        body: smsBody,
        messagingServiceSid: twilioMessagingServiceSid,
        to: toPhone,
      });

      // Log the SMS as a call record for tracking
      const smsRecord = await storage.createCall({
        leadId: req.params.id,
        vapiCallId: `sms_${twilioMessage.sid}`,
        transcript: `[OUTBOUND SMS]\n${smsBody}`,
        summary: `Sent SMS: ${template || "custom message"}`,
        disposition: "sms_sent",
        duration: 0,
        recordingUrl: null,
        extractedData: null,
        vobData: null,
        notes: null,
      });

      // Log SMS sent activity
      await storage.createActivityLog({
        leadId: req.params.id,
        activityType: "sms_sent",
        description: `SMS sent: "${template || "custom message"}"`,
        metadata: { 
          messageSid: twilioMessage.sid,
          template: template || null,
          toPhone: lead.phone,
        },
        performedBy: "user",
      });

      res.json({
        success: true,
        messageSid: twilioMessage.sid,
        status: twilioMessage.status,
        callId: smsRecord.id,
      });
    } catch (error: any) {
      console.error("Twilio SMS error:", error);
      res.status(500).json({ error: error.message || "Failed to send SMS" });
    }
  });

  // Get SMS templates
  app.get("/api/sms/templates", async (req, res) => {
    const templates = [
      { id: "welcome", name: "Welcome Message", description: "Initial greeting to new leads" },
      { id: "insurance_request", name: "Insurance Request", description: "Request insurance information" },
      { id: "appointment_reminder", name: "Appointment Reminder", description: "Remind about upcoming appointment" },
      { id: "document_request", name: "Document Request", description: "Request insurance card photo" },
      { id: "followup", name: "Follow-up", description: "General follow-up message" },
    ];
    res.json(templates);
  });

  // Webhook for incoming SMS (Twilio will POST here)
  app.post("/api/webhooks/sms", async (req, res) => {
    const { From, Body, MessageSid } = req.body;
    
    console.log(`Incoming SMS from ${From}: ${Body}`);

    // Find lead by phone number
    const leads = await storage.getLeads();
    const normalizedFrom = From.replace(/\D/g, "").slice(-10);
    const matchingLead = leads.find(l => {
      if (!l.phone) return false;
      const normalizedLeadPhone = l.phone.replace(/\D/g, "").slice(-10);
      return normalizedLeadPhone === normalizedFrom;
    });

    if (matchingLead) {
      // Log incoming SMS as a call record
      await storage.createCall({
        leadId: matchingLead.id,
        vapiCallId: `sms_in_${MessageSid}`,
        transcript: `[INBOUND SMS from ${From}]\n${Body}`,
        summary: `Received SMS reply`,
        disposition: "sms_received",
        duration: 0,
        recordingUrl: null,
        extractedData: { notes: Body } as any,
        vobData: null,
        notes: null,
      });

      // Check for keywords and auto-respond
      const bodyLower = Body.toLowerCase().trim();
      if (twilioClient && twilioMessagingServiceSid) {
        let autoReply: string | null = null;
        
        if (bodyLower === "yes" || bodyLower === "confirm") {
          autoReply = "Thank you for confirming! We look forward to seeing you.";
          await storage.updateLead(matchingLead.id, { lastOutcome: "Confirmed via SMS" });
        } else if (bodyLower === "call" || bodyLower === "callback") {
          autoReply = "We'll call you shortly. If you miss us, we'll leave a voicemail and try again.";
          await storage.updateLead(matchingLead.id, { nextAction: "Callback requested" });
        } else if (bodyLower === "stop" || bodyLower === "unsubscribe") {
          autoReply = "You've been unsubscribed from SMS messages. Call us anytime if you need assistance.";
          await storage.updateLead(matchingLead.id, { status: "unsubscribed" });
        }

        if (autoReply) {
          try {
            await twilioClient.messages.create({
              body: autoReply,
              messagingServiceSid: twilioMessagingServiceSid,
              to: From,
            });
          } catch (err) {
            console.error("Auto-reply SMS error:", err);
          }
        }
      }
    }

    // Respond to Twilio with TwiML (empty response acknowledges receipt)
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  });

  // Check SMS configuration status
  app.get("/api/sms/status", async (req, res) => {
    res.json({
      configured: !!twilioClient,
      phoneNumber: twilioPhoneNumber ? twilioPhoneNumber.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3") : null,
    });
  });

  // ==================== EMAIL AUTOMATION ====================

  // Get all email templates
  app.get("/api/email-templates", async (req, res) => {
    const templates = await storage.getEmailTemplates();
    res.json(templates);
  });

  // Create email template
  app.post("/api/email-templates", async (req, res) => {
    const result = insertEmailTemplateSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: result.error.flatten() });
    }
    const template = await storage.createEmailTemplate(result.data);
    res.json(template);
  });

  // Update email template
  app.patch("/api/email-templates/:id", async (req, res) => {
    const template = await storage.updateEmailTemplate(req.params.id, req.body);
    if (!template) {
      return res.status(404).json({ error: "Template not found" });
    }
    res.json(template);
  });

  // Delete email template
  app.delete("/api/email-templates/:id", async (req, res) => {
    await storage.deleteEmailTemplate(req.params.id);
    res.status(204).send();
  });

  // Get all nurture sequences
  app.get("/api/nurture-sequences", async (req, res) => {
    const sequences = await storage.getNurtureSequences();
    res.json(sequences);
  });

  // Create nurture sequence
  app.post("/api/nurture-sequences", async (req, res) => {
    const result = insertNurtureSequenceSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: result.error.flatten() });
    }
    const sequence = await storage.createNurtureSequence(result.data);
    res.json(sequence);
  });

  // Update nurture sequence
  app.patch("/api/nurture-sequences/:id", async (req, res) => {
    const sequence = await storage.updateNurtureSequence(req.params.id, req.body);
    if (!sequence) {
      return res.status(404).json({ error: "Sequence not found" });
    }
    res.json(sequence);
  });

  // Delete nurture sequence
  app.delete("/api/nurture-sequences/:id", async (req, res) => {
    await storage.deleteNurtureSequence(req.params.id);
    res.status(204).send();
  });

  // Pre-built email templates for quick selection
  const emailPresets = {
    welcome: {
      subject: "Welcome to {{facility_name}} - Your Care Journey Begins",
      body: `Dear {{first_name}},

Thank you for reaching out to {{facility_name}}. We're here to support you on your journey to better health.

Our team has received your information and will be contacting you shortly to discuss the next steps for {{service_needed}}.

In the meantime, please feel free to reach out if you have any questions.

Warm regards,
The {{facility_name}} Team`,
    },
    insurance_verification: {
      subject: "Insurance Information Needed - {{facility_name}}",
      body: `Dear {{first_name}},

We're working on verifying your insurance benefits for your upcoming care with us.

To proceed, we need the following information:
- Insurance carrier name
- Member ID number
- Group number (if applicable)
- Copy of your insurance card (front and back)

Please reply to this email with the requested information, or call us at your earliest convenience.

Thank you,
{{facility_name}} Admissions Team`,
    },
    appointment_confirmation: {
      subject: "Your Appointment is Confirmed - {{appointment_date}}",
      body: `Dear {{first_name}},

Your appointment has been confirmed for {{appointment_date}} at {{appointment_time}}.

Location: {{facility_name}}

Please arrive 15 minutes early to complete any necessary paperwork.

If you need to reschedule, please let us know at least 24 hours in advance.

See you soon!
{{facility_name}} Team`,
    },
    documents_request: {
      subject: "Documents Needed for Your Care - {{facility_name}}",
      body: `Dear {{first_name}},

To ensure we can provide you with the best care, we need the following documents:

1. Valid photo ID
2. Insurance card (front and back)
3. Referral from your primary care physician (if applicable)
4. List of current medications

Please scan or photograph these documents and reply to this email, or bring them to your appointment.

Thank you for your cooperation!
{{facility_name}} Admissions Team`,
    },
    follow_up: {
      subject: "Following Up - {{facility_name}}",
      body: `Dear {{first_name}},

We wanted to follow up regarding your inquiry about {{service_needed}}.

We understand that taking this step can feel overwhelming, and we're here to help make the process as smooth as possible.

Would you be available for a brief call to discuss your options? Please let us know a time that works for you, or simply reply to this email with any questions.

We're here when you're ready.

Warmly,
{{facility_name}} Admissions Team`,
    },
  };

  // Send email to lead
  app.post("/api/leads/:id/email", async (req, res) => {
    const lead = await storage.getLead(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    if (!lead.email) {
      return res.status(400).json({ error: "Lead has no email address" });
    }

    const { template, templateId, subject, body } = req.body;
    let emailSubject: string;
    let emailBody: string;

    // Use preset template
    if (template && emailPresets[template as keyof typeof emailPresets]) {
      const preset = emailPresets[template as keyof typeof emailPresets];
      emailSubject = preset.subject;
      emailBody = preset.body;
    } 
    // Use custom template from database
    else if (templateId) {
      const dbTemplate = await storage.getEmailTemplate(templateId);
      if (!dbTemplate) {
        return res.status(404).json({ error: "Template not found" });
      }
      emailSubject = dbTemplate.subject;
      emailBody = dbTemplate.body;
    } 
    // Use provided subject/body
    else if (subject && body) {
      emailSubject = subject;
      emailBody = body;
    } else {
      return res.status(400).json({ error: "Template, templateId, or subject/body required" });
    }

    // Replace template variables
    const variables: Record<string, string> = {
      first_name: lead.firstName || lead.name.split(" ")[0] || "there",
      last_name: lead.lastName || lead.name.split(" ").slice(1).join(" ") || "",
      full_name: lead.name,
      service_needed: lead.serviceNeeded || "your care",
      facility_name: "Claim Shield Health",
      insurance_carrier: lead.insuranceCarrier || "your insurance",
    };

    for (const [key, value] of Object.entries(variables)) {
      emailSubject = emailSubject.replace(new RegExp(`{{${key}}}`, "g"), value);
      emailBody = emailBody.replace(new RegExp(`{{${key}}}`, "g"), value);
    }

    // Log email first
    const emailLog = await storage.createEmailLog({
      leadId: lead.id,
      templateId: templateId || null,
      subject: emailSubject,
      body: emailBody,
      toEmail: lead.email,
      status: "pending",
    });

    // Send via Gmail SMTP if configured
    if (emailTransporter) {
      try {
        await emailTransporter.sendMail({
          from: fromEmail,
          to: lead.email,
          subject: emailSubject,
          text: emailBody,
        });
        await storage.updateEmailLog(emailLog.id, { 
          status: "sent", 
          sentAt: new Date() 
        });
      } catch (err: any) {
        console.error("Email send error:", err);
        await storage.updateEmailLog(emailLog.id, { 
          status: "failed", 
          errorMessage: err.message || "Failed to send email" 
        });
        return res.status(500).json({ error: "Failed to send email" });
      }
    } else {
      // Mark as sent in demo mode (no Gmail configured)
      await storage.updateEmailLog(emailLog.id, { 
        status: "sent", 
        sentAt: new Date() 
      });
    }

    // Update lead last contacted
    await storage.updateLead(lead.id, { 
      lastContactedAt: new Date(),
      lastOutcome: `Email sent: ${emailSubject}`,
    });

    // Log email sent activity
    await storage.createActivityLog({
      leadId: lead.id,
      activityType: "email_sent",
      description: `Email sent: "${emailSubject}"`,
      metadata: { 
        emailLogId: emailLog.id, 
        subject: emailSubject,
        toEmail: lead.email,
      },
      performedBy: "user",
    });

    res.json({ success: true, emailLogId: emailLog.id });
  });

  // Get email logs for a lead
  app.get("/api/leads/:id/emails", async (req, res) => {
    const emails = await storage.getEmailLogsByLeadId(req.params.id);
    res.json(emails);
  });

  // Get activity logs for a lead (HubSpot-style timeline)
  app.get("/api/leads/:id/activity", async (req, res) => {
    const activities = await storage.getActivityLogsByLeadId(req.params.id);
    res.json(activities);
  });

  // Get email configuration status
  app.get("/api/email/status", async (req, res) => {
    res.json({
      configured: !!emailTransporter,
      fromEmail: fromEmail,
    });
  });

  // Send confirmation email after chat widget submission
  app.post("/api/leads/:id/send-confirmation", async (req, res) => {
    try {
      const lead = await storage.getLead(req.params.id);
      if (!lead) {
        return res.status(404).json({ error: "Lead not found" });
      }

      if (!lead.email) {
        return res.status(400).json({ error: "Lead has no email address" });
      }

      const { appointmentDate } = req.body;

      const subject = appointmentDate 
        ? "Your Appointment Confirmation - Claim Shield Health"
        : "Thank You for Contacting Claim Shield Health";

      const appointmentSection = appointmentDate 
        ? `<div style="background-color: #e8f5e9; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #2e7d32; margin: 0 0 10px 0;">Appointment Scheduled</h3>
            <p style="margin: 0; font-size: 16px;"><strong>${new Date(appointmentDate).toLocaleString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric', 
              hour: 'numeric', 
              minute: '2-digit' 
            })}</strong></p>
          </div>`
        : "";

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #1F7AE0; margin: 0;">Claim Shield Health</h1>
            <p style="color: #666; margin: 5px 0 0 0;">Secure Claims Workflow</p>
          </div>
          
          <h2 style="color: #1f2937;">Thank you, ${lead.name || 'Valued Patient'}!</h2>
          
          <p>We've received your information and our team will be in touch shortly.</p>
          
          ${appointmentSection}
          
          <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin: 0 0 15px 0; color: #374151;">Your Submitted Information</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Name:</td>
                <td style="padding: 8px 0; font-weight: 500;">${lead.name || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Phone:</td>
                <td style="padding: 8px 0; font-weight: 500;">${lead.phone || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Email:</td>
                <td style="padding: 8px 0; font-weight: 500;">${lead.email}</td>
              </tr>
              ${lead.serviceNeeded ? `<tr>
                <td style="padding: 8px 0; color: #6b7280;">Service:</td>
                <td style="padding: 8px 0; font-weight: 500;">${lead.serviceNeeded.replace(/_/g, ' ')}</td>
              </tr>` : ''}
              ${lead.insuranceCarrier ? `<tr>
                <td style="padding: 8px 0; color: #6b7280;">Insurance:</td>
                <td style="padding: 8px 0; font-weight: 500;">${lead.insuranceCarrier.toUpperCase()}</td>
              </tr>` : ''}
            </table>
          </div>
          
          <p>If you have any questions, please don't hesitate to reach out.</p>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; color: #6b7280; font-size: 14px;">
            <p style="margin: 0;">Claim Shield Health</p>
            <p style="margin: 5px 0 0 0;">This is an automated confirmation email.</p>
          </div>
        </body>
        </html>
      `;

      if (emailTransporter) {
        await emailTransporter.sendMail({
          from: fromEmail,
          to: lead.email,
          subject,
          html: htmlContent,
        });
      }

      const emailLog = await storage.createEmailLog({
        leadId: lead.id,
        templateId: null,
        subject,
        body: htmlContent,
        toEmail: lead.email,
        status: emailTransporter ? "sent" : "simulated",
        sentAt: new Date(),
      });

      await storage.updateLead(lead.id, {
        lastContactedAt: new Date(),
        nextAction: "Confirmation email sent",
      });

      res.json({ success: true, emailLogId: emailLog.id });
    } catch (error) {
      console.error("Failed to send confirmation email:", error);
      res.status(500).json({ error: "Failed to send confirmation email" });
    }
  });

  // List available email presets
  app.get("/api/email/presets", async (req, res) => {
    const presets = Object.entries(emailPresets).map(([id, template]) => ({
      id,
      name: id.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      subject: template.subject,
    }));
    res.json(presets);
  });

  // ==================== APPOINTMENT SCHEDULING ====================

  // Get all availability slots
  app.get("/api/availability", async (req, res) => {
    const slots = await storage.getAvailabilitySlots();
    res.json(slots);
  });

  // Create availability slot
  app.post("/api/availability", async (req, res) => {
    const result = insertAvailabilitySlotSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: result.error.flatten() });
    }
    const slot = await storage.createAvailabilitySlot(result.data);
    res.json(slot);
  });

  // Update availability slot
  app.patch("/api/availability/:id", async (req, res) => {
    const slot = await storage.updateAvailabilitySlot(req.params.id, req.body);
    if (!slot) {
      return res.status(404).json({ error: "Slot not found" });
    }
    res.json(slot);
  });

  // Delete availability slot
  app.delete("/api/availability/:id", async (req, res) => {
    await storage.deleteAvailabilitySlot(req.params.id);
    res.status(204).send();
  });

  // Get all appointments
  app.get("/api/appointments", async (req, res) => {
    const appointments = await storage.getAppointments();
    res.json(appointments);
  });

  // Get appointments for a lead
  app.get("/api/leads/:id/appointments", async (req, res) => {
    const appointments = await storage.getAppointmentsByLeadId(req.params.id);
    res.json(appointments);
  });

  // Create appointment for a lead
  app.post("/api/leads/:id/appointments", async (req, res) => {
    const lead = await storage.getLead(req.params.id);
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const appointmentData = {
      ...req.body,
      leadId: lead.id,
      // Convert date string to Date object for Zod validation
      scheduledAt: req.body.scheduledAt ? new Date(req.body.scheduledAt) : undefined,
    };

    const result = insertAppointmentSchema.safeParse(appointmentData);
    if (!result.success) {
      return res.status(400).json({ error: result.error.flatten() });
    }

    const appointment = await storage.createAppointment(result.data);

    // Update lead with next action
    await storage.updateLead(lead.id, {
      nextAction: `Appointment scheduled: ${new Date(appointment.scheduledAt).toLocaleDateString()}`,
      nextActionType: "appointment",
      nextActionAt: appointment.scheduledAt,
    });

    res.json(appointment);
  });

  // Update appointment
  app.patch("/api/appointments/:id", async (req, res) => {
    const appointment = await storage.updateAppointment(req.params.id, req.body);
    if (!appointment) {
      return res.status(404).json({ error: "Appointment not found" });
    }
    res.json(appointment);
  });

  // Cancel appointment
  app.post("/api/appointments/:id/cancel", async (req, res) => {
    const { reason } = req.body;
    const appointment = await storage.updateAppointment(req.params.id, {
      status: "cancelled",
      cancelledAt: new Date(),
      cancelReason: reason || "Cancelled by user",
    });
    if (!appointment) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    // Update lead
    await storage.updateLead(appointment.leadId, {
      nextAction: "Reschedule appointment",
      nextActionType: "callback",
    });

    res.json(appointment);
  });

  // Confirm appointment
  app.post("/api/appointments/:id/confirm", async (req, res) => {
    const appointment = await storage.updateAppointment(req.params.id, {
      status: "confirmed",
      confirmedAt: new Date(),
    });
    if (!appointment) {
      return res.status(404).json({ error: "Appointment not found" });
    }
    res.json(appointment);
  });

  // Get available time slots for a specific date
  app.get("/api/availability/slots", async (req, res) => {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ error: "Date required" });
    }

    const requestedDate = new Date(date as string);
    const dayOfWeek = requestedDate.getDay();
    
    // Get availability for this day
    const allSlots = await storage.getAvailabilitySlots();
    const daySlots = allSlots.filter(s => s.dayOfWeek === dayOfWeek && s.enabled);

    if (daySlots.length === 0) {
      return res.json([]);
    }

    // Get existing appointments for this date
    const allAppointments = await storage.getAppointments();
    const dayStart = new Date(requestedDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(requestedDate);
    dayEnd.setHours(23, 59, 59, 999);

    const bookedTimes = allAppointments
      .filter(a => {
        const apptDate = new Date(a.scheduledAt);
        return apptDate >= dayStart && apptDate <= dayEnd && a.status !== "cancelled";
      })
      .map(a => new Date(a.scheduledAt).toISOString());

    // Generate available time slots (30-minute intervals)
    const availableSlots: { time: string; display: string }[] = [];
    
    for (const slot of daySlots) {
      const [startHour, startMin] = slot.startTime.split(":").map(Number);
      const [endHour, endMin] = slot.endTime.split(":").map(Number);
      
      const slotDate = new Date(requestedDate);
      slotDate.setHours(startHour, startMin, 0, 0);
      
      const endDate = new Date(requestedDate);
      endDate.setHours(endHour, endMin, 0, 0);

      while (slotDate < endDate) {
        const timeStr = slotDate.toISOString();
        if (!bookedTimes.includes(timeStr)) {
          availableSlots.push({
            time: timeStr,
            display: slotDate.toLocaleTimeString("en-US", { 
              hour: "numeric", 
              minute: "2-digit", 
              hour12: true 
            }),
          });
        }
        slotDate.setMinutes(slotDate.getMinutes() + 30);
      }
    }

    res.json(availableSlots);
  });

  // Seed default availability if none exists
  app.post("/api/availability/seed", async (req, res) => {
    const existing = await storage.getAvailabilitySlots();
    if (existing.length > 0) {
      return res.json({ message: "Availability already configured", slots: existing });
    }

    // Create default Mon-Fri 9am-5pm availability
    const defaultSlots = [];
    for (let day = 1; day <= 5; day++) {
      const slot = await storage.createAvailabilitySlot({
        dayOfWeek: day,
        startTime: "09:00",
        endTime: "17:00",
        timezone: "America/Chicago",
        enabled: true,
      });
      defaultSlots.push(slot);
    }

    res.json({ message: "Default availability created", slots: defaultSlots });
  });

  // ==================== VAPI CHAT WIDGET ====================

  // Get Vapi widget configuration (public key + assistant ID for client-side widget)
  app.get("/api/vapi/widget-config", async (req, res) => {
    const publicKey = process.env.VAPI_PUBLIC_KEY;
    const assistantId = process.env.VAPI_ASSISTANT_ID;

    res.json({
      publicKey: publicKey || "",
      assistantId: assistantId || "",
      configured: !!(publicKey && assistantId),
    });
  });

  // Chat message endpoint for text-based chat (uses OpenAI or simple responses)
  app.post("/api/chat/message", async (req, res) => {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    // Simple response logic - can be enhanced with OpenAI integration
    const lowerMessage = message.toLowerCase();
    let reply = "";

    if (lowerMessage.includes("appointment") || lowerMessage.includes("schedule")) {
      reply = "I'd be happy to help you schedule an appointment! Our available times are Monday through Friday, 9 AM to 5 PM. Would you like me to check availability for a specific date?";
    } else if (lowerMessage.includes("insurance") || lowerMessage.includes("coverage")) {
      reply = "We work with most major insurance providers including Blue Cross Blue Shield, Aetna, Cigna, UnitedHealth, and many others. Would you like me to verify your specific coverage?";
    } else if (lowerMessage.includes("service") || lowerMessage.includes("help") || lowerMessage.includes("treatment")) {
      reply = "We offer a range of healthcare services including mental health counseling, substance abuse treatment, and physical therapy. What type of care are you looking for?";
    } else if (lowerMessage.includes("cost") || lowerMessage.includes("price") || lowerMessage.includes("pay")) {
      reply = "Costs vary depending on your insurance coverage and the services you need. We offer free insurance verification to give you an accurate estimate. Would you like us to check your benefits?";
    } else if (lowerMessage.includes("location") || lowerMessage.includes("address") || lowerMessage.includes("where")) {
      reply = "We have multiple locations to serve you. Our main facility is conveniently located with easy parking. Would you like specific directions?";
    } else if (lowerMessage.includes("hello") || lowerMessage.includes("hi") || lowerMessage.includes("hey")) {
      reply = "Hello! Welcome to Claim Shield Health. How can I assist you today? I can help with scheduling appointments, verifying insurance, or answering questions about our services.";
    } else if (lowerMessage.includes("thanks") || lowerMessage.includes("thank you")) {
      reply = "You're welcome! Is there anything else I can help you with?";
    } else if (lowerMessage.includes("call") || lowerMessage.includes("phone") || lowerMessage.includes("speak")) {
      reply = "Would you like to speak with someone directly? I can connect you with our team, or you can use the phone icon to start a voice call right now.";
    } else if (lowerMessage.includes("hours") || lowerMessage.includes("open")) {
      reply = "Our office hours are Monday through Friday, 9 AM to 5 PM CST. However, our AI assistant is available 24/7 to answer questions and schedule appointments.";
    } else {
      reply = "Thank you for your message. I'd be happy to help you with scheduling an appointment, verifying your insurance, or answering questions about our services. What would you like to know more about?";
    }

    res.json({ reply });
  });

  // ==================== CHAT SESSION PERSISTENCE ====================

  // Get or create chat session by visitor token
  app.post("/api/chat-sessions/init", async (req, res) => {
    const { visitorToken, referrerUrl, userAgent } = req.body;
    
    if (!visitorToken) {
      return res.status(400).json({ error: "visitorToken is required" });
    }

    // Check for existing session
    let session = await storage.getChatSessionByVisitorToken(visitorToken);
    
    if (session) {
      // Fetch existing messages
      const messages = await storage.getChatMessagesBySessionId(session.id);
      
      // Check if this is a returning lead (completed session with leadId)
      let returningLead = null;
      if (session.leadId) {
        const lead = await storage.getLead(session.leadId);
        if (lead) {
          returningLead = {
            id: lead.id,
            name: lead.name,
            email: lead.email,
            phone: lead.phone,
            originalVisitDate: session.createdAt,
          };
          
          // Send returning lead email notification (only once per visit, tracked by session update)
          const lastVisitCheck = session.lastActivityAt ? new Date(session.lastActivityAt).getTime() : 0;
          const timeSinceLastActivity = Date.now() - lastVisitCheck;
          
          // Only send notification if it's been more than 1 hour since last activity
          if (timeSinceLastActivity > 60 * 60 * 1000 && emailTransporter) {
            try {
              const htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                  <style>
                    body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
                    .header { background: #1e293b; padding: 20px; text-align: center; }
                    .header-icon { color: #fff; font-size: 24px; }
                    .content { padding: 32px; max-width: 600px; margin: 0 auto; }
                    h1 { color: #1e293b; margin-bottom: 16px; font-size: 24px; }
                    .description { color: #64748b; margin-bottom: 24px; }
                    .lead-card { background: #f8fafc; border-left: 4px solid #3b82f6; padding: 16px; margin: 20px 0; border-radius: 4px; }
                    .lead-name { font-weight: 600; color: #1e293b; }
                    .lead-contact { color: #3b82f6; }
                    .visit-info { background: #f1f5f9; padding: 12px 16px; border-radius: 4px; margin: 16px 0; display: flex; align-items: center; }
                    .visit-icon { margin-right: 12px; color: #3b82f6; }
                    .btn { display: inline-block; background: #3b82f6; color: #ffffff !important; padding: 14px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 24px 0; }
                    .footer { padding: 24px 32px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 12px; }
                    .footer-brand { font-weight: 600; color: #1e293b; }
                  </style>
                </head>
                <body>
                  <div class="header">
                    <span class="header-icon">🏥</span>
                  </div>
                  <div class="content">
                    <h1>A Lead Has Returned to The Website</h1>
                    <p class="description">This notification has been sent out to inform you that the lead below has just returned to the website, expressing further interest.</p>
                    <p class="description">Why not reach out and see if you can answer any of their questions? Use the email or phone links below, or visit the dashboard using 'View Conversation'.</p>
                    
                    <div class="lead-card">
                      <div class="lead-name">${lead.name}</div>
                      <div class="lead-contact">
                        <a href="mailto:${lead.email}">${lead.email}</a> · 
                        <a href="tel:${lead.phone}">${lead.phone}</a>
                      </div>
                    </div>
                    
                    <div class="visit-info">
                      <span class="visit-icon">📅</span>
                      <div>
                        <strong>Original Visit Date</strong><br>
                        ${new Date(session.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${new Date(session.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </div>
                    </div>
                    
                    <a href="${process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:5000'}/leads/${lead.id}" class="btn">View Conversation</a>
                  </div>
                  <div class="footer">
                    <span class="footer-brand">Claim Shield Health</span><br>
                    The content of this email is confidential and intended for specific recipients only.
                  </div>
                </body>
                </html>
              `;

              await emailTransporter.sendMail({
                from: fromEmail,
                to: gmailUser,
                subject: `🔔 Returning Lead: ${lead.name} is back on your website`,
                html: htmlContent,
              });
              console.log(`Sent returning lead notification for ${lead.name}`);
            } catch (err) {
              console.error("Failed to send returning lead email:", err);
            }
          }
          
          // Update last activity
          await storage.updateChatSession(session.id, { lastActivityAt: new Date() });
        }
      }
      
      return res.json({ session, messages, resumed: true, returningLead });
    }

    // Create new session
    session = await storage.createChatSession({
      visitorToken,
      status: "active",
      currentStepId: "welcome",
      collectedData: {},
      referrerUrl,
      userAgent,
    });

    res.json({ session, messages: [], resumed: false, returningLead: null });
  });

  // Update chat session
  app.patch("/api/chat-sessions/:id", async (req, res) => {
    const session = await storage.updateChatSession(req.params.id, {
      ...req.body,
      lastActivityAt: new Date(),
    });
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    res.json(session);
  });

  // Add message to session
  app.post("/api/chat-sessions/:id/messages", async (req, res) => {
    const session = await storage.getChatSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    const message = await storage.createChatMessage({
      sessionId: session.id,
      type: req.body.type || "user",
      stepId: req.body.stepId,
      content: req.body.content,
      metadata: req.body.metadata,
    });

    // Update session's last activity
    await storage.updateChatSession(session.id, {
      lastActivityAt: new Date(),
    });

    res.json(message);
  });

  // Complete session (link to lead)
  app.post("/api/chat-sessions/:id/complete", async (req, res) => {
    const { leadId, qualificationScore } = req.body;
    
    const session = await storage.updateChatSession(req.params.id, {
      status: "completed",
      leadId,
      qualificationScore,
      completedAt: new Date(),
      lastActivityAt: new Date(),
    });

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    res.json(session);
  });

  // Mark session as abandoned
  app.post("/api/chat-sessions/:id/abandon", async (req, res) => {
    const session = await storage.updateChatSession(req.params.id, {
      status: "abandoned",
      abandonedAt: new Date(),
      lastActivityAt: new Date(),
    });

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    res.json(session);
  });

  // ==================== CHAT ANALYTICS ====================

  // Get chat analytics stats
  app.get("/api/chat-analytics/stats", async (req, res) => {
    const stats = await storage.getChatSessionStats();
    res.json(stats);
  });

  // Get call analytics stats
  app.get("/api/calls-analytics/stats", async (req, res) => {
    try {
      const leads = await storage.getLeads();
      let totalCalls = 0;
      let totalDuration = 0;
      let answeredCalls = 0;
      let missedCalls = 0;
      let voicemailCalls = 0;
      
      for (const lead of leads) {
        const calls = await storage.getCallsByLeadId(lead.id);
        totalCalls += calls.length;
        
        for (const call of calls) {
          if (call.duration) {
            totalDuration += call.duration;
          }
          if (call.status === "completed") {
            answeredCalls++;
          } else if (call.status === "no-answer") {
            missedCalls++;
          } else if (call.status === "voicemail") {
            voicemailCalls++;
          }
        }
      }
      
      const avgDuration = totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0;
      const answeredRate = totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0;
      const missedRate = totalCalls > 0 ? Math.round((missedCalls / totalCalls) * 100) : 0;
      const voicemailRate = totalCalls > 0 ? Math.round((voicemailCalls / totalCalls) * 100) : 0;
      
      res.json({
        totalCalls,
        answeredCalls,
        missedCalls,
        voicemailCalls,
        avgDuration,
        answeredRate,
        missedRate,
        voicemailRate,
      });
    } catch (error) {
      console.error("Error getting call stats:", error);
      res.status(500).json({ error: "Failed to get call stats" });
    }
  });

  // Get time-series data for charts
  app.get("/api/chat-analytics/timeseries", async (req, res) => {
    const { days = "30" } = req.query;
    const numDays = parseInt(days as string) || 30;
    
    const sessions = await storage.getChatSessions();
    const leads = await storage.getLeads();
    
    // Group data by date
    const dateMap = new Map<string, { sessions: number; leads: number; appointments: number }>();
    
    // Initialize with last N days
    for (let i = 0; i < numDays; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      dateMap.set(dateStr, { sessions: 0, leads: 0, appointments: 0 });
    }
    
    // Count sessions by date
    for (const session of sessions) {
      const dateStr = new Date(session.createdAt).toISOString().split('T')[0];
      if (dateMap.has(dateStr)) {
        const data = dateMap.get(dateStr)!;
        data.sessions++;
        if (session.leadId) {
          data.leads++;
        }
        const collectedData = session.collectedData as Record<string, unknown> | null;
        if (collectedData?.appointmentSlot) {
          data.appointments++;
        }
      }
    }
    
    // Convert to array and sort by date
    const result = Array.from(dateMap.entries())
      .map(([date, data]) => ({
        date,
        formattedDate: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        ...data,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    
    res.json(result);
  });

  // Get all chat sessions (for admin view)
  app.get("/api/chat-sessions", async (req, res) => {
    const sessions = await storage.getChatSessions();
    res.json(sessions);
  });

  // Get session with messages
  app.get("/api/chat-sessions/:id", async (req, res) => {
    const session = await storage.getChatSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    const messages = await storage.getChatMessagesBySessionId(session.id);
    res.json({ session, messages });
  });

  // Get daily analytics
  app.get("/api/chat-analytics", async (req, res) => {
    const { startDate, endDate } = req.query;
    const analytics = await storage.getChatAnalytics(
      startDate as string | undefined,
      endDate as string | undefined
    );
    res.json(analytics);
  });

  // ============ VOB VERIFICATION (VerifyTX) ============
  
  // Search payers
  app.get("/api/verifytx/payers", async (req, res) => {
    const { getVerifyTxClient } = await import("./verifytx");
    const client = getVerifyTxClient();
    
    if (!client) {
      return res.status(503).json({ 
        error: "VerifyTX not configured", 
        message: "VerifyTX API credentials are not set up. Please configure VERIFYTX_API_KEY and VERIFYTX_API_SECRET." 
      });
    }

    try {
      const { query } = req.query;
      const payers = query 
        ? await client.searchPayers(query as string)
        : await client.getAllPayers();
      res.json(payers);
    } catch (error: any) {
      console.error("VerifyTX payer search error:", error);
      res.status(500).json({ error: "Failed to search payers", message: error.message });
    }
  });

  // Get VOB verifications for a lead
  app.get("/api/leads/:id/vob-verifications", async (req, res) => {
    const verifications = await storage.getVobVerificationsByLeadId(req.params.id);
    res.json(verifications);
  });

  // Get latest VOB verification for a lead
  app.get("/api/leads/:id/vob-verifications/latest", async (req, res) => {
    const verification = await storage.getLatestVobVerificationByLeadId(req.params.id);
    res.json(verification || null);
  });

  // Verify insurance benefits for a lead
  app.post("/api/leads/:id/verify-insurance", async (req, res) => {
    const { getVerifyTxClient, mapVerifyTxResponse } = await import("./verifytx");
    const client = getVerifyTxClient();
    
    if (!client) {
      return res.status(503).json({ 
        error: "VerifyTX not configured", 
        message: "VerifyTX API credentials are not set up. Please configure VERIFYTX_API_KEY and VERIFYTX_API_SECRET." 
      });
    }

    const leadId = req.params.id;
    const lead = await storage.getLead(leadId);
    
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const { payerId, payerName } = req.body;
    
    if (!payerId || !payerName) {
      return res.status(400).json({ error: "payerId and payerName are required" });
    }

    // Get patient data for verification
    const patient = await storage.getPatientByLeadId(leadId);
    
    // Use patient data if available, otherwise fall back to lead data
    const firstName = lead.firstName || lead.name?.split(" ")[0] || "";
    const lastName = lead.lastName || lead.name?.split(" ").slice(1).join(" ") || "";
    const dateOfBirth = patient?.dob || req.body.dateOfBirth;
    const memberId = patient?.memberId || lead.memberId || req.body.memberId;

    if (!firstName || !lastName) {
      return res.status(400).json({ error: "Patient name is required" });
    }

    if (!dateOfBirth) {
      return res.status(400).json({ error: "Date of birth is required" });
    }

    if (!memberId) {
      return res.status(400).json({ error: "Member ID is required" });
    }

    try {
      // Create initial verification record
      const pendingVerification = await storage.createVobVerification({
        leadId,
        patientId: patient?.id || null,
        payerId,
        payerName,
        memberId,
        status: "pending",
      });

      // Update lead VOB status
      await storage.updateLead(leadId, { vobStatus: "in_progress" });

      // Log activity
      await storage.createActivityLog({
        leadId,
        activityType: "vob_started",
        description: `VOB verification started with ${payerName}`,
        performedBy: "system",
        metadata: { payerId, payerName, memberId },
      });

      // Call VerifyTX API
      const response = await client.verify({
        firstName,
        lastName,
        dateOfBirth,
        memberId,
        payerId,
      });

      // Map response to our schema
      const mappedData = mapVerifyTxResponse(response, { payerId, payerName, memberId });

      // Update verification record with results
      const updatedVerification = await storage.updateVobVerification(pendingVerification.id, {
        ...mappedData,
        verifiedAt: new Date(),
      });

      // Update lead VOB status based on result
      const vobStatus = mappedData.status === "verified" ? "verified" : 
                        mappedData.status === "error" ? "incomplete" : "in_progress";
      
      await storage.updateLead(leadId, { 
        vobStatus,
        vobScore: mappedData.status === "verified" ? 100 : 0,
        insuranceCarrier: payerName,
      });

      // Log completion
      await storage.createActivityLog({
        leadId,
        activityType: "vob_completed",
        description: `VOB verification ${mappedData.status === "verified" ? "completed successfully" : "failed"}`,
        performedBy: "system",
        metadata: { 
          payerId, 
          payerName, 
          status: mappedData.status,
          copay: mappedData.copay,
          deductible: mappedData.deductible,
        },
      });

      res.json(updatedVerification);
    } catch (error: any) {
      console.error("VerifyTX verification error:", error);
      
      // Update lead status to reflect failure
      await storage.updateLead(leadId, { vobStatus: "incomplete" });
      
      // Log error
      await storage.createActivityLog({
        leadId,
        activityType: "vob_failed",
        description: `VOB verification failed: ${error.message}`,
        performedBy: "system",
        metadata: { error: error.message },
      });
      
      res.status(500).json({ error: "Verification failed", message: error.message });
    }
  });

  // Re-verify existing VOB
  app.post("/api/vob-verifications/:id/reverify", async (req, res) => {
    const { getVerifyTxClient, mapVerifyTxResponse } = await import("./verifytx");
    const client = getVerifyTxClient();
    
    if (!client) {
      return res.status(503).json({ 
        error: "VerifyTX not configured", 
        message: "VerifyTX API credentials are not set up." 
      });
    }

    const verification = await storage.getVobVerification(req.params.id);
    
    if (!verification) {
      return res.status(404).json({ error: "VOB verification not found" });
    }

    if (!verification.verifytxVobId) {
      return res.status(400).json({ error: "Cannot re-verify - no VerifyTX VOB ID" });
    }

    try {
      const response = await client.reverify(verification.verifytxVobId);
      const mappedData = mapVerifyTxResponse(response, {
        payerId: verification.payerId,
        payerName: verification.payerName,
        memberId: verification.memberId,
      });

      const updated = await storage.updateVobVerification(verification.id, {
        ...mappedData,
        verifiedAt: new Date(),
      });

      res.json(updated);
    } catch (error: any) {
      console.error("VerifyTX re-verification error:", error);
      res.status(500).json({ error: "Re-verification failed", message: error.message });
    }
  });

  // Export VOB as PDF
  app.get("/api/vob-verifications/:id/pdf", async (req, res) => {
    const { getVerifyTxClient } = await import("./verifytx");
    const client = getVerifyTxClient();
    
    if (!client) {
      return res.status(503).json({ error: "VerifyTX not configured" });
    }

    const verification = await storage.getVobVerification(req.params.id);
    
    if (!verification) {
      return res.status(404).json({ error: "VOB verification not found" });
    }

    if (!verification.verifytxVobId) {
      return res.status(400).json({ error: "Cannot export - no VerifyTX VOB ID" });
    }

    try {
      const result = await client.exportPdf(verification.verifytxVobId);
      
      // Update record with PDF URL
      await storage.updateVobVerification(verification.id, {
        pdfUrl: result.message,
      });
      
      res.json({ pdfUrl: result.message });
    } catch (error: any) {
      console.error("VerifyTX PDF export error:", error);
      res.status(500).json({ error: "PDF export failed", message: error.message });
    }
  });

  // Check VerifyTX configuration status
  app.get("/api/verifytx/status", async (req, res) => {
    const { getVerifyTxClient } = await import("./verifytx");
    const client = getVerifyTxClient();
    res.json({ 
      configured: !!client,
      message: client ? "VerifyTX is configured and ready" : "VerifyTX credentials not set"
    });
  });

}

function generateIntakeTranscript(patientName: string): string {
  return `Agent: Good morning! This is Sarah from Claim Shield Health calling to verify insurance benefits. May I speak with ${patientName}?

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
