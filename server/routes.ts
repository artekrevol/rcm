import type { Express } from "express";
import type { Server } from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
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

function diagPointerToNumeric(ptr: string): string {
  const map: Record<string, string> = { A: "1", B: "2", C: "3", D: "4" };
  return String(ptr).split(":").map(p => map[p.toUpperCase()] || p).join(":");
}

function verifyOrg(entity: any, req: any): boolean {
  if (!entity) return true;
  const orgId = getOrgId(req);
  if (!orgId) return true;
  const entityOrgId = entity.organizationId || entity.organization_id;
  return entityOrgId === orgId;
}

export async function registerRoutes(server: Server, app: Express): Promise<void> {

  try {
    const { pool } = await import("./db");

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
    // Sprint-2 schema additions
    await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_dismissed_at TIMESTAMP`);
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS default_tos VARCHAR`);
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS default_ordering_provider_id VARCHAR`);
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS homebound_default BOOLEAN DEFAULT true`);
    await pool.query(`ALTER TABLE practice_settings ADD COLUMN IF NOT EXISTS exclude_facility BOOLEAN DEFAULT true`);
    await pool.query(`ALTER TABLE payers ADD COLUMN IF NOT EXISTS auto_followup_days INTEGER DEFAULT 30`);
    await pool.query(`ALTER TABLE payers ADD COLUMN IF NOT EXISTS era_auto_post_clean BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE payers ADD COLUMN IF NOT EXISTS era_auto_post_contractual BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE payers ADD COLUMN IF NOT EXISTS era_auto_post_secondary BOOLEAN DEFAULT true`);
    await pool.query(`ALTER TABLE payers ADD COLUMN IF NOT EXISTS era_auto_post_refunds BOOLEAN DEFAULT true`);
    await pool.query(`ALTER TABLE payers ADD COLUMN IF NOT EXISTS era_hold_if_mismatch BOOLEAN DEFAULT true`);
    await pool.query(`UPDATE payers SET era_auto_post_clean = true, era_auto_post_contractual = true WHERE payer_id IN ('VACCN', 'TWVACCN') AND (era_auto_post_clean = false OR era_auto_post_clean IS NULL)`);

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
      const superPwd = process.env.SUPER_ADMIN_PASSWORD || 'admin123';
      if (!process.env.SUPER_ADMIN_PASSWORD) {
        console.warn("WARNING: SUPER_ADMIN_PASSWORD not set — using default 'admin123'. Set this env var in production!");
      }
      const hashed = await hashPassword(superPwd);
      const { rows: saCheck } = await pool.query("SELECT id FROM users WHERE email = 'abeer@tekrevol.com'");
      if (saCheck.length === 0) {
        await pool.query(
          "INSERT INTO users (id, email, password, role, name, organization_id) VALUES (gen_random_uuid()::text, 'abeer@tekrevol.com', $1, 'super_admin', 'Abeer (Platform Admin)', NULL)",
          [hashed]
        );
        console.log("Created super_admin user: abeer@tekrevol.com");
      } else {
        await pool.query("UPDATE users SET password = $1, role = 'super_admin' WHERE email = 'abeer@tekrevol.com'", [hashed]);
        console.log("Synced super_admin password: abeer@tekrevol.com");
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
      res.json({
        found: true,
        entityType: result.enumeration_type === "NPI-1" ? "individual" : "organization",
        firstName: basic.first_name || "",
        lastName: basic.last_name || basic.organization_name || "",
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
      const { rows } = await import("./db").then(m => m.pool.query("SELECT * FROM payers ORDER BY is_active DESC, name"));
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
      const { firstName, lastName, credentials, npi, taxonomyCode, individualTaxId, licenseNumber, isDefault } = req.body;
      if (!firstName?.trim() || !lastName?.trim() || !npi?.trim()) {
        return res.status(400).json({ error: "firstName, lastName, and npi are required" });
      }
      const { validateNPI } = await import("../shared/npi-validation");
      if (!validateNPI(npi)) {
        return res.status(400).json({ error: "Invalid NPI — must be 10 digits and pass the NPI checksum" });
      }
      const db = await import("./db").then(m => m.pool);
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        if (isDefault) {
          await client.query("UPDATE providers SET is_default = false WHERE organization_id = $1 AND is_default = true", [orgId]);
        }
        const { rows } = await client.query(
          `INSERT INTO providers (id, first_name, last_name, credentials, npi, taxonomy_code, individual_tax_id, license_number, is_default, organization_id)
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [firstName.trim(), lastName.trim(), credentials || null, npi, taxonomyCode || null, individualTaxId || null, licenseNumber || null, isDefault || false, orgId]
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
      const { firstName, lastName, credentials, npi, taxonomyCode, individualTaxId, licenseNumber, isDefault, isActive } = req.body;
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
        if (firstName !== undefined) { fields.push(`first_name = $${idx++}`); values.push(firstName); }
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
      const { practiceName, primaryNpi, taxId, taxonomyCode, address, phone, defaultPos, billingLocation, oa_submitter_id, oa_sftp_username, oa_sftp_password, defaultTos, defaultOrderingProviderId, homeboundDefault, excludeFacility } = req.body;
      const orgId = getOrgId(req);
      const db = await import("./db").then(m => m.pool);
      const existing = orgId
        ? await db.query("SELECT id FROM practice_settings WHERE organization_id = $1 LIMIT 1", [orgId])
        : await db.query("SELECT id FROM practice_settings LIMIT 1");
      if (existing.rows.length > 0) {
        let query = `UPDATE practice_settings SET practice_name=$1, primary_npi=$2, tax_id=$3, taxonomy_code=$4, address=$5, phone=$6, default_pos=$7, billing_location=$9, updated_at=NOW()`;
        const params: any[] = [practiceName, primaryNpi, taxId, taxonomyCode, JSON.stringify(address || {}), phone, defaultPos || '11', existing.rows[0].id, billingLocation || null];
        if (oa_submitter_id !== undefined) { query += `, oa_submitter_id=$${params.length + 1}`; params.push(oa_submitter_id); }
        if (oa_sftp_username !== undefined) { query += `, oa_sftp_username=$${params.length + 1}`; params.push(oa_sftp_username); }
        if (oa_sftp_password !== undefined) { query += `, oa_sftp_password=$${params.length + 1}`; params.push(oa_sftp_password); }
        if (defaultTos !== undefined) { query += `, default_tos=$${params.length + 1}`; params.push(defaultTos || null); }
        if (defaultOrderingProviderId !== undefined) { query += `, default_ordering_provider_id=$${params.length + 1}`; params.push(defaultOrderingProviderId || null); }
        if (homeboundDefault !== undefined) { query += `, homebound_default=$${params.length + 1}`; params.push(homeboundDefault); }
        if (excludeFacility !== undefined) { query += `, exclude_facility=$${params.length + 1}`; params.push(excludeFacility); }
        query += ` WHERE id=$8 RETURNING *`;
        const { rows } = await db.query(query, params);
        res.json(rows[0]);
      } else {
        const { rows } = await db.query(
          `INSERT INTO practice_settings (id, practice_name, primary_npi, tax_id, taxonomy_code, address, phone, default_pos, billing_location, organization_id, default_tos, default_ordering_provider_id, homebound_default, exclude_facility)
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
          [practiceName, primaryNpi, taxId, taxonomyCode, JSON.stringify(address || {}), phone, defaultPos || '12', billingLocation || null, orgId || null, defaultTos || null, defaultOrderingProviderId || null, homeboundDefault ?? true, excludeFacility ?? true]
        );
        res.json(rows[0]);
      }
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

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
      const location = (req.query.location as string || "").trim().toUpperCase();
      if (!code) return res.status(400).json({ error: "code is required" });
      const db = await import("./db").then(m => m.pool);
      if (location) {
        const { rows } = await db.query(
          `SELECT vlr.facility_rate as rate_per_unit, vlr.location_name,
                  hc.unit_type, hc.unit_interval_minutes, hc.description_plain
           FROM va_location_rates vlr
           LEFT JOIN hcpcs_codes hc ON hc.code = vlr.hcpcs_code
           WHERE vlr.hcpcs_code = $1 AND UPPER(vlr.location_name) = $2
             AND vlr.is_non_reimbursable = false
           LIMIT 1`,
          [code, location]
        );
        if (rows.length > 0) return res.json(rows[0]);
      }
      // Section 9: use practice default locality if no location passed
      const DEFAULT_LOCALITY = 'SAN FRANCISCO-OAKLAND-BERKELEY (ALAMEDA/CONTRA COSTA CNTY)';
      const settingRow = await db.query(
        `SELECT value FROM practice_settings WHERE key = 'default_va_locality' LIMIT 1`
      ).catch(() => ({ rows: [] as any[] }));
      const defaultLocality = (settingRow.rows[0]?.value || DEFAULT_LOCALITY).toUpperCase();
      const { rows: locRows } = await db.query(
        `SELECT facility_rate as rate_per_unit, location_name,
                hc.unit_type, hc.unit_interval_minutes, hc.description_plain
         FROM va_location_rates vlr
         LEFT JOIN hcpcs_codes hc ON hc.code = vlr.hcpcs_code
         WHERE vlr.hcpcs_code = $1 AND UPPER(vlr.location_name) = $2
           AND vlr.is_non_reimbursable = false
         LIMIT 1`,
        [code, defaultLocality]
      );
      if (locRows.length > 0) {
        return res.json({ ...locRows[0], is_default_locality: true });
      }
      const { rows: avgRows } = await db.query(
        `SELECT ROUND(AVG(facility_rate)::numeric, 2) as rate_per_unit
         FROM va_location_rates
         WHERE hcpcs_code = $1 AND is_non_reimbursable = false`,
        [code]
      );
      res.json({
        rate_per_unit: avgRows[0]?.rate_per_unit || null,
        location_name: null,
        is_average: true,
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

  // ── Claim Tracker ─────────────────────────────────────────────────────────
  app.get("/api/billing/claim-tracker", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const orgId = getOrgId(req);
      const { status, payer_id, patient, q, date_from, date_to } = req.query;

      let baseQuery = `
        SELECT c.*,
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

      if (orgId) { baseQuery += ` AND c.organization_id = $${idx}`; params.push(orgId); idx++; }
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

      if (resubmit) {
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
      const orgId = getOrgId(req);
      const params: any[] = [];
      let query = `SELECT eb.*, COUNT(el.id) as line_count FROM era_batches eb LEFT JOIN era_lines el ON el.era_id = eb.id WHERE 1=1`;
      let idx = 1;
      if (orgId) { query += ` AND eb.org_id = $${idx}`; params.push(orgId); idx++; }
      query += ` GROUP BY eb.id ORDER BY eb.created_at DESC`;
      const { rows } = await db.query(query, params);
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
      const [pipelineResult, appointmentsResult, chatsResult] = await Promise.all([
        db.query(`
          SELECT l.status, COUNT(*)::int as count,
            COUNT(*) FILTER (WHERE l.sla_deadline_at IS NOT NULL AND l.sla_deadline_at < NOW())::int as sla_breach_count
          FROM leads l
          GROUP BY l.status
        `),
        db.query(`
          SELECT a.id, a.title, a.scheduled_at, a.status, l.name as lead_name
          FROM appointments a
          LEFT JOIN leads l ON a.lead_id = l.id
          WHERE DATE(a.scheduled_at) = CURRENT_DATE
          ORDER BY a.scheduled_at ASC
        `),
        db.query(`
          SELECT cs.id, cs.status, cs.started_at, l.name as lead_name
          FROM chat_sessions cs
          LEFT JOIN leads l ON cs.lead_id = l.id
          ORDER BY cs.started_at DESC
          LIMIT 5
        `),
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
      const orgId = getOrgId(req);
      const orgFilter = orgId ? `AND organization_id = '${orgId.replace(/'/g, "''")}'` : "";
      const orgPatientFilter = orgId ? `AND p.organization_id = '${orgId.replace(/'/g, "''")}'` : "";
      const orgClaimFilter = orgId ? `AND c.organization_id = '${orgId.replace(/'/g, "''")}'` : "";

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
            WHERE c.service_date IS NOT NULL
              AND c.status NOT IN ('paid', 'denied', 'draft')
              AND c.service_date < NOW() - ((COALESCE(p.timely_filing_days, 365) - 30) || ' days')::interval
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
      const { rows } = await db.query(`
        SELECT pa.*,
          COALESCE(p.first_name || ' ' || p.last_name, 'Unknown') as patient_name,
          pa.payer as payer_name,
          c.id as claim_id
        FROM prior_authorizations pa
        LEFT JOIN patients p ON pa.patient_id = p.id
        LEFT JOIN claims c ON c.encounter_id = pa.encounter_id
        ORDER BY pa.requested_date DESC
      `);
      res.json(rows);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/billing/activity-logs", requireRole("admin"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const { startDate, endDate, activityType, performedBy } = req.query;
      let query = `
        SELECT al.*, u.email as user_email
        FROM activity_logs al
        LEFT JOIN users u ON al.performed_by::text = u.id::text
        WHERE (al.claim_id IS NOT NULL OR al.patient_id IS NOT NULL)
      `;
      const params: any[] = [];
      let idx = 1;
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
      const params = [start, end];

      switch (type) {
        case "access":
          query = `SELECT al.*, u.email as user_email FROM activity_logs al LEFT JOIN users u ON al.performed_by::text = u.id::text WHERE al.activity_type IN ('view_patient','view_claim','exported','export_pdf') AND al.created_at BETWEEN $1 AND $2 ORDER BY al.created_at DESC LIMIT 500`;
          break;
        case "edit-history":
          query = `SELECT al.*, u.email as user_email FROM activity_logs al LEFT JOIN users u ON al.performed_by::text = u.id::text WHERE al.field IS NOT NULL AND al.created_at BETWEEN $1 AND $2 ORDER BY al.created_at DESC LIMIT 500`;
          break;
        case "export":
          query = `SELECT al.*, u.email as user_email, c.amount, c.status as claim_status FROM activity_logs al LEFT JOIN users u ON al.performed_by::text = u.id::text LEFT JOIN claims c ON al.claim_id::text = c.id::text WHERE al.activity_type = 'export_pdf' AND al.created_at BETWEEN $1 AND $2 ORDER BY al.created_at DESC LIMIT 500`;
          break;
        case "claims-integrity":
          query = `SELECT c.id, c.status, c.amount, c.created_at, c.updated_at, c.service_date, c.readiness_status, c.submission_method, COALESCE(p.first_name || ' ' || p.last_name, 'Unknown') as patient_name FROM claims c LEFT JOIN patients p ON c.patient_id = p.id WHERE c.created_at BETWEEN $1 AND $2 ORDER BY c.created_at DESC LIMIT 500`;
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
      const [providers, payers, settings] = await Promise.all([
        db.query("SELECT id, first_name, last_name, credentials, npi, is_default FROM providers WHERE is_active = true ORDER BY last_name"),
        db.query("SELECT id, name, payer_id, timely_filing_days, auth_required, is_active FROM payers ORDER BY name"),
        getOrgId(req) 
          ? db.query("SELECT * FROM practice_settings WHERE organization_id = $1 LIMIT 1", [getOrgId(req)])
          : db.query("SELECT * FROM practice_settings LIMIT 1"),
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
      const db = await import("./db").then(m => m.pool);
      const patient = await db.query("SELECT * FROM patients WHERE id = $1", [patientId]);
      if (patient.rows.length === 0) return res.status(404).json({ error: "Patient not found" });
      const p = patient.rows[0];

      const encounterId = crypto.randomUUID();
      const claimId = crypto.randomUUID();
      const now = new Date();

      await db.query(
        `INSERT INTO encounters (id, patient_id, service_type, facility_type, admission_type, expected_start_date, created_by, created_at)
         VALUES ($1, $2, 'Home Health', 'Home', 'Elective', $3, $4, $5)`,
        [encounterId, patientId, now.toISOString().split("T")[0], (req.user as any)?.email || null, now]
      );

      await db.query(
        `INSERT INTO claims (id, organization_id, patient_id, encounter_id, payer, cpt_codes, amount, status, risk_score, readiness_status, created_at, payer_id, authorization_number, created_by)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, 0, 'draft', 0, 'GREEN', $7, $8, $9, $10)`,
        [claimId, getOrgId(req), patientId, encounterId, p.insurance_carrier || 'Unknown', '[]', now, p.payer_id || null, p.authorization_number || null, (req.user as any)?.email || null]
      );

      await db.query(
        `INSERT INTO claim_events (id, claim_id, type, timestamp, notes)
         VALUES ($1, $2, 'Created', $3, 'Claim created via wizard')`,
        [crypto.randomUUID(), claimId, now]
      );

      await db.query(
        `INSERT INTO activity_logs (id, claim_id, patient_id, activity_type, description, performed_by) VALUES ($1, $2, $3, $4, $5, $6)`,
        [crypto.randomUUID(), claimId, patientId, 'created', 'Claim draft created via wizard', (req.user as any)?.id || null]
      );

      res.status(201).json({ claimId, encounterId });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
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
      const claimResult = await db.query("SELECT * FROM claims WHERE id = $1", [req.params.id]);
      if (claimResult.rows.length === 0) return res.status(404).json({ error: "Claim not found" });
      const claim = claimResult.rows[0];
      if (!verifyOrg(claim, req)) return res.status(404).json({ error: "Claim not found" });

      const patientResult = await db.query(
        `SELECT p.*, l.name as lead_name FROM patients p LEFT JOIN leads l ON p.lead_id = l.id WHERE p.id = $1`,
        [claim.patient_id]
      );
      const patient = patientResult.rows[0];

      let score = 0;
      const factors: string[] = [];

      if (!patient?.first_name || !patient?.last_name) { score += 15; factors.push("Patient name incomplete"); }
      if (!patient?.dob) { score += 10; factors.push("Patient DOB missing"); }
      if (!patient?.insurance_carrier) { score += 20; factors.push("No insurance carrier"); }
      if (!patient?.member_id) { score += 15; factors.push("No member ID"); }
      if (!patient?.vob_verified) { score += 10; factors.push("VOB not verified"); }
      if (!claim.authorization_number) {
        const payer = await db.query("SELECT auth_required FROM payers WHERE name = $1 OR id = $2", [claim.payer, claim.payer_id]);
        if (payer.rows[0]?.auth_required) { score += 15; factors.push("Authorization required but missing"); }
      }
      if (!claim.icd10_primary) { score += 20; factors.push("Primary diagnosis missing"); }
      const serviceLines = claim.service_lines || [];
      if (serviceLines.length === 0) { score += 20; factors.push("No service lines"); }
      if (claim.charge_overridden) { score += 5; factors.push("Charge manually overridden"); }

      const serviceDate = claim.service_date;
      if (serviceDate) {
        const daysSince = Math.floor((Date.now() - new Date(serviceDate).getTime()) / 86400000);
        const payerResult = await db.query("SELECT timely_filing_days FROM payers WHERE name = $1 OR id = $2", [claim.payer, claim.payer_id]);
        const filingLimit = payerResult.rows[0]?.timely_filing_days || 365;
        if (daysSince > filingLimit * 0.8) { score += 15; factors.push(`Service date ${daysSince} days ago — approaching ${filingLimit}-day filing limit`); }
      }

      const riskScore = Math.min(score, 100);
      const readinessStatus = riskScore >= 60 ? "RED" : riskScore >= 30 ? "YELLOW" : "GREEN";

      await db.query(
        "UPDATE claims SET risk_score = $1, readiness_status = $2, updated_at = NOW() WHERE id = $3",
        [riskScore, readinessStatus, req.params.id]
      );

      res.json({ riskScore, readinessStatus, factors });
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
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
             AND (coverage_end_date IS NULL OR coverage_end_date >= $4::date)
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
      if (!hasOrderingProv) {
        const payerNameForOP = (c.payer || "").toLowerCase();
        if (payerNameForOP.includes("va") || payerNameForOP.includes("triwest") || payerNameForOP.includes("vaccn")) {
          warnings.push({ field: "claim.ordering_provider", message: "VA claims typically require an ordering/referring provider. Consider adding one.", severity: "warning" });
        }
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

      // Payer checks
      let payerInfo = { name: c.payer || "Unknown", payer_id: "UNKNOWN" };
      if (c.payer_id) {
        const pr = await db.query("SELECT name, payer_id FROM payers WHERE id = $1", [c.payer_id]);
        if (pr.rows.length) payerInfo = pr.rows[0];
      } else if (c.payer) {
        const pr = await db.query("SELECT name, payer_id FROM payers WHERE LOWER(name) = LOWER($1)", [c.payer]);
        if (pr.rows.length) payerInfo = pr.rows[0];
      }
      if (!payerInfo.payer_id || payerInfo.payer_id === "UNKNOWN")
        warnings.push({ field: "payer.payer_id", message: `Payer "${payerInfo.name}" has no EDI Payer ID configured`, severity: "error" });

      // Rendering provider checks
      let provId = c.provider_id;
      if (!provId) {
        const dp = await db.query("SELECT id FROM providers WHERE is_default = true AND is_active = true LIMIT 1");
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

      const payerNameLower = (payerInfo.name || c.payer || "").toLowerCase();
      const isVA = payerNameLower.includes("va") || payerNameLower.includes("veterans") || payerNameLower.includes("triwest") || payerNameLower.includes("vaccn");
      const isMedicare = payerNameLower.includes("medicare");

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
          const isVAPayer2 = payerInfo.payer_id === 'TWVACCN' ||
            payerInfo.name?.toLowerCase().includes('triwest') ||
            payerInfo.name?.toLowerCase().includes('va community');
          violated = isVAPayer2 && !c.authorization_number;
        } else if (ct === 'va_wrong_pos') {
          const isVAPayer3 = payerInfo.payer_id === 'TWVACCN';
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
        const defaultProv = await db.query("SELECT id FROM providers WHERE is_default = true AND is_active = true LIMIT 1");
        if (defaultProv.rows.length) provId = defaultProv.rows[0].id;
      }
      let prov = { first_name: "Rendering", last_name: "Provider", npi: ps.primary_npi || "0000000000", taxonomy_code: ps.taxonomy_code || "163W00000X" };
      if (provId) {
        const provResult = await db.query("SELECT first_name, last_name, npi, taxonomy_code FROM providers WHERE id = $1", [provId]);
        if (provResult.rows.length) prov = provResult.rows[0];
      }

      let payerInfo = { name: c.payer || "Unknown", payer_id: "UNKNOWN" };
      if (c.payer_id) {
        const payerResult = await db.query("SELECT name, payer_id FROM payers WHERE id = $1", [c.payer_id]);
        if (payerResult.rows.length) payerInfo = payerResult.rows[0];
      } else if (c.payer) {
        const payerResult = await db.query("SELECT name, payer_id FROM payers WHERE LOWER(name) = LOWER($1)", [c.payer]);
        if (payerResult.rows.length) payerInfo = payerResult.rows[0];
      }

      const rawLines = Array.isArray(c.service_lines) ? c.service_lines : [];
      const serviceLines = rawLines.map((sl: any) => ({
        hcpcs_code: sl.hcpcsCode || sl.hcpcs_code || sl.code || "",
        units: Number(sl.units) || 1,
        charge: Number(sl.charge) || Number(sl.amount) || Number(sl.total_charge) || 0,
        modifier: sl.modifier || null,
        diagnosis_pointer: diagPointerToNumeric(sl.diagnosisPointers || sl.diagnosisPointer || sl.diagnosis_pointer || "A"),
        service_date: sl.service_date || sl.serviceDate || null,
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
        },
        provider: {
          first_name: prov.first_name || "",
          last_name: prov.last_name || "",
          npi: prov.npi || ps.primary_npi || "0000000000",
          taxonomy_code: prov.taxonomy_code || ps.taxonomy_code || "163W00000X",
          license_number: prov.license_number || null,
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
        const defaultProv = await db.query("SELECT id FROM providers WHERE is_default = true AND is_active = true LIMIT 1");
        if (defaultProv.rows.length) provId2 = defaultProv.rows[0].id;
      }
      let prov = { first_name: "Rendering", last_name: "Provider", npi: ps.primary_npi || "0000000000", taxonomy_code: ps.taxonomy_code || "163W00000X" };
      if (provId2) {
        const provResult = await db.query("SELECT first_name, last_name, npi, taxonomy_code FROM providers WHERE id = $1", [provId2]);
        if (provResult.rows.length) prov = provResult.rows[0];
      }

      let payerInfo = { name: c.payer || "Unknown", payer_id: "UNKNOWN" };
      if (c.payer_id) {
        const payerResult = await db.query("SELECT name, payer_id FROM payers WHERE id = $1", [c.payer_id]);
        if (payerResult.rows.length) payerInfo = payerResult.rows[0];
      } else if (c.payer) {
        const payerResult = await db.query("SELECT name, payer_id FROM payers WHERE LOWER(name) = LOWER($1)", [c.payer]);
        if (payerResult.rows.length) payerInfo = payerResult.rows[0];
      }

      const pat = patientResult.rows[0] || {};
      const rawLines = Array.isArray(c.service_lines) ? c.service_lines : [];
      const serviceLines = rawLines.map((sl: any) => ({
        hcpcs_code: sl.hcpcsCode || sl.hcpcs_code || sl.code || "",
        units: Number(sl.units) || 1,
        charge: Number(sl.charge) || Number(sl.amount) || Number(sl.total_charge) || 0,
        modifier: sl.modifier || null,
        diagnosis_pointer: diagPointerToNumeric(sl.diagnosisPointers || sl.diagnosisPointer || sl.diagnosis_pointer || "A"),
        service_date: sl.service_date || sl.serviceDate || null,
      }));
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
        const defaultProv = await db.query("SELECT id FROM providers WHERE is_default = true AND is_active = true LIMIT 1");
        if (defaultProv.rows.length) provId = defaultProv.rows[0].id;
      }
      let prov: any = { first_name: "Rendering", last_name: "Provider", npi: ps.primary_npi || "0000000000", taxonomy_code: ps.taxonomy_code || "163W00000X" };
      if (provId) {
        const provResult = await db.query("SELECT first_name, last_name, npi, taxonomy_code, license_number FROM providers WHERE id = $1", [provId]);
        if (provResult.rows.length) prov = provResult.rows[0];
      }

      let payerInfo = { name: c.payer || "Unknown", payer_id: "UNKNOWN" };
      if (c.payer_id) {
        const payerResult = await db.query("SELECT name, payer_id FROM payers WHERE id = $1", [c.payer_id]);
        if (payerResult.rows.length) payerInfo = payerResult.rows[0];
      } else if (c.payer) {
        const payerResult = await db.query("SELECT name, payer_id FROM payers WHERE LOWER(name) = LOWER($1)", [c.payer]);
        if (payerResult.rows.length) payerInfo = payerResult.rows[0];
      }

      const pat = patientResult.rows[0] || {};
      const rawLines = Array.isArray(c.service_lines) ? c.service_lines : [];
      const serviceLines = rawLines.map((sl: any) => ({
        hcpcs_code: sl.hcpcsCode || sl.hcpcs_code || sl.code || "",
        units: Number(sl.units) || 1,
        charge: Number(sl.charge) || Number(sl.amount) || Number(sl.total_charge) || 0,
        modifier: sl.modifier || null,
        diagnosis_pointer: diagPointerToNumeric(sl.diagnosisPointers || sl.diagnosisPointer || sl.diagnosis_pointer || "A"),
        service_date: sl.service_date || sl.serviceDate || null,
      }));
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
        },
        provider: {
          first_name: prov.first_name || "",
          last_name: prov.last_name || "",
          npi: prov.npi || ps.primary_npi || "0000000000",
          taxonomy_code: prov.taxonomy_code || ps.taxonomy_code || "163W00000X",
          license_number: prov.license_number || null,
        },
        payer: payerInfo,
      });

      const result = await stediSubmitClaim({ ediContent: ediString, claimId: c.id });

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
        transactionId: result.transactionId,
        status: result.status,
        validationErrors: result.validationErrors || [],
        error: result.error,
      });
    } catch (err: any) {
      console.error("Stedi submit error:", err);
      console.error('[API] Error:', err); res.status(500).json({ success: false, error: 'An unexpected error occurred. Please try again.' });
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
        const defaultProv = await db.query("SELECT id FROM providers WHERE is_default = true AND is_active = true LIMIT 1");
        if (defaultProv.rows.length) provId = defaultProv.rows[0].id;
      }
      let prov: any = { first_name: "Rendering", last_name: "Provider", npi: ps.primary_npi || "0000000000", taxonomy_code: ps.taxonomy_code || "163W00000X" };
      if (provId) {
        const provResult = await db.query("SELECT first_name, last_name, npi, taxonomy_code, license_number FROM providers WHERE id = $1", [provId]);
        if (provResult.rows.length) prov = provResult.rows[0];
      }

      let payerInfo = { name: c.payer || "Unknown", payer_id: "UNKNOWN" };
      if (c.payer_id) {
        const payerResult = await db.query("SELECT name, payer_id FROM payers WHERE id = $1", [c.payer_id]);
        if (payerResult.rows.length) payerInfo = payerResult.rows[0];
      } else if (c.payer) {
        const payerResult = await db.query("SELECT name, payer_id FROM payers WHERE LOWER(name) = LOWER($1)", [c.payer]);
        if (payerResult.rows.length) payerInfo = payerResult.rows[0];
      }

      const pat = patientResult.rows[0] || {};
      const rawLines = Array.isArray(c.service_lines) ? c.service_lines : [];
      const serviceLines = rawLines.map((sl: any) => ({
        hcpcs_code: sl.hcpcsCode || sl.hcpcs_code || sl.code || "",
        units: Number(sl.units) || 1,
        charge: Number(sl.charge) || Number(sl.amount) || Number(sl.total_charge) || 0,
        modifier: sl.modifier || null,
        diagnosis_pointer: diagPointerToNumeric(sl.diagnosisPointers || sl.diagnosisPointer || sl.diagnosis_pointer || "A"),
        service_date: sl.service_date || sl.serviceDate || null,
      }));
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
        },
        provider: {
          first_name: prov.first_name || "",
          last_name: prov.last_name || "",
          npi: prov.npi || ps.primary_npi || "0000000000",
          taxonomy_code: prov.taxonomy_code || ps.taxonomy_code || "163W00000X",
          license_number: prov.license_number || null,
        },
        payer: payerInfo,
      });

      const result = await stediTestClaim({ ediContent: ediString, claimId: c.id });

      const errCount = (result.validationErrors || []).length;
      const eventNotes = `Stedi test validation: ${result.status || (result.success ? "Accepted" : "Rejected")}. ${errCount} validation issue(s) found.${result.transactionId ? ` Transaction ID: ${result.transactionId}` : ""}`;

      await db.query(
        `INSERT INTO claim_events (id, claim_id, type, notes, timestamp, organization_id) VALUES ($1, $2, $3, $4, NOW(), $5)`,
        [crypto.randomUUID(), c.id, "Test Validation", eventNotes, c.organization_id]
      );

      await db.query(
        `UPDATE claims SET last_test_status = $1, last_test_at = NOW(), last_test_errors = $2, updated_at = NOW() WHERE id = $3`,
        [
          result.success ? "Accepted" : "Rejected",
          JSON.stringify(result.validationErrors || []),
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
      if (!q) return res.json([]);
      const db = await import("./db").then(m => m.pool);
      const codePattern = `${q}%`;
      const { rows } = await db.query(
        `SELECT code, description_official, description_plain, unit_type,
                unit_interval_minutes, default_pos, requires_modifier, notes,
                source, va_rate
         FROM (
           SELECT h.code, h.description_official, h.description_plain, h.unit_type,
                  h.unit_interval_minutes, h.default_pos, h.requires_modifier, h.notes,
                  'hcpcs' as source,
                  (SELECT ROUND(AVG(facility_rate)::numeric, 2) FROM va_location_rates
                   WHERE hcpcs_code = h.code
                   AND is_non_reimbursable = false) as va_rate
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
                  'cpt' as source,
                  (SELECT ROUND(AVG(facility_rate)::numeric, 2) FROM va_location_rates
                   WHERE hcpcs_code = c.code
                   AND is_non_reimbursable = false) as va_rate
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
      const { isActive, name, payerId, timelyFilingDays, authRequired, autoFollowupDays, eraAutoPostClean, eraAutoPostContractual, eraAutoPostSecondary, eraAutoPostRefunds, eraHoldIfMismatch } = req.body;
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

  app.get("/api/billing/patients", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const search = (req.query.search as string || "").trim().toLowerCase();
      const db = await import("./db").then(m => m.pool);
      const orgId = getOrgId(req);
      let query = `
        SELECT p.*, l.name as lead_name,
          (SELECT MAX(COALESCE(c.service_date::text, c.created_at::text)) FROM claims c WHERE c.patient_id = p.id) as last_claim_date,
          (SELECT c.status FROM claims c WHERE c.patient_id = p.id ORDER BY COALESCE(c.service_date, c.created_at::date) DESC LIMIT 1) as last_claim_status
        FROM patients p
        LEFT JOIN leads l ON p.lead_id = l.id
        WHERE 1=1
      `;
      const params: any[] = [];
      let idx = 1;
      if (orgId) { query += ` AND p.organization_id = $${idx}`; params.push(orgId); idx++; }
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
        secondaryPayerId, secondaryMemberId, secondaryGroupNumber, secondaryPlanName, secondaryRelationship
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
          created_at
        ) VALUES (
          gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22, $23, $24,
          $25, $26, $27, $28, $29,
          $30, $31, $32,
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
          address?.street || address?.street1 || null, address?.city || null, address?.zip || null
        ]
      );
      res.json(rows[0]);
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

  app.get("/api/billing/patients/:id/claims", requireRole("admin", "rcm_manager"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const ownerCheck = await db.query("SELECT organization_id FROM patients WHERE id = $1", [req.params.id]);
      if (!ownerCheck.rows.length || !verifyOrg(ownerCheck.rows[0], req)) return res.status(404).json({ error: "Patient not found" });
      const { rows } = await db.query(
        `SELECT * FROM claims WHERE patient_id = $1 ORDER BY created_at DESC`,
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
    res.json({ configured: isStediConfigured() });
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
      res.json(rows[0]);
    } catch (err: any) {
      console.error('[API] Error:', err); res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
    }
  });

  app.get("/api/dashboard/metrics", async (req, res) => {
    const metrics = await storage.getDashboardMetrics(getOrgId(req));
    res.json(metrics);
  });

  app.get("/api/dashboard/alerts", async (req, res) => {
    const claims = await storage.getClaims(getOrgId(req));
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
    const calls = await storage.getCallsByLeadId(req.params.id);
    res.json(calls);
  });

  app.get("/api/leads/:id/patient", requireRole("admin", "intake"), async (req, res) => {
    const patient = await storage.getPatientByLeadId(req.params.id);
    res.json(patient || null);
  });

  // Update patient and sync to lead
  app.patch("/api/leads/:id/patient", requireRole("admin", "intake"), async (req, res) => {
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

  app.post("/api/leads/:id/convert-to-patient", requireRole("admin", "intake"), async (req, res) => {
    try {
      const lead = await storage.getLead(req.params.id);
      if (!lead) {
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
        `INSERT INTO patients (id, lead_id, first_name, last_name, dob, email, phone, insurance_carrier, member_id, plan_type, state, service_needed, referral_source, intake_completed)
         SELECT gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true
         WHERE NOT EXISTS (SELECT 1 FROM patients WHERE lead_id = $1)
         RETURNING *`,
        [lead.id, firstName, lastName, "", lead.email || null, lead.phone || null,
         lead.insuranceCarrier || null, lead.memberId || null, lead.planType || null,
         lead.state || null, lead.serviceNeeded || null, lead.source || "From Intake"]
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

  app.post("/api/leads/:id/call", requireRole("admin", "intake"), async (req, res) => {
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
      organizationId: getOrgId(req),
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
      const orgId = getOrgId(req);
      const { rows } = await db.query(
        `SELECT *, COALESCE(specialty_tags, '{}') as specialty_tags FROM rules WHERE organization_id = $1 OR organization_id IS NULL ORDER BY created_at DESC`,
        [orgId]
      );
      res.json(rows);
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
        organizationId: getOrgId(req),
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
    const auths = await storage.getPriorAuthsByEncounterId(req.params.encounterId);
    res.json(auths);
  });

  app.get("/api/prior-auth/patient/:patientId", requireRole("admin", "rcm_manager"), async (req, res) => {
    const auths = await storage.getPriorAuthsByPatientId(req.params.patientId);
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
        organizationId: getOrgId(req),
        vobData: null,
        notes: null,
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

  // Get email configuration status
  app.get("/api/email/status", requireRole("admin", "intake"), async (req, res) => {
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
    const appointments = await storage.getAppointmentsByLeadId(req.params.id);
    res.json(appointments);
  });

  // Create appointment for a lead
  app.post("/api/leads/:id/appointments", requireRole("admin", "intake"), async (req, res) => {
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
  app.get("/api/availability/slots", async (req, res) => {
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
  app.get("/api/chat-analytics/stats", requireRole("admin", "intake"), async (req, res) => {
    const stats = await storage.getChatSessionStats(getOrgId(req));
    res.json(stats);
  });

  // Get call analytics stats
  app.get("/api/calls-analytics/stats", requireRole("admin", "intake"), async (req, res) => {
    try {
      const db = await import("./db").then(m => m.pool);
      const { rows } = await db.query(`
        SELECT
          COUNT(c.id)::int AS "totalCalls",
          COUNT(CASE WHEN c.status = 'completed' THEN 1 END)::int AS "answeredCalls",
          COUNT(CASE WHEN c.status = 'no-answer' THEN 1 END)::int AS "missedCalls",
          COUNT(CASE WHEN c.status = 'voicemail' THEN 1 END)::int AS "voicemailCalls",
          COALESCE(ROUND(AVG(c.duration))::int, 0) AS "avgDuration",
          COALESCE(SUM(COALESCE(c.duration, 0))::int, 0) AS "totalDuration"
        FROM calls c
      `);
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
      res.status(500).json({ error: "Failed to get call stats" });
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
        organizationId: getOrgId(req),
      });

      // Update lead VOB status
      await storage.updateLead(leadId, { vobStatus: "in_progress" });

      // Log activity
      await storage.createActivityLog({
        leadId,
        activityType: "vob_started",
        description: `VOB verification started with ${payerName}`,
        performedBy: "system",
        organizationId: getOrgId(req),
        metadata: { payerId, payerName, memberId },
      });

      // Call VerifyTX API
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
        organizationId: getOrgId(req),
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

  app.get("/api/billing/reports/ar-aging", requireAuth, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { startDate, endDate, payerId, providerId } = req.query as Record<string, string>;
      const start = startDate || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const end = endDate || new Date().toISOString().slice(0, 10);
      const conditions: string[] = [`c.status NOT IN ('paid', 'draft')`];
      const params: any[] = [];
      if (orgId) { params.push(orgId); conditions.push(`c.organization_id = $${params.length}`); }
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

  app.get("/api/billing/reports/denial-analysis", requireAuth, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { startDate, endDate, payerId, providerId } = req.query as Record<string, string>;
      const start = startDate || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const end = endDate || new Date().toISOString().slice(0, 10);
      const claimParams: any[] = [];
      const claimConds: string[] = [];
      if (orgId) { claimParams.push(orgId); claimConds.push(`c.organization_id = $${claimParams.length}`); }
      if (start) { claimParams.push(start); claimConds.push(`COALESCE(c.service_date, c.created_at::date) >= $${claimParams.length}`); }
      if (end) { claimParams.push(end); claimConds.push(`COALESCE(c.service_date, c.created_at::date) <= $${claimParams.length}`); }
      if (payerId && payerId !== "all") { claimParams.push(payerId); claimConds.push(`c.payer_id = $${claimParams.length}`); }
      if (providerId && providerId !== "all") { claimParams.push(providerId); claimConds.push(`c.provider_id = $${claimParams.length}`); }
      const cw = claimConds.length ? `WHERE ${claimConds.join(" AND ")}` : "";
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
      if (orgId) { denialParams.push(orgId); denialConds.push(`d.organization_id = $${denialParams.length}`); }
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

  app.get("/api/billing/reports/collections", requireAuth, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { startDate, endDate, payerId, providerId } = req.query as Record<string, string>;
      const start = startDate || new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
      const end = endDate || new Date().toISOString().slice(0, 10);
      const params: any[] = [];
      const conds: string[] = [];
      if (orgId) { params.push(orgId); conds.push(`c.organization_id = $${params.length}`); }
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

  app.get("/api/billing/reports/clean-claim-rate", requireAuth, async (req, res) => {
    try {
      const orgId = getOrgId(req);
      const { startDate, endDate, payerId, providerId } = req.query as Record<string, string>;
      const start = startDate || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const end = endDate || new Date().toISOString().slice(0, 10);
      const params: any[] = [];
      const conds: string[] = [`c.status != 'draft'`];
      if (orgId) { params.push(orgId); conds.push(`c.organization_id = $${params.length}`); }
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

  app.post("/api/billing/eras/upload", requireAuth, async (req, res) => {
    try {
      const orgId = getOrgId(req);
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
    res.json({
      configured: isConfigured,
      mode: isConfigured ? 'production' : 'not_configured',
      label: isConfigured
        ? '✓ Connected to Stedi — Production'
        : '⚠ Stedi not configured'
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
    console.error("[277 Poll] Error:", err);
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
    console.error("[835 Poll] Error:", err);
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
