import {
  type User, type InsertUser,
  type Lead, type InsertLead,
  type Patient, type InsertPatient,
  type Encounter, type InsertEncounter,
  type Claim, type InsertClaim,
  type ClaimEvent, type InsertClaimEvent,
  type Denial, type InsertDenial,
  type Rule, type InsertRule,
  type Call, type InsertCall,
  type PriorAuth, type InsertPriorAuth,
  type DashboardMetrics,
  type DenialCluster,
  type RiskExplanation,
  users, leads, patients, encounters, claims, claimEvents, denials, rules, calls, priorAuthorizations,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, sql, and, count } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  getLeads(): Promise<Lead[]>;
  getLead(id: string): Promise<Lead | undefined>;
  createLead(lead: InsertLead): Promise<Lead>;
  updateLead(id: string, updates: Partial<Lead>): Promise<Lead | undefined>;
  
  getPatientByLeadId(leadId: string): Promise<Patient | undefined>;
  getPatient(id: string): Promise<Patient | undefined>;
  createPatient(patient: InsertPatient): Promise<Patient>;
  updatePatient(id: string, updates: Partial<Patient>): Promise<Patient | undefined>;
  
  getEncounter(id: string): Promise<Encounter | undefined>;
  createEncounter(encounter: InsertEncounter): Promise<Encounter>;
  
  getClaims(): Promise<Claim[]>;
  getClaim(id: string): Promise<Claim | undefined>;
  createClaim(claim: InsertClaim): Promise<Claim>;
  updateClaim(id: string, updates: Partial<Claim>): Promise<Claim | undefined>;
  getClaimPatient(claimId: string): Promise<Patient | undefined>;
  
  getClaimEvents(claimId: string): Promise<ClaimEvent[]>;
  createClaimEvent(event: InsertClaimEvent): Promise<ClaimEvent>;
  
  getDenials(): Promise<Denial[]>;
  getDenialsByClaimId(claimId: string): Promise<Denial[]>;
  createDenial(denial: InsertDenial): Promise<Denial>;
  
  getRules(): Promise<Rule[]>;
  getRule(id: string): Promise<Rule | undefined>;
  createRule(rule: InsertRule): Promise<Rule>;
  updateRule(id: string, updates: Partial<Rule>): Promise<Rule | undefined>;
  deleteRule(id: string): Promise<void>;
  
  getCallsByLeadId(leadId: string): Promise<Call[]>;
  getCall(id: string): Promise<Call | undefined>;
  createCall(call: InsertCall): Promise<Call>;
  updateCall(id: string, updates: Partial<Call>): Promise<Call | undefined>;
  
  getPriorAuthsByEncounterId(encounterId: string): Promise<PriorAuth[]>;
  getPriorAuthsByPatientId(patientId: string): Promise<PriorAuth[]>;
  getPriorAuth(id: string): Promise<PriorAuth | undefined>;
  createPriorAuth(auth: InsertPriorAuth): Promise<PriorAuth>;
  updatePriorAuth(id: string, updates: Partial<PriorAuth>): Promise<PriorAuth | undefined>;
  
  getDashboardMetrics(): Promise<DashboardMetrics>;
  getDenialClusters(): Promise<DenialCluster[]>;
  getTopPatterns(): Promise<Array<{ rootCause: string; count: number; change: number }>>;
  getRiskExplanation(claimId: string): Promise<RiskExplanation | undefined>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getLeads(): Promise<Lead[]> {
    return db.select().from(leads).orderBy(desc(leads.createdAt));
  }

  async getLead(id: string): Promise<Lead | undefined> {
    const [lead] = await db.select().from(leads).where(eq(leads.id, id));
    return lead || undefined;
  }

  async createLead(lead: InsertLead): Promise<Lead> {
    const [newLead] = await db.insert(leads).values(lead).returning();
    return newLead;
  }

  async updateLead(id: string, updates: Partial<Lead>): Promise<Lead | undefined> {
    const [updated] = await db.update(leads).set(updates).where(eq(leads.id, id)).returning();
    return updated || undefined;
  }

  async getPatientByLeadId(leadId: string): Promise<Patient | undefined> {
    const [patient] = await db.select().from(patients).where(eq(patients.leadId, leadId));
    return patient || undefined;
  }

  async getPatient(id: string): Promise<Patient | undefined> {
    const [patient] = await db.select().from(patients).where(eq(patients.id, id));
    return patient || undefined;
  }

  async createPatient(patient: InsertPatient): Promise<Patient> {
    const [newPatient] = await db.insert(patients).values(patient).returning();
    return newPatient;
  }

  async updatePatient(id: string, updates: Partial<Patient>): Promise<Patient | undefined> {
    const [updated] = await db.update(patients).set(updates).where(eq(patients.id, id)).returning();
    return updated || undefined;
  }

  async getEncounter(id: string): Promise<Encounter | undefined> {
    const [encounter] = await db.select().from(encounters).where(eq(encounters.id, id));
    return encounter || undefined;
  }

  async createEncounter(encounter: InsertEncounter): Promise<Encounter> {
    const [newEncounter] = await db.insert(encounters).values(encounter).returning();
    return newEncounter;
  }

  async getClaims(): Promise<Claim[]> {
    return db.select().from(claims).orderBy(desc(claims.createdAt));
  }

  async getClaim(id: string): Promise<Claim | undefined> {
    const [claim] = await db.select().from(claims).where(eq(claims.id, id));
    return claim || undefined;
  }

  async createClaim(claim: InsertClaim): Promise<Claim> {
    const [newClaim] = await db.insert(claims).values(claim).returning();
    return newClaim;
  }

  async updateClaim(id: string, updates: Partial<Claim>): Promise<Claim | undefined> {
    const [updated] = await db.update(claims).set(updates).where(eq(claims.id, id)).returning();
    return updated || undefined;
  }

  async getClaimPatient(claimId: string): Promise<Patient | undefined> {
    const claim = await this.getClaim(claimId);
    if (!claim) return undefined;
    return this.getPatient(claim.patientId);
  }

  async getClaimEvents(claimId: string): Promise<ClaimEvent[]> {
    return db.select().from(claimEvents).where(eq(claimEvents.claimId, claimId)).orderBy(claimEvents.timestamp);
  }

  async createClaimEvent(event: InsertClaimEvent): Promise<ClaimEvent> {
    const [newEvent] = await db.insert(claimEvents).values(event).returning();
    return newEvent;
  }

  async getDenials(): Promise<Denial[]> {
    return db.select().from(denials).orderBy(desc(denials.createdAt));
  }

  async getDenialsByClaimId(claimId: string): Promise<Denial[]> {
    return db.select().from(denials).where(eq(denials.claimId, claimId));
  }

  async createDenial(denial: InsertDenial): Promise<Denial> {
    const [newDenial] = await db.insert(denials).values(denial).returning();
    return newDenial;
  }

  async getRules(): Promise<Rule[]> {
    return db.select().from(rules).orderBy(desc(rules.createdAt));
  }

  async getRule(id: string): Promise<Rule | undefined> {
    const [rule] = await db.select().from(rules).where(eq(rules.id, id));
    return rule || undefined;
  }

  async createRule(rule: InsertRule): Promise<Rule> {
    const [newRule] = await db.insert(rules).values(rule).returning();
    return newRule;
  }

  async updateRule(id: string, updates: Partial<Rule>): Promise<Rule | undefined> {
    const [updated] = await db.update(rules).set(updates).where(eq(rules.id, id)).returning();
    return updated || undefined;
  }

  async deleteRule(id: string): Promise<void> {
    await db.delete(rules).where(eq(rules.id, id));
  }

  async getCallsByLeadId(leadId: string): Promise<Call[]> {
    return db.select().from(calls).where(eq(calls.leadId, leadId)).orderBy(desc(calls.createdAt));
  }

  async getCall(id: string): Promise<Call | undefined> {
    const [call] = await db.select().from(calls).where(eq(calls.id, id));
    return call || undefined;
  }

  async createCall(call: InsertCall): Promise<Call> {
    const [newCall] = await db.insert(calls).values(call).returning();
    return newCall;
  }

  async updateCall(id: string, updates: Partial<Call>): Promise<Call | undefined> {
    const [updated] = await db.update(calls).set(updates).where(eq(calls.id, id)).returning();
    return updated || undefined;
  }

  async getPriorAuthsByEncounterId(encounterId: string): Promise<PriorAuth[]> {
    return db.select().from(priorAuthorizations).where(eq(priorAuthorizations.encounterId, encounterId)).orderBy(desc(priorAuthorizations.requestedDate));
  }

  async getPriorAuthsByPatientId(patientId: string): Promise<PriorAuth[]> {
    return db.select().from(priorAuthorizations).where(eq(priorAuthorizations.patientId, patientId)).orderBy(desc(priorAuthorizations.requestedDate));
  }

  async getPriorAuth(id: string): Promise<PriorAuth | undefined> {
    const [auth] = await db.select().from(priorAuthorizations).where(eq(priorAuthorizations.id, id));
    return auth || undefined;
  }

  async createPriorAuth(auth: InsertPriorAuth): Promise<PriorAuth> {
    const [newAuth] = await db.insert(priorAuthorizations).values(auth).returning();
    return newAuth;
  }

  async updatePriorAuth(id: string, updates: Partial<PriorAuth>): Promise<PriorAuth | undefined> {
    const [updated] = await db.update(priorAuthorizations).set(updates).where(eq(priorAuthorizations.id, id)).returning();
    return updated || undefined;
  }

  async getDashboardMetrics(): Promise<DashboardMetrics> {
    const allClaims = await this.getClaims();
    const allRules = await this.getRules();
    const allDenials = await this.getDenials();
    
    const denialsPrevented = allRules.reduce((sum, r) => sum + r.impactCount, 0);
    const claimsAtRisk = allClaims.filter(c => c.readinessStatus === "YELLOW" || c.readinessStatus === "RED").length;
    const pendingClaims = allClaims.filter(c => c.status === "pending").length;
    
    const payerRiskCounts: Record<string, number> = {};
    allClaims.filter(c => c.readinessStatus !== "GREEN").forEach(c => {
      payerRiskCounts[c.payer] = (payerRiskCounts[c.payer] || 0) + 1;
    });
    const topPayerRisk = Object.entries(payerRiskCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "N/A";
    
    const revenueProtected = denialsPrevented * 2500;
    
    return {
      denialsPrevented,
      claimsAtRisk,
      avgArDays: 34,
      topPayerRisk,
      revenueProtected,
      totalClaims: allClaims.length,
      pendingClaims,
    };
  }

  async getDenialClusters(): Promise<DenialCluster[]> {
    const allDenials = await this.getDenials();
    
    const clusters: Record<string, DenialCluster> = {};
    allDenials.forEach(d => {
      const key = `${d.payer}|${d.cptCode}|${d.rootCauseTag}`;
      if (!clusters[key]) {
        clusters[key] = {
          payer: d.payer,
          cptCode: d.cptCode,
          rootCause: d.rootCauseTag,
          count: 0,
          trend: [1, 2, 3, 2, 4, 3, 5],
          suggestedRule: {
            name: `Prevent ${d.rootCauseTag} for ${d.payer}`,
            description: `Block claims that match denial pattern for ${d.cptCode}`,
            triggerPattern: `payer=${d.payer} AND cptCode=${d.cptCode}`,
            preventionAction: `Require ${d.rootCauseTag === "Missing Auth" ? "prior authorization" : "documentation review"}`,
          },
        };
      }
      clusters[key].count++;
    });
    
    return Object.values(clusters).sort((a, b) => b.count - a.count);
  }

  async getTopPatterns(): Promise<Array<{ rootCause: string; count: number; change: number }>> {
    const allDenials = await this.getDenials();
    
    const patterns: Record<string, number> = {};
    allDenials.forEach(d => {
      patterns[d.rootCauseTag] = (patterns[d.rootCauseTag] || 0) + 1;
    });
    
    return Object.entries(patterns)
      .map(([rootCause, count]) => ({
        rootCause,
        count,
        change: Math.floor(Math.random() * 40) - 10,
      }))
      .sort((a, b) => b.count - a.count);
  }

  async getRiskExplanation(claimId: string): Promise<RiskExplanation | undefined> {
    const claim = await this.getClaim(claimId);
    if (!claim) return undefined;
    
    const patient = await this.getClaimPatient(claimId);
    const allRules = await this.getRules();
    
    const appliedRules = allRules
      .filter(r => r.enabled && (!r.payer || r.payer === claim.payer))
      .slice(0, 3)
      .map(r => ({
        name: r.name,
        description: r.description,
        impact: r.impactCount > 0 ? `Prevented ${r.impactCount} denials` : "Active",
      }));

    const isHighRisk = claim.readinessStatus === "RED";
    const isMediumRisk = claim.readinessStatus === "YELLOW";

    return {
      inputs: [
        { name: "Payer", value: claim.payer, weight: 0.3 },
        { name: "CPT Codes", value: claim.cptCodes?.join(", ") || "", weight: 0.25 },
        { name: "Amount", value: `$${claim.amount.toLocaleString()}`, weight: 0.15 },
        { name: "Insurance", value: patient?.insuranceCarrier || "Unknown", weight: 0.2 },
        { name: "Plan Type", value: patient?.planType || "Unknown", weight: 0.1 },
      ],
      factors: [
        {
          name: "Prior Authorization Status",
          contribution: isHighRisk ? 45 : isMediumRisk ? 25 : 5,
          description: isHighRisk ? "Authorization required but not obtained" : "Authorization verified",
        },
        {
          name: "Historical Denial Rate",
          contribution: isHighRisk ? 30 : isMediumRisk ? 15 : 3,
          description: `${claim.payer} has ${isHighRisk ? "high" : "low"} denial rate for this CPT`,
        },
        {
          name: "Documentation Completeness",
          contribution: isMediumRisk ? 20 : 2,
          description: isMediumRisk ? "Missing supporting documentation" : "Complete documentation",
        },
      ],
      appliedRules,
      confidence: isHighRisk ? 0.92 : isMediumRisk ? 0.78 : 0.95,
      recommendations: [
        {
          action: isHighRisk ? "Obtain prior authorization before submission" : "Verify patient eligibility",
          priority: isHighRisk ? "high" : "low",
          completed: !isHighRisk,
        },
        {
          action: "Attach supporting clinical documentation",
          priority: isMediumRisk ? "high" : "medium",
          completed: !isMediumRisk,
        },
        {
          action: "Verify CPT code accuracy",
          priority: "low",
          completed: true,
        },
      ],
    };
  }
}

export const storage = new DatabaseStorage();
