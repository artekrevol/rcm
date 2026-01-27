import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, jsonb, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// User roles: admin, rcm_manager, intake
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("intake"),
  name: text("name").notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Lead status: new, attempting_contact, contacted, qualified, unqualified, converted, lost
// Priority: P0 (urgent), P1 (high), P2 (normal)
// VOB Status: not_started, in_progress, verified, incomplete
// Handoff Status: not_sent, sent, accepted
// Next Action Type: call, callback, verify_insurance, request_docs, create_claim, none
// Outcome Code: no_answer, left_voicemail, contacted, qualified, unqualified, insurance_missing, wrong_number
export const leads = pgTable("leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  preferredName: text("preferred_name"),
  phone: text("phone").notNull(),
  email: text("email"),
  state: text("state"),
  timezone: text("timezone"),
  source: text("source").notNull().default("website"),
  status: text("status").notNull().default("new"),
  priority: text("priority").notNull().default("P2"),
  nextAction: text("next_action"),
  nextActionType: text("next_action_type").notNull().default("call"),
  nextActionAt: timestamp("next_action_at"),
  slaDeadlineAt: timestamp("sla_deadline_at"),
  lastOutcome: text("last_outcome"),
  outcomeCode: text("outcome_code"),
  attemptCount: integer("attempt_count").notNull().default(0),
  lastContactedAt: timestamp("last_contacted_at"),
  vobStatus: text("vob_status").notNull().default("not_started"),
  vobScore: integer("vob_score").notNull().default(0),
  vobMissingFields: jsonb("vob_missing_fields").$type<string[]>().default([]),
  serviceNeeded: text("service_needed"),
  insuranceCarrier: text("insurance_carrier"),
  memberId: text("member_id"),
  planType: text("plan_type"),
  bestTimeToCall: text("best_time_to_call"),
  notes: text("notes"),
  consentToCall: boolean("consent_to_call").notNull().default(true),
  ownerUserId: varchar("owner_user_id"),
  handoffStatus: text("handoff_status").notNull().default("not_sent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertLeadSchema = createInsertSchema(leads).omit({ id: true, createdAt: true });
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leads.$inferSelect;

// Patient linked to a lead
export const patients = pgTable("patients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull(),
  dob: text("dob").notNull(),
  state: text("state").notNull(),
  insuranceCarrier: text("insurance_carrier").notNull(),
  memberId: text("member_id").notNull(),
  planType: text("plan_type").notNull(),
});

export const insertPatientSchema = createInsertSchema(patients).omit({ id: true });
export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type Patient = typeof patients.$inferSelect;

// Encounter (service request)
export const encounters = pgTable("encounters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  patientId: varchar("patient_id").notNull(),
  serviceType: text("service_type").notNull(),
  facilityType: text("facility_type").notNull(),
  admissionType: text("admission_type").notNull(),
  expectedStartDate: text("expected_start_date").notNull(),
});

export const insertEncounterSchema = createInsertSchema(encounters).omit({ id: true });
export type InsertEncounter = z.infer<typeof insertEncounterSchema>;
export type Encounter = typeof encounters.$inferSelect;

