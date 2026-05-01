import type { Express } from "express";
import type { Server } from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { resolveISA15, isAutomatedContext } from "./lib/environment";
import { looksLikeTestData } from "./lib/test-data-detector";
import { storage } from "./storage";
import { requireAuth, requireRole, requireSuperAdmin } from "./auth";
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
import { triggerMatchingFlows } from "./services/flow-trigger";
import { advanceToNextStep } from "./services/flow-step-executor";
import { releaseLock, acquireLock } from "./services/comm-locks";
import { extractInsuranceFromTranscript } from "./services/transcript-extractor";
import { getActivatedFieldsForContext, invalidateResolverCache } from "./services/field-resolver";
import { serializeDiagnosisPointer } from "./services/edi-generator";

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

function getOrgId(req: any): string | null {
  const user = req.user as any;
  if (!user) return null;
  if (user.role === "super_admin") {
    return req.session?.impersonatingOrgId || null;
  }
  return user.organization_id || null;
}

// Delegates to serializeDiagnosisPointer — the single source of truth in edi-generator.ts.
// All generate837P call sites must use this wrapper to ensure A2-compliant serialization.
function diagPointerToNumeric(ptr: string): string {
  return serializeDiagnosisPointer(ptr);
}

function verifyOrg(entity: any, req: any): boolean {
  if (!entity) return true;
  const orgId = getOrgId(req);
  // No org context means super_admin is NOT impersonating — deny access to org-scoped data.
  // Super admins must impersonate an org to access its data through regular endpoints.
  if (!orgId) return false;
  const entityOrgId = entity.organizationId || entity.organization_id;
  return entityOrgId === orgId;
}

// Returns orgId or sends 400 and returns null — use at the top of any list endpoint.
function requireOrgCtx(req: any, res: any): string | null {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(400).json({ error: "No organization context. Please select an organization to manage." });
    return null;
  }
  return orgId;
}

async function _autoArchiveDemoPatients(db: any, orgId: string, triggeredBy: string): Promise<void> {
  try {
    const { rows: realCount } = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM patients WHERE organization_id = $1 AND is_demo = FALSE AND archived_at IS NULL`,
      [orgId]
    );
    if ((realCount[0]?.cnt ?? 0) >= 5) {
      await db.query(
        `UPDATE patients
         SET archived_at = NOW(), archived_by = 'system', archive_reason = 'auto-archived after onboarding milestone'
         WHERE organization_id = $1 AND is_demo = TRUE AND archived_at IS NULL`,
        [orgId]
      );
    }
  } catch (e: any) {
    console.error('[autoArchiveDemo] error:', e.message);
  }
}

export async function registerRoutes(server: Server, app: Express): Promise<void> {

  try {
    const { pool } = await import("./db");

    console.log("[SEEDER] Starting startup schema seeder…");

    // Helper: check whether a table or column exists, log result, return boolean.
    // Used to emit "applied" vs "already present" log lines for high-drift-risk objects.
    const seederLog = async (type: 'table' | 'column', table: string, column?: string): Promise<boolean> => {
      let exists = false;
      if (type === 'table') {
        const { rows } = await pool.query(
          `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
          [table]
        );
        exists = rows.length > 0;
        console.log(`[SEEDER] table ${table}: ${exists ? 'already present' : 'creating'}`);
      } else {
        const { rows } = await pool.query(
          `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
          [table, column!]
        );
        exists = rows.length > 0;
        console.log(`[SEEDER] column ${table}.${column}: ${exists ? 'already present' : 'adding'}`);
      }
      return exists;
    };

    // Core multi-tenancy columns — must run before any seed or login query
    // Ensure organizations table exists first (other tables may FK or reference it)
    await pool.query(`CREATE TABLE IF NOT EXISTS organizations (
      id VARCHAR PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      onboarding_dismissed_at TIMESTAMP
    )`);
    // Add organization_id to every org-scoped table (idempotent; safe on fresh and old DBs)
    const orgScopedTables = [
      "users", "leads", "patients", "encounters", "claims", "claim_events",
      "denials", "rules", "calls", "prior_authorizations", "email_templates",
      "nurture_sequences", "email_logs", "availability_slots", "appointments",
      "chat_sessions", "chat_messages", "chat_analytics", "vob_verifications",
      "activity_logs", "providers", "practice_settings", "claim_templates"
    ];
    for (const t of orgScopedTables) {
      await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS organization_id VARCHAR`).catch(() => {});
    }
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR`);
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS billing_location VARCHAR`);
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS oa_submitter_id VARCHAR`);
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS oa_sftp_username VARCHAR`);
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS oa_sftp_password VARCHAR`);
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS oa_connected BOOLEAN DEFAULT false`);
    await seederLog('column', 'practice_settings', 'frcpb_enrolled');
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS frcpb_enrolled BOOLEAN DEFAULT false`);
    await seederLog('column', 'practice_settings', 'frcpb_enrolled_at');
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS frcpb_enrolled_at TIMESTAMP`);
    // Sprint-2 schema additions
    await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_dismissed_at TIMESTAMP`);
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS default_tos VARCHAR`);
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS default_ordering_provider_id VARCHAR`);
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS homebound_default BOOLEAN DEFAULT true`);
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS exclude_facility BOOLEAN DEFAULT true`);
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS entity_type VARCHAR DEFAULT 'individual'`);
    await pool.query(`ALTER TABLE payers ADD COLUMN IF NOT EXISTS auto_followup_days INTEGER DEFAULT 30`);
    await pool.query(`ALTER TABLE payers ADD COLUMN IF NOT EXISTS era_auto_post_clean BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE payers ADD COLUMN IF NOT EXISTS era_auto_post_contractual BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE payers ADD COLUMN IF NOT EXISTS era_auto_post_secondary BOOLEAN DEFAULT true`);
    await pool.query(`ALTER TABLE payers ADD COLUMN IF NOT EXISTS era_auto_post_refunds BOOLEAN DEFAULT true`);
    await pool.query(`ALTER TABLE payers ADD COLUMN IF NOT EXISTS era_hold_if_mismatch BOOLEAN DEFAULT true`);
    await pool.query(`UPDATE payers SET era_auto_post_clean = true, era_auto_post_contractual = true WHERE payer_id IN ('VACCN', 'TWVACCN') AND (era_auto_post_clean = false OR era_auto_post_clean IS NULL)`);

    // Class A: Explicit payer classification columns (replaces name-string heuristics)
    await pool.query(`ALTER TABLE payers ADD COLUMN IF NOT EXISTS payer_classification VARCHAR(32)`);
    await pool.query(`ALTER TABLE payers ADD COLUMN IF NOT EXISTS claim_filing_indicator VARCHAR(2)`);
    // Backfill: explicit payer_id first (most reliable), then name-based one-time migration
    await pool.query(`UPDATE payers SET payer_classification='va_community_care', claim_filing_indicator='CH' WHERE payer_id='TWVACCN' AND payer_classification IS NULL`);
    await pool.query(`UPDATE payers SET payer_classification='tricare', claim_filing_indicator='CH' WHERE (LOWER(name) LIKE '%tricare%' OR LOWER(name) LIKE '%champva%') AND payer_classification IS NULL`);
    await pool.query(`UPDATE payers SET payer_classification='medicare_advantage', claim_filing_indicator='HM' WHERE (LOWER(name) LIKE '%medicare advantage%' OR LOWER(name) LIKE '%aarp medicare%' OR LOWER(name) LIKE '%medicare complete%') AND payer_classification IS NULL`);
    await pool.query(`UPDATE payers SET payer_classification='medicare_part_b', claim_filing_indicator='MB' WHERE LOWER(name) LIKE '%medicare%' AND payer_classification IS NULL`);
    await pool.query(`UPDATE payers SET payer_classification='medicaid', claim_filing_indicator='MC' WHERE LOWER(name) LIKE '%medicaid%' AND payer_classification IS NULL`);
    await pool.query(`UPDATE payers SET payer_classification='bcbs', claim_filing_indicator='BL' WHERE (LOWER(name) LIKE '%blue cross%' OR LOWER(name) LIKE '%blue shield%' OR LOWER(name) LIKE '%bcbs%') AND payer_classification IS NULL`);
    await pool.query(`UPDATE payers SET payer_classification='commercial', claim_filing_indicator='CI' WHERE payer_classification IS NULL`);
    // Fix any rows written by prior runs of this migration that used now-retired value names
    await pool.query(`UPDATE payers SET payer_classification='medicaid' WHERE payer_classification='medicaid_state'`);
    await pool.query(`UPDATE payers SET payer_classification='commercial' WHERE payer_classification='commercial_ppo'`);
    await pool.query(`UPDATE payers SET claim_filing_indicator='HM' WHERE payer_classification='medicare_advantage' AND claim_filing_indicator='16'`);

    // Class C: FK constraints for tenant-scoped tables (orphan-safe — verified 0 orphans in prod)
    await pool.query(`DO $$ BEGIN ALTER TABLE providers ADD CONSTRAINT providers_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$`);
    await pool.query(`DO $$ BEGIN ALTER TABLE claims ADD CONSTRAINT claims_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$`);
    await pool.query(`DO $$ BEGIN ALTER TABLE patients ADD CONSTRAINT patients_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$`);
    await pool.query(`DO $$ BEGIN ALTER TABLE practice_settings ADD CONSTRAINT practice_settings_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$`);
    await pool.query(`DO $$ BEGIN ALTER TABLE users ADD CONSTRAINT users_org_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT; EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END $$`);

    // Sprint-3 schema additions
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP`);
    // Secondary insurance / COB
    await pool.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_payer_id VARCHAR`);
    await pool.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_member_id VARCHAR`);
    await pool.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_group_number VARCHAR`);
    await pool.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_plan_name VARCHAR`);
    await pool.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_relationship VARCHAR DEFAULT 'self'`);
    // Rules specialty tags
    await pool.query(`ALTER TABLE rules ADD COLUMN IF NOT EXISTS specialty_tags TEXT[] DEFAULT '{}'`);
    await pool.query(`UPDATE rules SET specialty_tags = ARRAY['VA Community Care'] WHERE (name ILIKE '%VA%' OR description ILIKE '%VA%' OR name ILIKE '%TriWest%' OR description ILIKE '%TriWest%') AND specialty_tags = '{}'`);
    await pool.query(`UPDATE rules SET specialty_tags = ARRAY['Medicare'] WHERE (name ILIKE '%Medicare%' OR description ILIKE '%Medicare%' OR name ILIKE '%ABN%' OR description ILIKE '%NCCI%') AND specialty_tags = '{}'`);
    await pool.query(`UPDATE rules SET specialty_tags = ARRAY['Home Health'] WHERE (name ILIKE '%home health%' OR description ILIKE '%home health%' OR description ILIKE '%homebound%' OR description ILIKE '%POS 12%') AND specialty_tags = '{}'`);
    await pool.query(`UPDATE rules SET specialty_tags = ARRAY['Behavioral Health'] WHERE (name ILIKE '%mental health%' OR description ILIKE '%behavioral%' OR description ILIKE '%substance abuse%') AND specialty_tags = '{}'`);
    await pool.query(`UPDATE rules SET specialty_tags = ARRAY['Medicaid'] WHERE (name ILIKE '%Medicaid%' OR description ILIKE '%Medicaid%' OR description ILIKE '%CHIP%') AND specialty_tags = '{}'`);
    await pool.query(`UPDATE rules SET specialty_tags = ARRAY['Universal'] WHERE specialty_tags = '{}'`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS denial_patterns (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        claim_id VARCHAR,
        carc_code VARCHAR(10) NOT NULL,
        carc_description TEXT,
        rarc_code VARCHAR(10),
        amount DECIMAL(10,2),
        service_date DATE,
        hcpcs_code VARCHAR(10),
        payer VARCHAR,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_denial_patterns_carc ON denial_patterns(carc_code)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_denial_patterns_created_at ON denial_patterns(created_at)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS va_location_rates (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        hcpcs_code VARCHAR(6) NOT NULL,
        location_name VARCHAR NOT NULL,
        carrier VARCHAR(10),
        locality_code VARCHAR(5),
        facility_rate DECIMAL(10,4),
        non_facility_rate DECIMAL(10,4),
        effective_date DATE DEFAULT '2026-01-01',
        is_non_reimbursable BOOLEAN DEFAULT false,
        last_updated TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(hcpcs_code, location_name, carrier, locality_code)
      )
    `);

    const { rows: vaCount } = await pool.query("SELECT COUNT(*)::int as cnt FROM va_location_rates");
    if (vaCount[0]?.cnt === 0) {
      const sqlPaths = [
        path.join(process.cwd(), "server", "va_location_rates.sql"),
        path.join(process.cwd(), "attached_assets", "va_location_rates_2026_1775596189787.sql"),
        path.join(__dirname, "va_location_rates.sql"),
      ];
      for (const sqlPath of sqlPaths) {
        try {
          if (fs.existsSync(sqlPath)) {
            const sql = fs.readFileSync(sqlPath, "utf-8");
            const insertMatch = sql.match(/INSERT INTO va_location_rates[\s\S]+/);
            if (insertMatch) {
              await pool.query(insertMatch[0]);
              console.log(`Imported VA location rates from ${sqlPath}`);
              break;
            }
          }
        } catch (e: any) {
          console.log(`VA rates import attempt failed for ${sqlPath}: ${e.message}`);
        }
      }
    }

    await pool.query(`
      UPDATE claims SET
        reason = d.denial_reason_text,
        next_step = CASE 
          WHEN d.denial_category = 'Coverage' THEN 'Verify coverage and resubmit with correct plan info'
          WHEN d.denial_category = 'Authorization' THEN 'Obtain prior authorization and submit appeal'
          WHEN d.denial_category = 'Coding' THEN 'Review coding, correct errors, and resubmit'
          WHEN d.denial_category = 'Medical Necessity' THEN 'Gather clinical documentation and file appeal'
          WHEN d.denial_category = 'Timely Filing' THEN 'File appeal with proof of timely submission'
          ELSE 'Review denial reason and determine appeal strategy'
        END
      FROM denials d
      WHERE claims.id = d.claim_id
        AND claims.status IN ('denied', 'appealed')
        AND claims.reason IS NULL
    `);

    await pool.query(`
      INSERT INTO practice_settings (id, practice_name, primary_npi, tax_id, taxonomy_code, phone, default_pos, billing_location, created_at, updated_at)
      SELECT gen_random_uuid()::text, 'ClaimShield Demo Practice', '1234567893', '123456789', '251B00000X', '512-555-0100', '12', 'AUSTIN', NOW(), NOW()
      WHERE NOT EXISTS (SELECT 1 FROM practice_settings LIMIT 1)
    `);

    await pool.query(`
      UPDATE providers SET
        credentials = CASE WHEN credentials IS NULL OR credentials = '' THEN 'RN' ELSE credentials END,
        taxonomy_code = CASE WHEN taxonomy_code IS NULL OR taxonomy_code = '' THEN '163W00000X' ELSE taxonomy_code END
      WHERE credentials IS NULL OR credentials = '' OR taxonomy_code IS NULL OR taxonomy_code = ''
    `);

    await pool.query(`
      UPDATE hcpcs_rates SET rate_per_unit = 40.89, effective_date = '2026-01-01' WHERE hcpcs_code = 'G0299' AND payer_name = 'VA Community Care' AND effective_date < '2026-01-01';
      UPDATE hcpcs_rates SET rate_per_unit = 30.67, effective_date = '2026-01-01' WHERE hcpcs_code = 'G0300' AND payer_name = 'VA Community Care' AND effective_date < '2026-01-01';
      UPDATE hcpcs_rates SET rate_per_unit = 36.47, effective_date = '2026-01-01' WHERE hcpcs_code = 'G0151' AND payer_name = 'VA Community Care' AND effective_date < '2026-01-01';
      UPDATE hcpcs_rates SET rate_per_unit = 36.72, effective_date = '2026-01-01' WHERE hcpcs_code = 'G0152' AND payer_name = 'VA Community Care' AND effective_date < '2026-01-01';
      UPDATE hcpcs_rates SET rate_per_unit = 39.63, effective_date = '2026-01-01' WHERE hcpcs_code = 'G0153' AND payer_name = 'VA Community Care' AND effective_date < '2026-01-01';
      UPDATE hcpcs_rates SET rate_per_unit = 9.67, effective_date = '2026-01-01' WHERE hcpcs_code = 'G0156' AND payer_name = 'VA Community Care' AND effective_date < '2026-01-01';
      UPDATE hcpcs_rates SET rate_per_unit = 60.00, effective_date = '2026-01-01' WHERE hcpcs_code = 'S9123' AND payer_name = 'VA Community Care' AND effective_date < '2026-01-01';
      UPDATE hcpcs_rates SET rate_per_unit = 45.00, effective_date = '2026-01-01' WHERE hcpcs_code = 'S9124' AND payer_name = 'VA Community Care' AND effective_date < '2026-01-01';
      UPDATE hcpcs_rates SET rate_per_unit = 4.73, effective_date = '2026-01-01' WHERE hcpcs_code = 'T1019' AND payer_name = 'VA Community Care' AND effective_date < '2026-01-01';
      INSERT INTO hcpcs_rates (id, hcpcs_code, payer_name, rate_per_unit, effective_date, created_at)
        SELECT gen_random_uuid()::text, 'G0154', 'VA Community Care', 30.67, '2026-01-01', NOW()
        WHERE NOT EXISTS (SELECT 1 FROM hcpcs_rates WHERE hcpcs_code = 'G0154' AND payer_name = 'VA Community Care');
      INSERT INTO hcpcs_rates (id, hcpcs_code, payer_name, rate_per_unit, effective_date, created_at)
        SELECT gen_random_uuid()::text, 'G0155', 'VA Community Care', 38.00, '2026-01-01', NOW()
        WHERE NOT EXISTS (SELECT 1 FROM hcpcs_rates WHERE hcpcs_code = 'G0155' AND payer_name = 'VA Community Care');
    `);

    await pool.query(`
      DELETE FROM rules
      WHERE name LIKE '%Invalid Coding%'
      AND id NOT IN (
        SELECT id FROM rules WHERE name LIKE '%Invalid Coding%' ORDER BY created_at ASC LIMIT 1
      )
    `);

    const { rows: vaRuleCheck } = await pool.query("SELECT COUNT(*)::int as cnt FROM rules WHERE name LIKE 'VA:%'");
    if (vaRuleCheck[0]?.cnt === 0) {
      await pool.query("DELETE FROM rules WHERE name LIKE 'Prevent%' OR name LIKE 'Check%'");
      const dupNames = ['Aetna COB Verification','BCBS Timely Filing - 90 Days','Cigna Bundling - PT Services',
        'Duplicate Claim Detection','Humana Eligibility - Monthly Check','Kaiser Referral Required',
        'Medicare Medical Necessity - E/M Codes','UHC Prior Auth - Behavioral Health'];
      for (const n of dupNames) {
        await pool.query(`DELETE FROM rules WHERE name = $1 AND id NOT IN (SELECT id FROM rules WHERE name = $1 ORDER BY created_at ASC LIMIT 1)`, [n]);
      }
      await pool.query(`INSERT INTO rules (id, name, description, trigger_pattern, prevention_action, payer, enabled, created_at) VALUES
        (gen_random_uuid()::text, 'VA: Missing or Invalid Member ICN/SSN', 'VA requires the 17-character Internal Control Number (10 digits + V + 6 digits) or 9-digit SSN with no special characters in the Member ID field. This is the #1 VA rejection reason.', 'member_id_format', 'block', 'VA Community Care', true, NOW()),
        (gen_random_uuid()::text, 'VA: Invalid or Missing Rendering Provider NPI', 'The rendering provider NPI must be a valid 10-digit NPI that passes Luhn checksum validation and is enrolled with the VA Community Care Network.', 'rendering_npi', 'block', 'VA Community Care', true, NOW()),
        (gen_random_uuid()::text, 'VA: Invalid Place of Service Code', 'VA home health claims must use Place of Service 12 (Home). Using an incorrect POS code is a top-10 VA rejection reason.', 'place_of_service', 'warn', 'VA Community Care', true, NOW()),
        (gen_random_uuid()::text, 'VA: Unrecognized HCPCS/CPT Code', 'All procedure codes must be valid HCPCS Level II or CPT codes. VA will reject claims with invalid or discontinued codes.', 'procedure_code_validity', 'block', 'VA Community Care', true, NOW()),
        (gen_random_uuid()::text, 'VA: Missing Provider Taxonomy Code', 'VA requires a valid taxonomy code on the service line provider. Home health RN taxonomy is 163W00000X.', 'provider_taxonomy', 'warn', 'VA Community Care', true, NOW()),
        (gen_random_uuid()::text, 'VA: ICD-9 Diagnosis Code Used Instead of ICD-10', 'VA requires ICD-10-CM codes for all dates of service after 09/30/2015. ICD-9 codes will be rejected immediately.', 'diagnosis_code_version', 'block', 'VA Community Care', true, NOW()),
        (gen_random_uuid()::text, 'VA: Timely Filing Limit Approaching (180 Days)', 'VA Community Care Network requires claims within 180 days of service date. After 180 days, claims cannot be paid or appealed.', 'timely_filing', 'warn', 'VA Community Care', true, NOW()),
        (gen_random_uuid()::text, 'VA: Timely Filing Limit Exceeded (180 Days)', 'Claim is past the 180-day VA timely filing deadline. VA will reject this claim and it is nearly impossible to appeal successfully.', 'timely_filing_exceeded', 'block', 'VA Community Care', true, NOW()),
        (gen_random_uuid()::text, 'VA: Missing Authorization Number', 'All VA Community Care claims require a pre-authorization/referral number issued by the VA or Optum/TriWest. Claims without auth numbers will be denied.', 'authorization_required', 'block', 'VA Community Care', true, NOW()),
        (gen_random_uuid()::text, 'VA: Authorization Number Format Invalid', 'VA authorization numbers follow a specific format. Invalid auth numbers result in denial even if care was authorized.', 'authorization_format', 'warn', 'VA Community Care', true, NOW()),
        (gen_random_uuid()::text, 'CARC CO-29: Timely Filing — Medicare (365 Days)', 'Medicare requires claims within 365 days of service date. Missing this window results in CO-29 denial with no appeal path.', 'medicare_timely_filing', 'warn', 'Medicare', true, NOW()),
        (gen_random_uuid()::text, 'CARC CO-97: Service Already Included in Another Code (NCCI Bundling)', 'Billing two codes where one is included in the other per CCI edits. Common home health example: billing G0299 and a separate E&M visit on same date without modifier.', 'ncci_bundling', 'warn', 'All', true, NOW()),
        (gen_random_uuid()::text, 'CARC CO-16: Claim Missing Required Information', 'CO-16 is the most frequently issued CARC. Triggered by missing NPI, missing auth number, missing diagnosis pointer, or invalid dates.', 'missing_required_fields', 'block', 'All', true, NOW()),
        (gen_random_uuid()::text, 'CARC CO-4: Modifier Required or Inconsistent with Procedure', 'Certain timed home health codes require modifiers (e.g., modifier GT for telehealth, modifier 59 for distinct service). Missing or wrong modifier causes CO-4 denial.', 'modifier_required', 'warn', 'All', true, NOW()),
        (gen_random_uuid()::text, 'CARC CO-50: Service Not Medically Necessary', 'Payer determined the service does not meet medical necessity criteria for the diagnosis billed. Ensure ICD-10 diagnosis supports the home health service provided.', 'medical_necessity', 'warn', 'All', false, NOW()),
        (gen_random_uuid()::text, 'Duplicate Claim: Same Patient, Service Date, and Code', 'A claim with the same patient, service date, and procedure code was already submitted. Duplicate claims result in CO-18 or VA rejection code 65 denial.', 'duplicate_claim', 'block', 'All', true, NOW()),
        (gen_random_uuid()::text, 'VA: G0299 Units May Exceed Authorized Hours', 'G0299 billed in 15-minute units. Verify that total units billed do not exceed the hours authorized on the VA referral.', 'va_unit_authorization_check', 'warn', 'VA Community Care', true, NOW()),
        (gen_random_uuid()::text, 'Missing ICD-10 Diagnosis Pointer on Service Line', 'Each service line must have a diagnosis pointer linking it to one of the listed ICD-10 codes (A, B, C, or D). Missing pointer causes CO-16 with RARC N286.', 'diagnosis_pointer', 'warn', 'All', true, NOW()),
        (gen_random_uuid()::text, 'VA: Home Health Code Requires Place of Service 12', 'G0299, G0300, G0151, G0152, G0153, G0156, T1019 must be billed with Place of Service 12 (Home). Using any other POS for these codes will result in denial.', 'home_health_pos_mismatch', 'block', 'All', true, NOW()),
        (gen_random_uuid()::text, 'Provider Not Credentialed with Payer', 'Rendering provider must be credentialed and contracted with the payer. Uncredentialed providers result in immediate denial.', 'provider_credentialing', 'warn', 'All', false, NOW()),
        (gen_random_uuid()::text, 'CARC CO-29: Medicare Timely Filing Exceeded (365 Days)', 'Claim is past the 365-day Medicare timely filing limit. CO-29 denial cannot be appealed except in cases of administrative error by a Medicare agent.', 'medicare_timely_exceeded', 'block', 'Medicare', true, NOW()),
        (gen_random_uuid()::text, 'COB: VA Secondary Payer Requires Primary EOB', 'When VA is secondary payer, the primary insurance EOB must be attached. VA will reject as code 78 without the primary payer EOB.', 'cob_primary_eob_required', 'warn', 'VA Community Care', true, NOW())
      `);
      console.log("Seeded 22 VA/CARC prevention rules");
    }

    const DEMO_ORG_ID = "demo-org-001";
    const { rows: orgCheck } = await pool.query("SELECT id FROM organizations WHERE id = $1", [DEMO_ORG_ID]);
    if (orgCheck.length === 0) {
      await pool.query(
        "INSERT INTO organizations (id, name, created_at) VALUES ($1, 'ClaimShield Demo Practice', NOW())",
        [DEMO_ORG_ID]
      );
      console.log("Created Demo Organization");
    }

    const orgTables = [
      "users", "leads", "patients", "encounters", "claims", "claim_events",
      "denials", "rules", "calls", "prior_authorizations", "email_templates",
      "nurture_sequences", "email_logs", "availability_slots", "appointments",
      "chat_sessions", "chat_messages", "chat_analytics", "vob_verifications",
      "activity_logs", "providers", "practice_settings", "claim_templates"
    ];
    for (const t of orgTables) {
      try {
        await pool.query(`UPDATE ${t} SET organization_id = $1 WHERE organization_id IS NULL`, [DEMO_ORG_ID]);
      } catch (e: any) {}
    }
    console.log("Assigned existing data to demo organization");

    // ── Super Admin user seed ─────────────────────────────────────────────
    {
      const { hashPassword } = await import("./auth");
      const { rows: saCheck } = await pool.query("SELECT id FROM users WHERE email = 'abeer@tekrevol.com'");
      if (saCheck.length === 0) {
        // First-time creation: use SUPER_ADMIN_PASSWORD env var or fallback default
        const superPwd = process.env.SUPER_ADMIN_PASSWORD || 'Apps@1986N';
        const hashed = await hashPassword(superPwd);
        await pool.query(
          "INSERT INTO users (id, email, password, role, name, organization_id) VALUES (gen_random_uuid()::text, 'abeer@tekrevol.com', $1, 'super_admin', 'Abeer (Platform Admin)', NULL)",
          [hashed]
        );
        console.log("Created super_admin user: abeer@tekrevol.com");
      } else if (process.env.SUPER_ADMIN_PASSWORD) {
        // Only reset password if explicitly configured via env var — never overwrite a manually-set password
        const hashed = await hashPassword(process.env.SUPER_ADMIN_PASSWORD);
        await pool.query("UPDATE users SET password = $1, role = 'super_admin' WHERE email = 'abeer@tekrevol.com'", [hashed]);
        console.log("Synced super_admin password from SUPER_ADMIN_PASSWORD env var: abeer@tekrevol.com");
      } else {
        // User exists, no env var set — leave password untouched
        await pool.query("UPDATE users SET role = 'super_admin' WHERE email = 'abeer@tekrevol.com'");
        console.log("super_admin role confirmed: abeer@tekrevol.com (password unchanged)");
      }
    }

    // ── Chajinel Clinic org seed ──────────────────────────────────────────
    {
      const CHAJINEL_ORG_ID = "chajinel-org-001";
      const { rows: chCheck } = await pool.query("SELECT id FROM organizations WHERE id = $1", [CHAJINEL_ORG_ID]);
      if (chCheck.length === 0) {
        await pool.query(
          "INSERT INTO organizations (id, name, created_at) VALUES ($1, 'Chajinel Clinic', NOW())",
          [CHAJINEL_ORG_ID]
        );
        // Practice settings seed
        await pool.query(
          `INSERT INTO practice_settings (id, organization_id, practice_name, default_pos, homebound_default, exclude_facility, created_at, updated_at)
           VALUES (gen_random_uuid()::text, $1, 'Chajinel Clinic', '12', true, true, NOW(), NOW())`,
          [CHAJINEL_ORG_ID]
        );
        console.log("Created Chajinel Clinic organization");
      }
      // Always ensure Chajinel users exist and passwords are current
      {
        const { hashPassword } = await import("./auth");
        const chajinelPwd = process.env.DANIELA_PASSWORD || 'clinic123';
        if (!process.env.DANIELA_PASSWORD) {
          console.warn("WARNING: DANIELA_PASSWORD not set — using default 'clinic123'. Set this env var in production!");
        }
        const hashed = await hashPassword(chajinelPwd);

        const chajinelUsers = [
          { email: process.env.DANIELA_EMAIL || 'daniela@chajinel.com', name: 'Daniela' },
          { email: 'djonguitud@chajinel.com', name: 'D Jonguitud' },
        ];

        for (const cu of chajinelUsers) {
          const { rows: cuCheck } = await pool.query("SELECT id FROM users WHERE email = $1", [cu.email]);
          if (cuCheck.length === 0) {
            await pool.query(
              "INSERT INTO users (id, email, password, role, name, organization_id) VALUES (gen_random_uuid()::text, $1, $2, 'admin', $3, $4)",
              [cu.email, hashed, cu.name, CHAJINEL_ORG_ID]
            );
            console.log(`Created Chajinel user: ${cu.email}`);
          } else {
            await pool.query(
              "UPDATE users SET password = $1, organization_id = $2, role = 'admin' WHERE email = $3",
              [hashed, CHAJINEL_ORG_ID, cu.email]
            );
            console.log(`Synced Chajinel user: ${cu.email}`);
          }
        }
      }
    }

    // ── Ensure agency-billing columns exist before Chajinel seeder ───────
    await pool.query(`ALTER TABLE practice_settings ALTER COLUMN tax_id TYPE VARCHAR(20)`).catch(() => {});
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS billing_model VARCHAR DEFAULT 'direct'`).catch(() => {});
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS agency_npi VARCHAR`).catch(() => {});
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS agency_tax_id VARCHAR`).catch(() => {});
    await pool.query(`ALTER TABLE payers ADD COLUMN IF NOT EXISTS organization_id VARCHAR`).catch(() => {});
    await pool.query(`ALTER TABLE payers ADD COLUMN IF NOT EXISTS payer_category VARCHAR`).catch(() => {});
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS provider_type VARCHAR DEFAULT 'rendering'`).catch(() => {});
    await pool.query(`ALTER TABLE providers ALTER COLUMN npi DROP NOT NULL`).catch(() => {});

    // ── Chajinel practice settings, payers, caregivers, test patients ─────
    {
      const CHAJINEL_ORG_ID = "chajinel-org-001";

      // Practice settings — update with real NPI, tax ID, address, billing model
      await pool.query(`
        UPDATE practice_settings
        SET
          practice_name   = 'Chajinel',
          primary_npi     = '1184288680',
          tax_id          = '47-1075172',
          billing_model   = 'agency_billed',
          agency_npi      = '1184288680',
          agency_tax_id   = '47-1075172',
          address         = '{"street":"208 CYPRESS AVENUE","city":"SOUTH SAN FRANCISCO","state":"CA","zip":"94080"}'::jsonb,
          default_pos     = '12',
          updated_at      = NOW()
        WHERE organization_id = $1
      `, [CHAJINEL_ORG_ID]).catch(() => {});

      // Payer 1 — TriWest Healthcare Alliance (VA Community Care)
      const { rows: tw } = await pool.query(
        `SELECT id FROM payers WHERE organization_id=$1 AND name='TriWest Healthcare Alliance' LIMIT 1`,
        [CHAJINEL_ORG_ID]
      );
      if (tw.length === 0) {
        await pool.query(`
          INSERT INTO payers (id, name, payer_id, payer_category, payer_classification, claim_filing_indicator, timely_filing_days, auth_required, billing_type, is_active, is_custom, organization_id, created_at)
          VALUES (gen_random_uuid()::text, 'TriWest Healthcare Alliance', 'VHPVI', 'va_community_care', 'va_community_care', 'CH', 365, true, 'professional', true, true, $1, NOW())
        `, [CHAJINEL_ORG_ID]);
      }

      // Payer 2 — San Mateo County IHSS
      const { rows: ihss } = await pool.query(
        `SELECT id FROM payers WHERE organization_id=$1 AND name='San Mateo County IHSS' LIMIT 1`,
        [CHAJINEL_ORG_ID]
      );
      if (ihss.length === 0) {
        await pool.query(`
          INSERT INTO payers (id, name, payer_id, payer_category, payer_classification, claim_filing_indicator, timely_filing_days, auth_required, billing_type, is_active, is_custom, organization_id, created_at)
          VALUES (gen_random_uuid()::text, 'San Mateo County IHSS', NULL, 'county_ihss', 'medicaid', 'MC', 365, false, 'professional', true, true, $1, NOW())
        `, [CHAJINEL_ORG_ID]);
      }

      // Payer 3 — LTC Insurance placeholder (inactive)
      const { rows: ltc } = await pool.query(
        `SELECT id FROM payers WHERE organization_id=$1 AND name='LTC Insurance (configure per claim)' LIMIT 1`,
        [CHAJINEL_ORG_ID]
      );
      if (ltc.length === 0) {
        await pool.query(`
          INSERT INTO payers (id, name, payer_id, payer_category, payer_classification, claim_filing_indicator, timely_filing_days, auth_required, billing_type, is_active, is_custom, organization_id, created_at)
          VALUES (gen_random_uuid()::text, 'LTC Insurance (configure per claim)', NULL, 'ltc_insurance', 'commercial', 'CI', 365, false, 'professional', false, true, $1, NOW())
        `, [CHAJINEL_ORG_ID]);
      }

      // Caregivers — agency workers (no NPI required)
      const caregivers = [
        { first: 'Lucia', last: 'Hernandez', creds: 'RN' },
        { first: 'Carlos', last: 'Mendoza', creds: 'CNA' },
        { first: 'Ana', last: 'Reyes', creds: 'Home Health Aide' },
      ];
      for (const cg of caregivers) {
        const { rows: cgCheck } = await pool.query(
          `SELECT id FROM providers WHERE organization_id=$1 AND first_name=$2 AND last_name=$3 LIMIT 1`,
          [CHAJINEL_ORG_ID, cg.first, cg.last]
        );
        if (cgCheck.length === 0) {
          await pool.query(`
            INSERT INTO providers (id, first_name, last_name, credentials, npi, entity_type, provider_type, is_active, is_default, organization_id, created_at, updated_at)
            VALUES (gen_random_uuid()::text, $1, $2, $3, NULL, 'individual', 'agency_worker', true, false, $4, NOW(), NOW())
          `, [cg.first, cg.last, cg.creds, CHAJINEL_ORG_ID]);
        }
      }

      // Migrate any claims/encounters that reference old random-UUID Chajinel demo patients
      // to the canonical fixed IDs before we delete the old rows
      await pool.query(`
        UPDATE claims SET patient_id = 'chajinel-patient-001'
        WHERE organization_id = 'chajinel-org-001'
          AND patient_id IN (
            SELECT id FROM patients
            WHERE organization_id = 'chajinel-org-001' AND is_demo = TRUE
              AND first_name = 'TEST: Maria' AND last_name = 'Garcia'
              AND id != 'chajinel-patient-001'
          )
      `).catch(() => {});
      await pool.query(`
        UPDATE encounters SET patient_id = 'chajinel-patient-001'
        WHERE organization_id = 'chajinel-org-001'
          AND patient_id IN (
            SELECT id FROM patients
            WHERE organization_id = 'chajinel-org-001' AND is_demo = TRUE
              AND first_name = 'TEST: Maria' AND last_name = 'Garcia'
              AND id != 'chajinel-patient-001'
          )
      `).catch(() => {});
      await pool.query(`
        UPDATE claims SET patient_id = 'chajinel-patient-002'
        WHERE organization_id = 'chajinel-org-001'
          AND patient_id IN (
            SELECT id FROM patients
            WHERE organization_id = 'chajinel-org-001' AND is_demo = TRUE
              AND first_name = 'TEST: Jose' AND last_name = 'Rodriguez'
              AND id != 'chajinel-patient-002'
          )
      `).catch(() => {});
      // Remove old random-UUID demo patients (replaced by fixed-ID equivalents below)
      await pool.query(`
        DELETE FROM patients
        WHERE organization_id = 'chajinel-org-001'
          AND is_demo = TRUE
          AND id NOT IN ('chajinel-patient-001', 'chajinel-patient-002')
      `).catch(() => {});

      // Test patients — fixed IDs so inserts are idempotent across restarts/deployments
      const { rows: twRow } = await pool.query(
        `SELECT id FROM payers WHERE organization_id=$1 AND name='TriWest Healthcare Alliance' LIMIT 1`,
        [CHAJINEL_ORG_ID]
      );
      const { rows: ihssRow } = await pool.query(
        `SELECT id FROM payers WHERE organization_id=$1 AND name='San Mateo County IHSS' LIMIT 1`,
        [CHAJINEL_ORG_ID]
      );

      await pool.query(`
        INSERT INTO patients (id, first_name, last_name, dob, payer_id, insurance_carrier, plan_type, is_demo, organization_id, created_at, updated_at)
        VALUES ('chajinel-patient-001', 'TEST: Maria', 'Garcia', '1955-03-12', $1, 'TriWest Healthcare Alliance', 'unknown', TRUE, $2, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET
          payer_id = EXCLUDED.payer_id,
          insurance_carrier = EXCLUDED.insurance_carrier,
          is_demo = TRUE,
          updated_at = NOW()
      `, [twRow[0]?.id ?? null, CHAJINEL_ORG_ID]);

      await pool.query(`
        INSERT INTO patients (id, first_name, last_name, dob, payer_id, insurance_carrier, plan_type, is_demo, organization_id, created_at, updated_at)
        VALUES ('chajinel-patient-002', 'TEST: Jose', 'Rodriguez', '1948-07-22', $1, 'San Mateo County IHSS', 'unknown', TRUE, $2, NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET
          payer_id = EXCLUDED.payer_id,
          insurance_carrier = EXCLUDED.insurance_carrier,
          is_demo = TRUE,
          updated_at = NOW()
      `, [ihssRow[0]?.id ?? null, CHAJINEL_ORG_ID]);

      console.log("[Seeder] Chajinel practice, payers, caregivers, and test patients configured");
    }

    // ── QA Test Accounts ─────────────────────────────────────────────────
    {
      const { hashPassword } = await import("./auth");
      const qaPwd = 'TestPass123!';
      const qaHash = await hashPassword(qaPwd);
      const qaUsers = [
        { email: 'qa-admin@claimshield.test',  name: 'QA Admin',       role: 'admin' },
        { email: 'qa-rcm@claimshield.test',    name: 'QA RCM Manager', role: 'rcm_manager' },
        { email: 'qa-intake@claimshield.test', name: 'QA Intake',      role: 'intake' },
      ];
      for (const u of qaUsers) {
        const { rows } = await pool.query("SELECT id FROM users WHERE email = $1", [u.email]);
        if (rows.length === 0) {
          await pool.query(
            "INSERT INTO users (id, email, password, role, name, organization_id) VALUES (gen_random_uuid()::text, $1, $2, $3, $4, 'demo-org-001')",
            [u.email, qaHash, u.role, u.name]
          );
          console.log(`Created QA user: ${u.email}`);
        } else {
          await pool.query(
            "UPDATE users SET password = $1, role = $2, organization_id = 'demo-org-001' WHERE email = $3",
            [qaHash, u.role, u.email]
          );
          console.log(`Synced QA user: ${u.email}`);
        }
      }
    }

    // ── Payer database expansion ───────────────────────────────────────────
    // Idempotent: only inserts payers that don't already exist by name.
    await pool.query(`
      WITH new_payers (name, payer_id, timely_filing_days, auth_required) AS (VALUES
        -- BCBS State Plans
        ('Blue Cross Blue Shield of Alabama',                   '00310', 365, true),
        ('Blue Cross Blue Shield of Arizona',                   '00360', 365, true),
        ('Anthem Blue Cross (California)',                       'SX109',  365, true),
        ('Anthem Blue Cross Blue Shield (Colorado)',             '00040', 365, true),
        ('Anthem Blue Cross Blue Shield (Connecticut)',          '00009', 365, true),
        ('Florida Blue (Blue Cross Blue Shield of Florida)',     '00590', 365, true),
        ('Anthem Blue Cross Blue Shield (Georgia)',              '00001', 365, true),
        ('Blue Cross Blue Shield of Hawaii (HMSA)',              'HMSA0', 365, true),
        ('Blue Cross Blue Shield of Illinois (HCSC)',            '00621', 365, true),
        ('Anthem Blue Cross Blue Shield (Indiana)',              '00020', 365, true),
        ('Blue Cross Blue Shield of Kansas',                    '00250', 365, true),
        ('Anthem Blue Cross Blue Shield (Kentucky)',             '00028', 365, true),
        ('Blue Cross Blue Shield of Louisiana',                 '00045', 365, true),
        ('Anthem Blue Cross Blue Shield (Maine)',                '00140', 365, true),
        ('Blue Cross Blue Shield of Massachusetts',             '00870', 365, true),
        ('Blue Cross Blue Shield of Michigan',                  '00950', 365, true),
        ('Blue Cross Blue Shield of Minnesota',                 '00110', 365, true),
        ('Blue Cross Blue Shield of Mississippi',               '00560', 365, true),
        ('Blue Cross Blue Shield of Montana',                   '00560', 365, true),
        ('Blue Cross Blue Shield of Nebraska',                  '00760', 365, true),
        ('Blue Cross Blue Shield of North Carolina',            '00580', 365, true),
        ('Blue Cross Blue Shield of North Dakota',              '00090', 365, true),
        ('Anthem Blue Cross Blue Shield (Ohio)',                 '00060', 365, true),
        ('Blue Cross Blue Shield of Oklahoma',                  '00780', 365, true),
        ('Highmark Blue Cross Blue Shield (Pennsylvania)',      '00115', 365, true),
        ('Blue Cross Blue Shield of Rhode Island',              '00510', 365, true),
        ('Blue Cross Blue Shield of South Carolina',            '00640', 365, true),
        ('Blue Cross Blue Shield of Tennessee',                 '00180', 365, true),
        ('Blue Cross Blue Shield of Texas (HCSC)',              '00621', 365, true),
        ('Blue Cross Blue Shield of Vermont',                   '00581', 365, true),
        ('Anthem Blue Cross Blue Shield (Virginia)',             '00030', 365, true),
        ('Regence BlueCross BlueShield (WA/OR)',                '00601', 365, true),
        ('Blue Cross Blue Shield of Wyoming',                   '00820', 365, true),
        -- Medicare & Government
        ('Medicare B — Railroad Retirement Board',              '00019', 365, false),
        ('CHAMPVA',                                             '84146', 365, false),
        ('Indian Health Service',                               'IHS01', 365, false),
        ('Workers Compensation (General)',                      'WCOMP', 365, false),
        ('TriWest Healthcare Alliance',                         'TRWST', 365, true),
        -- Medicare Advantage
        ('Medicare Advantage — Cigna',                          '62308', 365, true),
        ('Medicare Advantage — Aetna',                          '60054', 365, true),
        ('Medicare Advantage — Anthem',                         '00044', 365, true),
        ('Medicare Advantage — Kaiser',                         'SX109', 365, true),
        ('Medicare Advantage — Wellpoint',                      '00044', 365, true),
        -- Commercial Plans
        ('Humana (Commercial)',                                 'HUM01', 365, true),
        ('Anthem (Commercial)',                                 '00044', 365, true),
        ('Oscar Health',                                        'OSCAR', 365, false),
        ('Bright Health',                                       'BRGHT', 365, false),
        ('Molina Healthcare',                                   '59322', 365, true),
        ('WellCare Health Plans',                               'WEL01', 365, true),
        ('Health Net',                                          '66170', 365, true),
        ('Centene Corporation',                                 'CEN01', 365, true),
        ('Multiplan / PHCS',                                    '25133', 365, false),
        ('Highmark (Pennsylvania)',                             '00115', 365, true),
        ('Independence Blue Cross',                             '23281', 365, true),
        ('Capital BlueCross',                                   '52149', 365, true),
        -- Medicaid State Plans
        ('Medicaid — New York',                                 'NY_MDCD', 365, true),
        ('Medicaid — Ohio',                                     'OH_MDCD', 365, true),
        ('Medicaid — Georgia',                                  'GA_MDCD', 365, true),
        ('Medicaid — North Carolina',                           'NC_MDCD', 365, true),
        ('Medicaid — Michigan',                                 'MI_MDCD', 365, true),
        ('Medicaid — Alabama',                                  'AL_MDCD', 365, true),
        ('Medicaid — Illinois',                                 'IL_MDCD', 365, true),
        ('Medicaid — Pennsylvania',                             'PA_MDCD', 365, true),
        ('Medicaid — Virginia',                                 'VA_MDCD', 365, true),
        ('Medicaid — Tennessee',                                'TN_MDCD', 365, true),
        ('Medicaid — Arizona',                                  'AZ_MDCD', 365, true),
        ('Medicaid — Louisiana',                                'LA_MDCD', 365, true),
        ('Medicaid — Mississippi',                              'MS_MDCD', 365, true),
        ('Medicaid — Indiana',                                  'IN_MDCD', 365, true),
        ('Medicaid — Minnesota',                                'MN_MDCD', 365, true),
        ('Medicaid — Missouri',                                 'MO_MDCD', 365, true),
        ('Medicaid — Washington',                               'WA_MDCD', 365, true),
        ('Medicaid — Colorado',                                 'CO_MDCD', 365, true),
        ('Medicaid — South Carolina',                           'SC_MDCD', 365, true),
        ('Medicaid — New Jersey',                               'NJ_MDCD', 365, true)
      )
      INSERT INTO payers (id, name, payer_id, timely_filing_days, auth_required, billing_type, is_active, is_custom)
      SELECT gen_random_uuid()::text, np.name, np.payer_id, np.timely_filing_days::integer, np.auth_required::boolean, 'professional', true, false
      FROM new_payers np
      WHERE NOT EXISTS (SELECT 1 FROM payers p WHERE p.name = np.name)
    `);

    // ── HCPCS plain-English descriptions for home health codes ─────────────
    const hcpcsPlainUpdates: [string, string][] = [
      ['G0299', 'Skilled nursing care by an RN in the home, billed per 15 minutes'],
      ['G0300', 'Skilled nursing care by an LPN in the home, billed per 15 minutes'],
      ['G0151', 'Physical therapy services in the home or hospice, per 15 minutes'],
      ['G0152', 'Occupational therapy services in the home or hospice, per 15 minutes'],
      ['G0153', 'Speech-language pathology services in the home or hospice, per 15 minutes'],
      ['G0154', 'Skilled nursing (LPN or RN) in the home or hospice, per 15 minutes'],
      ['G0155', 'Clinical social work services in the home or hospice, per 15 minutes'],
      ['G0156', 'Home health aide or hospice aide services, per 15 minutes'],
      ['G0157', 'Physical therapy assistant services in the home or hospice, per 15 minutes'],
      ['G0158', 'Occupational therapy assistant services in the home or hospice, per 15 minutes'],
      ['G0159', 'Physical therapy services (home/hospice) — add-on per 15 minutes'],
      ['G0160', 'Occupational therapy services (home/hospice) — add-on per 15 minutes'],
      ['G0161', 'Speech-language pathology services (home/hospice) — add-on per 15 minutes'],
      ['G0162', 'Skilled nursing (RN) for care plan management in the home, per 15 minutes'],
      ['G0493', 'RN observation and assessment visit in the home, per 15 minutes'],
      ['G0494', 'LPN observation and assessment visit in the home, per 15 minutes'],
      ['G0495', 'RN patient/family education visit in the home, per 15 minutes'],
      ['G0496', 'LPN patient/family education visit in the home, per 15 minutes'],
    ];
    for (const [code, plain] of hcpcsPlainUpdates) {
      await pool.query(
        `UPDATE hcpcs_codes SET description_plain = $1 WHERE code = $2 AND (description_plain IS NULL OR description_plain = '')`,
        [plain, code]
      );
    }
    // ── Seed FRCPB E2E test payer (canonical, global, idempotent) ────────────
    // Uses WHERE NOT EXISTS — safe regardless of whether payer_id has a unique index.
    try {
      await pool.query(`
        INSERT INTO payers (id, name, payer_id, timely_filing_days, auth_required, billing_type, is_active, is_custom, payer_classification)
        SELECT gen_random_uuid()::text, 'Stedi E2E Test Payer', 'FRCPB', 0, false, 'professional', true, false, 'commercial'
        WHERE NOT EXISTS (SELECT 1 FROM payers WHERE payer_id = 'FRCPB')
      `);
      const { rows: frcpbCheck } = await pool.query(`SELECT id FROM payers WHERE payer_id = 'FRCPB' LIMIT 1`);
      if (frcpbCheck.length === 0) console.error("[Seeder] WARNING: FRCPB payer row missing after seed attempt");
      else console.log("[Seeder] FRCPB E2E test payer confirmed in payers table");
    } catch (err) {
      console.error("[Seeder] ERROR seeding FRCPB payer:", err);
    }

    console.log("Payer database and HCPCS descriptions updated");

    // Add new claim columns (idempotent)
    await pool.query(`
      ALTER TABLE claims
        ADD COLUMN IF NOT EXISTS claim_frequency_code VARCHAR DEFAULT '1',
        ADD COLUMN IF NOT EXISTS orig_claim_number VARCHAR,
        ADD COLUMN IF NOT EXISTS homebound_indicator VARCHAR DEFAULT 'Y',
        ADD COLUMN IF NOT EXISTS ordering_provider_id VARCHAR,
        ADD COLUMN IF NOT EXISTS external_ordering_provider_name VARCHAR,
        ADD COLUMN IF NOT EXISTS external_ordering_provider_npi VARCHAR,
        ADD COLUMN IF NOT EXISTS delay_reason_code VARCHAR,
        ADD COLUMN IF NOT EXISTS follow_up_date DATE,
        ADD COLUMN IF NOT EXISTS follow_up_status VARCHAR
    `);
    // Add license_number to providers (idempotent)
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS license_number VARCHAR`);

    // Create claim_follow_up_notes table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS claim_follow_up_notes (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        claim_id VARCHAR NOT NULL,
        org_id VARCHAR,
        user_id VARCHAR,
        user_name VARCHAR,
        note_text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_follow_up_notes_claim ON claim_follow_up_notes(claim_id)`);

    // Create ERA (835) tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS era_batches (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        org_id VARCHAR,
        payer_name VARCHAR NOT NULL,
        check_number VARCHAR,
        payment_date DATE,
        total_amount REAL DEFAULT 0,
        status VARCHAR DEFAULT 'unposted',
        raw_edi TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_era_batches_org ON era_batches(org_id)`);
    await pool.query(`ALTER TABLE era_batches ADD COLUMN IF NOT EXISTS source VARCHAR DEFAULT 'stedi'`);
    await pool.query(`ALTER TABLE era_batches ADD COLUMN IF NOT EXISTS raw_data JSONB`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS era_lines (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        era_id VARCHAR NOT NULL REFERENCES era_batches(id) ON DELETE CASCADE,
        claim_id VARCHAR,
        org_id VARCHAR,
        patient_name VARCHAR,
        dos DATE,
        billed_amount REAL DEFAULT 0,
        allowed_amount REAL DEFAULT 0,
        paid_amount REAL DEFAULT 0,
        service_lines JSONB DEFAULT '[]',
        status VARCHAR DEFAULT 'unposted',
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_era_lines_era ON era_lines(era_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_era_lines_claim ON era_lines(claim_id)`);

    // ── vob_verifications: make lead_id + payer_id nullable, add Stedi columns ─
    await pool.query(`ALTER TABLE vob_verifications ALTER COLUMN lead_id DROP NOT NULL`);
    await pool.query(`ALTER TABLE vob_verifications ALTER COLUMN payer_id DROP NOT NULL`);
    await pool.query(`ALTER TABLE vob_verifications ADD COLUMN IF NOT EXISTS verification_method VARCHAR DEFAULT 'manual'`);
    await pool.query(`ALTER TABLE vob_verifications ADD COLUMN IF NOT EXISTS stedi_transaction_id VARCHAR`);
    await pool.query(`ALTER TABLE vob_verifications ADD COLUMN IF NOT EXISTS verified_by VARCHAR`);

    // ── payer_auth_requirements table (global, no org_id) ────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payer_auth_requirements (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        payer_id VARCHAR NOT NULL,
        payer_name VARCHAR NOT NULL,
        code VARCHAR NOT NULL,
        code_type VARCHAR NOT NULL DEFAULT 'HCPCS',
        auth_required BOOLEAN NOT NULL DEFAULT true,
        auth_conditions TEXT,
        auth_validity_days INTEGER,
        auth_number_format VARCHAR,
        auth_number_format_hint VARCHAR,
        typical_turnaround_days INTEGER,
        submission_method VARCHAR,
        portal_url TEXT,
        notes TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_payer_auth_req_payer_id ON payer_auth_requirements(payer_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_payer_auth_req_code ON payer_auth_requirements(code)`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payer_auth_req_unique ON payer_auth_requirements(payer_id, code)`);

    // ── Seed VA Community Care + BCBS auth requirements ──────────────────────
    const { rows: vaRows } = await pool.query(`SELECT id FROM payers WHERE payer_id = 'VACCN' OR name = 'VA Community Care' LIMIT 1`);
    const { rows: bcbsTxRows } = await pool.query(`SELECT id FROM payers WHERE payer_id = '00621' OR name ILIKE '%Blue Cross Blue Shield of Texas%' LIMIT 1`);
    if (vaRows.length > 0) {
      const vaId = vaRows[0].id;
      const vaCodes = [
        ['G0299','HCPCS','VA issues a Community Care authorization (VA referral) before first visit. Auth number is on the VA referral document. Required on every claim.','Alphanumeric, 10-20 characters. Provided on VA CC referral. Starts with the letter V followed by digits in most cases.','RN home health visits. Authorization provided by VA on referral. Contact the referring VA facility if auth is missing. Portal: va.gov/COMMUNITYCARE'],
        ['G0300','HCPCS','Same as G0299. VA-issued referral authorization required on every claim.','Alphanumeric, 10-20 characters. Provided on VA CC referral.','LPN home health visits. Authorization provided by VA on referral. See G0299 notes.'],
        ['G0151','HCPCS','VA-issued referral authorization required on every claim.','Alphanumeric, 10-20 characters. Provided on VA CC referral.','Physical therapy home health visits. Auth from VA referral. Confirm authorized number of visits.'],
        ['G0152','HCPCS','VA-issued referral authorization required on every claim.','Alphanumeric, 10-20 characters. Provided on VA CC referral.','Occupational therapy home health visits. Auth from VA referral. Confirm authorized number of visits.'],
        ['G0153','HCPCS','VA-issued referral authorization required on every claim.','Alphanumeric, 10-20 characters. Provided on VA CC referral.','Speech therapy home health visits. Auth from VA referral.'],
        ['G0162','HCPCS','VA-issued referral authorization required on every claim.','Alphanumeric, 10-20 characters. Provided on VA CC referral.','Skilled nursing services requiring specialized care. Auth from VA referral.'],
      ];
      for (const [code, codeType, conditions, hint, notes] of vaCodes) {
        await pool.query(
          `INSERT INTO payer_auth_requirements (payer_id, payer_name, code, code_type, auth_required, auth_conditions, auth_validity_days, auth_number_format_hint, typical_turnaround_days, submission_method, notes)
           VALUES ($1,'VA Community Care',$2,$3,true,$4,90,$5,0,'portal',$6)
           ON CONFLICT (payer_id, code) DO NOTHING`,
          [vaId, code, codeType, conditions, hint, notes]
        );
      }
    }
    if (bcbsTxRows.length > 0) {
      const bcbsId = bcbsTxRows[0].id;
      const bcbsCodes = [
        ['G0299','HCPCS','Prior authorization required before first home health visit. Submit through Availity. Typically approved for a 60-day episode.','Submit PA request through Availity portal before first visit. Include plan of care, physician orders, and homebound status documentation. 60-day episode authorization is standard.'],
        ['G0300','HCPCS','Prior authorization required. Submit through Availity. Same episode as G0299 if same patient.','LPN visits. May be covered under same PA as RN visits in same episode. Verify with BCBS.'],
        ['G0151','HCPCS','Prior authorization required for PT visits. Must include plan of care and functional goals.','Physical therapy home visits. Submit PA through Availity with PT evaluation, plan of care, and homebound documentation.'],
        ['G0152','HCPCS','Prior authorization required for OT visits.','Occupational therapy home visits. Separate PA from PT — submit independently.'],
      ];
      for (const [code, codeType, conditions, notes] of bcbsCodes) {
        await pool.query(
          `INSERT INTO payer_auth_requirements (payer_id, payer_name, code, code_type, auth_required, auth_conditions, auth_validity_days, typical_turnaround_days, submission_method, portal_url, notes)
           VALUES ($1,'Blue Cross Blue Shield of Texas',$2,$3,true,$4,60,3,'portal','https://www.availity.com',$5)
           ON CONFLICT (payer_id, code) DO NOTHING`,
          [bcbsId, code, codeType, conditions, notes]
        );
      }
    }

    // ── prior_authorizations: add lifecycle columns ───────────────────────────
    await pool.query(`ALTER TABLE prior_authorizations ADD COLUMN IF NOT EXISTS request_status VARCHAR DEFAULT 'not_started'`);
    await pool.query(`ALTER TABLE prior_authorizations ADD COLUMN IF NOT EXISTS cpt_codes JSONB DEFAULT '[]'`);
    await pool.query(`ALTER TABLE prior_authorizations ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP`);
    await pool.query(`ALTER TABLE prior_authorizations ADD COLUMN IF NOT EXISTS decision_at TIMESTAMP`);
    await pool.query(`ALTER TABLE prior_authorizations ADD COLUMN IF NOT EXISTS denial_reason TEXT`);
    await pool.query(`ALTER TABLE prior_authorizations ADD COLUMN IF NOT EXISTS clinical_notes TEXT`);
    await pool.query(`ALTER TABLE prior_authorizations ADD COLUMN IF NOT EXISTS request_method VARCHAR`);
    await pool.query(`ALTER TABLE prior_authorizations ADD COLUMN IF NOT EXISTS requested_by VARCHAR`);
    await pool.query(`ALTER TABLE prior_authorizations ADD COLUMN IF NOT EXISTS expiration_date DATE`);
    // Sprint-4: two-mode prior auth additions
    await pool.query(`ALTER TABLE prior_authorizations ADD COLUMN IF NOT EXISTS mode VARCHAR DEFAULT 'received'`);
    await pool.query(`ALTER TABLE prior_authorizations ADD COLUMN IF NOT EXISTS source VARCHAR`);
    await pool.query(`ALTER TABLE prior_authorizations ADD COLUMN IF NOT EXISTS referring_provider_name VARCHAR`);
    await pool.query(`ALTER TABLE prior_authorizations ADD COLUMN IF NOT EXISTS referring_provider_npi VARCHAR`);
    await pool.query(`ALTER TABLE prior_authorizations ADD COLUMN IF NOT EXISTS clinical_justification TEXT`);
    await pool.query(`ALTER TABLE prior_authorizations ADD COLUMN IF NOT EXISTS approved_units INTEGER`);
    await pool.query(`ALTER TABLE prior_authorizations ADD COLUMN IF NOT EXISTS used_units INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE prior_authorizations ADD COLUMN IF NOT EXISTS service_type VARCHAR`);

    // ── Payers: stedi_payer_id + supported_transactions + updated_at ──────────
    await pool.query(`ALTER TABLE payers ADD COLUMN IF NOT EXISTS stedi_payer_id VARCHAR`);
    await pool.query(`ALTER TABLE payers ADD COLUMN IF NOT EXISTS supported_transactions JSONB DEFAULT '[]'`);
    await pool.query(`ALTER TABLE payers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP`);
    await pool.query(`ALTER TABLE payers DROP COLUMN IF EXISTS npi`);
    await pool.query(`ALTER TABLE payers DROP COLUMN IF EXISTS tax_id`);

    // ── ITEM 1: Fix TriWest payer ID VACCN → TWVACCN (Stedi uses TWVACCN) ─────
    await pool.query(`
      UPDATE payers
      SET payer_id = 'TWVACCN', updated_at = NOW()
      WHERE (name ILIKE '%VA Community Care%' OR payer_id = 'VACCN')
        AND payer_id != 'TWVACCN'
        AND is_active = true
    `);
    // Update payer_auth_requirements payer_id references too (if any were seeded as VACCN)
    await pool.query(`
      UPDATE payer_auth_requirements
      SET payer_id = (SELECT id FROM payers WHERE name ILIKE '%VA Community Care%' AND payer_id = 'TWVACCN' LIMIT 1)
      WHERE payer_name = 'VA Community Care'
        AND payer_id NOT IN (SELECT id FROM payers WHERE payer_id = 'TWVACCN' LIMIT 1)
    `).catch(() => {}); // Non-critical — ignore if payer_auth_requirements uses UUID payer_id

    // ── Stedi integration: stedi_transaction_id on claims ───────────────────
    await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS stedi_transaction_id VARCHAR`);

    // ── ERA: add stedi_era_id + raw_data to era_batches ─────────────────────
    await pool.query(`ALTER TABLE era_batches ADD COLUMN IF NOT EXISTS stedi_era_id VARCHAR`);
    await pool.query(`ALTER TABLE era_batches ADD COLUMN IF NOT EXISTS raw_data JSONB`);

    // ── era_claim_lines table ────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS era_claim_lines (
        id VARCHAR PRIMARY KEY,
        era_batch_id VARCHAR NOT NULL,
        claim_control_number VARCHAR,
        patient_name VARCHAR,
        billed_amount DECIMAL(10,2),
        allowed_amount DECIMAL(10,2),
        paid_amount DECIMAL(10,2),
        adjustment_codes JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_era_claim_lines_batch ON era_claim_lines(era_batch_id)`);

    // ── Claims: test validation columns (moved to startup so they exist before first use) ──
    await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS last_test_status VARCHAR`);
    await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS last_test_at TIMESTAMP`);
    await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS last_test_errors JSONB`);

    // ── Claims: COB / secondary insurance columns ────────────────────────────
    await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS secondary_payer_id VARCHAR`);
    await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS secondary_member_id VARCHAR`);
    await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS secondary_group_number VARCHAR`);
    await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS cob_order VARCHAR`);

    // ── Payers: stedi sync timestamp ─────────────────────────────────────────
    await pool.query(`ALTER TABLE payers ADD COLUMN IF NOT EXISTS stedi_synced_at TIMESTAMP`);

    // ── Prior authorizations: additional tracking columns ────────────────────
    await pool.query(`ALTER TABLE prior_authorizations ADD COLUMN IF NOT EXISTS authorized_visits INTEGER`);
    await pool.query(`ALTER TABLE prior_authorizations ADD COLUMN IF NOT EXISTS appeal_deadline DATE`);

    // ── Sprint-4 / Audit gap fixes ────────────────────────────────────────────
    // GAP 1: ordering_provider flat columns on claims table
    await pool.query(`
      ALTER TABLE claims
        ADD COLUMN IF NOT EXISTS ordering_provider_first_name VARCHAR,
        ADD COLUMN IF NOT EXISTS ordering_provider_last_name VARCHAR,
        ADD COLUMN IF NOT EXISTS ordering_provider_npi VARCHAR,
        ADD COLUMN IF NOT EXISTS ordering_provider_org VARCHAR
    `);
    await pool.query(`
      UPDATE claims SET
        ordering_provider_npi = external_ordering_provider_npi,
        ordering_provider_first_name = SPLIT_PART(COALESCE(external_ordering_provider_name,''), ' ', 1),
        ordering_provider_last_name = CASE
          WHEN POSITION(' ' IN COALESCE(external_ordering_provider_name,'')) > 0
          THEN SUBSTRING(COALESCE(external_ordering_provider_name,'') FROM POSITION(' ' IN COALESCE(external_ordering_provider_name,'')) + 1)
          ELSE NULL
        END
      WHERE external_ordering_provider_npi IS NOT NULL
        AND ordering_provider_npi IS NULL
    `);

    // GAP 2: patient address flat columns
    await pool.query(`
      ALTER TABLE patients
        ADD COLUMN IF NOT EXISTS street_address VARCHAR,
        ADD COLUMN IF NOT EXISTS city VARCHAR,
        ADD COLUMN IF NOT EXISTS zip_code VARCHAR
    `);
    await pool.query(`
      UPDATE patients SET
        street_address = COALESCE(address->>'street', address->>'street1'),
        city = address->>'city',
        zip_code = address->>'zip'
      WHERE address IS NOT NULL AND street_address IS NULL
    `);

    // REMAINING 3: DB-backed login attempts for persistent rate limiting
    await pool.query(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        ip VARCHAR NOT NULL,
        attempted_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON login_attempts(ip, attempted_at)`);

    // REMAINING 5: Missing performance indexes
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_claims_service_date ON claims(service_date)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_claim_events_claim_id ON claim_events(claim_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_vob_patient_id ON vob_verifications(patient_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_prior_auth_patient_id ON prior_authorizations(patient_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_denials_claim_id ON denials(claim_id)`);

    // REMAINING 7: Role permissions table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        role VARCHAR NOT NULL,
        resource VARCHAR NOT NULL,
        actions TEXT[] NOT NULL DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(role, resource)
      )
    `);
    await pool.query(`
      INSERT INTO role_permissions (role, resource, actions) VALUES
        ('admin', 'patients', ARRAY['read','create','update','delete']),
        ('admin', 'claims', ARRAY['read','create','update','delete','submit']),
        ('admin', 'reports', ARRAY['read','export']),
        ('admin', 'users', ARRAY['read','create','update','delete']),
        ('rcm_manager', 'patients', ARRAY['read','create','update']),
        ('rcm_manager', 'claims', ARRAY['read','create','update','submit']),
        ('rcm_manager', 'reports', ARRAY['read','export']),
        ('rcm_manager', 'users', ARRAY['read']),
        ('biller', 'patients', ARRAY['read','update']),
        ('biller', 'claims', ARRAY['read','create','update']),
        ('biller', 'reports', ARRAY['read']),
        ('biller', 'users', ARRAY[]::text[]),
        ('coder', 'patients', ARRAY['read']),
        ('coder', 'claims', ARRAY['read','update']),
        ('coder', 'reports', ARRAY['read']),
        ('coder', 'users', ARRAY[]::text[]),
        ('front_desk', 'patients', ARRAY['read','create']),
        ('front_desk', 'claims', ARRAY['read']),
        ('front_desk', 'reports', ARRAY[]::text[]),
        ('front_desk', 'users', ARRAY[]::text[]),
        ('auditor', 'patients', ARRAY['read']),
        ('auditor', 'claims', ARRAY['read']),
        ('auditor', 'reports', ARRAY['read','export']),
        ('auditor', 'users', ARRAY[]::text[]),
        ('appeals_specialist', 'patients', ARRAY['read']),
        ('appeals_specialist', 'claims', ARRAY['read','update']),
        ('appeals_specialist', 'reports', ARRAY['read']),
        ('appeals_specialist', 'users', ARRAY[]::text[]),
        ('intake', 'patients', ARRAY['read','create']),
        ('intake', 'claims', ARRAY[]::text[]),
        ('intake', 'reports', ARRAY[]::text[]),
        ('intake', 'users', ARRAY[]::text[])
      ON CONFLICT (role, resource) DO NOTHING
    `);

    // ── carc_posting_rules table ─────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS carc_posting_rules (
        id SERIAL PRIMARY KEY,
        carc_code VARCHAR NOT NULL UNIQUE,
        description TEXT,
        default_action VARCHAR NOT NULL,
        group_code VARCHAR,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    // Seed CARC posting rules — idempotent via ON CONFLICT
    await pool.query(`
      INSERT INTO carc_posting_rules (carc_code, description, default_action, group_code) VALUES
        ('45',  'Charge exceeds fee schedule / maximum allowable',          'auto_writeoff',          'CO'),
        ('97',  'Payment included in allowance for another service/procedure', 'auto_writeoff',        'CO'),
        ('94',  'Processed in excess of charges',                           'auto_writeoff',          'CO'),
        ('59',  'Processed based on multiple-procedure rules',              'auto_writeoff',          'CO'),
        ('1',   'Deductible amount',                                        'patient_responsibility', 'PR'),
        ('2',   'Coinsurance amount',                                       'patient_responsibility', 'PR'),
        ('3',   'Co-payment amount',                                        'patient_responsibility', 'PR'),
        ('96',  'Non-covered charge(s)',                                    'flag_review',            'CO'),
        ('50',  'These are non-covered services because this is not deemed a medical necessity', 'flag_appeal', 'CO'),
        ('4',   'Service/equipment is not covered',                         'flag_review',            'CO'),
        ('16',  'Claim/service lacks information or has submission/billing error(s)', 'flag_review',  'CO'),
        ('29',  'Timely filing limitation has expired',                     'flag_review',            'CO'),
        ('167', 'This (these) diagnosis(es) is (are) not covered',          'flag_review',            'CO'),
        ('109', 'Claim not covered by this payer',                          'flag_review',            'CO'),
        ('22',  'This care may be covered by another payer',                'flag_review',            'OA'),
        ('23',  'Impact of prior payer(s) adjudication',                    'flag_review',            'OA'),
        ('19',  'Claim denied because this is a work-related injury',       'flag_review',            'CO'),
        ('26',  'Expenses incurred prior to coverage',                      'flag_review',            'CO'),
        ('27',  'Expenses incurred after coverage terminated',              'flag_review',            'CO'),
        ('B7',  'This provider was not certified/eligible on the DOS',      'flag_appeal',            'CO'),
        ('B8',  'Alternative services were available',                      'flag_review',            'CO')
      ON CONFLICT (carc_code) DO NOTHING
    `);

    // ── system_settings table (for poll timestamps) ──────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key VARCHAR PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Seed CARC/RARC codes, POS codes, full taxonomy codes, and additional payers
    const { seedReferenceTables } = await import("./seeds/reference-tables");
    await seedReferenceTables(pool);

    // ── Fix practice settings address (required for EDI validation + letters) ──
    await pool.query(`
      UPDATE practice_settings
      SET address = '{"street": "4200 Monterey Oaks Blvd Ste 200", "city": "Austin", "state": "TX", "zip": "78749"}'::jsonb
      WHERE organization_id = 'demo-org-001'
        AND (address IS NULL
          OR address::text = '{}'
          OR address::jsonb->>'street' IS NULL
          OR address::jsonb->>'street' = ''
          OR address::jsonb->>'city' = '')
    `);
    await pool.query(`
      UPDATE patients SET sex = 'Female' WHERE member_id = 'VA651254344' AND (sex IS NULL OR sex = '')
    `);

    // ── Section 1: webhook_events idempotency table ───────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS webhook_events (
        event_id VARCHAR PRIMARY KEY,
        event_type VARCHAR,
        transaction_id VARCHAR,
        transaction_set VARCHAR,
        processed_at TIMESTAMP DEFAULT NOW(),
        status VARCHAR DEFAULT 'processed'
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_webhook_events_event_id ON webhook_events(event_id)`);

    // ── Submission audit trail (Environment Guards — runs on every deploy) ─────
    await seederLog('table', 'submission_attempts');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS submission_attempts (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        claim_id VARCHAR NOT NULL,
        organization_id VARCHAR,
        isa15 VARCHAR(1) NOT NULL,
        test_mode_override BOOLEAN DEFAULT false,
        automated BOOLEAN DEFAULT false,
        test_data_result VARCHAR,
        test_data_score INTEGER,
        attempted_by VARCHAR,
        attempted_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_submission_attempts_claim_id ON submission_attempts(claim_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_submission_attempts_at ON submission_attempts(attempted_at)`);
    // Optional annotation columns (non-critical, present in some envs)
    await pool.query(`ALTER TABLE submission_attempts ADD COLUMN IF NOT EXISTS blocked BOOLEAN DEFAULT false`).catch(() => {});
    await pool.query(`ALTER TABLE submission_attempts ADD COLUMN IF NOT EXISTS block_reason VARCHAR`).catch(() => {});
    // VA locality: dedicated column separate from billing address ZIP/city
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS default_va_locality VARCHAR`).catch(() => {});
    // PGBA VA CCN: EDIG-assigned Trading Partner Submitter ID for ISA06/GS02/NM1*41.
    // Flexible: may hold Stedi Trading Partner ID, Availity ID, or direct PGBA EDIG ID.
    // Confirm with Daniela which submission path applies (Stedi/Availity/direct) before populating.
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS pgba_trading_partner_id VARCHAR`).catch(() => {});
    // Migrate existing billing_location values that are actual locality names (not ZIP codes or bare city names)
    await pool.query(`
      UPDATE practice_settings SET default_va_locality = billing_location
      WHERE default_va_locality IS NULL
        AND billing_location IS NOT NULL
        AND LENGTH(billing_location) > 10
        AND billing_location ~ '[A-Za-z].*[A-Za-z]'
        AND billing_location NOT ~ '^\\d+$'
    `).catch(() => {});
    // last_test_correlation_id on claims (may not exist in older prod databases)
    await seederLog('column', 'claims', 'last_test_correlation_id');
    await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS last_test_correlation_id VARCHAR`).catch(() => {});

    // ── Chajinel / Agency billing schema ──────────────────────────────────
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS billing_model VARCHAR DEFAULT 'direct'`).catch(() => {});
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS agency_npi VARCHAR`).catch(() => {});
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS agency_tax_id VARCHAR`).catch(() => {});
    await pool.query(`ALTER TABLE payers ADD COLUMN IF NOT EXISTS organization_id VARCHAR`).catch(() => {});
    await pool.query(`ALTER TABLE payers ADD COLUMN IF NOT EXISTS payer_category VARCHAR`).catch(() => {});
    await pool.query(`ALTER TABLE providers ADD COLUMN IF NOT EXISTS provider_type VARCHAR DEFAULT 'rendering'`).catch(() => {});
    // Make providers.npi nullable so agency workers (no NPI) can be stored
    await pool.query(`ALTER TABLE providers ALTER COLUMN npi DROP NOT NULL`).catch(() => {});
    await pool.query(`DROP INDEX IF EXISTS providers_npi_key`).catch(() => {});
    await pool.query(`ALTER TABLE providers DROP CONSTRAINT IF EXISTS providers_npi_key`).catch(() => {});
    // Partial unique: NPI must still be unique when present, but NULL is fine
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS providers_npi_unique_when_present ON providers(npi) WHERE npi IS NOT NULL`).catch(() => {});

    // Rules engine evaluation audit columns (Task 6 from Prompt 03)
    await seederLog('column', 'claims', 'last_risk_evaluation_at');
    await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS last_risk_evaluation_at TIMESTAMP`).catch(() => {});
    await seederLog('column', 'claims', 'last_risk_factors');
    await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS last_risk_factors JSONB`).catch(() => {});

    // ── Section 1: payer enrollment status columns ────────────────────────────
    await pool.query(`ALTER TABLE payers ADD COLUMN IF NOT EXISTS enrollment_status_835 VARCHAR DEFAULT 'not_enrolled'`);
    await pool.query(`ALTER TABLE payers ADD COLUMN IF NOT EXISTS enrollment_status_837 VARCHAR DEFAULT 'not_enrolled'`);
    await pool.query(`ALTER TABLE payers ADD COLUMN IF NOT EXISTS enrollment_activated_at TIMESTAMP`);

    // Update TriWest to reflect known active enrollment status
    await pool.query(`
      UPDATE payers SET
        payer_id = 'TWVACCN',
        timely_filing_days = 180,
        auto_followup_days = 10,
        enrollment_status_835 = 'active',
        enrollment_status_837 = 'active',
        enrollment_activated_at = NOW()
      WHERE name ILIKE '%triwest%' OR payer_id IN ('TRWST', 'VACCN', 'TWVACCN')
    `).catch(() => {});

    // ── Section 1: rules table — add condition_type schema columns ────────────
    await pool.query(`ALTER TABLE rules ADD COLUMN IF NOT EXISTS condition_type VARCHAR`);
    await pool.query(`ALTER TABLE rules ADD COLUMN IF NOT EXISTS condition_value VARCHAR`);
    await pool.query(`ALTER TABLE rules ADD COLUMN IF NOT EXISTS action VARCHAR`);
    await pool.query(`ALTER TABLE rules ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`);

    // Populate new columns from existing ones for backward compat
    await pool.query(`
      UPDATE rules SET
        condition_type = COALESCE(condition_type, trigger_pattern),
        action = COALESCE(action, prevention_action),
        is_active = COALESCE(is_active, enabled)
      WHERE condition_type IS NULL
    `).catch(() => {});

    // Seed universal rules using condition_type schema — idempotent ON CONFLICT
    await pool.query(`
      INSERT INTO rules (id, name, description, trigger_pattern, prevention_action, enabled, condition_type, condition_value, action, is_active, specialty_tags, organization_id)
      VALUES
        (gen_random_uuid()::text,'Missing NPI','Rendering provider NPI is missing or not 10 digits','provider_npi_invalid','block',true,'provider_npi_invalid','true','block',true,ARRAY['Universal'],NULL),
        (gen_random_uuid()::text,'Missing Diagnosis','No primary ICD-10 diagnosis code on claim','diagnosis_missing','block',true,'diagnosis_missing','true','block',true,ARRAY['Universal'],NULL),
        (gen_random_uuid()::text,'Zero Charges','All service line charges total $0.00','total_charges_zero','block',true,'total_charges_zero','true','block',true,ARRAY['Universal'],NULL),
        (gen_random_uuid()::text,'Missing Payer','No payer assigned to claim','payer_missing','block',true,'payer_missing','true','block',true,ARRAY['Universal'],NULL),
        (gen_random_uuid()::text,'Future Service Date','Date of service is more than 1 day in the future','service_date_future','warn',true,'service_date_future','1','warn',true,ARRAY['Universal'],NULL),
        (gen_random_uuid()::text,'Missing Service Date','Date of service is not set','service_date_missing','block',true,'service_date_missing','true','block',true,ARRAY['Universal'],NULL),
        (gen_random_uuid()::text,'VA Missing Auth Number','TriWest/VA CCN claims require an authorization number','va_auth_missing','block',true,'va_auth_missing','TWVACCN','block',true,ARRAY['VA Community Care'],NULL),
        (gen_random_uuid()::text,'VA Timely Filing Warning','Claim approaching 150-day VA filing deadline','days_since_service_gt','warn',true,'days_since_service_gt','150','warn',true,ARRAY['VA Community Care'],NULL),
        (gen_random_uuid()::text,'VA Timely Filing Block','Claim past 180-day VA filing deadline','days_since_service_gt','block',true,'days_since_service_gt','180','block',true,ARRAY['VA Community Care'],NULL),
        (gen_random_uuid()::text,'VA Wrong Place of Service','VA CCN home health claims require POS 12','va_wrong_pos','warn',true,'va_wrong_pos','12','warn',true,ARRAY['VA Community Care'],NULL),
        (gen_random_uuid()::text,'VA G-Code Requires POS 12','Home health G-codes must be billed with POS 12','gcode_wrong_pos','block',true,'gcode_wrong_pos','12','block',true,ARRAY['VA Community Care','Home Health'],NULL),
        (gen_random_uuid()::text,'Duplicate Claim','A claim with same patient, service date, and code exists','duplicate_claim','warn',true,'duplicate_claim','true','warn',true,ARRAY['Universal'],NULL)
      ON CONFLICT DO NOTHING
    `).catch(() => {});

    // Remove demo providers from non-demo orgs
    await pool.query(`
      DELETE FROM providers WHERE npi IN ('1234567893','1245319599') AND organization_id != 'demo-org-001'
    `).catch(() => {});

    // ── Seed demo VA home health claims (Chajinel workflow) ───────────────────
    const { rows: demoClaimsCheck } = await pool.query(`SELECT COUNT(*)::int as cnt FROM claims WHERE id LIKE 'demo-claim-va-%'`);
    if (demoClaimsCheck[0].cnt === 0) {
      const { rows: [vaPayerRow] } = await pool.query(`SELECT id FROM payers WHERE name = 'VA Community Care' LIMIT 1`);
      const { rows: [vaPatientRow] } = await pool.query(`SELECT id FROM patients WHERE member_id = 'VA651254344' LIMIT 1`);
      const { rows: providerRows } = await pool.query(`SELECT id FROM providers WHERE organization_id = 'demo-org-001' ORDER BY created_at LIMIT 2`);

      if (vaPayerRow && vaPatientRow && providerRows.length > 0) {
        const payerId = vaPayerRow.id;
        const patientId = vaPatientRow.id;
        const providerId = providerRows[0].id;
        const orderingProviderId = providerRows.length > 1 ? providerRows[1].id : providerRows[0].id;
        const g0299x4 = JSON.stringify([{ code: 'G0299', units: 4, charge: 163.56, modifier: '', description: 'Direct skilled nursing services of a registered nurse (RN) in the home, per 15 minutes', diagnosisPointers: 'A' }]);
        const g0299x8 = JSON.stringify([{ code: 'G0299', units: 8, charge: 327.12, modifier: '', description: 'Direct skilled nursing services of a registered nurse (RN) in the home, per 15 minutes', diagnosisPointers: 'A' }]);
        const g0162x8 = JSON.stringify([{ code: 'G0162', units: 8, charge: 240.00, modifier: '', description: 'Skilled nursing (RN) for care plan management in the home, per 15 minutes', diagnosisPointers: 'A' }]);

        await pool.query(`
          INSERT INTO claims (id, encounter_id, patient_id, payer, payer_id, provider_id, ordering_provider_id, service_date,
            place_of_service, icd10_primary, icd10_secondary, authorization_number, amount, status,
            risk_score, readiness_status, homebound_indicator, claim_frequency_code,
            service_lines, cpt_codes, organization_id, availity_icn, submission_method,
            follow_up_status, created_at, updated_at)
          VALUES
            ('demo-claim-va-001', 'demo-enc-001', $1, 'VA Community Care', $2, $3, $4, '2026-01-15', '12',
              'M79.3', '["Z23"]'::jsonb, 'VA-2026-10001', 163.56, 'paid', 18, 'GREEN',
              'Y', '1', $5::jsonb, '["G0299"]'::jsonb, 'demo-org-001', '20260116VACCN001',
              'office_ally', NULL, '2026-01-15 08:00:00', '2026-02-01 10:00:00'),
            ('demo-claim-va-002', 'demo-enc-002', $1, 'VA Community Care', $2, $3, $4, '2026-02-01', '12',
              'M79.3', '["Z23"]'::jsonb, 'VA-2026-10002', 163.56, 'denied', 22, 'RED',
              'Y', '1', $5::jsonb, '["G0299"]'::jsonb, 'demo-org-001', '20260203VACCN002',
              'office_ally', 'open', '2026-02-01 08:00:00', '2026-03-05 16:00:00'),
            ('demo-claim-va-003', 'demo-enc-003', $1, 'VA Community Care', $2, $3, $4, '2026-03-10', '12',
              'M79.3', '["Z23"]'::jsonb, 'VA-2026-10003', 327.12, 'submitted', 15, 'GREEN',
              'Y', '1', $6::jsonb, '["G0299"]'::jsonb, 'demo-org-001', NULL,
              'office_ally', NULL, '2026-03-10 08:00:00', '2026-03-11 09:00:00'),
            ('demo-claim-va-004', 'demo-enc-004', $1, 'VA Community Care', $2, $3, $4, '2026-03-28', '12',
              'M79.3', '["Z23"]'::jsonb, 'VA-2026-10004', 240.00, 'submitted', 20, 'YELLOW',
              'Y', '1', $7::jsonb, '["G0162"]'::jsonb, 'demo-org-001', NULL,
              'office_ally', 'open', '2026-03-28 08:00:00', '2026-03-29 09:00:00')
          ON CONFLICT (id) DO NOTHING
        `, [patientId, payerId, providerId, orderingProviderId, g0299x4, g0299x8, g0162x8]);

        await pool.query(`
          INSERT INTO claim_events (id, claim_id, type, timestamp, notes, organization_id) VALUES
            ('demo-evt-001', 'demo-claim-va-001', 'Submitted',    '2026-01-16 09:00:00', 'Submitted via Office Ally. ICN: 20260116VACCN001', 'demo-org-001'),
            ('demo-evt-002', 'demo-claim-va-001', 'Acknowledged', '2026-01-17 14:30:00', '277CA received — Accepted for adjudication', 'demo-org-001'),
            ('demo-evt-003', 'demo-claim-va-001', 'StatusChange', '2026-02-01 10:15:00', 'Payment posted. Check CHK-20260201-826 · $163.56', 'demo-org-001'),
            ('demo-evt-004', 'demo-claim-va-002', 'Submitted',    '2026-02-03 08:45:00', 'Submitted via Office Ally. ICN: 20260203VACCN002', 'demo-org-001'),
            ('demo-evt-005', 'demo-claim-va-002', 'Acknowledged', '2026-02-04 11:00:00', '277CA received — Accepted for adjudication', 'demo-org-001'),
            ('demo-evt-006', 'demo-claim-va-002', 'Denied',       '2026-03-05 16:20:00', 'Denied — CARC CO-96: Non-covered charge. Service not covered under VA-2026-10002 referral scope.', 'demo-org-001'),
            ('demo-evt-007', 'demo-claim-va-003', 'Submitted',    '2026-03-11 08:30:00', 'Submitted via Office Ally. ICN: 20260311VACCN003', 'demo-org-001'),
            ('demo-evt-008', 'demo-claim-va-003', 'Acknowledged', '2026-03-12 13:00:00', '277CA received — Accepted for adjudication', 'demo-org-001'),
            ('demo-evt-009', 'demo-claim-va-004', 'Submitted',    '2026-03-29 09:00:00', 'Submitted via Office Ally. ICN: 20260329VACCN004', 'demo-org-001')
          ON CONFLICT (id) DO NOTHING
        `);

        await pool.query(`
          INSERT INTO denials (id, claim_id, denial_category, denial_reason_text, payer, cpt_code, root_cause_tag, resolved, created_at, organization_id)
          VALUES ('demo-denial-001', 'demo-claim-va-002', 'Coverage', 'CO-96', 'VA Community Care', 'G0299', 'non_covered', false, '2026-03-05 16:20:00', 'demo-org-001')
          ON CONFLICT (id) DO NOTHING
        `);
        console.log("Seeded demo VA home health claims");
      }
    }

    // ── Seed Chajinel multi-visit home care demo claim (Maria Garcia, 6 visits) ─
    const { rows: chajClaimCheck } = await pool.query(`SELECT COUNT(*)::int as cnt FROM claims WHERE id = 'chajinel-claim-mv-001'`);
    if (chajClaimCheck[0].cnt === 0) {
      const { rows: [chajPt] } = await pool.query(`SELECT id FROM patients WHERE organization_id='chajinel-org-001' AND last_name='Garcia' AND first_name='TEST: Maria' LIMIT 1`);
      const { rows: chajProvRows } = await pool.query(`SELECT id FROM providers WHERE organization_id='chajinel-org-001' ORDER BY created_at LIMIT 1`);
      const { rows: [chajPayer] } = await pool.query(`SELECT id FROM payers WHERE name ILIKE '%medicare%' LIMIT 1`);

      if (chajPt && chajProvRows.length > 0) {
        const ptId = chajPt.id;
        const provId = chajProvRows[0].id;
        const payerId = chajPayer?.id || null;
        const payerName = chajPayer ? 'Medicare' : 'Medicare';
        // G0156: Home health aide, per 15 minutes. 16 units × $9.67 = $154.72 per visit.
        const g0156Rate = 9.67;
        const g0156Units = 16;
        const g0156Charge = parseFloat((g0156Rate * g0156Units).toFixed(2));
        const visitDates = ['2026-04-02', '2026-04-04', '2026-04-07', '2026-04-09', '2026-04-11', '2026-04-14'];
        const sl = visitDates.map(d => ({
          hcpcs_code: 'G0156', description: 'Home health aide or hospice aide services, per 15 minutes',
          units: g0156Units, rate_per_unit: g0156Rate, total_charge: g0156Charge,
          modifier: null, diagnosis_pointer: 'A', unit_type: 'per_15_min', manual_entry: false,
          service_date_from: d, service_date_to: null,
        }));
        const totalAmount = parseFloat((g0156Charge * visitDates.length).toFixed(2));
        const chajEncId = 'chajinel-enc-mv-001';
        await pool.query(`
          INSERT INTO encounters (id, patient_id, service_type, facility_type, admission_type, expected_start_date, organization_id, created_at)
          VALUES ($1,$2,'home_health','home','routine','2026-04-02','chajinel-org-001',NOW())
          ON CONFLICT (id) DO NOTHING
        `, [chajEncId, ptId]);
        await pool.query(`
          INSERT INTO claims (id, encounter_id, patient_id, payer, payer_id, provider_id, service_date,
            statement_period_start, statement_period_end,
            place_of_service, icd10_primary, icd10_secondary, amount, status,
            risk_score, readiness_status, homebound_indicator, claim_frequency_code,
            service_lines, cpt_codes, organization_id, submission_method, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,'2026-04-02','2026-04-02','2026-04-14','12','Z74.01','["M62.81"]'::jsonb,
            $7,'draft',10,'GREEN',true,'1',$8::jsonb,'["G0156"]'::jsonb,'chajinel-org-001',
            'stedi',NOW(),NOW())
          ON CONFLICT (id) DO NOTHING
        `, ['chajinel-claim-mv-001', chajEncId, ptId, payerName, payerId, provId, totalAmount, JSON.stringify(sl)]);
        console.log("[Seeder] Chajinel multi-visit home care demo claim seeded (Maria Garcia, 6×G0156)");
      }
    }

    // ── Seed ERA demo batches (835 remittance data) ────────────────────────────
    const { rows: eraCheck } = await pool.query(`SELECT COUNT(*)::int as cnt FROM era_batches WHERE id LIKE 'demo-era-%'`);
    if (eraCheck[0].cnt === 0) {
      const { rows: [ptRow] } = await pool.query(`SELECT first_name, last_name FROM patients WHERE member_id = 'VA651254344' LIMIT 1`);
      const patName = ptRow ? `${ptRow.first_name} ${ptRow.last_name}` : 'Megan Perez';

      await pool.query(`
        INSERT INTO era_batches (id, org_id, payer_name, check_number, payment_date, total_amount, status, created_at)
        VALUES
          ('demo-era-001', 'demo-org-001', 'VA Community Care', 'CHK-20260201-826', '2026-02-01', 163.56, 'unposted', NOW()),
          ('demo-era-002', 'demo-org-001', 'VA Community Care', 'CHK-20260412-827', '2026-04-12', 245.34, 'unposted', NOW()),
          ('demo-era-003', 'demo-org-001', 'VA Community Care', 'CHK-20260412-828', '2026-04-12', 0.00,   'unposted', NOW())
        ON CONFLICT (id) DO NOTHING
      `);

      await pool.query(`
        INSERT INTO era_lines (id, era_id, claim_id, org_id, patient_name, dos, billed_amount, allowed_amount, paid_amount, service_lines, status, created_at)
        VALUES
          ('demo-era-ln-001', 'demo-era-001', 'demo-claim-va-001', 'demo-org-001', $1, '2026-01-15',
            163.56, 163.56, 163.56,
            '[{"code":"G0299","units":4,"billed":163.56,"allowed":163.56,"paid":163.56,"adjustments":[]}]'::jsonb,
            'unposted', NOW()),
          ('demo-era-ln-002', 'demo-era-002', 'demo-claim-va-003', 'demo-org-001', $1, '2026-03-10',
            327.12, 245.34, 245.34,
            '[{"code":"G0299","units":8,"billed":327.12,"allowed":245.34,"paid":245.34,"adjustments":[{"carc":"CO-45","rarc":"N519","amount":81.78,"description":"Charge exceeds fee schedule/maximum allowable or contracted/legislated fee arrangement."}]}]'::jsonb,
            'unposted', NOW()),
          ('demo-era-ln-003', 'demo-era-003', 'demo-claim-va-002', 'demo-org-001', $1, '2026-02-01',
            163.56, 0.00, 0.00,
            '[{"code":"G0299","units":4,"billed":163.56,"allowed":0.00,"paid":0.00,"adjustments":[{"carc":"CO-96","rarc":"N130","amount":163.56,"description":"Non-covered charge(s). At least one Remark Code must be provided (may include NCPDP Reject Reason Code)."}]}]'::jsonb,
            'unposted', NOW())
        ON CONFLICT (id) DO NOTHING
      `, [patName]);
      console.log("Seeded demo ERA batches");
    }

    // ── Prompt A: document_types reference table ─────────────────────────────
    await seederLog('table', 'document_types');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS document_types (
        code VARCHAR PRIMARY KEY,
        label VARCHAR NOT NULL,
        typical_update_cadence VARCHAR,
        active_for_extraction BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      INSERT INTO document_types (code, label, typical_update_cadence, active_for_extraction) VALUES
        ('admin_guide',          'Administrative Guide',            'annual',        TRUE),
        ('supplement',           'Supplement to Admin Guide',       'annual',        TRUE),
        ('pa_list',              'Prior Authorization List',         'monthly',       TRUE),
        ('reimbursement_policy', 'Reimbursement Policy',            'quarterly',     FALSE),
        ('medical_policy',       'Medical Policy',                  'monthly',       FALSE),
        ('bulletin',             'Update Bulletin',                 'monthly',       FALSE),
        ('contract',             'Provider Contract / Agreement',   'per-contract',  FALSE),
        ('fee_schedule',         'Fee Schedule',                    'annual',        FALSE)
      ON CONFLICT (code) DO NOTHING
    `);

    // ── Prompt A: payer_source_documents table ──────────────────────────────
    await seederLog('table', 'payer_source_documents');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payer_source_documents (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        payer_id VARCHAR,
        document_type VARCHAR NOT NULL DEFAULT 'admin_guide' REFERENCES document_types(code) ON UPDATE CASCADE ON DELETE RESTRICT,
        parent_document_id VARCHAR REFERENCES payer_source_documents(id) ON DELETE SET NULL,
        document_name VARCHAR NOT NULL,
        source_url TEXT,
        file_content BYTEA,
        file_name VARCHAR,
        document_version VARCHAR,
        effective_start DATE,
        effective_end DATE,
        status VARCHAR NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','ready_for_review','completed','failed','superseded')),
        last_verified_date DATE,
        error_message TEXT,
        uploaded_by VARCHAR,
        organization_id VARCHAR,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_psd_payer ON payer_source_documents(payer_id, document_type)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_psd_parent ON payer_source_documents(parent_document_id) WHERE parent_document_id IS NOT NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_psd_effective ON payer_source_documents(payer_id, effective_start, effective_end)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_psd_status ON payer_source_documents(status) WHERE status IN ('pending','processing','ready_for_review')`);
    // Prompt A: payer_manuals → payer_source_documents is also accepted for 'failed' + 'completed' status values.
    // Relax the CHECK constraint to include those values from the legacy schema if needed.
    await pool.query(`
      ALTER TABLE payer_source_documents DROP CONSTRAINT IF EXISTS payer_source_documents_status_check
    `).catch(() => {});
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'psd_status_check'
        ) THEN
          ALTER TABLE payer_source_documents
            ADD CONSTRAINT psd_status_check
            CHECK (status IN ('pending','processing','ready_for_review','completed','failed','superseded'));
        END IF;
      END $$
    `).catch(() => {});

    await seederLog('table', 'manual_extraction_items');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS manual_extraction_items (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        source_document_id VARCHAR NOT NULL,
        section_type VARCHAR NOT NULL,
        raw_snippet TEXT,
        extracted_json JSONB,
        confidence REAL,
        review_status VARCHAR NOT NULL DEFAULT 'pending',
        reviewed_by VARCHAR,
        reviewed_at TIMESTAMP,
        applied_rule_id VARCHAR,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // ── Prompt A: one-time migration payer_manuals → payer_source_documents ───
    // Runs only if payer_manuals still exists (i.e., upgrading from pre-Prompt-A schema).
    // On a fresh database this block is a no-op because payer_manuals is never created.
    {
      const { rows: [pmCheck] } = await pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables WHERE table_name = 'payer_manuals'
        ) AS exists
      `);
      if (pmCheck.exists) {
        console.log("[SEEDER] Prompt A: payer_manuals detected — running migration to payer_source_documents…");

        // 1. Copy all payer_manuals rows into payer_source_documents (same IDs, payer_name → document_name)
        // Defensive: check which optional columns actually exist in payer_manuals before SELECT-ing them.
        const { rows: pmCols } = await pool.query(`
          SELECT column_name FROM information_schema.columns WHERE table_name = 'payer_manuals'
        `);
        const pmColSet = new Set(pmCols.map((r: any) => r.column_name));
        const docTypeExpr   = pmColSet.has('document_type')    ? `COALESCE(NULLIF(document_type,''), 'admin_guide')` : `'admin_guide'`;
        const parentIdExpr  = pmColSet.has('parent_document_id') ? 'parent_document_id' : 'NULL';
        const effStartExpr  = pmColSet.has('effective_start')  ? 'effective_start' : 'NULL';
        const effEndExpr    = pmColSet.has('effective_end')    ? 'effective_end'   : 'NULL';
        await pool.query(`
          INSERT INTO payer_source_documents (
            id, payer_id, document_type, parent_document_id, document_name,
            source_url, file_content, file_name, effective_start, effective_end,
            status, error_message, uploaded_by, organization_id, created_at, updated_at
          )
          SELECT
            id, payer_id,
            ${docTypeExpr},
            ${parentIdExpr},
            payer_name,
            source_url, file_content, file_name, ${effStartExpr}, ${effEndExpr},
            CASE WHEN status IN ('pending','processing','ready_for_review','completed','failed')
                 THEN status ELSE 'pending' END,
            error_message, uploaded_by, organization_id, created_at, updated_at
          FROM payer_manuals
          ON CONFLICT (id) DO NOTHING
        `);
        const { rows: [{ cnt: psdCnt }] } = await pool.query(`SELECT COUNT(*)::int AS cnt FROM payer_source_documents`);
        console.log(`[SEEDER] Prompt A: ${psdCnt} rows in payer_source_documents after copy`);

        // 2. Add source_document_id to manual_extraction_items (may already exist on retry)
        await pool.query(`ALTER TABLE manual_extraction_items ADD COLUMN IF NOT EXISTS source_document_id VARCHAR`);
        // Copy from manual_id
        await pool.query(`
          UPDATE manual_extraction_items SET source_document_id = manual_id
          WHERE source_document_id IS NULL AND manual_id IS NOT NULL
        `);

        // 3. Add linked_source_document_id to payer_manual_sources
        await pool.query(`ALTER TABLE payer_manual_sources ADD COLUMN IF NOT EXISTS linked_source_document_id VARCHAR`);
        await pool.query(`
          UPDATE payer_manual_sources SET linked_source_document_id = linked_manual_id
          WHERE linked_source_document_id IS NULL AND linked_manual_id IS NOT NULL
        `);

        // 4. Drop old FK + add new FK on payer_manual_sources
        await pool.query(`ALTER TABLE payer_manual_sources DROP CONSTRAINT IF EXISTS fk_pms_linked_manual`);
        await pool.query(`
          DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pms_linked_source_document') THEN
              ALTER TABLE payer_manual_sources
                ADD CONSTRAINT fk_pms_linked_source_document
                FOREIGN KEY (linked_source_document_id) REFERENCES payer_source_documents(id) ON DELETE SET NULL;
            END IF;
          END $$
        `).catch(() => {});

        // 5. Verify: no orphan extraction items
        const { rows: [{ cnt: orphanCnt }] } = await pool.query(`
          SELECT COUNT(*)::int AS cnt FROM manual_extraction_items
          WHERE source_document_id IS NOT NULL
            AND source_document_id NOT IN (SELECT id FROM payer_source_documents)
        `);
        if (parseInt(String(orphanCnt)) > 0) {
          console.error(`[SEEDER] Prompt A ERROR: ${orphanCnt} orphan manual_extraction_items — aborting payer_manuals drop`);
        } else {
          // 6. Drop legacy columns + table
          await pool.query(`ALTER TABLE manual_extraction_items DROP COLUMN IF EXISTS manual_id`);
          await pool.query(`ALTER TABLE payer_manual_sources DROP COLUMN IF EXISTS linked_manual_id`);
          await pool.query(`DROP TABLE payer_manuals`);
          console.log("[SEEDER] Prompt A: Migration complete. payer_manuals dropped. All FK chains updated.");
        }
      }
    }

    // ── Prompt B1: rule_kinds reference table ─────────────────────────────────
    await seederLog('table', 'rule_kinds');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rule_kinds (
        code VARCHAR PRIMARY KEY,
        label VARCHAR NOT NULL,
        description TEXT,
        ui_group VARCHAR NOT NULL DEFAULT 'Operational',
        active_in_extraction BOOLEAN NOT NULL DEFAULT TRUE,
        active_in_rules_engine BOOLEAN NOT NULL DEFAULT FALSE,
        sort_order INT NOT NULL DEFAULT 99,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Idempotent upsert of all 15 rule kinds (INSERT … ON CONFLICT DO UPDATE)
    await pool.query(`
      INSERT INTO rule_kinds (code, label, description, ui_group, active_in_extraction, active_in_rules_engine, sort_order) VALUES
        ('timely_filing',          'Timely Filing',               'Days from service date to submit a clean claim.',                                                                               'Operational', TRUE,  TRUE,  1),
        ('prior_auth',             'Prior Authorization',          'CPT/HCPCS codes and service categories requiring pre-approval before rendering.',                                              'Operational', TRUE,  TRUE,  2),
        ('modifiers_and_liability','Modifiers & Liability',        'Billing modifier requirements with conditional liability assignment (GA/GZ/GY, Mod 25/59/26/TC and more).',                   'Operational', TRUE,  TRUE,  3),
        ('appeals',                'Appeals & Reconsideration',    'Appeal deadlines, submission methods, required documents, and escalation levels.',                                            'Operational', TRUE,  TRUE,  4),
        ('referrals',              'Referral Requirements',        'Plan-product-specific PCP and specialist referral rules, exceptions, and liability when missing.',                            'Operational', TRUE,  FALSE, 5),
        ('coordination_of_benefits','Coordination of Benefits',   'Medicare Secondary Payer, Medicare crossover, dual-coverage billing order, and required EOB documentation.',                  'Operational', TRUE,  FALSE, 6),
        ('payer_specific_edits',   'Payer-Specific Edits',        'Clearinghouse-level Smart Edits, response windows, Return-and-Documentation vs Rejection edit categories.',                  'Technical',   TRUE,  FALSE, 7),
        ('edi_construction',       'EDI Construction',            'Field-level 837 format requirements: NDC formatting, segment/loop specs, qualifier codes, taxonomy requirements.',            'Technical',   TRUE,  FALSE, 8),
        ('place_of_service',       'Place of Service',            'POS code restrictions, facility vs non-facility distinctions, telehealth originating/distant site rules.',                   'Technical',   TRUE,  FALSE, 9),
        ('submission_timeframe',   'Submission Timeframes',        'How far in advance a request must be submitted before service (PA advance notice, home health prior notice, DME prior notice).','Timeframe', TRUE,  FALSE, 10),
        ('decision_timeframe',     'Decision Timeframes',          'How quickly the payer must respond to authorization requests (standard, expedited, urgent turnaround windows).',             'Timeframe',   TRUE,  FALSE, 11),
        ('documentation_timeframe','Documentation Timeframes',     'Deadlines for submitting medical records, discharge summaries, lab results, and audit documentation.',                       'Timeframe',   TRUE,  FALSE, 12),
        ('notification_event',     'Notification Events',          'Provider-to-payer notifications required at specific clinical events (inpatient admission, discharge, demographic change).', 'Timeframe',   TRUE,  FALSE, 13),
        ('member_notice',          'Member Notices',               'Required provider-to-member notices: ABN, NOMNC, IDN, advance written consent, termination of service notices.',            'Timeframe',   TRUE,  FALSE, 14),
        ('risk_adjustment_hcc',    'HCC / Risk Adjustment',        'HCC coding guidance, RAF score documentation, Medicare Advantage risk adjustment requirements.',                             'Strategic',   FALSE, FALSE, 15)
      ON CONFLICT (code) DO UPDATE SET
        label = EXCLUDED.label,
        description = EXCLUDED.description,
        ui_group = EXCLUDED.ui_group,
        active_in_extraction = EXCLUDED.active_in_extraction,
        active_in_rules_engine = EXCLUDED.active_in_rules_engine,
        sort_order = EXCLUDED.sort_order
    `);

    // ── Prompt B1: FK from manual_extraction_items.section_type → rule_kinds.code ──
    // ON UPDATE CASCADE: if a rule_kind code is renamed, existing rows follow.
    // ON DELETE RESTRICT: cannot delete a rule_kind while extraction items reference it.
    // Idempotent: ADD CONSTRAINT IF NOT EXISTS prevents duplicate-constraint errors.
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_name = 'manual_extraction_items'
            AND constraint_name = 'fk_mei_section_type_rule_kinds'
        ) THEN
          ALTER TABLE manual_extraction_items
          ADD CONSTRAINT fk_mei_section_type_rule_kinds
          FOREIGN KEY (section_type) REFERENCES rule_kinds(code)
          ON UPDATE CASCADE
          ON DELETE RESTRICT;
        END IF;
      END $$
    `);

    // ── Prompt B1: modifier migration — flag for manual remap ─────────────────
    // Rename 'modifiers' → 'modifiers_and_liability' and flag all rows for re-review
    // because the schema changed from flat text to conditional liability structure.
    {
      const { rowCount } = await pool.query(`
        UPDATE manual_extraction_items
        SET
          section_type       = 'modifiers_and_liability',
          needs_reverification = TRUE,
          notes = COALESCE(notes || E'\n', '') ||
                  '[needs_manual_remap] Schema changed from flat-text to conditional liability structure (GA/GZ/GY). ' ||
                  'Re-review required: add conditions_required, conditions_excluded, liability_assignment before approving.'
        WHERE section_type = 'modifiers'
      `);
      if ((rowCount ?? 0) > 0) {
        console.log(`[SEEDER] Prompt B1: migrated ${rowCount} modifier rows → modifiers_and_liability (flagged needs_manual_remap)`);
      }
    }

    // Seed 3 initial source documents (TriWest, Medicare, Aetna) for Phase 2 end-state
    const { rows: [{ cnt: psdSeedCnt }] } = await pool.query(
      "SELECT COUNT(*)::int AS cnt FROM payer_source_documents WHERE id = 'manual-triwest-001'"
    );
    if (psdSeedCnt === 0) {
      // Look up payer IDs for the 3 payers
      const { rows: triwestPayer } = await pool.query(`SELECT id FROM payers WHERE payer_id = 'TWVACCN' OR name ILIKE '%triwest%' LIMIT 1`);
      const { rows: medicarePayer } = await pool.query(`SELECT id FROM payers WHERE LOWER(name) LIKE '%medicare%' AND payer_classification = 'medicare_part_b' LIMIT 1`);
      const { rows: aetnaPayer } = await pool.query(`SELECT id FROM payers WHERE LOWER(name) LIKE '%aetna%' LIMIT 1`);

      const triwestPayerId = triwestPayer[0]?.id || null;
      const medicarePayerId = medicarePayer[0]?.id || null;
      const aetnaPayerId = aetnaPayer[0]?.id || null;

      await pool.query(`
        INSERT INTO payer_source_documents (id, payer_id, document_name, document_type, source_url, status, uploaded_by, created_at, updated_at) VALUES
        ('manual-triwest-001', $1, 'TriWest Healthcare Alliance (VA CCN)', 'admin_guide',
          'https://www.triwest.com/globalassets/documents/tools-and-resources/billing-guidelines.pdf',
          'completed', 'system', NOW(), NOW()),
        ('manual-medicare-001', $2, 'Medicare Part B (CMS)', 'admin_guide',
          'https://www.cms.gov/regulations-and-guidance/guidance/manuals/downloads/clm104c12.pdf',
          'completed', 'system', NOW(), NOW()),
        ('manual-aetna-001', $3, 'Aetna Commercial', 'admin_guide',
          'https://www.aetna.com/health-care-professionals/claims-payments-billing/filing-claims/billing-guidelines.html',
          'completed', 'system', NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `, [triwestPayerId, medicarePayerId, aetnaPayerId]);

      // Seed pre-approved extraction items for TriWest
      await pool.query(`
        INSERT INTO manual_extraction_items (id, source_document_id, section_type, raw_snippet, extracted_json, confidence, review_status, reviewed_by, reviewed_at, created_at) VALUES
        ('mei-tw-tf-001', 'manual-triwest-001', 'timely_filing',
          'Claims must be submitted within 180 days of the date of service. Claims submitted after 180 days will be denied for timely filing.',
          '{"days":180,"exceptions":["Coordination of benefits claims may have extended timelines","Retroactive eligibility determinations"],"source_text":"Claims must be submitted within 180 days of the date of service."}'::jsonb,
          0.95, 'approved', 'system', NOW(), NOW()),
        ('mei-tw-pa-001', 'manual-triwest-001', 'prior_auth',
          'All home health services rendered under the VA Community Care Network require a VA referral/authorization. Providers must have an approved referral from the VA before rendering services.',
          '{"cpt_codes":[],"requires_auth":true,"criteria":"VA referral required for all home health services. Authorization number must appear on every claim. Services rendered without prior VA referral will be denied.","threshold_units":null,"source_text":"All home health services rendered under the VA Community Care Network require a VA referral/authorization."}'::jsonb,
          0.93, 'approved', 'system', NOW(), NOW()),
        ('mei-tw-mod-001', 'manual-triwest-001', 'modifiers',
          'Telehealth services must be billed with modifier GT (via interactive audio and video telecommunications systems). Modifier 95 may be used for synchronous real-time interactive audio-video telehealth.',
          '{"modifier_code":"GT","description":"Via interactive audio and video telecommunications systems","payer_rule":"Required on all telehealth claims to TriWest. Modifier 95 is an acceptable alternative for synchronous telehealth.","source_text":"Telehealth services must be billed with modifier GT."}'::jsonb,
          0.88, 'approved', 'system', NOW(), NOW()),
        ('mei-tw-ap-001', 'manual-triwest-001', 'appeals',
          'Providers have 180 days from the date of the Explanation of Payment (EOP) to file a formal dispute or appeal. Appeals must be submitted in writing to TriWest Provider Relations.',
          '{"deadline_days":180,"level":"Formal Dispute / First Level Appeal","submission_method":"Written submission to TriWest Provider Relations (mail or fax)","requirements":["Copy of original claim","Explanation of Payment (EOP)","Supporting clinical documentation","Written explanation of dispute reason"],"source_text":"Providers have 180 days from the date of the Explanation of Payment (EOP) to file a formal dispute or appeal."}'::jsonb,
          0.91, 'approved', 'system', NOW(), NOW()),
        -- Medicare items
        ('mei-mc-tf-001', 'manual-medicare-001', 'timely_filing',
          'Medicare claims must be filed no later than 12 months (one calendar year) after the date of service. This is a strict deadline; claims filed after one year from the date of service will be denied.',
          '{"days":365,"exceptions":["Administrative error by Medicare contractor","Retroactive Medicare entitlement","Coordination of benefits with primary payer delays","Disaster/emergency situations"],"source_text":"Medicare claims must be filed no later than 12 months (one calendar year) after the date of service."}'::jsonb,
          0.97, 'approved', 'system', NOW(), NOW()),
        ('mei-mc-pa-001', 'manual-medicare-001', 'prior_auth',
          'Home health services require a face-to-face encounter with a physician or allowed non-physician practitioner within 90 days before or 30 days after the start of care. Documentation must support homebound status and medical necessity.',
          '{"cpt_codes":["G0299","G0300","G0151","G0152","G0153","G0154","G0155","G0156"],"requires_auth":true,"criteria":"Face-to-face encounter required within 90 days before or 30 days after home health start of care. Must document homebound status and medical necessity.","threshold_units":null,"source_text":"Home health services require a face-to-face encounter with a physician within 90 days before or 30 days after the start of care."}'::jsonb,
          0.92, 'approved', 'system', NOW(), NOW()),
        ('mei-mc-mod-001', 'manual-medicare-001', 'modifiers',
          'Physical therapy services must be billed with modifier GP (services delivered under an outpatient physical therapy plan of care). Occupational therapy uses modifier GO, and speech-language pathology uses modifier GN.',
          '{"modifier_code":"GP","description":"Services delivered under an outpatient physical therapy plan of care","payer_rule":"Required on all PT claims to Medicare. GO required for OT, GN required for SLP. KX modifier required when documentation supports medical necessity beyond therapy cap.","source_text":"Physical therapy services must be billed with modifier GP."}'::jsonb,
          0.94, 'approved', 'system', NOW(), NOW()),
        ('mei-mc-ap-001', 'manual-medicare-001', 'appeals',
          'First-level appeal (Redetermination) must be filed within 120 days of receiving the Medicare Summary Notice (MSN) or Remittance Advice (RA). Submit to the Medicare Administrative Contractor (MAC) that processed the original claim.',
          '{"deadline_days":120,"level":"Redetermination (Level 1)","submission_method":"Written or electronic submission to Medicare Administrative Contractor (MAC)","requirements":["Completed Medicare Redetermination Request form (CMS-20027)","Copy of original claim","Supporting clinical documentation","Explanation of why decision was incorrect"],"source_text":"First-level appeal (Redetermination) must be filed within 120 days of receiving the Medicare Summary Notice or Remittance Advice."}'::jsonb,
          0.96, 'approved', 'system', NOW(), NOW()),
        -- Aetna items
        ('mei-ae-tf-001', 'manual-aetna-001', 'timely_filing',
          'Initial claims must be submitted within 180 days of the date of service. For coordination of benefits (COB) claims where Aetna is the secondary payer, the filing limit is 180 days from the primary payer''s explanation of benefits.',
          '{"days":180,"exceptions":["COB/secondary claims: 180 days from primary EOB","Retroactive enrollment: 180 days from enrollment date","Newborn coverage: special rules apply"],"source_text":"Initial claims must be submitted within 180 days of the date of service."}'::jsonb,
          0.94, 'approved', 'system', NOW(), NOW()),
        ('mei-ae-pa-001', 'manual-aetna-001', 'prior_auth',
          'Physical therapy and occupational therapy services require prior authorization after 20 visits per benefit year. Authorization requests must be submitted at least 5 business days before the 21st visit.',
          '{"cpt_codes":["97110","97530","97112","97116","97035","97140","97010","97018","97032","97033","97034","97150"],"requires_auth":true,"criteria":"PT and OT services require prior auth after 20 visits per benefit year. Submit auth request at least 5 business days before 21st visit.","threshold_units":20,"source_text":"Physical therapy and occupational therapy services require prior authorization after 20 visits per benefit year."}'::jsonb,
          0.90, 'approved', 'system', NOW(), NOW()),
        ('mei-ae-mod-001', 'manual-aetna-001', 'modifiers',
          'Modifier 59 (Distinct Procedural Service) must be appended when billing multiple procedures on the same date of service where bundling edits would otherwise apply. Append modifier 59 to the procedure that would otherwise be bundled.',
          '{"modifier_code":"59","description":"Distinct Procedural Service — procedure not ordinarily performed on the same day","payer_rule":"Required when billing multiple procedures on same DOS that would be bundled. Append to secondary procedure. Aetna may request documentation justifying separate billing.","source_text":"Modifier 59 must be appended when billing multiple procedures on the same date of service where bundling edits would otherwise apply."}'::jsonb,
          0.87, 'approved', 'system', NOW(), NOW()),
        ('mei-ae-ap-001', 'manual-aetna-001', 'appeals',
          'Providers may submit a claim dispute within 180 days of the original claim determination date. Disputes may be submitted online through the Aetna provider portal, by fax to Provider Services, or by mail.',
          '{"deadline_days":180,"level":"First Level Claim Dispute","submission_method":"Aetna provider portal (preferred), fax to Provider Services, or mail","requirements":["Completed claim dispute form","Copy of original claim and remittance advice","Clinical documentation supporting billing","Explanation of dispute reason"],"source_text":"Providers may submit a claim dispute within 180 days of the original claim determination date."}'::jsonb,
          0.93, 'approved', 'system', NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `);

      // Now update payer timely_filing_days from approved extractions
      await pool.query(`UPDATE payers SET timely_filing_days = 180 WHERE id = $1 AND timely_filing_days != 180`, [triwestPayerId]).catch(() => {});
      await pool.query(`UPDATE payers SET timely_filing_days = 365 WHERE id = $1 AND timely_filing_days != 365`, [medicarePayerId]).catch(() => {});
      await pool.query(`UPDATE payers SET timely_filing_days = 180 WHERE id = $1 AND timely_filing_days != 180`, [aetnaPayerId]).catch(() => {});

      // Seed approved rules from extraction for TriWest modifiers/appeals
      await pool.query(`
        INSERT INTO rules (id, name, description, trigger_pattern, prevention_action, payer, enabled, specialty_tags, created_at)
        VALUES
        ('rule-from-manual-tw-mod', 'TriWest: GT Modifier Required for Telehealth',
          'TriWest CCN requires modifier GT (interactive audio/video) on all telehealth claims. Modifier 95 is an acceptable alternative for synchronous telehealth.',
          'telehealth,remote,video',
          'Append modifier GT to all telehealth service lines billed to TriWest. Alternatively, use modifier 95 for synchronous real-time telehealth.',
          'TriWest Healthcare Alliance', true, ARRAY['VA Community Care'], NOW()),
        ('rule-from-manual-tw-ap', 'TriWest: 180-Day Timely Filing Limit',
          'TriWest CCN requires claims within 180 days of date of service. Claims submitted after 180 days will be denied.',
          'triwest,va_community_care',
          'Verify claim is within 180-day timely filing window before submission to TriWest.',
          'TriWest Healthcare Alliance', true, ARRAY['VA Community Care'], NOW()),
        ('rule-from-manual-mc-mod', 'Medicare: GP/GO/GN Modifier Required for Therapy',
          'Medicare requires modifier GP for physical therapy, GO for occupational therapy, GN for speech-language pathology. KX modifier required when exceeding therapy cap with supporting documentation.',
          'medicare,therapy,pt,ot,slp',
          'Append GP to PT claims, GO to OT claims, GN to SLP claims billed to Medicare.',
          'Medicare', true, ARRAY['Medicare','Home Health'], NOW()),
        ('rule-from-manual-ae-mod', 'Aetna: Modifier 59 for Multiple Same-Day Procedures',
          'Aetna requires modifier 59 when billing multiple procedures on the same DOS that would otherwise be bundled.',
          'aetna,multiple_procedures,same_day',
          'Append modifier 59 to secondary procedure(s) when billing multiple same-day services to Aetna.',
          'Aetna', true, ARRAY['Universal'], NOW())
        ON CONFLICT (id) DO NOTHING
      `);

      // Link applied_rule_id back to modifier/appeals extraction items only (not timely_filing)
      await pool.query(`UPDATE manual_extraction_items SET applied_rule_id = 'rule-from-manual-tw-mod' WHERE id = 'mei-tw-mod-001'`).catch(() => {});
      await pool.query(`UPDATE manual_extraction_items SET applied_rule_id = 'rule-from-manual-mc-mod' WHERE id = 'mei-mc-mod-001'`).catch(() => {});
      await pool.query(`UPDATE manual_extraction_items SET applied_rule_id = 'rule-from-manual-ae-mod' WHERE id = 'mei-ae-mod-001'`).catch(() => {});
      // Timely filing items update payers directly — no rule link
      await pool.query(`UPDATE manual_extraction_items SET applied_rule_id = NULL WHERE id IN ('mei-tw-tf-001','mei-mc-tf-001','mei-ae-tf-001')`).catch(() => {});

      console.log("[SEEDER] Seeded 3 payer manuals (TriWest, Medicare, Aetna) with approved extraction items");
    }

    // Idempotent fix: ensure timely filing items never have an applied_rule_id
    await pool.query(`UPDATE manual_extraction_items SET applied_rule_id = NULL WHERE section_type = 'timely_filing' AND applied_rule_id IS NOT NULL`).catch(() => {});

    // ── Phase 4: Payer Manual Source Registry ──────────────────────────────
    await seederLog('table', 'payer_manual_sources');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payer_manual_sources (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        payer_name VARCHAR NOT NULL,
        canonical_url TEXT,
        last_verified_date DATE,
        notes TEXT,
        priority INTEGER NOT NULL DEFAULT 99,
        linked_source_document_id VARCHAR,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    // Prompt A: ensure linked_source_document_id column exists (migration block may have added it already)
    await pool.query(`ALTER TABLE payer_manual_sources ADD COLUMN IF NOT EXISTS linked_source_document_id VARCHAR`).catch(() => {});
    // Harden referential integrity: linked_source_document_id → payer_source_documents(id); ON DELETE SET NULL
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_pms_linked_source_document'
        ) THEN
          ALTER TABLE payer_manual_sources
            ADD CONSTRAINT fk_pms_linked_source_document
            FOREIGN KEY (linked_source_document_id) REFERENCES payer_source_documents(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `).catch(() => {}); // non-fatal: races or ordering issues should not break startup
    // Always run; ON CONFLICT (id) DO NOTHING makes this safe on repeated boots.
    // Unconditional upsert ensures partial-population states (e.g., manual table cleanup)
    // are automatically corrected without requiring a full DB wipe.
    await pool.query(`
        INSERT INTO payer_manual_sources (id, payer_name, canonical_url, priority, notes) VALUES
        ('pms-001', 'UnitedHealthcare Commercial', 'https://www.uhcprovider.com/content/dam/provider/docs/public/policies/comm-reimbursement/COMM-Billing-Coding-Guide.pdf', 1, 'UHC Commercial billing guidelines — text PDF, publicly accessible'),
        ('pms-002', 'Blue Cross Blue Shield (National)', 'https://www.bcbs.com/sites/default/files/file-attachments/health-of-america-report/HOA-Billing-Guidelines.pdf', 2, 'BCBS national guidelines; state plans may have additional local addenda'),
        ('pms-003', 'Cigna Commercial', 'https://www.cigna.com/static/www-cigna-com/docs/health-care-providers/resources/clinical-payment-reimbursement-policies.pdf', 3, 'Cigna clinical payment and reimbursement policy overview'),
        ('pms-004', 'Humana Commercial', 'https://www.humana.com/provider/medical-resources/billing-and-reimbursement/billing-coding-guidelines', 4, 'Humana billing and coding guidelines page — may require provider portal login for PDF'),
        ('pms-005', 'Aetna Commercial', 'https://www.aetna.com/health-care-professionals/provider-education-manuals/billing-guide.html', 5, 'Aetna commercial provider billing guide (covered in Phase 2 seed)'),
        ('pms-006', 'Centene / WellCare', 'https://www.wellcare.com/en/Provider/Manuals-and-Guidelines', 6, 'WellCare / Centene provider manual portal — publicly navigable'),
        ('pms-007', 'Molina Healthcare', 'https://www.molinahealthcare.com/providers/resources/manuals/pdf/ProviderManual.pdf', 7, 'Molina provider operations manual — available via public provider portal'),
        ('pms-008', 'Elevance Health (Anthem)', 'https://www.anthem.com/provider/policies-and-guidelines/', 8, 'Anthem / Elevance Health provider policy and guidelines hub'),
        ('pms-009', 'Kaiser Permanente', 'https://providers.kaiserpermanente.org/wps/portal/provider/portal', 9, 'Kaiser provider portal — billing guidelines require provider enrollment for direct download'),
        ('pms-010', 'Health Net', 'https://www.healthnet.com/portal/provider/content/providermanuals.action', 10, 'Health Net provider manuals page'),
        ('pms-011', 'AmeriHealth Caritas', 'https://www.amerihealthcaritas.com/providers/resources/provider-manual.aspx', 11, 'AmeriHealth Caritas provider manual index'),
        ('pms-012', 'Tufts Health Plan', 'https://tuftshealthplan.com/provider/provider-manual', 12, 'Tufts Health Plan commercial provider manual'),
        ('pms-013', 'HCSC (Health Care Service Corp)', 'https://www.hcsc.com/providers/billing-and-claims', 13, 'HCSC billing and claims guidelines covering BCBS IL, TX, OK, NM, MT'),
        ('pms-014', 'Highmark', 'https://www.highmarkprc.com/provider-reference-center.shtml', 14, 'Highmark provider reference center — billing and reimbursement policies'),
        ('pms-015', 'Capital BlueCross', 'https://www.capbluecross.com/wps/portal/cap/provider/billing-payment', 15, 'Capital BlueCross provider billing and payment guidelines'),
        ('pms-016', 'Medica', 'https://www.medica.com/providers/provider-manual', 16, 'Medica provider manual — available publicly without login'),
        ('pms-017', 'Priority Health', 'https://www.priorityhealth.com/provider/manuals-and-guides', 17, 'Priority Health provider manuals and guides page'),
        ('pms-018', 'Independence Blue Cross', 'https://www.ibx.com/providers/forms-and-guidelines/billing-guidelines', 18, 'IBX provider billing guidelines hub'),
        ('pms-019', 'Oscar Health', 'https://www.hioscar.com/health/provider-resources', 19, 'Oscar Health provider resources — billing policies publicly accessible'),
        ('pms-020', 'Bright Health / Friday Health', 'https://www.brighthealthplan.com/providers/resources', 20, 'Bright Health / Friday Health provider resources (company in wind-down; may have limited updates)')
        ON CONFLICT (id) DO NOTHING
    `);
    console.log("[SEEDER] Seeded/verified 20 payer_manual_sources (Phase 4 top-20 commercial payer registry)");
    // Deterministic source→document linkage (Phase 2 seed → Phase 4 source registry)
    // pms-005 = Aetna Commercial ↔ manual-aetna-001 (Phase 2 seed)
    await pool.query(`UPDATE payer_manual_sources SET linked_source_document_id = 'manual-aetna-001' WHERE id = 'pms-005' AND linked_source_document_id IS NULL`).catch(() => {});

    // Idempotent: seed payer_auth_requirements from approved prior-auth extraction items
    {
      const { rows: triwestPayerForPAR } = await pool.query(`SELECT id, name FROM payers WHERE payer_id = 'TWVACCN' OR name ILIKE '%triwest%' LIMIT 1`).catch(() => ({ rows: [] }));
      const { rows: medicarePayerForPAR } = await pool.query(`SELECT id, name FROM payers WHERE LOWER(name) LIKE '%medicare%' AND payer_classification = 'medicare_part_b' LIMIT 1`).catch(() => ({ rows: [] }));
      const { rows: aetnaPayerForPAR } = await pool.query(`SELECT id, name FROM payers WHERE LOWER(name) LIKE '%aetna%' LIMIT 1`).catch(() => ({ rows: [] }));

      if (triwestPayerForPAR[0]?.id) {
        await pool.query(`
          INSERT INTO payer_auth_requirements (payer_id, payer_name, code, code_type, auth_required, auth_conditions, notes)
          VALUES ($1, $2, '*', 'HCPCS', true, 'VA referral required for all home health services. Authorization number must appear on every claim.', 'Source: TriWest Healthcare Alliance Manual (Phase 2 ingestion)')
          ON CONFLICT (payer_id, code) DO NOTHING
        `, [triwestPayerForPAR[0].id, triwestPayerForPAR[0].name]).catch(() => {});
      }
      if (medicarePayerForPAR[0]?.id) {
        const medicareCodes = ['G0299','G0300','G0151','G0152','G0153','G0154','G0155','G0156'];
        for (const code of medicareCodes) {
          await pool.query(`
            INSERT INTO payer_auth_requirements (payer_id, payer_name, code, code_type, auth_required, auth_conditions, notes)
            VALUES ($1, $2, $3, 'HCPCS', true, 'Face-to-face encounter required within 90 days before or 30 days after home health start of care. Must document homebound status and medical necessity.', 'Source: Medicare Part B Manual (Phase 2 ingestion)')
            ON CONFLICT (payer_id, code) DO NOTHING
          `, [medicarePayerForPAR[0].id, medicarePayerForPAR[0].name, code]).catch(() => {});
        }
      }
      if (aetnaPayerForPAR[0]?.id) {
        const aetnaCodes = ['97110','97530','97112','97116','97035','97140','97010','97018','97032','97033','97034','97150'];
        for (const code of aetnaCodes) {
          await pool.query(`
            INSERT INTO payer_auth_requirements (payer_id, payer_name, code, code_type, auth_required, auth_conditions, notes)
            VALUES ($1, $2, $3, 'HCPCS', true, 'PT and OT services require prior auth after 20 visits per benefit year. Submit auth request at least 5 business days before 21st visit.', 'Source: Aetna Commercial Manual (Phase 2 ingestion)')
            ON CONFLICT (payer_id, code) DO NOTHING
          `, [aetnaPayerForPAR[0].id, aetnaPayerForPAR[0].name, code]).catch(() => {});
        }
      }
    }

    // Prompt 01 — Plan Product Dimension
    await seederLog('column', 'patients', 'plan_product');
    await pool.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS plan_product TEXT CHECK (plan_product IN ('HMO','PPO','POS','EPO','Indemnity','unknown') OR plan_product IS NULL)`);
    await seederLog('column', 'claims', 'plan_product');
    await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS plan_product TEXT CHECK (plan_product IN ('HMO','PPO','POS','EPO','Indemnity','unknown') OR plan_product IS NULL)`);
    await seederLog('column', 'manual_extraction_items', 'applies_to_plan_products');
    await pool.query(`ALTER TABLE manual_extraction_items ADD COLUMN IF NOT EXISTS applies_to_plan_products JSONB DEFAULT '["all"]'::jsonb`);

    // ── Flow Engine Tables ─────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS flows (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name VARCHAR NOT NULL,
        description TEXT,
        trigger_event VARCHAR NOT NULL,
        trigger_conditions JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        organization_id VARCHAR,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS flow_steps (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        flow_id VARCHAR NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
        step_order INTEGER NOT NULL,
        step_type VARCHAR NOT NULL,
        channel VARCHAR,
        delay_minutes INTEGER DEFAULT 0,
        template_inline TEXT,
        config JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_flow_steps_flow_id ON flow_steps(flow_id, step_order)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS flow_runs (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        flow_id VARCHAR NOT NULL REFERENCES flows(id),
        lead_id TEXT NOT NULL REFERENCES leads(id),
        status VARCHAR NOT NULL DEFAULT 'running',
        current_step_index INTEGER DEFAULT 0,
        next_action_at TIMESTAMP,
        started_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP,
        organization_id VARCHAR,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_flow_runs_due ON flow_runs(status, next_action_at)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_flow_runs_lead ON flow_runs(lead_id)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS flow_run_events (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        flow_run_id VARCHAR NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
        event_type VARCHAR NOT NULL,
        step_id VARCHAR,
        payload JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_flow_run_events_run ON flow_run_events(flow_run_id)`);

    // Retry cap columns
    await pool.query(`ALTER TABLE flow_runs ADD COLUMN IF NOT EXISTS attempt_count INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE flow_runs ADD COLUMN IF NOT EXISTS failure_reason TEXT`);
    await pool.query(`ALTER TABLE flow_steps ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 3`);

    // ── Multi-tenancy refactor Phase A.2 — extend existing flow tables ──────────
    await pool.query(`ALTER TABLE flows ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`);
    await pool.query(`ALTER TABLE flow_steps ADD COLUMN IF NOT EXISTS condition JSONB`);
    await pool.query(`ALTER TABLE flow_steps ADD COLUMN IF NOT EXISTS success_criteria JSONB`);
    await pool.query(`ALTER TABLE flow_steps ADD COLUMN IF NOT EXISTS template_key TEXT`);
    await pool.query(`ALTER TABLE flow_runs ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE comm_locks ADD COLUMN IF NOT EXISTS released_reason TEXT`);
    await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS contact_email TEXT`);
    await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`);
    await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);

    // One-time: mark stuck flow run as failed so the orchestrator stops retrying it
    await pool.query(`
      UPDATE flow_runs SET status = 'failed', updated_at = NOW()
      WHERE id = 'e548ff29-afe6-4df0-947c-c4790835e364' AND status != 'failed'
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS comm_locks (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
        lead_id TEXT NOT NULL,
        acquired_by_type VARCHAR NOT NULL,
        acquired_by_id VARCHAR NOT NULL,
        channel VARCHAR NOT NULL,
        reason TEXT,
        expires_at TIMESTAMP NOT NULL,
        released_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_comm_locks_lead ON comm_locks(lead_id, released_at, expires_at)`);

    // ── Multi-tenancy refactor Phase A.2 — indexes ──────────────────────────────
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_flows_org_active ON flows(organization_id, is_active)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_flow_runs_org ON flow_runs(organization_id, status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_flow_runs_due_partial ON flow_runs(status, next_action_at) WHERE status = 'running'`);

    // ── Multi-tenancy refactor Phase A.3 — per-org configuration tables ─────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS org_message_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        template_key TEXT NOT NULL,
        channel TEXT NOT NULL CHECK (channel IN ('sms', 'email', 'voice')),
        subject TEXT,
        body TEXT NOT NULL,
        variables JSONB NOT NULL DEFAULT '[]'::jsonb,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(organization_id, template_key, channel)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS org_service_types (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        service_code TEXT NOT NULL,
        service_name TEXT NOT NULL,
        description TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        is_active BOOLEAN NOT NULL DEFAULT true,
        UNIQUE(organization_id, service_code)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS org_payer_mappings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        payer_name TEXT NOT NULL,
        payer_id TEXT NOT NULL,
        payer_type TEXT,
        is_primary BOOLEAN NOT NULL DEFAULT false,
        is_active BOOLEAN NOT NULL DEFAULT true,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS org_voice_personas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        persona_key TEXT NOT NULL,
        vapi_assistant_id TEXT NOT NULL,
        persona_name TEXT NOT NULL,
        greeting TEXT,
        system_prompt TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        is_active BOOLEAN NOT NULL DEFAULT true,
        UNIQUE(organization_id, persona_key)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS org_lead_sources (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        slug TEXT NOT NULL,
        label TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK (source_type IN ('web', 'phone', 'referral', 'partner', 'campaign')),
        is_active BOOLEAN NOT NULL DEFAULT true,
        UNIQUE(organization_id, slug)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS org_providers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        npi TEXT,
        email TEXT,
        phone TEXT,
        specialties JSONB NOT NULL DEFAULT '[]'::jsonb,
        service_types JSONB NOT NULL DEFAULT '[]'::jsonb,
        languages JSONB NOT NULL DEFAULT '["en"]'::jsonb,
        availability JSONB NOT NULL DEFAULT '{}'::jsonb,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        is_active BOOLEAN NOT NULL DEFAULT true
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS step_types (
        step_type TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        category TEXT NOT NULL,
        config_schema JSONB NOT NULL,
        description TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true
      )
    `);

    await pool.query(`
      INSERT INTO step_types (step_type, display_name, category, config_schema, description) VALUES
        ('wait', 'Wait', 'control', '{}'::jsonb, 'Delays flow execution by step.delay_minutes'),
        ('sms_message', 'SMS Message', 'communication', '{"required": ["template_key"]}'::jsonb, 'Sends SMS via Twilio using org template'),
        ('voice_call', 'AI Voice Call', 'communication', '{"required": ["persona_key"]}'::jsonb, 'Initiates Vapi voice call using org persona'),
        ('email_message', 'Email Message', 'communication', '{"required": ["template_key"]}'::jsonb, 'Sends email via Gmail using org template'),
        ('vob_check', 'Insurance Verification', 'verification', '{"required": ["vendor"]}'::jsonb, 'Runs VOB via Stedi or other vendor'),
        ('provider_match', 'Provider Matching', 'logic', '{}'::jsonb, 'Matches lead to org provider based on rules'),
        ('appointment_schedule', 'Schedule Appointment', 'logic', '{"required": ["mode"]}'::jsonb, 'Schedules appointment (auto or manual_handoff)'),
        ('webhook', 'External Webhook', 'integration', '{"required": ["url", "method"]}'::jsonb, 'Calls external endpoint with run context'),
        ('conditional', 'Conditional Branch', 'logic', '{"required": ["condition"]}'::jsonb, 'Skip step if condition false (handled at executor level via flow_steps.condition)')
      ON CONFLICT (step_type) DO NOTHING
    `);

    // Add dob column to leads (needed by VOB step — transcript extractor captures it from the call)
    if (!(await seederLog('column', 'leads', 'dob'))) {
      await pool.query(`ALTER TABLE leads ADD COLUMN dob TEXT`);
    }

    // ── CCI Edits (NCCI Practitioner PTP) — global reference table ────────────
    if (!(await seederLog('table', 'cci_edits'))) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS cci_edits (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          column_1_code TEXT NOT NULL,
          column_2_code TEXT NOT NULL,
          modifier_indicator TEXT NOT NULL,
          effective_date DATE NOT NULL,
          deletion_date DATE,
          ptp_edit_rationale TEXT,
          ncci_version TEXT NOT NULL,
          source_file TEXT NOT NULL,
          ingested_at TIMESTAMP DEFAULT NOW(),
          UNIQUE (column_1_code, column_2_code, effective_date, ncci_version)
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_cci_edits_column_1 ON cci_edits (column_1_code)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_cci_edits_column_2 ON cci_edits (column_2_code)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_cci_edits_active ON cci_edits (column_1_code, column_2_code) WHERE deletion_date IS NULL`);
    }

    // ── Timely Filing Guardian — claims columns (Prompt 04 T1) ─────────────────
    await seederLog('column', 'claims', 'timely_filing_deadline');
    await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS timely_filing_deadline DATE`).catch(() => {});
    await seederLog('column', 'claims', 'timely_filing_days_remaining');
    await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS timely_filing_days_remaining INTEGER`).catch(() => {});
    await seederLog('column', 'claims', 'timely_filing_status');
    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE claims ADD COLUMN IF NOT EXISTS timely_filing_status TEXT;
        ALTER TABLE claims DROP CONSTRAINT IF EXISTS chk_timely_filing_status;
        ALTER TABLE claims ADD CONSTRAINT chk_timely_filing_status
          CHECK (timely_filing_status IN ('safe','caution','urgent','critical','expired') OR timely_filing_status IS NULL);
      EXCEPTION WHEN others THEN NULL;
      END $$;
    `).catch(() => {});
    await seederLog('column', 'claims', 'timely_filing_last_evaluated_at');
    await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS timely_filing_last_evaluated_at TIMESTAMP`).catch(() => {});

    // ── Timely Filing Guardian — alerts table (Prompt 04 T1) ───────────────────
    if (!(await seederLog('table', 'timely_filing_alerts'))) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS timely_filing_alerts (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
          claim_id VARCHAR NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
          organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          alert_status TEXT NOT NULL,
          days_remaining INTEGER NOT NULL,
          deadline_date DATE NOT NULL,
          alert_method TEXT NOT NULL DEFAULT 'in_app',
          alert_sent_at TIMESTAMP DEFAULT NOW(),
          alert_acknowledged_at TIMESTAMP,
          alert_acknowledged_by TEXT,
          snoozed_until TIMESTAMP,
          UNIQUE (claim_id, alert_status)
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_tf_alerts_org_unack
          ON timely_filing_alerts (organization_id, alert_acknowledged_at)
          WHERE alert_acknowledged_at IS NULL
      `).catch(() => {});
    }

    // ── PCP Referral Capture (Prompt 05 T1) ─────────────────────────────────
    if (!(await seederLog('table', 'pcp_referrals'))) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS pcp_referrals (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
          organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          patient_id VARCHAR NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
          pcp_name TEXT NOT NULL,
          pcp_npi TEXT,
          pcp_phone TEXT,
          pcp_practice_name TEXT,
          referral_number TEXT,
          issue_date DATE NOT NULL,
          expiration_date DATE,
          visits_authorized INTEGER,
          visits_used INTEGER DEFAULT 0,
          specialty_authorized TEXT,
          diagnosis_authorized TEXT,
          captured_via TEXT NOT NULL DEFAULT 'manual_entry',
          captured_by TEXT NOT NULL,
          captured_at TIMESTAMP DEFAULT NOW(),
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active','expired','used_up','revoked','pending_verification'))
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_pcp_ref_patient ON pcp_referrals (patient_id)`).catch(() => {});
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_pcp_ref_org_active ON pcp_referrals (organization_id, status) WHERE status = 'active'`).catch(() => {});
    }

    // New columns on claims for PCP referral tracking
    if (!(await seederLog('column', 'claims', 'pcp_referral_id'))) {
      await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS pcp_referral_id VARCHAR REFERENCES pcp_referrals(id) ON DELETE SET NULL`).catch((e: any) => console.error('[SEEDER] pcp_referral_id:', e.message));
    }
    if (!(await seederLog('column', 'claims', 'pcp_referral_required'))) {
      await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS pcp_referral_required BOOLEAN DEFAULT NULL`).catch(() => {});
    }
    if (!(await seederLog('column', 'claims', 'pcp_referral_check_status'))) {
      await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS pcp_referral_check_status TEXT CHECK (pcp_referral_check_status IN ('not_required','present_valid','present_expired','present_used_up','missing','unknown') OR pcp_referral_check_status IS NULL)`).catch(() => {});
    }

    // ── Prompt 06: Rules Versioning ──────────────────────────────────────────
    if (!(await seederLog('column', 'claims', 'rules_snapshot'))) {
      await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS rules_snapshot JSONB`);
    }
    if (!(await seederLog('column', 'claims', 'rules_engine_version'))) {
      await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS rules_engine_version TEXT`);
    }
    if (!(await seederLog('column', 'claims', 'ncci_version_at_creation'))) {
      await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS ncci_version_at_creation TEXT`);
    }

    // Extraction history table
    if (!(await seederLog('table', 'payer_manual_extraction_history'))) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS payer_manual_extraction_history (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          extraction_id VARCHAR NOT NULL,
          changed_at TIMESTAMP DEFAULT NOW(),
          changed_by TEXT NOT NULL,
          change_type TEXT NOT NULL CHECK (change_type IN ('created','edited','approved','rejected','reopened','data_corrected','needs_reverification')),
          state_snapshot JSONB NOT NULL,
          change_notes TEXT,
          payer_name TEXT,
          section_type TEXT
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_extraction_history_extraction ON payer_manual_extraction_history (extraction_id, changed_at DESC)`).catch(() => {});
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_extraction_history_changed_at ON payer_manual_extraction_history (changed_at DESC)`).catch(() => {});
    }

    // Extra columns on manual_extraction_items
    if (!(await seederLog('column', 'manual_extraction_items', 'last_verified_at'))) {
      await pool.query(`ALTER TABLE manual_extraction_items ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMP`);
      // Backfill: set last_verified_at = reviewed_at for already-approved items
      await pool.query(`UPDATE manual_extraction_items SET last_verified_at = reviewed_at WHERE review_status = 'approved' AND reviewed_at IS NOT NULL`).catch(() => {});
    }
    if (!(await seederLog('column', 'manual_extraction_items', 'needs_reverification'))) {
      await pool.query(`ALTER TABLE manual_extraction_items ADD COLUMN IF NOT EXISTS needs_reverification BOOLEAN DEFAULT FALSE`);
    }
    if (!(await seederLog('column', 'manual_extraction_items', 'is_demo_seed'))) {
      await pool.query(`ALTER TABLE manual_extraction_items ADD COLUMN IF NOT EXISTS is_demo_seed BOOLEAN NOT NULL DEFAULT FALSE`);
      await pool.query(`UPDATE manual_extraction_items SET is_demo_seed = TRUE WHERE notes ILIKE '%[demo_seed]%'`);
    }

    // ── Soft-delete / archive columns ────────────────────────────────────────
    await pool.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP`).catch(() => {});
    await pool.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS archived_by TEXT`).catch(() => {});
    await pool.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS archive_reason TEXT`).catch(() => {});
    await pool.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE`).catch(() => {});
    await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP`).catch(() => {});
    await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS archived_by TEXT`).catch(() => {});
    // ── Multi-visit home care billing statement period ──────────────────────
    await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS statement_period_start DATE`).catch(() => {});
    await pool.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS statement_period_end DATE`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_patients_archived ON patients (organization_id) WHERE archived_at IS NULL`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_claims_archived ON claims (organization_id) WHERE archived_at IS NULL`).catch(() => {});
    // Mark Chajinel demo patients as is_demo
    await pool.query(`
      UPDATE patients SET is_demo = TRUE
      WHERE organization_id = 'chajinel-org-001'
        AND first_name ILIKE 'TEST:%'
        AND is_demo = FALSE
    `).catch(() => {});

    // ── Prompt C0: field_definitions reference table ────────────────────────
    if (!(await seederLog('table', 'field_definitions'))) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS field_definitions (
          code          VARCHAR PRIMARY KEY,
          label         VARCHAR NOT NULL,
          applies_to    VARCHAR NOT NULL CHECK (applies_to IN ('patient','claim')),
          data_type     VARCHAR NOT NULL,
          always_required BOOLEAN NOT NULL DEFAULT FALSE,
          activated_by_rule_kinds JSONB NOT NULL DEFAULT '[]'::JSONB
        )
      `);
    }
    // Seed the 11 universal baseline fields (idempotent)
    await pool.query(`
      INSERT INTO field_definitions (code, label, applies_to, data_type, always_required, activated_by_rule_kinds) VALUES
        ('patient_first_name',   'First Name',       'patient', 'string',  TRUE, '[]'),
        ('patient_last_name',    'Last Name',        'patient', 'string',  TRUE, '[]'),
        ('patient_dob',          'Date of Birth',    'patient', 'date',    TRUE, '[]'),
        ('patient_gender',       'Gender',           'patient', 'enum',    TRUE, '[]'),
        ('patient_address',      'Address',          'patient', 'string',  TRUE, '[]'),
        ('patient_member_id',    'Member ID',        'patient', 'string',  TRUE, '[]'),
        ('patient_payer_id',     'Payer',            'patient', 'uuid',    TRUE, '[]'),
        ('claim_service_date',   'Service Date',     'claim',   'date',    TRUE, '[]'),
        ('claim_diagnosis_code', 'Diagnosis Code',   'claim',   'string',  TRUE, '[]'),
        ('claim_procedure_code', 'Procedure Code',   'claim',   'string',  TRUE, '[]'),
        ('claim_units',          'Units',            'claim',   'integer', TRUE, '[]')
      ON CONFLICT (code) DO NOTHING
    `);

    // ── Prompt C0: practice_payer_enrollments ────────────────────────────────
    if (!(await seederLog('table', 'practice_payer_enrollments'))) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS practice_payer_enrollments (
          id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id   VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          payer_id          VARCHAR NOT NULL REFERENCES payers(id) ON DELETE RESTRICT,
          plan_product_code VARCHAR NULL,
          enrolled_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
          enrolled_by       VARCHAR NULL REFERENCES users(id) ON DELETE SET NULL,
          disabled_at       TIMESTAMPTZ NULL,
          notes             TEXT NULL,
          UNIQUE (organization_id, payer_id, plan_product_code)
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_ppe_org ON practice_payer_enrollments (organization_id) WHERE disabled_at IS NULL`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_ppe_org_payer ON practice_payer_enrollments (organization_id, payer_id) WHERE disabled_at IS NULL`);
    }

    // ── Prompt C T1: plan_products reference table ───────────────────────────
    if (!(await seederLog('table', 'plan_products'))) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS plan_products (
          code               VARCHAR PRIMARY KEY,
          label              VARCHAR NOT NULL,
          parent_plan_family VARCHAR NOT NULL,
          plan_type          VARCHAR NOT NULL,
          requires_pcp       BOOLEAN NOT NULL DEFAULT FALSE,
          requires_referral  BOOLEAN NOT NULL DEFAULT FALSE,
          is_government      BOOLEAN NOT NULL DEFAULT FALSE,
          regulatory_basis   VARCHAR NULL,
          sort_order         INTEGER NOT NULL DEFAULT 0,
          active             BOOLEAN NOT NULL DEFAULT TRUE
        )
      `);
      await pool.query(`
        INSERT INTO plan_products (code, label, parent_plan_family, plan_type, requires_pcp, requires_referral, is_government, regulatory_basis, sort_order) VALUES
          -- Commercial (1-10)
          ('commercial_hmo',  'Commercial HMO',  'Commercial', 'HMO',       TRUE,  TRUE,  FALSE, NULL,                          1),
          ('commercial_ppo',  'Commercial PPO',  'Commercial', 'PPO',       FALSE, FALSE, FALSE, NULL,                          2),
          ('commercial_pos',  'Commercial POS',  'Commercial', 'POS',       TRUE,  FALSE, FALSE, NULL,                          3),
          ('commercial_epo',  'Commercial EPO',  'Commercial', 'EPO',       FALSE, FALSE, FALSE, NULL,                          4),
          -- Medicare Advantage (11-20)
          ('ma_hmo',          'Medicare Advantage HMO',         'Medicare Advantage', 'HMO', TRUE,  TRUE,  TRUE,  'CMS MA Regulations', 11),
          ('ma_ppo',          'Medicare Advantage PPO',         'Medicare Advantage', 'PPO', FALSE, FALSE, TRUE,  'CMS MA Regulations', 12),
          ('ma_hmo_pos',      'Medicare Advantage HMO-POS',     'Medicare Advantage', 'HMO', TRUE,  TRUE,  TRUE,  'CMS MA Regulations', 13),
          ('ma_dsnp',         'Medicare Advantage D-SNP',       'Medicare Advantage', 'HMO', TRUE,  TRUE,  TRUE,  'CMS SNP Regulations', 14),
          -- Medicare FFS (21)
          ('medicare_ffs',    'Traditional Medicare (FFS)',      'Medicare FFS',       'Indemnity', FALSE, FALSE, TRUE, 'SSA Title XVIII', 21),
          -- Individual Exchange (22-30)
          ('exchange_hmo',    'Individual Exchange HMO',         'Individual Exchange', 'HMO', TRUE,  TRUE,  FALSE, 'ACA §1311',         22),
          ('exchange_ppo',    'Individual Exchange PPO',         'Individual Exchange', 'PPO', FALSE, FALSE, FALSE, 'ACA §1311',         23),
          -- Medicaid (31-40)
          ('medicaid_mco',    'Medicaid MCO',                    'Medicaid',           'Capitated', TRUE, TRUE,  TRUE,  'SSA Title XIX',  31),
          ('medicaid_ffs',    'Medicaid Fee-for-Service',        'Medicaid',           'Indemnity', FALSE, FALSE, TRUE, 'SSA Title XIX',  32),
          -- TRICARE (41)
          ('tricare_prime',   'TRICARE Prime',                   'TRICARE',            'HMO',       TRUE,  TRUE,  TRUE,  '10 USC § 1074g', 41),
          ('tricare_select',  'TRICARE Select',                  'TRICARE',            'PPO',       FALSE, FALSE, TRUE,  '10 USC § 1074g', 42),
          -- VA CCN (43)
          ('va_ccn',          'VA Community Care Network',       'VA CCN',             'Other',     FALSE, FALSE, TRUE,  'VA Community Care', 43)
        ON CONFLICT (code) DO NOTHING
      `);
    }

    // ── Prompt C T1: payer_supported_plan_products join table ────────────────
    if (!(await seederLog('table', 'payer_supported_plan_products'))) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS payer_supported_plan_products (
          payer_id          VARCHAR NOT NULL REFERENCES payers(id) ON DELETE CASCADE,
          plan_product_code VARCHAR NOT NULL REFERENCES plan_products(code) ON DELETE RESTRICT,
          PRIMARY KEY (payer_id, plan_product_code)
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_pspp_payer ON payer_supported_plan_products (payer_id)`);

      // Seed by payer name patterns
      // Commercial payers → commercial plans
      await pool.query(`
        INSERT INTO payer_supported_plan_products (payer_id, plan_product_code)
        SELECT p.id, pp.code
        FROM payers p
        CROSS JOIN plan_products pp
        WHERE pp.code IN ('commercial_hmo','commercial_ppo','commercial_pos','commercial_epo')
          AND p.name ~* '(?i)(aetna|anthem|bcbs|blue cross|blue shield|cigna|humana|united|uhc|oscar|molina.*commercial|ambetter|bright|selecthealth|geisinger health|health alliance|healthfirst|tufts|ucare|umr|upmc|regence|premera|medical mutual|priority health|sanford|moda|emblem|fallon|dean|community health|capital blue|carefirst|alliance healthcare|beacon|aultcare|bluecross|multiplan)'
          AND p.name !~* '(medicare|medicaid|medi-cal|tricare|champva|va ccn|supplement|railroad|workers comp|dental|vision|behavioral|eye)'
        ON CONFLICT DO NOTHING
      `);

      // Medicare Advantage payers → MA plans
      await pool.query(`
        INSERT INTO payer_supported_plan_products (payer_id, plan_product_code)
        SELECT p.id, pp.code
        FROM payers p
        CROSS JOIN plan_products pp
        WHERE pp.code IN ('ma_hmo','ma_ppo','ma_hmo_pos','ma_dsnp')
          AND p.name ~* 'medicare advantage'
        ON CONFLICT DO NOTHING
      `);

      // AARP Complete (MA) → MA plans
      await pool.query(`
        INSERT INTO payer_supported_plan_products (payer_id, plan_product_code)
        SELECT p.id, pp.code
        FROM payers p
        CROSS JOIN plan_products pp
        WHERE pp.code IN ('ma_hmo','ma_ppo','ma_hmo_pos','ma_dsnp')
          AND p.name ILIKE 'AARP Medicare Complete%'
        ON CONFLICT DO NOTHING
      `);

      // Traditional Medicare / Medicare FFS payers
      await pool.query(`
        INSERT INTO payer_supported_plan_products (payer_id, plan_product_code)
        SELECT p.id, 'medicare_ffs'
        FROM payers p
        WHERE p.name ~* '(traditional medicare|medicare.*part a|medicare.*part b|medicare.*ffs|medicare.*railroad|medicare b.*railroad)'
           OR p.name = 'Medicare (Traditional)'
        ON CONFLICT DO NOTHING
      `);

      // UHC Commercial also gets exchange plans
      await pool.query(`
        INSERT INTO payer_supported_plan_products (payer_id, plan_product_code)
        SELECT p.id, pp.code
        FROM payers p
        CROSS JOIN plan_products pp
        WHERE pp.code IN ('exchange_hmo','exchange_ppo')
          AND p.name ~* '(ambetter|oscar health|bright health|united.*commercial|uhc.*commercial)'
          AND p.name !~* '(medicare|medicaid|tricare)'
        ON CONFLICT DO NOTHING
      `);

      // Medicaid payers → medicaid_mco
      await pool.query(`
        INSERT INTO payer_supported_plan_products (payer_id, plan_product_code)
        SELECT p.id, pp.code
        FROM payers p
        CROSS JOIN plan_products pp
        WHERE pp.code IN ('medicaid_mco','medicaid_ffs')
          AND p.name ~* '(medicaid|medi.cal|molina.*health|centene|caresource|amerihealth caritas|ambetter.*medicaid|healthkeepers|fidelis|sunshine health|superior health|peach state|buckeye|meridian.*health)'
          AND p.name !~* '(commercial|advantage|supplement|exchange)'
        ON CONFLICT DO NOTHING
      `);

      // TRICARE payers
      await pool.query(`
        INSERT INTO payer_supported_plan_products (payer_id, plan_product_code)
        SELECT p.id, pp.code
        FROM payers p
        CROSS JOIN plan_products pp
        WHERE pp.code IN ('tricare_prime','tricare_select')
          AND p.name ~* 'tricare'
        ON CONFLICT DO NOTHING
      `);

      // VA CCN — TriWest + CHAMPVA
      await pool.query(`
        INSERT INTO payer_supported_plan_products (payer_id, plan_product_code)
        SELECT p.id, 'va_ccn'
        FROM payers p
        WHERE p.name ~* '(triwest|champva|va community care)'
        ON CONFLICT DO NOTHING
      `);

      // UHC Commercial (explicitly) gets full commercial + exchange set
      await pool.query(`
        INSERT INTO payer_supported_plan_products (payer_id, plan_product_code)
        VALUES
          ('ba1316c1-60ea-41d6-80ae-cade2fb010f6', 'commercial_hmo'),
          ('ba1316c1-60ea-41d6-80ae-cade2fb010f6', 'commercial_ppo'),
          ('ba1316c1-60ea-41d6-80ae-cade2fb010f6', 'commercial_pos'),
          ('ba1316c1-60ea-41d6-80ae-cade2fb010f6', 'commercial_epo'),
          ('ba1316c1-60ea-41d6-80ae-cade2fb010f6', 'exchange_hmo'),
          ('ba1316c1-60ea-41d6-80ae-cade2fb010f6', 'exchange_ppo'),
          ('6de0c872-d01b-4ccd-819b-254d5e164440', 'ma_hmo'),
          ('6de0c872-d01b-4ccd-819b-254d5e164440', 'ma_ppo'),
          ('6de0c872-d01b-4ccd-819b-254d5e164440', 'ma_hmo_pos'),
          ('6de0c872-d01b-4ccd-819b-254d5e164440', 'ma_dsnp')
        ON CONFLICT DO NOTHING
      `);
    }

    // ── Prompt C T1: Add FK on practice_payer_enrollments.plan_product_code ──
    {
      const { rows: fkRows } = await pool.query(`
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_schema = 'public'
          AND table_name = 'practice_payer_enrollments'
          AND constraint_name = 'fk_ppe_plan_product'
      `);
      if (fkRows.length === 0) {
        console.log('[SEEDER] constraint practice_payer_enrollments.fk_ppe_plan_product: adding');
        await pool.query(`
          ALTER TABLE practice_payer_enrollments
            ADD CONSTRAINT fk_ppe_plan_product
            FOREIGN KEY (plan_product_code) REFERENCES plan_products(code) ON DELETE RESTRICT
        `).catch((e: any) => {
          if (e.code !== '42710') console.warn('[SEEDER] practice_payer_enrollments FK skipped:', e.message);
        });
      } else {
        console.log('[SEEDER] constraint practice_payer_enrollments.fk_ppe_plan_product: already present');
      }
    }

    // ── Prompt C T2: delegated_entities table ────────────────────────────────
    if (!(await seederLog('table', 'delegated_entities'))) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS delegated_entities (
          id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name                     VARCHAR NOT NULL,
          entity_type              VARCHAR NOT NULL,
          tax_id                   VARCHAR NULL,
          state                    VARCHAR(2) NULL,
          claims_address           TEXT NULL,
          claims_payer_id_override VARCHAR NULL,
          active                   BOOLEAN NOT NULL DEFAULT TRUE,
          notes                    TEXT NULL
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_de_state ON delegated_entities (state) WHERE active = TRUE`);

      // Seed 3 placeholder IPAs for demo
      await pool.query(`
        INSERT INTO delegated_entities (id, name, entity_type, state, notes) VALUES
          ('a1000000-0000-0000-0000-000000000001', 'Sample California IPA',        'IPA',           'CA', '[demo_seed] Placeholder IPA for CA activation demo'),
          ('a1000000-0000-0000-0000-000000000002', 'Sample California Medical Group','Medical_Group', 'CA', '[demo_seed] Placeholder medical group for CA delegation demo'),
          ('a1000000-0000-0000-0000-000000000003', 'Sample Texas IPA',             'IPA',           'TX', '[demo_seed] Placeholder IPA for TX activation demo')
        ON CONFLICT (id) DO NOTHING
      `);
    }

    // ── Prompt C T2: payer_delegated_entities join table ─────────────────────
    if (!(await seederLog('table', 'payer_delegated_entities'))) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS payer_delegated_entities (
          id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          payer_id            VARCHAR NOT NULL REFERENCES payers(id) ON DELETE CASCADE,
          delegated_entity_id UUID NOT NULL REFERENCES delegated_entities(id) ON DELETE CASCADE,
          plan_product_code   VARCHAR NULL REFERENCES plan_products(code) ON DELETE RESTRICT,
          state               VARCHAR(2) NULL,
          UNIQUE NULLS NOT DISTINCT (payer_id, delegated_entity_id, plan_product_code, state)
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_pde_payer ON payer_delegated_entities (payer_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_pde_payer_plan ON payer_delegated_entities (payer_id, plan_product_code)`);

      // Seed: UHC Commercial + MA HMO → CA IPA, CA Medical Group
      await pool.query(`
        INSERT INTO payer_delegated_entities (payer_id, delegated_entity_id, plan_product_code, state) VALUES
          ('ba1316c1-60ea-41d6-80ae-cade2fb010f6', 'a1000000-0000-0000-0000-000000000001', 'commercial_hmo', 'CA'),
          ('ba1316c1-60ea-41d6-80ae-cade2fb010f6', 'a1000000-0000-0000-0000-000000000002', 'commercial_hmo', 'CA'),
          ('6de0c872-d01b-4ccd-819b-254d5e164440', 'a1000000-0000-0000-0000-000000000001', 'ma_hmo',         'CA'),
          ('6de0c872-d01b-4ccd-819b-254d5e164440', 'a1000000-0000-0000-0000-000000000003', NULL,             'TX')
        ON CONFLICT DO NOTHING
      `);
    }

    // ── Prompt C T3: 4 conditional field_definitions rows ────────────────────
    await pool.query(`
      INSERT INTO field_definitions (code, label, applies_to, data_type, always_required, activated_by_rule_kinds) VALUES
        ('patient_plan_product',       'Plan Product',               'patient', 'enum',   FALSE, '["referrals","prior_auth","modifiers_and_liability","payer_specific_edits"]'),
        ('patient_pcp_id',             'PCP',                        'patient', 'string', FALSE, '["referrals"]'),
        ('patient_pcp_referral_id',    'PCP Referral #',             'patient', 'string', FALSE, '["referrals"]'),
        ('patient_delegated_entity_id','Delegated Medical Group / IPA','patient','uuid',  FALSE, '["referrals"]')
      ON CONFLICT (code) DO NOTHING
    `);

    // ── Prompt C: Seed demo org UHC enrollments (enables resolver demo) ──────
    {
      const demoOrgId = 'demo-org-001';
      // Insert only if not already enrolled (handle NULL plan_product_code explicitly)
      for (const payerId of ['ba1316c1-60ea-41d6-80ae-cade2fb010f6', '6de0c872-d01b-4ccd-819b-254d5e164440']) {
        const { rows: existing } = await pool.query(`
          SELECT 1 FROM practice_payer_enrollments
          WHERE organization_id = $1 AND payer_id = $2 AND plan_product_code IS NULL AND disabled_at IS NULL
        `, [demoOrgId, payerId]);
        if (existing.length === 0) {
          await pool.query(`
            INSERT INTO practice_payer_enrollments
              (id, organization_id, payer_id, plan_product_code, enrolled_at, notes)
            VALUES
              (gen_random_uuid(), $1, $2, NULL, NOW(), '[demo_seed] Auto-enrolled for conditional-field activation demo')
          `, [demoOrgId, payerId]);
        }
      }
    }

    // ── Prompt C T4b: UHC demo seed (approved extraction items for resolver) ─
    {
      // Check if demo seed items already exist (idempotent by notes prefix)
      const { rows: existingDemoItems } = await pool.query(`
        SELECT COUNT(*)::int AS cnt
        FROM manual_extraction_items
        WHERE notes ILIKE '[demo_seed]%'
      `);

      if (existingDemoItems[0]?.cnt === 0) {
        // Check for any existing approved UHC referrals rules first
        const { rows: existingUhcRules } = await pool.query(`
          SELECT COUNT(*)::int AS cnt
          FROM manual_extraction_items mei
          JOIN payer_source_documents psd ON psd.id = mei.source_document_id
          WHERE psd.payer_id IN ('ba1316c1-60ea-41d6-80ae-cade2fb010f6','6de0c872-d01b-4ccd-819b-254d5e164440')
            AND mei.review_status = 'approved'
            AND mei.section_type = 'referrals'
        `);

        if (existingUhcRules[0]?.cnt === 0) {
          // Find or create a supplement source document for UHC demo
          let supplementId: string | null = null;
          const { rows: existingSupp } = await pool.query(`
            SELECT id FROM payer_source_documents
            WHERE payer_id = 'ba1316c1-60ea-41d6-80ae-cade2fb010f6'
              AND document_name ILIKE '%Demo Seed%'
            LIMIT 1
          `);
          if (existingSupp.length > 0) {
            supplementId = existingSupp[0].id;
          } else {
            const { rows: [newDoc] } = await pool.query(`
              INSERT INTO payer_source_documents
                (id, payer_id, document_name, document_type, source_url, status, created_at, organization_id, parent_document_id)
              VALUES
                (gen_random_uuid()::text,
                 'ba1316c1-60ea-41d6-80ae-cade2fb010f6',
                 'UHC Capitation & Delegation Supplement (Demo Seed)',
                 'supplement',
                 'https://www.uhcprovider.com/admin-guide-supplement',
                 'completed',
                 NOW(),
                 (SELECT id FROM organizations LIMIT 1),
                 'ea017017-c295-4d81-be0b-8892a9c147fc')
              RETURNING id
            `);
            supplementId = newDoc?.id || null;
          }

          if (supplementId) {
            // Insert 3 approved demo extraction items (is_demo_seed=TRUE so they are excluded from live claim evaluation by default)
            await pool.query(`
              INSERT INTO manual_extraction_items
                (source_document_id, section_type, raw_snippet, applies_to_plan_products, review_status, notes, is_demo_seed, created_at)
              VALUES
                ($1, 'referrals', 'UHC HMO and MA HMO plans require a PCP referral for specialist services. Capitated medical groups are responsible for managing specialist utilization. Claims submitted without a valid PCP referral authorization number will be denied.',
                 '["commercial_hmo","ma_hmo","ma_hmo_pos"]'::jsonb, 'approved',
                 '[demo_seed] Placeholder referral rule for activation cascade demo. Replace with real extraction when UHC supplement is manually ingested.', TRUE, NOW()),
                ($1, 'referrals', 'IPA-delegated members must obtain referrals from their assigned IPA medical director. The IPA claims payer ID should be used as the billing payer for capitated encounters.',
                 '["commercial_hmo","ma_hmo"]'::jsonb, 'approved',
                 '[demo_seed] Placeholder delegation/referral rule. Replace with real extraction.', TRUE, NOW()),
                ($1, 'prior_auth', 'Prior authorization is required for outpatient surgical procedures, durable medical equipment, and home health services for all MA HMO and D-SNP members. Submit via UHC electronic authorization portal.',
                 '["ma_hmo","ma_dsnp","ma_hmo_pos"]'::jsonb, 'approved',
                 '[demo_seed] Placeholder prior auth rule for MA demo. Replace with real extraction.', TRUE, NOW())
            `, [supplementId]);
            console.log('[SEEDER] UHC demo extraction items seeded (3 approved items)');
          }
        }
      }
    }

    // ── Prompt C: New patient columns ────────────────────────────────────────
    if (!(await seederLog('column', 'patients', 'plan_product_code'))) {
      await pool.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS plan_product_code VARCHAR REFERENCES plan_products(code) ON DELETE SET NULL`);
    }
    if (!(await seederLog('column', 'patients', 'delegated_entity_id'))) {
      await pool.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS delegated_entity_id UUID REFERENCES delegated_entities(id) ON DELETE SET NULL`);
    }
    if (!(await seederLog('column', 'patients', 'pcp_id'))) {
      await pool.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS pcp_id TEXT NULL`);
    }
    if (!(await seederLog('column', 'patients', 'pcp_referral_number'))) {
      await pool.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS pcp_referral_number TEXT NULL`);
    }

    // ── Source document provenance (groundwork for scraper kit) ──────────────
    // Tracks how each source document entered the corpus.
    // Values: manual_upload | scraped | bulletin_triggered | manus_agent | cms_structured
    // Defaults to manual_upload — every existing row is already correctly labelled.
    if (!(await seederLog('column', 'payer_source_documents', 'source_acquisition_method'))) {
      await pool.query(`ALTER TABLE payer_source_documents ADD COLUMN IF NOT EXISTS source_acquisition_method VARCHAR NOT NULL DEFAULT 'manual_upload'`);
    }

    // ── Crawler kit — payer_source_documents new columns ─────────────────────
    if (!(await seederLog('column', 'payer_source_documents', 'source_url_canonical'))) {
      await pool.query(`ALTER TABLE payer_source_documents ADD COLUMN IF NOT EXISTS source_url_canonical VARCHAR`);
    }
    if (!(await seederLog('column', 'payer_source_documents', 'content_hash'))) {
      await pool.query(`ALTER TABLE payer_source_documents ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64)`);
    }
    if (!(await seederLog('column', 'payer_source_documents', 'last_scraped_at'))) {
      await pool.query(`ALTER TABLE payer_source_documents ADD COLUMN IF NOT EXISTS last_scraped_at TIMESTAMPTZ`);
    }
    if (!(await seederLog('column', 'payer_source_documents', 'scrape_status'))) {
      await pool.query(`ALTER TABLE payer_source_documents ADD COLUMN IF NOT EXISTS scrape_status VARCHAR`);
    }
    // CHECK constraints — idempotent via DO block
    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE payer_source_documents
          ADD CONSTRAINT chk_source_acquisition_method
          CHECK (source_acquisition_method IN ('manual_upload','scraped','bulletin_triggered','manus_agent','cms_structured'));
      EXCEPTION WHEN duplicate_object THEN null; END $$
    `);
    await pool.query(`
      DO $$ BEGIN
        ALTER TABLE payer_source_documents
          ADD CONSTRAINT chk_scrape_status
          CHECK (scrape_status IS NULL OR scrape_status IN ('success','unchanged','error','auth_required','rate_limited','circuit_open'));
      EXCEPTION WHEN duplicate_object THEN null; END $$
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_psd_source_url_canonical ON payer_source_documents(source_url_canonical) WHERE source_url_canonical IS NOT NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_psd_acquisition ON payer_source_documents(source_acquisition_method)`);

    // ── Crawler kit — scrape_runs table ──────────────────────────────────────
    if (!(await seederLog('table', 'scrape_runs'))) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS scrape_runs (
          id UUID PRIMARY KEY,
          payer_code VARCHAR NOT NULL,
          started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          completed_at TIMESTAMPTZ,
          status VARCHAR NOT NULL DEFAULT 'running'
            CHECK (status IN ('running','success','partial','failed','circuit_open','already_running')),
          report JSONB,
          triggered_by VARCHAR NOT NULL DEFAULT 'manual_admin'
            CHECK (triggered_by IN ('manual_admin','cron','demo_button')),
          triggered_by_user_id VARCHAR,
          used_fallback BOOLEAN NOT NULL DEFAULT FALSE
        )
      `);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_scrape_runs_payer ON scrape_runs(payer_code, started_at DESC)`);
    }

    // ── Crawler kit — scraper_circuit_state table ─────────────────────────────
    if (!(await seederLog('table', 'scraper_circuit_state'))) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS scraper_circuit_state (
          payer_code VARCHAR PRIMARY KEY,
          state VARCHAR NOT NULL DEFAULT 'closed'
            CHECK (state IN ('closed','open','half_open')),
          consecutive_errors INTEGER NOT NULL DEFAULT 0,
          last_error_at TIMESTAMPTZ,
          opened_at TIMESTAMPTZ,
          reopens_at TIMESTAMPTZ,
          notes TEXT
        )
      `);
    }

    // ── Crawler monitoring — scraper_monitor_log table ────────────────────────
    if (!(await seederLog('table', 'scraper_monitor_log'))) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS scraper_monitor_log (
          id UUID PRIMARY KEY,
          event_type VARCHAR NOT NULL CHECK (event_type IN ('scrape_complete','synthetic_test')),
          alert_level VARCHAR NOT NULL CHECK (alert_level IN ('info','warning','error')),
          payer_code VARCHAR NOT NULL,
          run_id VARCHAR,
          payload JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_scraper_monitor_log_created
        ON scraper_monitor_log(created_at DESC)
      `);
    }

    // ── Reimbursement reference tables (global, no tenant scope) ─────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hcpcs_codes (
        code TEXT PRIMARY KEY,
        short_description TEXT,
        long_description TEXT,
        code_type TEXT CHECK (code_type IN ('CPT','HCPCS_LEVEL_II','CPT_CATEGORY_II','CPT_CATEGORY_III')),
        status TEXT CHECK (status IN ('active','deleted','replaced')),
        effective_date DATE,
        termination_date DATE,
        source TEXT,
        source_version TEXT,
        ingested_at TIMESTAMP DEFAULT NOW()
      )
    `).catch((e: any) => console.error('[SEEDER] hcpcs_codes:', e.message));

    await pool.query(`
      CREATE TABLE IF NOT EXISTS cms_pfs_rvu (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        hcpcs_code TEXT NOT NULL,
        modifier TEXT,
        work_rvu NUMERIC(10,4),
        practice_expense_rvu_facility NUMERIC(10,4),
        practice_expense_rvu_non_facility NUMERIC(10,4),
        malpractice_rvu NUMERIC(10,4),
        status_indicator TEXT,
        global_period TEXT,
        professional_component_indicator TEXT,
        multiple_procedure_indicator TEXT,
        bilateral_surgery_indicator TEXT,
        assistant_surgery_indicator TEXT,
        co_surgeon_indicator TEXT,
        team_surgery_indicator TEXT,
        effective_date DATE NOT NULL,
        termination_date DATE,
        pfs_year INTEGER NOT NULL,
        conversion_factor NUMERIC(10,4),
        source_url TEXT,
        ingested_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (hcpcs_code, modifier, effective_date, pfs_year)
      )
    `).catch((e: any) => console.error('[SEEDER] cms_pfs_rvu:', e.message));

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pfs_rvu_code ON cms_pfs_rvu (hcpcs_code)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_pfs_rvu_year ON cms_pfs_rvu (pfs_year)`).catch(() => {});

    await pool.query(`
      CREATE TABLE IF NOT EXISTS cms_gpci (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        mac_carrier TEXT NOT NULL,
        locality_code TEXT NOT NULL,
        locality_name TEXT NOT NULL,
        state TEXT NOT NULL,
        state_fips TEXT,
        counties TEXT[],
        work_gpci NUMERIC(6,4),
        practice_expense_gpci NUMERIC(6,4),
        malpractice_gpci NUMERIC(6,4),
        effective_date DATE NOT NULL,
        termination_date DATE,
        pfs_year INTEGER NOT NULL,
        source_url TEXT,
        ingested_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (mac_carrier, locality_code, effective_date, pfs_year)
      )
    `).catch((e: any) => console.error('[SEEDER] cms_gpci:', e.message));

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_gpci_state ON cms_gpci (state)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_gpci_locality ON cms_gpci (mac_carrier, locality_code)`).catch(() => {});

    await pool.query(`
      CREATE TABLE IF NOT EXISTS cms_locality_county (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        mac_carrier TEXT NOT NULL,
        locality_code TEXT NOT NULL,
        state TEXT NOT NULL,
        locality_name TEXT NOT NULL,
        counties TEXT[],
        pfs_year INTEGER NOT NULL,
        source_url TEXT,
        ingested_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (mac_carrier, locality_code, pfs_year)
      )
    `).catch((e: any) => console.error('[SEEDER] cms_locality_county:', e.message));

    await pool.query(`
      CREATE TABLE IF NOT EXISTS va_fee_schedule (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        hcpcs_code TEXT NOT NULL,
        modifier TEXT,
        schedule_type TEXT NOT NULL CHECK (schedule_type IN ('national_vafs','alaska_vafs','cnh','gec','reasonable_charges')),
        facility_rate NUMERIC(10,2),
        non_facility_rate NUMERIC(10,2),
        unit_rate NUMERIC(10,2),
        unit_description TEXT,
        geographic_scope TEXT NOT NULL DEFAULT 'national',
        mac_carrier TEXT,
        locality_code TEXT,
        code_description TEXT,
        effective_date DATE NOT NULL,
        termination_date DATE,
        fee_schedule_year INTEGER NOT NULL,
        source_url TEXT,
        ingested_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (hcpcs_code, modifier, schedule_type, geographic_scope, effective_date, fee_schedule_year)
      )
    `).catch((e: any) => console.error('[SEEDER] va_fee_schedule:', e.message));

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_vafs_code ON va_fee_schedule (hcpcs_code)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_vafs_type_year ON va_fee_schedule (schedule_type, fee_schedule_year)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_vafs_locality ON va_fee_schedule (mac_carrier, locality_code)`).catch(() => {});

    // ── CMS ZIP-to-Carrier-Locality crosswalk (global, no tenant scope) ──────
    // Source: CMS Fee Schedules General Information page (quarterly)
    // URL: https://www.cms.gov/medicare/medicare-fee-for-service-payment/prospmedicarefeesvcpmtgen/index.html
    // Populated via rate-ingest admin tool; ~43K rows covering all U.S. ZIPs.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cms_zip_locality (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        zip_code TEXT NOT NULL,
        zip_plus_4 TEXT,
        state TEXT NOT NULL,
        mac_carrier TEXT NOT NULL,
        locality_code TEXT NOT NULL,
        rural_indicator TEXT,
        effective_date DATE NOT NULL,
        termination_date DATE,
        source_url TEXT,
        ingested_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (zip_code, effective_date)
      )
    `).catch((e: any) => console.error('[SEEDER] cms_zip_locality:', e.message));
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_zip_locality_zip ON cms_zip_locality (zip_code)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_zip_locality_carrier ON cms_zip_locality (mac_carrier, locality_code)`).catch(() => {});

    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS medicare_locality_code TEXT`).catch(() => {});
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS medicare_mac_carrier TEXT`).catch(() => {});
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS locality_resolved_at TIMESTAMP`).catch(() => {});
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS locality_resolution_method TEXT`).catch(() => {});
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS locality_source_url TEXT`).catch(() => {});

    // ── hcpcs_rates: legacy rate flag ────────────────────────────────────────
    await pool.query(`ALTER TABLE hcpcs_rates ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN DEFAULT FALSE`).catch(() => {});

    // ── Performance indexes (multi-tenant org isolation + common filters) ─────
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_activity_logs_claim_id   ON activity_logs(claim_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_activity_logs_org        ON activity_logs(organization_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_activity_logs_patient_id ON activity_logs(patient_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_claims_created_at  ON claims(created_at)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_claims_org         ON claims(organization_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_claims_patient_id  ON claims(patient_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_claims_payer       ON claims(payer_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_claims_status      ON claims(status)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_patients_first_name ON patients(first_name)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_patients_last_name  ON patients(last_name)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_patients_lead_id    ON patients(lead_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_patients_org        ON patients(organization_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_prior_authorizations_org ON prior_authorizations(organization_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_providers_org       ON providers(organization_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_rules_org           ON rules(organization_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_org           ON users(organization_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_leads_org           ON leads(organization_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_leads_email         ON leads(email)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_leads_status        ON leads(status)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_encounters_org      ON encounters(organization_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_denials_org         ON denials(organization_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_vob_verifications_org ON vob_verifications(organization_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_claim_events_org    ON claim_events(organization_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_email_logs_org      ON email_logs(organization_id)`).catch(() => {});
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS cpt_codes_code_key  ON cpt_codes(code)`).catch(() => {});
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS hcpcs_codes_code_key ON hcpcs_codes(code)`).catch(() => {});
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS icd10_codes_code_key ON icd10_codes(code)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_appointments_org       ON appointments(organization_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_availability_slots_org ON availability_slots(organization_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_calls_org              ON calls(organization_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_chat_analytics_org     ON chat_analytics(organization_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_chat_messages_org      ON chat_messages(organization_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_org      ON chat_sessions(organization_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_claim_templates_org    ON claim_templates(organization_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_cpt_codes_description  ON cpt_codes USING gin(to_tsvector('english', description))`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_email_templates_org    ON email_templates(organization_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_icd10_codes_description ON icd10_codes USING gin(to_tsvector('english', description))`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_nurture_sequences_org  ON nurture_sequences(organization_id)`).catch(() => {});

    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS engagement_halted BOOLEAN NOT NULL DEFAULT FALSE`).catch(() => {});
    await pool.query(`ALTER TABLE flow_runs ADD COLUMN IF NOT EXISTS halted_at TIMESTAMPTZ`).catch(() => {});
    console.log("[SEEDER] Startup schema seeder complete.");
  } catch (migrationErr: any) {
    console.error("Startup migration error:", migrationErr?.message || migrationErr);
  }

  // ── NPI Registry lookup (NPPES public API) ───────────────────────────────
  app.get("/api/npi-lookup", requireAuth, async (req, res) => {
    const { npi } = req.query;
    if (!npi || typeof npi !== "string" || !/^\d{10}$/.test(npi))
      return res.status(400).json({ error: "Valid 10-digit NPI required" });
    try {
      const r = await fetch(`https://npiregistry.cms.hhs.gov/api/?number=${encodeURIComponent(npi)}&version=2.1`);
      if (!r.ok) return res.status(502).json({ error: "NPI registry unavailable" });
      const data = await r.json();
      if (!data.results || data.results.length === 0) return res.json({ found: false });
      const result = data.results[0];
      const basic = result.basic || {};
      const addr = (result.addresses || []).find((a: any) => a.address_purpose === "LOCATION") || result.addresses?.[0] || {};
      const taxonomy = (result.taxonomies || []).find((t: any) => t.primary) || result.taxonomies?.[0] || {};
      const isNpi1 = result.enumeration_type === "NPI-1";
      res.json({
        found: true,
        entityType: isNpi1 ? "individual" : "organization",
        firstName: isNpi1 ? (basic.first_name || "") : "",
        lastName: isNpi1 ? (basic.last_name || "") : "",
        organizationName: !isNpi1 ? (basic.organization_name || "") : "",
        credential: basic.credential || "",
        taxonomyCode: taxonomy.code || "",
        taxonomyDesc: taxonomy.desc || "",
        address: addr.address_1 || "",
        city: addr.city || "",
        state: addr.state || "",
        zip: (addr.postal_code || "").slice(0, 5),
        phone: addr.telephone_number || "",
      });
    } catch (err: any) {
      console.error('[NPI Lookup] Error:', err);
      res.status(500).json({ error: "NPI registry lookup failed. Please check the NPI number and try again." });
    }
  });

  // ── NUCC Taxonomy codes reference ─────────────────────────────────────────
  app.get("/api/taxonomy-codes", requireAuth, async (_req, res) => {
    try {
      const { pool } = await import("./db");
      const { rows } = await pool.query("SELECT code, display, category FROM taxonomy_codes ORDER BY category, display");
      res.json(rows);
    } catch {
      res.status(500).json({ error: "Failed to fetch taxonomy codes" });
    }
  });

  app.get("/api/carc-codes", requireAuth, async (req, res) => {
    try {
      const { pool } = await import("./db");
      const { q } = req.query;
      let query = "SELECT code, description, group_codes FROM carc_codes ORDER BY CAST(code AS INTEGER) NULLS LAST";
      const params: any[] = [];
      if (q && typeof q === "string" && q.trim()) {
        query = "SELECT code, description, group_codes FROM carc_codes WHERE code ILIKE $1 OR description ILIKE $1 ORDER BY code";
        params.push(`%${q.trim()}%`);
      }
      const { rows } = await pool.query(query, params);
      res.json(rows);
    } catch {
      res.status(500).json({ error: "Failed to fetch CARC codes" });
    }
  });

  app.get("/api/rarc-codes", requireAuth, async (req, res) => {
    try {
      const { pool } = await import("./db");
      const { q } = req.query;
      let query = "SELECT code, description, type FROM rarc_codes ORDER BY code";
      const params: any[] = [];
      if (q && typeof q === "string" && q.trim()) {
        query = "SELECT code, description, type FROM rarc_codes WHERE code ILIKE $1 OR description ILIKE $1 ORDER BY code";
        params.push(`%${q.trim()}%`);
      }
      const { rows } = await pool.query(query, params);
      res.json(rows);
    } catch {
      res.status(500).json({ error: "Failed to fetch RARC codes" });
    }
  });

  app.get("/api/pos-codes", requireAuth, async (_req, res) => {
    try {
      const { pool } = await import("./db");
      const { rows } = await pool.query("SELECT code, description, notes FROM pos_codes ORDER BY CAST(code AS INTEGER)");
      res.json(rows);
    } catch {
      res.status(500).json({ error: "Failed to fetch POS codes" });
    }
  });

  app.get("/api/payers", requireAuth, async (req, res) => {
    res.json(allPayers);
  });

  app.get("/api/billing/payers", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const db = await import("./db").then(m => m.pool);
      // Return global payers (organization_id IS NULL) plus payers owned by this org.
      // Tenant isolation: org-scoped payers are never visible to other organizations.
      const { rows } = await db.query(
        `SELECT * FROM payers
          WHERE organization_id IS NULL
             OR organization_id = $1
          ORDER BY is_active DESC, name`,
        [orgId]
      );
      res.json(rows);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/providers", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const showAll = req.query.all === "true";
      const db = await import("./db").then(m => m.pool);
      const whereClause = showAll
        ? "WHERE organization_id = $1"
        : "WHERE organization_id = $1 AND is_active = true";
      const { rows } = await db.query(
        `SELECT * FROM providers ${whereClause} ORDER BY is_active DESC, is_default DESC, last_name, first_name`,
        [orgId]
      );
      res.json(rows);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.post("/api/billing/providers", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { firstName, lastName, credentials, npi, taxonomyCode, individualTaxId, licenseNumber, isDefault, entityType, organizationName, providerType } = req.body;
      const isOrg = entityType === 'organization';
      const isAgencyWorker = providerType === 'agency_worker';
      const effectiveFirst = isOrg ? (organizationName || '').trim() : (firstName || '').trim();
      const effectiveLast = isOrg ? '' : (lastName || '').trim();
      const effectiveNpi = npi?.trim() || null;
      if (!effectiveFirst) {
        return res.status(400).json({ error: isOrg ? "Organization name is required" : "First name is required" });
      }
      if (!isOrg && !effectiveLast) {
        return res.status(400).json({ error: "Last name is required" });
      }
      // NPI required for rendering providers and organizations; optional for agency workers
      if (!isAgencyWorker && !effectiveNpi) {
        return res.status(400).json({ error: "NPI is required for rendering providers" });
      }
      if (effectiveNpi) {
        const { validateNPI } = await import("../shared/npi-validation");
        if (!validateNPI(effectiveNpi)) {
          return res.status(400).json({ error: "Invalid NPI — must be 10 digits and pass the NPI checksum" });
        }
      }
      const db = await import("./db").then(m => m.pool);
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        if (isDefault) {
          await client.query("UPDATE providers SET is_default = false WHERE organization_id = $1 AND is_default = true", [orgId]);
        }
        const { rows } = await client.query(
          `INSERT INTO providers (id, first_name, last_name, credentials, npi, taxonomy_code, individual_tax_id, license_number, is_default, organization_id, entity_type, provider_type)
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
          [effectiveFirst, effectiveLast, isOrg ? null : (credentials || null), effectiveNpi, taxonomyCode || null, individualTaxId || null, isOrg ? null : (licenseNumber || null), isDefault || false, orgId, isOrg ? 'organization' : 'individual', providerType || 'rendering']
        );
        await client.query("COMMIT");
        res.json(rows[0]);
      } catch (txErr) {
        await client.query("ROLLBACK");
        throw txErr;
      } finally {
        client.release();
      }
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.patch("/api/billing/providers/:id", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const { id } = req.params;
      const db = await import("./db").then(m => m.pool);
      const ownerCheck = await db.query("SELECT organization_id FROM providers WHERE id = $1", [id]);
      if (!ownerCheck.rows.length || !verifyOrg(ownerCheck.rows[0], req)) return res.status(404).json({ error: "Provider not found" });
      const { firstName, lastName, credentials, npi, taxonomyCode, individualTaxId, licenseNumber, isDefault, isActive, entityType, organizationName } = req.body;
      if (npi !== undefined) {
        const { validateNPI } = await import("../shared/npi-validation");
        if (!validateNPI(npi)) {
          return res.status(400).json({ error: "Invalid NPI — must be 10 digits and pass the NPI checksum" });
        }
      }
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const orgIdForPatch = ownerCheck.rows[0].organization_id;
        if (isDefault === true) {
          await client.query("UPDATE providers SET is_default = false WHERE organization_id = $1 AND is_default = true", [orgIdForPatch]);
        }
        const fields: string[] = [];
        const values: any[] = [];
        let idx = 1;
        if (entityType !== undefined) { fields.push(`entity_type = $${idx++}`); values.push(entityType); }
        if (organizationName !== undefined) { fields.push(`first_name = $${idx++}`); values.push(organizationName); }
        if (firstName !== undefined && entityType !== 'organization') { fields.push(`first_name = $${idx++}`); values.push(firstName); }
        if (lastName !== undefined) { fields.push(`last_name = $${idx++}`); values.push(lastName); }
        if (credentials !== undefined) { fields.push(`credentials = $${idx++}`); values.push(credentials); }
        if (npi !== undefined) { fields.push(`npi = $${idx++}`); values.push(npi); }
        if (taxonomyCode !== undefined) { fields.push(`taxonomy_code = $${idx++}`); values.push(taxonomyCode); }
        if (individualTaxId !== undefined) { fields.push(`individual_tax_id = $${idx++}`); values.push(individualTaxId); }
        if (licenseNumber !== undefined) { fields.push(`license_number = $${idx++}`); values.push(licenseNumber); }
        if (isDefault !== undefined) { fields.push(`is_default = $${idx++}`); values.push(isDefault); }
        if (isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(isActive); }
        fields.push(`updated_at = NOW()`);
        values.push(id);
        const { rows } = await client.query(
          `UPDATE providers SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
          values
        );
        await client.query("COMMIT");
        if (rows.length === 0) return res.status(404).json({ error: "Provider not found" });
        res.json(rows[0]);
      } catch (txErr) {
        await client.query("ROLLBACK");
        throw txErr;
      } finally {
        client.release();
      }
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  // Org readiness check — used by claim wizard and dashboard banner
  app.get("/api/billing/org-readiness", requireRole("admin", "rcm_manager", "biller", "coder", "front_desk"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const db = await import("./db").then(m => m.pool);
      const missing: string[] = [];

      const ps = orgId
        ? (await db.query("SELECT primary_npi, tax_id, practice_name FROM practice_settings WHERE organization_id = $1 LIMIT 1", [orgId])).rows[0]
        : (await db.query("SELECT primary_npi, tax_id, practice_name FROM practice_settings LIMIT 1")).rows[0];
      if (!ps) { missing.push("practice_settings"); }
      else {
        if (!ps.primary_npi || ps.primary_npi.replace(/\D/g, "").length !== 10) missing.push("npi");
        if (!ps.tax_id) missing.push("tax_id");
        if (!ps.practice_name) missing.push("practice_name");
      }

      const provResult = orgId
        ? await db.query("SELECT COUNT(*) FROM providers WHERE organization_id = $1 AND is_active = true", [orgId])
        : await db.query("SELECT COUNT(*) FROM providers WHERE is_active = true");
      if (parseInt(provResult.rows[0].count) === 0) missing.push("provider");

      const payerResult = orgId
        ? await db.query("SELECT COUNT(*) FROM payers WHERE (organization_id = $1 OR organization_id IS NULL) AND is_active = true AND payer_id IS NOT NULL AND payer_id != ''", [orgId])
        : await db.query("SELECT COUNT(*) FROM payers WHERE is_active = true AND payer_id IS NOT NULL AND payer_id != ''");
      if (parseInt(payerResult.rows[0].count) === 0) missing.push("payer");

      const ready = missing.length === 0;
      res.json({ ready, missing });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/practice-settings", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { rows } = orgId 
        ? await import("./db").then(m => m.pool.query("SELECT * FROM practice_settings WHERE organization_id = $1 LIMIT 1", [orgId]))
        : await import("./db").then(m => m.pool.query("SELECT * FROM practice_settings LIMIT 1"));
      res.json(rows[0] || null);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.put("/api/billing/practice-settings", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const { practiceName, primaryNpi, taxId, taxonomyCode, address, phone, defaultPos, billingLocation, defaultVaLocality, pgbaTradingPartnerId, oa_submitter_id, oa_sftp_username, oa_sftp_password, defaultTos, defaultOrderingProviderId, homeboundDefault, excludeFacility } = req.body;
      const orgId = getOrgId(req);
      const db = await import("./db").then(m => m.pool);
      const existing = orgId
        ? await db.query("SELECT id FROM practice_settings WHERE organization_id = $1 LIMIT 1", [orgId])
        : await db.query("SELECT id FROM practice_settings LIMIT 1");
      if (existing.rows.length > 0) {
        let query = `UPDATE practice_settings SET practice_name=$1, primary_npi=$2, tax_id=$3, taxonomy_code=$4, address=$5, phone=$6, default_pos=$7, billing_location=$9, updated_at=NOW()`;
        const params: any[] = [practiceName, primaryNpi, taxId, taxonomyCode, JSON.stringify(address || {}), phone, defaultPos || '11', existing.rows[0].id, billingLocation || null];
        if (defaultVaLocality !== undefined) { query += `, default_va_locality=$${params.length + 1}`; params.push(defaultVaLocality || null); }
        if (oa_submitter_id !== undefined) { query += `, oa_submitter_id=$${params.length + 1}`; params.push(oa_submitter_id); }
        if (oa_sftp_username !== undefined) { query += `, oa_sftp_username=$${params.length + 1}`; params.push(oa_sftp_username); }
        if (oa_sftp_password !== undefined) { query += `, oa_sftp_password=$${params.length + 1}`; params.push(oa_sftp_password); }
        if (defaultTos !== undefined) { query += `, default_tos=$${params.length + 1}`; params.push(defaultTos || null); }
        if (defaultOrderingProviderId !== undefined) { query += `, default_ordering_provider_id=$${params.length + 1}`; params.push(defaultOrderingProviderId || null); }
        if (homeboundDefault !== undefined) { query += `, homebound_default=$${params.length + 1}`; params.push(homeboundDefault); }
        if (excludeFacility !== undefined) { query += `, exclude_facility=$${params.length + 1}`; params.push(excludeFacility); }
        if (pgbaTradingPartnerId !== undefined) { query += `, pgba_trading_partner_id=$${params.length + 1}`; params.push(pgbaTradingPartnerId || null); }
        query += ` WHERE id=$8 RETURNING *`;
        const { rows } = await db.query(query, params);
        res.json(rows[0]);
      } else {
        const { rows } = await db.query(
          `INSERT INTO practice_settings (id, practice_name, primary_npi, tax_id, taxonomy_code, address, phone, default_pos, billing_location, default_va_locality, organization_id, default_tos, default_ordering_provider_id, homebound_default, exclude_facility)
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
          [practiceName, primaryNpi, taxId, taxonomyCode, JSON.stringify(address || {}), phone, defaultPos || '12', billingLocation || null, defaultVaLocality || null, orgId || null, defaultTos || null, defaultOrderingProviderId || null, homeboundDefault ?? true, excludeFacility ?? true]
        );
        res.json(rows[0]);
      }
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.patch("/api/billing/practice-settings/frcpb-enrollment", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const { enrolled } = req.body;
      if (typeof enrolled !== "boolean") return res.status(400).json({ error: "enrolled must be a boolean" });
      const orgId = getOrgId(req);
      const db = await import("./db").then(m => m.pool);
      const existing = orgId
        ? await db.query("SELECT id FROM practice_settings WHERE organization_id = $1 LIMIT 1", [orgId])
        : await db.query("SELECT id FROM practice_settings LIMIT 1");
      let settingsId: string;
      if (existing.rows.length === 0) {
        const created = await db.query(
          `INSERT INTO practice_settings (id, practice_name, organization_id) VALUES (gen_random_uuid()::text, '', $1) RETURNING id`,
          [orgId || null]
        );
        settingsId = created.rows[0].id;
      } else {
        settingsId = existing.rows[0].id;
      }
      const { rows } = await db.query(
        `UPDATE practice_settings SET frcpb_enrolled=$1, frcpb_enrolled_at=$2, updated_at=NOW() WHERE id=$3 RETURNING *`,
        [enrolled, enrolled ? new Date() : null, settingsId]
      );
      res.json(rows[0]);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  // ── Prompt C0: Practice-Payer Enrollment API ─────────────────────────────

  app.get("/api/practice/payer-enrollments", requireAuth, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ error: "No organization context" });
      const db = await import("./db").then(m => m.pool);
      const { rows } = await db.query(
        `SELECT ppe.id, ppe.payer_id, ppe.plan_product_code, ppe.enrolled_at, ppe.disabled_at,
                ppe.notes, p.name AS payer_name, u.name AS enrolled_by_name
           FROM practice_payer_enrollments ppe
           JOIN payers p ON p.id = ppe.payer_id
           LEFT JOIN users u ON u.id = ppe.enrolled_by
          WHERE ppe.organization_id = $1
          ORDER BY ppe.enrolled_at DESC`,
        [orgId]
      );
      res.json(rows);
    } catch (err: any) {
      console.error("[C0] GET payer-enrollments:", err.message);
      res.status(500).json({ error: "Failed to fetch enrollments" });
    }
  });

  app.post("/api/practice/payer-enrollments", requireAuth, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const userId = (req.user as any)?.id;
      if (!orgId) return res.status(400).json({ error: "No organization context" });
      const { payerId, planProductCode, notes } = req.body;
      if (!payerId || typeof payerId !== "string") return res.status(400).json({ error: "payerId is required" });
      const db = await import("./db").then(m => m.pool);

      // Check payer exists
      const { rows: payerRows } = await db.query(`SELECT id FROM payers WHERE id = $1`, [payerId]);
      if (payerRows.length === 0) return res.status(404).json({ error: "Payer not found" });

      const { rows } = await db.query(
        `INSERT INTO practice_payer_enrollments (organization_id, payer_id, plan_product_code, enrolled_by, notes, disabled_at)
         VALUES ($1, $2, $3, $4, $5, NULL)
         ON CONFLICT (organization_id, payer_id, plan_product_code) DO UPDATE
           SET disabled_at = NULL, enrolled_at = now(), enrolled_by = $4, notes = COALESCE(EXCLUDED.notes, practice_payer_enrollments.notes)
         RETURNING *`,
        [orgId, payerId, planProductCode ?? null, userId, notes ?? null]
      );
      invalidateResolverCache(orgId);
      res.status(201).json(rows[0]);
    } catch (err: any) {
      console.error("[C0] POST payer-enrollments:", err.message);
      res.status(500).json({ error: "Failed to create enrollment" });
    }
  });

  app.delete("/api/practice/payer-enrollments/:id", requireAuth, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ error: "No organization context" });
      const db = await import("./db").then(m => m.pool);
      const { rows } = await db.query(
        `UPDATE practice_payer_enrollments
            SET disabled_at = now()
          WHERE id = $1 AND organization_id = $2
          RETURNING *`,
        [req.params.id, orgId]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Enrollment not found" });
      invalidateResolverCache(orgId);
      res.status(204).end();
    } catch (err: any) {
      console.error("[C0] DELETE payer-enrollments:", err.message);
      res.status(500).json({ error: "Failed to disable enrollment" });
    }
  });

  app.get("/api/practice/activated-fields", requireAuth, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ error: "No organization context" });
      const { payerId, planProductCode, delegatedEntityId, includeDemoSeed } = req.query as Record<string, string>;
      const fields = await getActivatedFieldsForContext({
        organizationId: orgId,
        payerId: payerId || undefined,
        planProductCode: planProductCode || undefined,
        delegatedEntityId: delegatedEntityId || undefined,
        includeDemoSeed: includeDemoSeed === "true",
      });
      res.json(fields);
    } catch (err: any) {
      console.error("[C0] GET activated-fields:", err.message);
      res.status(500).json({ error: "Failed to resolve fields" });
    }
  });

  app.get("/api/admin/field-definitions", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT code, label, applies_to, data_type, always_required, activated_by_rule_kinds
           FROM field_definitions
          ORDER BY applies_to, code`
      );
      res.json(rows);
    } catch (err: any) {
      console.error("[C0] GET field-definitions:", err.message);
      res.status(500).json({ error: "Failed to fetch field definitions" });
    }
  });

  // ── End Prompt C0 ─────────────────────────────────────────────────────────

  app.get("/api/billing/va-locations", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const { rows } = await db.query("SELECT DISTINCT location_name FROM va_location_rates ORDER BY location_name");
      res.json(rows.map((r: any) => r.location_name));
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/va-rate", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const code = (req.query.code as string || "").trim().toUpperCase();
      const locationParam = (req.query.location as string || "").trim();
      const payerParam = (req.query.payer as string || "").trim();
      if (!code) return res.status(400).json({ error: "code is required" });
      const db = await import("./db").then(m => m.pool);

      // Resolve practice locality for this org — needed for fallback lookup.
      // billing_location may be a ZIP code (e.g. "41884") which does NOT match
      // va_location_rates.location_name (city names). Skip locality lookup for ZIPs.
      const orgId = getOrgId(req);
      let resolvedLocality: string | null = locationParam || null;
      if (!resolvedLocality) {
        try {
          const psQuery = orgId
            ? await db.query(`SELECT default_va_locality, billing_location FROM practice_settings WHERE organization_id = $1 LIMIT 1`, [orgId])
            : await db.query(`SELECT default_va_locality, billing_location FROM practice_settings LIMIT 1`);
          const ps = psQuery.rows[0];
          const candidateLocality = ps?.default_va_locality || ps?.billing_location || null;
          // Only use locality if it looks like a place name, not a ZIP code
          if (candidateLocality && !/^\d{5}(-\d{4})?$/.test(candidateLocality.trim())) {
            resolvedLocality = candidateLocality;
          }
        } catch (_) { /* fall through */ }
      }

      // Determine effective payer name — prefer query param, fall back to practice payer
      const effectivePayerName = payerParam || "VA Community Care";

      // B: Use unified rate lookup — contracted rate always wins over locality/average
      const { lookupHcpcsRate } = await import("./lib/rate-lookup");
      const rateResult = await lookupHcpcsRate(code, effectivePayerName, resolvedLocality, orgId);

      if (!rateResult) {
        return res.json({ rate_per_unit: null, location_name: null, is_average: false });
      }

      // Enrich with hcpcs_codes metadata (unit_type, description)
      const { rows: hcpcsRows } = await db.query(
        `SELECT unit_type, unit_interval_minutes, description_plain FROM hcpcs_codes WHERE code = $1`,
        [code]
      );
      const hcpcsMeta = hcpcsRows[0] || {};

      return res.json({
        rate_per_unit: rateResult.rate_per_unit,
        location_name: rateResult.locality_name || null,
        source: rateResult.source,
        is_custom_rate: rateResult.source === "contracted",
        is_default_locality: rateResult.source === "locality",
        is_average: rateResult.source === "national_average",
        unit_type: hcpcsMeta.unit_type || null,
        unit_interval_minutes: hcpcsMeta.unit_interval_minutes || null,
        description_plain: hcpcsMeta.description_plain || null,
      });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/va-rates-age", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const { rows } = await db.query(
        "SELECT MIN(last_updated) as oldest_update FROM va_location_rates"
      );
      res.json({ lastUpdated: rows[0]?.oldest_update || null });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  // ── Timely Filing Alerts (Prompt 04 T5) ───────────────────────────────────
  app.get("/api/billing/filing-alerts", requireRole("admin", "rcm_manager", "biller"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = getOrgId(req);
      const { payer_id, status: filterStatus, page = "1", page_size = "50" } = req.query;

      let where = `tfa.organization_id = $1 AND tfa.alert_acknowledged_at IS NULL`;
      const params: any[] = [orgId];

      // Exclude snoozed alerts that are still within snooze window
      where += ` AND (tfa.snoozed_until IS NULL OR tfa.snoozed_until < NOW())`;
      // Exclude archived claims
      where += ` AND (c.archived_at IS NULL)`;

      if (filterStatus) { where += ` AND tfa.alert_status = $${params.length + 1}`; params.push(filterStatus); }
      if (payer_id) { where += ` AND p.id = $${params.length + 1}`; params.push(payer_id); }

      const countRes = await db.query(
        `SELECT COUNT(*) FROM timely_filing_alerts tfa
         LEFT JOIN claims c ON c.id = tfa.claim_id
         LEFT JOIN payers p ON p.id = c.payer_id
         WHERE ${where}`, params
      );

      const pageNum = Math.max(1, parseInt(page as string));
      const pageSize = Math.min(100, parseInt(page_size as string) || 50);
      const offset = (pageNum - 1) * pageSize;

      const rows = await db.query(`
        SELECT
          tfa.id, tfa.claim_id, tfa.alert_status, tfa.days_remaining,
          tfa.deadline_date, tfa.alert_sent_at, tfa.snoozed_until,
          c.status AS claim_status, c.service_date, c.amount,
          c.plan_product, c.payer AS payer_name_legacy,
          c.updated_at AS last_activity_at,
          pat.first_name || ' ' || pat.last_name AS patient_name,
          p.name AS payer_name,
          p.id AS payer_id
        FROM timely_filing_alerts tfa
        JOIN claims c ON c.id = tfa.claim_id
        LEFT JOIN patients pat ON pat.id = c.patient_id
        LEFT JOIN payers p ON p.id = c.payer_id
        WHERE ${where}
        ORDER BY tfa.days_remaining ASC NULLS LAST
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `, [...params, pageSize, offset]);

      // Count summary
      const summaryRes = await db.query(`
        SELECT alert_status, COUNT(*) AS cnt
        FROM timely_filing_alerts tfa
        WHERE tfa.organization_id = $1
          AND tfa.alert_acknowledged_at IS NULL
          AND (tfa.snoozed_until IS NULL OR tfa.snoozed_until < NOW())
        GROUP BY alert_status
      `, [orgId]);

      const summary: Record<string, number> = {};
      for (const r of summaryRes.rows) summary[r.alert_status] = parseInt(r.cnt);

      res.json({
        alerts: rows.rows,
        total: parseInt(countRes.rows[0].count),
        summary,
        page: pageNum,
        pageSize,
      });
    } catch (err: any) {
      console.error("[Filing Alerts] GET error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/billing/filing-alerts/:id/acknowledge", requireRole("admin", "rcm_manager", "biller"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const userId = (req.user as any)?.id;
      const result = await db.query(`
        UPDATE timely_filing_alerts
        SET alert_acknowledged_at = NOW(), alert_acknowledged_by = $1
        WHERE id = $2
        RETURNING id
      `, [userId, req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Alert not found" });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/billing/filing-alerts/:id/snooze", requireRole("admin", "rcm_manager", "biller"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const days = parseInt(req.body?.days || "7", 10);
      const result = await db.query(`
        UPDATE timely_filing_alerts
        SET snoozed_until = NOW() + ($1 || ' days')::interval
        WHERE id = $2
        RETURNING id
      `, [days, req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Alert not found" });
      res.json({ ok: true, snoozedDays: days });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Manual re-evaluate a single claim's timely filing status
  app.post("/api/billing/claims/:id/timely-filing-evaluate", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = getOrgId(req);
      const claimRes = await db.query(
        `SELECT c.id FROM claims c WHERE c.id = $1 AND c.organization_id = $2`,
        [req.params.id, orgId]
      );
      if (claimRes.rows.length === 0) return res.status(404).json({ error: "Claim not found" });

      // Inline single-claim evaluation (reuse guardian logic for the org)
      const { evaluateAllActiveClaims } = await import("./services/timely-filing-guardian");
      const stats = await evaluateAllActiveClaims();

      // Fetch updated timely filing data for this claim
      const updated = await db.query(
        `SELECT timely_filing_status, timely_filing_deadline, timely_filing_days_remaining, timely_filing_last_evaluated_at
         FROM claims WHERE id = $1`, [req.params.id]
      );
      res.json({ ok: true, claim: updated.rows[0], stats });
    } catch (err: any) {
      console.error("[Filing Evaluate] Error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── PCP Referrals (Prompt 05) ──────────────────────────────────────────────

  // List referrals for a patient
  app.get("/api/billing/patients/:id/referrals", requireRole("admin", "rcm_manager", "biller"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = getOrgId(req);
      const { rows } = await db.query(
        `SELECT r.*, u.name AS captured_by_name
         FROM pcp_referrals r
         LEFT JOIN users u ON u.id = r.captured_by
         WHERE r.patient_id = $1 AND r.organization_id = $2
         ORDER BY r.captured_at DESC`,
        [req.params.id, orgId]
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create a new referral
  app.post("/api/billing/patients/:id/referrals", requireRole("admin", "rcm_manager", "biller"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = getOrgId(req);
      const userId = (req as any).user?.id || "unknown";
      const {
        pcp_name, pcp_npi, pcp_phone, pcp_practice_name, referral_number,
        issue_date, expiration_date, visits_authorized, specialty_authorized,
        diagnosis_authorized, captured_via, status,
      } = req.body;

      if (!pcp_name || !issue_date) {
        return res.status(400).json({ error: "pcp_name and issue_date are required" });
      }

      const { rows } = await db.query(
        `INSERT INTO pcp_referrals
           (organization_id, patient_id, pcp_name, pcp_npi, pcp_phone, pcp_practice_name,
            referral_number, issue_date, expiration_date, visits_authorized, visits_used,
            specialty_authorized, diagnosis_authorized, captured_via, captured_by, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,$12,$13,$14,$15)
         RETURNING *`,
        [
          orgId, req.params.id, pcp_name, pcp_npi || null, pcp_phone || null, pcp_practice_name || null,
          referral_number || null, issue_date, expiration_date || null, visits_authorized || null,
          specialty_authorized || null, diagnosis_authorized || null,
          captured_via || "manual_entry", userId, status || "active",
        ]
      );
      res.status(201).json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update a referral
  app.patch("/api/billing/referrals/:id", requireRole("admin", "rcm_manager", "biller"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = getOrgId(req);
      const allowed = ["pcp_name","pcp_npi","pcp_phone","pcp_practice_name","referral_number",
        "issue_date","expiration_date","visits_authorized","visits_used",
        "specialty_authorized","diagnosis_authorized","captured_via","status"];
      const sets: string[] = [];
      const vals: any[] = [];
      for (const key of allowed) {
        if (req.body[key] !== undefined) { sets.push(`${key} = $${vals.length + 1}`); vals.push(req.body[key]); }
      }
      if (sets.length === 0) return res.status(400).json({ error: "No valid fields" });
      vals.push(req.params.id, orgId);
      const { rows } = await db.query(
        `UPDATE pcp_referrals SET ${sets.join(", ")} WHERE id = $${vals.length - 1} AND organization_id = $${vals.length} RETURNING *`,
        vals
      );
      if (rows.length === 0) return res.status(404).json({ error: "Referral not found" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Link a referral to a claim
  app.post("/api/billing/claims/:id/link-referral", requireRole("admin", "rcm_manager", "biller"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = getOrgId(req);
      const { referral_id } = req.body;

      // Verify claim belongs to org
      const claimRes = await db.query(
        `SELECT id FROM claims WHERE id = $1 AND organization_id = $2`, [req.params.id, orgId]
      );
      if (claimRes.rows.length === 0) return res.status(404).json({ error: "Claim not found" });

      if (referral_id) {
        // Verify referral belongs to org
        const refRes = await db.query(
          `SELECT id, status, visits_authorized, visits_used FROM pcp_referrals WHERE id = $1 AND organization_id = $2`,
          [referral_id, orgId]
        );
        if (refRes.rows.length === 0) return res.status(404).json({ error: "Referral not found" });
        const ref = refRes.rows[0];
        const checkStatus = ref.status === "active"
          ? (ref.visits_authorized != null && ref.visits_used >= ref.visits_authorized ? "present_used_up" : "present_valid")
          : ref.status === "expired" ? "present_expired" : "present_used_up";

        await db.query(
          `UPDATE claims SET pcp_referral_id = $1, pcp_referral_required = true, pcp_referral_check_status = $2 WHERE id = $3`,
          [referral_id, checkStatus, req.params.id]
        );
        // Increment visits_used on the referral
        if (ref.status === "active") {
          await db.query(`UPDATE pcp_referrals SET visits_used = visits_used + 1 WHERE id = $1`, [referral_id]);
        }
        res.json({ ok: true, pcp_referral_check_status: checkStatus });
      } else {
        // User is proceeding without a referral (HMO/POS plan, no referral chosen)
        await db.query(
          `UPDATE claims SET pcp_referral_required = true, pcp_referral_check_status = 'missing' WHERE id = $1`,
          [req.params.id]
        );
        res.json({ ok: true, pcp_referral_check_status: "missing" });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Claim Tracker ─────────────────────────────────────────────────────────
  app.get("/api/billing/claim-tracker", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = requireOrgCtx(req, res);
      if (!orgId) return;
      const { status, payer_id, patient, q, date_from, date_to } = req.query;

      let baseQuery = `
        SELECT
          c.id, c.status, c.amount, c.payer, c.payer_id,
          c.service_date, c.created_at, c.updated_at,
          c.organization_id, c.archived_at, c.archived_by,
          c.last_test_status, c.last_test_errors, c.last_test_at,
          c.plan_product, c.timely_filing_status, c.timely_filing_days_remaining,
          c.pcp_referral_check_status,
          COALESCE(p.first_name || ' ' || p.last_name, l.name, 'Unknown') as patient_name,
          p.id as patient_record_id,
          py.name as payer_name
        FROM claims c
        LEFT JOIN patients p ON c.patient_id = p.id
        LEFT JOIN leads l ON p.lead_id = l.id
        LEFT JOIN payers py ON c.payer_id = py.id
        WHERE 1=1
      `;
      const params: any[] = [];
      let idx = 1;

      baseQuery += ` AND c.organization_id = $${idx}`; params.push(orgId); idx++;
      baseQuery += ` AND c.archived_at IS NULL`;
      if (status && status !== "all") { baseQuery += ` AND c.status = $${idx}`; params.push(status); idx++; }
      if (payer_id && payer_id !== "all") { baseQuery += ` AND (c.payer_id = $${idx} OR c.payer = (SELECT name FROM payers WHERE id = $${idx}))`; params.push(payer_id); idx++; }
      if (patient) { baseQuery += ` AND (LOWER(COALESCE(p.first_name || ' ' || p.last_name, l.name,'')) LIKE LOWER($${idx}))`; params.push(`%${patient}%`); idx++; }
      if (date_from) { baseQuery += ` AND c.created_at >= $${idx}`; params.push(date_from); idx++; }
      if (date_to) { baseQuery += ` AND c.created_at <= $${idx}`; params.push(date_to); idx++; }
      if (q) { baseQuery += ` AND (c.id ILIKE $${idx} OR c.payer ILIKE $${idx})`; params.push(`%${q}%`); idx++; }

      baseQuery += ` ORDER BY c.created_at DESC LIMIT 200`;
      const { rows: claims } = await db.query(baseQuery, params);

      const claimIds = claims.map((c: any) => c.id);
      let events: any[] = [];
      if (claimIds.length > 0) {
        const { rows } = await db.query(
          `SELECT * FROM claim_events WHERE claim_id = ANY($1) ORDER BY timestamp DESC`,
          [claimIds]
        );
        events = rows;
      }

      const eventsByClaimId: Record<string, any[]> = {};
      for (const ev of events) {
        if (!eventsByClaimId[ev.claim_id]) eventsByClaimId[ev.claim_id] = [];
        eventsByClaimId[ev.claim_id].push(ev);
      }

      res.json(claims.map((c: any) => ({
        ...c,
        events: eventsByClaimId[c.id] || [],
      })));
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.post("/api/billing/claims/:id/mark-fixed", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const { resubmit, eventId } = req.body;
      const claimResult = await db.query("SELECT * FROM claims WHERE id = $1", [req.params.id]);
      if (claimResult.rows.length === 0) return res.status(404).json({ error: "Claim not found" });
      if (!verifyOrg(claimResult.rows[0], req)) return res.status(404).json({ error: "Claim not found" });

      const allowedResubmitStatuses = ['denied', 'error', 'appeal_needed', 'review_needed'];
      if (resubmit) {
        if (!allowedResubmitStatuses.includes(claimResult.rows[0].status)) {
          return res.status(400).json({ error: `Cannot resubmit a claim in '${claimResult.rows[0].status}' status. Only denied or error claims may be resubmitted.` });
        }
        await db.query(`UPDATE claims SET status = 'submitted', updated_at = NOW() WHERE id = $1`, [req.params.id]);
        await db.query(
          `INSERT INTO claim_events (id, claim_id, type, notes, organization_id) VALUES ($1, $2, 'Resubmitted', 'Claim resubmitted after error was fixed', $3)`,
          [crypto.randomUUID(), req.params.id, claimResult.rows[0].organization_id]
        );
      } else {
        await db.query(
          `INSERT INTO claim_events (id, claim_id, type, notes, organization_id) VALUES ($1, $2, 'MarkedFixed', 'Error marked as fixed without resubmission', $3)`,
          [crypto.randomUUID(), req.params.id, claimResult.rows[0].organization_id]
        );
      }
      res.json({ success: true });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  // ── ERA Posting ────────────────────────────────────────────────────────────
  app.get("/api/billing/eras", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = requireOrgCtx(req, res);
      if (!orgId) return;
      const { rows } = await db.query(
        `SELECT eb.*, COUNT(el.id) as line_count FROM era_batches eb LEFT JOIN era_lines el ON el.era_id = eb.id WHERE eb.org_id = $1 GROUP BY eb.id ORDER BY eb.created_at DESC`,
        [orgId]
      );
      res.json(rows);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.post("/api/billing/eras", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = getOrgId(req);
      const { payer_name, check_number, payment_date, total_amount, lines = [] } = req.body;
      const eraId = crypto.randomUUID();
      await db.query(
        `INSERT INTO era_batches (id, org_id, payer_name, check_number, payment_date, total_amount, status) VALUES ($1,$2,$3,$4,$5,$6,'unposted')`,
        [eraId, orgId, payer_name, check_number, payment_date, total_amount || 0]
      );
      for (const line of lines) {
        await db.query(
          `INSERT INTO era_lines (id, era_id, claim_id, org_id, patient_name, dos, billed_amount, allowed_amount, paid_amount, service_lines) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
          [crypto.randomUUID(), eraId, line.claim_id || null, orgId, line.patient_name, line.dos, line.billed_amount || 0, line.allowed_amount || 0, line.paid_amount || 0, JSON.stringify(line.service_lines || [])]
        );
      }
      res.json({ id: eraId });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/eras/:id", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = getOrgId(req);
      const { rows: [era] } = await db.query(`SELECT * FROM era_batches WHERE id = $1 AND org_id = $2`, [req.params.id, orgId]);
      if (!era) return res.status(404).json({ error: "ERA not found" });
      const { rows: lines } = await db.query(
        `SELECT el.*, c.id as matched_claim_id FROM era_lines el LEFT JOIN claims c ON el.claim_id = c.id WHERE el.era_id = $1 ORDER BY el.created_at`,
        [req.params.id]
      );
      res.json({ ...era, lines });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.patch("/api/billing/eras/:id", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = getOrgId(req);
      const { action } = req.body;
      const { rows: [era] } = await db.query(`SELECT * FROM era_batches WHERE id = $1 AND org_id = $2`, [req.params.id, orgId]);
      if (!era) return res.status(404).json({ error: "ERA not found" });

      if (action === "post") {
        const { rows: lines } = await db.query(`SELECT * FROM era_lines WHERE era_id = $1`, [req.params.id]);
        // Load all CARC posting rules for efficient in-memory lookup
        const { rows: carcRules } = await db.query(`SELECT carc_code, default_action FROM carc_posting_rules WHERE is_active = true`);
        const carcActionMap: Record<string, string> = {};
        for (const r of carcRules) carcActionMap[r.carc_code] = r.default_action;

        const today = new Date().toISOString().slice(0, 10);
        for (const line of lines) {
          if (!line.claim_id) {
            await db.query(`UPDATE era_lines SET status = 'posted' WHERE id = $1`, [line.id]);
            continue;
          }

          // Verify the linked claim belongs to the same org as this ERA batch
          const { rows: [claimOrgRow] } = await db.query(
            `SELECT organization_id FROM claims WHERE id = $1 LIMIT 1`,
            [line.claim_id]
          );
          if (!claimOrgRow || claimOrgRow.organization_id !== era.org_id) {
            console.warn(`[ERA Post] Skipping line ${line.id}: claim ${line.claim_id} does not belong to ERA org ${era.org_id}`);
            continue;
          }

          // Determine primary action from CARC adjustment codes
          // era_lines.service_lines stores adjustments as [{code, amount, reason}]
          const adjustments: Array<{ code: string; amount: number; reason: string }> =
            (() => { try { return Array.isArray(line.service_lines) ? line.service_lines : JSON.parse(line.service_lines || "[]"); } catch { return []; } })();

          // Derive CARC codes: format is "CO-45" → strip prefix to get "45"
          const carcCodes = adjustments.map((a: any) => {
            const raw = String(a.code || a.reason || "");
            return raw.replace(/^[A-Z]+-/, ""); // strip "CO-", "PR-", "OA-" prefix
          }).filter(Boolean);

          // Determine dominant action by priority: flag_appeal > flag_review > patient_responsibility > auto_writeoff > post_payment
          const priority: Record<string, number> = { flag_appeal: 4, flag_review: 3, patient_responsibility: 2, auto_writeoff: 1 };
          let dominantAction = "post_payment";
          let dominantPriority = 0;
          for (const code of carcCodes) {
            const action = carcActionMap[code];
            if (action && (priority[action] || 0) > dominantPriority) {
              dominantAction = action;
              dominantPriority = priority[action] || 0;
            }
          }

          let newStatus: string;
          let eventType: string;
          let eventNotes: string;

          if (dominantAction === "flag_appeal") {
            newStatus = "appeal_needed";
            eventType = "Denial";
            eventNotes = `ERA ${era.check_number}: Claim flagged for appeal. CARC: ${carcCodes.join(", ")}. Paid: $${line.paid_amount}`;
          } else if (dominantAction === "flag_review") {
            newStatus = "review_needed";
            eventType = "StatusChange";
            eventNotes = `ERA ${era.check_number}: Claim flagged for review. CARC: ${carcCodes.join(", ")}. Paid: $${line.paid_amount}`;
          } else if (dominantAction === "patient_responsibility") {
            newStatus = line.paid_amount > 0 ? "paid" : "patient_balance";
            eventType = "Payment";
            eventNotes = `ERA ${era.check_number}: Patient responsibility applied. CARC: ${carcCodes.join(", ")}. Paid: $${line.paid_amount}, Patient balance: $${adjustments.reduce((s: number, a: any) => s + (Number(a.amount) || 0), 0).toFixed(2)}`;
          } else if (dominantAction === "auto_writeoff" || line.paid_amount >= 0) {
            newStatus = line.paid_amount > 0 ? "paid" : "written_off";
            eventType = "Payment";
            eventNotes = `ERA payment posted: $${line.paid_amount} from ${era.check_number} on ${today}${carcCodes.length ? `. CARC: ${carcCodes.join(", ")}` : ""}`;
          } else {
            newStatus = line.paid_amount > 0 ? "paid" : "denied";
            eventType = line.paid_amount > 0 ? "Payment" : "Denial";
            eventNotes = `ERA ${era.check_number}: $${line.paid_amount} posted on ${today}`;
          }

          await db.query(`UPDATE claims SET status = $1, updated_at = NOW() WHERE id = $2`, [newStatus, line.claim_id]);
          await db.query(
            `INSERT INTO claim_events (id, claim_id, type, notes, organization_id) VALUES ($1, $2, $3, $4, $5)`,
            [crypto.randomUUID(), line.claim_id, eventType, eventNotes, era.org_id]
          );
          await db.query(`UPDATE era_lines SET status = 'posted' WHERE id = $1`, [line.id]);
        }
        await db.query(`UPDATE era_batches SET status = 'posted' WHERE id = $1`, [req.params.id]);
      } else if (action === "auto-post") {
        // Auto-posting logic: check payer ERA settings
        const { rows: lines } = await db.query(`SELECT * FROM era_lines WHERE era_id = $1`, [req.params.id]);
        // Look up payer by payer_name match
        const { rows: payerRows } = await db.query(`SELECT * FROM payers WHERE LOWER(name) = LOWER($1) LIMIT 1`, [era.payer_name]);
        const payer = payerRows[0];
        if (!payer || !payer.era_auto_post_clean) {
          await db.query(`UPDATE era_batches SET status = 'needs_review' WHERE id = $1`, [req.params.id]);
          return res.json({ success: true, autoPosted: false, reason: "Auto-post not enabled for this payer" });
        }
        // Check conditions: no denials, no $0 paid lines (unless CO-45 contractual)
        const hasDenials = lines.some((l: any) => l.paid_amount === 0 && !payer.era_auto_post_contractual);
        const hasMismatch = payer.era_hold_if_mismatch && lines.some((l: any) => l.paid_amount > 0 && l.paid_amount < l.billed_amount && l.allowed_amount > 0 && Math.abs(l.paid_amount - l.allowed_amount) > 0.01);
        if (hasDenials || hasMismatch) {
          await db.query(`UPDATE era_batches SET status = 'needs_review' WHERE id = $1`, [req.params.id]);
          return res.json({ success: true, autoPosted: false, reason: "ERA held for review: contains denials or payment mismatch" });
        }
        const today = new Date().toISOString().slice(0, 10);
        for (const line of lines) {
          if (line.claim_id) {
            if (line.paid_amount > 0) {
              await db.query(`UPDATE claims SET status = 'paid', updated_at = NOW() WHERE id = $1`, [line.claim_id]);
            }
            await db.query(
              `INSERT INTO claim_events (id, claim_id, type, notes) VALUES ($1, $2, 'Payment', $3)`,
              [crypto.randomUUID(), line.claim_id, `Payment auto-posted from ERA ${era.check_number} on ${today}`]
            );
          }
          await db.query(`UPDATE era_lines SET status = 'posted' WHERE id = $1`, [line.id]);
        }
        await db.query(`UPDATE era_batches SET status = 'auto-posted' WHERE id = $1`, [req.params.id]);
        return res.json({ success: true, autoPosted: true });
      } else if (action === "review") {
        await db.query(`UPDATE era_batches SET status = 'needs_review' WHERE id = $1`, [req.params.id]);
      } else if (action === "skip") {
        await db.query(`UPDATE era_batches SET status = 'skipped' WHERE id = $1`, [req.params.id]);
      }
      res.json({ success: true });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  // ── Follow-Up Work Queue ───────────────────────────────────────────────────
  app.get("/api/billing/follow-up", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = getOrgId(req);
      const params: any[] = [];
      let idx = 1;
      let query = `
        SELECT c.*,
          COALESCE(p.first_name || ' ' || p.last_name, l.name, 'Unknown') as patient_name,
          p.id as patient_record_id,
          py.name as payer_display,
          COALESCE(c.service_date, e.expected_start_date::date) as service_date,
          EXTRACT(DAY FROM NOW() - COALESCE(c.service_date, e.expected_start_date::date))::int as days_outstanding,
          (SELECT note_text FROM claim_follow_up_notes WHERE claim_id = c.id ORDER BY created_at DESC LIMIT 1) as last_note,
          (SELECT created_at FROM claim_follow_up_notes WHERE claim_id = c.id ORDER BY created_at DESC LIMIT 1) as last_note_at
        FROM claims c
        LEFT JOIN patients p ON c.patient_id = p.id
        LEFT JOIN leads l ON p.lead_id = l.id
        LEFT JOIN payers py ON c.payer_id = py.id
        LEFT JOIN encounters e ON c.encounter_id = e.id
        WHERE c.status NOT IN ('paid', 'draft', 'void')
      `;
      if (orgId) { query += ` AND c.organization_id = $${idx}`; params.push(orgId); idx++; }
      query += ` ORDER BY c.follow_up_date ASC NULLS LAST, days_outstanding DESC LIMIT 500`;
      const { rows } = await db.query(query, params);
      res.json(rows);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.post("/api/billing/follow-up-notes", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = getOrgId(req);
      const { claim_id, note_text } = req.body;
      if (!claim_id || !note_text) return res.status(400).json({ error: "claim_id and note_text required" });
      const user = req.user as any;
      const { rows: [note] } = await db.query(
        `INSERT INTO claim_follow_up_notes (id, claim_id, org_id, user_id, user_name, note_text) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [crypto.randomUUID(), claim_id, orgId, user?.id || null, user?.name || null, note_text]
      );
      res.json(note);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/follow-up-notes/:claimId", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const { rows } = await db.query(
        `SELECT * FROM claim_follow_up_notes WHERE claim_id = $1 ORDER BY created_at DESC`,
        [req.params.claimId]
      );
      res.json(rows);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.post("/api/billing/follow-up-notes/copy-to-patient", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = getOrgId(req);
      const { source_claim_id, note_text } = req.body;
      if (!source_claim_id || !note_text) return res.status(400).json({ error: "source_claim_id and note_text required" });
      const user = req.user as any;
      const { rows: sourceClaim } = await db.query(`SELECT patient_id FROM claims WHERE id = $1`, [source_claim_id]);
      if (!sourceClaim[0]) return res.status(404).json({ error: "Source claim not found" });
      const patientId = sourceClaim[0].patient_id;
      const { rows: unpaidClaims } = await db.query(
        `SELECT id FROM claims WHERE patient_id = $1 AND id != $2 AND status NOT IN ('paid','draft','void') AND organization_id = $3`,
        [patientId, source_claim_id, orgId]
      );
      let count = 0;
      for (const claim of unpaidClaims) {
        await db.query(
          `INSERT INTO claim_follow_up_notes (id, claim_id, org_id, user_id, user_name, note_text) VALUES ($1,$2,$3,$4,$5,$6)`,
          [crypto.randomUUID(), claim.id, orgId, user?.id || null, user?.name || null, note_text]
        );
        count++;
      }
      res.json({ copied: count });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  // ── Letter Generators ──────────────────────────────────────────────────────
  app.get("/api/billing/claims/:id/letter-data", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = getOrgId(req);
      const { rows: [claim] } = await db.query(`SELECT * FROM claims WHERE id = $1 AND organization_id = $2`, [req.params.id, orgId]);
      if (!claim) return res.status(404).json({ error: "Claim not found" });

      const [patientRes, settingsRes, payerRes, eventsRes, denialRes] = await Promise.all([
        db.query(`SELECT p.*, l.name as lead_name FROM patients p LEFT JOIN leads l ON p.lead_id = l.id WHERE p.id = $1`, [claim.patient_id]),
        db.query(`SELECT * FROM practice_settings WHERE organization_id = $1 LIMIT 1`, [orgId]),
        db.query(`SELECT * FROM payers WHERE id = $1 OR LOWER(name) = LOWER($2) LIMIT 1`, [claim.payer_id, claim.payer]),
        db.query(`SELECT * FROM claim_events WHERE claim_id = $1 ORDER BY timestamp DESC`, [req.params.id]),
        db.query(`SELECT d.*, cc.description as carc_desc FROM denials d LEFT JOIN carc_codes cc ON d.denial_reason_text = cc.code WHERE d.claim_id = $1 ORDER BY d.created_at DESC LIMIT 1`, [req.params.id]),
      ]);

      const patient = patientRes.rows[0];
      const settings = settingsRes.rows[0];
      const payer = payerRes.rows[0];
      const events = eventsRes.rows;
      const denial = denialRes.rows[0];

      const submissionEvent = events.find((e: any) => e.type === 'Submitted' || e.type === 'submission');
      const denialEvent = events.find((e: any) => e.type === 'Denied' || e.type === 'StatusChange' && e.notes?.includes('denied'));
      const tcn = claim.availity_icn || submissionEvent?.notes?.match(/TCN[:\s]+(\S+)/i)?.[1] || null;

      res.json({
        claim,
        patient: { ...patient, name: patient ? `${patient.first_name || ''} ${patient.last_name || patient.lead_name || ''}`.trim() : 'Unknown' },
        practice: settings,
        payer,
        tcn,
        submissionDate: submissionEvent?.timestamp || claim.created_at,
        denialDate: denialEvent?.timestamp || null,
        denialCode: denial?.denial_reason_text || null,
        denialDescription: denial?.carc_desc || denial?.denial_reason_text || null,
      });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/intake/dashboard/stats", requireRole("admin", "intake"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = requireOrgCtx(req, res);
      if (!orgId) return;
      const [pipelineResult, appointmentsResult, chatsResult] = await Promise.all([
        db.query(`
          SELECT l.status, COUNT(*)::int as count,
            COUNT(*) FILTER (WHERE l.sla_deadline_at IS NOT NULL AND l.sla_deadline_at < NOW())::int as sla_breach_count
          FROM leads l
          WHERE l.organization_id = $1
          GROUP BY l.status
        `, [orgId]),
        db.query(`
          SELECT a.id, a.title, a.scheduled_at, a.status, l.name as lead_name
          FROM appointments a
          LEFT JOIN leads l ON a.lead_id = l.id
          WHERE DATE(a.scheduled_at) = CURRENT_DATE
            AND a.organization_id = $1
          ORDER BY a.scheduled_at ASC
        `, [orgId]),
        db.query(`
          SELECT cs.id, cs.status, cs.started_at, l.name as lead_name
          FROM chat_sessions cs
          LEFT JOIN leads l ON cs.lead_id = l.id
          WHERE cs.organization_id = $1
          ORDER BY cs.started_at DESC
          LIMIT 5
        `, [orgId]),
      ]);
      res.json({
        pipeline: pipelineResult.rows,
        todayAppointments: appointmentsResult.rows,
        recentChats: chatsResult.rows,
      });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/dashboard/stats", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = requireOrgCtx(req, res);
      if (!orgId) return;
      const safeOrgId = orgId.replace(/'/g, "''");
      const orgFilter = `AND organization_id = '${safeOrgId}'`;
      const orgPatientFilter = `AND p.organization_id = '${safeOrgId}'`;
      const orgClaimFilter = `AND c.organization_id = '${safeOrgId}'`;

      const [pipelineResult, staleDraftsResult, highRiskResult, timelyResult, recentPatientsResult, recentClaimsResult, fprrResult, arDaysResult] = await Promise.all([
        db.query(`
          SELECT
            COUNT(*) FILTER (WHERE status = 'paid') as paid_count,
            COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) as paid_amount,
            COUNT(*) FILTER (WHERE status IN ('submitted','acknowledged','pending')) as in_process_count,
            COALESCE(SUM(amount) FILTER (WHERE status IN ('submitted','acknowledged','pending')), 0) as in_process_amount,
            COUNT(*) FILTER (WHERE status = 'draft') as draft_count,
            COALESCE(SUM(amount) FILTER (WHERE status = 'draft'), 0) as draft_amount,
            COUNT(*) FILTER (WHERE status IN ('denied','suspended')) as denied_count,
            COALESCE(SUM(amount) FILTER (WHERE status IN ('denied','suspended')), 0) as denied_amount,
            COUNT(*) FILTER (WHERE status NOT IN ('draft')) as total_submitted,
            COUNT(*) FILTER (WHERE status IN ('denied','suspended')) as total_denied
          FROM claims WHERE 1=1 ${orgFilter}
        `),
        db.query(`SELECT COUNT(*)::int as count FROM claims WHERE status = 'draft' AND created_at < NOW() - INTERVAL '7 days' ${orgFilter}`),
        db.query(`SELECT COUNT(*)::int as count FROM claims WHERE readiness_status = 'RED' AND status NOT IN ('paid','denied') ${orgFilter}`),
        db.query(`
          SELECT COUNT(*)::int as count FROM (
            SELECT DISTINCT ON (c.id) c.id
            FROM claims c
            LEFT JOIN payers p ON c.payer_id = p.id OR LOWER(p.name) = LOWER(c.payer)
            WHERE (c.service_date IS NOT NULL OR c.statement_period_start IS NOT NULL)
              AND c.status NOT IN ('paid', 'denied', 'draft')
              AND COALESCE(c.statement_period_start, c.service_date) < NOW() - ((COALESCE(p.timely_filing_days, 365) - 30) || ' days')::interval
              ${orgClaimFilter}
          ) t
        `),
        db.query(`
          SELECT p.id, p.first_name, p.last_name, p.insurance_carrier,
            latest.last_service_date, latest.last_claim_status,
            l.name as lead_name
          FROM patients p
          INNER JOIN (
            SELECT DISTINCT ON (patient_id) patient_id, service_date as last_service_date, status as last_claim_status, created_at
            FROM claims WHERE 1=1 ${orgFilter} ORDER BY patient_id, created_at DESC
          ) latest ON latest.patient_id = p.id
          LEFT JOIN leads l ON p.lead_id = l.id
          WHERE 1=1 ${orgPatientFilter}
          ORDER BY latest.created_at DESC
          LIMIT 8
        `),
        db.query(`
          SELECT c.*,
            COALESCE(p.first_name || ' ' || p.last_name, l.name, 'Unknown Patient') as patient_name
          FROM claims c
          LEFT JOIN patients p ON c.patient_id = p.id
          LEFT JOIN leads l ON p.lead_id = l.id
          WHERE 1=1 ${orgClaimFilter}
          ORDER BY c.created_at DESC
          LIMIT 10
        `),
        db.query(`
          SELECT
            COUNT(*) FILTER (WHERE status NOT IN ('draft')) as total_submitted,
            COUNT(*) FILTER (WHERE status = 'paid') as total_paid,
            COUNT(*) FILTER (WHERE status IN ('denied','suspended')) as total_denied
          FROM claims WHERE 1=1 ${orgFilter}
        `),
        db.query(`
          SELECT
            COALESCE(AVG(EXTRACT(DAY FROM NOW() - service_date)), 0)::numeric(5,1) as avg_ar_days
          FROM claims
          WHERE status NOT IN ('paid','draft','void')
            AND service_date IS NOT NULL
            ${orgFilter}
        `),
      ]);

      const p = pipelineResult.rows[0];
      const fpr = fprrResult.rows[0];
      const totalSubmitted = parseInt(fpr.total_submitted) || 0;
      const totalPaid = parseInt(fpr.total_paid) || 0;
      const totalDenied = parseInt(fpr.total_denied) || 0;
      const fprrValue = totalSubmitted > 0 ? Math.round((totalPaid / totalSubmitted) * 100) : null;
      const arDays = parseFloat(arDaysResult.rows[0]?.avg_ar_days) || 0;
      const denialRate = totalSubmitted > 0 ? Math.round((totalDenied / totalSubmitted) * 100) : 0;

      res.json({
        pipeline: {
          paid: { count: parseInt(p.paid_count), amount: parseFloat(p.paid_amount) },
          inProcess: { count: parseInt(p.in_process_count), amount: parseFloat(p.in_process_amount) },
          draft: { count: parseInt(p.draft_count), amount: parseFloat(p.draft_amount) },
          denied: { count: parseInt(p.denied_count), amount: parseFloat(p.denied_amount) },
        },
        alerts: {
          deniedClaims: { count: parseInt(p.denied_count), amount: parseFloat(p.denied_amount) },
          staleDrafts: staleDraftsResult.rows[0].count,
          timelyFilingRisk: timelyResult.rows[0].count,
          highRiskClaims: highRiskResult.rows[0].count,
        },
        benchmarks: {
          arDays: Math.round(arDays),
          denialRate,
          fprrValue,
        },
        recentPatients: recentPatientsResult.rows,
        recentClaims: recentClaimsResult.rows,
      });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  // ── Onboarding Checklist ───────────────────────────────────────────────────
  app.get("/api/billing/onboarding-checklist", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = getOrgId(req);

      const [psResult, provResult, payerResult, claimResult] = await Promise.all([
        orgId
          ? db.query(`SELECT practice_name, address, primary_npi, tax_id, default_pos FROM practice_settings WHERE organization_id = $1 LIMIT 1`, [orgId])
          : db.query(`SELECT practice_name, address, primary_npi, tax_id, default_pos FROM practice_settings LIMIT 1`),
        orgId
          ? db.query(`SELECT COUNT(*)::int as cnt FROM providers WHERE is_active = true AND organization_id = $1`, [orgId])
          : db.query(`SELECT COUNT(*)::int as cnt FROM providers WHERE is_active = true`),
        // payers is a global reference table — no organization_id
        db.query(`SELECT COUNT(*)::int as cnt FROM payers WHERE is_active = true`),
        orgId
          ? db.query(`SELECT COUNT(*)::int as cnt FROM claims WHERE status != 'draft' AND organization_id = $1`, [orgId])
          : db.query(`SELECT COUNT(*)::int as cnt FROM claims WHERE status != 'draft'`),
      ]);

      const ps = psResult.rows[0];
      const hasPractice = !!(ps?.practice_name && ps?.primary_npi && ps?.tax_id);
      const hasProvider = (provResult.rows[0]?.cnt || 0) > 0;
      const hasPayer = (payerResult.rows[0]?.cnt || 0) > 0;

      let clearinghouseConnected = false;
      try {
        // Passes if either Stedi API key is present OR Office Ally is connected
        const stediConfigured = !!process.env.STEDI_API_KEY;
        if (!stediConfigured && ps) {
          const { rows: psRows } = orgId
            ? await db.query(`SELECT oa_connected, oa_sftp_username FROM practice_settings WHERE organization_id = $1 LIMIT 1`, [orgId])
            : await db.query(`SELECT oa_connected, oa_sftp_username FROM practice_settings LIMIT 1`);
          clearinghouseConnected = !!(psRows[0]?.oa_connected && psRows[0]?.oa_sftp_username);
        } else {
          clearinghouseConnected = stediConfigured;
        }
      } catch { clearinghouseConnected = false; }

      const hasClaimDefaults = !!ps?.default_pos;
      const hasFirstClaim = (claimResult.rows[0]?.cnt || 0) > 0;

      // Check if dismissed
      let dismissedAt: string | null = null;
      if (orgId) {
        const { rows: orgRows } = await db.query(`SELECT onboarding_dismissed_at FROM organizations WHERE id = $1`, [orgId]);
        dismissedAt = orgRows[0]?.onboarding_dismissed_at || null;
      }

      const steps = [
        { id: 1, label: "Add practice information", done: hasPractice, link: "/billing/settings?tab=practice" },
        { id: 2, label: "Add at least one provider", done: hasProvider, link: "/billing/settings?tab=providers" },
        { id: 3, label: "Add at least one payer", done: hasPayer, link: "/billing/settings?tab=payers" },
        { id: 4, label: "Configure a clearinghouse", done: clearinghouseConnected, link: "/billing/settings?tab=clearinghouse" },
        { id: 5, label: "Set claim defaults", done: hasClaimDefaults, link: "/billing/settings?tab=claim-defaults" },
        { id: 6, label: "Submit your first test claim", done: hasFirstClaim, link: "/billing/claims/new" },
      ];

      const completedCount = steps.filter(s => s.done).length;
      const allDone = completedCount === steps.length;
      const dismissed = allDone && dismissedAt
        ? new Date(dismissedAt).getTime() > Date.now() - 24 * 3600 * 1000
          ? true // dismissed within 24h: still show success state
          : false // dismissed >24h ago: hide permanently
        : false;

      res.json({ steps, completedCount, total: steps.length, allDone, dismissed, dismissedAt });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.post("/api/billing/onboarding-checklist/dismiss", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = getOrgId(req);
      if (orgId) {
        await db.query(`UPDATE organizations SET onboarding_dismissed_at = NOW() WHERE id = $1`, [orgId]);
      }
      res.json({ success: true });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  // ── Denial Recovery Agent ──────────────────────────────────────────────────
  app.get("/api/billing/claims/:id/denial-recovery", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const { rows: [claim] } = await db.query(`SELECT * FROM claims WHERE id = $1`, [req.params.id]);
      if (!claim || !verifyOrg(claim, req)) return res.status(404).json({ error: "Claim not found" });

      const { rows: denials } = await db.query(
        `SELECT d.*, cc.description as carc_description, cc.group_code
         FROM denials d
         LEFT JOIN carc_codes cc ON d.denial_reason_text = cc.code
         ORDER BY d.created_at DESC`,
        []
      );
      const claimDenials = denials.filter((d: any) => d.claim_id === req.params.id);

      const { rows: eraLines } = await db.query(
        `SELECT el.*, eb.check_number FROM era_lines el JOIN era_batches eb ON el.era_id = eb.id WHERE el.claim_id = $1 ORDER BY el.created_at DESC LIMIT 5`,
        [req.params.id]
      );

      // Enrich: for each denial CARC code, fetch full record from carc_codes table
      const carcCodesInvolved = [...new Set([
        ...claimDenials.map((d: any) => d.denial_reason_text).filter(Boolean),
        ...eraLines.flatMap((el: any) => {
          try { const sl = Array.isArray(el.service_lines) ? el.service_lines : JSON.parse(el.service_lines || "[]"); return sl.map((s: any) => s.carc || s.adjustment_code).filter(Boolean); } catch { return []; }
        }),
      ])];

      let carcDetails: any[] = [];
      if (carcCodesInvolved.length > 0) {
        const { rows } = await db.query(
          `SELECT code, description, group_code FROM carc_codes WHERE code = ANY($1)`,
          [carcCodesInvolved]
        );
        carcDetails = rows;
      }

      // Build intelligence: map each CARC to root cause + recommended action using carc_codes table
      const carcMap = Object.fromEntries(carcDetails.map(c => [c.code, c]));
      const recoveryActions = carcCodesInvolved.map((code: string) => {
        const carc = carcMap[code];
        const gc = carc?.group_code || "";
        let rootCause = carc?.description || `CARC ${code}`;
        let action = "Review denial reason and contact payer for clarification";
        if (gc === "CO") action = "Contractual obligation — verify contract terms or write off per agreement";
        if (gc === "PR") action = "Patient responsibility — bill patient or secondary insurance";
        if (gc === "OA") action = "Other adjustment — review payer remittance for details";
        if (gc === "PI") action = "Payer-initiated adjustment — no action required unless disputing";
        if (code === "CO-16" || code === "16") action = "Missing/invalid claim information — check NPI, auth number, and diagnosis pointers";
        if (code === "CO-29" || code === "29") action = "Timely filing exceeded — file appeal with original submission proof";
        if (code === "CO-45" || code === "45") action = "Contractual write-off — adjust per contract (no patient billing)";
        if (code === "CO-97" || code === "97") action = "Bundled service — unbundle or add modifier 59 if separate service";
        if (code === "CO-50" || code === "50") action = "Medical necessity — obtain prior auth documentation and appeal";
        return { code, rootCause, action, groupCode: gc };
      });

      res.json({ claim, denials: claimDenials, eraLines, carcDetails, recoveryActions });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  // ── Manual 277/835 Response Refresh ────────────────────────────────────────
  app.post("/api/billing/refresh-responses", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = getOrgId(req);
      const results: { type: string; processed: number; errors: string[] } = { type: "277+835", processed: 0, errors: [] };

      const { isSFTPConfigured, retrieve277Acknowledgments, retrieve835ERA } = await import("./services/office-ally");
      if (!(isSFTPConfigured as any)()) {
        return res.json({ message: "SFTP not configured — manual refresh unavailable. Configure OA_SFTP_HOST, OA_SFTP_USERNAME, OA_SFTP_PASSWORD to enable.", processed: 0 });
      }

      // Process 277 acknowledgments
      try {
        const acks = await retrieve277Acknowledgments();
        for (const ack of acks) {
          // Parse 277: look for CLM01 (claim control number) and status codes
          const lines = ack.split(/~\n|~/);
          for (const seg of lines) {
            const parts = seg.trim().split("*");
            if (parts[0] === "STC" && parts.length > 2) {
              const statusCode = parts[1];
              const claimRef = lines.find(s => s.startsWith("REF*"))?.split("*")?.[2];
              if (claimRef) {
                let newStatus = "acknowledged";
                if (statusCode.startsWith("A1")) newStatus = "acknowledged";
                if (statusCode.startsWith("A2")) newStatus = "submitted";
                if (statusCode.startsWith("A3") || statusCode.startsWith("R")) newStatus = "denied";
                try {
                  await db.query(
                    `UPDATE claims SET status = $1, updated_at = NOW() WHERE id LIKE $2 AND organization_id = $3`,
                    [newStatus, `%${claimRef.slice(0, 15)}%`, orgId]
                  );
                  await db.query(
                    `INSERT INTO claim_events (id, claim_id, type, notes, timestamp)
                     SELECT $1, id, '277 Acknowledgment', $2, NOW() FROM claims WHERE id LIKE $3 LIMIT 1`,
                    [crypto.randomUUID(), `Status: ${statusCode}`, `%${claimRef.slice(0, 15)}%`]
                  );
                  results.processed++;
                } catch (e: any) { results.errors.push(e.message); }
              }
            }
          }
        }
      } catch (e: any) { results.errors.push(`277 error: ${e.message}`); }

      // Process 835 ERA files
      try {
        const eras = await retrieve835ERA();
        for (const era of eras) {
          const lines = era.split(/~\n|~/);
          let checkNum = "", payerName = "", payDate = "";
          for (const seg of lines) {
            const parts = seg.trim().split("*");
            if (parts[0] === "BPR") payDate = parts[2] || "";
            if (parts[0] === "TRN") checkNum = parts[2] || "";
            if (parts[0] === "N1" && parts[1] === "PR") payerName = parts[2] || "";
            if (parts[0] === "CLP" && parts.length > 3) {
              const claimRef = parts[1], claimStatus = parts[2], paidAmt = parts[4];
              try {
                const eraId = crypto.randomUUID();
                await db.query(
                  `INSERT INTO era_batches (id, org_id, payer_name, check_number, payment_date, total_amount, status)
                   VALUES ($1, $2, $3, $4, $5, $6, 'unposted') ON CONFLICT DO NOTHING`,
                  [eraId, orgId, payerName, checkNum, payDate, paidAmt || 0]
                );
                results.processed++;
              } catch (e: any) { results.errors.push(e.message); }
            }
          }
        }
      } catch (e: any) { results.errors.push(`835 error: ${e.message}`); }

      res.json({ ...results, message: `Processed ${results.processed} response(s) from Office Ally` });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/prior-auths", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = requireOrgCtx(req, res);
      if (!orgId) return;
      const { rows } = await db.query(`
        SELECT pa.*,
          COALESCE(p.first_name || ' ' || p.last_name, 'Unknown') as patient_name,
          pa.payer as payer_name,
          c.id as claim_id
        FROM prior_authorizations pa
        LEFT JOIN patients p ON pa.patient_id = p.id
        LEFT JOIN claims c ON c.encounter_id = pa.encounter_id
        WHERE pa.organization_id = $1
        ORDER BY pa.requested_date DESC
      `, [orgId]);
      res.json(rows);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/activity-logs", requireRole("admin"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const { startDate, endDate, activityType, performedBy } = req.query;
      const orgId = requireOrgCtx(req, res);
      if (!orgId) return;
      let query = `
        SELECT al.*, u.email as user_email
        FROM activity_logs al
        LEFT JOIN users u ON al.performed_by::text = u.id::text
        WHERE (al.claim_id IS NOT NULL OR al.patient_id IS NOT NULL)
        AND al.organization_id = $1
      `;
      const params: any[] = [orgId];
      let idx = 2;
      if (startDate) { query += ` AND al.created_at >= $${idx++}`; params.push(startDate); }
      if (endDate) { query += ` AND al.created_at <= $${idx++}`; params.push(endDate); }
      if (activityType && activityType !== "all") { query += ` AND al.activity_type = $${idx++}`; params.push(activityType); }
      if (performedBy) { query += ` AND (u.email ILIKE $${idx++})`; params.push(`%${performedBy}%`); }
      query += ` ORDER BY al.created_at DESC LIMIT 200`;
      const { rows } = await db.query(query, params);
      res.json(rows);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/compliance-report/:type", requireRole("admin"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const { startDate, endDate } = req.query;
      const start = startDate || new Date(Date.now() - 30 * 86400000).toISOString();
      const end = endDate || new Date().toISOString();
      const type = req.params.type;
      let query = "";
      const orgId = requireOrgCtx(req, res);
      if (!orgId) return;
      const params = [start, end, orgId];

      switch (type) {
        case "access":
          query = `SELECT al.*, u.email as user_email FROM activity_logs al LEFT JOIN users u ON al.performed_by::text = u.id::text WHERE al.activity_type IN ('view_patient','view_claim','exported','export_pdf') AND al.created_at BETWEEN $1 AND $2 AND al.organization_id = $3 ORDER BY al.created_at DESC LIMIT 500`;
          break;
        case "edit-history":
          query = `SELECT al.*, u.email as user_email FROM activity_logs al LEFT JOIN users u ON al.performed_by::text = u.id::text WHERE al.field IS NOT NULL AND al.created_at BETWEEN $1 AND $2 AND al.organization_id = $3 ORDER BY al.created_at DESC LIMIT 500`;
          break;
        case "export":
          query = `SELECT al.*, u.email as user_email, c.amount, c.status as claim_status FROM activity_logs al LEFT JOIN users u ON al.performed_by::text = u.id::text LEFT JOIN claims c ON al.claim_id::text = c.id::text WHERE al.activity_type = 'export_pdf' AND al.created_at BETWEEN $1 AND $2 AND al.organization_id = $3 ORDER BY al.created_at DESC LIMIT 500`;
          break;
        case "claims-integrity":
          query = `SELECT c.id, c.status, c.amount, c.created_at, c.updated_at, c.service_date, c.readiness_status, c.submission_method, COALESCE(p.first_name || ' ' || p.last_name, 'Unknown') as patient_name FROM claims c LEFT JOIN patients p ON c.patient_id = p.id WHERE c.created_at BETWEEN $1 AND $2 AND c.organization_id = $3 ORDER BY c.created_at DESC LIMIT 500`;
          break;
        default:
          return res.status(400).json({ error: "Invalid report type" });
      }
      const { rows } = await db.query(query, params);
      res.json(rows);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/admin/users", requireRole("admin"), async (req, res) => {
    try {
      const { listUsers } = await import("./services/user-service");
      const users = await listUsers(getOrgId(req));
      res.json(users);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.post("/api/admin/users", requireRole("admin"), async (req, res) => {
    try {
      const { createUser } = await import("./services/user-service");
      const user = await createUser({ ...req.body, organizationId: getOrgId(req) });
      res.json(user);
    } catch (err: any) {
      console.error('[Create User] Error:', err);
      const status = err.message?.includes("already exists") ? 409 : 400;
      const message = err.message?.includes("already exists") ? "A user with this email already exists." : "Failed to create user. Please check the details and try again.";
      res.status(status).json({ error: message });
    }
  });

  app.patch("/api/admin/users/:id", requireRole("admin"), async (req, res) => {
    try {
      const targetUser = await storage.getUserById(req.params.id);
      if (!targetUser || !verifyOrg(targetUser, req)) return res.status(404).json({ error: "User not found" });
      const { updateUser } = await import("./services/user-service");
      const { name, role } = req.body;
      const user = await updateUser(req.params.id, { name, role });
      res.json(user);
    } catch (err: any) {
      console.error('[Update User] Error:', err);
      const status = err.message?.includes("not found") ? 404 : 400;
      res.status(status).json({ error: err.message?.includes("not found") ? "User not found." : "Failed to update user. Please try again." });
    }
  });

  app.patch("/api/admin/users/:id/password", requireRole("admin"), async (req, res) => {
    try {
      const targetUser = await storage.getUserById(req.params.id);
      if (!targetUser || !verifyOrg(targetUser, req)) return res.status(404).json({ error: "User not found" });
      const { updatePassword } = await import("./services/user-service");
      await updatePassword(req.params.id, req.body.password);
      res.json({ success: true });
    } catch (err: any) {
      console.error('[Password Update] Error:', err);
      res.status(400).json({ error: "Failed to update password. Please try again." });
    }
  });

  app.delete("/api/admin/users/:id", requireRole("admin"), async (req, res) => {
    try {
      const targetUser = await storage.getUserById(req.params.id);
      if (!targetUser || !verifyOrg(targetUser, req)) return res.status(404).json({ error: "User not found" });
      const { deleteUser } = await import("./services/user-service");
      const currentUser = (req as any).user;
      await deleteUser(req.params.id, currentUser.id);
      res.json({ success: true });
    } catch (err: any) {
      console.error('[Delete User] Error:', err);
      const status = err.message?.includes("not found") ? 404 : 400;
      res.status(status).json({ error: err.message?.includes("not found") ? "User not found." : "Failed to delete user. Please try again." });
    }
  });

  app.get("/api/billing/claims/wizard-data", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = requireOrgCtx(req, res);
      if (!orgId) return;
      const [providers, payers, settings] = await Promise.all([
        db.query("SELECT id, first_name, last_name, credentials, npi, is_default FROM providers WHERE is_active = true AND organization_id = $1 ORDER BY last_name", [orgId]),
        db.query("SELECT id, name, payer_id, timely_filing_days, auth_required, is_active FROM payers WHERE organization_id = $1 ORDER BY name", [orgId]),
        db.query("SELECT * FROM practice_settings WHERE organization_id = $1 LIMIT 1", [orgId]),
      ]);
      res.json({
        providers: providers.rows,
        payers: payers.rows,
        practiceSettings: settings.rows[0] || null,
      });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.post("/api/billing/claims/draft", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const { patientId } = req.body;
      if (!patientId) return res.status(400).json({ error: "Patient ID is required" });
      const orgId = requireOrgCtx(req, res);
      if (!orgId) return;
      const db = await import("./db").then(m => m.pool);
      const patient = await db.query("SELECT * FROM patients WHERE id = $1 AND organization_id = $2", [patientId, orgId]);
      if (patient.rows.length === 0) return res.status(404).json({ error: "Patient not found" });
      const p = patient.rows[0];

      const encounterId = crypto.randomUUID();
      const claimId = crypto.randomUUID();
      const now = new Date();

      await db.query(
        `INSERT INTO encounters (id, patient_id, service_type, facility_type, admission_type, expected_start_date, created_by, created_at, organization_id)
         VALUES ($1, $2, 'Home Health', 'Home', 'Elective', $3, $4, $5, $6)`,
        [encounterId, patientId, now.toISOString().split("T")[0], (req.user as any)?.email || null, now, orgId]
      );

      await db.query(
        `INSERT INTO claims (id, organization_id, patient_id, encounter_id, payer, cpt_codes, amount, status, risk_score, readiness_status, created_at, payer_id, authorization_number, created_by, plan_product)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, 0, 'draft', 0, 'GREEN', $7, $8, $9, $10, $11)`,
        [claimId, orgId, patientId, encounterId, p.insurance_carrier || 'Unknown', '[]', now, p.payer_id || null, p.authorization_number || null, (req.user as any)?.email || null, p.plan_product || null]
      );

      await db.query(
        `INSERT INTO claim_events (id, claim_id, type, timestamp, notes, organization_id)
         VALUES ($1, $2, 'Created', $3, 'Claim created via wizard', $4)`,
        [crypto.randomUUID(), claimId, now, orgId]
      );

      await db.query(
        `INSERT INTO activity_logs (id, claim_id, patient_id, activity_type, description, performed_by, organization_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [crypto.randomUUID(), claimId, patientId, 'created', 'Claim draft created via wizard', (req.user as any)?.id || null, orgId]
      );

      // ── Snapshot + risk evaluation at claim creation ─────────────────────────
      try {
        const { evaluateClaim, scoreViolations } = await import("./services/rules-engine");

        const [{ rows: approvedRules }, { rows: ncciRows }] = await Promise.all([
          db.query(`
            SELECT mei.id, mei.section_type, mei.extracted_json, mei.reviewed_by, mei.reviewed_at,
                   pm.payer_id AS manual_payer_id, pm.document_name AS payer_name
            FROM manual_extraction_items mei
            JOIN payer_source_documents pm ON pm.id = mei.source_document_id
            WHERE mei.review_status = 'approved'
              AND ($1::uuid IS NULL OR pm.payer_id = $1)
            ORDER BY mei.reviewed_at DESC
          `, [p.payer_id || null]).catch(() => ({ rows: [] })),
          db.query(`SELECT MAX(ncci_version) AS latest FROM cci_edits`).catch(() => ({ rows: [{ latest: null }] })),
        ]);

        const ncciVersion: string | null = ncciRows[0]?.latest || null;
        const snapshot = {
          snapshot_taken_at: now.toISOString(),
          applied_rules: approvedRules.map((r: any) => ({
            rule_id: r.id,
            rule_type: r.section_type,
            section_type: r.section_type,
            value: r.extracted_json,
            approved_at: r.reviewed_at,
            approved_by: r.reviewed_by,
          })),
          ncci_version: ncciVersion,
          rules_engine_version: "1.0.0",
        };

        // Build evaluation context from the newly created claim + patient
        const evalCtx = {
          claimId,
          organizationId: getOrgId(req),
          patientId,
          payerId: p.payer_id || null,
          payerName: p.insurance_carrier || "",
          planProduct: p.plan_product || null,
          serviceDate: null,
          serviceLines: [],
          icd10Primary: "",
          icd10Secondary: [] as string[],
          authorizationNumber: p.authorization_number || null,
          placeOfService: "11",
          memberId: p.member_id || null,
          patientDob: p.dob ? new Date(p.dob) : null,
          patientFirstName: p.first_name || null,
          patientLastName: p.last_name || null,
          testMode: false,
          pcpReferralCheckStatus: null as any,
        };

        const violations = await evaluateClaim(evalCtx);
        const { riskScore, readinessStatus } = scoreViolations(violations);
        const finalScore = Math.min(riskScore, 100);
        const finalStatus: "GREEN" | "YELLOW" | "RED" =
          finalScore >= 71 ? "RED" : finalScore >= 31 ? "YELLOW" : "GREEN";

        await db.query(
          `UPDATE claims
           SET rules_snapshot = $1::jsonb,
               rules_engine_version = $2,
               ncci_version_at_creation = $3,
               last_risk_evaluation_at = NOW(),
               last_risk_factors = $4::jsonb,
               risk_score = $5,
               readiness_status = $6
           WHERE id = $7`,
          [JSON.stringify(snapshot), "1.0.0", ncciVersion,
           JSON.stringify(violations), finalScore, finalStatus, claimId]
        );
      } catch (snapErr: any) {
        console.warn('[ClaimDraft] Snapshot/risk evaluation failed for', claimId, snapErr?.message);
      }

      res.status(201).json({ claimId, encounterId });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  // ── Preflight rules check (real-time wizard validation) ─────────────────────
  // MUST be registered before /:id routes to avoid route collision
  app.post("/api/billing/claims/preflight", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const { evaluateClaim } = await import("./services/rules-engine");
      const b = req.body || {};

      const ctx = {
        claimId: b.claimId || undefined,
        organizationId: (req.user as any)?.organization_id || b.organizationId || "",
        patientId: b.patientId || "",
        payerId: b.payerId || null,
        payerName: b.payerName || "",
        planProduct: b.planProduct || null,
        serviceDate: b.serviceDate ? new Date(b.serviceDate) : null,
        serviceLines: (b.serviceLines || []).map((sl: any) => ({
          code: (sl.hcpcs_code || sl.code || "").trim(),
          modifier: sl.modifier || "",
          units: parseFloat(sl.units) || 0,
          totalCharge: parseFloat(sl.totalCharge || sl.total_charge) || 0,
        })),
        icd10Primary: b.icd10Primary || "",
        icd10Secondary: Array.isArray(b.icd10Secondary) ? b.icd10Secondary : [],
        authorizationNumber: b.authorizationNumber || null,
        placeOfService: b.placeOfService || "11",
        memberId: b.memberId || null,
        patientDob: b.patientDob ? new Date(b.patientDob) : null,
        patientFirstName: b.patientFirstName || null,
        patientLastName: b.patientLastName || null,
        testMode: b.testMode === true,
        pcpReferralCheckStatus: b.pcpReferralCheckStatus || null,
      };

      const factors = await evaluateClaim(ctx);

      // Persist if claimId is provided
      if (b.claimId) {
        const db = await import("./db").then(m => m.pool);
        await db.query(
          `UPDATE claims SET last_risk_evaluation_at = NOW(), last_risk_factors = $1 WHERE id = $2`,
          [JSON.stringify(factors), b.claimId]
        ).catch(() => {});
      }

      res.json({ factors });
    } catch (err: any) {
      console.error('[API] Preflight error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/billing/claims/:id", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const existing = await db.query("SELECT id, status, organization_id FROM claims WHERE id = $1", [req.params.id]);
      if (existing.rows.length === 0) return res.status(404).json({ error: "Claim not found" });
      if (!verifyOrg(existing.rows[0], req)) return res.status(404).json({ error: "Claim not found" });

      const allowedFields: Record<string, string> = {
        payer: "payer", payerId: "payer_id", cptCodes: "cpt_codes", serviceLines: "service_lines",
        amount: "amount", status: "status", riskScore: "risk_score", readinessStatus: "readiness_status",
        providerId: "provider_id", serviceDate: "service_date", placeOfService: "place_of_service",
        icd10Primary: "icd10_primary", icd10Secondary: "icd10_secondary", authorizationNumber: "authorization_number",
        chargeOverridden: "charge_overridden", reason: "reason", nextStep: "next_step",
        claimFrequencyCode: "claim_frequency_code", origClaimNumber: "orig_claim_number",
        homeboundIndicator: "homebound_indicator", orderingProviderId: "ordering_provider_id",
        externalOrderingProviderName: "external_ordering_provider_name",
        externalOrderingProviderNpi: "external_ordering_provider_npi",
        orderingProviderFirstName: "ordering_provider_first_name",
        orderingProviderLastName: "ordering_provider_last_name",
        orderingProviderNpi: "ordering_provider_npi",
        orderingProviderOrg: "ordering_provider_org",
        delayReasonCode: "delay_reason_code", followUpDate: "follow_up_date", followUpStatus: "follow_up_status",
        planProduct: "plan_product",
        statementPeriodStart: "statement_period_start",
        statementPeriodEnd: "statement_period_end",
      };
      const fields: string[] = [];
      const values: any[] = [];
      let idx = 1;
      for (const [key, col] of Object.entries(allowedFields)) {
        if (req.body[key] !== undefined) {
          const val = req.body[key];
          if (col === "cpt_codes" || col === "service_lines" || col === "icd10_secondary") {
            fields.push(`${col} = $${idx}::jsonb`);
            values.push(JSON.stringify(val));
          } else {
            fields.push(`${col} = $${idx}`);
            values.push(val);
          }
          idx++;
        }
      }
      if (fields.length === 0) return res.status(400).json({ error: "No fields to update" });
      fields.push(`updated_at = NOW()`);
      values.push(req.params.id);
      const { rows } = await db.query(
        `UPDATE claims SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
        values
      );

      if (req.body.encounterId) {
        const encFields: string[] = [];
        const encVals: any[] = [];
        let eIdx = 1;
        if (req.body.providerId !== undefined) { encFields.push(`provider_id = $${eIdx}`); encVals.push(req.body.providerId); eIdx++; }
        if (req.body.serviceDate !== undefined) { encFields.push(`service_date = $${eIdx}`); encVals.push(req.body.serviceDate); eIdx++; }
        if (req.body.placeOfService !== undefined) { encFields.push(`place_of_service = $${eIdx}`); encVals.push(req.body.placeOfService); eIdx++; }
        if (req.body.authorizationNumber !== undefined) { encFields.push(`authorization_number = $${eIdx}`); encVals.push(req.body.authorizationNumber); eIdx++; }
        if (encFields.length > 0) {
          encVals.push(req.body.encounterId);
          await db.query(`UPDATE encounters SET ${encFields.join(", ")} WHERE id = $${eIdx}`, encVals);
        }
      }

      if (req.body.status && rows[0]) {
        const oldStatus = existing.rows[0]?.status;
        if (oldStatus !== req.body.status) {
          await db.query(
            "INSERT INTO claim_events (id, claim_id, type, timestamp, notes) VALUES ($1, $2, $3, $4, $5)",
            [crypto.randomUUID(), req.params.id, "StatusChange", new Date(), `Status changed to ${req.body.status}`]
          );
          await db.query(
            `INSERT INTO activity_logs (id, claim_id, patient_id, activity_type, field, old_value, new_value, description, performed_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [crypto.randomUUID(), req.params.id, rows[0].patient_id, 'status_change', 'status', oldStatus, req.body.status, `Claim status changed from ${oldStatus} to ${req.body.status}`, (req.user as any)?.id || null]
          );
        }
      }

      if (Object.keys(req.body).some(k => k !== 'status' && k !== 'encounterId' && allowedFields[k])) {
        await db.query(
          `INSERT INTO activity_logs (id, claim_id, patient_id, activity_type, description, performed_by) VALUES ($1, $2, $3, $4, $5, $6)`,
          [crypto.randomUUID(), req.params.id, rows[0]?.patient_id, 'updated', 'Claim data updated', (req.user as any)?.id || null]
        );
      }

      // Auto-create prior_auth record when authorization_number is set on the claim
      if (req.body.authorizationNumber && rows[0]?.patient_id) {
        const authNum = req.body.authorizationNumber;
        const existingAuth = await db.query(
          `SELECT id FROM prior_authorizations WHERE patient_id = $1 AND auth_number = $2 LIMIT 1`,
          [rows[0].patient_id, authNum]
        ).catch(() => ({ rows: [] }));
        if (!existingAuth.rows.length) {
          await db.query(
            `INSERT INTO prior_authorizations (id, patient_id, organization_id, auth_number, status, mode, source, created_at, updated_at)
             VALUES ($1, $2, $3, $4, 'approved', 'received', 'claim_wizard', NOW(), NOW())
             ON CONFLICT DO NOTHING`,
            [crypto.randomUUID(), rows[0].patient_id, rows[0].organization_id, authNum]
          ).catch(() => {});
        }
      }

      res.json(rows[0]);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.post("/api/billing/claims/:id/risk", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const { evaluateClaim, scoreViolations } = await import("./services/rules-engine");

      const claimResult = await db.query("SELECT * FROM claims WHERE id = $1", [req.params.id]);
      if (claimResult.rows.length === 0) return res.status(404).json({ error: "Claim not found" });
      const claim = claimResult.rows[0];
      if (!verifyOrg(claim, req)) return res.status(404).json({ error: "Claim not found" });

      const patientResult = await db.query(
        `SELECT p.*, l.name as lead_name FROM patients p LEFT JOIN leads l ON p.lead_id = l.id WHERE p.id = $1`,
        [claim.patient_id]
      );
      const patient = patientResult.rows[0];

      const rawServiceLines: any[] = claim.service_lines || [];
      const serviceLines = rawServiceLines.map((sl: any) => ({
        code: (sl.hcpcs_code || sl.code || "").trim(),
        modifier: sl.modifier || "",
        units: parseFloat(sl.units) || 0,
        totalCharge: parseFloat(sl.totalCharge || sl.total_charge) || 0,
      }));

      const ctx = {
        claimId: claim.id,
        organizationId: claim.organization_id,
        patientId: claim.patient_id,
        payerId: claim.payer_id || null,
        payerName: claim.payer || "",
        planProduct: (claim.plan_product || patient?.plan_product || null) as any,
        serviceDate: claim.service_date ? new Date(claim.service_date) : null,
        serviceLines,
        icd10Primary: claim.icd10_primary || "",
        icd10Secondary: Array.isArray(claim.icd10_secondary) ? claim.icd10_secondary : [],
        authorizationNumber: claim.authorization_number || null,
        placeOfService: claim.place_of_service || "11",
        memberId: patient?.member_id || null,
        patientDob: patient?.dob ? new Date(patient.dob) : null,
        patientFirstName: patient?.first_name || null,
        patientLastName: patient?.last_name || null,
        testMode: false,
        pcpReferralCheckStatus: (claim.pcp_referral_check_status || null) as any,
      };

      const violations = await evaluateClaim(ctx);
      const { riskScore, readinessStatus } = scoreViolations(violations);

      // Legacy compat: also add VOB + charge_overridden as info factors
      const legacyFactors: any[] = [];
      if (!patient?.vob_verified) {
        legacyFactors.push({
          ruleType: "data_quality", severity: "info",
          message: "Benefits (VOB) not yet verified for this patient.",
          fixSuggestion: "Run insurance verification before submitting.",
          ruleId: null, sourcePage: null, sourceQuote: null, payerSpecific: false,
        });
      }
      if (claim.charge_overridden) {
        legacyFactors.push({
          ruleType: "data_quality", severity: "info",
          message: "Charge amount was manually overridden — ensure it matches your fee schedule.",
          fixSuggestion: "Confirm the charge is correct before submitting.",
          ruleId: null, sourcePage: null, sourceQuote: null, payerSpecific: false,
        });
      }

      const allFactors = [...violations, ...legacyFactors];
      const finalScore = Math.min(riskScore + legacyFactors.length * 5, 100);
      const finalStatus: "GREEN" | "YELLOW" | "RED" =
        finalScore >= 71 ? "RED" : finalScore >= 31 ? "YELLOW" : "GREEN";

      // Derive backward-compat cciFactors for existing wizard UI
      const cciFactors = allFactors
        .filter((v) => v.ruleType === "cci_edit")
        .map((v) => ({
          type: "cci_edit",
          severity: v.severity === "block" ? "high" : "medium",
          message: v.message,
          fix_suggestion: v.fixSuggestion,
          modifier_indicator: v.message.includes("hard block") ? "0" : "1",
          primary_code: v.message.match(/([A-Z0-9]{4,7}) and/i)?.[1] || "",
          secondary_code: v.message.match(/and ([A-Z0-9]{4,7})/i)?.[1] || "",
        }));

      await db.query(
        `UPDATE claims SET
           risk_score = $1,
           readiness_status = $2,
           last_risk_evaluation_at = NOW(),
           last_risk_factors = $3,
           updated_at = NOW()
         WHERE id = $4`,
        [finalScore, finalStatus, JSON.stringify(allFactors), req.params.id]
      );

      res.json({ riskScore: finalScore, readinessStatus: finalStatus, factors: allFactors, cciFactors });
    } catch (err: any) {
      console.error('[API] Risk engine error:', err);
      res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/claims/:id/pdf-data", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const claimResult = await db.query("SELECT * FROM claims WHERE id = $1", [req.params.id]);
      if (claimResult.rows.length === 0) return res.status(404).json({ error: "Claim not found" });
      const claim = claimResult.rows[0];
      if (!verifyOrg(claim, req)) return res.status(404).json({ error: "Claim not found" });

      const patientResult = await db.query(
        `SELECT p.*, l.name as lead_name FROM patients p LEFT JOIN leads l ON p.lead_id = l.id WHERE p.id = $1`,
        [claim.patient_id]
      );
      const patient = patientResult.rows[0] || null;

      let provider = null;
      if (claim.provider_id) {
        const provResult = await db.query("SELECT * FROM providers WHERE id = $1", [claim.provider_id]);
        provider = provResult.rows[0] || null;
      }

      let orderingProvider = null;
      if (claim.ordering_provider_id && claim.ordering_provider_id !== claim.provider_id) {
        const opResult = await db.query("SELECT first_name, last_name, npi FROM providers WHERE id = $1", [claim.ordering_provider_id]);
        orderingProvider = opResult.rows[0] || null;
      } else if (claim.ordering_provider_npi || claim.ordering_provider_first_name) {
        orderingProvider = {
          first_name: claim.ordering_provider_first_name || "",
          last_name: claim.ordering_provider_last_name || "",
          npi: claim.ordering_provider_npi || "",
          org: claim.ordering_provider_org || "",
        };
      } else if (claim.external_ordering_provider_name) {
        const nameParts = claim.external_ordering_provider_name.split(" ");
        orderingProvider = {
          first_name: nameParts.slice(0, -1).join(" ") || nameParts[0],
          last_name: nameParts.slice(-1)[0] || "",
          npi: claim.external_ordering_provider_npi || "",
        };
      }

      const orgId = getOrgId(req);
      const practiceResult = orgId
        ? await db.query("SELECT * FROM practice_settings WHERE organization_id = $1 LIMIT 1", [orgId])
        : await db.query("SELECT * FROM practice_settings LIMIT 1");
      const practice = practiceResult.rows[0] || null;

      let payerName = claim.payer || "";
      if (claim.payer_id) {
        const payerResult = await db.query("SELECT name FROM payers WHERE id = $1", [claim.payer_id]);
        if (payerResult.rows[0]) payerName = payerResult.rows[0].name;
      }

      res.json({ claim, patient, provider, orderingProvider, practice, payerName });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.patch("/api/billing/claims/:id/pdf-generated", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const ownerCheck = await db.query("SELECT organization_id FROM claims WHERE id = $1", [req.params.id]);
      if (!ownerCheck.rows.length || !verifyOrg(ownerCheck.rows[0], req)) return res.status(404).json({ error: "Claim not found" });
      const timestamp = new Date().toISOString();
      await db.query(
        `UPDATE claims SET pdf_url = $1, status = CASE WHEN status IN ('draft', 'created') THEN 'exported' ELSE status END, updated_at = NOW() WHERE id = $2`,
        [`generated:${timestamp}`, req.params.id]
      );
      await db.query(
        `INSERT INTO claim_events (id, claim_id, type, notes, timestamp) VALUES ($1, $2, $3, $4, NOW())`,
        [crypto.randomUUID(), req.params.id, "PDF Generated", `Claim summary PDF generated at ${timestamp}`]
      );
      const claimRow = await db.query("SELECT patient_id FROM claims WHERE id = $1", [req.params.id]);
      await db.query(
        `INSERT INTO activity_logs (id, claim_id, patient_id, activity_type, description, performed_by) VALUES ($1, $2, $3, $4, $5, $6)`,
        [crypto.randomUUID(), req.params.id, claimRow.rows[0]?.patient_id || null, 'export_pdf', 'Claim PDF generated', (req.user as any)?.id || null]
      );
      res.json({ success: true, pdfUrl: `generated:${timestamp}` });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  // ── Claim soft-delete (archive) ────────────────────────────────────────────
  app.patch("/api/billing/claims/:id/archive", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const { id } = req.params;
      const user = req.user as any;

      const { rows } = await db.query("SELECT * FROM claims WHERE id = $1", [id]);
      if (!rows.length || !verifyOrg(rows[0], req)) return res.status(404).json({ error: "Claim not found" });
      const claim = rows[0];
      if (claim.archived_at) return res.status(400).json({ error: "Claim is already archived" });

      const archivedBy = user?.email || user?.name || "system";
      await db.query(
        `UPDATE claims SET archived_at = NOW(), archived_by = $1, updated_at = NOW() WHERE id = $2`,
        [archivedBy, id]
      );

      // Log to activity_logs
      await db.query(
        `INSERT INTO activity_logs (id, claim_id, patient_id, activity_type, description, performed_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          crypto.randomUUID(), id, claim.patient_id,
          claim.status === 'draft' ? 'claim_discarded' : 'claim_archived',
          claim.status === 'draft'
            ? `Draft claim discarded by ${archivedBy}`
            : `Claim archived by ${archivedBy} (retained per HIPAA/state requirements)`,
          user?.id || null
        ]
      );

      res.json({ success: true });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/claims/:id/edi-validate", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const claimResult = await db.query("SELECT * FROM claims WHERE id = $1", [req.params.id]);
      if (!claimResult.rows.length) return res.status(404).json({ error: "Claim not found" });
      const c = claimResult.rows[0];
      if (!verifyOrg(c, req)) return res.status(404).json({ error: "Claim not found" });

      const patientResult = await db.query("SELECT * FROM patients WHERE id = $1", [c.patient_id]);
      const pat = patientResult.rows[0] || {};

      const ediOrgId = getOrgId(req);
      const settingsResult = ediOrgId
        ? await db.query("SELECT * FROM practice_settings WHERE organization_id = $1 LIMIT 1", [ediOrgId])
        : await db.query("SELECT * FROM practice_settings LIMIT 1");
      const ps = settingsResult.rows[0];

      // Payer lookup — fetched early so payer_classification drives all downstream logic
      let payerInfo: { name: string; payer_id: string; payer_classification: string | null; claim_filing_indicator: string | null } =
        { name: c.payer || "Unknown", payer_id: "UNKNOWN", payer_classification: null, claim_filing_indicator: null };
      if (c.payer_id) {
        const pr = await db.query("SELECT name, payer_id, payer_classification, claim_filing_indicator FROM payers WHERE id = $1", [c.payer_id]);
        if (pr.rows.length) payerInfo = pr.rows[0];
      } else if (c.payer) {
        const pr = await db.query("SELECT name, payer_id, payer_classification, claim_filing_indicator FROM payers WHERE LOWER(name) = LOWER($1)", [c.payer]);
        if (pr.rows.length) payerInfo = pr.rows[0];
      }

      const warnings: { field: string; message: string; severity: "error" | "warning" }[] = [];

      // Practice settings checks
      if (!ps) {
        warnings.push({ field: "practice", message: "Practice settings not configured", severity: "error" });
      } else {
        if (!ps.primary_npi || ps.primary_npi.replace(/\D/g, "").length !== 10)
          warnings.push({ field: "practice.npi", message: "Practice NPI must be exactly 10 digits", severity: "error" });
        if (!ps.tax_id || ps.tax_id.replace(/\D/g, "").length !== 9)
          warnings.push({ field: "practice.tax_id", message: "Practice Tax ID (EIN) must be 9 digits", severity: "error" });
        const addr = typeof ps.address === "object" && ps.address ? ps.address : {};
        if (!(addr as any).street)
          warnings.push({ field: "practice.address", message: "Practice street address is missing", severity: "warning" });
        if (!(addr as any).city)
          warnings.push({ field: "practice.city", message: "Practice city is missing", severity: "warning" });
        if (!(addr as any).state)
          warnings.push({ field: "practice.state", message: "Practice state is missing", severity: "warning" });
        if (!(addr as any).zip)
          warnings.push({ field: "practice.zip", message: "Practice ZIP code is missing", severity: "warning" });
      }

      // Patient checks
      if (!pat.first_name || !pat.last_name)
        warnings.push({ field: "patient.name", message: "Patient name is incomplete", severity: "error" });
      if (!pat.dob)
        warnings.push({ field: "patient.dob", message: "Patient date of birth is missing", severity: "error" });
      if (!pat.member_id)
        warnings.push({ field: "patient.member_id", message: "Patient insurance member ID is missing — will appear blank in EDI", severity: "warning" });
      if (!pat.sex)
        warnings.push({ field: "patient.sex", message: "Patient sex is unknown — will default to 'U' in EDI", severity: "warning" });

      // VOB (insurance eligibility) check — Section 8: filter by payer to avoid false positives
      if (c.patient_id) {
        const serviceDate = c.service_date ? new Date(c.service_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
        const vobPayerName = (c.payer || "").toLowerCase();
        const vobResult = await db.query(
          `SELECT id FROM vob_verifications
           WHERE patient_id = $1
             AND status = 'active'
             AND (
               payer_id = $2
               OR LOWER(COALESCE(payer_name,'')) LIKE $3
               OR ($2 = '' AND payer_id IS NULL)
             )
             AND (term_date IS NULL OR term_date >= $4::date)
           ORDER BY created_at DESC LIMIT 1`,
          [c.patient_id, c.payer_id || '', `%${vobPayerName}%`, serviceDate]
        );
        if (vobResult.rows.length === 0) {
          warnings.push({ field: "patient.vob", message: "No active VOB on file for this patient and payer. Add a manual VOB entry on the patient Eligibility tab.", severity: "warning" });
        }
      }

      // Future service date check
      if (c.service_date) {
        const svcDate = new Date(c.service_date);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        if (svcDate > today) {
          warnings.push({ field: "claim.service_date", message: "Service date is in the future — verify date before submitting", severity: "error" });
        }
      }

      // Ordering provider check (warn if VA claim has no ordering provider)
      const hasOrderingProv = c.ordering_provider_id || c.external_ordering_provider_npi || c.ordering_provider_npi;
      if (!hasOrderingProv && payerInfo.payer_classification === 'va_community_care') {
        warnings.push({ field: "claim.ordering_provider", message: "VA Community Care claims require an ordering/referring provider. Add one before submitting.", severity: "warning" });
      }

      // Claim checks
      const rawLines = Array.isArray(c.service_lines) ? c.service_lines : [];
      if (rawLines.length === 0)
        warnings.push({ field: "claim.service_lines", message: "No service lines — claim cannot be billed", severity: "error" });
      else {
        const totalCharge = rawLines.reduce((sum: number, sl: any) =>
          sum + (Number(sl.charge) || Number(sl.amount) || Number(sl.total_charge) || 0), 0);
        if (totalCharge === 0)
          warnings.push({ field: "claim.charges", message: "All service line charges are $0.00", severity: "error" });
        rawLines.forEach((sl: any, i: number) => {
          const code = sl.hcpcsCode || sl.hcpcs_code || sl.code || "";
          if (!code)
            warnings.push({ field: `service_line[${i}].hcpcs_code`, message: `Service line ${i + 1} is missing a HCPCS/CPT code`, severity: "error" });
        });
      }
      if (!c.icd10_primary)
        warnings.push({ field: "claim.icd10", message: "No primary ICD-10 diagnosis code", severity: "error" });
      // 837P allows max 12 ICD-10 codes total (1 primary + 11 secondary)
      const secondaryIcds = Array.isArray(c.icd10_secondary) ? c.icd10_secondary : (c.icd10_secondary ? (() => { try { return JSON.parse(c.icd10_secondary); } catch { return []; } })() : []);
      if (secondaryIcds.length > 11)
        warnings.push({ field: "claim.icd10_secondary", message: `837P supports max 12 ICD-10 codes (1 primary + 11 secondary). You have ${secondaryIcds.length} secondary codes — excess codes will be dropped.`, severity: "warning" });
      if (!c.place_of_service)
        warnings.push({ field: "claim.pos", message: "Place of service code is missing", severity: "warning" });

      // Payer checks (payerInfo fetched above)
      if (!payerInfo.payer_id || payerInfo.payer_id === "UNKNOWN")
        warnings.push({ field: "payer.payer_id", message: `Payer "${payerInfo.name}" has no EDI Payer ID configured`, severity: "error" });

      // Rendering provider checks
      let provId = c.provider_id;
      if (!provId) {
        const dp = await db.query("SELECT id FROM providers WHERE organization_id = $1 AND is_default = true AND is_active = true LIMIT 1", [c.organization_id]);
        if (dp.rows.length) provId = dp.rows[0].id;
      }
      if (!provId)
        warnings.push({ field: "claim.provider", message: "No rendering provider assigned to this claim", severity: "error" });
      else {
        const pr = await db.query("SELECT npi FROM providers WHERE id = $1", [provId]);
        if (!pr.rows.length || !pr.rows[0].npi || pr.rows[0].npi.replace(/\D/g, "").length !== 10)
          warnings.push({ field: "provider.npi", message: "Rendering provider NPI is missing or not 10 digits", severity: "error" });
      }

      // ── Prevention Rules Engine ─────────────────────────────────────────────
      const ediOrgId2 = getOrgId(req);
      const { rows: activeRules } = await db.query(
        `SELECT * FROM rules WHERE enabled = true AND (organization_id = $1 OR organization_id IS NULL OR payer = 'All')
         ORDER BY prevention_action DESC`,
        [ediOrgId2 || ""]
      );

      const isVA = payerInfo.payer_classification === 'va_community_care';
      const isMedicare = payerInfo.payer_classification === 'medicare_part_b' || payerInfo.payer_classification === 'medicare_advantage';

      for (const rule of activeRules) {
        const ruleForPayer = rule.payer === "All" || (isVA && rule.payer === "VA Community Care") || (isMedicare && rule.payer === "Medicare");
        if (!ruleForPayer) continue;

        const severity: "error" | "warning" = rule.prevention_action === "block" ? "error" : "warning";
        const tp = rule.trigger_pattern;

        if (tp === "member_id_format" && (!pat.member_id || pat.member_id.trim() === "")) {
          warnings.push({ field: "patient.member_id", message: `[Rule] ${rule.name}: ${rule.description}`, severity });
        } else if (tp === "rendering_npi") {
          if (!provId) warnings.push({ field: "provider.npi", message: `[Rule] ${rule.name}`, severity });
        } else if (tp === "place_of_service" && isVA && c.place_of_service && c.place_of_service !== "12") {
          warnings.push({ field: "claim.place_of_service", message: `[Rule] ${rule.name}: ${rule.description}`, severity });
        } else if (tp === "home_health_pos_mismatch") {
          const hhCodes = ["G0299","G0300","G0151","G0152","G0153","G0156","T1019"];
          const rawLinesCodes = (Array.isArray(c.service_lines) ? c.service_lines : []).map((sl: any) => sl.hcpcsCode || sl.hcpcs_code || sl.code || "");
          if (rawLinesCodes.some((code: string) => hhCodes.includes(code)) && c.place_of_service !== "12") {
            warnings.push({ field: "claim.place_of_service", message: `[Rule] ${rule.name}: ${rule.description}`, severity });
          }
        } else if (tp === "authorization_required" && isVA && !c.authorization_number) {
          warnings.push({ field: "claim.authorization_number", message: `[Rule] ${rule.name}: ${rule.description}`, severity });
        } else if (tp === "diagnosis_code_version") {
          const icdCodesAll = [c.icd10_primary, ...(Array.isArray(c.icd10_secondary) ? c.icd10_secondary : [])].filter(Boolean);
          const hasIcd9 = icdCodesAll.some((code: string) => /^\d{3}(\.\d+)?$/.test(code) && !code.startsWith("Z") && !code.startsWith("M"));
          if (hasIcd9) warnings.push({ field: "claim.icd10", message: `[Rule] ${rule.name}: ${rule.description}`, severity });
        } else if (tp === "timely_filing" && c.service_date) {
          const daysSince = Math.floor((Date.now() - new Date(c.service_date).getTime()) / 86400000);
          const limit = isVA ? 180 : isMedicare ? 365 : 365;
          if (daysSince >= limit - 30 && daysSince < limit) {
            warnings.push({ field: "claim.service_date", message: `[Rule] ${rule.name}: ${daysSince} days since service (limit ${limit})`, severity: "warning" });
          }
        } else if (tp === "timely_filing_exceeded" && c.service_date) {
          const daysSince = Math.floor((Date.now() - new Date(c.service_date).getTime()) / 86400000);
          const limit = isVA ? 180 : isMedicare ? 365 : 365;
          if (daysSince >= limit) {
            warnings.push({ field: "claim.service_date", message: `[Rule] ${rule.name}: ${daysSince} days since service exceeds ${limit}-day limit`, severity });
          }
        } else if (tp === "medicare_timely_filing" && isMedicare && c.service_date) {
          const daysSince = Math.floor((Date.now() - new Date(c.service_date).getTime()) / 86400000);
          if (daysSince >= 335) warnings.push({ field: "claim.service_date", message: `[Rule] ${rule.name}: ${daysSince} days since service (365-day limit)`, severity: "warning" });
        } else if (tp === "medicare_timely_exceeded" && isMedicare && c.service_date) {
          const daysSince = Math.floor((Date.now() - new Date(c.service_date).getTime()) / 86400000);
          if (daysSince >= 365) warnings.push({ field: "claim.service_date", message: `[Rule] ${rule.name}: ${daysSince} days — claim cannot be paid`, severity });
        } else if (tp === "diagnosis_pointer") {
          const rawLinesDP = Array.isArray(c.service_lines) ? c.service_lines : [];
          const missingPointer = rawLinesDP.some((sl: any) => !sl.diagnosisPointers && !sl.diagnosisPointer && !sl.diagnosis_pointer);
          if (missingPointer) warnings.push({ field: "claim.service_lines", message: `[Rule] ${rule.name}: ${rule.description}`, severity });
        } else if (tp === "provider_taxonomy") {
          if (provId) {
            const txRow = await db.query("SELECT taxonomy_code FROM providers WHERE id = $1", [provId]);
            if (!txRow.rows[0]?.taxonomy_code) warnings.push({ field: "provider.taxonomy_code", message: `[Rule] ${rule.name}: ${rule.description}`, severity });
          }
        } else if (tp === "missing_required_fields") {
          if (!c.icd10_primary || (Array.isArray(c.service_lines) ? c.service_lines : []).length === 0) {
            warnings.push({ field: "claim", message: `[Rule] ${rule.name}: ${rule.description}`, severity });
          }
        } else if (tp === "duplicate_claim" || tp.includes("payer=current.payer")) {
          if (c.patient_id && c.service_date) {
            const slCodes = (Array.isArray(c.service_lines) ? c.service_lines : []).map((sl: any) => sl.hcpcsCode || sl.hcpcs_code || sl.code || "").filter(Boolean);
            if (slCodes.length > 0) {
              const { rows: dupRows } = await db.query(
                `SELECT id FROM claims
                 WHERE patient_id = $1
                   AND service_date = $2
                   AND status NOT IN ('rejected','voided')
                   AND id != $3
                   AND service_lines::text ILIKE ANY(ARRAY[${slCodes.map((_: any, i: number) => `$${i + 4}`).join(",")}])
                 LIMIT 1`,
                [c.patient_id, c.service_date, c.id, ...slCodes.map((code: string) => `%${code}%`)]
              );
              if (dupRows.length > 0) {
                warnings.push({ field: "claim.duplicate", message: `[Rule] ${rule.name}: A claim for this patient, date, and service code may already exist (ID: ${dupRows[0].id.slice(0, 8)}…)`, severity });
              }
            }
          }
        } else if (tp === "authorization_format" && isVA && c.authorization_number) {
          const authNum = String(c.authorization_number).trim();
          if (authNum.length < 10 || authNum.length > 20 || !/^[A-Z0-9]/i.test(authNum)) {
            warnings.push({ field: "claim.authorization_number", message: `[Rule] ${rule.name}: ${rule.description}`, severity });
          }
        } else if (tp === "procedure_code_validity") {
          const rawLinesPC = Array.isArray(c.service_lines) ? c.service_lines : [];
          const claimCodes = [...new Set(rawLinesPC.map((sl: any) => sl.hcpcsCode || sl.hcpcs_code || sl.code || "").filter(Boolean))];
          if (claimCodes.length > 0) {
            const { rows: validCodes } = await db.query(
              `SELECT code FROM hcpcs_codes WHERE code = ANY($1)`,
              [claimCodes]
            );
            const validSet = new Set(validCodes.map((r: any) => r.code));
            const invalid = claimCodes.filter((code: string) => !validSet.has(code));
            if (invalid.length > 0) {
              warnings.push({ field: "claim.service_lines", message: `[Rule] ${rule.name}: Unrecognized code(s): ${invalid.join(", ")}`, severity });
            }
          }
        } else if (tp === "modifier_required") {
          const rawLinesMR = Array.isArray(c.service_lines) ? c.service_lines : [];
          const missingMod = rawLinesMR.some((sl: any) => !sl.modifier);
          if (missingMod) {
            warnings.push({ field: "claim.service_lines", message: `[Rule] ${rule.name}: ${rule.description}`, severity: "warning" });
          }
        } else if (tp === "va_unit_authorization_check" && isVA) {
          const g0299Lines = (Array.isArray(c.service_lines) ? c.service_lines : [])
            .filter((sl: any) => (sl.hcpcsCode || sl.hcpcs_code || sl.code || "") === "G0299");
          if (g0299Lines.length > 0 && c.patient_id) {
            const totalUnits = g0299Lines.reduce((sum: number, sl: any) => sum + (Number(sl.units) || 1), 0);
            const { rows: paRows } = await db.query(
              `SELECT authorized_units FROM prior_authorizations WHERE patient_id = $1 AND status = 'approved' AND (expiration_date IS NULL OR expiration_date >= $2) LIMIT 1`,
              [c.patient_id, c.service_date || new Date().toISOString().slice(0, 10)]
            );
            if (paRows.length > 0 && paRows[0].authorized_units) {
              if (totalUnits > paRows[0].authorized_units) {
                warnings.push({ field: "claim.service_lines", message: `[Rule] ${rule.name}: ${totalUnits} units billed exceeds authorized ${paRows[0].authorized_units}`, severity });
              }
            }
          }
        } else if (tp === "cob_primary_eob_required") {
          const hasSecondary = c.secondary_payer_id || pat?.secondary_payer_id;
          if (hasSecondary && !c.cob_order) {
            warnings.push({ field: "claim.cob", message: `[Rule] ${rule.name}: ${rule.description}`, severity });
          }
        }
      }

      // ── Section 7: condition_type rules engine (universal rules) ─────────────
      const newRulesOrgId = getOrgId(req);
      const { rows: condRules } = await db.query(
        `SELECT * FROM rules
         WHERE is_active = true
           AND condition_type IS NOT NULL
           AND (organization_id = $1 OR organization_id IS NULL)`,
        [newRulesOrgId || ""]
      );

      for (const rule of condRules) {
        let violated = false;
        const ct = rule.condition_type;

        if (ct === 'provider_npi_invalid') {
          if (provId) {
            const npiRow = await db.query('SELECT npi FROM providers WHERE id=$1', [provId]);
            violated = !npiRow.rows[0]?.npi || npiRow.rows[0].npi.replace(/\D/g, '').length !== 10;
          } else {
            violated = true;
          }
        } else if (ct === 'diagnosis_missing') {
          violated = !c.icd10_primary;
        } else if (ct === 'total_charges_zero') {
          violated = rawLines.reduce((sum: number, sl: any) =>
            sum + (Number(sl.charge) || Number(sl.amount) || Number(sl.total_charge) || 0), 0) === 0;
        } else if (ct === 'payer_missing') {
          violated = !c.payer_id && !c.payer;
        } else if (ct === 'service_date_missing') {
          violated = !c.service_date;
        } else if (ct === 'service_date_future') {
          if (c.service_date) {
            const daysAhead = Math.floor((new Date(c.service_date).getTime() - Date.now()) / 86400000);
            violated = daysAhead > parseInt(rule.condition_value || '1');
          }
        } else if (ct === 'days_since_service_gt') {
          if (c.service_date) {
            const daysSince = Math.floor((Date.now() - new Date(c.service_date).getTime()) / 86400000);
            violated = daysSince > parseInt(rule.condition_value || '180');
          }
        } else if (ct === 'va_auth_missing') {
          const isVAPayer2 = payerInfo.payer_classification === 'va_community_care' || payerInfo.payer_id === 'TWVACCN';
          violated = isVAPayer2 && !c.authorization_number;
        } else if (ct === 'va_wrong_pos') {
          const isVAPayer3 = payerInfo.payer_classification === 'va_community_care' || payerInfo.payer_id === 'TWVACCN';
          violated = isVAPayer3 && c.place_of_service !== rule.condition_value;
        } else if (ct === 'gcode_wrong_pos') {
          const hasGCode = rawLines.some((sl: any) => {
            const code = sl.hcpcsCode || sl.hcpcs_code || '';
            return code.match(/^G0[2-3]/i);
          });
          violated = hasGCode && c.place_of_service !== rule.condition_value;
        } else if (ct === 'duplicate_claim') {
          if (c.patient_id && c.service_date && rawLines.length > 0) {
            const dupResult = await db.query(
              `SELECT id FROM claims
               WHERE patient_id=$1 AND service_date=$2 AND id != $3
               AND status NOT IN ('draft','void')
               AND (organization_id=$4 OR organization_id IS NULL)
               LIMIT 1`,
              [c.patient_id, c.service_date, req.params.id, newRulesOrgId || ""]
            );
            violated = dupResult.rows.length > 0;
          }
        }

        if (violated) {
          const alreadyReported = warnings.some(w => w.field.includes(rule.name) || w.message.includes(rule.description));
          if (!alreadyReported) {
            warnings.push({
              field: rule.name,
              message: rule.description,
              severity: rule.action === 'block' ? 'error' : 'warning',
            });
          }
        }
      }

      const errors = warnings.filter(w => w.severity === "error");
      res.json({
        ready: errors.length === 0,
        warnings,
        summary: errors.length === 0
          ? `${warnings.length} warning(s) — claim appears ready to submit`
          : `${errors.length} error(s) must be resolved before submission`,
      });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/claims/:id/edi", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const { generate837P } = await import("./services/edi-generator");
      const claimResult = await db.query("SELECT * FROM claims WHERE id = $1", [req.params.id]);
      if (!claimResult.rows.length) return res.status(404).json({ error: "Claim not found" });
      const c = claimResult.rows[0];
      if (!verifyOrg(c, req)) return res.status(404).json({ error: "Claim not found" });

      const patientResult = await db.query("SELECT * FROM patients WHERE id = $1", [c.patient_id]);
      if (!patientResult.rows.length) return res.status(404).json({ error: "Patient not found" });
      const pat = patientResult.rows[0];

      const ediOrgId = getOrgId(req);
      const settingsResult = ediOrgId
        ? await db.query("SELECT * FROM practice_settings WHERE organization_id = $1 LIMIT 1", [ediOrgId])
        : await db.query("SELECT * FROM practice_settings LIMIT 1");
      const ps = settingsResult.rows[0];
      if (!ps) return res.status(400).json({ error: "Practice settings not configured" });

      let provId = c.provider_id;
      if (!provId) {
        const defaultProv = await db.query("SELECT id FROM providers WHERE organization_id = $1 AND is_default = true AND is_active = true LIMIT 1", [c.organization_id]);
        if (defaultProv.rows.length) provId = defaultProv.rows[0].id;
      }
      let prov = { first_name: "Rendering", last_name: "Provider", npi: ps.primary_npi || "0000000000", taxonomy_code: ps.taxonomy_code || "163W00000X" };
      if (provId) {
        const provResult = await db.query("SELECT first_name, last_name, npi, taxonomy_code, entity_type FROM providers WHERE id = $1", [provId]);
        if (provResult.rows.length) prov = provResult.rows[0];
      }

      let payerInfo = { name: c.payer || "Unknown", payer_id: "UNKNOWN" };
      if (c.payer_id) {
        const payerResult = await db.query("SELECT name, payer_id, claim_filing_indicator, payer_classification FROM payers WHERE id = $1", [c.payer_id]);
        if (payerResult.rows.length) payerInfo = payerResult.rows[0];
      } else if (c.payer) {
        const payerResult = await db.query("SELECT name, payer_id, claim_filing_indicator, payer_classification FROM payers WHERE LOWER(name) = LOWER($1)", [c.payer]);
        if (payerResult.rows.length) payerInfo = payerResult.rows[0];
      }

      const rawLines = Array.isArray(c.service_lines) ? c.service_lines : [];
      const serviceLines = rawLines.map((sl: any) => ({
        hcpcs_code: sl.hcpcsCode || sl.hcpcs_code || sl.code || "",
        units: Number(sl.units) || 1,
        charge: Number(sl.charge) || Number(sl.amount) || Number(sl.total_charge) || 0,
        modifier: sl.modifier || null,
        diagnosis_pointer: diagPointerToNumeric(sl.diagnosisPointers || sl.diagnosisPointer || sl.diagnosis_pointer || "A"),
        service_date: sl.service_date_from || sl.service_date || sl.serviceDate || null,
        service_date_to: sl.service_date_to || null,
      }));

      const icd10Codes: string[] = [];
      if (c.icd10_primary) icd10Codes.push(c.icd10_primary);
      if (Array.isArray(c.icd10_secondary)) {
        for (const code of c.icd10_secondary) {
          if (code && !icd10Codes.includes(code)) icd10Codes.push(code);
        }
      }

      const addr = typeof ps.address === "object" && ps.address ? ps.address : {};
      const patAddr = typeof pat.address === "object" && pat.address ? pat.address : {};
      // Fetch ordering provider if specified (internal or external)
      let orderingProv: { first_name: string; last_name: string; npi: string } | null = null;
      if (c.ordering_provider_id) {
        const opResult = await db.query("SELECT first_name, last_name, npi FROM providers WHERE id = $1", [c.ordering_provider_id]);
        if (opResult.rows.length) orderingProv = opResult.rows[0];
      } else if (c.ordering_provider_npi || c.ordering_provider_first_name) {
        orderingProv = {
          first_name: c.ordering_provider_first_name || "",
          last_name: c.ordering_provider_last_name || "",
          npi: c.ordering_provider_npi || "",
        };
      } else if (c.external_ordering_provider_name) {
        const nameParts = c.external_ordering_provider_name.split(" ");
        orderingProv = {
          first_name: nameParts.slice(0, -1).join(" ") || nameParts[0],
          last_name: nameParts.slice(-1)[0] || "",
          npi: c.external_ordering_provider_npi || "",
        };
      }

      const edi = generate837P({
        claim: {
          id: c.id,
          patient_id: c.patient_id,
          service_date: c.service_date ? new Date(c.service_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
          place_of_service: c.place_of_service || "12",
          auth_number: c.authorization_number || null,
          payer: c.payer || payerInfo.name,
          amount: Number(c.amount) || 0,
          claim_frequency_code: c.claim_frequency_code || "1",
          orig_claim_number: c.orig_claim_number || null,
          homebound_indicator: c.homebound_indicator === true || c.homebound_indicator === "Y",
          delay_reason_code: c.delay_reason_code || null,
          statement_period_start: c.statement_period_start ? new Date(c.statement_period_start).toISOString().slice(0, 10) : null,
          statement_period_end: c.statement_period_end ? new Date(c.statement_period_end).toISOString().slice(0, 10) : null,
          service_lines: serviceLines,
          icd10_codes: icd10Codes.length ? icd10Codes : (() => { throw new Error("VALIDATION_ERROR: Claim has no ICD-10 diagnosis codes. Please add at least one diagnosis code before generating EDI."); })(),
        },
        patient: {
          first_name: pat.first_name || "",
          last_name: pat.last_name || "",
          dob: pat.dob || "1900-01-01",
          member_id: pat.member_id || pat.insurance_id || "",
          insurance_carrier: pat.insurance_carrier || c.payer || "",
          sex: pat.sex || null,
          address: (patAddr as any).street || (patAddr as any).street1 || null,
          city: (patAddr as any).city || null,
          state: (patAddr as any).state || pat.state || null,
          zip: (patAddr as any).zip || null,
        },
        practice: {
          name: ps.practice_name || "Practice",
          npi: ps.primary_npi || "0000000000",
          tax_id: ps.tax_id || "000000000",
          taxonomy_code: ps.taxonomy_code || "163W00000X",
          address: (addr as any).street || (addr as any).street1 || (addr as any).address || "",
          city: (addr as any).city || "",
          state: (addr as any).state || "",
          zip: (addr as any).zip || "",
          phone: ps.phone || "",
          pgba_trading_partner_id: ps.pgba_trading_partner_id || null,
        },
        provider: {
          first_name: prov.first_name || "",
          last_name: prov.last_name || "",
          npi: prov.npi || ps.primary_npi || "0000000000",
          taxonomy_code: prov.taxonomy_code || ps.taxonomy_code || "163W00000X",
          license_number: prov.license_number || null,
          entity_type: prov.entity_type || null,
        },
        ordering_provider: orderingProv,
        payer: payerInfo,
      });

      await db.query(
        `INSERT INTO claim_events (id, claim_id, type, notes, timestamp) VALUES ($1, $2, $3, $4, NOW())`,
        [crypto.randomUUID(), req.params.id, "EDI Exported", "837P EDI file generated"]
      );
      await db.query(
        `INSERT INTO activity_logs (id, claim_id, patient_id, activity_type, description, performed_by) VALUES ($1, $2, $3, $4, $5, $6)`,
        [crypto.randomUUID(), req.params.id, c.patient_id, "edi_export", "837P EDI file generated", (req.user as any)?.id || null]
      );

      // Set follow_up_date (30 days from today) on manual EDI download — do not auto-advance status
      await db.query(
        `UPDATE claims SET
         follow_up_date = COALESCE(follow_up_date, NOW() + INTERVAL '30 days'),
         follow_up_status = COALESCE(follow_up_status, 'pending'), updated_at = NOW()
         WHERE id = $1`,
        [req.params.id]
      );

      res.setHeader("Content-Type", "application/edi-x12");
      res.setHeader("Content-Disposition", `attachment; filename="claim_${req.params.id}_837P.edi"`);
      res.send(edi);
    } catch (err: any) {
      console.error("EDI generation error:", err);
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.post("/api/billing/test-oa-connection", requireRole("admin", "rcm_manager"), async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: "Username and password required" });
    }
    try {
      const { testOAConnection } = await import("./services/office-ally");
      const result = await testOAConnection(username, password);
      if (result.success) {
        const db = await import("./db").then(m => m.pool);
        await db.query(
          `UPDATE practice_settings SET oa_sftp_username = $1, oa_sftp_password = $2, oa_connected = true, updated_at = NOW()`,
          [username, password]
        );
      }
      res.json(result);
    } catch (err: any) {
      console.error('[Risk Score] Error:', err);
      res.json({ success: false, message: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.post("/api/billing/claims/:id/submit-oa", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const claimResult = await db.query("SELECT * FROM claims WHERE id = $1", [req.params.id]);
      if (!claimResult.rows.length) return res.status(404).json({ success: false, error: "Claim not found" });
      const c = claimResult.rows[0];
      if (!verifyOrg(c, req)) return res.status(404).json({ success: false, error: "Claim not found" });

      const patientResult = await db.query("SELECT * FROM patients WHERE id = $1", [c.patient_id]);
      const oaOrgId = getOrgId(req);
      const settingsResult = oaOrgId
        ? await db.query("SELECT * FROM practice_settings WHERE organization_id = $1 LIMIT 1", [oaOrgId])
        : await db.query("SELECT * FROM practice_settings LIMIT 1");
      const ps = settingsResult.rows[0];
      if (!ps) return res.status(400).json({ success: false, error: "Practice settings not configured" });
      if (!ps.oa_connected) return res.status(400).json({ success: false, error: "Office Ally not connected. Go to Settings → Clearinghouse to connect." });

      let provId2 = c.provider_id;
      if (!provId2) {
        const defaultProv = await db.query("SELECT id FROM providers WHERE organization_id = $1 AND is_default = true AND is_active = true LIMIT 1", [c.organization_id]);
        if (defaultProv.rows.length) provId2 = defaultProv.rows[0].id;
      }
      let prov = { first_name: "Rendering", last_name: "Provider", npi: ps.primary_npi || "0000000000", taxonomy_code: ps.taxonomy_code || "163W00000X" };
      if (provId2) {
        const provResult = await db.query("SELECT first_name, last_name, npi, taxonomy_code, entity_type FROM providers WHERE id = $1", [provId2]);
        if (provResult.rows.length) prov = provResult.rows[0];
      }

      let payerInfo = { name: c.payer || "Unknown", payer_id: "UNKNOWN" };
      if (c.payer_id) {
        const payerResult = await db.query("SELECT name, payer_id, claim_filing_indicator, payer_classification FROM payers WHERE id = $1", [c.payer_id]);
        if (payerResult.rows.length) payerInfo = payerResult.rows[0];
      } else if (c.payer) {
        const payerResult = await db.query("SELECT name, payer_id, claim_filing_indicator, payer_classification FROM payers WHERE LOWER(name) = LOWER($1)", [c.payer]);
        if (payerResult.rows.length) payerInfo = payerResult.rows[0];
      }

      const pat = patientResult.rows[0] || {};
      const rawLines = Array.isArray(c.service_lines) ? c.service_lines : [];
      const serviceLines = rawLines
        .map((sl: any) => ({
          hcpcs_code: sl.hcpcsCode || sl.hcpcs_code || sl.code || "",
          units: Number(sl.units) || 1,
          charge: Number(sl.charge) || Number(sl.amount) || Number(sl.total_charge) || 0,
          modifier: sl.modifier || null,
          diagnosis_pointer: diagPointerToNumeric(sl.diagnosisPointers || sl.diagnosisPointer || sl.diagnosis_pointer || "A"),
          service_date: sl.service_date_from || sl.service_date || sl.serviceDate || null,
          service_date_to: sl.service_date_to || null,
        }))
        .filter((sl) => sl.hcpcs_code);
      if (serviceLines.length === 0) {
        return res.status(400).json({
          success: false,
          error: "VALIDATION_ERROR: Claim has no service lines. Open the claim in the wizard, add at least one HCPCS/CPT service line, and save before submitting.",
        });
      }
      const icd10Codes: string[] = [];
      if (c.icd10_primary) icd10Codes.push(c.icd10_primary);
      if (Array.isArray(c.icd10_secondary)) {
        for (const code of c.icd10_secondary) {
          if (code && !icd10Codes.includes(code)) icd10Codes.push(code);
        }
      }
      const addr = typeof ps.address === "object" && ps.address ? ps.address : {};
      const patAddr2 = typeof pat.address === "object" && pat.address ? pat.address : {};

      const { submitClaim837P } = await import("./services/office-ally");
      const result = await submitClaim837P({
        claim: {
          id: c.id,
          patient_id: c.patient_id,
          service_date: c.service_date ? new Date(c.service_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
          place_of_service: c.place_of_service || "12",
          auth_number: c.authorization_number || null,
          payer: c.payer || payerInfo.name,
          amount: Number(c.amount) || 0,
          homebound_indicator: c.homebound_indicator === true || c.homebound_indicator === "Y",
          delay_reason_code: c.delay_reason_code || null,
          claim_frequency_code: c.claim_frequency_code || "1",
          orig_claim_number: c.orig_claim_number || null,
          service_lines: serviceLines,
          icd10_codes: icd10Codes.length ? icd10Codes : (() => { throw new Error("VALIDATION_ERROR: Claim has no ICD-10 diagnosis codes. Please add at least one diagnosis code before submitting."); })(),
        },
        patient: {
          first_name: pat.first_name || "",
          last_name: pat.last_name || "",
          dob: pat.dob || "1900-01-01",
          member_id: pat.member_id || pat.insurance_id || "",
          insurance_carrier: pat.insurance_carrier || c.payer || "",
          sex: pat.sex || null,
          address: (patAddr2 as any).street || (patAddr2 as any).street1 || null,
          city: (patAddr2 as any).city || null,
          state: (patAddr2 as any).state || pat.state || null,
          zip: (patAddr2 as any).zip || null,
        },
        practice: {
          name: ps.practice_name || "Practice",
          npi: ps.primary_npi || "0000000000",
          tax_id: ps.tax_id || "000000000",
          taxonomy_code: ps.taxonomy_code || "163W00000X",
          address: (addr as any).street || (addr as any).street1 || (addr as any).address || "",
          city: (addr as any).city || "",
          state: (addr as any).state || "",
          zip: (addr as any).zip || "",
          phone: ps.phone || "",
        },
        provider: {
          first_name: prov.first_name || "",
          last_name: prov.last_name || "",
          npi: prov.npi || ps.primary_npi || "0000000000",
          taxonomy_code: prov.taxonomy_code || ps.taxonomy_code || "163W00000X",
          license_number: prov.license_number || null,
          entity_type: prov.entity_type || null,
        },
        payer: payerInfo,
      });

      if (result.success) {
        // Look up payer's auto follow-up days to set follow_up_date
        let followUpDays = 30;
        if (c.payer_id) {
          const { rows: payerFU } = await db.query(`SELECT auto_followup_days FROM payers WHERE id = $1`, [c.payer_id]);
          if (payerFU.length > 0 && payerFU[0].auto_followup_days != null) {
            followUpDays = Number(payerFU[0].auto_followup_days);
          }
        }
        const followUpDate = followUpDays > 0
          ? new Date(Date.now() + followUpDays * 86400000).toISOString().slice(0, 10)
          : null;
        const fuSql = followUpDate
          ? `UPDATE claims SET status = 'submitted', submission_method = 'office_ally', follow_up_date = $2, updated_at = NOW() WHERE id = $1`
          : `UPDATE claims SET status = 'submitted', submission_method = 'office_ally', updated_at = NOW() WHERE id = $1`;
        const fuParams = followUpDate ? [c.id, followUpDate] : [c.id];
        await db.query(fuSql, fuParams);
        await db.query(
          `INSERT INTO claim_events (id, claim_id, type, notes, timestamp) VALUES ($1, $2, $3, $4, NOW())`,
          [crypto.randomUUID(), c.id, "Submitted via Office Ally", `837P submitted: ${result.filename}`]
        );
        if (followUpDate) {
          await db.query(
            `INSERT INTO claim_events (id, claim_id, type, notes, timestamp) VALUES ($1, $2, $3, $4, NOW())`,
            [crypto.randomUUID(), c.id, "Follow-Up Scheduled", `Auto follow-up scheduled for ${followUpDate} (${followUpDays} days from submission)`]
          );
        }
        await db.query(
          `INSERT INTO activity_logs (id, claim_id, patient_id, activity_type, description, performed_by) VALUES ($1, $2, $3, $4, $5, $6)`,
          [crypto.randomUUID(), c.id, c.patient_id, "edi_submitted", `837P submitted via Office Ally: ${result.filename}`, (req.user as any)?.id || null]
        );
      }

      res.json(result);
    } catch (err: any) {
      console.error("OA submit error:", err);
      console.error('[API] Error:', err); res.status(500).json({ success: false, error: 'An unexpected error occurred. Please try again.' });
    }
  });

  // ── Stedi claim submission ─────────────────────────────────────────────────
  app.post("/api/billing/claims/:id/submit-stedi", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const { isStediConfigured, submitClaim: stediSubmitClaim } = await import("./services/stedi-claims");
      if (!isStediConfigured()) {
        return res.status(400).json({ success: false, error: "Stedi API key not configured. Add STEDI_API_KEY to environment variables." });
      }

      const db = await import("./db").then(m => m.pool);
      const claimResult = await db.query("SELECT * FROM claims WHERE id = $1", [req.params.id]);
      if (!claimResult.rows.length) return res.status(404).json({ success: false, error: "Claim not found" });
      const c = claimResult.rows[0];
      if (!verifyOrg(c, req)) return res.status(404).json({ success: false, error: "Claim not found" });

      const patientResult = await db.query("SELECT * FROM patients WHERE id = $1", [c.patient_id]);
      const stOrgId = getOrgId(req);
      const settingsResult = stOrgId
        ? await db.query("SELECT * FROM practice_settings WHERE organization_id = $1 LIMIT 1", [stOrgId])
        : await db.query("SELECT * FROM practice_settings LIMIT 1");
      const ps = settingsResult.rows[0];
      if (!ps) return res.status(400).json({ success: false, error: "Practice settings not configured" });

      let provId = c.provider_id;
      if (!provId) {
        const defaultProv = await db.query("SELECT id FROM providers WHERE organization_id = $1 AND is_default = true AND is_active = true LIMIT 1", [c.organization_id]);
        if (defaultProv.rows.length) provId = defaultProv.rows[0].id;
      }
      let prov: any = { first_name: "Rendering", last_name: "Provider", npi: ps.primary_npi || "0000000000", taxonomy_code: ps.taxonomy_code || "163W00000X" };
      if (provId) {
        const provResult = await db.query("SELECT first_name, last_name, npi, taxonomy_code, license_number, entity_type FROM providers WHERE id = $1", [provId]);
        if (provResult.rows.length) prov = provResult.rows[0];
      }

      let payerInfo = { name: c.payer || "Unknown", payer_id: "UNKNOWN" };
      if (c.payer_id) {
        const payerResult = await db.query("SELECT name, payer_id, claim_filing_indicator, payer_classification FROM payers WHERE id = $1", [c.payer_id]);
        if (payerResult.rows.length) payerInfo = payerResult.rows[0];
      } else if (c.payer) {
        const payerResult = await db.query("SELECT name, payer_id, claim_filing_indicator, payer_classification FROM payers WHERE LOWER(name) = LOWER($1)", [c.payer]);
        if (payerResult.rows.length) payerInfo = payerResult.rows[0];
      }

      const pat = patientResult.rows[0] || {};

      // ── Automated-agent gate (Task 5) ─────────────────────────────────────
      const automated = isAutomatedContext({
        hasUserSession: !!(req.user),
        userAgent: req.headers["user-agent"],
        xAutomatedAgent: req.headers["x-automated-agent"] as string | undefined,
      });
      if (automated && process.env.STEDI_AUTOMATED_TEST_MODE !== "true") {
        return res.status(403).json({
          success: false,
          error: "Automated submission blocked. Human session required for production claim submission.",
        });
      }

      // ── Test-mode override (Task 3d) ──────────────────────────────────────
      // testMode=true from wizard checkbox, or FRCPB payer always forces test.
      const isFrcpbPayer = (payerInfo as any).payer_id === "FRCPB";
      const testModeOverride: boolean = !!(req.body?.testMode) || isFrcpbPayer;
      const isa15 = resolveISA15(testModeOverride);
      console.log(
        `[Stedi] submit-stedi pending: claimId=${c.id} ISA15=${isa15}` +
        (testModeOverride ? " (forced test)" : "") +
        ` isFrcpb=${isFrcpbPayer} reqBodyTestMode=${!!req.body?.testMode}`
      );

      const rawLines = Array.isArray(c.service_lines) ? c.service_lines : [];
      console.log(`[submit-stedi] claimId=${c.id} rawLines.length=${rawLines.length} sample=${JSON.stringify(rawLines[0] ?? null)}`);
      const serviceLines = rawLines
        .map((sl: any) => ({
          hcpcs_code: sl.hcpcsCode || sl.hcpcs_code || sl.code || "",
          units: Number(sl.units) || 1,
          charge: Number(sl.charge) || Number(sl.amount) || Number(sl.total_charge) || 0,
          modifier: sl.modifier || null,
          diagnosis_pointer: diagPointerToNumeric(sl.diagnosisPointers || sl.diagnosisPointer || sl.diagnosis_pointer || "A"),
          service_date: sl.service_date_from || sl.service_date || sl.serviceDate || null,
          service_date_to: sl.service_date_to || null,
        }))
        .filter((sl) => sl.hcpcs_code);
      if (serviceLines.length === 0) {
        return res.status(400).json({
          success: false,
          error: "VALIDATION_ERROR: Claim has no service lines. Open the claim in the wizard, add at least one HCPCS/CPT service line, and save before submitting.",
        });
      }
      const icd10Codes: string[] = [];
      if (c.icd10_primary) icd10Codes.push(c.icd10_primary);
      if (Array.isArray(c.icd10_secondary)) {
        for (const code of c.icd10_secondary) {
          if (code && !icd10Codes.includes(code)) icd10Codes.push(code);
        }
      }
      if (!icd10Codes.length) {
        return res.status(400).json({ success: false, error: "VALIDATION_ERROR: Claim has no ICD-10 diagnosis codes." });
      }

      // ── Synthetic test-data gate (Task 2 + 3b) ───────────────────────────
      // When ISA15=P (real payer), block claims with synthetic/demo data.
      // When ISA15=T (test mode), allow through — synthetic data is expected.
      {
        const pdAddr = typeof pat.address === "object" && pat.address ? pat.address as any : {};
        const tda = looksLikeTestData({
          patient: {
            firstName: pat.first_name || "",
            lastName: pat.last_name || "",
            memberId: pat.member_id || pat.insurance_id || "",
            dob: pat.dob || "",
            address: pdAddr.street || pdAddr.street1 || "",
          },
          claim: { authNumber: c.authorization_number || null },
          practice: { address: ps.address },
        });
        if (isa15 === "P" && tda.result === "blocked") {
          console.warn(
            `[SubmissionGuard] Blocked ISA15=P submission — synthetic data detected. ` +
            `Claim=${c.id} Score=${tda.score} Signals=${JSON.stringify(tda.signals)}`
          );
          return res.status(422).json({
            success: false,
            error: "Submission blocked: this claim contains synthetic test data that cannot be submitted to a real payer.",
            testDataSignals: tda.signals,
          });
        }
        if (isa15 === "P" && tda.result === "suspicious") {
          console.warn(
            `[SubmissionGuard] Suspicious data in ISA15=P submission. ` +
            `Claim=${c.id} Score=${tda.score} Signals=${JSON.stringify(tda.signals)}`
          );
        }
        // Log attempt to submission_attempts table (Task 3e audit trail)
        await db.query(
          `INSERT INTO submission_attempts (id, claim_id, organization_id, isa15, test_mode_override, automated, test_data_result, test_data_score, attempted_by, attempted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
          [
            crypto.randomUUID(),
            c.id,
            c.organization_id,
            isa15,
            testModeOverride,
            automated,
            tda.result,
            tda.score,
            (req.user as any)?.id || null,
          ]
        ).catch((e: any) => console.warn("[SubmissionAudit] Could not log attempt:", e.message));
      }

      const addr = typeof ps.address === "object" && ps.address ? ps.address : {};
      const patAddr = typeof pat.address === "object" && pat.address ? pat.address : {};

      const { generate837P } = await import("./services/edi-generator");
      const ediString = generate837P({
        isa15,
        claim: {
          id: c.id,
          patient_id: c.patient_id,
          service_date: c.service_date ? new Date(c.service_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
          place_of_service: c.place_of_service || "12",
          auth_number: c.authorization_number || null,
          payer: c.payer || payerInfo.name,
          amount: Number(c.amount) || 0,
          homebound_indicator: c.homebound_indicator === true || c.homebound_indicator === "Y",
          delay_reason_code: c.delay_reason_code || null,
          claim_frequency_code: c.claim_frequency_code || "1",
          orig_claim_number: c.orig_claim_number || null,
          statement_period_start: c.statement_period_start ? new Date(c.statement_period_start).toISOString().slice(0, 10) : null,
          statement_period_end: c.statement_period_end ? new Date(c.statement_period_end).toISOString().slice(0, 10) : null,
          service_lines: serviceLines,
          icd10_codes: icd10Codes,
        },
        patient: {
          first_name: pat.first_name || "",
          last_name: pat.last_name || "",
          dob: pat.dob || "1900-01-01",
          member_id: pat.member_id || pat.insurance_id || "",
          insurance_carrier: pat.insurance_carrier || c.payer || "",
          sex: pat.sex || null,
          address: (patAddr as any).street || (patAddr as any).street1 || null,
          city: (patAddr as any).city || null,
          state: (patAddr as any).state || pat.state || null,
          zip: (patAddr as any).zip || null,
        },
        practice: {
          name: ps.practice_name || "Practice",
          npi: ps.primary_npi || "0000000000",
          tax_id: ps.tax_id || "000000000",
          taxonomy_code: ps.taxonomy_code || "163W00000X",
          address: (addr as any).street || (addr as any).street1 || (addr as any).address || "",
          city: (addr as any).city || "",
          state: (addr as any).state || "",
          zip: (addr as any).zip || "",
          phone: ps.phone || "",
          pgba_trading_partner_id: ps.pgba_trading_partner_id || null,
        },
        provider: {
          first_name: prov.first_name || "",
          last_name: prov.last_name || "",
          npi: prov.npi || ps.primary_npi || "0000000000",
          taxonomy_code: prov.taxonomy_code || ps.taxonomy_code || "163W00000X",
          license_number: prov.license_number || null,
          entity_type: prov.entity_type || null,
        },
        payer: payerInfo,
      });

      const result = await stediSubmitClaim({ ediContent: ediString, claimId: c.id, hasUserSession: true, userAgent: req.headers["user-agent"] });

      if (result.success) {
        let followUpDays = 30;
        if (c.payer_id) {
          const { rows: payerFU } = await db.query(`SELECT auto_followup_days FROM payers WHERE id = $1`, [c.payer_id]);
          if (payerFU.length > 0 && payerFU[0].auto_followup_days != null) {
            followUpDays = Number(payerFU[0].auto_followup_days);
          }
        }
        const followUpDate = followUpDays > 0
          ? new Date(Date.now() + followUpDays * 86400000).toISOString().slice(0, 10)
          : null;

        await db.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS stedi_transaction_id VARCHAR`).catch(() => {});

        const fuSql = followUpDate
          ? `UPDATE claims SET status = 'submitted', submission_method = 'stedi', stedi_transaction_id = $3, follow_up_date = $2, updated_at = NOW() WHERE id = $1`
          : `UPDATE claims SET status = 'submitted', submission_method = 'stedi', stedi_transaction_id = $2, updated_at = NOW() WHERE id = $1`;
        const fuParams = followUpDate
          ? [c.id, followUpDate, result.transactionId || null]
          : [c.id, result.transactionId || null];
        await db.query(fuSql, fuParams);

        await db.query(
          `INSERT INTO claim_events (id, claim_id, type, notes, timestamp, organization_id) VALUES ($1, $2, $3, $4, NOW(), $5)`,
          [crypto.randomUUID(), c.id, "Submitted via Stedi", `837P submitted to Stedi. Transaction ID: ${result.transactionId || "N/A"}. Status: ${result.status || "Accepted"}`, c.organization_id]
        );
        if (followUpDate) {
          await db.query(
            `INSERT INTO claim_events (id, claim_id, type, notes, timestamp, organization_id) VALUES ($1, $2, $3, $4, NOW(), $5)`,
            [crypto.randomUUID(), c.id, "Follow-Up Scheduled", `Auto follow-up scheduled for ${followUpDate} (${followUpDays} days from submission)`, c.organization_id]
          );
        }
        await db.query(
          `INSERT INTO activity_logs (id, claim_id, patient_id, activity_type, description, performed_by) VALUES ($1, $2, $3, $4, $5, $6)`,
          [crypto.randomUUID(), c.id, c.patient_id, "edi_submitted", `837P submitted via Stedi. Transaction: ${result.transactionId || "N/A"}`, (req.user as any)?.id || null]
        );
      } else {
        const errMsg = result.error || "Stedi rejected the claim";
        const validationList = (result.validationErrors || []).join(", ");
        await db.query(
          `INSERT INTO claim_events (id, claim_id, type, notes, timestamp) VALUES ($1, $2, $3, $4, NOW())`,
          [crypto.randomUUID(), c.id, "Submission Failed", `Stedi rejected: ${errMsg}${validationList ? ". Validation: " + validationList : ""}`]
        );
      }

      res.json({
        success: result.success,
        blockedBy: result.blockedBy,
        transactionId: result.transactionId,
        status: result.status,
        validationErrors: result.validationErrors || [],
        error: result.error,
      });
    } catch (err: any) {
      console.error("Stedi submit error:", err);
      const isAutomatedBlock = err?.name === "AutomatedSubmissionBlocked";
      res.status(isAutomatedBlock ? 403 : 500).json({
        success: false,
        blockedBy: "claimshield",
        error: isAutomatedBlock
          ? "Automated submission blocked — a human session is required to submit claims to a real payer."
          : "An unexpected error occurred during submission. The claim was not sent.",
      });
    }
  });

  // ── Stedi Test Validation (ISA15='T', no payer transmission) ───────────────
  app.post("/api/billing/claims/:id/test-stedi", requireRole("admin", "rcm_manager", "super_admin"), async (req, res) => {
    try {
      const { isStediConfigured, testClaim: stediTestClaim } = await import("./services/stedi-claims");
      if (!isStediConfigured()) {
        return res.status(400).json({ success: false, error: "Stedi API key not configured. Add STEDI_API_KEY to environment variables." });
      }

      const db = await import("./db").then(m => m.pool);

      // Ensure test columns exist
      await db.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS last_test_status VARCHAR`).catch(() => {});
      await db.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS last_test_at TIMESTAMP`).catch(() => {});
      await db.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS last_test_errors JSONB`).catch(() => {});
      await db.query(`ALTER TABLE claims ADD COLUMN IF NOT EXISTS last_test_correlation_id VARCHAR`).catch(() => {});

      const claimResult = await db.query("SELECT * FROM claims WHERE id = $1", [req.params.id]);
      if (!claimResult.rows.length) return res.status(404).json({ success: false, error: "Claim not found" });
      const c = claimResult.rows[0];
      if (!verifyOrg(c, req)) return res.status(404).json({ success: false, error: "Claim not found" });

      const patientResult = await db.query("SELECT * FROM patients WHERE id = $1", [c.patient_id]);
      const stOrgId = getOrgId(req);
      const settingsResult = stOrgId
        ? await db.query("SELECT * FROM practice_settings WHERE organization_id = $1 LIMIT 1", [stOrgId])
        : await db.query("SELECT * FROM practice_settings LIMIT 1");
      const ps = settingsResult.rows[0];
      if (!ps) return res.status(400).json({ success: false, error: "Practice settings not configured" });

      let provId = c.provider_id;
      if (!provId) {
        const defaultProv = await db.query("SELECT id FROM providers WHERE organization_id = $1 AND is_default = true AND is_active = true LIMIT 1", [c.organization_id]);
        if (defaultProv.rows.length) provId = defaultProv.rows[0].id;
      }
      let prov: any = { first_name: "Rendering", last_name: "Provider", npi: ps.primary_npi || "0000000000", taxonomy_code: ps.taxonomy_code || "163W00000X" };
      if (provId) {
        const provResult = await db.query("SELECT first_name, last_name, npi, taxonomy_code, license_number, entity_type FROM providers WHERE id = $1", [provId]);
        if (provResult.rows.length) prov = provResult.rows[0];
      }

      let payerInfo = { name: c.payer || "Unknown", payer_id: "UNKNOWN" };
      if (c.payer_id) {
        const payerResult = await db.query("SELECT name, payer_id, claim_filing_indicator, payer_classification FROM payers WHERE id = $1", [c.payer_id]);
        if (payerResult.rows.length) payerInfo = payerResult.rows[0];
      } else if (c.payer) {
        const payerResult = await db.query("SELECT name, payer_id, claim_filing_indicator, payer_classification FROM payers WHERE LOWER(name) = LOWER($1)", [c.payer]);
        if (payerResult.rows.length) payerInfo = payerResult.rows[0];
      }

      const pat = patientResult.rows[0] || {};
      const rawLines = Array.isArray(c.service_lines) ? c.service_lines : [];
      console.log(`[test-stedi] claimId=${c.id} rawLines.length=${rawLines.length} sample=${JSON.stringify(rawLines[0] ?? null)}`);
      const serviceLines = rawLines
        .map((sl: any) => ({
          hcpcs_code: sl.hcpcsCode || sl.hcpcs_code || sl.code || "",
          units: Number(sl.units) || 1,
          charge: Number(sl.charge) || Number(sl.amount) || Number(sl.total_charge) || 0,
          modifier: sl.modifier || null,
          diagnosis_pointer: diagPointerToNumeric(sl.diagnosisPointers || sl.diagnosisPointer || sl.diagnosis_pointer || "A"),
          service_date: sl.service_date_from || sl.service_date || sl.serviceDate || null,
          service_date_to: sl.service_date_to || null,
        }))
        .filter((sl) => sl.hcpcs_code);
      if (serviceLines.length === 0) {
        return res.status(400).json({
          success: false,
          error: "VALIDATION_ERROR: Claim has no service lines. Open the claim in the wizard, add at least one HCPCS/CPT service line, and save before submitting.",
        });
      }
      const icd10Codes: string[] = [];
      if (c.icd10_primary) icd10Codes.push(c.icd10_primary);
      if (Array.isArray(c.icd10_secondary)) {
        for (const code of c.icd10_secondary) {
          if (code && !icd10Codes.includes(code)) icd10Codes.push(code);
        }
      }
      if (!icd10Codes.length) {
        return res.status(400).json({ success: false, error: "VALIDATION_ERROR: Claim has no ICD-10 diagnosis codes." });
      }

      const addr = typeof ps.address === "object" && ps.address ? ps.address : {};
      const patAddr = typeof pat.address === "object" && pat.address ? pat.address : {};

      const { generate837P } = await import("./services/edi-generator");
      const ediString = generate837P({
        isa15: "T", // testClaim always forces ISA15=T; explicit for audit clarity
        claim: {
          id: c.id,
          patient_id: c.patient_id,
          service_date: c.service_date ? new Date(c.service_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
          place_of_service: c.place_of_service || "12",
          auth_number: c.authorization_number || null,
          payer: c.payer || payerInfo.name,
          amount: Number(c.amount) || 0,
          homebound_indicator: c.homebound_indicator === true || c.homebound_indicator === "Y",
          delay_reason_code: c.delay_reason_code || null,
          claim_frequency_code: c.claim_frequency_code || "1",
          orig_claim_number: c.orig_claim_number || null,
          statement_period_start: c.statement_period_start ? new Date(c.statement_period_start).toISOString().slice(0, 10) : null,
          statement_period_end: c.statement_period_end ? new Date(c.statement_period_end).toISOString().slice(0, 10) : null,
          service_lines: serviceLines,
          icd10_codes: icd10Codes,
        },
        patient: {
          first_name: pat.first_name || "",
          last_name: pat.last_name || "",
          dob: pat.dob || "1900-01-01",
          member_id: pat.member_id || pat.insurance_id || "",
          insurance_carrier: pat.insurance_carrier || c.payer || "",
          sex: pat.sex || null,
          address: (patAddr as any).street || (patAddr as any).street1 || null,
          city: (patAddr as any).city || null,
          state: (patAddr as any).state || pat.state || null,
          zip: (patAddr as any).zip || null,
        },
        practice: {
          name: ps.practice_name || "Practice",
          npi: ps.primary_npi || "0000000000",
          tax_id: ps.tax_id || "000000000",
          taxonomy_code: ps.taxonomy_code || "163W00000X",
          address: (addr as any).street || (addr as any).street1 || (addr as any).address || "",
          city: (addr as any).city || "",
          state: (addr as any).state || "",
          zip: (addr as any).zip || "",
          phone: ps.phone || "",
          pgba_trading_partner_id: ps.pgba_trading_partner_id || null,
        },
        provider: {
          first_name: prov.first_name || "",
          last_name: prov.last_name || "",
          npi: prov.npi || ps.primary_npi || "0000000000",
          taxonomy_code: prov.taxonomy_code || ps.taxonomy_code || "163W00000X",
          license_number: prov.license_number || null,
          entity_type: prov.entity_type || null,
        },
        payer: payerInfo,
      });

      const isFrcpbTestPayer = (payerInfo as any).payer_id === "FRCPB";
      console.log(
        `[TestStedi] claimId=${req.params.id} ` +
        `payer="${payerInfo.name}" payerEdiId="${(payerInfo as any).payer_id}" ISA15=T(forced) ` +
        (isFrcpbTestPayer
          ? "✓ FRCPB test payer — Stedi will validate & accept"
          : "⚠ Non-FRCPB payer — Stedi validates EDI structure only, real payer routing not triggered")
      );

      const result = await stediTestClaim({ ediContent: ediString, claimId: c.id });

      const errCount = (result.validationErrors || []).length;
      const statusLabel = result.status || (result.success ? "Accepted" : "Rejected");
      const issuesPart = errCount > 0
        ? `${errCount} validation issue(s) found`
        : !result.success
          ? (result.error || "Rejected with no specific validation details")
          : "0 issues — claim is valid";
      const eventNotes = `Stedi test validation: ${statusLabel}. ${issuesPart}.${result.transactionId ? ` Transaction ID: ${result.transactionId}` : ""}`;

      await db.query(
        `INSERT INTO claim_events (id, claim_id, type, notes, timestamp, organization_id) VALUES ($1, $2, $3, $4, NOW(), $5)`,
        [crypto.randomUUID(), c.id, "Test Validation", eventNotes, c.organization_id]
      );

      await db.query(
        `UPDATE claims SET last_test_status = $1, last_test_at = NOW(), last_test_errors = $2, last_test_correlation_id = $3, updated_at = NOW() WHERE id = $4`,
        [
          result.success ? "Accepted" : "Rejected",
          JSON.stringify(result.validationErrors || []),
          result.transactionId || null,
          c.id,
        ]
      );

      const summary = result.success
        ? `Claim passed Stedi EDI validation. It is ready to submit to ${payerInfo.name}.`
        : errCount > 0
          ? `Claim failed Stedi EDI validation. ${errCount} issue(s) must be fixed before submission.`
          : result.error
            ? `Claim was rejected by Stedi: ${result.error}`
            : `Claim was rejected by Stedi. Check the raw response for details.`;

      res.json({
        success: result.success,
        status: result.success ? "Accepted" : "Rejected",
        transactionId: result.transactionId,
        validationErrors: result.validationErrors || [],
        summary,
        payerName: payerInfo.name,
        payerEdiId: (payerInfo as any).payer_id,
        isFrcpbTestPayer,
        error: result.error,
      });
    } catch (err: any) {
      console.error("Stedi test error:", err);
      console.error('[API] Error:', err); res.status(500).json({ success: false, error: 'An unexpected error occurred. Please try again.' });
    }
  });

  // ── 277CA Manual Check ─────────────────────────────────────────────────────
  app.post("/api/billing/claims/:id/check-277", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const { isStediConfigured, poll277Acknowledgments } = await import("./services/stedi-claims");
      if (!isStediConfigured()) return res.status(400).json({ error: "Stedi not configured" });

      const db = await import("./db").then(m => m.pool);
      const claimResult = await db.query("SELECT stedi_transaction_id, status, organization_id FROM claims WHERE id = $1", [req.params.id]);
      if (!claimResult.rows.length) return res.status(404).json({ error: "Claim not found" });

      const { acknowledgments } = await poll277Acknowledgments(
        new Date(Date.now() - 30 * 86400000).toISOString() // Look back 30 days
      );

      const txnId = claimResult.rows[0].stedi_transaction_id;
      const orgId = claimResult.rows[0].organization_id;
      const match = acknowledgments.find(
        (a) => a.transactionId === txnId || a.claimControlNumber === req.params.id
      );

      if (match) {
        const newStatus = match.status === "4" ? "rejected" : "acknowledged";
        if (claimResult.rows[0].status === "submitted") {
          await db.query("UPDATE claims SET status = $1, updated_at = NOW() WHERE id = $2", [newStatus, req.params.id]);
          await db.query(
            `INSERT INTO claim_events (id, claim_id, type, notes, timestamp, organization_id) VALUES ($1, $2, $3, $4, NOW(), $5)`,
            [crypto.randomUUID(), req.params.id, "277CA Received", `Payer acknowledgment: ${match.statusDescription}. Payer: ${match.payer}`, orgId]
          );
        }
        res.json({ found: true, status: newStatus, acknowledgment: match });
      } else {
        res.json({ found: false, status: claimResult.rows[0].status, message: "No 277CA acknowledgment found yet. Check back in 30 minutes." });
      }
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/hcpcs", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const { rows } = await import("./db").then(m => m.pool.query("SELECT * FROM hcpcs_codes WHERE is_active = true ORDER BY code"));
      res.json(rows);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/hcpcs/search", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const q = (req.query.q as string || "").trim();
      const payerParam = (req.query.payer as string || "").trim();
      if (!q) return res.json([]);
      const db = await import("./db").then(m => m.pool);
      const codePattern = `${q}%`;

      // Search codes — va_rate is populated in a post-query step using the
      // unified rate lookup so the dropdown always shows the contracted rate
      // (hcpcs_rates) when available, not the Medicare locality average.
      const { rows } = await db.query(
        `SELECT code, description_official, description_plain, unit_type,
                unit_interval_minutes, default_pos, requires_modifier, notes,
                source
         FROM (
           SELECT h.code, h.description_official, h.description_plain, h.unit_type,
                  h.unit_interval_minutes, h.default_pos, h.requires_modifier, h.notes,
                  'hcpcs' as source
           FROM hcpcs_codes h
           WHERE h.is_active = true
             AND (h.code ILIKE $1
               OR to_tsvector('english', h.description_official) @@ plainto_tsquery('english', $2)
               OR to_tsvector('english', COALESCE(h.description_plain, '')) @@ plainto_tsquery('english', $2))

           UNION ALL

           SELECT c.code, c.description as description_official,
                  NULL as description_plain, c.unit_type,
                  NULL as unit_interval_minutes, NULL as default_pos,
                  false as requires_modifier, NULL as notes,
                  'cpt' as source
           FROM cpt_codes c
           WHERE c.is_active = true
             AND (c.code ILIKE $1
               OR to_tsvector('english', c.description) @@ plainto_tsquery('english', $2))
             AND NOT EXISTS (SELECT 1 FROM hcpcs_codes WHERE code = c.code)
         ) combined
         ORDER BY
           CASE WHEN code ILIKE $3 THEN 0 ELSE 1 END,
           source,
           code
         LIMIT 20`,
        [codePattern, q, q]
      );

      // B: Enrich va_rate using the unified rate lookup (contracted > locality > average).
      // This ensures the wizard dropdown shows the same rate source as the auto-populate
      // field — eliminating the "$40.89 vs $11.50" discrepancy between surfaces.
      if (rows.length > 0) {
        const { lookupHcpcsRateBatch } = await import("./lib/rate-lookup");
        const codes = rows.map((r: any) => r.code);
        const effectivePayer = payerParam || "VA Community Care";
        const rateMap = await lookupHcpcsRateBatch(codes, effectivePayer, null);
        for (const row of rows) {
          const rateEntry = rateMap.get(row.code);
          (row as any).va_rate = rateEntry ? rateEntry.rate_per_unit : null;
          (row as any).va_rate_source = rateEntry ? rateEntry.source : null;
        }
      }

      res.json(rows);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/hcpcs/:code", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const { rows: codeRows } = await db.query(
        "SELECT * FROM hcpcs_codes WHERE code = $1 AND is_active = true",
        [req.params.code.toUpperCase()]
      );
      if (codeRows.length === 0) return res.status(404).json({ error: "Code not found" });
      const { rows: rates } = await db.query(
        "SELECT * FROM hcpcs_rates WHERE hcpcs_code = $1 ORDER BY payer_name",
        [req.params.code.toUpperCase()]
      );
      res.json({ ...codeRows[0], rates });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/hcpcs/:code/rates", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const { rows } = await import("./db").then(m => m.pool.query(
        "SELECT * FROM hcpcs_rates WHERE hcpcs_code = $1 ORDER BY payer_name",
        [req.params.code]
      ));
      res.json(rows);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/icd10/search", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      if (!q || q.length < 2) return res.json([]);
      const db = await import("./db").then(m => m.pool);
      const { rows } = await db.query(
        `SELECT code, description, is_header
         FROM icd10_codes
         WHERE is_active = true
           AND is_header = false
           AND (code ILIKE $1
             OR to_tsvector('english', description) @@ plainto_tsquery('english', $2))
         ORDER BY
           CASE WHEN code ILIKE $1 THEN 0 ELSE 1 END,
           LENGTH(code),
           code
         LIMIT 15`,
        [`${q}%`, q]
      );
      res.json(rows);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.post("/api/billing/payers", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const { name, payerId, timelyFilingDays, authRequired, billingType } = req.body;
      const db = await import("./db").then(m => m.pool);
      const { rows } = await db.query(
        `INSERT INTO payers (id, name, payer_id, timely_filing_days, auth_required, billing_type, is_active, is_custom)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, true, true) RETURNING *`,
        [name, payerId || null, timelyFilingDays || 365, authRequired || false, billingType || 'professional']
      );
      res.json(rows[0]);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.patch("/api/billing/payers/:id", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const { id } = req.params;
      const { isActive, name, payerId, timelyFilingDays, authRequired, autoFollowupDays, eraAutoPostClean, eraAutoPostContractual, eraAutoPostSecondary, eraAutoPostRefunds, eraHoldIfMismatch, payerClassification, claimFilingIndicator } = req.body;
      const db = await import("./db").then(m => m.pool);
      const fields: string[] = [];
      const values: any[] = [];
      let idx = 1;
      if (isActive !== undefined) { fields.push(`is_active = $${idx++}`); values.push(isActive); }
      if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
      if (payerId !== undefined) { fields.push(`payer_id = $${idx++}`); values.push(payerId); }
      if (timelyFilingDays !== undefined) { fields.push(`timely_filing_days = $${idx++}`); values.push(timelyFilingDays); }
      if (authRequired !== undefined) { fields.push(`auth_required = $${idx++}`); values.push(authRequired); }
      if (autoFollowupDays !== undefined) { fields.push(`auto_followup_days = $${idx++}`); values.push(autoFollowupDays); }
      if (eraAutoPostClean !== undefined) { fields.push(`era_auto_post_clean = $${idx++}`); values.push(eraAutoPostClean); }
      if (eraAutoPostContractual !== undefined) { fields.push(`era_auto_post_contractual = $${idx++}`); values.push(eraAutoPostContractual); }
      if (eraAutoPostSecondary !== undefined) { fields.push(`era_auto_post_secondary = $${idx++}`); values.push(eraAutoPostSecondary); }
      if (eraAutoPostRefunds !== undefined) { fields.push(`era_auto_post_refunds = $${idx++}`); values.push(eraAutoPostRefunds); }
      if (eraHoldIfMismatch !== undefined) { fields.push(`era_hold_if_mismatch = $${idx++}`); values.push(eraHoldIfMismatch); }
      if (payerClassification !== undefined) { fields.push(`payer_classification = $${idx++}`); values.push(payerClassification); }
      if (claimFilingIndicator !== undefined) { fields.push(`claim_filing_indicator = $${idx++}`); values.push(claimFilingIndicator); }
      if (fields.length === 0) return res.status(400).json({ error: "No fields to update" });
      values.push(id);
      const { rows } = await db.query(
        `UPDATE payers SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
        values
      );
      if (rows.length === 0) return res.status(404).json({ error: "Payer not found" });
      res.json(rows[0]);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  // ── Stedi payer network cache (1-hour TTL, module-level) ───────────────────
  let _stediPayerCache: { payers: any[]; ts: number } | null = null;
  async function fetchStediPayerNetwork(): Promise<any[]> {
    const now = Date.now();
    if (_stediPayerCache && now - _stediPayerCache.ts < 60 * 60 * 1000) return _stediPayerCache.payers;
    const apiKey = process.env.STEDI_API_KEY;
    if (!apiKey) return [];
    const res = await fetch("https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/payers", {
      headers: { Authorization: `Key ${apiKey}` },
    });
    if (!res.ok) throw new Error(`Stedi payer network API ${res.status}`);
    const body = await res.json();
    // Normalize: handle both { payers: [...] } and [...]
    const raw: any[] = Array.isArray(body) ? body : (body.payers || body.data || []);
    const payers = raw.map((p: any) => ({
      payerId: p.payerId || p.payer_id || "",
      payerName: p.payerName || p.payer_name || "",
      supportedTransactions: Array.isArray(p.supportedTransactions)
        ? p.supportedTransactions.map((t: any) => (typeof t === "string" ? t : t.transactionSetName || t.name || ""))
        : [],
      enrollmentRequired: p.enrollmentRequired || {},
    }));
    _stediPayerCache = { payers, ts: now };
    return payers;
  }

  // Helper: timely filing days from payer name
  function timelyFilingDaysForPayer(name: string): number {
    const n = name.toLowerCase();
    if (n.includes("medicare")) return 365;
    if (n.includes("medicaid")) return 180;
    if (n.includes("triwest") || n.includes("tri-west") || (n.includes("va ") || n === "va" || n.includes("veteran"))) return 180;
    if (n.includes("tricare") || n.includes("tri-care")) return 180;
    return 90; // commercial default
  }

  // POST /api/billing/payers/sync-stedi
  app.post("/api/billing/payers/sync-stedi", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const apiKey = process.env.STEDI_API_KEY;
      if (!apiKey) return res.status(400).json({ error: "STEDI_API_KEY is not configured" });
      const stediPayers = await fetchStediPayerNetwork();
      if (stediPayers.length === 0) return res.status(502).json({ error: "Stedi returned an empty payer list — check API key and connectivity" });

      // Build lookup map by Stedi payer ID
      const byId = new Map<string, any>(stediPayers.map((p) => [p.payerId.toUpperCase(), p]));

      const db = await import("./db").then(m => m.pool);
      const { rows: ourPayers } = await db.query(
        "SELECT id, name, payer_id, stedi_payer_id, timely_filing_days FROM payers ORDER BY name"
      );

      const matched: any[] = [];
      const already_correct: any[] = [];
      const unmatched: any[] = [];

      for (const payer of ourPayers) {
        let stediMatch: any = null;
        let matchStrategy = "";

        // Strategy C (highest priority): admin has manually pinned a stedi_payer_id
        // Skip A and B entirely — trust the explicit override
        if (payer.stedi_payer_id) {
          stediMatch = byId.get(payer.stedi_payer_id.toUpperCase()) || null;
          if (stediMatch) matchStrategy = "manual_override";
        }

        // Strategy A: exact payer_id match
        if (!stediMatch && payer.payer_id) {
          stediMatch = byId.get(payer.payer_id.toUpperCase()) || null;
          if (stediMatch) matchStrategy = "payer_id";
        }

        // Strategy B: fuzzy name match (case-insensitive partial)
        if (!stediMatch) {
          const lc = payer.name.toLowerCase();
          stediMatch = stediPayers.find((s) => {
            const sn = s.payerName.toLowerCase();
            return sn.includes(lc) || lc.includes(sn) ||
              sn.split(" ").filter((w: string) => w.length > 4).every((w: string) => lc.includes(w));
          }) || null;
          if (stediMatch) matchStrategy = "name";
        }

        if (!stediMatch) {
          unmatched.push({ id: payer.id, name: payer.name, current_payer_id: payer.payer_id });
          continue;
        }

        const newId = stediMatch.payerId;
        const supportedTx: string[] = stediMatch.supportedTransactions;

        if (payer.payer_id === newId && payer.stedi_payer_id === newId) {
          already_correct.push({ id: payer.id, name: payer.name, payer_id: newId, match_strategy: matchStrategy });
          await db.query(
            "UPDATE payers SET supported_transactions = $1, updated_at = NOW() WHERE id = $2",
            [JSON.stringify(supportedTx), payer.id]
          );
          continue;
        }

        const oldId = payer.payer_id;
        await db.query(
          "UPDATE payers SET payer_id = $1, stedi_payer_id = $2, supported_transactions = $3, updated_at = NOW() WHERE id = $4",
          [newId, newId, JSON.stringify(supportedTx), payer.id]
        );
        matched.push({ id: payer.id, name: payer.name, old_payer_id: oldId, new_payer_id: newId, match_strategy: matchStrategy });
      }

      // ── Timely filing defaults pass ────────────────────────────────────────
      // Apply conservative industry-standard defaults to any payer where
      // timely_filing_days is NULL or still at the system default of 365
      // (unless it's Medicare, which genuinely uses 365).
      const { rows: allPayers } = await db.query(
        "SELECT id, name, timely_filing_days FROM payers WHERE timely_filing_days IS NULL OR timely_filing_days = 365"
      );
      const timelyUpdates: Array<{ name: string; days: number }> = [];
      for (const p of allPayers) {
        const days = timelyFilingDaysForPayer(p.name);
        // Only update if the computed default differs from current value (avoids no-op writes)
        if (days !== p.timely_filing_days) {
          await db.query(
            "UPDATE payers SET timely_filing_days = $1, updated_at = NOW() WHERE id = $2",
            [days, p.id]
          );
          timelyUpdates.push({ name: p.name, days });
        }
      }

      res.json({
        matched,
        already_correct,
        unmatched,
        total_stedi_payers: stediPayers.length,
        timely_filing_updated: timelyUpdates.length,
        timely_filing_updates: timelyUpdates,
      });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  // GET /api/billing/payers/stedi-search?q=name
  app.get("/api/billing/payers/stedi-search", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const q = (req.query.q as string || "").toLowerCase().trim();
      if (!q || q.length < 2) return res.json([]);
      const stediPayers = await fetchStediPayerNetwork();
      const matches = stediPayers
        .filter((p) => p.payerName.toLowerCase().includes(q) || p.payerId.toLowerCase().includes(q))
        .slice(0, 8);
      res.json(matches);
    } catch (err: any) {
      res.json([]); // fail silently — non-critical
    }
  });

  // ── Payer Auth Requirements (global lookup, no org scope) ──────────────────
  app.get("/api/billing/payer-auth-requirements", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const { payerId, code } = req.query as { payerId?: string; code?: string };
      if (!payerId) return res.status(400).json({ error: "payerId is required" });
      let query = `SELECT * FROM payer_auth_requirements WHERE payer_id = $1 AND is_active = true`;
      const params: any[] = [payerId];
      if (code) { query += ` AND code = $2`; params.push(code.toUpperCase()); }
      query += ` ORDER BY code`;
      const { rows } = await db.query(query, params);
      res.json(rows);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/payer-auth-requirements/check", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const { payerId, codes } = req.query as { payerId?: string; codes?: string };
      if (!payerId) return res.status(400).json({ error: "payerId is required" });
      if (!codes) return res.json({});
      const codeList = codes.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
      if (codeList.length === 0) return res.json({});

      // Fetch granular auth requirements for this payer + these codes
      const { rows: authRows } = await db.query(
        `SELECT * FROM payer_auth_requirements WHERE payer_id = $1 AND code = ANY($2) AND is_active = true`,
        [payerId, codeList]
      );
      const authMap: Record<string, any> = {};
      for (const r of authRows) authMap[r.code] = r;

      // Fallback: payer-level auth_required flag
      const { rows: payerRows } = await db.query(`SELECT auth_required, name FROM payers WHERE id = $1`, [payerId]);
      const payerAuthRequired = payerRows[0]?.auth_required ?? false;
      const payerName = payerRows[0]?.name || "payer";

      const result: Record<string, any> = {};
      for (const code of codeList) {
        if (authMap[code]) {
          const r = authMap[code];
          result[code] = {
            code,
            authRequired: r.auth_required,
            conditions: r.auth_conditions || null,
            hint: r.auth_number_format_hint || null,
            validityDays: r.auth_validity_days || null,
            turnaroundDays: r.typical_turnaround_days ?? null,
            submissionMethod: r.submission_method || null,
            portalUrl: r.portal_url || null,
            notes: r.notes || null,
          };
        } else if (payerAuthRequired) {
          result[code] = {
            code,
            authRequired: true,
            conditions: `Auth required per ${payerName} default policy`,
            hint: null,
            validityDays: null,
            turnaroundDays: null,
            submissionMethod: null,
            portalUrl: null,
            notes: null,
          };
        } else {
          result[code] = { code, authRequired: false };
        }
      }
      res.json(result);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.post("/api/billing/payer-auth-requirements", requireRole("admin"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const {
        payerId, payerName, code, codeType, authRequired, authConditions,
        authValidityDays, authNumberFormatHint, typicalTurnaroundDays,
        submissionMethod, portalUrl, notes,
      } = req.body;
      if (!payerId || !payerName || !code) return res.status(400).json({ error: "payerId, payerName, code are required" });
      const { rows } = await db.query(
        `INSERT INTO payer_auth_requirements
           (payer_id, payer_name, code, code_type, auth_required, auth_conditions,
            auth_validity_days, auth_number_format_hint, typical_turnaround_days,
            submission_method, portal_url, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (payer_id, code) DO UPDATE SET
           payer_name = EXCLUDED.payer_name,
           auth_required = EXCLUDED.auth_required,
           auth_conditions = EXCLUDED.auth_conditions,
           auth_validity_days = EXCLUDED.auth_validity_days,
           auth_number_format_hint = EXCLUDED.auth_number_format_hint,
           typical_turnaround_days = EXCLUDED.typical_turnaround_days,
           submission_method = EXCLUDED.submission_method,
           portal_url = EXCLUDED.portal_url,
           notes = EXCLUDED.notes,
           updated_at = NOW()
         RETURNING *`,
        [payerId, payerName, code.toUpperCase(), codeType || 'HCPCS',
         authRequired ?? true, authConditions || null, authValidityDays || null,
         authNumberFormatHint || null, typicalTurnaroundDays ?? null,
         submissionMethod || null, portalUrl || null, notes || null]
      );
      res.json(rows[0]);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.patch("/api/billing/payer-auth-requirements/:id", requireRole("admin"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const fields: string[] = [];
      const values: any[] = [];
      let idx = 1;
      const allowed = ['auth_required','auth_conditions','auth_validity_days','auth_number_format_hint','typical_turnaround_days','submission_method','portal_url','notes','is_active'];
      const keyMap: Record<string, string> = {
        authRequired: 'auth_required', authConditions: 'auth_conditions',
        authValidityDays: 'auth_validity_days', authNumberFormatHint: 'auth_number_format_hint',
        typicalTurnaroundDays: 'typical_turnaround_days', submissionMethod: 'submission_method',
        portalUrl: 'portal_url', isActive: 'is_active',
      };
      for (const [k, v] of Object.entries(req.body)) {
        const col = keyMap[k] || k;
        if (allowed.includes(col)) { fields.push(`${col} = $${idx++}`); values.push(v); }
      }
      if (fields.length === 0) return res.status(400).json({ error: "No fields to update" });
      fields.push(`updated_at = NOW()`);
      values.push(req.params.id);
      const { rows } = await db.query(
        `UPDATE payer_auth_requirements SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
        values
      );
      if (!rows.length) return res.status(404).json({ error: "Not found" });
      res.json(rows[0]);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.delete("/api/billing/payer-auth-requirements/:id", requireRole("admin"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      await db.query(`DELETE FROM payer_auth_requirements WHERE id = $1`, [req.params.id]);
      res.json({ ok: true });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/rates", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const { rows } = await import("./db").then(m => m.pool.query(
        `SELECT r.*, h.description_official, h.description_plain, h.unit_type
         FROM hcpcs_rates r LEFT JOIN hcpcs_codes h ON r.hcpcs_code = h.code
         ORDER BY r.payer_name, r.hcpcs_code`
      ));
      res.json(rows);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/va-rates", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = getOrgId(req);
      let localityCode: string | null = null;
      if (orgId) {
        const psResult = await db.query("SELECT billing_location FROM practice_settings WHERE organization_id = $1 LIMIT 1", [orgId]);
        const billingLocation = psResult.rows[0]?.billing_location || null;
        if (billingLocation) {
          const locResult = await db.query(
            "SELECT locality_code FROM va_location_rates WHERE LOWER(location_name) = LOWER($1) LIMIT 1",
            [billingLocation]
          );
          localityCode = locResult.rows[0]?.locality_code || null;
        }
      }
      let rows: any[];
      if (localityCode) {
        ({ rows } = await db.query(
          `SELECT v.*, h.description_plain, h.description_official
           FROM va_location_rates v LEFT JOIN hcpcs_codes h ON v.hcpcs_code = h.code
           WHERE v.locality_code = $1 ORDER BY v.hcpcs_code`,
          [localityCode]
        ));
      } else {
        ({ rows } = await db.query(
          `SELECT DISTINCT ON (v.hcpcs_code) v.*, h.description_plain, h.description_official
           FROM va_location_rates v LEFT JOIN hcpcs_codes h ON v.hcpcs_code = h.code
           ORDER BY v.hcpcs_code, v.locality_code`
        ));
      }
      res.json({ rows, localityCode });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.post("/api/billing/rates", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const { hcpcsCode, payerId, payerName, ratePerUnit, unitIntervalMinutes, effectiveDate, endDate } = req.body;
      const db = await import("./db").then(m => m.pool);
      const { rows } = await db.query(
        `INSERT INTO hcpcs_rates (id, hcpcs_code, payer_id, payer_name, rate_per_unit, unit_interval_minutes, effective_date, end_date)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [hcpcsCode, payerId || null, payerName, ratePerUnit, unitIntervalMinutes || null, effectiveDate, endDate || null]
      );
      res.json(rows[0]);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.patch("/api/billing/rates/:id", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const { id } = req.params;
      const { ratePerUnit, unitIntervalMinutes, effectiveDate, endDate } = req.body;
      const db = await import("./db").then(m => m.pool);
      const fields: string[] = [];
      const values: any[] = [];
      let idx = 1;
      if (ratePerUnit !== undefined) { fields.push(`rate_per_unit = $${idx++}`); values.push(ratePerUnit); }
      if (unitIntervalMinutes !== undefined) { fields.push(`unit_interval_minutes = $${idx++}`); values.push(unitIntervalMinutes); }
      if (effectiveDate !== undefined) { fields.push(`effective_date = $${idx++}`); values.push(effectiveDate); }
      if (endDate !== undefined) { fields.push(`end_date = $${idx++}`); values.push(endDate); }
      if (fields.length === 0) return res.status(400).json({ error: "No fields to update" });
      values.push(id);
      const { rows } = await db.query(
        `UPDATE hcpcs_rates SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
        values
      );
      if (rows.length === 0) return res.status(404).json({ error: "Rate not found" });
      res.json(rows[0]);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.delete("/api/billing/rates/:id", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const { rowCount } = await db.query("DELETE FROM hcpcs_rates WHERE id = $1", [req.params.id]);
      if (rowCount === 0) return res.status(404).json({ error: "Rate not found" });
      res.json({ success: true });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  // ── Prompt C: GET /api/billing/payers/:id/plan-products ─────────────────
  app.get("/api/billing/payers/:id/plan-products", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const { rows } = await db.query(`
        SELECT pp.*
        FROM plan_products pp
        JOIN payer_supported_plan_products pspp ON pspp.plan_product_code = pp.code
        WHERE pspp.payer_id = $1 AND pp.active = TRUE
        ORDER BY pp.sort_order, pp.label
      `, [req.params.id]);
      res.json(rows);
    } catch (err: any) {
      console.error('[API] payer plan-products error:', err.message);
      res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  // ── Prompt C: GET /api/billing/payers/:id/delegated-entities ─────────────
  app.get("/api/billing/payers/:id/delegated-entities", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const { planProductCode, state } = req.query as Record<string, string>;
      const db = await import("./db").then(m => m.pool);
      const params: any[] = [req.params.id];
      let filters = "";
      if (planProductCode) {
        params.push(planProductCode);
        filters += ` AND (pde.plan_product_code = $${params.length} OR pde.plan_product_code IS NULL)`;
      }
      if (state) {
        params.push(state);
        filters += ` AND (pde.state = $${params.length} OR pde.state IS NULL)`;
      }
      const { rows } = await db.query(`
        SELECT de.*, pde.plan_product_code AS linked_plan_product_code, pde.state AS linked_state
        FROM delegated_entities de
        JOIN payer_delegated_entities pde ON pde.delegated_entity_id = de.id
        WHERE pde.payer_id = $1 AND de.active = TRUE
          ${filters}
        ORDER BY de.name
      `, params);
      res.json(rows);
    } catch (err: any) {
      console.error('[API] payer delegated-entities error:', err.message);
      res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  // ── Prompt C: GET /api/billing/plan-products (all) ───────────────────────
  app.get("/api/billing/plan-products", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const { rows } = await db.query(`SELECT * FROM plan_products WHERE active = TRUE ORDER BY sort_order, label`);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/patients", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const search = (req.query.search as string || "").trim().toLowerCase();
      const showArchived = req.query.archived === "true";
      const db = await import("./db").then(m => m.pool);
      const orgId = requireOrgCtx(req, res);
      if (!orgId) return;
      let query = `
        SELECT p.*, l.name as lead_name,
          (SELECT MAX(COALESCE(c.service_date::text, c.created_at::text)) FROM claims c WHERE c.patient_id = p.id AND c.archived_at IS NULL) as last_claim_date,
          (SELECT c.status FROM claims c WHERE c.patient_id = p.id AND c.archived_at IS NULL ORDER BY COALESCE(c.service_date, c.created_at::date) DESC LIMIT 1) as last_claim_status
        FROM patients p
        LEFT JOIN leads l ON p.lead_id = l.id
        WHERE 1=1
      `;
      const params: any[] = [];
      let idx = 1;
      query += ` AND p.organization_id = $${idx}`; params.push(orgId); idx++;
      if (showArchived) {
        query += ` AND p.archived_at IS NOT NULL`;
      } else {
        query += ` AND p.archived_at IS NULL`;
      }
      if (search) {
        query += ` AND (
          LOWER(COALESCE(p.first_name, '')) LIKE $${idx}
          OR LOWER(COALESCE(p.last_name, '')) LIKE $${idx}
          OR LOWER(COALESCE(p.first_name || ' ' || p.last_name, '')) LIKE $${idx}
          OR LOWER(COALESCE(l.name, '')) LIKE $${idx}
          OR LOWER(COALESCE(p.dob, '')) LIKE $${idx}
          OR LOWER(COALESCE(p.insurance_carrier, '')) LIKE $${idx}
          OR LOWER(COALESCE(p.member_id, '')) LIKE $${idx}
        )`;
        params.push(`%${search}%`); idx++;
      }
      query += ` ORDER BY p.created_at DESC`;
      const { rows } = await db.query(query, params);
      res.json(rows);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/patients/:id", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const { rows } = await db.query(
        `SELECT p.*, l.name as lead_name, l.phone as lead_phone, l.email as lead_email FROM patients p LEFT JOIN leads l ON p.lead_id = l.id WHERE p.id = $1`,
        [req.params.id]
      );
      if (rows.length === 0 || !verifyOrg(rows[0], req)) return res.status(404).json({ error: "Patient not found" });
      const patient = rows[0];
      if (!patient.first_name && !patient.last_name && patient.lead_name) {
        const parts = patient.lead_name.trim().split(/\s+/);
        patient.first_name = parts[0] || null;
        patient.last_name = parts.slice(1).join(" ") || null;
      }
      if (!patient.phone && patient.lead_phone) patient.phone = patient.lead_phone;
      if (!patient.email && patient.lead_email) patient.email = patient.lead_email;
      res.json(patient);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.post("/api/billing/patients", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const {
        firstName, lastName, dob, sex, insuranceCarrier, memberId, groupNumber,
        insuredName, relationshipToInsured, authorizationNumber, referringProviderName,
        referringProviderNpi, referralSource, referralPartnerName, defaultProviderId,
        serviceNeeded, phone, email, preferredName, state, planType, address, payerId,
        secondaryPayerId, secondaryMemberId, secondaryGroupNumber, secondaryPlanName, secondaryRelationship,
        planProductCode, delegatedEntityId, pcpId, pcpReferralNumber
      } = req.body;
      if (!firstName?.trim() || !lastName?.trim() || !dob?.trim()) {
        return res.status(400).json({ error: "firstName, lastName, and dob are required" });
      }
      if (referringProviderNpi) {
        const { validateNPI } = await import("../shared/npi-validation");
        if (!validateNPI(referringProviderNpi)) {
          return res.status(400).json({ error: "Invalid referring provider NPI" });
        }
      }
      const db = await import("./db").then(m => m.pool);
      const { rows } = await db.query(
        `INSERT INTO patients (
          id, organization_id, first_name, last_name, dob, sex, insurance_carrier, member_id, group_number,
          insured_name, relationship_to_insured, authorization_number, referring_provider_name,
          referring_provider_npi, referral_source, referral_partner_name, default_provider_id,
          service_needed, phone, email, preferred_name, state, plan_type, address, payer_id,
          secondary_payer_id, secondary_member_id, secondary_group_number, secondary_plan_name, secondary_relationship,
          street_address, city, zip_code,
          plan_product_code, delegated_entity_id, pcp_id, pcp_referral_number,
          created_at
        ) VALUES (
          gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22, $23, $24,
          $25, $26, $27, $28, $29,
          $30, $31, $32,
          $33, $34, $35, $36,
          NOW()
        ) RETURNING *`,
        [
          getOrgId(req), firstName.trim(), lastName.trim(), dob, sex || null, insuranceCarrier || null,
          memberId || null, groupNumber || null, insuredName || null,
          relationshipToInsured || null, authorizationNumber || null,
          referringProviderName || null, referringProviderNpi || null,
          referralSource || null, referralPartnerName || null, defaultProviderId || null,
          serviceNeeded || null, phone || null, email || null, preferredName || null,
          state || null, planType || null, address ? JSON.stringify(address) : null, payerId || null,
          secondaryPayerId || null, secondaryMemberId || null, secondaryGroupNumber || null,
          secondaryPlanName || null, secondaryRelationship || null,
          address?.street || address?.street1 || null, address?.city || null, address?.zip || null,
          planProductCode || null, delegatedEntityId || null, pcpId || null, pcpReferralNumber || null
        ]
      );
      const newPatient = rows[0];
      // Fire-and-forget: auto-archive demo patients if org now has ≥ 5 real patients
      const orgIdForAuto = getOrgId(req);
      if (orgIdForAuto) {
        _autoArchiveDemoPatients(db, orgIdForAuto, "system").catch(() => {});
      }
      res.json(newPatient);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.patch("/api/billing/patients/:id", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const { id } = req.params;
      const dbCheck = await import("./db").then(m => m.pool);
      const ownerCheck = await dbCheck.query("SELECT organization_id FROM patients WHERE id = $1", [id]);
      if (!ownerCheck.rows.length || !verifyOrg(ownerCheck.rows[0], req)) return res.status(404).json({ error: "Patient not found" });
      const fields: string[] = [];
      const values: any[] = [];
      let idx = 1;
      const allowedFields: Record<string, string> = {
        firstName: "first_name", lastName: "last_name", dob: "dob", sex: "sex",
        insuranceCarrier: "insurance_carrier", memberId: "member_id", groupNumber: "group_number",
        insuredName: "insured_name", relationshipToInsured: "relationship_to_insured",
        authorizationNumber: "authorization_number", referringProviderName: "referring_provider_name",
        referringProviderNpi: "referring_provider_npi", referralSource: "referral_source",
        referralPartnerName: "referral_partner_name", defaultProviderId: "default_provider_id",
        serviceNeeded: "service_needed", phone: "phone", email: "email",
        preferredName: "preferred_name", state: "state", planType: "plan_type",
        payerId: "payer_id", notes: "notes",
        secondaryPayerId: "secondary_payer_id", secondaryMemberId: "secondary_member_id",
        secondaryGroupNumber: "secondary_group_number", secondaryPlanName: "secondary_plan_name",
        secondaryRelationship: "secondary_relationship",
        streetAddress: "street_address", city: "city", zipCode: "zip_code",
        planProduct: "plan_product",
        planProductCode: "plan_product_code",
        delegatedEntityId: "delegated_entity_id",
        pcpId: "pcp_id",
        pcpReferralNumber: "pcp_referral_number",
      };
      if (req.body.referringProviderNpi) {
        const { validateNPI } = await import("../shared/npi-validation");
        if (!validateNPI(req.body.referringProviderNpi)) {
          return res.status(400).json({ error: "Invalid referring provider NPI" });
        }
      }
      for (const [key, col] of Object.entries(allowedFields)) {
        if (req.body[key] !== undefined) {
          fields.push(`${col} = $${idx++}`);
          values.push(req.body[key]);
        }
      }
      if (req.body.address !== undefined) {
        fields.push(`address = $${idx++}`);
        values.push(JSON.stringify(req.body.address));
        const addr = req.body.address || {};
        if (addr.street || addr.street1) { fields.push(`street_address = $${idx++}`); values.push(addr.street || addr.street1); }
        if (addr.city) { fields.push(`city = $${idx++}`); values.push(addr.city); }
        if (addr.zip) { fields.push(`zip_code = $${idx++}`); values.push(addr.zip); }
      }
      if (fields.length === 0) return res.status(400).json({ error: "No fields to update" });
      fields.push(`updated_at = NOW()`);
      values.push(id);
      const db = await import("./db").then(m => m.pool);
      const { rows } = await db.query(
        `UPDATE patients SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
        values
      );
      if (rows.length === 0) return res.status(404).json({ error: "Patient not found" });
      res.json(rows[0]);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  // ── Patient soft-delete (archive / restore) ──────────────────────────────
  app.patch("/api/billing/patients/:id/archive", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const { id } = req.params;
      const { reason } = req.body as { reason?: string };
      const user = req.user as any;
      const orgId = getOrgId(req);

      const ownerCheck = await db.query("SELECT organization_id, archived_at FROM patients WHERE id = $1", [id]);
      if (!ownerCheck.rows.length || !verifyOrg(ownerCheck.rows[0], req)) return res.status(404).json({ error: "Patient not found" });
      if (ownerCheck.rows[0].archived_at) return res.status(400).json({ error: "Patient is already archived" });

      // Block if patient has active claims (anything not draft/void/paid/denied/rejected)
      const { rows: activeClaims } = await db.query(
        `SELECT id FROM claims
         WHERE patient_id = $1
           AND organization_id = $2
           AND archived_at IS NULL
           AND status NOT IN ('draft','void','paid','denied','rejected')
         LIMIT 1`,
        [id, orgId]
      );
      if (activeClaims.length > 0) {
        return res.status(409).json({
          error: "This patient has active claims. Resolve those first or contact admin.",
          code: "ACTIVE_CLAIMS"
        });
      }

      const archivedBy = user?.email || user?.name || "system";
      await db.query(
        `UPDATE patients SET archived_at = NOW(), archived_by = $1, archive_reason = $2, updated_at = NOW() WHERE id = $3`,
        [archivedBy, reason || null, id]
      );

      // Check if org now has ≥ 5 real (non-demo, non-archived) patients → auto-archive demos
      await _autoArchiveDemoPatients(db, orgId, archivedBy);

      res.json({ success: true });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.patch("/api/billing/patients/:id/restore", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const { id } = req.params;
      const ownerCheck = await db.query("SELECT organization_id, archived_at FROM patients WHERE id = $1", [id]);
      if (!ownerCheck.rows.length || !verifyOrg(ownerCheck.rows[0], req)) return res.status(404).json({ error: "Patient not found" });
      if (!ownerCheck.rows[0].archived_at) return res.status(400).json({ error: "Patient is not archived" });

      await db.query(
        `UPDATE patients SET archived_at = NULL, archived_by = NULL, archive_reason = NULL, updated_at = NOW() WHERE id = $1`,
        [id]
      );
      res.json({ success: true });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/patients/:id/claims", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const ownerCheck = await db.query("SELECT organization_id FROM patients WHERE id = $1", [req.params.id]);
      if (!ownerCheck.rows.length || !verifyOrg(ownerCheck.rows[0], req)) return res.status(404).json({ error: "Patient not found" });
      const { rows } = await db.query(
        `SELECT * FROM claims WHERE patient_id = $1 AND archived_at IS NULL ORDER BY created_at DESC`,
        [req.params.id]
      );
      res.json(rows);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.post("/api/billing/patients/:id/notes", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const { text, author } = req.body;
      if (!text?.trim()) return res.status(400).json({ error: "Note text is required" });
      const db = await import("./db").then(m => m.pool);
      const user = req.user as any;
      const authorName = author || user?.name || user?.email || "Unknown";
      const newNote = { text: text.trim(), timestamp: new Date().toISOString(), author: authorName };
      const existing = await db.query("SELECT notes, organization_id FROM patients WHERE id = $1", [req.params.id]);
      if (existing.rows.length === 0 || !verifyOrg(existing.rows[0], req)) return res.status(404).json({ error: "Patient not found" });
      let notes: any[] = [];
      try {
        const raw = existing.rows[0].notes;
        if (raw) notes = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!Array.isArray(notes)) notes = [];
      } catch { notes = []; }
      notes.push(newNote);
      const { rows } = await db.query(
        "UPDATE patients SET notes = $1, updated_at = NOW() WHERE id = $2 RETURNING notes",
        [JSON.stringify(notes), req.params.id]
      );
      res.json({ notes: rows[0].notes });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/patients/:id/vob", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const ownerCheck = await db.query("SELECT organization_id FROM patients WHERE id = $1", [req.params.id]);
      if (!ownerCheck.rows.length || !verifyOrg(ownerCheck.rows[0], req)) return res.status(404).json({ error: "Patient not found" });
      const { rows } = await db.query(
        `SELECT * FROM vob_verifications
         WHERE patient_id = $1
            OR lead_id = (SELECT lead_id FROM patients WHERE id = $1)
         ORDER BY verified_at DESC`,
        [req.params.id]
      );
      res.json(rows);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  // Stedi configuration status (used by frontend to toggle live vs manual mode)
  app.get("/api/billing/stedi/status", requireRole("admin", "rcm_manager"), async (_req, res) => {
    const { isStediConfigured } = await import("./services/stedi-eligibility");
    const { ISA15_INDICATOR, STEDI_ENV } = await import("./lib/environment");
    res.json({
      configured: isStediConfigured(),
      ediMode: ISA15_INDICATOR,
      stediEnv: STEDI_ENV,
    });
  });

  // Run live Stedi eligibility check for a billing patient
  app.post("/api/billing/patients/:id/vob/check", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = getOrgId(req);
      const patientId = req.params.id;

      // Verify patient belongs to org
      const { rows: patRows } = await db.query(
        `SELECT p.*, ps.primary_npi as practice_npi, ps.practice_name as practice_name
         FROM patients p
         LEFT JOIN practice_settings ps ON ps.organization_id = p.organization_id
         WHERE p.id = $1`, [patientId]
      );
      if (!patRows.length || !verifyOrg(patRows[0], req)) {
        return res.status(404).json({ error: "Patient not found" });
      }
      const patient = patRows[0];

      // Resolve payer EDI ID from patient's insurance carrier or explicit payer_id
      let ediPayerId = "00000";
      let payerNameResolved = patient.insurance_carrier || "Unknown";
      if (patient.payer_id) {
        const { rows: payerRows } = await db.query(
          `SELECT edi_payer_id, name FROM payers WHERE id = $1`, [patient.payer_id]
        );
        if (payerRows.length) {
          ediPayerId = payerRows[0].edi_payer_id || ediPayerId;
          payerNameResolved = payerRows[0].name || payerNameResolved;
        }
      }

      if (!patient.member_id) {
        return res.status(400).json({ error: "Patient has no member ID — cannot run eligibility check" });
      }
      if (!patient.first_name || !patient.last_name) {
        return res.status(400).json({ error: "Patient first and last name are required for eligibility check" });
      }
      if (!patient.dob) {
        return res.status(400).json({ error: "Patient date of birth is required for eligibility check" });
      }
      if (!patient.practice_npi) {
        return res.status(400).json({ error: "Practice NPI not set — configure it in Settings → Practice" });
      }

      const controlNumber = String(Date.now()).slice(-9);
      const dobFormatted = patient.dob.replace(/-/g, "");

      const { checkEligibility } = await import("./services/stedi-eligibility");
      const result = await checkEligibility({
        controlNumber,
        tradingPartnerServiceId: ediPayerId,
        providerNpi: patient.practice_npi,
        providerName: patient.practice_name || "Provider",
        subscriberFirstName: patient.first_name,
        subscriberLastName: patient.last_name,
        subscriberDob: dobFormatted,
        subscriberMemberId: patient.member_id,
        serviceTypeCodes: ["42"],
      });

      const userName = (req as any).user?.username || (req as any).user?.email || null;
      const vobId = `vob-stedi-${Date.now()}`;

      await db.query(
        `INSERT INTO vob_verifications
           (id, patient_id, payer_id, payer_name, member_id, status, policy_status, policy_type,
            plan_name, effective_date, term_date, copay, deductible, deductible_met, coinsurance,
            out_of_pocket_max, prior_auth_required, network_status, raw_response, error_message,
            verification_method, stedi_transaction_id, verified_by, context, organization_id, verified_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21,$22,$23,$24,$25,NOW())`,
        [
          vobId, patientId, patient.payer_id || null, payerNameResolved, patient.member_id,
          result.status === "error" ? "error" : "verified",
          result.policyStatus, result.policyType, result.planName,
          result.effectiveDate, result.termDate,
          result.copay, result.deductible, result.deductibleMet, result.coinsurance,
          result.outOfPocketMax, result.priorAuthRequired, result.networkStatus,
          JSON.stringify(result.rawResponse), result.errorMessage,
          "stedi", result.stediTransactionId, userName, "billing", orgId,
        ]
      );

      if (result.status !== "error") {
        await db.query("UPDATE patients SET vob_verified = true WHERE id = $1", [patientId]);
      }

      res.json({ ...result, id: vobId });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  // Save a manual VOB entry for a billing patient
  app.post("/api/billing/patients/:id/vob/manual", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = getOrgId(req);
      const patientId = req.params.id;

      const ownerCheck = await db.query("SELECT organization_id FROM patients WHERE id = $1", [patientId]);
      if (!ownerCheck.rows.length || !verifyOrg(ownerCheck.rows[0], req)) {
        return res.status(404).json({ error: "Patient not found" });
      }

      const {
        payerName, memberId, policyStatus, planName, effectiveDate, termDate,
        copay, deductible, deductibleMet, coinsurance, outOfPocketMax,
        priorAuthRequired, networkStatus, payerNotes,
      } = req.body;

      if (!memberId) return res.status(400).json({ error: "Member ID is required" });
      if (!payerName) return res.status(400).json({ error: "Payer name is required" });

      const userName = (req as any).user?.username || (req as any).user?.email || null;
      const vobId = `vob-manual-${Date.now()}`;

      await db.query(
        `INSERT INTO vob_verifications
           (id, patient_id, payer_name, member_id, status, policy_status, plan_name,
            effective_date, term_date, copay, deductible, deductible_met, coinsurance,
            out_of_pocket_max, prior_auth_required, network_status, payer_notes,
            verification_method, verified_by, context, organization_id, verified_at)
         VALUES ($1,$2,$3,$4,'verified',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'manual',$17,$18,$19,NOW())`,
        [
          vobId, patientId, payerName, memberId,
          policyStatus || "Active", planName || null,
          effectiveDate || null, termDate || null,
          copay ?? null, deductible ?? null, deductibleMet ?? null, coinsurance ?? null,
          outOfPocketMax ?? null, priorAuthRequired ?? false, networkStatus || "unknown",
          payerNotes || null, userName, "billing", orgId,
        ]
      );

      await db.query("UPDATE patients SET vob_verified = true WHERE id = $1", [patientId]);

      const { rows } = await db.query("SELECT * FROM vob_verifications WHERE id = $1", [vobId]);
      if (!rows[0]) return res.status(500).json({ error: "VOB saved but could not be retrieved" });
      res.json(rows[0]);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/dashboard/metrics", requireRole("admin", "rcm_manager", "intake"), async (req, res) => {
    const orgId = requireOrgCtx(req, res);
    if (!orgId) return;
    const metrics = await storage.getDashboardMetrics(orgId);
    res.json(metrics);
  });

  app.get("/api/dashboard/alerts", requireRole("admin", "rcm_manager", "intake"), async (req, res) => {
    const orgId = requireOrgCtx(req, res);
    if (!orgId) return;
    try {
      const db = await import("./db").then(m => m.pool);
      const { rows: redClaims } = await db.query(
        `SELECT c.id, c.payer, c.created_at, c.last_test_errors
         FROM claims c
         WHERE c.organization_id = $1 AND c.readiness_status = 'RED' AND c.archived_at IS NULL
         ORDER BY c.created_at DESC LIMIT 3`,
        [orgId]
      );
      const { rows: stuckClaims } = await db.query(
        `SELECT DISTINCT ON (c.id) c.id, c.payer, ce.timestamp as pending_since
         FROM claims c
         JOIN claim_events ce ON ce.claim_id = c.id AND ce.type = 'Pending'
         WHERE c.organization_id = $1 AND c.archived_at IS NULL
           AND ce.timestamp < NOW() - INTERVAL '7 days'
         ORDER BY c.id, ce.timestamp ASC LIMIT 5`,
        [orgId]
      );
      const alerts: any[] = [];
      for (const claim of redClaims) {
        let reason = "Claim blocked — review required";
        try {
          const errs = Array.isArray(claim.last_test_errors) ? claim.last_test_errors : JSON.parse(claim.last_test_errors || "[]");
          if (errs[0]) reason = errs[0];
        } catch { /* use default */ }
        alerts.push({
          id: claim.id,
          type: "risk",
          title: "High-Risk Claim Blocked",
          description: `Claim ${claim.id.slice(0, 8)} for ${claim.payer}: ${reason}`,
          claimId: claim.id,
          severity: "high",
          timestamp: claim.created_at,
        });
      }
      for (const claim of stuckClaims) {
        const daysPending = Math.floor((Date.now() - new Date(claim.pending_since).getTime()) / (1000 * 60 * 60 * 24));
        alerts.push({
          id: `stuck-${claim.id}`,
          type: "stuck",
          title: "Claim Stuck in Pending",
          description: `Claim ${claim.id.slice(0, 8)} has been pending for ${daysPending} days`,
          claimId: claim.id,
          severity: "medium",
          timestamp: claim.pending_since,
        });
      }
      res.json(alerts.slice(0, 5));
    } catch (err: any) {
      console.error('[API] dashboard alerts error:', err);
      res.status(500).json({ error: 'An unexpected error occurred.' });
    }
  });

  app.get("/api/leads", requireRole("admin", "intake"), async (req, res) => {
    const leads = await storage.getLeads(getOrgId(req));
    res.json(leads);
  });

  // Worklist API with queue filtering
  app.get("/api/leads/worklist", requireRole("admin", "intake"), async (req, res) => {
    const allLeads = await storage.getLeads(getOrgId(req));
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

  app.get("/api/leads/:id", requireRole("admin", "intake"), async (req, res) => {
    const lead = await storage.getLead(req.params.id);
    if (!lead || !verifyOrg(lead, req)) {
      return res.status(404).json({ error: "Lead not found" });
    }
    res.json(lead);
  });

  // NOTE: This endpoint is intentionally open (no requireRole) because it is also
  // used by the public patient intake chat widget to create leads without a session.
  // Authenticated requests use the caller's org; unauthenticated requests get org=null
  // (visible only to super_admin until associated with a real org via widget config).
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
      organizationId: getOrgId(req),
    };
    
    const lead = await storage.createLead(leadData as any);
    res.status(201).json(lead);

    // Trigger any matching automation flows (fire-and-forget)
    triggerMatchingFlows(lead as any).catch((err) =>
      console.error("[routes] triggerMatchingFlows error:", err)
    );
  });

  // PATCH endpoint for quick actions and lead updates
  app.patch("/api/leads/:id", requireRole("admin", "intake"), async (req, res) => {
    const lead = await storage.getLead(req.params.id);
    if (!lead || !verifyOrg(lead, req)) {
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
          organizationId: getOrgId(req),
        });
      }
    }

    const updated = await storage.updateLead(req.params.id, updates);
    res.json(updated);
  });

  app.get("/api/leads/:id/calls", requireRole("admin", "intake"), async (req, res) => {
    const lead = await storage.getLead(req.params.id);
    if (!lead || !verifyOrg(lead, req)) return res.status(404).json({ error: "Lead not found" });
    const calls = await storage.getCallsByLeadId(req.params.id);
    res.json(calls);
  });

  app.get("/api/leads/:id/patient", requireRole("admin", "intake"), async (req, res) => {
    const lead = await storage.getLead(req.params.id);
    if (!lead || !verifyOrg(lead, req)) return res.status(404).json({ error: "Lead not found" });
    const patient = await storage.getPatientByLeadId(req.params.id);
    res.json(patient || null);
  });

  // Update patient and sync to lead
  app.patch("/api/leads/:id/patient", requireRole("admin", "intake"), async (req, res) => {
    const leadForPatient = await storage.getLead(req.params.id);
    if (!leadForPatient || !verifyOrg(leadForPatient, req)) return res.status(404).json({ error: "Lead not found" });
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

  // ── Halt all engagement for a lead ────────────────────────────────────────
  app.post("/api/leads/:id/halt-engagement", requireRole("admin", "intake"), async (req, res) => {
    try {
      const { id } = req.params;
      const orgId = getOrgId(req);
      const leadCheck = await pool.query(
        `SELECT id FROM leads WHERE id = $1 AND organization_id = $2`,
        [id, orgId]
      );
      if (!leadCheck.rows.length) return res.status(404).json({ error: "Lead not found" });

      await pool.query(
        `UPDATE leads SET engagement_halted = true, consent_to_call = false WHERE id = $1`,
        [id]
      );
      const haltedCount = await pool.query(
        `UPDATE flow_runs SET status = 'halted', halted_at = NOW(), updated_at = NOW()
         WHERE lead_id = $1 AND status IN ('running', 'paused')
         RETURNING id`,
        [id]
      );
      await pool.query(
        `UPDATE comm_locks SET released_at = NOW()
         WHERE lead_id = $1 AND released_at IS NULL`,
        [id]
      );
      await pool.query(
        `INSERT INTO activity_logs (lead_id, activity_type, description, created_at, organization_id)
         VALUES ($1, 'engagement_halted', $2, NOW(), $3)`,
        [id, `All engagement halted by staff. ${haltedCount.rowCount} active flow run(s) stopped.`, orgId]
      );
      res.json({ success: true, flowRunsHalted: haltedCount.rowCount });
    } catch (err: any) {
      console.error("[API] halt-engagement error:", err);
      res.status(500).json({ error: "Failed to halt engagement" });
    }
  });

  // ── Resume engagement for a lead ───────────────────────────────────────────
  app.post("/api/leads/:id/resume-engagement", requireRole("admin", "intake"), async (req, res) => {
    try {
      const { id } = req.params;
      const orgId = getOrgId(req);
      const leadCheck = await pool.query(
        `SELECT id FROM leads WHERE id = $1 AND organization_id = $2`,
        [id, orgId]
      );
      if (!leadCheck.rows.length) return res.status(404).json({ error: "Lead not found" });

      await pool.query(
        `UPDATE leads SET engagement_halted = false, consent_to_call = true WHERE id = $1`,
        [id]
      );
      await pool.query(
        `INSERT INTO activity_logs (lead_id, activity_type, description, created_at, organization_id)
         VALUES ($1, 'engagement_resumed', 'Engagement resumed by staff — lead can be re-enrolled in flows', NOW(), $2)`,
        [id, orgId]
      );
      res.json({ success: true });
    } catch (err: any) {
      console.error("[API] resume-engagement error:", err);
      res.status(500).json({ error: "Failed to resume engagement" });
    }
  });

  app.post("/api/leads/:id/convert-to-patient", requireRole("admin", "intake"), async (req, res) => {
    try {
      const lead = await storage.getLead(req.params.id);
      if (!lead || !verifyOrg(lead, req)) {
        return res.status(404).json({ error: "Lead not found" });
      }

      const existingPatient = await storage.getPatientByLeadId(req.params.id);
      if (existingPatient) {
        return res.json({ patient: existingPatient, alreadyExisted: true });
      }

      const nameParts = (lead.name || "").trim().split(/\s+/);
      const firstName = lead.firstName || nameParts[0] || "Unknown";
      const lastName = lead.lastName || nameParts.slice(1).join(" ") || "Unknown";

      const db = await import("./db").then(m => m.pool);
      const { rows } = await db.query(
        `INSERT INTO patients (id, lead_id, first_name, last_name, dob, email, phone, insurance_carrier, member_id, plan_type, state, service_needed, referral_source, intake_completed, organization_id)
         SELECT gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, $13
         WHERE NOT EXISTS (SELECT 1 FROM patients WHERE lead_id = $1)
         RETURNING *`,
        [lead.id, firstName, lastName, (lead as any).dob || null, lead.email || null, lead.phone || null,
         lead.insuranceCarrier || null, lead.memberId || null, lead.planType || null,
         lead.state || null, lead.serviceNeeded || null, lead.source || "From Intake", getOrgId(req)]
      );

      if (rows.length === 0) {
        const existingNow = await storage.getPatientByLeadId(req.params.id);
        return res.json({ patient: existingNow, alreadyExisted: true });
      }

      await db.query("UPDATE leads SET handoff_status = 'sent' WHERE id = $1", [req.params.id]);

      res.json({ patient: rows[0], alreadyExisted: false });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  // Manual sync of patient data to lead
  app.post("/api/leads/:id/sync-patient", requireRole("admin", "intake"), async (req, res) => {
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
  app.get("/api/leads/:id/call-context", requireRole("admin", "intake"), async (req, res) => {
    const lead = await storage.getLead(req.params.id);
    if (!lead || !verifyOrg(lead, req)) {
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

  app.post("/api/leads/:id/call", requireRole("admin", "intake"), async (req, res) => {
    const lead = await storage.getLead(req.params.id);
    if (!lead || !verifyOrg(lead, req)) {
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
      organizationId: getOrgId(req),
      channel: "vapi",
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
          state: extracted.state || "",
          insuranceCarrier: extracted.insuranceCarrier || extracted.insurance_carrier || "Blue Cross",
          memberId: extracted.memberId || extracted.member_id || "MEM" + Math.random().toString(36).slice(2, 10).toUpperCase(),
          planType: "PPO",
          organizationId: getOrgId(req),
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

  app.post("/api/leads/:id/claim-packet", requireRole("admin", "intake"), async (req, res) => {
    const lead = await storage.getLead(req.params.id);
    if (!lead || !verifyOrg(lead, req)) {
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
      organizationId: getOrgId(req),
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
      organizationId: getOrgId(req),
    });

    await storage.createClaimEvent({
      claimId: claim.id,
      type: "Created",
      notes: "Claim packet created from lead intake",
      organizationId: getOrgId(req),
    });

    await storage.updateLead(req.params.id, { status: "converted" });

    res.status(201).json({ claimId: claim.id });
  });

  app.get("/api/claims/recent", requireRole("admin", "rcm_manager"), async (req, res) => {
    const claims = await storage.getClaims(getOrgId(req));
    res.json(claims.slice(0, 10));
  });

  app.get("/api/claims", requireRole("admin", "rcm_manager"), async (req, res) => {
    const claims = await storage.getClaims(getOrgId(req));
    res.json(claims);
  });

  app.get("/api/claims/:id", requireRole("admin", "rcm_manager"), async (req, res) => {
    const claim = await storage.getClaim(req.params.id);
    if (!claim || !verifyOrg(claim, req)) {
      return res.status(404).json({ error: "Claim not found" });
    }
    res.json(claim);
  });

  app.get("/api/claims/:id/events", requireRole("admin", "rcm_manager"), async (req, res) => {
    const claim = await storage.getClaim(req.params.id);
    if (!claim || !verifyOrg(claim, req)) {
      return res.status(404).json({ error: "Claim not found" });
    }
    const events = await storage.getClaimEvents(req.params.id);
    res.json(events);
  });

  app.get("/api/claims/:id/explanation", requireRole("admin", "rcm_manager"), async (req, res) => {
    const claim = await storage.getClaim(req.params.id);
    if (!claim || !verifyOrg(claim, req)) {
      return res.status(404).json({ error: "Claim not found" });
    }
    const explanation = await storage.getRiskExplanation(req.params.id);
    res.json(explanation || null);
  });

  app.get("/api/claims/:id/patient", requireRole("admin", "rcm_manager"), async (req, res) => {
    const claim = await storage.getClaim(req.params.id);
    if (!claim || !verifyOrg(claim, req)) {
      return res.status(404).json({ error: "Claim not found" });
    }
    const patient = await storage.getClaimPatient(req.params.id);
    res.json(patient || null);
  });

  app.post("/api/claims/:id/submit", requireRole("admin", "rcm_manager"), async (req, res) => {
    const claim = await storage.getClaim(req.params.id);
    if (!claim || !verifyOrg(claim, req)) {
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
      organizationId: getOrgId(req),
    });

    res.json({ success: true });
  });

  app.get("/api/intelligence/clusters", requireRole("admin", "rcm_manager"), async (req, res) => {
    const clusters = await storage.getDenialClusters(getOrgId(req));
    res.json(clusters);
  });

  app.get("/api/intelligence/top-patterns", requireRole("admin", "rcm_manager"), async (req, res) => {
    const patterns = await storage.getTopPatterns(getOrgId(req));
    res.json(patterns);
  });

  app.get("/api/rules", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = requireOrgCtx(req, res);
      if (!orgId) return;
      const { rows } = await db.query(
        `SELECT *, COALESCE(specialty_tags, '{}') as specialty_tags FROM rules WHERE organization_id = $1 OR organization_id IS NULL ORDER BY created_at DESC`,
        [orgId]
      );
      const mapped = rows.map((r: any) => ({
        ...r,
        impactCount: r.impact_count ?? r.impactCount ?? 0,
        triggeredCount: r.triggered_count ?? r.triggeredCount ?? 0,
        preventedCount: r.prevented_count ?? r.preventedCount ?? 0,
        protectedAmount: r.protected_amount ?? r.protectedAmount ?? 0,
        createdAt: r.created_at ?? r.createdAt,
        organizationId: r.organization_id ?? r.organizationId,
        cptCode: r.cpt_code ?? r.cptCode,
        triggerPattern: r.trigger_pattern ?? r.triggerPattern,
        preventionAction: r.prevention_action ?? r.preventionAction,
        specialtyTags: r.specialty_tags ?? [],
      }));
      res.json(mapped);
    } catch {
      const rules = await storage.getRules(getOrgId(req));
      res.json(rules);
    }
  });

  app.post("/api/rules", requireRole("admin", "rcm_manager"), async (req, res) => {
    const parsed = insertRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.message });
    }
    const rule = await storage.createRule({ ...parsed.data, organizationId: getOrgId(req) });
    if (req.body.specialtyTags && Array.isArray(req.body.specialtyTags)) {
      const db = await import("./db").then(m => m.pool);
      await db.query(`UPDATE rules SET specialty_tags = $1 WHERE id = $2`, [req.body.specialtyTags, rule.id]);
    }
    res.status(201).json(rule);
  });

  app.post("/api/rules/generate", requireRole("admin", "rcm_manager"), async (req, res) => {
    const { payer, cptCode, rootCause, suggestedRule } = req.body;
    
    const rule = await storage.createRule({
      name: suggestedRule?.name || `Prevent ${rootCause} for ${payer}`,
      description: suggestedRule?.description || `Auto-generated rule to prevent ${rootCause} denials`,
      payer: payer || null,
      cptCode: cptCode || null,
      triggerPattern: suggestedRule?.triggerPattern || `payer=${payer} AND cptCode=${cptCode}`,
      preventionAction: suggestedRule?.preventionAction || "Block submission pending review",
      enabled: true,
      organizationId: getOrgId(req),
    });

    res.status(201).json(rule);
  });

  app.patch("/api/rules/:id", requireRole("admin", "rcm_manager"), async (req, res) => {
    const existing = await storage.getRule(req.params.id);
    if (!existing || !verifyOrg(existing, req)) {
      return res.status(404).json({ error: "Rule not found" });
    }
    const rule = await storage.updateRule(req.params.id, req.body);
    res.json(rule);
  });

  app.delete("/api/rules/:id", requireRole("admin", "rcm_manager"), async (req, res) => {
    const existing = await storage.getRule(req.params.id);
    if (!existing || !verifyOrg(existing, req)) {
      return res.status(404).json({ error: "Rule not found" });
    }
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
        // Vapi quality tuning (Item 7)
        transcriber: {
          provider: "deepgram",
          model: "nova-2",
          language: "en",
          endpointing: 300,
        },
        model: {
          provider: "openai",
          model: "gpt-4o-mini",
          temperature: 0.2,
        },
        voice: {
          provider: "11labs",
          voiceId: "21m00Tcm4TlvDq8ikWAM",
          stability: 0.5,
          similarityBoost: 0.75,
        },
        silenceTimeoutSeconds: 30,
        maxDurationSeconds: 900,
        backgroundDenoisingEnabled: true,
      },
    };
  };

  app.post("/api/vapi/outbound-call", requireRole("admin", "intake"), async (req, res) => {
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

    // Acquire comm lock — block if lead is engaged by an active flow
    const callUserId = (req.user as any)?.id || "unknown";
    const callLockId = await acquireLock({
      leadId: String(leadId),
      acquiredByType: "manual_user",
      acquiredById: String(callUserId),
      channel: "call",
      reason: "Manual outbound call from deal detail",
      durationMinutes: 30,
    });
    if (!callLockId) {
      return res.status(409).json({
        error: "Lead is currently engaged on another channel. Try again in a few minutes.",
      });
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
        await releaseLock(callLockId).catch(() => {});
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
        organizationId: getOrgId(req),
        channel: "vapi",
      });
      
      // Lock will be released when call ends (via Vapi webhook end-of-call-report)
      res.status(201).json({ 
        success: true, 
        callId: call.id,
        vapiCallId: callData.id,
        status: callData.status,
        lockId: callLockId,
      });
    } catch (error) {
      console.error("Error initiating Vapi call:", error);
      await releaseLock(callLockId).catch(() => {});
      res.status(500).json({ error: "Failed to initiate outbound call" });
    }
  });

  app.get("/api/vapi/call-status/:vapiCallId", requireRole("admin", "intake"), async (req, res) => {
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
      const { pool } = await import("./db");
      const incomingSecret = req.headers['x-vapi-secret'];
      if (!process.env.VAPI_WEBHOOK_SECRET) {
        console.warn('[vapi-webhook] VAPI_WEBHOOK_SECRET not set — accepting all webhooks');
      } else if (incomingSecret !== process.env.VAPI_WEBHOOK_SECRET) {
        return res.status(401).json({ error: 'Invalid webhook secret' });
      }

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

        // Extract flow metadata embedded when the call was initiated
        const flowRunId = callData.metadata?.flowRunId || null;
        const lockId = callData.metadata?.lockId || null;
        const flowLeadId = callData.metadata?.leadId || null;

        // Release comm lock if one was held for this call
        if (lockId) {
          await releaseLock(lockId).catch((e: unknown) =>
            console.error("releaseLock error:", e)
          );
        }
        
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

        // Server-side transcript extraction + flow advancement
        if (flowRunId && flowLeadId && transcript) {
          try {
            const extracted = await extractInsuranceFromTranscript(transcript);
            console.log("[vapi-webhook] Extracted from transcript:", extracted);

            // Update lead with extracted insurance data
            if (extracted.carrier || extracted.memberId || extracted.dob || extracted.state || extracted.serviceType || extracted.consent !== null) {
              await pool.query(
                `UPDATE leads SET
                   insurance_carrier  = COALESCE($1, insurance_carrier),
                   member_id          = COALESCE($2, member_id),
                   dob                = COALESCE($3, dob),
                   state              = COALESCE($4, state),
                   service_needed     = COALESCE($5, service_needed),
                   consent_to_call    = COALESCE($6, consent_to_call),
                   updated_at         = NOW()
                 WHERE id = $7`,
                [
                  extracted.carrier   || null,
                  extracted.memberId  || null,
                  extracted.dob       || null,
                  extracted.state     || null,
                  extracted.serviceType || null,
                  extracted.consent !== null ? extracted.consent : null,
                  flowLeadId,
                ]
              );
              console.log("[vapi-webhook] Lead updated with extracted fields:", {
                carrier: extracted.carrier,
                memberId: extracted.memberId,
                state: extracted.state,
                serviceType: extracted.serviceType,
                consent: extracted.consent,
              });
            }

            const outcome = extracted.carrier && extracted.memberId
              ? "success"
              : "failure";

            await advanceToNextStep(flowRunId, outcome);
          } catch (e) {
            console.error("[vapi-webhook] post-call flow processing error:", e);
            await advanceToNextStep(flowRunId, "failure").catch(() => {});
          }
        } else if (flowRunId) {
          // No transcript or lead — still advance the flow
          await advanceToNextStep(flowRunId, "failure").catch((e: unknown) =>
            console.error("[vapi-webhook] advanceToNextStep error:", e)
          );
        }
      }
      
      res.status(200).json({ received: true });
    } catch (error) {
      console.error("Error processing Vapi webhook:", error);
      res.status(200).json({ received: true }); // Always return 200 to avoid retries
    }
  });

  // Manually refresh call data from Vapi API
  app.post("/api/calls/:id/refresh", requireRole("admin", "intake"), async (req, res) => {
    const call = await storage.getCall(req.params.id);
    if (!call || !verifyOrg(call, req)) {
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
  app.get("/api/calls/:id", requireRole("admin", "intake"), async (req, res) => {
    const call = await storage.getCall(req.params.id);
    if (!call || !verifyOrg(call, req)) {
      return res.status(404).json({ error: "Call not found" });
    }
    res.json(call);
  });

  app.patch("/api/calls/:id", requireRole("admin", "intake"), async (req, res) => {
    const existing = await storage.getCall(req.params.id);
    if (!existing || !verifyOrg(existing, req)) {
      return res.status(404).json({ error: "Call not found" });
    }
    const call = await storage.updateCall(req.params.id, req.body);
    res.json(call);
  });

  // Prior Authorization routes
  app.get("/api/prior-auth/encounter/:encounterId", requireRole("admin", "rcm_manager"), async (req, res) => {
    const orgId = requireOrgCtx(req, res);
    if (!orgId) return;
    const auths = await storage.getPriorAuthsByEncounterId(req.params.encounterId, orgId);
    res.json(auths);
  });

  app.get("/api/prior-auth/patient/:patientId", requireRole("admin", "rcm_manager"), async (req, res) => {
    const orgId = requireOrgCtx(req, res);
    if (!orgId) return;
    const auths = await storage.getPriorAuthsByPatientId(req.params.patientId, orgId);
    res.json(auths);
  });

  app.get("/api/prior-auth/:id", requireRole("admin", "rcm_manager"), async (req, res) => {
    const auth = await storage.getPriorAuth(req.params.id);
    if (!auth || !verifyOrg(auth, req)) {
      return res.status(404).json({ error: "Prior authorization not found" });
    }
    res.json(auth);
  });

  app.post("/api/prior-auth", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const {
        patientId, payer, serviceType, authNumber, expiration_date, approvedUnits,
        notes, status, mode, source, referringProviderName, referringProviderNpi,
        requestSubmittedDate, requestMethod, clinicalJustification, denialReason,
      } = req.body;
      const orgId = getOrgId(req);
      const { rows } = await db.query(
        `INSERT INTO prior_authorizations
          (organization_id, patient_id, payer, service_type, auth_number, expiration_date,
           approved_units, used_units, notes, status, mode, source, referring_provider_name,
           referring_provider_npi, request_method, clinical_justification, denial_reason,
           request_status, requested_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,$10,$11,$12,$13,$14,$15,$16,'not_started',NOW())
         RETURNING *`,
        [orgId, patientId || null, payer || null, serviceType || null, authNumber || null,
         expiration_date || null, approvedUnits ? parseInt(approvedUnits) : null,
         notes || null, status || 'pending', mode || 'received', source || null,
         referringProviderName || null, referringProviderNpi || null,
         requestMethod || null, clinicalJustification || null, denialReason || null]
      );
      res.status(201).json(rows[0]);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.patch("/api/prior-auth/:id", requireRole("admin", "rcm_manager"), async (req, res) => {
    const existing = await storage.getPriorAuth(req.params.id);
    if (!existing || !verifyOrg(existing, req)) {
      return res.status(404).json({ error: "Prior authorization not found" });
    }
    const auth = await storage.updatePriorAuth(req.params.id, req.body);
    res.json(auth);
  });

  // ============================================
  // SMS Endpoints (Twilio Integration)
  // ============================================

  // Send SMS to a lead
  app.post("/api/leads/:id/sms", requireRole("admin", "intake"), async (req, res) => {
    if (!twilioClient || !twilioMessagingServiceSid) {
      return res.status(503).json({ error: "SMS service not configured" });
    }

    const lead = await storage.getLead(req.params.id);
    if (!lead || !verifyOrg(lead, req)) {
      return res.status(404).json({ error: "Lead not found" });
    }

    if (!lead.phone) {
      return res.status(400).json({ error: "Lead has no phone number" });
    }

    // Acquire comm lock — block if lead is engaged by an active flow
    const userId = (req.user as any)?.id || "unknown";
    const smsLockId = await acquireLock({
      leadId: req.params.id,
      acquiredByType: "manual_user",
      acquiredById: String(userId),
      channel: "sms",
      reason: "Manual SMS from deal detail",
      durationMinutes: 5,
    });
    if (!smsLockId) {
      return res.status(409).json({
        error: "Lead is currently engaged on another channel. Try again in a few minutes.",
      });
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
        organizationId: getOrgId(req),
        vobData: null,
        notes: null,
        channel: "sms",
      });

      // Log SMS sent activity
      await storage.createActivityLog({
        leadId: req.params.id,
        activityType: "sms_sent",
        description: `SMS sent: "${template || "custom message"}"`,
        organizationId: getOrgId(req),
        metadata: { 
          messageSid: twilioMessage.sid,
          template: template || null,
          toPhone: lead.phone,
        },
        performedBy: "user",
      });

      await releaseLock(smsLockId).catch(() => {});
      res.json({
        success: true,
        messageSid: twilioMessage.sid,
        status: twilioMessage.status,
        callId: smsRecord.id,
      });
    } catch (error: any) {
      console.error("Twilio SMS error:", error);
      await releaseLock(smsLockId).catch(() => {});
      res.status(500).json({ error: error.message || "Failed to send SMS" });
    }
  });

  // Get SMS templates
  app.get("/api/sms/templates", requireRole("admin", "intake"), async (req, res) => {
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
    const leads = await storage.getLeads(getOrgId(req));
    const normalizedFrom = From.replace(/\D/g, "").slice(-10);
    const matchingLead = leads.find(l => {
      if (!l.phone) return false;
      const normalizedLeadPhone = l.phone.replace(/\D/g, "").slice(-10);
      return normalizedLeadPhone === normalizedFrom;
    });

    if (matchingLead) {
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
        organizationId: matchingLead.organizationId || undefined,
        channel: "sms",
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
  app.get("/api/sms/status", requireRole("admin", "intake"), async (req, res) => {
    res.json({
      configured: !!twilioClient,
      phoneNumber: twilioPhoneNumber ? twilioPhoneNumber.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3") : null,
    });
  });

  // Inbound SMS from Twilio — pauses active flow runs for the lead
  app.post("/api/twilio/inbound", async (req, res) => {
    try {
      const { pool } = await import("./db");
      const { From, Body } = req.body;
      if (!From) return res.status(200).end();

      // Find lead by phone
      const normalizedFrom = From.replace(/\D/g, "").slice(-10);
      const leadResult = await pool.query(
        `SELECT id, organization_id FROM leads WHERE REGEXP_REPLACE(phone, '[^0-9]', '', 'g') LIKE $1 LIMIT 1`,
        [`%${normalizedFrom}`]
      );
      if (!leadResult.rows.length) return res.status(200).end();

      const leadRow = leadResult.rows[0];

      // Acquire a long-duration lock to pause all flows for this lead
      await acquireLock({
        leadId: leadRow.id,
        acquiredByType: "inbound_response",
        acquiredById: `sms_${Date.now()}`,
        channel: "any",
        reason: `Inbound SMS: ${(Body || "").slice(0, 80)}`,
        durationMinutes: 240,
      });

      // Pause all running flow_runs for this lead
      await pool.query(
        `UPDATE flow_runs SET status = 'paused', updated_at = NOW()
         WHERE lead_id = $1 AND status = 'running'`,
        [leadRow.id]
      );

      // Log the inbound SMS
      await pool.query(
        `INSERT INTO activity_logs (lead_id, activity_type, description, created_at, organization_id)
         VALUES ($1, 'sms_inbound', $2, NOW(), $3)`,
        [leadRow.id, `Inbound SMS: ${(Body || "").slice(0, 200)}`, leadRow.organization_id]
      );

      console.log(`[twilio/inbound] Paused flows for lead ${leadRow.id} due to inbound SMS from ${From}`);
      res.status(200).end();
    } catch (err) {
      console.error("[twilio/inbound] error:", err);
      res.status(200).end();
    }
  });

  // ==================== EMAIL AUTOMATION ====================

  // Get all email templates
  app.get("/api/email-templates", requireRole("admin", "intake"), async (req, res) => {
    const templates = await storage.getEmailTemplates(getOrgId(req));
    res.json(templates);
  });

  // Create email template
  app.post("/api/email-templates", requireRole("admin", "intake"), async (req, res) => {
    const result = insertEmailTemplateSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: result.error.flatten() });
    }
    const template = await storage.createEmailTemplate({ ...result.data, organizationId: getOrgId(req) });
    res.json(template);
  });

  // Update email template
  app.patch("/api/email-templates/:id", requireRole("admin", "intake"), async (req, res) => {
    const existing = await storage.getEmailTemplate(req.params.id);
    if (!existing || !verifyOrg(existing, req)) {
      return res.status(404).json({ error: "Template not found" });
    }
    const template = await storage.updateEmailTemplate(req.params.id, req.body);
    res.json(template);
  });

  app.delete("/api/email-templates/:id", requireRole("admin", "intake"), async (req, res) => {
    const existing = await storage.getEmailTemplate(req.params.id);
    if (!existing || !verifyOrg(existing, req)) {
      return res.status(404).json({ error: "Template not found" });
    }
    await storage.deleteEmailTemplate(req.params.id);
    res.status(204).send();
  });

  // Get all nurture sequences
  app.get("/api/nurture-sequences", requireRole("admin", "intake"), async (req, res) => {
    const sequences = await storage.getNurtureSequences(getOrgId(req));
    res.json(sequences);
  });

  // Create nurture sequence
  app.post("/api/nurture-sequences", requireRole("admin", "intake"), async (req, res) => {
    const result = insertNurtureSequenceSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: result.error.flatten() });
    }
    const sequence = await storage.createNurtureSequence({ ...result.data, organizationId: getOrgId(req) });
    res.json(sequence);
  });

  // Update nurture sequence
  app.patch("/api/nurture-sequences/:id", requireRole("admin", "intake"), async (req, res) => {
    const existing = await storage.getNurtureSequence(req.params.id);
    if (!existing || !verifyOrg(existing, req)) {
      return res.status(404).json({ error: "Sequence not found" });
    }
    const sequence = await storage.updateNurtureSequence(req.params.id, req.body);
    res.json(sequence);
  });

  app.delete("/api/nurture-sequences/:id", requireRole("admin", "intake"), async (req, res) => {
    const existing = await storage.getNurtureSequence(req.params.id);
    if (!existing || !verifyOrg(existing, req)) {
      return res.status(404).json({ error: "Sequence not found" });
    }
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
  app.post("/api/leads/:id/email", requireRole("admin", "intake"), async (req, res) => {
    const lead = await storage.getLead(req.params.id);
    if (!lead || !verifyOrg(lead, req)) {
      return res.status(404).json({ error: "Lead not found" });
    }

    if (!lead.email) {
      return res.status(400).json({ error: "Lead has no email address" });
    }

    // Acquire comm lock — block if lead is engaged by an active flow
    const emailUserId = (req.user as any)?.id || "unknown";
    const emailLockId = await acquireLock({
      leadId: req.params.id,
      acquiredByType: "manual_user",
      acquiredById: String(emailUserId),
      channel: "email",
      reason: "Manual email from deal detail",
      durationMinutes: 5,
    });
    if (!emailLockId) {
      return res.status(409).json({
        error: "Lead is currently engaged on another channel. Try again in a few minutes.",
      });
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

    // Fetch org practice name for template substitution
    const emailOrgId = getOrgId(req);
    let facilityName = "Claim Shield Health";
    if (emailOrgId) {
      try {
        const { pool: emailPool } = await import("./db");
        const { rows: psRows } = await emailPool.query(
          "SELECT practice_name FROM practice_settings WHERE organization_id = $1 LIMIT 1",
          [emailOrgId]
        );
        if (psRows[0]?.practice_name) facilityName = psRows[0].practice_name;
      } catch { /* use default */ }
    }
    // Replace template variables
    const variables: Record<string, string> = {
      first_name: lead.firstName || lead.name.split(" ")[0] || "there",
      last_name: lead.lastName || lead.name.split(" ").slice(1).join(" ") || "",
      full_name: lead.name,
      service_needed: lead.serviceNeeded || "your care",
      facility_name: facilityName,
      insurance_carrier: lead.insuranceCarrier || "your insurance",
      appointment_date: "",
      appointment_time: "",
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
      organizationId: getOrgId(req),
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
      organizationId: getOrgId(req),
      metadata: { 
        emailLogId: emailLog.id, 
        subject: emailSubject,
        toEmail: lead.email,
      },
      performedBy: "user",
    });

    await releaseLock(emailLockId).catch(() => {});
    res.json({ success: true, emailLogId: emailLog.id });
  });

  // Get email logs for a lead
  app.get("/api/leads/:id/emails", requireRole("admin", "intake"), async (req, res) => {
    const emails = await storage.getEmailLogsByLeadId(req.params.id);
    res.json(emails);
  });

  // Get activity logs for a lead (HubSpot-style timeline)
  app.get("/api/leads/:id/activity", requireRole("admin", "intake"), async (req, res) => {
    const activities = await storage.getActivityLogsByLeadId(req.params.id);
    res.json(activities);
  });

  // Flow Inspector — get flow runs + events for a lead
  app.get("/api/leads/:id/flow-runs", requireRole("admin", "intake"), async (req, res) => {
    try {
      const { pool } = await import("./db");
      const runsResult = await pool.query(
        `SELECT
           fr.id, fr.status, fr.current_step_index, fr.next_action_at,
           fr.started_at, fr.completed_at, fr.created_at,
           fr.attempt_count, fr.failure_reason,
           f.name AS flow_name,
           fs.step_type AS current_step_label
         FROM flow_runs fr
         JOIN flows f ON f.id = fr.flow_id
         LEFT JOIN LATERAL (
           SELECT step_type FROM flow_steps
           WHERE flow_id = fr.flow_id
           ORDER BY step_order ASC
           LIMIT 1 OFFSET fr.current_step_index
         ) fs ON true
         WHERE fr.lead_id = $1
         ORDER BY fr.created_at DESC`,
        [req.params.id]
      );

      const runIds = runsResult.rows.map((r: any) => r.id);

      let eventsMap: Record<string, any[]> = {};
      if (runIds.length > 0) {
        const eventsResult = await pool.query(
          `SELECT * FROM flow_run_events
           WHERE flow_run_id = ANY($1::text[])
           ORDER BY created_at ASC`,
          [runIds]
        );
        for (const ev of eventsResult.rows) {
          if (!eventsMap[ev.flow_run_id]) eventsMap[ev.flow_run_id] = [];
          eventsMap[ev.flow_run_id].push(ev);
        }
      }

      const result = runsResult.rows.map((run: any) => ({
        ...run,
        events: eventsMap[run.id] || [],
      }));

      res.json(result);
    } catch (err) {
      console.error("[flow-runs] error:", err);
      res.status(500).json({ error: "Failed to fetch flow runs" });
    }
  });

  // POST /api/flow-runs/:id/retry — reset a failed flow run so it picks up again
  app.post("/api/flow-runs/:id/retry", requireRole("admin", "intake"), async (req, res) => {
    try {
      const { pool } = await import("./db");
      const { id } = req.params;

      const existing = await pool.query(
        `SELECT id, status FROM flow_runs WHERE id = $1`,
        [id]
      );
      if (!existing.rows.length) {
        return res.status(404).json({ error: "Flow run not found" });
      }
      if (existing.rows[0].status !== "failed") {
        return res.status(409).json({ error: "Flow run is not in failed state" });
      }

      await pool.query(
        `UPDATE flow_runs
         SET status = 'running', attempt_count = 0, failure_reason = NULL,
             next_action_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [id]
      );

      const { logFlowEvent } = await import("./services/flow-events");
      await logFlowEvent(id, "flow_retried", {
        message: "Flow run retried manually — attempt_count reset",
      });

      res.json({ ok: true });
    } catch (err) {
      console.error("[flow-runs/retry] error:", err);
      res.status(500).json({ error: "Failed to retry flow run" });
    }
  });

  // POST /api/leads/:id/trigger-flow — manually enroll a lead into matching flows
  app.post("/api/leads/:id/trigger-flow", requireRole("admin", "intake"), async (req, res) => {
    try {
      const { pool } = await import("./db");
      const leadId = req.params.id;
      const lead = await storage.getLead(leadId);
      if (!lead) return res.status(404).json({ error: "Lead not found" });

      // Deduplication: block if an active run already exists for any flow on this lead
      const activeCheck = await pool.query(
        `SELECT id FROM flow_runs WHERE lead_id = $1 AND status = 'running' LIMIT 1`,
        [leadId]
      );
      if (activeCheck.rows.length > 0) {
        return res.status(409).json({
          error: "Lead is already enrolled in an active flow",
          flowRunId: activeCheck.rows[0].id,
        });
      }

      // Find all active flows — either match trigger conditions OR allow any if caller passes flowId
      const { flowId } = req.body as { flowId?: string };
      let flows;
      if (flowId) {
        flows = await pool.query(
          `SELECT id, name, trigger_conditions FROM flows WHERE id = $1 AND is_active = true`,
          [flowId]
        );
      } else {
        flows = await pool.query(
          `SELECT id, name, trigger_conditions FROM flows WHERE is_active = true`
        );
      }

      let enrolled = 0;
      for (const flow of flows.rows) {
        const firstStep = await pool.query(
          `SELECT delay_minutes FROM flow_steps WHERE flow_id = $1 ORDER BY step_order ASC LIMIT 1`,
          [flow.id]
        );
        const delayMs = ((firstStep.rows[0]?.delay_minutes) || 0) * 60 * 1000;
        const nextActionAt = new Date(Date.now() + delayMs);

        const runResult = await pool.query(
          `INSERT INTO flow_runs (flow_id, lead_id, status, current_step_index, next_action_at, organization_id)
           VALUES ($1, $2, 'running', 0, $3, $4) RETURNING id`,
          [flow.id, leadId, nextActionAt, (lead as any).organizationId || (lead as any).organization_id || null]
        );
        const { logFlowEvent } = await import("./services/flow-events");
        await logFlowEvent(runResult.rows[0].id, "flow_started", {
          message: `Flow '${flow.name}' manually started for lead ${leadId}`,
          leadId,
          flowId: flow.id,
          triggeredBy: "manual",
        });
        enrolled++;
      }

      if (enrolled === 0) {
        return res.status(404).json({ error: "No active flows found" });
      }

      res.json({ enrolled, message: `Lead enrolled in ${enrolled} flow(s)` });
    } catch (err) {
      console.error("[trigger-flow] error:", err);
      res.status(500).json({ error: "Failed to trigger flow" });
    }
  });

  // GET /api/flows — list flows (super_admin sees all; others see own org only)
  app.get("/api/flows", requireRole("admin", "intake", "super_admin"), async (req, res) => {
    try {
      const user = (req as any).user;
      const isSuperAdmin = user?.role === "super_admin";
      const orgId = isSuperAdmin ? null : requireOrgCtx(req, res);
      if (!isSuperAdmin && !orgId) return;

      const { pool } = await import("./db");

      const whereClause = isSuperAdmin ? "" : "WHERE f.organization_id = $1";
      const params = isSuperAdmin ? [] : [orgId];

      const result = await pool.query(`
        SELECT
          f.id,
          f.name,
          f.description,
          f.trigger_event,
          f.trigger_conditions,
          f.is_active,
          f.organization_id,
          f.version,
          f.created_at,
          o.name AS org_name,
          (SELECT COUNT(*) FROM flow_steps WHERE flow_id = f.id)::int AS step_count,
          (SELECT COUNT(*) FROM flow_runs fr WHERE fr.flow_id = f.id AND fr.status = 'running')::int AS active_run_count,
          (SELECT COUNT(*) FROM flow_runs fr WHERE fr.flow_id = f.id AND fr.status = 'completed')::int AS completed_run_count
        FROM flows f
        LEFT JOIN organizations o ON o.id = f.organization_id
        ${whereClause}
        ORDER BY f.created_at DESC
      `, params);
      res.json(result.rows);
    } catch (err) {
      console.error("[GET /api/flows] error:", err);
      res.status(500).json({ error: "Failed to load flows" });
    }
  });

  // GET /api/flows/:id — full flow detail with steps and recent runs
  app.get("/api/flows/:id", requireRole("admin", "intake"), async (req, res) => {
    try {
      const { pool } = await import("./db");
      const flow = await pool.query(`SELECT * FROM flows WHERE id = $1`, [req.params.id]);
      if (!flow.rows[0]) return res.status(404).json({ error: "Flow not found" });

      const steps = await pool.query(
        `SELECT * FROM flow_steps WHERE flow_id = $1 ORDER BY step_order ASC`,
        [req.params.id]
      );

      const recentRuns = await pool.query(`
        SELECT
          fr.id,
          fr.lead_id,
          fr.status,
          fr.started_at,
          fr.next_action_at,
          fr.completed_at,
          l.name AS lead_name,
          l.phone AS lead_phone,
          fs.step_order AS current_step_order,
          fs.step_type AS current_step_type
        FROM flow_runs fr
        LEFT JOIN leads l ON l.id = fr.lead_id
        LEFT JOIN LATERAL (
          SELECT step_order, step_type FROM flow_steps
          WHERE flow_id = fr.flow_id
          ORDER BY step_order ASC
          LIMIT 1 OFFSET fr.current_step_index
        ) fs ON true
        WHERE fr.flow_id = $1
        ORDER BY fr.started_at DESC
        LIMIT 25
      `, [req.params.id]);

      res.json({
        flow: flow.rows[0],
        steps: steps.rows,
        recent_runs: recentRuns.rows,
      });
    } catch (err) {
      console.error("[GET /api/flows/:id] error:", err);
      res.status(500).json({ error: "Failed to load flow detail" });
    }
  });

  // GET /api/orgs/:slug/service-types — returns service type options for an org from org_service_types table
  app.get("/api/orgs/:slug/service-types", requireAuth, async (req, res) => {
    try {
      const { pool } = await import("./db");
      const orgId = req.params.slug;
      const result = await pool.query(
        `SELECT service_code AS slug, service_name AS label, description
         FROM org_service_types
         WHERE organization_id = $1 AND is_active = true
         ORDER BY service_name ASC`,
        [orgId]
      );
      res.json(result.rows);
    } catch (err) {
      console.error("[GET /api/orgs/:slug/service-types] error:", err);
      res.status(500).json({ error: "Failed to load service types" });
    }
  });

  // GET /api/orgs/:slug/lead-sources — returns lead source options for an org from org_lead_sources table
  app.get("/api/orgs/:slug/lead-sources", requireAuth, async (req, res) => {
    try {
      const { pool } = await import("./db");
      const orgId = req.params.slug;
      const result = await pool.query(
        `SELECT slug, label, source_type
         FROM org_lead_sources
         WHERE organization_id = $1 AND is_active = true
         ORDER BY label ASC`,
        [orgId]
      );
      res.json(result.rows);
    } catch (err) {
      console.error("[GET /api/orgs/:slug/lead-sources] error:", err);
      res.status(500).json({ error: "Failed to load lead sources" });
    }
  });

  // GET /api/flow-runs/active — all currently running flow_runs across all flows
  app.get("/api/flow-runs/active", requireRole("admin", "intake"), async (req, res) => {
    try {
      const orgId = requireOrgCtx(req, res);
      if (!orgId) return;
      const { pool } = await import("./db");
      const result = await pool.query(`
        SELECT
          fr.id,
          fr.flow_id,
          fr.lead_id,
          fr.status,
          fr.started_at,
          fr.next_action_at,
          f.name AS flow_name,
          l.name AS lead_name,
          l.phone AS lead_phone,
          l.insurance_carrier,
          l.vob_score,
          fs.step_order AS current_step_order,
          fs.step_type AS current_step_type,
          fs.channel AS current_step_channel,
          (SELECT COUNT(*) FROM flow_steps WHERE flow_id = fr.flow_id)::int AS total_steps
        FROM flow_runs fr
        LEFT JOIN flows f ON f.id = fr.flow_id
        LEFT JOIN leads l ON l.id = fr.lead_id
        LEFT JOIN LATERAL (
          SELECT step_order, step_type, channel FROM flow_steps
          WHERE flow_id = fr.flow_id
          ORDER BY step_order ASC
          LIMIT 1 OFFSET fr.current_step_index
        ) fs ON true
        WHERE fr.status = 'running'
          AND l.organization_id = $1
        ORDER BY fr.next_action_at ASC
        LIMIT 100
      `, [orgId]);
      res.json(result.rows);
    } catch (err) {
      console.error("[GET /api/flow-runs/active] error:", err);
      res.status(500).json({ error: "Failed to load active runs" });
    }
  });

  // Get email configuration status
  app.get("/api/email/status", requireRole("admin", "intake"), async (req, res) => {
    res.json({
      configured: !!emailTransporter,
      fromEmail: fromEmail,
    });
  });

  // Send confirmation email after chat widget submission
  app.post("/api/leads/:id/send-confirmation", requireRole("admin", "intake"), async (req, res) => {
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
        organizationId: getOrgId(req),
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
  app.get("/api/email/presets", requireRole("admin", "intake"), async (req, res) => {
    const presets = Object.entries(emailPresets).map(([id, template]) => ({
      id,
      name: id.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      subject: template.subject,
    }));
    res.json(presets);
  });

  // ==================== APPOINTMENT SCHEDULING ====================

  // Get all availability slots
  app.get("/api/availability", requireRole("admin", "intake"), async (req, res) => {
    const slots = await storage.getAvailabilitySlots(getOrgId(req));
    res.json(slots);
  });

  // Create availability slot
  app.post("/api/availability", requireRole("admin", "intake"), async (req, res) => {
    const result = insertAvailabilitySlotSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: result.error.flatten() });
    }
    const slot = await storage.createAvailabilitySlot({ ...result.data, organizationId: getOrgId(req) });
    res.json(slot);
  });

  // Update availability slot
  app.patch("/api/availability/:id", requireRole("admin", "intake"), async (req, res) => {
    const existing = await storage.getAvailabilitySlot(req.params.id);
    if (!existing || !verifyOrg(existing, req)) {
      return res.status(404).json({ error: "Slot not found" });
    }
    const slot = await storage.updateAvailabilitySlot(req.params.id, req.body);
    res.json(slot);
  });

  app.delete("/api/availability/:id", requireRole("admin", "intake"), async (req, res) => {
    const existing = await storage.getAvailabilitySlot(req.params.id);
    if (!existing || !verifyOrg(existing, req)) {
      return res.status(404).json({ error: "Slot not found" });
    }
    await storage.deleteAvailabilitySlot(req.params.id);
    res.status(204).send();
  });

  // Get all appointments
  app.get("/api/appointments", requireRole("admin", "intake"), async (req, res) => {
    const appointments = await storage.getAppointments(getOrgId(req));
    res.json(appointments);
  });

  // Get appointments for a lead
  app.get("/api/leads/:id/appointments", requireRole("admin", "intake"), async (req, res) => {
    const lead = await storage.getLead(req.params.id);
    if (!lead || !verifyOrg(lead, req)) return res.status(404).json({ error: "Lead not found" });
    const appointments = await storage.getAppointmentsByLeadId(req.params.id);
    res.json(appointments);
  });

  // Create appointment for a lead
  app.post("/api/leads/:id/appointments", requireRole("admin", "intake"), async (req, res) => {
    const lead = await storage.getLead(req.params.id);
    if (!lead || !verifyOrg(lead, req)) {
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

    const appointment = await storage.createAppointment({ ...result.data, organizationId: getOrgId(req) });

    // Update lead with next action
    await storage.updateLead(lead.id, {
      nextAction: `Appointment scheduled: ${new Date(appointment.scheduledAt).toLocaleDateString()}`,
      nextActionType: "appointment",
      nextActionAt: appointment.scheduledAt,
    });

    res.json(appointment);
  });

  // Update appointment
  app.patch("/api/appointments/:id", requireRole("admin", "intake"), async (req, res) => {
    const existing = await storage.getAppointment(req.params.id);
    if (!existing || !verifyOrg(existing, req)) {
      return res.status(404).json({ error: "Appointment not found" });
    }
    const appointment = await storage.updateAppointment(req.params.id, req.body);
    res.json(appointment);
  });

  app.post("/api/appointments/:id/cancel", requireRole("admin", "intake"), async (req, res) => {
    const existing = await storage.getAppointment(req.params.id);
    if (!existing || !verifyOrg(existing, req)) {
      return res.status(404).json({ error: "Appointment not found" });
    }
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
  app.post("/api/appointments/:id/confirm", requireRole("admin", "intake"), async (req, res) => {
    const existing = await storage.getAppointment(req.params.id);
    if (!existing || !verifyOrg(existing, req)) {
      return res.status(404).json({ error: "Appointment not found" });
    }
    const appointment = await storage.updateAppointment(req.params.id, {
      status: "confirmed",
      confirmedAt: new Date(),
    });
    res.json(appointment);
  });

  // Get available time slots for a specific date
  app.get("/api/availability/slots", requireRole("admin", "intake"), async (req, res) => {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ error: "Date required" });
    }

    const requestedDate = new Date(date as string);
    const dayOfWeek = requestedDate.getDay();
    
    // Get availability for this day
    const allSlots = await storage.getAvailabilitySlots(getOrgId(req));
    const daySlots = allSlots.filter(s => s.dayOfWeek === dayOfWeek && s.enabled);

    if (daySlots.length === 0) {
      return res.json([]);
    }

    // Get existing appointments for this date
    const allAppointments = await storage.getAppointments(getOrgId(req));
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
  app.post("/api/availability/seed", requireRole("admin", "intake"), async (req, res) => {
    const existing = await storage.getAvailabilitySlots(getOrgId(req));
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
        organizationId: getOrgId(req),
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
                    
                    <a href="${process.env.PUBLIC_URL || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : 'http://localhost:5000')}/leads/${lead.id}" class="btn">View Conversation</a>
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
  app.get("/api/chat-analytics/stats", requireRole("admin", "intake"), async (req, res) => {
    const orgId = requireOrgCtx(req, res);
    if (!orgId) return;
    const stats = await storage.getChatSessionStats(orgId);
    res.json(stats);
  });

  // Get call analytics stats
  app.get("/api/calls-analytics/stats", requireRole("admin", "intake"), async (req, res) => {
    const emptyStats = {
      totalCalls: 0,
      answeredCalls: 0,
      missedCalls: 0,
      voicemailCalls: 0,
      avgDuration: 0,
      answeredRate: 0,
      missedRate: 0,
      voicemailRate: 0,
    };
    try {
      const orgId = requireOrgCtx(req, res);
      if (!orgId) return;
      const db = await import("./db").then(m => m.pool);
      const { rows } = await db.query(`
        SELECT
          COUNT(c.id)::int AS "totalCalls",
          COUNT(CASE WHEN c.disposition = 'completed' THEN 1 END)::int AS "answeredCalls",
          COUNT(CASE WHEN c.disposition IN ('no-answer', 'no_answer', 'customer-did-not-answer') THEN 1 END)::int AS "missedCalls",
          COUNT(CASE WHEN c.disposition IN ('voicemail', 'left_voicemail', 'left-voicemail') THEN 1 END)::int AS "voicemailCalls",
          COALESCE(ROUND(AVG(c.duration))::int, 0) AS "avgDuration",
          COALESCE(SUM(COALESCE(c.duration, 0))::int, 0) AS "totalDuration"
        FROM calls c
        LEFT JOIN leads l ON l.id = c.lead_id
        WHERE l.organization_id = $1
      `, [orgId]);
      const stats = rows[0];
      const totalCalls = stats.totalCalls || 0;
      const answeredRate = totalCalls > 0 ? Math.round((stats.answeredCalls / totalCalls) * 100) : 0;
      const missedRate = totalCalls > 0 ? Math.round((stats.missedCalls / totalCalls) * 100) : 0;
      const voicemailRate = totalCalls > 0 ? Math.round((stats.voicemailCalls / totalCalls) * 100) : 0;

      res.json({
        totalCalls,
        answeredCalls: stats.answeredCalls || 0,
        missedCalls: stats.missedCalls || 0,
        voicemailCalls: stats.voicemailCalls || 0,
        avgDuration: stats.avgDuration || 0,
        answeredRate,
        missedRate,
        voicemailRate,
      });
    } catch (error) {
      console.error("Error getting call stats:", error);
      res.json(emptyStats);
    }
  });

  // Get time-series data for charts
  app.get("/api/chat-analytics/timeseries", requireRole("admin", "intake"), async (req, res) => {
    const { days = "30" } = req.query;
    const numDays = parseInt(days as string) || 30;
    
    const sessions = await storage.getChatSessions(getOrgId(req));
    const leads = await storage.getLeads(getOrgId(req));
    
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
  app.get("/api/chat-sessions", requireRole("admin", "intake"), async (req, res) => {
    const sessions = await storage.getChatSessions(getOrgId(req));
    res.json(sessions);
  });

  // Get session with messages
  app.get("/api/chat-sessions/:id", requireRole("admin", "intake"), async (req, res) => {
    const session = await storage.getChatSession(req.params.id);
    if (!session || !verifyOrg(session, req)) {
      return res.status(404).json({ error: "Session not found" });
    }
    const messages = await storage.getChatMessagesBySessionId(session.id);
    res.json({ session, messages });
  });

  app.get("/api/chat-analytics", requireRole("admin", "intake"), async (req, res) => {
    const { startDate, endDate } = req.query;
    const analytics = await storage.getChatAnalytics(
      startDate as string | undefined,
      endDate as string | undefined,
      getOrgId(req)
    );
    res.json(analytics);
  });

  // ============ VOB VERIFICATION (VerifyTX) ============
  
  // Search payers (requires at least 2 characters)
  app.get("/api/verifytx/payers", requireRole("admin", "intake"), async (req, res) => {
    const { getVerifyTxClient } = await import("./verifytx");
    const client = getVerifyTxClient();
    
    if (!client) {
      return res.status(503).json({ 
        error: "VerifyTX not configured", 
        message: "VerifyTX API credentials are not set up. Please configure VERIFYTX_API_KEY and VERIFYTX_API_SECRET." 
      });
    }

    try {
      const query = req.query.q as string | undefined;
      if (!query || query.length < 2) {
        return res.status(400).json({ error: "Search query must be at least 2 characters" });
      }
      const payers = await client.searchPayers(query);
      
      // Transform to frontend-expected format (id, name instead of payer_id, payer_name)
      const transformedPayers = payers.map(p => ({
        id: p.payer_id,
        name: p.payer_name,
        type: p.featured ? "featured" : undefined,
      }));
      
      res.json(transformedPayers);
    } catch (error: any) {
      console.error("VerifyTX payer search error:", error);
      res.status(500).json({ error: "Failed to search payers", message: error.message });
    }
  });

  // Get VOB verifications for a lead
  app.get("/api/leads/:id/vob-verifications", requireRole("admin", "intake"), async (req, res) => {
    const verifications = await storage.getVobVerificationsByLeadId(req.params.id);
    res.json(verifications);
  });

  // Get latest VOB verification for a lead
  app.get("/api/leads/:id/vob-verifications/latest", requireRole("admin", "intake"), async (req, res) => {
    const verification = await storage.getLatestVobVerificationByLeadId(req.params.id);
    res.json(verification || null);
  });

  // Verify insurance benefits for a lead
  app.post("/api/leads/:id/verify-insurance", requireRole("admin", "intake"), async (req, res) => {
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
        organizationId: getOrgId(req),
      });

      await storage.updateLead(leadId, { vobStatus: "in_progress" });
      await storage.createActivityLog({
        leadId,
        activityType: "vob_started",
        description: `VOB verification started with ${payerName}`,
        performedBy: "system",
        organizationId: getOrgId(req),
        metadata: { payerId, payerName, memberId },
      });

      // ── Try Stedi as primary VOB engine ─────────────────────────────────────
      const { checkEligibility: stediCheck, isStediConfigured: stediOk } = await import("./services/stedi-eligibility");
      
      if (stediOk() && memberId && dateOfBirth) {
        try {
          const settingsResult = await pool.query(`SELECT primary_npi, practice_name FROM practice_settings LIMIT 1`);
          const providerNpi = settingsResult.rows[0]?.primary_npi || "1234567890";
          const providerName = settingsResult.rows[0]?.practice_name || "ClaimShield Practice";

          const stediResult = await stediCheck({
            controlNumber: String(Math.floor(Math.random() * 900000000) + 100000000),
            tradingPartnerServiceId: payerId,
            providerNpi,
            providerName,
            subscriberFirstName: firstName,
            subscriberLastName: lastName,
            subscriberDob: dateOfBirth,
            subscriberMemberId: memberId,
            serviceTypeCodes: ["MH", "30"],
          });

          const isActive = stediResult.status === "active";
          const stediMapped: any = {
            status: isActive ? "verified" : "incomplete",
            policyStatus: stediResult.policyStatus,
            planName: stediResult.planName,
            effectiveDate: stediResult.effectiveDate ? new Date(stediResult.effectiveDate) : null,
            termDate: stediResult.termDate ? new Date(stediResult.termDate) : null,
            copay: stediResult.copay,
            deductible: stediResult.deductible,
            deductibleMet: stediResult.deductibleMet,
            coinsurance: stediResult.coinsurance,
            outOfPocketMax: stediResult.outOfPocketMax,
            networkStatus: stediResult.networkStatus,
            rawResponse: stediResult.rawResponse,
            verifiedAt: new Date(),
            source: "stedi",
          };

          const updatedVerification = await storage.updateVobVerification(pendingVerification.id, stediMapped);

          await storage.updateLead(leadId, {
            vobStatus: isActive ? "verified" : "incomplete",
            vobScore: isActive ? 100 : 25,
            insuranceCarrier: payerName,
          });

          await storage.createActivityLog({
            leadId,
            activityType: "vob_completed",
            description: `VOB via Stedi: ${stediResult.status} — ${stediResult.planName || payerName}`,
            performedBy: "system",
            organizationId: getOrgId(req),
            metadata: { source: "stedi", status: stediResult.status, planName: stediResult.planName },
          });

          return res.json(updatedVerification);
        } catch (stediErr: any) {
          console.warn(`[verify-insurance] Stedi check failed (${stediErr.message}), falling back to VerifyTX`);
        }
      }

      // ── Fall back to VerifyTX ────────────────────────────────────────────────
      const { getVerifyTxClient, mapVerifyTxResponse } = await import("./verifytx");
      const client = getVerifyTxClient();

      if (!client) {
        await storage.updateVobVerification(pendingVerification.id, { status: "incomplete" });
        await storage.updateLead(leadId, { vobStatus: "incomplete" });
        return res.status(503).json({
          error: "No VOB engine configured",
          message: "Neither Stedi nor VerifyTX is configured. Please set STEDI_API_KEY or VerifyTX credentials.",
        });
      }

      const response = await client.createVob({
        firstName,
        lastName,
        dateOfBirth,
        memberId,
        payerId,
        payerName,
        phone: lead.phone || undefined,
        email: lead.email || undefined,
      });

      const mappedData = mapVerifyTxResponse(response, { payerId, payerName, memberId });
      const updatedVerification = await storage.updateVobVerification(pendingVerification.id, {
        ...mappedData,
        verifiedAt: new Date(),
      });

      const vobStatus = mappedData.status === "verified" ? "verified" :
                        mappedData.status === "error" ? "incomplete" : "in_progress";

      await storage.updateLead(leadId, {
        vobStatus,
        vobScore: mappedData.status === "verified" ? 100 : 0,
        insuranceCarrier: payerName,
      });

      await storage.createActivityLog({
        leadId,
        activityType: "vob_completed",
        description: `VOB via VerifyTX: ${mappedData.status === "verified" ? "completed" : "failed"}`,
        performedBy: "system",
        organizationId: getOrgId(req),
        metadata: { source: "verifytx", payerId, payerName, status: mappedData.status },
      });

      res.json(updatedVerification);
    } catch (error: any) {
      console.error("verify-insurance error:", error);
      await storage.updateLead(leadId, { vobStatus: "incomplete" }).catch(() => {});
      await storage.createActivityLog({
        leadId,
        activityType: "vob_failed",
        description: `VOB verification failed: ${error.message}`,
        performedBy: "system",
        organizationId: getOrgId(req),
        metadata: { error: error.message },
      });
      res.status(500).json({ error: "Verification failed", message: error.message });
    }
  });

  // Re-verify existing VOB
  app.post("/api/vob-verifications/:id/reverify", requireRole("admin", "intake"), async (req, res) => {
    const { getVerifyTxClient, mapVerifyTxResponse } = await import("./verifytx");
    const client = getVerifyTxClient();
    
    if (!client) {
      return res.status(503).json({ 
        error: "VerifyTX not configured", 
        message: "VerifyTX API credentials are not set up." 
      });
    }

    const verification = await storage.getVobVerification(req.params.id);
    
    if (!verification || !verifyOrg(verification, req)) {
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
  app.get("/api/vob-verifications/:id/pdf", requireRole("admin", "intake"), async (req, res) => {
    const { getVerifyTxClient } = await import("./verifytx");
    const client = getVerifyTxClient();
    
    if (!client) {
      return res.status(503).json({ error: "VerifyTX not configured" });
    }

    const verification = await storage.getVobVerification(req.params.id);
    
    if (!verification || !verifyOrg(verification, req)) {
      return res.status(404).json({ error: "VOB verification not found" });
    }

    if (!verification.verifytxVobId) {
      return res.status(400).json({ error: "Cannot export - no VerifyTX VOB ID" });
    }

    try {
      const result = await client.exportPdf(verification.verifytxVobId);
      
      // Handle different response formats (url or data)
      const pdfUrl = result.url || result.data;
      
      // Update record with PDF URL
      if (pdfUrl) {
        await storage.updateVobVerification(verification.id, {
          pdfUrl,
        });
      }
      
      res.json({ pdfUrl });
    } catch (error: any) {
      console.error("VerifyTX PDF export error:", error);
      res.status(500).json({ error: "PDF export failed", message: error.message });
    }
  });

  // Check VerifyTX configuration status
  // ── Stedi intake-facing endpoints ─────────────────────────────────────────
  app.get("/api/stedi/status", requireRole("admin", "intake"), async (_req, res) => {
    const { isStediConfigured } = await import("./services/stedi-eligibility");
    res.json({
      configured: isStediConfigured(),
      message: isStediConfigured() ? "Stedi is configured and ready" : "Stedi API key not set",
    });
  });

  // Static payer list derived from Stedi trading-partner registry
  const STEDI_PAYERS = [
    { id: "SX113",  name: "Aetna" },
    { id: "62308",  name: "Cigna" },
    { id: "61101",  name: "Humana" },
    { id: "00630",  name: "BCBS / BlueCross BlueShield" },
    { id: "87726",  name: "UnitedHealthcare (UHC)" },
    { id: "00630",  name: "Anthem" },
    { id: "MOLIN",  name: "Molina Healthcare" },
    { id: "00010",  name: "Medicare" },
    { id: "77350",  name: "Medicaid" },
    { id: "39026",  name: "Magellan Health" },
    { id: "SX107",  name: "Centene / WellCare" },
    { id: "95567",  name: "Optum / OptumHealth" },
    { id: "25133",  name: "Ambetter" },
    { id: "68069",  name: "Caresource" },
    { id: "37602",  name: "Community Health Plan" },
    { id: "91131",  name: "HealthFirst" },
    { id: "77013",  name: "Tricare / Champus" },
    { id: "31114",  name: "Oscar Health" },
    { id: "34196",  name: "Florida Blue" },
    { id: "91617",  name: "Kaiser Permanente" },
  ];

  app.get("/api/stedi/payers", requireRole("admin", "intake"), (req, res) => {
    const q = ((req.query.q as string) || "").toLowerCase().trim();
    if (q.length < 2) return res.status(400).json({ error: "Query must be at least 2 characters" });
    const matches = STEDI_PAYERS.filter(p => p.name.toLowerCase().includes(q));
    res.json(matches);
  });

  app.get("/api/verifytx/status", requireRole("admin", "intake"), async (req, res) => {
    const { getVerifyTxClient } = await import("./verifytx");
    const client = getVerifyTxClient();
    res.json({ 
      configured: !!client,
      message: client ? "VerifyTX is configured and ready" : "VerifyTX credentials not set"
    });
  });

  // ── Super Admin Routes ─────────────────────────────────────────────────
  app.get("/api/super-admin/vitals", requireSuperAdmin, async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const [orgs, claims, eras, users, recentClaims] = await Promise.all([
        db.query("SELECT COUNT(*)::int as cnt FROM organizations"),
        db.query("SELECT COUNT(*)::int as cnt FROM claims"),
        db.query("SELECT COUNT(*)::int as cnt FROM era_batches"),
        db.query("SELECT COUNT(*)::int as cnt FROM users WHERE role != 'super_admin'"),
        db.query("SELECT COUNT(*)::int as cnt FROM claims WHERE created_at > NOW() - INTERVAL '7 days'"),
      ]);
      res.json({
        totalOrgs: orgs.rows[0].cnt,
        totalClaims: claims.rows[0].cnt,
        totalEras: eras.rows[0].cnt,
        totalUsers: users.rows[0].cnt,
        claimsLast7Days: recentClaims.rows[0].cnt,
      });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/super-admin/orgs", requireSuperAdmin, async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const { rows: orgs } = await db.query(`
        SELECT
          o.id, o.name, o.created_at,
          (SELECT COUNT(*)::int FROM users u WHERE u.organization_id = o.id) as user_count,
          (SELECT COUNT(*)::int FROM claims c WHERE c.organization_id = o.id) as total_claims,
          (SELECT COUNT(*)::int FROM claims c WHERE c.organization_id = o.id AND c.created_at > NOW() - INTERVAL '30 days') as claims_last_30d,
          (SELECT COUNT(*)::int FROM leads l WHERE l.organization_id = o.id) as total_leads,
          (SELECT o2.onboarding_dismissed_at FROM organizations o2 WHERE o2.id = o.id) as onboarding_dismissed_at
        FROM organizations o
        ORDER BY o.created_at DESC
      `);

      const orgIds = orgs.map((o: any) => o.id);
      const onboardingSteps: Record<string, number> = {};
      for (const orgId of orgIds) {
        const [ps, prov, payer, claim] = await Promise.all([
          db.query("SELECT practice_name, phone, default_pos FROM practice_settings WHERE organization_id = $1 LIMIT 1", [orgId]),
          db.query("SELECT COUNT(*)::int as cnt FROM providers WHERE organization_id = $1", [orgId]),
          db.query("SELECT COUNT(*)::int as cnt FROM payers LIMIT 1"),
          db.query("SELECT COUNT(*)::int as cnt FROM claims WHERE organization_id = $1", [orgId]),
        ]);
        const psRow = ps.rows[0];
        let steps = 0;
        if (psRow?.practice_name && psRow?.phone) steps++;
        if ((prov.rows[0]?.cnt || 0) > 0) steps++;
        if ((payer.rows[0]?.cnt || 0) > 0) steps++;
        steps++; // OA — simplify to always-true for now since OA is global
        if (psRow?.default_pos) steps++;
        if ((claim.rows[0]?.cnt || 0) > 0) steps++;
        onboardingSteps[orgId] = steps;
      }

      const result = orgs.map((o: any) => ({
        ...o,
        onboarding_steps: onboardingSteps[o.id] || 0,
        has_billing: (o.total_claims || 0) > 0,
        has_intake: (o.total_leads || 0) > 0,
      }));
      res.json(result);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/super-admin/orgs/:orgId", requireSuperAdmin, async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const { orgId } = req.params;

      const [org, ps, users, providers, payers] = await Promise.all([
        db.query("SELECT * FROM organizations WHERE id = $1", [orgId]),
        db.query("SELECT * FROM practice_settings WHERE organization_id = $1 LIMIT 1", [orgId]),
        db.query("SELECT id, name, email, role, created_at, last_active_at FROM users WHERE organization_id = $1 ORDER BY name", [orgId]),
        db.query("SELECT COUNT(*)::int as cnt FROM providers WHERE organization_id = $1", [orgId]),
        db.query("SELECT COUNT(*)::int as cnt FROM payers"),
      ]);

      if (!org.rows[0]) return res.status(404).json({ error: "Organization not found" });

      // Feature usage (last 30 days)
      const [claimsCreated, claimsSubmitted, erasPosted, followupNotes, eligChecks] = await Promise.all([
        db.query("SELECT COUNT(*)::int as cnt FROM claims WHERE organization_id = $1 AND created_at > NOW() - INTERVAL '30 days'", [orgId]).catch(() => ({ rows: [{ cnt: 0 }] })),
        db.query("SELECT COUNT(*)::int as cnt FROM claim_events WHERE notes LIKE '%submitted%' AND timestamp > NOW() - INTERVAL '30 days'").catch(() => ({ rows: [{ cnt: 0 }] })),
        db.query("SELECT COUNT(*)::int as cnt FROM era_batches WHERE created_at > NOW() - INTERVAL '30 days'").catch(() => ({ rows: [{ cnt: 0 }] })),
        db.query("SELECT COUNT(*)::int as cnt FROM claim_follow_up_notes WHERE created_at > NOW() - INTERVAL '30 days'").catch(() => ({ rows: [{ cnt: 0 }] })),
        db.query("SELECT COUNT(*)::int as cnt FROM vob_verifications WHERE organization_id = $1 AND created_at > NOW() - INTERVAL '30 days'", [orgId]).catch(() => ({ rows: [{ cnt: 0 }] })),
      ]);

      // Friction feed
      const frictionItems: any[] = [];
      const [stuckDrafts, unpostedEras, overdueFollowups] = await Promise.all([
        db.query("SELECT id, created_at FROM claims WHERE organization_id = $1 AND status = 'draft' AND created_at < NOW() - INTERVAL '7 days'", [orgId]),
        db.query("SELECT COUNT(*)::int as cnt FROM era_batches WHERE status = 'pending' AND created_at < NOW() - INTERVAL '5 days'").catch(() => ({ rows: [{ cnt: 0 }] })),
        db.query("SELECT COUNT(*)::int as cnt FROM claims WHERE organization_id = $1 AND follow_up_date < NOW() - INTERVAL '14 days' AND status NOT IN ('paid', 'denied')", [orgId]).catch(() => ({ rows: [{ cnt: 0 }] })),
      ]);

      if ((stuckDrafts.rows || []).length > 0) {
        frictionItems.push({
          icon: "warning",
          description: `${stuckDrafts.rows.length} claim(s) stuck in Draft for more than 7 days`,
          ids: stuckDrafts.rows.map((r: any) => r.id),
          timestamp: stuckDrafts.rows[0]?.created_at,
        });
      }
      if ((unpostedEras.rows[0]?.cnt || 0) > 0) {
        frictionItems.push({
          icon: "error",
          description: `${unpostedEras.rows[0].cnt} ERA batch(es) received but not posted after 5 days`,
          timestamp: new Date().toISOString(),
        });
      }
      if ((overdueFollowups.rows[0]?.cnt || 0) > 0) {
        frictionItems.push({
          icon: "warning",
          description: `${overdueFollowups.rows[0].cnt} follow-up item(s) overdue by more than 14 days`,
          timestamp: new Date().toISOString(),
        });
      }

      res.json({
        org: org.rows[0],
        practiceSettings: ps.rows[0] || null,
        users: users.rows,
        providerCount: providers.rows[0]?.cnt || 0,
        payerCount: payers.rows[0]?.cnt || 0,
        stediConfigured: !!process.env.STEDI_API_KEY,
        featureUsage: {
          claimsCreated: claimsCreated.rows[0]?.cnt || 0,
          claimsSubmitted: claimsSubmitted.rows[0]?.cnt || 0,
          erasPosted: erasPosted.rows[0]?.cnt || 0,
          followupNotes: followupNotes.rows[0]?.cnt || 0,
          eligibilityChecks: eligChecks.rows[0]?.cnt || 0,
        },
        frictionItems,
      });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  // ── Create New Organization ───────────────────────────────────────────────
  app.post("/api/super-admin/orgs", requireSuperAdmin, async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const { name, modules } = req.body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "Organization name is required" });
      }
      const trimmedName = name.trim();
      // Generate a slug-style org ID from the name
      const slug = trimmedName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40);
      const orgId = `${slug}-${Date.now().toString(36)}`;

      const existing = await db.query("SELECT id FROM organizations WHERE LOWER(name) = LOWER($1)", [trimmedName]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: "An organization with that name already exists" });
      }

      const { rows: [org] } = await db.query(
        `INSERT INTO organizations (id, name, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())
         RETURNING id, name, created_at`,
        [orgId, trimmedName]
      );

      // Seed initial practice settings row so onboarding works
      await db.query(
        `INSERT INTO practice_settings (id, organization_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [orgId]
      ).catch(() => {});

      res.status(201).json({ ...org, user_count: 0, total_claims: 0, total_leads: 0, onboarding_steps: 0, has_billing: false, has_intake: false });
    } catch (err: any) {
      console.error('[API] Error creating org:', err);
      res.status(500).json({ error: 'Failed to create organization' });
    }
  });

  // ── Impersonation Routes ─────────────────────────────────────────────────
  app.post("/api/super-admin/impersonate/:orgId", requireSuperAdmin, async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const { orgId } = req.params;
      const org = await db.query("SELECT id, name FROM organizations WHERE id = $1", [orgId]);
      if (!org.rows[0]) return res.status(404).json({ error: "Organization not found" });
      (req.session as any).impersonatingOrgId = orgId;
      (req.session as any).impersonatingOrgName = org.rows[0].name;
      req.session.save((err) => {
        if (err) return res.status(500).json({ error: "Failed to save session" });
        res.json({ success: true, orgId, orgName: org.rows[0].name });
      });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.post("/api/super-admin/stop-impersonate", requireSuperAdmin, (req, res) => {
    delete (req.session as any).impersonatingOrgId;
    delete (req.session as any).impersonatingOrgName;
    req.session.save((err) => {
      if (err) return res.status(500).json({ error: "Failed to save session" });
      res.json({ success: true });
    });
  });

  // ── Phase 2: Payer Manual Ingestion API ─────────────────────────────────

  // Document types reference table
  app.get("/api/admin/document-types", requireSuperAdmin, async (req, res) => {
    try {
      const { pool: db } = await import("./db");
      const { rows } = await db.query(`SELECT * FROM document_types ORDER BY sort_order, code`);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // List all payer source documents
  app.get("/api/admin/payer-manuals", requireSuperAdmin, async (req, res) => {
    try {
      const { pool: db } = await import("./db");
      const { rows } = await db.query(`
        SELECT pm.*, pm.document_name AS payer_name, p.name AS payer_record_name,
          parent.document_name AS parent_document_name,
          dt.label AS document_type_label,
          (SELECT COUNT(*)::int FROM manual_extraction_items WHERE source_document_id = pm.id) AS item_count,
          (SELECT COUNT(*)::int FROM manual_extraction_items WHERE source_document_id = pm.id AND review_status = 'approved') AS approved_count,
          (SELECT COUNT(*)::int FROM manual_extraction_items WHERE source_document_id = pm.id AND review_status = 'rejected') AS rejected_count,
          (SELECT COUNT(*)::int FROM manual_extraction_items WHERE source_document_id = pm.id AND review_status = 'pending') AS pending_count,
          (SELECT COUNT(*)::int FROM payer_source_documents WHERE parent_document_id = pm.id) AS supplement_count
        FROM payer_source_documents pm
        LEFT JOIN payers p ON pm.payer_id = p.id
        LEFT JOIN payer_source_documents parent ON pm.parent_document_id = parent.id
        LEFT JOIN document_types dt ON dt.code = pm.document_type
        ORDER BY pm.document_name ASC, pm.document_type ASC, pm.effective_start DESC NULLS LAST, pm.created_at DESC
      `);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create a new payer manual (URL-based or file upload)
  {
    const multer = (await import("multer")).default;
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
    app.post("/api/admin/payer-manuals", requireSuperAdmin, upload.single("file"), async (req, res) => {
      try {
        const { pool: db } = await import("./db");
        const { validateManualUrl } = await import("./services/manual-extractor");
        const { payerName, payerId, sourceUrl, documentType, parentDocumentId, effectiveStart, effectiveEnd } = req.body;
        if (!payerName) return res.status(400).json({ error: "payerName is required" });

        const file = (req as any).file as Express.Multer.File | undefined;
        if (!file && !sourceUrl) return res.status(400).json({ error: "sourceUrl or file upload is required" });

        // Validate document type
        const VALID_DOC_TYPES = ["admin_guide", "supplement", "pa_list", "reimbursement_policy", "medical_policy", "bulletin", "contract", "fee_schedule"];
        const docType = documentType || "admin_guide";
        if (!VALID_DOC_TYPES.includes(docType)) {
          return res.status(400).json({ error: `Invalid documentType. Must be one of: ${VALID_DOC_TYPES.join(", ")}` });
        }

        // SSRF guard — validate URL if provided
        if (sourceUrl) {
          try { validateManualUrl(sourceUrl); } catch (e: any) {
            return res.status(400).json({ error: `Invalid source URL: ${e.message}` });
          }
        }

        const user = req.user as any;
        const { rows } = await db.query(`
          INSERT INTO payer_source_documents (document_name, payer_id, source_url, file_name, file_content, status, uploaded_by, document_type, parent_document_id, effective_start, effective_end)
          VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10)
          RETURNING *, document_name AS payer_name
        `, [
          payerName,
          payerId || null,
          sourceUrl || null,
          file?.originalname || null,
          file?.buffer || null,
          user?.email || 'admin',
          docType,
          parentDocumentId || null,
          effectiveStart || null,
          effectiveEnd || null,
        ]);

        res.json(rows[0]);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });
  }

  // Get extraction items for a manual
  app.get("/api/admin/payer-manuals/:id/items", requireSuperAdmin, async (req, res) => {
    try {
      const { pool: db } = await import("./db");
      const { rows } = await db.query(`
        SELECT * FROM manual_extraction_items
        WHERE source_document_id = $1
        ORDER BY section_type, created_at
      `, [req.params.id]);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Trigger extraction processing for a manual
  app.post("/api/admin/payer-manuals/:id/process", requireSuperAdmin, async (req, res) => {
    const { pool: db } = await import("./db");
    const manualId = req.params.id;
    try {
      const { rows: manuals } = await db.query("SELECT *, document_name AS payer_name FROM payer_source_documents WHERE id = $1", [manualId]);
      if (!manuals.length) return res.status(404).json({ error: "Manual not found" });
      const manual = manuals[0];

      if (!manual.source_url && !manual.file_content) return res.status(400).json({ error: "No source URL or uploaded file configured" });

      // Validate URL before starting async work (SSRF guard)
      if (manual.source_url) {
        const { validateManualUrl } = await import("./services/manual-extractor");
        try { validateManualUrl(manual.source_url); } catch (e: any) {
          return res.status(400).json({ error: `Invalid source URL: ${e.message}` });
        }
      }

      // Idempotent reprocessing: remove all non-approved items so we start clean.
      // Rejected items are also cleared so reprocessing gives a fresh extraction pass.
      await db.query(`DELETE FROM manual_extraction_items WHERE source_document_id = $1 AND review_status IN ('pending','not_found','rejected')`, [manualId]);

      // Mark as processing
      await db.query("UPDATE payer_source_documents SET status = 'processing', updated_at = NOW() WHERE id = $1", [manualId]);
      res.json({ status: "processing", message: "Extraction started" });

      // Run async extraction
      setImmediate(async () => {
        try {
          const { extractManualSections, FALLBACK_ACTIVE_SECTION_TYPES } = await import("./services/manual-extractor");
          const { extractSection } = await import("./services/claude-extractor");

          // Read active section kinds from rule_kinds table so that Phase 3 activation
          // (e.g. risk_adjustment_hcc) requires only a seeder change, not a code change.
          const { rows: kindRows } = await db.query(
            `SELECT code FROM rule_kinds WHERE active_in_extraction = TRUE ORDER BY sort_order`
          );
          const sectionTypes = kindRows.length > 0
            ? kindRows.map((r: any) => r.code as string)
            : FALLBACK_ACTIVE_SECTION_TYPES;

          // Use file buffer if uploaded, otherwise fetch from URL
          const extractInput = manual.file_content
            ? { buffer: Buffer.from(manual.file_content), fileName: manual.file_name || "upload.pdf", activeSectionTypes: sectionTypes as any }
            : { url: manual.source_url, activeSectionTypes: sectionTypes as any };
          const { sections } = await extractManualSections(extractInput);

          for (const section of sections) {
            if (section.chunks.length === 0) {
              await db.query(`
                INSERT INTO manual_extraction_items (source_document_id, section_type, review_status, notes)
                VALUES ($1, $2, 'pending', 'No relevant text found for this section — reviewer must confirm absent or re-extract')
              `, [manualId, section.sectionType]);
              continue;
            }
            for (const chunk of section.chunks.slice(0, 2)) {
              const output = await extractSection(section.sectionType, chunk);
              if (output.skipped) {
                await db.query(`
                  INSERT INTO manual_extraction_items (source_document_id, section_type, raw_snippet, review_status, notes)
                  VALUES ($1, $2, $3, 'pending', 'ANTHROPIC_API_KEY not configured — manual review required')
                `, [manualId, section.sectionType, chunk.slice(0, 2000)]);
              } else if (output.error || !output.result) {
                await db.query(`
                  INSERT INTO manual_extraction_items (source_document_id, section_type, raw_snippet, review_status, notes)
                  VALUES ($1, $2, $3, 'pending', $4)
                `, [manualId, section.sectionType, chunk.slice(0, 2000), `Extraction error: ${output.error || 'No result'}`]);
              } else {
                await db.query(`
                  INSERT INTO manual_extraction_items (source_document_id, section_type, raw_snippet, extracted_json, confidence, review_status)
                  VALUES ($1, $2, $3, $4, $5, 'pending')
                `, [manualId, section.sectionType, chunk.slice(0, 2000), JSON.stringify(output.result), output.confidence]);
              }
            }
          }
          // Ensure all section types have at least one extraction item
          // (creates pending placeholders for sections not extracted from the document;
          //  reviewers must explicitly mark missing sections as not_found via the review UI)
          for (const st of sectionTypes) {
            const { rows: existing } = await db.query(
              `SELECT id FROM manual_extraction_items WHERE source_document_id = $1 AND section_type = $2 LIMIT 1`,
              [manualId, st]
            );
            if (existing.length === 0) {
              await db.query(`
                INSERT INTO manual_extraction_items (source_document_id, section_type, review_status, notes)
                VALUES ($1, $2, 'pending', 'Section not extracted from document — requires reviewer to confirm absent or re-extract')
              `, [manualId, st]);
            }
          }
          await db.query("UPDATE payer_source_documents SET status = 'ready_for_review', updated_at = NOW() WHERE id = $1", [manualId]);
        } catch (err: any) {
          await db.query("UPDATE payer_source_documents SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1", [manualId, err.message]);
        }
      });
    } catch (err: any) {
      await db.query("UPDATE payer_source_documents SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1", [manualId, err.message]).catch(() => {});
      res.status(500).json({ error: err.message });
    }
  });

  // Approve / reject / edit+approve an extraction item
  app.patch("/api/admin/payer-manual-items/:id", requireSuperAdmin, async (req, res) => {
    try {
      const { pool: db } = await import("./db");
      const { reviewStatus, notes, extractedJson, appliesToPlanProducts } = req.body;
      const user = req.user as any;

      if (!["approved", "rejected", "pending", "not_found", "needs_reverification"].includes(reviewStatus)) {
        return res.status(400).json({ error: "reviewStatus must be approved, rejected, pending, not_found, or needs_reverification" });
      }

      // Build param list dynamically — keep id as the last param so WHERE $N is always correct
      const baseParams: any[] = [reviewStatus, user?.email || 'admin', notes || null];
      let extraUpdates = "";
      if (extractedJson) {
        baseParams.push(JSON.stringify(extractedJson));
        extraUpdates += `, extracted_json = $${baseParams.length}::jsonb`;
      }
      if (appliesToPlanProducts !== undefined) {
        baseParams.push(JSON.stringify(appliesToPlanProducts));
        extraUpdates += `, applies_to_plan_products = $${baseParams.length}::jsonb`;
      }
      baseParams.push(req.params.id);
      const idParam = baseParams.length;

      const { rows } = await db.query(`
        UPDATE manual_extraction_items
        SET review_status = $1, reviewed_by = $2, reviewed_at = NOW(), notes = $3 ${extraUpdates}
        WHERE id = $${idParam}
        RETURNING *
      `, baseParams);

      if (!rows.length) return res.status(404).json({ error: "Item not found" });
      const item = rows[0];

      // If approved, write to downstream tables — collect errors instead of silently swallowing them
      const sideEffectErrors: string[] = [];
      if (reviewStatus === "approved" && item.extracted_json) {
        const data = item.extracted_json as any;
        const { rows: manuals } = await db.query("SELECT *, document_name AS payer_name FROM payer_source_documents WHERE id = $1", [item.source_document_id]);
        const manual = manuals[0];

        if (item.section_type === "timely_filing" && data.days > 0 && manual?.payer_id) {
          await db.query("UPDATE payers SET timely_filing_days = $1 WHERE id = $2", [data.days, manual.payer_id])
            .catch((e: any) => sideEffectErrors.push(`timely_filing update: ${e.message}`));
        }
        if (item.section_type === "prior_auth" && manual?.payer_id) {
          const codes: string[] = data.cpt_codes && data.cpt_codes.length > 0 ? data.cpt_codes : ["*"];
          for (const code of codes.slice(0, 20)) {
            await db.query(`
              INSERT INTO payer_auth_requirements (payer_id, payer_name, code, code_type, auth_required, auth_conditions, notes)
              VALUES ($1, $2, $3, 'HCPCS', $4, $5, $6)
              ON CONFLICT (payer_id, code) DO UPDATE SET auth_conditions = EXCLUDED.auth_conditions, notes = EXCLUDED.notes
            `, [manual.payer_id, manual.payer_name, code, data.requires_auth, data.criteria, `Source: ${manual.payer_name} Manual`])
              .catch((e: any) => sideEffectErrors.push(`payer_auth code ${code}: ${e.message}`));
          }
        }
        if (item.section_type === "modifiers_and_liability" || item.section_type === "appeals") {
          const isModifier = item.section_type === "modifiers_and_liability";
          const ruleName = isModifier
            ? `${manual?.payer_name || 'Payer'}: Modifier ${data.modifier_code || ''} — ${data.liability_assignment || 'unknown'} liability`
            : `${manual?.payer_name || 'Payer'}: ${data.level || 'Appeals'} Process`;
          const description = isModifier
            ? `${data.payer_rule || ''} Liability: ${data.liability_assignment || 'unknown'}. Conditions required: ${(data.conditions_required || []).join(', ') || 'none specified'}.`
            : `Deadline: ${data.deadline_days} days. Method: ${data.submission_method}`;
          const trigger = isModifier ? `modifier,${data.modifier_code || ''}`.toLowerCase() : "appeal,dispute";
          const prevention = isModifier
            ? `Apply modifier ${data.modifier_code} per payer policy. ${data.appeal_path_if_denied || ''}`.trim()
            : `File appeal within ${data.deadline_days} days via ${data.submission_method}`;

          // Derive contextual specialty tags from payer name
          const payerName = (manual?.payer_name || '').toLowerCase();
          const contextTags: string[] = [];
          if (payerName.includes('triwest') || payerName.includes('va ') || payerName.includes('community care')) contextTags.push('VA Community Care');
          if (payerName.includes('medicare')) { contextTags.push('Medicare'); contextTags.push('Home Health'); }
          if (payerName.includes('medicaid')) contextTags.push('Medicaid');
          if (contextTags.length === 0) contextTags.push('Universal');
          const tagsLiteral = `{${contextTags.map(t => `"${t}"`).join(',')}}`;

          const ruleResult = await db.query(`
            INSERT INTO rules (name, description, trigger_pattern, prevention_action, payer, enabled, specialty_tags)
            VALUES ($1, $2, $3, $4, $5, true, $6)
            RETURNING id
          `, [ruleName, description || '', trigger, prevention, manual?.payer_name || '', tagsLiteral])
            .catch((e: any) => { sideEffectErrors.push(`rules insert: ${e.message}`); return { rows: [] }; }) as any;

          if (ruleResult?.rows?.[0]?.id) {
            await db.query("UPDATE manual_extraction_items SET applied_rule_id = $1 WHERE id = $2", [ruleResult.rows[0].id, item.id])
              .catch((e: any) => sideEffectErrors.push(`applied_rule_id update: ${e.message}`));
          }
        }
      }

      // Auto-complete manual only when all items have a terminal acceptable status
      // (approved or not_found). Remaining 'rejected' items mean extraction still needs
      // correction — marking completed in that state would overstate coverage quality.
      const { rows: pendingCheck } = await db.query(`
        SELECT
          COUNT(*) FILTER (WHERE review_status = 'pending')::int  AS pending_cnt,
          COUNT(*) FILTER (WHERE review_status = 'rejected')::int AS rejected_cnt
        FROM manual_extraction_items
        WHERE source_document_id = $1
      `, [item.source_document_id]);

      if (pendingCheck[0]?.pending_cnt === 0 && pendingCheck[0]?.rejected_cnt === 0) {
        const { rows: manualRows } = await db.query(`
          UPDATE payer_source_documents
          SET status = 'completed', updated_at = NOW()
          WHERE id = $1 AND status IN ('ready_for_review', 'processing')
          RETURNING id
        `, [item.source_document_id]);

        if (manualRows.length > 0) {
          // Update last_verified_date on linked payer_manual_source
          await db.query(`
            UPDATE payer_manual_sources
            SET last_verified_date = NOW()::date, updated_at = NOW()
            WHERE linked_source_document_id = $1
          `, [item.source_document_id]).catch(() => {});
        }
      }

      // ── Write history row + update last_verified_at ────────────────────────
      try {
        // Map review_status to change_type
        const changeTypeMap: Record<string, string> = {
          approved: "approved",
          rejected: "rejected",
          pending: "reopened",
          not_found: "rejected",
          needs_reverification: "needs_reverification",
        };
        const changeType = extractedJson ? "data_corrected" : (changeTypeMap[reviewStatus] || "edited");

        // Look up payer name — works across both schema variants:
        //   production: manual_id → payer_manuals.payer_name
        //   dev:        source_document_id → payer_source_documents.document_name
        const docId = (item.manual_id || item.source_document_id) ?? null;
        let historyPayerName: string | null = null;
        if (docId) {
          const [pmResult, psdResult] = await Promise.all([
            db.query("SELECT payer_name FROM payer_manuals WHERE id = $1", [docId]).catch(() => ({ rows: [] })),
            db.query("SELECT document_name AS payer_name FROM payer_source_documents WHERE id = $1", [docId]).catch(() => ({ rows: [] })),
          ]);
          historyPayerName = (pmResult.rows[0] ?? psdResult.rows[0])?.payer_name ?? null;
        }

        await db.query(`
          INSERT INTO payer_manual_extraction_history
            (extraction_id, changed_by, change_type, state_snapshot, change_notes, payer_name, section_type)
          VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
        `, [
          item.id,
          user?.email || 'system',
          changeType,
          JSON.stringify({ ...item, review_status: reviewStatus }),
          notes || null,
          historyPayerName,
          item.section_type,
        ]);

        // Update last_verified_at when approved
        if (reviewStatus === "approved") {
          await db.query(
            `UPDATE manual_extraction_items SET last_verified_at = NOW() WHERE id = $1`, [item.id]
          );
        }
      } catch (histErr: any) {
        console.warn('[History] Failed to write extraction history:', histErr?.message);
      }

      res.json({ ...item, sideEffectErrors: sideEffectErrors.length > 0 ? sideEffectErrors : undefined });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete a payer manual
  app.delete("/api/admin/payer-manuals/:id", requireSuperAdmin, async (req, res) => {
    try {
      const { pool: db } = await import("./db");
      // Clear source registry link before deleting so payers don't show stuck as "Ingested"
      await db.query(
        `UPDATE payer_manual_sources SET linked_source_document_id = NULL, updated_at = NOW() WHERE linked_source_document_id = $1`,
        [req.params.id]
      ).catch(() => {});
      await db.query("DELETE FROM manual_extraction_items WHERE source_document_id = $1", [req.params.id]);
      await db.query("DELETE FROM payer_source_documents WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Payer Manual Source Registry (Phase 4) ─────────────────────────────

  app.get("/api/admin/payer-manual-sources", requireSuperAdmin, async (req, res) => {
    try {
      const { pool: db } = await import("./db");
      const { rows } = await db.query(`
        SELECT pms.*,
          pm.status AS manual_status,
          pm.document_name AS manual_payer_name,
          pm.created_at AS manual_ingested_at
        FROM payer_manual_sources pms
        LEFT JOIN payer_source_documents pm ON pm.id = pms.linked_source_document_id
        ORDER BY pms.priority ASC
      `);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/admin/payer-manual-sources/:id", requireSuperAdmin, async (req, res) => {
    try {
      const { z } = await import("zod");
      const bodySchema = z.object({
        lastVerifiedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
        canonicalUrl: z.string().url("Must be a valid URL").max(1000).nullable().optional(),
        linkedManualId: z.string().max(100).nullable().optional(),
      }).strict();
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors });

      const { pool: db } = await import("./db");
      const { id } = req.params;
      // Build SET clause dynamically so absent fields are not changed,
      // but explicitly passed null values (e.g. linkedManualId=null) ARE applied.
      const setClauses: string[] = ["updated_at = NOW()"];
      const params: any[] = [];
      let i = 1;
      if ("lastVerifiedDate" in req.body) { setClauses.push(`last_verified_date = $${i++}`); params.push(parsed.data.lastVerifiedDate ?? null); }
      if ("notes" in req.body) { setClauses.push(`notes = $${i++}`); params.push(parsed.data.notes ?? null); }
      if ("canonicalUrl" in req.body) { setClauses.push(`canonical_url = $${i++}`); params.push(parsed.data.canonicalUrl ?? null); }
      if ("linkedManualId" in req.body) { setClauses.push(`linked_source_document_id = $${i++}`); params.push(parsed.data.linkedManualId ?? null); }
      params.push(id);
      const { rows } = await db.query(
        `UPDATE payer_manual_sources SET ${setClauses.join(", ")} WHERE id = $${i} RETURNING *`,
        params
      );
      if (!rows[0]) return res.status(404).json({ error: "Source not found" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/payer-manual-coverage", requireSuperAdmin, async (req, res) => {
    try {
      const { pool: db } = await import("./db");

      const { rows: sources } = await db.query(`
        SELECT pms.*, pm.status AS manual_status, pm.created_at AS manual_ingested_at, pm.payer_id AS manual_payer_id,
               pm.document_name AS linked_document_name
        FROM payer_manual_sources pms
        LEFT JOIN payer_source_documents pm ON pm.id = pms.linked_source_document_id
        ORDER BY pms.priority ASC
      `);

      // Count both 'approved' AND 'not_found' as "reviewed" — not_found means the
      // section was intentionally checked and confirmed absent in the public manual.
      const { rows: coverageRows } = await db.query(`
        SELECT
          mei.source_document_id,
          mei.section_type,
          COUNT(*) FILTER (WHERE mei.review_status = 'approved')                         AS approved_count,
          COUNT(*) FILTER (WHERE mei.review_status IN ('approved', 'not_found'))         AS reviewed_count
        FROM manual_extraction_items mei
        INNER JOIN payer_source_documents pm ON pm.id = mei.source_document_id
        GROUP BY mei.source_document_id, mei.section_type
      `);

      const coverageByManual: Record<string, Record<string, { approved: number; reviewed: number }>> = {};
      for (const row of coverageRows) {
        if (!coverageByManual[row.source_document_id]) coverageByManual[row.source_document_id] = {};
        coverageByManual[row.source_document_id][row.section_type] = {
          approved: parseInt(row.approved_count, 10),
          reviewed: parseInt(row.reviewed_count, 10),
        };
      }

      // Prompt B1: all 14 active section kinds in coverage matrix
      const sectionTypes = [
        "timely_filing", "prior_auth", "modifiers_and_liability", "appeals",
        "referrals", "coordination_of_benefits",
        "payer_specific_edits", "edi_construction", "place_of_service",
        "submission_timeframe", "decision_timeframe", "documentation_timeframe",
        "notification_event", "member_notice",
      ];
      const payerData = sources.map((src: any) => {
        const manualId = src.linked_source_document_id;
        const cov = manualId ? (coverageByManual[manualId] || {}) : {};
        const secCov = (type: string) => cov[type] || { approved: 0, reviewed: 0 };

        const coverage: Record<string, boolean> = {};
        for (const st of sectionTypes) {
          coverage[st] = secCov(st).approved > 0;
          coverage[`${st}_reviewed`] = secCov(st).reviewed > 0;
        }

        return {
          source_id: src.id,
          payer_name: src.payer_name,
          priority: src.priority,
          canonical_url: src.canonical_url,
          notes: src.notes,
          last_verified_date: src.last_verified_date,
          linked_manual_id: manualId || null,
          linked_source_document_id: manualId || null,
          manual_status: src.manual_status || null,
          manual_ingested_at: src.manual_ingested_at || null,
          manual_payer_id: src.manual_payer_id || null,
          linked_document_name: src.linked_document_name || null,
          ...coverage,
        };
      });

      const ingested = payerData.filter((p: any) => p.linked_source_document_id && p.manual_status === "completed").length;
      const total = payerData.length;
      const pctApproved = (field: string) => total === 0 ? 0 : Math.round(
        payerData.filter((p: any) => p[field]).length / total * 100
      );
      const pctReviewed = (field: string) => total === 0 ? 0 : Math.round(
        payerData.filter((p: any) => p[`${field}_reviewed`]).length / total * 100
      );

      res.json({
        summary: {
          total_sources: total,
          ingested_count: ingested,
          // Prompt B1: all 14 active section kind percentages
          timely_filing_pct: pctApproved("timely_filing"),
          timely_filing_reviewed_pct: pctReviewed("timely_filing"),
          prior_auth_pct: pctApproved("prior_auth"),
          prior_auth_reviewed_pct: pctReviewed("prior_auth"),
          modifiers_and_liability_pct: pctApproved("modifiers_and_liability"),
          modifiers_and_liability_reviewed_pct: pctReviewed("modifiers_and_liability"),
          appeals_pct: pctApproved("appeals"),
          appeals_reviewed_pct: pctReviewed("appeals"),
          referrals_pct: pctApproved("referrals"),
          referrals_reviewed_pct: pctReviewed("referrals"),
          coordination_of_benefits_pct: pctApproved("coordination_of_benefits"),
          coordination_of_benefits_reviewed_pct: pctReviewed("coordination_of_benefits"),
          payer_specific_edits_pct: pctApproved("payer_specific_edits"),
          payer_specific_edits_reviewed_pct: pctReviewed("payer_specific_edits"),
          edi_construction_pct: pctApproved("edi_construction"),
          edi_construction_reviewed_pct: pctReviewed("edi_construction"),
          place_of_service_pct: pctApproved("place_of_service"),
          place_of_service_reviewed_pct: pctReviewed("place_of_service"),
          submission_timeframe_pct: pctApproved("submission_timeframe"),
          submission_timeframe_reviewed_pct: pctReviewed("submission_timeframe"),
          decision_timeframe_pct: pctApproved("decision_timeframe"),
          decision_timeframe_reviewed_pct: pctReviewed("decision_timeframe"),
          documentation_timeframe_pct: pctApproved("documentation_timeframe"),
          documentation_timeframe_reviewed_pct: pctReviewed("documentation_timeframe"),
          notification_event_pct: pctApproved("notification_event"),
          notification_event_reviewed_pct: pctReviewed("notification_event"),
          member_notice_pct: pctApproved("member_notice"),
          member_notice_reviewed_pct: pctReviewed("member_notice"),
        },
        payers: payerData,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Payer Manual Coverage: CMS Timely Filing Validation Sweep ───────────
  // Compares approved timely_filing extraction items against a structured CMS/regulatory
  // reference table and flags discrepancies for manual review.
  app.get("/api/admin/payer-manual-coverage/validate", requireSuperAdmin, async (req, res) => {
    try {
      const { pool: db } = await import("./db");

      // CMS/regulatory reference table for timely filing requirements.
      // Sources: 42 CFR § 424.44 (Medicare), 32 CFR § 199.7(d) (TRICARE),
      //          42 CFR § 447.45 (Medicaid), NAIC Prompt Pay Model Act (Commercial).
      // min_acceptable/max_acceptable define the valid range; fixed=true means exact match required.
      const CMS_TF_REFERENCE = [
        {
          payer_type: "medicare",
          label: "Medicare",
          standard_days: 365,
          min_acceptable: 365,
          max_acceptable: 365,
          fixed: true,
          regulatory_source: "42 CFR § 424.44(a)",
          match_keywords: ["medicare"],
        },
        {
          payer_type: "tricare",
          label: "TRICARE/VA",
          standard_days: 365,
          min_acceptable: 365,
          max_acceptable: 365,
          fixed: true,
          regulatory_source: "32 CFR § 199.7(d)",
          match_keywords: ["tricare", "triwest", "champva"],
        },
        {
          payer_type: "medicaid",
          label: "Medicaid MCO",
          standard_days: 365,
          min_acceptable: 90,
          max_acceptable: 730,
          fixed: false,
          regulatory_source: "42 CFR § 447.45; state plan",
          match_keywords: ["medicaid", "amerihealth caritas", "molina", "centene", "wellcare", "amerigroup"],
        },
        {
          payer_type: "commercial",
          label: "Commercial",
          standard_days: 180,
          min_acceptable: 90,
          max_acceptable: 730,
          fixed: false,
          regulatory_source: "NAIC Prompt Pay Model Act; provider contract",
          match_keywords: [],
        },
      ] as const;

      type TFRef = typeof CMS_TF_REFERENCE[number];

      function resolveRef(payerName: string): TFRef {
        const lower = payerName.toLowerCase();
        for (const ref of CMS_TF_REFERENCE) {
          if (ref.match_keywords.some((kw) => lower.includes(kw))) return ref;
        }
        return CMS_TF_REFERENCE[CMS_TF_REFERENCE.length - 1]; // commercial default
      }

      // Fetch ONE canonical timely_filing item per source document (most recently reviewed approved/not_found row).
      // Using DISTINCT ON avoids duplicate discrepancy entries when a document has multiple timely_filing rows.
      // Pending/rejected items are excluded — they have not been human-reviewed yet.
      const { rows: items } = await db.query(`
        SELECT DISTINCT ON (pm.id)
          pm.id             AS manual_id,
          pm.document_name  AS payer_name,
          pm.status         AS manual_status,
          mei.id            AS item_id,
          mei.review_status,
          mei.extracted_json,
          mei.notes
        FROM payer_source_documents pm
        LEFT JOIN manual_extraction_items mei
          ON mei.source_document_id = pm.id
          AND mei.section_type = 'timely_filing'
          AND mei.review_status IN ('approved', 'not_found')
        WHERE pm.status = 'completed'
        ORDER BY pm.id, mei.reviewed_at DESC NULLS LAST
      `);

      const discrepancies: any[] = [];
      const checked: any[] = [];

      for (const row of items) {
        const ref = resolveRef(row.payer_name || "");

        if (!row.item_id) {
          discrepancies.push({
            manual_id: row.manual_id,
            payer_name: row.payer_name,
            issue: "missing_timely_filing",
            detail: `No reviewed timely_filing item found for this completed manual (${ref.label} payer — expected ${ref.standard_days} days per ${ref.regulatory_source})`,
            severity: "warning",
            extracted_days: null,
            expected_hint: ref.fixed ? `${ref.standard_days} days` : `${ref.min_acceptable}–${ref.max_acceptable} days`,
          });
          continue;
        }

        if (row.review_status === "not_found") {
          checked.push({ manual_id: row.manual_id, payer_name: row.payer_name, review_status: "not_found", extracted_days: null, payer_type: ref.payer_type });
          continue;
        }

        const days = row.extracted_json ? parseInt(row.extracted_json.days, 10) : NaN;

        if (isNaN(days)) {
          discrepancies.push({
            manual_id: row.manual_id, payer_name: row.payer_name, item_id: row.item_id,
            issue: "missing_days_field",
            detail: "Approved extraction item does not have a numeric 'days' field in extracted_json",
            severity: "error", extracted_days: null, expected_hint: null,
          });
          continue;
        }

        let flagged = false;

        if (days < ref.min_acceptable) {
          discrepancies.push({
            manual_id: row.manual_id, payer_name: row.payer_name, item_id: row.item_id,
            issue: "below_reference_minimum",
            detail: `${days} days is below the ${ref.label} reference minimum of ${ref.min_acceptable} days (${ref.regulatory_source})`,
            severity: "error", extracted_days: days,
            expected_hint: `≥ ${ref.min_acceptable} days per ${ref.regulatory_source}`,
          });
          flagged = true;
        } else if (days > ref.max_acceptable) {
          discrepancies.push({
            manual_id: row.manual_id, payer_name: row.payer_name, item_id: row.item_id,
            issue: "above_reference_maximum",
            detail: `${days} days exceeds the ${ref.label} reference maximum of ${ref.max_acceptable} days (${ref.regulatory_source})`,
            severity: "warning", extracted_days: days,
            expected_hint: `≤ ${ref.max_acceptable} days per ${ref.regulatory_source}`,
          });
          flagged = true;
        } else if (ref.fixed && days !== ref.standard_days) {
          discrepancies.push({
            manual_id: row.manual_id, payer_name: row.payer_name, item_id: row.item_id,
            issue: "fixed_standard_mismatch",
            detail: `${ref.label} timely filing must be exactly ${ref.standard_days} days per ${ref.regulatory_source}; extracted value is ${days} days`,
            severity: "warning", extracted_days: days,
            expected_hint: `${ref.standard_days} days per ${ref.regulatory_source}`,
          });
          flagged = true;
        }

        if (!flagged) {
          checked.push({ manual_id: row.manual_id, payer_name: row.payer_name, review_status: row.review_status, extracted_days: days, payer_type: ref.payer_type });
        }
      }

      res.json({
        run_at: new Date().toISOString(),
        reference_table: CMS_TF_REFERENCE,
        summary: {
          total_manuals_checked: new Set([...discrepancies.map((r: any) => r.manual_id), ...checked.map((r: any) => r.manual_id)]).size,
          passed_manuals: new Set(checked.map((r: any) => r.manual_id)).size,
          flagged_manuals: new Set(discrepancies.map((r: any) => r.manual_id)).size,
          discrepancy_count: discrepancies.length,
        },
        discrepancies,
        passed: checked,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Clinic Home Stats Route ─────────────────────────────────────────────
  app.get("/api/billing/clinic/stats", requireRole("admin"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = getOrgId(req);
      if (!orgId) return res.status(400).json({ error: "Organization required" });

      const [submitted, paid, activeFollowups, openDenials] = await Promise.all([
        db.query("SELECT COUNT(*)::int as cnt FROM claims WHERE organization_id = $1 AND status = 'submitted' AND created_at > NOW() - INTERVAL '30 days'", [orgId]),
        db.query("SELECT COUNT(*)::int as cnt FROM claims WHERE organization_id = $1 AND status = 'paid' AND created_at > NOW() - INTERVAL '30 days'", [orgId]),
        db.query("SELECT COUNT(*)::int as cnt FROM claims WHERE organization_id = $1 AND follow_up_date IS NOT NULL AND status != 'paid'", [orgId]).catch(() => ({ rows: [{ cnt: 0 }] })),
        db.query("SELECT COUNT(*)::int as cnt FROM claims WHERE organization_id = $1 AND status = 'denied'", [orgId]),
      ]);

      res.json({
        claimsSubmitted: submitted.rows[0]?.cnt || 0,
        claimsPaid: paid.rows[0]?.cnt || 0,
        activeFollowups: activeFollowups.rows[0]?.cnt || 0,
        openDenials: openDenials.rows[0]?.cnt || 0,
      });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });


  // ── RCM Reports ───────────────────────────────────────────────────────────

  app.get("/api/billing/reports/ar-aging", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const orgId = requireOrgCtx(req, res);
      if (!orgId) return;
      const { startDate, endDate, payerId, providerId } = req.query as Record<string, string>;
      const start = startDate || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const end = endDate || new Date().toISOString().slice(0, 10);
      const conditions: string[] = [`c.status NOT IN ('paid', 'draft')`];
      const params: any[] = [];
      params.push(orgId); conditions.push(`c.organization_id = $${params.length}`);
      if (start) { params.push(start); conditions.push(`COALESCE(c.service_date, c.created_at::date) >= $${params.length}`); }
      if (end) { params.push(end); conditions.push(`COALESCE(c.service_date, c.created_at::date) <= $${params.length}`); }
      if (payerId && payerId !== "all") { params.push(payerId); conditions.push(`c.payer_id = $${params.length}`); }
      if (providerId && providerId !== "all") { params.push(providerId); conditions.push(`c.provider_id = $${params.length}`); }
      const where = `WHERE ${conditions.join(" AND ")}`;
      const result = await db.query(`
        SELECT COALESCE(p.first_name || ' ' || p.last_name, 'Unknown') AS patient_name,
          c.payer, c.id AS claim_id,
          COALESCE(c.service_date::text, c.created_at::date::text) AS dos,
          c.amount AS billed_amount,
          GREATEST(0, (CURRENT_DATE - COALESCE(c.service_date, c.created_at::date))::int) AS days_outstanding,
          c.status, c.follow_up_date::text AS follow_up_date
        FROM claims c LEFT JOIN patients p ON c.patient_id = p.id
        ${where} ORDER BY days_outstanding DESC NULLS LAST LIMIT 500
      `, params);
      res.json(result.rows);
    } catch (err: any) { console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' }); }
  });

  app.get("/api/billing/reports/denial-analysis", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const orgId = requireOrgCtx(req, res);
      if (!orgId) return;
      const { startDate, endDate, payerId, providerId } = req.query as Record<string, string>;
      const start = startDate || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const end = endDate || new Date().toISOString().slice(0, 10);
      const claimParams: any[] = [];
      const claimConds: string[] = [];
      claimParams.push(orgId); claimConds.push(`c.organization_id = $${claimParams.length}`);
      if (start) { claimParams.push(start); claimConds.push(`COALESCE(c.service_date, c.created_at::date) >= $${claimParams.length}`); }
      if (end) { claimParams.push(end); claimConds.push(`COALESCE(c.service_date, c.created_at::date) <= $${claimParams.length}`); }
      if (payerId && payerId !== "all") { claimParams.push(payerId); claimConds.push(`c.payer_id = $${claimParams.length}`); }
      if (providerId && providerId !== "all") { claimParams.push(providerId); claimConds.push(`c.provider_id = $${claimParams.length}`); }
      const cw = `WHERE ${claimConds.join(" AND ")}`;
      const byPayer = await db.query(`
        SELECT c.payer, COUNT(DISTINCT c.id) AS total_submitted,
          COUNT(DISTINCT d.claim_id) AS total_denied,
          ROUND(COUNT(DISTINCT d.claim_id)::numeric / NULLIF(COUNT(DISTINCT c.id),0)*100,1) AS denial_rate,
          MODE() WITHIN GROUP (ORDER BY d.denial_reason_text) AS top_denial_reason,
          ROUND(AVG(EXTRACT(EPOCH FROM (d.created_at - c.created_at))/86400)::numeric,1) AS avg_days_to_denial
        FROM claims c LEFT JOIN denials d ON d.claim_id = c.id
        ${cw} GROUP BY c.payer ORDER BY denial_rate DESC NULLS LAST
      `, claimParams);
      const denialParams: any[] = [];
      const denialConds: string[] = [];
      denialParams.push(orgId); denialConds.push(`d.organization_id = $${denialParams.length}`);
      if (start) { denialParams.push(start); denialConds.push(`d.created_at::date >= $${denialParams.length}`); }
      if (end) { denialParams.push(end); denialConds.push(`d.created_at::date <= $${denialParams.length}`); }
      const dw = denialConds.length ? `WHERE ${denialConds.join(" AND ")}` : "";
      const total = await db.query(`SELECT COUNT(*) AS cnt FROM denials d ${dw}`, denialParams);
      const totalCount = parseInt(total.rows[0]?.cnt || "0");
      const byReason = await db.query(`
        SELECT d.denial_category AS carc_code, d.denial_reason_text AS description,
          COUNT(*) AS count,
          ROUND(COUNT(*)::numeric / NULLIF($${denialParams.length + 1},0)*100,1) AS pct_of_total,
          ROUND(AVG(c.amount)::numeric,2) AS avg_billed
        FROM denials d LEFT JOIN claims c ON c.id = d.claim_id ${dw}
        GROUP BY d.denial_category, d.denial_reason_text ORDER BY count DESC LIMIT 20
      `, [...denialParams, totalCount]);
      res.json({ byPayer: byPayer.rows, byReason: byReason.rows });
    } catch (err: any) { console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' }); }
  });

  app.get("/api/billing/reports/collections", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const orgId = requireOrgCtx(req, res);
      if (!orgId) return;
      const { startDate, endDate, payerId, providerId } = req.query as Record<string, string>;
      const start = startDate || new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
      const end = endDate || new Date().toISOString().slice(0, 10);
      const params: any[] = [];
      const conds: string[] = [];
      params.push(orgId); conds.push(`c.organization_id = $${params.length}`);
      if (start) { params.push(start); conds.push(`COALESCE(c.service_date, c.created_at::date) >= $${params.length}`); }
      if (end) { params.push(end); conds.push(`COALESCE(c.service_date, c.created_at::date) <= $${params.length}`); }
      if (payerId && payerId !== "all") { params.push(payerId); conds.push(`c.payer_id = $${params.length}`); }
      if (providerId && providerId !== "all") { params.push(providerId); conds.push(`c.provider_id = $${params.length}`); }
      const cw = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      const summaryQ = await db.query(`
        SELECT SUM(c.amount) AS total_billed, COALESCE(SUM(el.paid_amount),0) AS total_paid,
          COALESCE(SUM(el.billed_amount - el.paid_amount),0) AS total_adjusted,
          SUM(CASE WHEN c.status NOT IN ('paid') THEN c.amount ELSE 0 END) AS total_outstanding
        FROM claims c LEFT JOIN era_lines el ON el.claim_id = c.id ${cw}
      `, params);
      const monthlyQ = await db.query(`
        SELECT TO_CHAR(DATE_TRUNC('month', COALESCE(c.service_date, c.created_at::date)),'Mon YYYY') AS month,
          DATE_TRUNC('month', COALESCE(c.service_date, c.created_at::date)) AS month_sort,
          SUM(c.amount) AS billed, COALESCE(SUM(el.paid_amount),0) AS paid,
          COALESCE(SUM(el.billed_amount - el.paid_amount),0) AS adjusted,
          SUM(CASE WHEN c.status NOT IN ('paid') THEN c.amount ELSE 0 END) AS outstanding,
          ROUND(COALESCE(SUM(el.paid_amount),0)/NULLIF(SUM(c.amount),0)*100,1) AS collection_rate
        FROM claims c LEFT JOIN era_lines el ON el.claim_id = c.id ${cw}
        GROUP BY DATE_TRUNC('month', COALESCE(c.service_date, c.created_at::date))
        ORDER BY month_sort ASC LIMIT 13
      `, params);
      res.json({ summary: summaryQ.rows[0] || {}, monthly: monthlyQ.rows });
    } catch (err: any) { console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' }); }
  });

  app.get("/api/billing/reports/clean-claim-rate", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const orgId = requireOrgCtx(req, res);
      if (!orgId) return;
      const { startDate, endDate, payerId, providerId } = req.query as Record<string, string>;
      const start = startDate || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const end = endDate || new Date().toISOString().slice(0, 10);
      const params: any[] = [];
      const conds: string[] = [`c.status != 'draft'`];
      params.push(orgId); conds.push(`c.organization_id = $${params.length}`);
      if (start) { params.push(start); conds.push(`COALESCE(c.service_date, c.created_at::date) >= $${params.length}`); }
      if (end) { params.push(end); conds.push(`COALESCE(c.service_date, c.created_at::date) <= $${params.length}`); }
      if (payerId && payerId !== "all") { params.push(payerId); conds.push(`c.payer_id = $${params.length}`); }
      if (providerId && providerId !== "all") { params.push(providerId); conds.push(`c.provider_id = $${params.length}`); }
      const cw = `WHERE ${conds.join(" AND ")}`;
      const byPayer = await db.query(`
        SELECT c.payer, COUNT(*) AS total_submitted,
          COUNT(*) FILTER (WHERE c.status='paid' AND NOT EXISTS (SELECT 1 FROM denials d WHERE d.claim_id=c.id)) AS first_pass_paid,
          ROUND(COUNT(*) FILTER (WHERE c.status='paid' AND NOT EXISTS (SELECT 1 FROM denials d WHERE d.claim_id=c.id))::numeric/NULLIF(COUNT(*),0)*100,1) AS fprr
        FROM claims c ${cw} GROUP BY c.payer ORDER BY fprr DESC NULLS LAST
      `, params);
      const overallQ = await db.query(`
        SELECT COUNT(*) AS total_submitted,
          COUNT(*) FILTER (WHERE c.status='paid' AND NOT EXISTS (SELECT 1 FROM denials d WHERE d.claim_id=c.id)) AS first_pass_paid,
          ROUND(COUNT(*) FILTER (WHERE c.status='paid' AND NOT EXISTS (SELECT 1 FROM denials d WHERE d.claim_id=c.id))::numeric/NULLIF(COUNT(*),0)*100,1) AS fprr
        FROM claims c ${cw}
      `, params);
      res.json({ rows: byPayer.rows, overall: overallQ.rows[0] || {} });
    } catch (err: any) { console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' }); }
  });

  app.post("/api/billing/eras/upload", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const orgId = requireOrgCtx(req, res);
      if (!orgId) return;
      const { content, filename, preview } = req.body;
      if (!content) return res.status(400).json({ error: "No file content provided" });
      const parsed = parse835Manual(content);
      if (!parsed) return res.status(422).json({ error: "This file does not appear to be a valid 835 ERA file. Please check the file format and try again." });
      if (preview) return res.json(parsed);
      const eraId = crypto.randomUUID();
      await db.query(
        `INSERT INTO era_batches (id, org_id, payer_name, check_number, payment_date, total_amount, status, source, raw_data, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,'unposted','manual_upload',$7::jsonb,NOW())
         ON CONFLICT DO NOTHING`,
        [eraId, orgId, parsed.payerName, parsed.checkNumber, parsed.checkDate, parsed.totalPayment, JSON.stringify({ filename, raw: content.slice(0, 500) })]
      );
      for (const line of parsed.claimLines) {
        const matchedClaim = await db.query(
          `SELECT id FROM claims WHERE id = $1 LIMIT 1`, [line.claimControlNumber]
        );
        const claimId = matchedClaim.rows[0]?.id || null;
        await db.query(
          `INSERT INTO era_lines (id, era_id, claim_id, org_id, patient_name, billed_amount, allowed_amount, paid_amount, service_lines) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
          [crypto.randomUUID(), eraId, claimId, orgId, line.patientName, line.billedAmount, line.allowedAmount, line.paidAmount, JSON.stringify(line.adjustments || [])]
        );
      }
      res.json({ eraId, parsed });
    } catch (err: any) { console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' }); }
  });

  // ── Section 11: /api/billing/stedi-status ──────────────────────────────────
  app.get("/api/billing/stedi-status", requireRole("admin", "rcm_manager"), async (_req, res) => {
    const isConfigured = !!process.env.STEDI_API_KEY;
    const { STEDI_ENV, ISA15_INDICATOR } = await import("./lib/environment");
    const ediMode = ISA15_INDICATOR; // 'P' = production payer forwarding, 'T' = test (no forwarding)
    res.json({
      configured: isConfigured,
      ediMode,
      stediEnv: STEDI_ENV,
      mode: isConfigured ? (ediMode === "P" ? "production" : "test") : "not_configured",
      label: isConfigured
        ? (ediMode === "P" ? "✓ Stedi — Production (ISA15=P)" : "✓ Stedi — Test mode (ISA15=T)")
        : "⚠ Stedi not configured",
    });
  });

  // ── Section 3: Stedi main webhook — 277CA and 835 ERA ─────────────────────
  app.post("/api/webhooks/stedi", async (req, res) => {
    res.status(200).json({ received: true });

    setImmediate(async () => {
      try {
        const db = await import("./db").then(m => m.pool);
        const body = req.body;

        const webhookSecret = process.env.STEDI_WEBHOOK_SECRET;
        const authHeader = req.headers['authorization'];
        if (webhookSecret && authHeader !== `Key ${webhookSecret}`) {
          console.warn('[Webhook] Unauthorized — bad secret');
          return;
        }

        const eventObj = body?.event || body;
        const eventId = eventObj?.id || eventObj?.detail?.transactionId;
        const detailType =
          eventObj?.['detail-type'] ||
          eventObj?.detailType ||
          body?.type;
        const detail = eventObj?.detail || body?.detail || body;
        const transactionId = detail?.transactionId;
        const direction = detail?.direction;
        const transactionSetIdentifier =
          detail?.x12?.metadata?.transaction?.transactionSetIdentifier ||
          detail?.transactionSetIdentifier;

        if (!eventId) {
          console.error('[Webhook] No event ID:', JSON.stringify(body).slice(0, 300));
          return;
        }

        const existing = await db.query(
          'SELECT event_id FROM webhook_events WHERE event_id=$1',
          [eventId]
        );
        if (existing.rows.length > 0) {
          console.log(`[Webhook] Duplicate event ${eventId}, skip`);
          return;
        }

        await db.query(
          `INSERT INTO webhook_events (event_id, event_type, transaction_id, transaction_set)
           VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [eventId, detailType, transactionId, transactionSetIdentifier]
        );

        if (detailType?.includes('file.failed') || detailType === 'file.failed.v2') {
          const errors = detail?.errors || [];
          const msg = errors.map((e: any) => e.message).join('; ');
          console.error('[Webhook FileFailed]', msg);
          await db.query(
            `INSERT INTO system_settings (key, value, updated_at) VALUES ($1,$2,NOW())
             ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
            [`file_failed_${Date.now()}`, JSON.stringify({ error: msg, fileExecutionId: detail?.fileExecutionId, time: new Date().toISOString() })]
          );
          return;
        }

        if (!detailType?.includes('transaction.processed')) {
          console.log(`[Webhook] Ignoring event type: ${detailType}`);
          return;
        }
        if (direction === 'OUTBOUND') {
          console.log('[Webhook] Skipping OUTBOUND transaction');
          return;
        }

        if (!transactionId) {
          console.error('[Webhook] No transactionId in detail');
          return;
        }

        const { fetchStediTransaction, process277CA, process835ERA } = await import('./services/stedi-webhooks');

        if (transactionSetIdentifier === '277') {
          const data = await fetchStediTransaction(transactionId, '277');
          if (data) await process277CA(data, transactionId, db);
        } else if (transactionSetIdentifier === '835') {
          const data = await fetchStediTransaction(transactionId, '835');
          if (data) await process835ERA(data, transactionId, db);
        } else {
          console.log('[Webhook] Unknown set:', transactionSetIdentifier);
        }
      } catch (err) {
        console.error('[Webhook] Error:', err);
      }
    });
  });

  // ── Section 3: Enrollment event destination webhook ───────────────────────
  app.post("/api/webhooks/stedi/enrollment", async (req, res) => {
    res.status(200).json({ received: true });

    setImmediate(async () => {
      try {
        const body = req.body;
        console.log('[Enrollment Webhook]', JSON.stringify(body).slice(0, 500));

        const db = await import("./db").then(m => m.pool);

        const eventType = body?.detail?.type || body?.type;
        const payerId = body?.detail?.payerId || body?.detail?.payer?.id || body?.payerId;
        const transactionType = body?.detail?.transactionType || body?.transactionType;
        const status = body?.detail?.status || body?.status;

        console.log(`[Enrollment] ${transactionType} for payer ${payerId}: ${status}`);

        if ((status === 'approved' || status === 'live') && payerId) {
          const column = transactionType === '835' ? 'enrollment_status_835' : 'enrollment_status_837';
          await db.query(
            `UPDATE payers SET ${column} = 'active', enrollment_activated_at = NOW() WHERE payer_id = $1`,
            [payerId]
          ).catch(() => {});
        }

        await db.query(
          `INSERT INTO system_settings (key, value, updated_at) VALUES ($1,$2,NOW())
           ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
          [`enrollment_event_${Date.now()}`, JSON.stringify({ payerId, transactionType, status, timestamp: new Date().toISOString(), raw: body })]
        );
      } catch (err) {
        console.error('[Enrollment Webhook] Error:', err);
      }
    });
  });

  // ── Admin: Data Tools — Backfill plan_product ─────────────────────────────
  app.get("/api/admin/data-tools/backfill-plan-products", requireSuperAdmin, async (req, res) => {
    try {
      const { pool: db } = await import("./db");
      const { rows } = await db.query(`
        SELECT p.id, p.first_name, p.last_name, p.insurance_carrier, p.member_id, p.plan_product,
               pay.name AS payer_name
        FROM patients p
        LEFT JOIN payers pay ON pay.id = p.payer_id OR LOWER(pay.name) = LOWER(p.insurance_carrier)
        WHERE p.plan_product IS NULL
        ORDER BY p.last_name NULLS LAST, p.first_name NULLS LAST
        LIMIT 500
      `);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch("/api/admin/data-tools/backfill-plan-products/:patientId", requireSuperAdmin, async (req, res) => {
    try {
      const { pool: db } = await import("./db");
      const { planProduct } = req.body;
      const allowed = ['HMO', 'PPO', 'POS', 'EPO', 'Indemnity', 'unknown'];
      if (!planProduct || !allowed.includes(planProduct)) {
        return res.status(400).json({ error: "Invalid plan_product value" });
      }
      const { rows } = await db.query(
        `UPDATE patients SET plan_product = $1, updated_at = NOW() WHERE id = $2 RETURNING id, plan_product`,
        [planProduct, req.params.patientId]
      );
      if (!rows.length) return res.status(404).json({ error: "Patient not found" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── CCI Edits (NCCI) — admin routes ────────────────────────────────────────

  // GET /api/admin/cci/stats — version, counts, last ingestion
  app.get("/api/admin/cci/stats", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const { pool: db } = await import("./db");
      const stats = await db.query(`
        SELECT
          ncci_version,
          COUNT(*)                                            AS total_edits,
          COUNT(*) FILTER (WHERE deletion_date IS NULL)       AS active_edits,
          COUNT(*) FILTER (WHERE modifier_indicator = '0')   AS hard_blocks,
          COUNT(*) FILTER (WHERE modifier_indicator = '1')   AS soft_warnings,
          MAX(ingested_at)                                    AS last_ingested_at
        FROM cci_edits
        GROUP BY ncci_version
        ORDER BY ncci_version DESC
        LIMIT 10
      `);
      res.json(stats.rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/cci/search?code=XXXXX — find conflicts for a given code
  app.get("/api/admin/cci/search", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const { pool: db } = await import("./db");
      const code = (req.query.code as string || "").trim().toUpperCase();
      if (!code) return res.status(400).json({ error: "code query param required" });
      const result = await db.query(`
        SELECT column_1_code, column_2_code, modifier_indicator, ptp_edit_rationale,
               effective_date, deletion_date, ncci_version
        FROM cci_edits
        WHERE deletion_date IS NULL
          AND ncci_version = (SELECT MAX(ncci_version) FROM cci_edits)
          AND (column_1_code = $1 OR column_2_code = $1)
        ORDER BY modifier_indicator, column_1_code, column_2_code
        LIMIT 200
      `, [code]);
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/cci/ingest — trigger ingest from CMS
  app.post("/api/admin/cci/ingest", requireSuperAdmin, async (req, res) => {
    try {
      const { ingestFromCms } = await import("./services/cci-ingest");
      const stats = await ingestFromCms();
      res.json({ success: true, stats });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/admin/cci/upload — manual ZIP or CSV upload
  app.post("/api/admin/cci/upload", requireSuperAdmin, async (req, res) => {
    const multerMod = (await import("multer")).default;
    const cciUpload = multerMod({ storage: multerMod.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
    return cciUpload.single("file")(req, res, async (uploadErr) => {
      if (uploadErr) return res.status(400).json({ error: uploadErr.message });
      try {
        const { ingestCsvBuffer } = await import("./services/cci-ingest");
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });

        const version = (req.body.version as string || "").trim() || "manual_upload";
        const fileName = req.file.originalname;
        let csvBuffer: Buffer;

        if (fileName.toLowerCase().endsWith(".zip")) {
          const os = await import("os");
          const pathMod = await import("path");
          const fs = await import("fs");
          const tmpDir = os.tmpdir();
          const tmpZip = pathMod.join(tmpDir, `cci_upload_${Date.now()}.zip`);
          fs.writeFileSync(tmpZip, req.file.buffer);

          const unzipper = await import("unzipper");
          const files: { name: string; buf: Buffer }[] = [];
          await new Promise<void>((resolve, reject) => {
            fs.createReadStream(tmpZip)
              .pipe(unzipper.Parse())
              .on("entry", (entry: any) => {
                if (entry.path.toLowerCase().endsWith(".csv")) {
                  const chunks: Buffer[] = [];
                  entry.on("data", (d: Buffer) => chunks.push(d));
                  entry.on("end", () => files.push({ name: entry.path, buf: Buffer.concat(chunks) }));
                } else {
                  entry.autodrain();
                }
              })
              .on("close", resolve)
              .on("error", reject);
          });
          fs.unlinkSync(tmpZip);
          if (!files.length) return res.status(400).json({ error: "No CSV found in ZIP" });
          csvBuffer = files[0].buf;
        } else {
          csvBuffer = req.file.buffer;
        }

        const stats = await ingestCsvBuffer(csvBuffer, fileName, version);
        res.json({ success: true, stats });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });
  });

  // GET /api/billing/cci/check?codes=A,B,C — wizard CCI conflict check
  app.get("/api/billing/cci/check", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const { pool: db } = await import("./db");
      const raw = (req.query.codes as string || "").toUpperCase();
      const codes = raw.split(",").map((c) => c.trim()).filter(Boolean);
      if (codes.length < 2) return res.json([]);

      const result = await db.query(`
        SELECT column_1_code, column_2_code, modifier_indicator, ptp_edit_rationale
        FROM cci_edits
        WHERE deletion_date IS NULL
          AND ncci_version = (SELECT MAX(ncci_version) FROM cci_edits WHERE TRUE)
          AND column_1_code = ANY($1)
          AND column_2_code = ANY($1)
          AND modifier_indicator != '9'
      `, [codes]);
      res.json(result.rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Rate Reference Data Admin API (Tasks 2-9) ────────────────────────────

  // GET /api/admin/rate-coverage — coverage stats + sample calculations
  app.get("/api/admin/rate-coverage", requireSuperAdmin, async (req, res) => {
    try {
      const { pool: db } = await import("./db");
      const { getRateCoverageStats } = await import("./services/expected-payment");
      const stats = await getRateCoverageStats(db);
      res.json(stats);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/admin/rate-ingest — trigger CMS + VA rate ingestion
  // Body: { cms?: boolean, va?: boolean, localityOnly?: boolean }
  app.post("/api/admin/rate-ingest", requireSuperAdmin, async (req, res) => {
    const { cms = true, va = true, localityOnly = true } = req.body || {};
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const send = (msg: string) => res.write(`data: ${JSON.stringify({ msg })}\n\n`);
    try {
      const { pool: db } = await import("./db");
      const { runFullIngest } = await import("./services/rate-ingest");
      send("Starting rate data ingest...");
      const results = await runFullIngest(db, { cms, va, localityOnly });
      send(`Ingest complete: ${JSON.stringify(results, null, 2)}`);
      res.write(`data: ${JSON.stringify({ done: true, results })}\n\n`);
    } catch (e: any) {
      send(`Error: ${e.message}`);
      res.write(`data: ${JSON.stringify({ done: true, error: e.message })}\n\n`);
    }
    res.end();
  });

  // GET /api/admin/rate-lookup?code=99213&org=chajinel-org-001 — ad-hoc rate lookup
  app.get("/api/admin/rate-lookup", requireSuperAdmin, async (req, res) => {
    const { code, org = "chajinel-org-001", modifier, facilityType = "non_facility" } = req.query as Record<string, string>;
    if (!code) return res.status(400).json({ error: "code required" });
    try {
      const { pool: db } = await import("./db");
      const { calculateExpectedPayment } = await import("./services/expected-payment");
      const result = await calculateExpectedPayment(db, code, modifier || null, org, new Date(), facilityType as any, "va_community_care");
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── Prompt 06: Rules Database Admin API ──────────────────────────────────

  app.get("/api/admin/rules-database/overview", requireSuperAdmin, async (req, res) => {
    try {
      const { pool: db } = await import("./db");
      const [total, bySectionType, pending, rejected, recent, coverageRows, ncciRow] = await Promise.all([
        db.query(`SELECT COUNT(*)::int AS cnt FROM manual_extraction_items WHERE review_status = 'approved'`),
        db.query(`SELECT section_type, COUNT(*)::int AS cnt FROM manual_extraction_items WHERE review_status = 'approved' GROUP BY section_type ORDER BY cnt DESC`),
        db.query(`SELECT COUNT(*)::int AS cnt FROM manual_extraction_items WHERE review_status = 'pending'`),
        db.query(`SELECT COUNT(*)::int AS cnt FROM manual_extraction_items WHERE review_status = 'rejected'`),
        db.query(`SELECT COUNT(*)::int AS cnt FROM manual_extraction_items WHERE review_status = 'approved' AND COALESCE(last_verified_at, reviewed_at) > NOW() - INTERVAL '7 days'`),
        db.query(`
          SELECT pms.payer_name, pm.id AS manual_id,
                 COUNT(mei.id) FILTER (WHERE mei.review_status = 'approved')::int AS approved_count
          FROM payer_manual_sources pms
          LEFT JOIN payer_source_documents pm ON pm.id = pms.linked_source_document_id
          LEFT JOIN manual_extraction_items mei ON mei.source_document_id = pm.id
          GROUP BY pms.payer_name, pm.id
          ORDER BY pms.priority
          LIMIT 20
        `),
        db.query(`SELECT MAX(ncci_version) AS latest, COUNT(*)::int AS total_edits FROM cci_edits`),
      ]);

      const totalApproved = total.rows[0]?.cnt || 0;
      const coveredPayers = coverageRows.rows.filter((r: any) => (r.approved_count || 0) > 0).length;
      const coveragePct = coverageRows.rows.length > 0
        ? Math.round((coveredPayers / coverageRows.rows.length) * 100)
        : 0;

      res.json({
        totalApproved,
        bySectionType: bySectionType.rows,
        pendingCount: pending.rows[0]?.cnt || 0,
        rejectedCount: rejected.rows[0]?.cnt || 0,
        recentChanges: recent.rows[0]?.cnt || 0,
        coveragePct,
        coveredPayers,
        totalTopPayers: coverageRows.rows.length,
        ncciVersion: ncciRow.rows[0]?.latest || null,
        ncciTotalEdits: ncciRow.rows[0]?.total_edits || 0,
        needsReverification: 0,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/rules-database/freshness", requireSuperAdmin, async (req, res) => {
    try {
      const { pool: db } = await import("./db");
      const { rows } = await db.query(`
        SELECT
          pm.document_name AS payer_name,
          pm.payer_id,
          mei.section_type,
          MAX(COALESCE(mei.last_verified_at, mei.reviewed_at)) AS last_verified,
          EXTRACT(DAY FROM NOW() - MAX(COALESCE(mei.last_verified_at, mei.reviewed_at)))::int AS days_since,
          COUNT(*) FILTER (WHERE mei.review_status = 'approved')::int AS approved_count,
          COUNT(*) FILTER (WHERE mei.needs_reverification = TRUE)::int AS needs_reverification_count
        FROM payer_source_documents pm
        JOIN manual_extraction_items mei ON mei.source_document_id = pm.id
        WHERE mei.review_status = 'approved'
        GROUP BY pm.document_name, pm.payer_id, mei.section_type
        ORDER BY last_verified ASC NULLS FIRST
      `);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/rules-database/history", requireSuperAdmin, async (req, res) => {
    try {
      const { pool: db } = await import("./db");
      const { user: filterUser, payer: filterPayer, change_type: filterType } = req.query;
      const conditions: string[] = [];
      const params: any[] = [];
      if (filterUser) { params.push(`%${filterUser}%`); conditions.push(`h.changed_by ILIKE $${params.length}`); }
      if (filterPayer) { params.push(`%${filterPayer}%`); conditions.push(`h.payer_name ILIKE $${params.length}`); }
      if (filterType) { params.push(filterType); conditions.push(`h.change_type = $${params.length}`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const { rows } = await db.query(`
        SELECT h.id, h.extraction_id, h.changed_at, h.changed_by, h.change_type,
               h.payer_name, h.section_type, h.change_notes,
               h.state_snapshot->>'review_status' AS new_status
        FROM payer_manual_extraction_history h
        ${where}
        ORDER BY h.changed_at DESC
        LIMIT 100
      `, params);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/rules-database/leaderboard", requireSuperAdmin, async (req, res) => {
    try {
      const { pool: db } = await import("./db");
      const { rows } = await db.query(`
        SELECT
          changed_by AS user_email,
          COUNT(*) FILTER (WHERE change_type = 'approved')::int AS rules_approved,
          COUNT(*) FILTER (WHERE change_type IN ('edited','data_corrected'))::int AS rules_edited,
          MAX(changed_at) AS last_activity
        FROM payer_manual_extraction_history
        WHERE changed_by NOT IN ('system','admin','demo@claimshield.ai')
        GROUP BY changed_by
        UNION ALL
        SELECT
          changed_by AS user_email,
          COUNT(*) FILTER (WHERE change_type = 'approved')::int AS rules_approved,
          COUNT(*) FILTER (WHERE change_type IN ('edited','data_corrected'))::int AS rules_edited,
          MAX(changed_at) AS last_activity
        FROM payer_manual_extraction_history
        WHERE changed_by IN ('system','admin','demo@claimshield.ai')
        GROUP BY changed_by
        ORDER BY rules_approved DESC, rules_edited DESC
        LIMIT 20
      `);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/rules-database/cms-conflicts", requireSuperAdmin, async (req, res) => {
    try {
      const { pool: db } = await import("./db");
      // Forward to existing validation sweep
      const { rows } = await db.query(`
        SELECT
          mei.id AS item_id, pm.document_name AS payer_name, mei.section_type,
          mei.extracted_json->>'days' AS extracted_days,
          mei.review_status, mei.needs_reverification,
          COALESCE(mei.last_verified_at, mei.reviewed_at) AS last_verified
        FROM manual_extraction_items mei
        JOIN payer_source_documents pm ON pm.id = mei.source_document_id
        WHERE mei.section_type = 'timely_filing'
          AND mei.review_status = 'approved'
          AND (mei.extracted_json->>'days')::numeric NOT BETWEEN 60 AND 365
        ORDER BY pm.payer_name
      `);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Per-rule extraction history
  app.get("/api/admin/extraction-items/:id/history", requireSuperAdmin, async (req, res) => {
    try {
      const { pool: db } = await import("./db");
      const { rows } = await db.query(`
        SELECT id, changed_at, changed_by, change_type, change_notes,
               state_snapshot->>'review_status' AS status_after,
               state_snapshot->>'extracted_json' AS extracted_snapshot
        FROM payer_manual_extraction_history
        WHERE extraction_id = $1
        ORDER BY changed_at DESC
      `, [req.params.id]);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Mark a rule as needs_reverification (manual trigger)
  app.patch("/api/admin/extraction-items/:id/reverify", requireSuperAdmin, async (req, res) => {
    try {
      const { pool: db } = await import("./db");
      const { rows } = await db.query(
        `UPDATE manual_extraction_items SET needs_reverification = TRUE WHERE id = $1 RETURNING id, needs_reverification`,
        [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: "Not found" });

      // Write history
      const { rows: full } = await db.query(`SELECT mei.*, pm.document_name AS payer_name FROM manual_extraction_items mei JOIN payer_source_documents pm ON pm.id = mei.source_document_id WHERE mei.id = $1`, [req.params.id]);
      if (full.length) {
        await db.query(`
          INSERT INTO payer_manual_extraction_history
            (extraction_id, changed_by, change_type, state_snapshot, change_notes, payer_name, section_type)
          VALUES ($1, $2, 'needs_reverification', $3::jsonb, $4, $5, $6)
        `, [
          req.params.id,
          (req.user as any)?.email || 'system',
          JSON.stringify(full[0]),
          'Flagged for re-verification',
          full[0].payer_name,
          full[0].section_type,
        ]).catch(() => {});
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Scraper API ─────────────────────────────────────────────────────────────

  // POST /api/admin/scrapers/run
  app.post("/api/admin/scrapers/run", requireSuperAdmin, async (req, res) => {
    try {
      const { payer_code, dryRun, allowFallback, triggeredBy } = req.body;
      if (!payer_code) return res.status(400).json({ error: "payer_code required" });

      const { scrapePayerDocuments, isInFlight } = await import("./jobs/scrape-payer-documents");

      if (isInFlight(payer_code)) {
        return res.json({ status: "already_running", payer_code });
      }

      const runId = crypto.randomUUID();

      // Fire and forget — progress streamed via SSE
      scrapePayerDocuments(payer_code, {
        dryRun: dryRun ?? false,
        allowFallback: allowFallback ?? true,
        triggeredBy: triggeredBy ?? "manual_admin",
        userId: (req.user as any)?.id,
      }).catch(err => console.error("[scraper-api] run error:", err.message));

      // Get the actual run_id from scrape_runs (inserted by job)
      // Small delay to let the INSERT happen before returning
      await new Promise(r => setTimeout(r, 200));
      const { pool } = await import("./db");
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM scrape_runs WHERE payer_code=$1 ORDER BY started_at DESC LIMIT 1`,
        [payer_code]
      );

      res.json({ run_id: rows[0]?.id ?? runId, status: "running" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/scrapers/runs/:run_id
  app.get("/api/admin/scrapers/runs/:run_id", requireSuperAdmin, async (req, res) => {
    try {
      const { pool } = await import("./db");
      const { rows } = await pool.query(
        `SELECT * FROM scrape_runs WHERE id=$1`,
        [req.params.run_id]
      );
      if (!rows.length) return res.status(404).json({ error: "Run not found" });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/scrapers/runs/:run_id/stream — SSE progress
  app.get("/api/admin/scrapers/runs/:run_id/stream", requireSuperAdmin, async (req, res) => {
    try {
      const { runId } = { runId: req.params.run_id };
      const { registerSseListener, unregisterSseListener } = await import("./jobs/scrape-payer-documents");

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      const send = (msg: Record<string, unknown>) => {
        try { res.write(`data: ${JSON.stringify(msg)}\n\n`); } catch {}
      };

      const listener = (msg: { stage: string; message: string; payload?: Record<string, unknown> }) => {
        send({ ...msg });
        if (msg.stage === "complete" || msg.stage === "circuit_open") {
          cleanup();
        }
      };

      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        unregisterSseListener(runId, listener);
        try { res.end(); } catch {}
      };

      registerSseListener(runId, listener);
      req.on("close", cleanup);

      // Check if run is already complete — send immediate complete if so
      try {
        const { pool: dbPool } = await import("./db");
        const { rows } = await dbPool.query(
          `SELECT status, report FROM scrape_runs WHERE id=$1`,
          [runId]
        );
        if (rows.length && rows[0].status !== 'running') {
          send({
            stage: "complete",
            message: "Run already completed.",
            payload: rows[0].report ?? {},
          });
          cleanup();
        }
      } catch {
        // non-fatal: SSE listener will still receive live stages
      }
    } catch (err: any) {
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/scrapers/status
  app.get("/api/admin/scrapers/status", requireSuperAdmin, async (req, res) => {
    try {
      const { pool } = await import("./db");
      const { rows: circuits } = await pool.query(`SELECT * FROM scraper_circuit_state`);
      const { rows: lastRuns } = await pool.query(`
        SELECT DISTINCT ON (payer_code)
          payer_code, id, started_at, completed_at, status, used_fallback,
          report->>'documents_new' as documents_new,
          report->>'documents_updated' as documents_updated,
          report->>'documents_unchanged' as documents_unchanged
        FROM scrape_runs ORDER BY payer_code, started_at DESC
      `);
      const { rows: docCounts } = await pool.query(`
        SELECT source_acquisition_method, COUNT(*)::int as count
        FROM payer_source_documents
        WHERE source_acquisition_method = 'scraped'
        GROUP BY 1
      `);
      // 7-day unlinked supplement warning
      const { rows: unlinked } = await pool.query(`
        SELECT COUNT(*)::int as count
        FROM payer_source_documents
        WHERE document_type = 'supplement'
          AND parent_document_id IS NULL
          AND source_acquisition_method = 'scraped'
          AND created_at < NOW() - INTERVAL '7 days'
      `);

      const payers = ["uhc"];
      const status = payers.map(code => ({
        payer_code: code,
        circuit: circuits.find(c => c.payer_code === code) ?? { state: 'closed', consecutive_errors: 0 },
        last_run: lastRuns.find(r => r.payer_code === code) ?? null,
        documents_tracked: docCounts.find(d => d.source_acquisition_method === 'scraped')?.count ?? 0,
      }));

      res.json({
        scrapers: status,
        unlinked_supplement_warning: (unlinked[0]?.count ?? 0) > 0
          ? `${unlinked[0].count} supplement(s) have been unlinked for >7 days — URL year-prefix matching may need review`
          : null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/scrapers/circuit/:payer_code/reset
  app.post("/api/admin/scrapers/circuit/:payer_code/reset", requireSuperAdmin, async (req, res) => {
    try {
      const { reason } = req.body;
      if (!reason) return res.status(400).json({ error: "reason required" });
      const { resetCircuit } = await import("./scrapers/runtime");
      await resetCircuit(req.params.payer_code, reason);
      res.json({ success: true, payer_code: req.params.payer_code });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/scrapers/runs — last 20 runs across all payers
  app.get("/api/admin/scrapers/runs", requireSuperAdmin, async (req, res) => {
    try {
      const { pool } = await import("./db");
      const { rows } = await pool.query(`
        SELECT id, payer_code, started_at, completed_at, status, used_fallback,
               triggered_by, triggered_by_user_id,
               report->>'documents_discovered' as documents_discovered,
               report->>'documents_new' as documents_new,
               report->>'documents_updated' as documents_updated,
               report->>'documents_unchanged' as documents_unchanged,
               report->>'bulletins_discovered' as bulletins_discovered,
               jsonb_array_length(COALESCE(report->'errors','[]'::jsonb)) as error_count,
               report
        FROM scrape_runs
        ORDER BY started_at DESC LIMIT 20
      `);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/admin/scrapers/discoveries
  app.get("/api/admin/scrapers/discoveries", requireSuperAdmin, async (req, res) => {
    try {
      const { pool } = await import("./db");
      const days = parseInt(req.query.days as string) || 30;
      const payerCode = req.query.payer_code as string | undefined;
      const docType = req.query.document_type as string | undefined;
      const runId = req.query.run_id as string | undefined;

      const conditions = [
        `psd.source_acquisition_method IN ('scraped','bulletin_triggered')`,
        `psd.created_at >= NOW() - INTERVAL '${days} days'`,
      ];
      const params: unknown[] = [];

      if (payerCode) { params.push(payerCode); conditions.push(`p.name ILIKE '%' || $${params.length} || '%'`); }
      if (docType) { params.push(docType); conditions.push(`psd.document_type = $${params.length}`); }
      if (runId) { conditions.push(`psd.notes LIKE '%run_id:${runId}%'`); }

      const { rows } = await pool.query(`
        SELECT psd.id, psd.document_name, psd.document_type, psd.source_url_canonical,
               psd.source_acquisition_method, psd.created_at, psd.scrape_status,
               psd.content_hash, psd.last_scraped_at, psd.notes,
               p.name as payer_name,
               COUNT(mei.id)::int as extraction_count
        FROM payer_source_documents psd
        LEFT JOIN payers p ON p.id = psd.payer_id
        LEFT JOIN manual_extraction_items mei ON mei.source_document_id = psd.id
        WHERE ${conditions.join(" AND ")}
        GROUP BY psd.id, p.name
        ORDER BY psd.created_at DESC
        LIMIT 100
      `, params);

      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Crawler monitoring endpoints ──────────────────────────────────────────

  // GET /api/admin/scrapers/monitor/log — last 50 monitor events
  app.get("/api/admin/scrapers/monitor/log", requireSuperAdmin, async (req, res) => {
    try {
      const { pool } = await import("./db");
      const limit = Math.min(parseInt(req.query.limit as string || "50"), 200);
      const { rows } = await pool.query(`
        SELECT id, event_type, alert_level, payer_code, run_id, payload, created_at
        FROM scraper_monitor_log
        ORDER BY created_at DESC LIMIT $1
      `, [limit]);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/scrapers/monitor/assertions — re-run assertions on the most recent run
  app.post("/api/admin/scrapers/monitor/assertions", requireSuperAdmin, async (req, res) => {
    try {
      const payerCode = (req.body.payer_code as string) || "uhc";
      const { pool } = await import("./db");
      const { rows } = await pool.query(`
        SELECT id, report, status FROM scrape_runs
        WHERE payer_code = $1 ORDER BY started_at DESC LIMIT 1
      `, [payerCode]);
      if (!rows.length) return res.status(404).json({ error: "No runs found for payer" });

      const { runPostScrapeAssertions, determineAlertLevel, fireWebhook, logMonitorEvent } = await import("./services/scraper-monitor");
      const run = rows[0];
      const report = run.report ?? {};
      report.payer_code = report.payer_code ?? payerCode;
      report.errors = report.errors ?? [];

      const assertions = await runPostScrapeAssertions(run.id, report, payerCode);
      const alertLevel = determineAlertLevel(report, run.status, assertions);

      const payload = {
        type: "scrape_complete" as const,
        alert_level: alertLevel,
        payer_code: payerCode,
        triggered_by: "manual_assertions",
        run_id: run.id,
        report,
        assertions,
        timestamp: new Date().toISOString(),
        env: process.env.NODE_ENV ?? "development",
      };

      await Promise.all([fireWebhook(payload), logMonitorEvent(payload)]);
      res.json({ success: true, alert_level: alertLevel, assertions });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/scrapers/monitor/synthetic-test — run synthetic E2E test now
  app.post("/api/admin/scrapers/monitor/synthetic-test", requireSuperAdmin, async (req, res) => {
    try {
      const payerCode = (req.body.payer_code as string) || "uhc";
      const { triggerSyntheticTestNow } = await import("./jobs/scraper-cron");
      // Run async; respond immediately with acceptance, result goes to webhook + log
      triggerSyntheticTestNow().catch(err =>
        console.error("[monitor-api] Synthetic test error:", err.message)
      );
      res.json({ success: true, message: "Synthetic test started. Results will be logged and sent to webhook if configured." });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/scrapers/monitor/daily-scrape — trigger daily cron scrape now (admin/dev)
  app.post("/api/admin/scrapers/monitor/daily-scrape", requireSuperAdmin, async (req, res) => {
    try {
      const { triggerDailyScrapeNow } = await import("./jobs/scraper-cron");
      triggerDailyScrapeNow().catch(err =>
        console.error("[monitor-api] Daily scrape trigger error:", err.message)
      );
      res.json({ success: true, message: "Daily cron scrape started for all configured payers." });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

}

// ── Stedi 277CA polling job ─────────────────────────────────────────────────
async function pollStedi277Acknowledgments() {
  const { isStediConfigured, poll277Acknowledgments } = await import("./services/stedi-claims").catch(() => ({ isStediConfigured: () => false, poll277Acknowledgments: async () => ({ acknowledgments: [], lastCheckTimestamp: "" }) }));
  if (!isStediConfigured()) return;
  try {
    const db = await import("./db").then(m => m.pool);
    const settingRow = await db.query("SELECT value FROM system_settings WHERE key = 'stedi_last_277_poll'").catch(() => ({ rows: [] as any[] }));
    const since = settingRow.rows[0]?.value || new Date(Date.now() - 86400000).toISOString();
    const { acknowledgments, lastCheckTimestamp } = await poll277Acknowledgments(since);
    for (const ack of acknowledgments) {
      if (!ack.claimControlNumber && !ack.transactionId) continue;
      const claimResult = await db.query(
        `SELECT id, status, organization_id FROM claims WHERE id = $1 OR stedi_transaction_id = $2 LIMIT 1`,
        [ack.claimControlNumber, ack.transactionId]
      );
      if (!claimResult.rows.length) continue;
      const claim = claimResult.rows[0];
      let newStatus: string;
      if (ack.status === "4") newStatus = "rejected";
      else if (ack.status === "1" || ack.status === "3") newStatus = "acknowledged";
      else continue;
      if (claim.status !== "submitted") continue;
      await db.query("UPDATE claims SET status = $1, updated_at = NOW() WHERE id = $2", [newStatus, claim.id]);
      await db.query(
        `INSERT INTO claim_events (id, claim_id, type, notes, timestamp, organization_id) VALUES ($1, $2, $3, $4, NOW(), $5)`,
        [crypto.randomUUID(), claim.id, "277CA Received", `Payer acknowledgment: ${ack.statusDescription}. Payer: ${ack.payer}`, claim.organization_id]
      );
    }
    await db.query(
      `INSERT INTO system_settings (key, value, updated_at) VALUES ('stedi_last_277_poll', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [lastCheckTimestamp]
    );
  } catch (err) {
    console.warn("[277 Poll] Unexpected error:", err);
  }
}

function parse835Manual(content: string) {
  try {
    const segments = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split(/~\n?|~/).filter(Boolean);
    let checkNumber = ""; let checkDate = ""; let payerName = "Unknown"; let totalPayment = 0;
    const claimLines: any[] = [];
    let currentClaim: any = null;

    for (const seg of segments) {
      const el = seg.trim().split("*");
      const id = el[0];
      if (id === "BPR") { totalPayment = parseFloat(el[2] || "0"); checkDate = el[16] || ""; }
      else if (id === "TRN") { checkNumber = el[2] || ""; }
      else if (id === "N1" && el[1] === "PR") { payerName = el[2] || "Unknown"; }
      else if (id === "CLP") {
        if (currentClaim) claimLines.push(currentClaim);
        currentClaim = {
          claimControlNumber: el[1] || "", patientName: "", billedAmount: parseFloat(el[3] || "0"),
          allowedAmount: parseFloat(el[4] || "0"), paidAmount: parseFloat(el[4] || "0"), adjustments: [],
        };
      } else if (id === "NM1" && el[1] === "QC" && currentClaim) {
        currentClaim.patientName = [el[4], el[3]].filter(Boolean).join(" ");
      } else if (id === "CAS" && currentClaim) {
        currentClaim.adjustments.push({ code: `${el[1]}-${el[2]}`, amount: parseFloat(el[3] || "0"), reason: el[2] || "" });
      }
    }
    if (currentClaim) claimLines.push(currentClaim);
    if (!checkNumber && !claimLines.length) return null;
    return { checkNumber, checkDate, payerName, totalPayment, claimLines };
  } catch { return null; }
}

// ── Stedi 835 ERA polling job ───────────────────────────────────────────────
async function pollStedi835ERA() {
  const { isStediConfigured, poll835ERA } = await import("./services/stedi-claims").catch(() => ({ isStediConfigured: () => false, poll835ERA: async () => ({ eras: [], lastCheckTimestamp: "" }) }));
  if (!isStediConfigured()) return;
  try {
    const db = await import("./db").then(m => m.pool);
    const settingRow = await db.query("SELECT value FROM system_settings WHERE key = 'stedi_last_835_poll'").catch(() => ({ rows: [] as any[] }));
    const since = settingRow.rows[0]?.value || new Date(Date.now() - 7 * 86400000).toISOString();
    const { eras, lastCheckTimestamp } = await poll835ERA(since);
    for (const era of eras) {
      const existing = await db.query("SELECT id FROM era_batches WHERE check_number = $1 LIMIT 1", [era.checkNumber]);
      if (existing.rows.length) continue;
      let orgId: string | null = null;
      for (const line of era.claimLines) {
        const claimRow = await db.query("SELECT organization_id FROM claims WHERE id = $1 LIMIT 1", [line.claimControlNumber]);
        if (claimRow.rows[0]?.organization_id) { orgId = claimRow.rows[0].organization_id; break; }
      }
      const eraId = crypto.randomUUID();
      await db.query(
        `INSERT INTO era_batches (id, org_id, payer_name, check_number, payment_date, total_amount, status, stedi_era_id, raw_data, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'unposted', $7, $8, NOW())`,
        [eraId, orgId, era.payerName, era.checkNumber, era.checkDate, era.totalPayment, era.eraId, JSON.stringify(era.rawData)]
      );
      for (const line of era.claimLines) {
        const claimRow = await db.query("SELECT id FROM claims WHERE id = $1 LIMIT 1", [line.claimControlNumber]);
        const matchedClaimId = claimRow.rows[0]?.id || null;
        const serviceLines = line.adjustments.map((adj: any) => ({
          carc: adj.code,
          carc_desc: adj.reason,
          billed: line.billedAmount,
          allowed: line.allowedAmount,
          paid: line.paidAmount,
        }));
        await db.query(
          `INSERT INTO era_lines (id, era_id, claim_id, org_id, patient_name, billed_amount, allowed_amount, paid_amount, service_lines, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())`,
          [crypto.randomUUID(), eraId, matchedClaimId, orgId, line.patientName, line.billedAmount, line.allowedAmount, line.paidAmount, JSON.stringify(serviceLines)]
        );
      }
      console.log(`[835 Poll] Imported ERA: ${era.checkNumber} — $${era.totalPayment}`);
    }
    await db.query(
      `INSERT INTO system_settings (key, value, updated_at) VALUES ('stedi_last_835_poll', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [lastCheckTimestamp]
    );
  } catch (err) {
    console.warn("[835 Poll] Unexpected error:", err);
  }
}

// Start polling jobs (run immediately, then on schedule)
setTimeout(() => {
  pollStedi277Acknowledgments();
  setInterval(pollStedi277Acknowledgments, 4 * 60 * 60 * 1000); // Every 4 hours (webhooks are primary)
  pollStedi835ERA();
  setInterval(pollStedi835ERA, 24 * 60 * 60 * 1000); // Every 24 hours (webhooks are primary)
}, 5000); // 5-second delay after startup to allow DB migrations to complete

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
