import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, jsonb, real, date, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("intake"),
  name: text("name").notNull(),
  organizationId: varchar("organization_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

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
  dob: text("dob"),
  planType: text("plan_type"),
  bestTimeToCall: text("best_time_to_call"),
  notes: text("notes"),
  consentToCall: boolean("consent_to_call").notNull().default(true),
  engagementHalted: boolean("engagement_halted").notNull().default(false),
  ownerUserId: varchar("owner_user_id"),
  organizationId: varchar("organization_id"),
  handoffStatus: text("handoff_status").notNull().default("not_sent"),
  referralPartnerName: varchar("referral_partner_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertLeadSchema = createInsertSchema(leads).omit({ id: true, createdAt: true });
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leads.$inferSelect;

export const patients = pgTable("patients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id"),
  dob: text("dob").notNull(),
  state: text("state"),
  insuranceCarrier: text("insurance_carrier"),
  memberId: text("member_id"),
  planType: text("plan_type"),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  preferredName: varchar("preferred_name"),
  phone: varchar("phone"),
  email: varchar("email"),
  sex: varchar("sex"),
  address: jsonb("address").$type<Record<string, string>>(),
  groupNumber: varchar("group_number"),
  insuredName: varchar("insured_name"),
  relationshipToInsured: varchar("relationship_to_insured"),
  authorizationNumber: varchar("authorization_number"),
  payerId: varchar("payer_id"),
  referringProviderName: varchar("referring_provider_name"),
  referringProviderNpi: varchar("referring_provider_npi"),
  defaultProviderId: varchar("default_provider_id"),
  referralSource: varchar("referral_source"),
  referralPartnerName: varchar("referral_partner_name"),
  serviceNeeded: varchar("service_needed"),
  intakeCompleted: boolean("intake_completed").default(false),
  vobVerified: boolean("vob_verified").default(false),
  notes: text("notes"),
  planProduct: text("plan_product"),
  organizationId: varchar("organization_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const insertPatientSchema = createInsertSchema(patients).omit({ id: true });
export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type Patient = typeof patients.$inferSelect;

export const encounters = pgTable("encounters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  patientId: varchar("patient_id").notNull(),
  serviceType: text("service_type").notNull(),
  facilityType: text("facility_type").notNull(),
  admissionType: text("admission_type").notNull(),
  expectedStartDate: text("expected_start_date").notNull(),
  providerId: varchar("provider_id"),
  placeOfService: varchar("place_of_service").default("12"),
  serviceDate: date("service_date"),
  authorizationNumber: varchar("authorization_number"),
  createdBy: varchar("created_by"),
  organizationId: varchar("organization_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertEncounterSchema = createInsertSchema(encounters).omit({ id: true });
export type InsertEncounter = z.infer<typeof insertEncounterSchema>;
export type Encounter = typeof encounters.$inferSelect;

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
  providerId: varchar("provider_id"),
  payerId: varchar("payer_id"),
  serviceDate: date("service_date"),
  placeOfService: varchar("place_of_service").default("12"),
  icd10Primary: varchar("icd10_primary"),
  icd10Secondary: jsonb("icd10_secondary").$type<string[]>(),
  authorizationNumber: varchar("authorization_number"),
  serviceLines: jsonb("service_lines").$type<any[]>(),
  pdfUrl: varchar("pdf_url"),
  submissionMethod: varchar("submission_method").default("manual"),
  availityIcn: varchar("availity_icn"),
  chargeOverridden: boolean("charge_overridden").default(false),
  createdBy: varchar("created_by"),
  organizationId: varchar("organization_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at"),
  claimFrequencyCode: varchar("claim_frequency_code").default("1"),
  origClaimNumber: varchar("orig_claim_number"),
  homeboundIndicator: varchar("homebound_indicator").default("Y"),
  orderingProviderId: varchar("ordering_provider_id"),
  delayReasonCode: varchar("delay_reason_code"),
  followUpDate: date("follow_up_date"),
  followUpStatus: varchar("follow_up_status"),
  planProduct: text("plan_product"),
});

export const insertClaimSchema = createInsertSchema(claims).omit({ id: true, createdAt: true });
export type InsertClaim = z.infer<typeof insertClaimSchema>;
export type Claim = typeof claims.$inferSelect;

export const claimEvents = pgTable("claim_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  claimId: varchar("claim_id").notNull(),
  type: text("type").notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  notes: text("notes"),
  organizationId: varchar("organization_id"),
});

export const insertClaimEventSchema = createInsertSchema(claimEvents).omit({ id: true, timestamp: true });
export type InsertClaimEvent = z.infer<typeof insertClaimEventSchema>;
export type ClaimEvent = typeof claimEvents.$inferSelect;

export const denials = pgTable("denials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  claimId: varchar("claim_id").notNull(),
  denialCategory: text("denial_category").notNull(),
  denialReasonText: text("denial_reason_text").notNull(),
  payer: text("payer").notNull(),
  cptCode: text("cpt_code").notNull(),
  rootCauseTag: text("root_cause_tag").notNull(),
  resolved: boolean("resolved").notNull().default(false),
  organizationId: varchar("organization_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDenialSchema = createInsertSchema(denials).omit({ id: true, createdAt: true });
export type InsertDenial = z.infer<typeof insertDenialSchema>;
export type Denial = typeof denials.$inferSelect;

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
  organizationId: varchar("organization_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertRuleSchema = createInsertSchema(rules).omit({ id: true, createdAt: true, impactCount: true, triggeredCount: true, preventedCount: true, protectedAmount: true });
export type InsertRule = z.infer<typeof insertRuleSchema>;
export type Rule = typeof rules.$inferSelect;

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
  organizationId: varchar("organization_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCallSchema = createInsertSchema(calls).omit({ id: true, createdAt: true });
export type InsertCall = z.infer<typeof insertCallSchema>;
export type Call = typeof calls.$inferSelect;

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
  organizationId: varchar("organization_id"),
});

export const insertPriorAuthSchema = createInsertSchema(priorAuthorizations).omit({ id: true, requestedDate: true });
export type InsertPriorAuth = z.infer<typeof insertPriorAuthSchema>;
export type PriorAuth = typeof priorAuthorizations.$inferSelect;

export type DashboardMetrics = {
  denialsPrevented: number;
  claimsAtRisk: number;
  avgArDays: number;
  topPayerRisk: string;
  revenueProtected: number;
  totalClaims: number;
  pendingClaims: number;
};

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

export type RiskExplanation = {
  inputs: { name: string; value: string; weight: number }[];
  factors: { name: string; contribution: number; description: string }[];
  appliedRules: { name: string; description: string; impact: string }[];
  confidence: number;
  recommendations: { action: string; priority: "high" | "medium" | "low"; completed: boolean }[];
};

export const emailTemplates = pgTable("email_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  category: text("category").notNull().default("general"),
  variables: jsonb("variables").$type<string[]>().default([]),
  organizationId: varchar("organization_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEmailTemplateSchema = createInsertSchema(emailTemplates).omit({ id: true, createdAt: true });
export type InsertEmailTemplate = z.infer<typeof insertEmailTemplateSchema>;
export type EmailTemplate = typeof emailTemplates.$inferSelect;

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
  organizationId: varchar("organization_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertNurtureSequenceSchema = createInsertSchema(nurtureSections).omit({ id: true, createdAt: true });
export type InsertNurtureSequence = z.infer<typeof insertNurtureSequenceSchema>;
export type NurtureSequence = typeof nurtureSections.$inferSelect;

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
  organizationId: varchar("organization_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEmailLogSchema = createInsertSchema(emailLogs).omit({ id: true, createdAt: true });
export type InsertEmailLog = z.infer<typeof insertEmailLogSchema>;
export type EmailLog = typeof emailLogs.$inferSelect;

export const availabilitySlots = pgTable("availability_slots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  timezone: text("timezone").notNull().default("America/Chicago"),
  enabled: boolean("enabled").notNull().default(true),
  organizationId: varchar("organization_id"),
});

export const insertAvailabilitySlotSchema = createInsertSchema(availabilitySlots).omit({ id: true });
export type InsertAvailabilitySlot = z.infer<typeof insertAvailabilitySlotSchema>;
export type AvailabilitySlot = typeof availabilitySlots.$inferSelect;

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
  organizationId: varchar("organization_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAppointmentSchema = createInsertSchema(appointments).omit({ id: true, createdAt: true });
export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;
export type Appointment = typeof appointments.$inferSelect;

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
  organizationId: varchar("organization_id"),
});

export const insertChatSessionSchema = createInsertSchema(chatSessions).omit({ id: true, startedAt: true, lastActivityAt: true });
export type InsertChatSession = z.infer<typeof insertChatSessionSchema>;
export type ChatSession = typeof chatSessions.$inferSelect;

export const chatMessages = pgTable("chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: varchar("session_id").notNull(),
  type: text("type").notNull().default("bot"),
  stepId: text("step_id"),
  content: text("content").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  organizationId: varchar("organization_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({ id: true, createdAt: true });
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

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
  organizationId: varchar("organization_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertChatAnalyticsSchema = createInsertSchema(chatAnalytics).omit({ id: true, createdAt: true });
export type InsertChatAnalytics = z.infer<typeof insertChatAnalyticsSchema>;
export type ChatAnalytics = typeof chatAnalytics.$inferSelect;

export const vobVerifications = pgTable("vob_verifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id"),
  patientId: varchar("patient_id"),
  verifytxVobId: text("verifytx_vob_id"),
  payerId: text("payer_id"),
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
  context: varchar("context").default("intake"),
  verifiedAt: timestamp("verified_at"),
  organizationId: varchar("organization_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertVobVerificationSchema = createInsertSchema(vobVerifications).omit({ id: true, createdAt: true });
export type InsertVobVerification = z.infer<typeof insertVobVerificationSchema>;
export type VobVerification = typeof vobVerifications.$inferSelect;

export const activityLogs = pgTable("activity_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  leadId: varchar("lead_id"),
  claimId: varchar("claim_id"),
  patientId: varchar("patient_id"),
  activityType: text("activity_type").notNull(),
  field: text("field"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  description: text("description"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  performedBy: text("performed_by"),
  organizationId: varchar("organization_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertActivityLogSchema = createInsertSchema(activityLogs).omit({ id: true, createdAt: true });
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLogs.$inferSelect;

export const organizations = pgTable("organizations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Organization = typeof organizations.$inferSelect;

export const practiceSettings = pgTable("practice_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  practiceName: varchar("practice_name").notNull().default(""),
  primaryNpi: varchar("primary_npi"),
  taxId: varchar("tax_id"),
  taxonomyCode: varchar("taxonomy_code"),
  address: jsonb("address").$type<Record<string, string>>().default({}),
  phone: varchar("phone"),
  defaultPos: varchar("default_pos").default("12"),
  organizationId: varchar("organization_id"),
  frcpbEnrolled: boolean("frcpb_enrolled").default(false),
  frcpbEnrolledAt: timestamp("frcpb_enrolled_at"),
  billingModel: varchar("billing_model").default("direct"),
  agencyNpi: varchar("agency_npi"),
  agencyTaxId: varchar("agency_tax_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPracticeSettingsSchema = createInsertSchema(practiceSettings).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPracticeSettings = z.infer<typeof insertPracticeSettingsSchema>;
export type PracticeSettings = typeof practiceSettings.$inferSelect;

export const providers = pgTable("providers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  firstName: varchar("first_name").notNull(),
  lastName: varchar("last_name").notNull(),
  credentials: varchar("credentials"),
  npi: varchar("npi"),
  taxonomyCode: varchar("taxonomy_code"),
  individualTaxId: varchar("individual_tax_id"),
  licenseNumber: varchar("license_number"),
  entityType: varchar("entity_type").default("individual"),
  providerType: varchar("provider_type").default("rendering"),
  isDefault: boolean("is_default").default(false),
  isActive: boolean("is_active").default(true),
  organizationId: varchar("organization_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertProviderSchema = createInsertSchema(providers).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProvider = z.infer<typeof insertProviderSchema>;
export type Provider = typeof providers.$inferSelect;

export const payers = pgTable("payers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  payerId: varchar("payer_id"),
  timelyFilingDays: integer("timely_filing_days").default(365),
  authRequired: boolean("auth_required").default(false),
  billingType: varchar("billing_type").default("professional"),
  isActive: boolean("is_active").default(true),
  isCustom: boolean("is_custom").default(false),
  payerClassification: varchar("payer_classification", { length: 32 }),
  claimFilingIndicator: varchar("claim_filing_indicator", { length: 2 }),
  payerCategory: varchar("payer_category", { length: 32 }),
  organizationId: varchar("organization_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPayerSchema = createInsertSchema(payers).omit({ id: true, createdAt: true });
export type InsertPayer = z.infer<typeof insertPayerSchema>;
export type Payer = typeof payers.$inferSelect;

export const hcpcsCodes = pgTable("hcpcs_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: varchar("code").notNull().unique(),
  descriptionOfficial: text("description_official").notNull(),
  descriptionPlain: text("description_plain"),
  unitType: varchar("unit_type").notNull(),
  unitIntervalMinutes: integer("unit_interval_minutes"),
  defaultPos: varchar("default_pos").default("12"),
  requiresModifier: boolean("requires_modifier").default(false),
  notes: text("notes"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertHcpcsCodeSchema = createInsertSchema(hcpcsCodes).omit({ id: true, createdAt: true });
export type InsertHcpcsCode = z.infer<typeof insertHcpcsCodeSchema>;
export type HcpcsCode = typeof hcpcsCodes.$inferSelect;

export const hcpcsRates = pgTable("hcpcs_rates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  hcpcsCode: varchar("hcpcs_code").notNull(),
  payerId: varchar("payer_id"),
  payerName: varchar("payer_name").notNull(),
  ratePerUnit: real("rate_per_unit").notNull(),
  unitIntervalMinutes: integer("unit_interval_minutes"),
  effectiveDate: date("effective_date").notNull(),
  endDate: date("end_date"),
  isOverride: boolean("is_override").default(false),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertHcpcsRateSchema = createInsertSchema(hcpcsRates).omit({ id: true, createdAt: true });
export type InsertHcpcsRate = z.infer<typeof insertHcpcsRateSchema>;
export type HcpcsRate = typeof hcpcsRates.$inferSelect;

export const claimTemplates = pgTable("claim_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  providerId: varchar("provider_id"),
  payerId: varchar("payer_id"),
  placeOfService: varchar("place_of_service").default("12"),
  serviceLines: jsonb("service_lines").$type<any[]>(),
  createdBy: varchar("created_by"),
  organizationId: varchar("organization_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertClaimTemplateSchema = createInsertSchema(claimTemplates).omit({ id: true, createdAt: true });
export type InsertClaimTemplate = z.infer<typeof insertClaimTemplateSchema>;
export type ClaimTemplate = typeof claimTemplates.$inferSelect;

/**
 * submission_attempts — audit log of every attempted Stedi claim submission.
 * Written by the submit-stedi route before the Stedi API call is made.
 * Enables Task 6-style retrospective audits without relying on claim_events.
 */
export const submissionAttempts = pgTable("submission_attempts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  claimId: varchar("claim_id").notNull(),
  organizationId: varchar("organization_id"),
  isa15: varchar("isa15", { length: 1 }).notNull(),
  testModeOverride: boolean("test_mode_override").default(false),
  automated: boolean("automated").default(false),
  testDataResult: varchar("test_data_result", { length: 16 }),
  testDataScore: integer("test_data_score"),
  attemptedBy: varchar("attempted_by"),
  attemptedAt: timestamp("attempted_at").defaultNow(),
  blocked: boolean("blocked").default(false),
  blockReason: varchar("block_reason"),
});

export const insertSubmissionAttemptSchema = createInsertSchema(submissionAttempts).omit({ id: true, attemptedAt: true });
export type InsertSubmissionAttempt = z.infer<typeof insertSubmissionAttemptSchema>;
export type SubmissionAttempt = typeof submissionAttempts.$inferSelect;

export const payerManuals = pgTable("payer_manuals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payerId: varchar("payer_id"),
  payerName: varchar("payer_name").notNull(),
  sourceUrl: text("source_url"),
  fileName: varchar("file_name"),
  status: varchar("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  uploadedBy: varchar("uploaded_by"),
  organizationId: varchar("organization_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPayerManualSchema = createInsertSchema(payerManuals).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayerManual = z.infer<typeof insertPayerManualSchema>;
export type PayerManual = typeof payerManuals.$inferSelect;

export const manualExtractionItems = pgTable("manual_extraction_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  manualId: varchar("manual_id").notNull(),
  sectionType: varchar("section_type").notNull(),
  rawSnippet: text("raw_snippet"),
  extractedJson: jsonb("extracted_json").$type<Record<string, unknown>>(),
  confidence: real("confidence"),
  reviewStatus: varchar("review_status").notNull().default("pending"),
  reviewedBy: varchar("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  appliedRuleId: varchar("applied_rule_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertManualExtractionItemSchema = createInsertSchema(manualExtractionItems).omit({ id: true, createdAt: true });
export type InsertManualExtractionItem = z.infer<typeof insertManualExtractionItemSchema>;
export type ManualExtractionItem = typeof manualExtractionItems.$inferSelect;

export const payerManualSources = pgTable("payer_manual_sources", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payerName: varchar("payer_name").notNull(),
  canonicalUrl: text("canonical_url"),
  lastVerifiedDate: date("last_verified_date"),
  notes: text("notes"),
  priority: integer("priority").notNull().default(99),
  linkedManualId: varchar("linked_manual_id"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPayerManualSourceSchema = createInsertSchema(payerManualSources).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayerManualSource = z.infer<typeof insertPayerManualSourceSchema>;
export type PayerManualSource = typeof payerManualSources.$inferSelect;