// Claim with risk scoring
export const claims = pgTable("claims", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  patientId: varchar("patient_id").notNull(),
  encounterId: varchar("encounter_id").notNull(),
  payer: text("payer").notNull(),
  cptCodes: jsonb("cpt_codes").notNull().$type<string[]>(),
  amount: real("amount").notNull(),
  status: text("status").notNull().default("created"),
  riskScore: integer("risk_score").notNull().default(0),
  readinessStatus: text("readiness_status").notNull().default("GREEN"),
  reason: text("reason"),
  nextStep: text("next_step"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertClaimSchema = createInsertSchema(claims).omit({ id: true, createdAt: true });
export type InsertClaim = z.infer<typeof insertClaimSchema>;
export type Claim = typeof claims.$inferSelect;

// Claim events for timeline tracking
export const claimEvents = pgTable("claim_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  claimId: varchar("claim_id").notNull(),
  type: text("type").notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  notes: text("notes"),
});

export const insertClaimEventSchema = createInsertSchema(claimEvents).omit({ id: true, timestamp: true });
export type InsertClaimEvent = z.infer<typeof insertClaimEventSchema>;
export type ClaimEvent = typeof claimEvents.$inferSelect;

// Denial records
export const denials = pgTable("denials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  claimId: varchar("claim_id").notNull(),
  denialCategory: text("denial_category").notNull(),
  denialReasonText: text("denial_reason_text").notNull(),
  payer: text("payer").notNull(),
  cptCode: text("cpt_code").notNull(),
  rootCauseTag: text("root_cause_tag").notNull(),
  resolved: boolean("resolved").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDenialSchema = createInsertSchema(denials).omit({ id: true, createdAt: true });
export type InsertDenial = z.infer<typeof insertDenialSchema>;
export type Denial = typeof denials.$inferSelect;

// Prevention rules
export const rules = pgTable("rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description").notNull(),
  payer: text("payer"),
  cptCode: text("cpt_code"),
  triggerPattern: text("trigger_pattern").notNull(),
  preventionAction: text("prevention_action").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  impactCount: integer("impact_count").notNull().default(0),
  triggeredCount: integer("triggered_count").notNull().default(0),
  preventedCount: integer("prevented_count").notNull().default(0),
  protectedAmount: real("protected_amount").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertRuleSchema = createInsertSchema(rules).omit({ id: true, createdAt: true, impactCount: true, triggeredCount: true, preventedCount: true, protectedAmount: true });
export type InsertRule = z.infer<typeof insertRuleSchema>;
export type Rule = typeof rules.$inferSelect;

// Call records (Vapi or mock)
export const calls = pgTable("calls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull(),
  vapiCallId: text("vapi_call_id"),
  transcript: text("transcript").notNull(),
  summary: text("summary").notNull(),
  disposition: text("disposition").notNull(),
  notes: text("notes"),
  duration: integer("duration"),
  recordingUrl: text("recording_url"),
  extractedData: jsonb("extracted_data").$type<{
    insuranceCarrier?: string;
    memberId?: string;
    serviceType?: string;
    state?: string;
    consent?: boolean;
    qualified?: boolean;
    notes?: string;
  }>(),
  vobData: jsonb("vob_data").$type<{
    verified?: boolean;
    copay?: number;
    deductible?: number;
    deductibleMet?: number;
    outOfPocketMax?: number;
    outOfPocketMet?: number;
    coinsurance?: number;
    coverageType?: string;
    effectiveDate?: string;
    termDate?: string;
    priorAuthRequired?: boolean;
    networkStatus?: "in_network" | "out_of_network" | "unknown";
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCallSchema = createInsertSchema(calls).omit({ id: true, createdAt: true });
export type InsertCall = z.infer<typeof insertCallSchema>;
export type Call = typeof calls.$inferSelect;

// Prior Authorization tracking
export const priorAuthorizations = pgTable("prior_authorizations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  encounterId: varchar("encounter_id").notNull(),
  patientId: varchar("patient_id").notNull(),
  payer: text("payer").notNull(),
  serviceType: text("service_type").notNull(),
  authNumber: text("auth_number"),
  status: text("status").notNull().default("pending"),
  requestedDate: timestamp("requested_date").defaultNow().notNull(),
  approvedDate: timestamp("approved_date"),
  expirationDate: timestamp("expiration_date"),
  approvedUnits: integer("approved_units"),
  usedUnits: integer("used_units").default(0),
  notes: text("notes"),
  denialReason: text("denial_reason"),
});

export const insertPriorAuthSchema = createInsertSchema(priorAuthorizations).omit({ id: true, requestedDate: true });
export type InsertPriorAuth = z.infer<typeof insertPriorAuthSchema>;
export type PriorAuth = typeof priorAuthorizations.$inferSelect;

// Dashboard metrics type
export type DashboardMetrics = {
  denialsPrevented: number;
  claimsAtRisk: number;
  avgArDays: number;
  topPayerRisk: string;
  revenueProtected: number;
  totalClaims: number;
  pendingClaims: number;
};

// Denial cluster for intelligence
export type DenialCluster = {
  payer: string;
  cptCode: string;
  rootCause: string;
  count: number;
  trend: number[];
  suggestedRule?: {
    name: string;
    description: string;
    triggerPattern: string;
    preventionAction: string;
  };
};

// Risk explanation for explainability panel
export type RiskExplanation = {
  inputs: { name: string; value: string; weight: number }[];
  factors: { name: string; contribution: number; description: string }[];
  appliedRules: { name: string; description: string; impact: string }[];
  confidence: number;
  recommendations: { action: string; priority: "high" | "medium" | "low"; completed: boolean }[];
};

// Email templates for automation
export const emailTemplates = pgTable("email_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  category: text("category").notNull().default("general"),
  variables: jsonb("variables").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEmailTemplateSchema = createInsertSchema(emailTemplates).omit({ id: true, createdAt: true });
export type InsertEmailTemplate = z.infer<typeof insertEmailTemplateSchema>;
export type EmailTemplate = typeof emailTemplates.$inferSelect;

// Email nurture sequences
export const nurtureSections = pgTable("nurture_sequences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  triggerEvent: text("trigger_event").notNull(),
  steps: jsonb("steps").$type<{
    delayDays: number;
    templateId: string;
    templateName?: string;
  }[]>().default([]),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertNurtureSequenceSchema = createInsertSchema(nurtureSections).omit({ id: true, createdAt: true });
export type InsertNurtureSequence = z.infer<typeof insertNurtureSequenceSchema>;
export type NurtureSequence = typeof nurtureSections.$inferSelect;

// Email log for sent emails
export const emailLogs = pgTable("email_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull(),
  templateId: varchar("template_id"),
  sequenceId: varchar("sequence_id"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  toEmail: text("to_email").notNull(),
  status: text("status").notNull().default("pending"),
  sentAt: timestamp("sent_at"),
  openedAt: timestamp("opened_at"),
  clickedAt: timestamp("clicked_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEmailLogSchema = createInsertSchema(emailLogs).omit({ id: true, createdAt: true });
export type InsertEmailLog = z.infer<typeof insertEmailLogSchema>;
export type EmailLog = typeof emailLogs.$inferSelect;

// Appointment availability slots
export const availabilitySlots = pgTable("availability_slots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  timezone: text("timezone").notNull().default("America/Chicago"),
  enabled: boolean("enabled").notNull().default(true),
});

export const insertAvailabilitySlotSchema = createInsertSchema(availabilitySlots).omit({ id: true });
export type InsertAvailabilitySlot = z.infer<typeof insertAvailabilitySlotSchema>;
export type AvailabilitySlot = typeof availabilitySlots.$inferSelect;

// Appointments
export const appointments = pgTable("appointments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  scheduledAt: timestamp("scheduled_at").notNull(),
  duration: integer("duration").notNull().default(30),
  timezone: text("timezone").notNull().default("America/Chicago"),
  status: text("status").notNull().default("scheduled"),
  reminderSent: boolean("reminder_sent").notNull().default(false),
  confirmedAt: timestamp("confirmed_at"),
  cancelledAt: timestamp("cancelled_at"),
  cancelReason: text("cancel_reason"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAppointmentSchema = createInsertSchema(appointments).omit({ id: true, createdAt: true });
export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;
export type Appointment = typeof appointments.$inferSelect;

// Chat Sessions for persistence and analytics
// Status: active, completed, abandoned
export const chatSessions = pgTable("chat_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  visitorToken: text("visitor_token").notNull(),
  leadId: varchar("lead_id"),
  status: text("status").notNull().default("active"),
  currentStepId: text("current_step_id").notNull().default("welcome"),
  collectedData: jsonb("collected_data").$type<Record<string, unknown>>().default({}),
  qualificationScore: integer("qualification_score"),
  source: text("source").notNull().default("chat_widget"),
  referrerUrl: text("referrer_url"),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  abandonedAt: timestamp("abandoned_at"),
  lastActivityAt: timestamp("last_activity_at").defaultNow().notNull(),
});

export const insertChatSessionSchema = createInsertSchema(chatSessions).omit({ id: true, startedAt: true, lastActivityAt: true });
export type InsertChatSession = z.infer<typeof insertChatSessionSchema>;
export type ChatSession = typeof chatSessions.$inferSelect;

// Chat Messages for conversation history
// Type: bot, user, system
export const chatMessages = pgTable("chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(),
  type: text("type").notNull().default("bot"),
  stepId: text("step_id"),
  content: text("content").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({ id: true, createdAt: true });
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

// Chat Analytics aggregated metrics (daily snapshots)
export const chatAnalytics = pgTable("chat_analytics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: text("date").notNull(),
  totalSessions: integer("total_sessions").notNull().default(0),
  completedSessions: integer("completed_sessions").notNull().default(0),
  abandonedSessions: integer("abandoned_sessions").notNull().default(0),
  leadsGenerated: integer("leads_generated").notNull().default(0),
  appointmentsBooked: integer("appointments_booked").notNull().default(0),
  avgSessionDuration: integer("avg_session_duration"),
  dropoffByStep: jsonb("dropoff_by_step").$type<Record<string, number>>().default({}),
  conversionRate: real("conversion_rate"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertChatAnalyticsSchema = createInsertSchema(chatAnalytics).omit({ id: true, createdAt: true });
export type InsertChatAnalytics = z.infer<typeof insertChatAnalyticsSchema>;
export type ChatAnalytics = typeof chatAnalytics.$inferSelect;

// VOB Verifications from VerifyTX
export const vobVerifications = pgTable("vob_verifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull(),
  patientId: varchar("patient_id"),
  verifytxVobId: text("verifytx_vob_id"),
  payerId: text("payer_id").notNull(),
  payerName: text("payer_name").notNull(),
  memberId: text("member_id").notNull(),
  status: text("status").notNull().default("pending"),
  policyStatus: text("policy_status"),
  policyType: text("policy_type"),
  effectiveDate: text("effective_date"),
  termDate: text("term_date"),
  copay: real("copay"),
  deductible: real("deductible"),
  deductibleMet: real("deductible_met"),
  coinsurance: real("coinsurance"),
  outOfPocketMax: real("out_of_pocket_max"),
  outOfPocketMet: real("out_of_pocket_met"),
  benefitsRemaining: real("benefits_remaining"),
  priorAuthRequired: boolean("prior_auth_required"),
  networkStatus: text("network_status"),
  coverageLimits: text("coverage_limits"),
  planName: text("plan_name"),
  payerNotes: text("payer_notes"),
  pdfUrl: text("pdf_url"),
  rawResponse: jsonb("raw_response").$type<Record<string, unknown>>().default({}),
  errorMessage: text("error_message"),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertVobVerificationSchema = createInsertSchema(vobVerifications).omit({ id: true, createdAt: true });
export type InsertVobVerification = z.infer<typeof insertVobVerificationSchema>;
export type VobVerification = typeof vobVerifications.$inferSelect;

// Activity logs for tracking all deal/lead changes (HubSpot-style timeline)
export const activityLogs = pgTable("activity_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id").notNull(),
  activityType: text("activity_type").notNull(), // property_change, status_change, email_sent, sms_sent, call_made, note_added, etc.
  field: text("field"), // For property changes, the field that changed
  oldValue: text("old_value"), // Previous value
  newValue: text("new_value"), // New value
  description: text("description"), // Human-readable description
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}), // Additional context
  performedBy: text("performed_by"), // User or "system"
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({ id: true, createdAt: true });
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLogs.$inferSelect;
