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

// Lead status: new, contacted, qualified, unqualified, converted
export const leads = pgTable("leads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  source: text("source").notNull().default("website"),
  status: text("status").notNull().default("new"),
  serviceNeeded: text("service_needed"),
  insuranceCarrier: text("insurance_carrier"),
  memberId: text("member_id"),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertRuleSchema = createInsertSchema(rules).omit({ id: true, createdAt: true, impactCount: true });
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
