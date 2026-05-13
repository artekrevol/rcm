import { Pool } from 'pg';
import { generate837P } from '../server/services/edi-generator';
import { submitClaim } from '../server/services/stedi-claims';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const CLAIM_ID = '785bb04f-f645-4671-a4da-2af4d5375952';

  const [cr, pr, sr, pyr, provr] = await Promise.all([
    pool.query("SELECT * FROM claims WHERE id=$1", [CLAIM_ID]),
    pool.query("SELECT * FROM patients WHERE id='26c49620-9c9c-4b72-9458-b83517c812fb'"),
    pool.query("SELECT * FROM practice_settings WHERE organization_id='demo-org-001' LIMIT 1"),
    pool.query("SELECT * FROM payers WHERE id='ba1316c1-60ea-41d6-80ae-cade2fb010f6' LIMIT 1"),
    pool.query("SELECT * FROM providers WHERE is_default=true AND organization_id='demo-org-001' LIMIT 1"),
  ]);

  const c = cr.rows[0]; const pat = pr.rows[0]; const ps = sr.rows[0];
  const payer = pyr.rows[0]; const prov = provr.rows[0];

  const serviceLines = (c.service_lines || [])
    .map((sl: any) => ({
      hcpcs_code: sl.hcpcs_code || sl.hcpcsCode || '',
      units: Number(sl.units) || 1,
      charge: Number(sl.total_charge) || Number(sl.charge) || 0,
      modifier: sl.modifier || null,
      diagnosis_pointer: 1,
      service_date: sl.service_date_from || null,
      service_date_to: sl.service_date_to || null,
    }))
    .filter((sl: any) => sl.hcpcs_code);

  const addr = (ps.address as any) || {};
  const patAddr = (pat.address as any) || {};

  const { edi } = generate837P({
    isa15: 'T',
    claim: {
      id: c.id, patient_id: c.patient_id,
      service_date: c.service_date ? new Date(c.service_date).toISOString().slice(0,10) : '2025-01-11',
      place_of_service: c.place_of_service || '12',
      auth_number: c.authorization_number || null,
      payer: payer?.name || 'UnitedHealthcare',
      amount: Number(c.amount) || 35,
      homebound_indicator: false, delay_reason_code: null,
      claim_frequency_code: '1', orig_claim_number: null,
      statement_period_start: null, statement_period_end: null,
      service_lines: serviceLines,
      icd10_codes: ['Z51.12'],
    },
    patient: {
      first_name: pat.first_name || 'Test', last_name: pat.last_name || 'Patient',
      dob: pat.dob || '1988-09-11',
      member_id: pat.member_id || pat.insurance_id || 'TST123456',
      insurance_carrier: pat.insurance_carrier || 'UnitedHealthcare',
      sex: pat.sex || null,
      address: patAddr.street || patAddr.street1 || '123 Main St',
      city: patAddr.city || 'Springfield',
      state: patAddr.state || pat.state || 'IL',
      zip: patAddr.zip || '62701',
    },
    practice: {
      name: ps.practice_name || 'CHAJINEL HOME CARE SERVICE', legal_name: ps.legal_name || null,
      npi: ps.primary_npi || '1184288680', tax_id: ps.tax_id || '123456789',
      taxonomy_code: ps.taxonomy_code || '163W00000X',
      address: addr.street || addr.street1 || addr.address || '456 Care Ave',
      city: addr.city || 'Chicago', state: addr.state || 'IL', zip: addr.zip || '60601',
      phone: ps.phone || '5551234567', pgba_trading_partner_id: ps.pgba_trading_partner_id || null,
    },
    provider: {
      first_name: prov?.first_name || 'CHAJINEL', last_name: prov?.last_name || 'PROVIDER',
      npi: prov?.npi || ps.primary_npi || '1184288680',
      taxonomy_code: prov?.taxonomy_code || ps.taxonomy_code || '163W00000X',
      license_number: prov?.license_number || null, entity_type: prov?.entity_type || null,
    },
    referringProvider: {
      first_name: 'Sint',
      last_name: 'Eiusmod',
      npi: '1184288680',
      provider_type: '1',
      verification_status: 'verified',
    },
    payer: {
      name: payer?.name || 'UnitedHealthcare', payer_id: payer?.payer_id || '87726C',
      stedi_payer_id: payer?.stedi_payer_id || '87726', referringProviderPolicy: 'required',
    },
  });

  console.log('[Script] EDI ISA line:', edi.split('~')[0]);

  const result = await submitClaim({
    ediContent: edi, claimId: c.id, hasUserSession: true, userAgent: 'ClaimShield/AdminScript',
  });

  console.log('[Script] Result:', JSON.stringify(result, null, 2));

  if (result.success) {
    await pool.query(
      "UPDATE claims SET status='submitted', stedi_transaction_id=$1, submission_method='stedi', updated_at=NOW() WHERE id=$2",
      [result.transactionId, CLAIM_ID]
    );
    console.log('[Script] ✓ Claim set to submitted. Watch webhook logs now!');
  }

  await pool.end();
}

run().catch(e => { console.error('[Script] Fatal:', e.message); process.exit(1); });
