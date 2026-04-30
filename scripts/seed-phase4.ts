/**
 * Phase 4 Dev Fixture Seed Script — SYNTHETIC DATA / USE WITH EXTREME CAUTION
 *
 * ⚠ WARNING: This script inserts synthetic "completed" payer manuals and extraction
 * items that bypass the real ingestion pipeline (Upload → Process → Review). Running
 * this script will fabricate coverage data and should NEVER be run against production
 * or shared staging environments.
 *
 * This script requires an explicit opt-in env var to run:
 *   ALLOW_SYNTHETIC_PHASE4_SEED=true npx tsx scripts/seed-phase4.ts
 *
 * For real Phase 4 payer ingestion, use the admin pipeline:
 *   1. Admin → Payer Manuals → Source Registry → "Ingest" a payer source
 *   2. Upload/URL → Run Extraction → Review items → Approve or "Not in Manual"
 *
 * The startup seeder (server/routes.ts) only seeds the payer_manual_sources registry
 * (20 source URLs/metadata entries). It does NOT insert synthetic payer manuals.
 */
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  if (process.env.ALLOW_SYNTHETIC_PHASE4_SEED !== 'true') {
    console.error("[seed-phase4] BLOCKED: This script inserts synthetic fixture data that bypasses the ingestion pipeline.");
    console.error("[seed-phase4] To run it anyway (development only), set: ALLOW_SYNTHETIC_PHASE4_SEED=true");
    process.exit(1);
  }
  const client = await pool.connect();
  try {
    console.log("[seed-phase4] Starting (ALLOW_SYNTHETIC_PHASE4_SEED=true — synthetic fixture data)...");

    const { rows: check } = await client.query(
      "SELECT COUNT(*)::int AS cnt FROM payer_source_documents WHERE id = 'manual-p4-uhc-001'"
    );
    if (check[0]?.cnt > 0) {
      console.log("[seed-phase4] Already seeded (manual-p4-uhc-001 exists). Skipping.");
      return;
    }

    await client.query(`
      INSERT INTO payer_source_documents (id, document_name, source_url, status, uploaded_by, document_type, created_at, updated_at) VALUES
      ('manual-p4-uhc-001',  'UnitedHealthcare Commercial',       'https://www.uhcprovider.com/content/dam/provider/docs/public/policies/comm-reimbursement/COMM-Billing-Coding-Guide.pdf', 'completed', 'seed-phase4', 'admin_guide', NOW(), NOW()),
      ('manual-p4-bcbs-001', 'Blue Cross Blue Shield (National)', 'https://www.bcbs.com/sites/default/files/file-attachments/health-of-america-report/HOA-Billing-Guidelines.pdf',       'completed', 'seed-phase4', 'admin_guide', NOW(), NOW()),
      ('manual-p4-cig-001',  'Cigna Commercial',                  'https://www.cigna.com/static/www-cigna-com/docs/health-care-providers/resources/clinical-payment-reimbursement-policies.pdf', 'completed', 'seed-phase4', 'admin_guide', NOW(), NOW()),
      ('manual-p4-hum-001',  'Humana Commercial',                 'https://www.humana.com/provider/medical-resources/billing-and-reimbursement/billing-coding-guidelines',              'completed', 'seed-phase4', 'admin_guide', NOW(), NOW()),
      ('manual-p4-cnt-001',  'Centene / WellCare',                'https://www.wellcare.com/en/Provider/Manuals-and-Guidelines',                                                         'completed', 'seed-phase4', 'admin_guide', NOW(), NOW()),
      ('manual-p4-mol-001',  'Molina Healthcare',                 'https://www.molinahealthcare.com/providers/resources/manuals/pdf/ProviderManual.pdf',                                 'completed', 'seed-phase4', 'admin_guide', NOW(), NOW()),
      ('manual-p4-ant-001',  'Elevance Health (Anthem)',           'https://www.anthem.com/provider/policies-and-guidelines/',                                                           'completed', 'seed-phase4', 'admin_guide', NOW(), NOW()),
      ('manual-p4-kai-001',  'Kaiser Permanente',                 'https://providers.kaiserpermanente.org/wps/portal/provider/portal',                                                   'completed', 'seed-phase4', 'admin_guide', NOW(), NOW()),
      ('manual-p4-htn-001',  'Health Net',                        'https://www.healthnet.com/portal/provider/content/providermanuals.action',                                            'completed', 'seed-phase4', 'admin_guide', NOW(), NOW()),
      ('manual-p4-ame-001',  'AmeriHealth Caritas',               'https://www.amerihealthcaritas.com/providers/resources/provider-manual.aspx',                                         'completed', 'seed-phase4', 'admin_guide', NOW(), NOW()),
      ('manual-p4-tuf-001',  'Tufts Health Plan',                 'https://tuftshealthplan.com/provider/provider-manual',                                                               'completed', 'seed-phase4', 'admin_guide', NOW(), NOW()),
      ('manual-p4-hcs-001',  'HCSC (Health Care Service Corp)',   'https://www.hcsc.com/providers/billing-and-claims',                                                                  'completed', 'seed-phase4', 'admin_guide', NOW(), NOW()),
      ('manual-p4-hig-001',  'Highmark',                          'https://www.highmarkprc.com/provider-reference-center.shtml',                                                        'completed', 'seed-phase4', 'admin_guide', NOW(), NOW()),
      ('manual-p4-cbc-001',  'Capital BlueCross',                 'https://www.capbluecross.com/wps/portal/cap/provider/billing-payment',                                               'completed', 'seed-phase4', 'admin_guide', NOW(), NOW()),
      ('manual-p4-mdc-001',  'Medica',                            'https://www.medica.com/providers/provider-manual',                                                                   'completed', 'seed-phase4', 'admin_guide', NOW(), NOW()),
      ('manual-p4-pri-001',  'Priority Health',                   'https://www.priorityhealth.com/provider/manuals-and-guides',                                                         'completed', 'seed-phase4', 'admin_guide', NOW(), NOW()),
      ('manual-p4-ibx-001',  'Independence Blue Cross',           'https://www.ibx.com/providers/forms-and-guidelines/billing-guidelines',                                              'completed', 'seed-phase4', 'admin_guide', NOW(), NOW()),
      ('manual-p4-osc-001',  'Oscar Health',                      'https://www.hioscar.com/health/provider-resources',                                                                  'completed', 'seed-phase4', 'admin_guide', NOW(), NOW()),
      ('manual-p4-brt-001',  'Bright Health / Friday Health',     'https://www.brighthealthplan.com/providers/resources',                                                               'completed', 'seed-phase4', 'admin_guide', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
    `);
    console.log("[seed-phase4] Inserted 19 payer_source_documents");

    await client.query(`
      INSERT INTO manual_extraction_items (id, source_document_id, section_type, extracted_json, confidence, review_status, reviewed_by, reviewed_at, notes, created_at) VALUES
      ('p4-uhc-tf',  'manual-p4-uhc-001', 'timely_filing', '{"days":90,"exceptions":["COB: 27 months"]}',              0.95, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-bcb-tf',  'manual-p4-bcbs-001','timely_filing', '{"days":180,"exceptions":["COB: 27 months","corrected: 24 months from original denial"]}', 0.93, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-cig-tf',  'manual-p4-cig-001', 'timely_filing', '{"days":90,"exceptions":["claims in litigation: tolled"]}', 0.94, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-hum-tf',  'manual-p4-hum-001', 'timely_filing', '{"days":90,"exceptions":["COB secondary: 180 days from primary EOB"]}', 0.93, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-cnt-tf',  'manual-p4-cnt-001', 'timely_filing', '{"days":90,"exceptions":["Medicaid MCO: 365 days"]}',       0.91, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-mol-tf',  'manual-p4-mol-001', 'timely_filing', '{"days":180,"exceptions":["COB: 180 days from primary EOB"]}', 0.90, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-ant-tf',  'manual-p4-ant-001', 'timely_filing', '{"days":180,"exceptions":["corrected: 12 months from original"]}', 0.92, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-kai-tf',  'manual-p4-kai-001', 'timely_filing', '{"days":90,"exceptions":["HMO: in-network referral required"]}', 0.88, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-htn-tf',  'manual-p4-htn-001', 'timely_filing', '{"days":180,"exceptions":["COB secondary: 180 days from primary"]}', 0.89, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-ame-tf',  'manual-p4-ame-001', 'timely_filing', '{"days":180,"exceptions":["Medicaid wraparound: 365 days"]}', 0.87, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-tuf-tf',  'manual-p4-tuf-001', 'timely_filing', '{"days":180,"exceptions":["medical review: +60 day extension"]}', 0.88, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-hcs-tf',  'manual-p4-hcs-001', 'timely_filing', '{"days":180,"exceptions":["state addendum may apply: IL/TX/OK/NM/MT"]}', 0.86, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-hig-tf',  'manual-p4-hig-001', 'timely_filing', '{"days":180,"exceptions":["corrected: 24 months from original"]}', 0.90, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-cbc-tf',  'manual-p4-cbc-001', 'timely_filing', '{"days":180,"exceptions":["COB secondary: 180 days from primary EOB"]}', 0.89, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-mdc-tf',  'manual-p4-mdc-001', 'timely_filing', '{"days":90,"exceptions":["COB: 90 days from primary EOB"]}',  0.91, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-pri-tf',  'manual-p4-pri-001', 'timely_filing', '{"days":180,"exceptions":["corrected: 12 months from original"]}', 0.88, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-ibx-tf',  'manual-p4-ibx-001', 'timely_filing', '{"days":180,"exceptions":["FEP federal plans: 365 days"]}',   0.90, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-osc-tf',  'manual-p4-osc-001', 'timely_filing', '{"days":90,"exceptions":["electronic submission required"]}', 0.85, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-brt-tf',  'manual-p4-brt-001', 'timely_filing', '{"days":90,"exceptions":["plan in wind-down — verify with state DOI"]}', 0.75, 'approved', 'seed-phase4', NOW(), NULL, NOW())
      ON CONFLICT (id) DO NOTHING
    `);

    await client.query(`
      INSERT INTO manual_extraction_items (id, source_document_id, section_type, extracted_json, confidence, review_status, reviewed_by, reviewed_at, notes, created_at) VALUES
      ('p4-uhc-pa',  'manual-p4-uhc-001', 'prior_auth', '{"requires_auth":true,"criteria":"UHC OptumHealth auth required before HH service delivery","cpt_codes":["G0299","G0300","G0151","G0152","G0153"]}', 0.93, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-bcb-pa',  'manual-p4-bcbs-001','prior_auth', '{"requires_auth":true,"criteria":"BCBS prior auth via AIM Specialty Health (most plans)","cpt_codes":["G0299","G0300"]}', 0.91, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-cig-pa',  'manual-p4-cig-001', 'prior_auth', '{"requires_auth":true,"criteria":"Cigna precertification via portal or phone","cpt_codes":["G0299","G0300","G0151","G0152","G0153"]}', 0.92, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-hum-pa',  'manual-p4-hum-001', 'prior_auth', '{"requires_auth":true,"criteria":"Humana auth before first HH visit","cpt_codes":["G0299","G0300","G0151","G0152","G0153"]}', 0.91, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-cnt-pa',  'manual-p4-cnt-001', 'prior_auth', '{"requires_auth":true,"criteria":"WellCare auth via NaviNet or portal","cpt_codes":["G0299","G0300"]}', 0.88, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-mol-pa',  'manual-p4-mol-001', 'prior_auth', '{"requires_auth":true,"criteria":"Molina auth via provider portal or phone","cpt_codes":["G0299","G0300","G0151","G0152","G0153"]}', 0.87, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-ant-pa',  'manual-p4-ant-001', 'prior_auth', '{"requires_auth":true,"criteria":"Anthem/AIM Specialty Health auth for HH","cpt_codes":["G0299","G0300","G0151","G0152"]}', 0.90, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-kai-pa',  'manual-p4-kai-001', 'prior_auth', '{"requires_auth":true,"criteria":"Kaiser internal auth + physician referral required","cpt_codes":["G0299","G0300","G0151","G0152","G0153"]}', 0.86, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-htn-pa',  'manual-p4-htn-001', 'prior_auth', '{"requires_auth":true,"criteria":"Health Net auth via provider portal","cpt_codes":["G0299","G0300"]}', 0.87, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-ame-pa',  'manual-p4-ame-001', 'prior_auth', '{"requires_auth":true,"criteria":"AmeriHealth Caritas Medicaid MCO auth via portal","cpt_codes":["G0299","G0300","G0151","G0152","G0153"]}', 0.85, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-tuf-pa',  'manual-p4-tuf-001', 'prior_auth', '{"requires_auth":true,"criteria":"Tufts ePA portal or UM department","cpt_codes":["G0299","G0300"]}', 0.86, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-hcs-pa',  'manual-p4-hcs-001', 'prior_auth', '{"requires_auth":true,"criteria":"HCSC auth via AIM Specialty Health","cpt_codes":["G0299","G0300","G0151","G0152"]}', 0.88, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-hig-pa',  'manual-p4-hig-001', 'prior_auth', '{"requires_auth":true,"criteria":"Highmark NaviMedix or UM auth","cpt_codes":["G0299","G0300"]}', 0.87, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-cbc-pa',  'manual-p4-cbc-001', 'prior_auth', '{"requires_auth":true,"criteria":"Capital BlueCross portal auth","cpt_codes":["G0299","G0300","G0151","G0152"]}', 0.85, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-mdc-pa',  'manual-p4-mdc-001', 'prior_auth', '{"requires_auth":true,"criteria":"Medica portal auth for skilled HH services","cpt_codes":["G0299","G0300"]}', 0.86, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-pri-pa',  'manual-p4-pri-001', 'prior_auth', '{"requires_auth":true,"criteria":"Priority Health portal or phone auth","cpt_codes":["G0299","G0300","G0151","G0152","G0153"]}', 0.87, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-ibx-pa',  'manual-p4-ibx-001', 'prior_auth', '{"requires_auth":true,"criteria":"IBX auth via NaviNet or UM","cpt_codes":["G0299","G0300"]}', 0.88, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-osc-pa',  'manual-p4-osc-001', 'prior_auth', '{"requires_auth":true,"criteria":"Oscar portal auth","cpt_codes":["G0299","G0300","G0151","G0152","G0153"]}', 0.82, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-brt-pa',  'manual-p4-brt-001', 'prior_auth', '{"requires_auth":true,"criteria":"Bright wind-down — verify with state DOI","cpt_codes":["G0299","G0300"]}', 0.72, 'approved', 'seed-phase4', NOW(), NULL, NOW())
      ON CONFLICT (id) DO NOTHING
    `);

    await client.query(`
      INSERT INTO manual_extraction_items (id, source_document_id, section_type, extracted_json, confidence, review_status, reviewed_by, reviewed_at, notes, created_at) VALUES
      ('p4-uhc-mod', 'manual-p4-uhc-001', 'modifiers', '{"modifier_code":"GP","payer_rule":"GP(PT)/GO(OT)/GN(SLP) required on all therapy HCPCS under HH benefit"}',  0.91, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-bcb-mod', 'manual-p4-bcbs-001','modifiers', '{"modifier_code":"GP","payer_rule":"GP/GO/GN required; -59 for distinct same-day procedures"}',                0.90, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-cig-mod', 'manual-p4-cig-001', 'modifiers', '{"modifier_code":"GP","payer_rule":"GP/GO/GN required; -25 for E/M same-day procedure"}',                       0.89, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-hum-mod', 'manual-p4-hum-001', 'modifiers', '{"modifier_code":"GP","payer_rule":"GP/GO/GN; -59 or X-modifiers for distinct services same DOS"}',              0.88, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-cnt-mod', 'manual-p4-cnt-001', 'modifiers', '{"modifier_code":"GP","payer_rule":"GP/GO/GN on all therapy HCPCS under HH benefit"}',                           0.86, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-mol-mod', 'manual-p4-mol-001', 'modifiers', '{"modifier_code":"GP","payer_rule":"GP(PT)/GO(OT)/GN(SLP) on therapy HCPCS for HH claims"}',                    0.85, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-ant-mod', 'manual-p4-ant-001', 'modifiers', '{"modifier_code":"GP","payer_rule":"GP/GO/GN; -52 reduced, -59 distinct procedures same DOS"}',                  0.89, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-kai-mod', 'manual-p4-kai-001', 'modifiers', '{"modifier_code":"GP","payer_rule":"GP/GO/GN; Kaiser HMO referral# required on all claims"}',                    0.84, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-htn-mod', 'manual-p4-htn-001', 'modifiers', '{"modifier_code":"GP","payer_rule":"GP/GO/GN; -59 to override NCCI bundling"}',                                  0.85, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-ame-mod', 'manual-p4-ame-001', 'modifiers', '{"modifier_code":"GP","payer_rule":"GP/GO/GN on all therapy HCPCS per Medicaid MCO guidelines"}',                0.83, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-tuf-mod', 'manual-p4-tuf-001', 'modifiers', '{"modifier_code":"GP","payer_rule":"GP(PT)/GO(OT)/GN(SLP) on outpatient and HH therapy codes"}',                 0.84, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-hcs-mod', 'manual-p4-hcs-001', 'modifiers', '{"modifier_code":"GP","payer_rule":"GP/GO/GN; state addendum may apply IL vs TX"}',                              0.86, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-hig-mod', 'manual-p4-hig-001', 'modifiers', '{"modifier_code":"GP","payer_rule":"GP/GO/GN; -RT/-LT bilateral procedures billed separately"}',                 0.87, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-cbc-mod', 'manual-p4-cbc-001', 'modifiers', '{"modifier_code":"GP","payer_rule":"GP/GO/GN on all HH therapy HCPCS codes"}',                                   0.85, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-mdc-mod', 'manual-p4-mdc-001', 'modifiers', '{"modifier_code":"GP","payer_rule":"GP(PT)/GO(OT)/GN(SLP); -25 for same-day E/M with procedure"}',               0.86, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-pri-mod', 'manual-p4-pri-001', 'modifiers', '{"modifier_code":"GP","payer_rule":"GP/GO/GN; -59 for distinct procedures same day"}',                           0.85, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-ibx-mod', 'manual-p4-ibx-001', 'modifiers', '{"modifier_code":"GP","payer_rule":"GP/GO/GN; -59 or X-modifiers for distinct services"}',                       0.87, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-osc-mod', 'manual-p4-osc-001', 'modifiers', NULL, NULL, 'not_found', 'seed-phase4', NOW(), 'Oscar Health modifier rules not published in public provider manual — CMS standard guidance applies.', NOW()),
      ('p4-brt-mod', 'manual-p4-brt-001', 'modifiers', NULL, NULL, 'not_found', 'seed-phase4', NOW(), 'Bright Health modifier rules unavailable — plan in wind-down as of 2026.', NOW())
      ON CONFLICT (id) DO NOTHING
    `);

    await client.query(`
      INSERT INTO manual_extraction_items (id, source_document_id, section_type, extracted_json, confidence, review_status, reviewed_by, reviewed_at, notes, created_at) VALUES
      ('p4-uhc-ap',  'manual-p4-uhc-001', 'appeals', '{"deadline_days":180,"level":"First Level Internal Appeal","submission_method":"UHC provider portal or written appeal"}', 0.93, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-bcb-ap',  'manual-p4-bcbs-001','appeals', '{"deadline_days":180,"level":"First Level Internal Appeal","submission_method":"BCBS plan portal or fax"}',              0.90, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-cig-ap',  'manual-p4-cig-001', 'appeals', '{"deadline_days":180,"level":"First Level Reconsideration","submission_method":"Cigna portal or fax"}',                  0.91, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-hum-ap',  'manual-p4-hum-001', 'appeals', '{"deadline_days":180,"level":"First Level Internal Appeal","submission_method":"Humana portal or written appeal"}',      0.90, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-cnt-ap',  'manual-p4-cnt-001', 'appeals', '{"deadline_days":60,"level":"WellCare First Level Internal Appeal","submission_method":"WellCare portal or written"}',   0.87, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-mol-ap',  'manual-p4-mol-001', 'appeals', '{"deadline_days":90,"level":"First Level Internal Appeal","submission_method":"Molina portal or fax"}',                  0.86, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-ant-ap',  'manual-p4-ant-001', 'appeals', '{"deadline_days":180,"level":"First Level Provider Appeal","submission_method":"Anthem portal or written appeal"}',       0.90, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-kai-ap',  'manual-p4-kai-001', 'appeals', '{"deadline_days":180,"level":"First Level Reconsideration","submission_method":"Kaiser provider dispute resolution"}',   0.85, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-htn-ap',  'manual-p4-htn-001', 'appeals', '{"deadline_days":180,"level":"First Level Internal Appeal","submission_method":"Health Net portal or written"}',         0.86, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-ame-ap',  'manual-p4-ame-001', 'appeals', '{"deadline_days":60,"level":"Medicaid MCO First Level Appeal","submission_method":"AmeriHealth portal or fax"}',          0.84, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-tuf-ap',  'manual-p4-tuf-001', 'appeals', '{"deadline_days":180,"level":"First Level Provider Appeal","submission_method":"Tufts portal or written appeal"}',       0.85, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-hcs-ap',  'manual-p4-hcs-001', 'appeals', '{"deadline_days":180,"level":"First Level Internal Appeal","submission_method":"HCSC portal or fax (state-specific)"}', 0.86, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-hig-ap',  'manual-p4-hig-001', 'appeals', '{"deadline_days":180,"level":"First Level Internal Appeal","submission_method":"Highmark portal or written appeal"}',    0.87, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-cbc-ap',  'manual-p4-cbc-001', 'appeals', '{"deadline_days":180,"level":"First Level Provider Appeal","submission_method":"Capital BC portal or written appeal"}',  0.84, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-mdc-ap',  'manual-p4-mdc-001', 'appeals', '{"deadline_days":90,"level":"First Level Reconsideration — Medica","submission_method":"Medica portal or written"}',     0.85, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-pri-ap',  'manual-p4-pri-001', 'appeals', '{"deadline_days":180,"level":"First Level Internal Appeal","submission_method":"Priority Health portal or written"}',    0.86, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-ibx-ap',  'manual-p4-ibx-001', 'appeals', '{"deadline_days":180,"level":"First Level Provider Dispute — IBX","submission_method":"NaviNet portal or written"}',     0.87, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-osc-ap',  'manual-p4-osc-001', 'appeals', '{"deadline_days":90,"level":"Oscar First Level Internal Appeal","submission_method":"Oscar portal (digital-first)"}',    0.82, 'approved', 'seed-phase4', NOW(), NULL, NOW()),
      ('p4-brt-ap',  'manual-p4-brt-001', 'appeals', '{"deadline_days":60,"level":"Bright First Level Appeal","submission_method":"Written per wind-down protocols"}',         0.72, 'approved', 'seed-phase4', NOW(), NULL, NOW())
      ON CONFLICT (id) DO NOTHING
    `);
    console.log("[seed-phase4] Inserted 76 extraction items");

    const p4Links: [string, string][] = [
      ["pms-001", "manual-p4-uhc-001"], ["pms-002", "manual-p4-bcbs-001"],
      ["pms-003", "manual-p4-cig-001"], ["pms-004", "manual-p4-hum-001"],
      ["pms-006", "manual-p4-cnt-001"], ["pms-007", "manual-p4-mol-001"],
      ["pms-008", "manual-p4-ant-001"], ["pms-009", "manual-p4-kai-001"],
      ["pms-010", "manual-p4-htn-001"], ["pms-011", "manual-p4-ame-001"],
      ["pms-012", "manual-p4-tuf-001"], ["pms-013", "manual-p4-hcs-001"],
      ["pms-014", "manual-p4-hig-001"], ["pms-015", "manual-p4-cbc-001"],
      ["pms-016", "manual-p4-mdc-001"], ["pms-017", "manual-p4-pri-001"],
      ["pms-018", "manual-p4-ibx-001"], ["pms-019", "manual-p4-osc-001"],
      ["pms-020", "manual-p4-brt-001"],
    ];
    for (const [srcId, manualId] of p4Links) {
      await client.query(
        `UPDATE payer_manual_sources SET linked_source_document_id = $1, last_verified_date = NOW()::date, updated_at = NOW() WHERE id = $2`,
        [manualId, srcId]
      );
    }
    console.log("[seed-phase4] Linked 19 source registry entries");

    console.log("[seed-phase4] Done. 19 payer_source_documents + 76 extraction items created.");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("[seed-phase4] Error:", err.message);
  process.exit(1);
});
