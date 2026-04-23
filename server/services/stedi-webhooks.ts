import crypto from 'crypto';

const STEDI_API_KEY = process.env.STEDI_API_KEY;

export async function fetchStediTransaction(
  transactionId: string,
  transactionType: '277' | '835'
): Promise<any | null> {
  if (!STEDI_API_KEY) {
    console.error('[Stedi] No API key configured');
    return null;
  }

  const url = `https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/claims/reports/${transactionId}`;

  try {
    const response = await fetch(url, {
      headers: { 'Authorization': `Key ${STEDI_API_KEY}` }
    });

    if (!response.ok) {
      console.error(`[Stedi] Fetch ${transactionType} failed:`,
        response.status, await response.text());
      return null;
    }

    const data = await response.json();

    const db = await import('../db').then(m => m.pool);
    const countResult = await db.query(
      "SELECT COUNT(*) FROM webhook_events WHERE event_type LIKE '%transaction.processed%'"
    );
    if (parseInt(countResult.rows[0].count) < 10) {
      console.log(`[Stedi] ${transactionType} raw response sample:`,
        JSON.stringify(data).slice(0, 1000));
    }

    return data;
  } catch (err) {
    console.error(`[Stedi] Error fetching ${transactionType}:`, err);
    return null;
  }
}

export async function process277CA(
  data: any,
  transactionId: string,
  db: any
): Promise<void> {
  const claimStatuses =
    data?.claimStatuses ||
    data?.claims ||
    data?.claimStatusDetails ||
    [];

  for (const claimStatus of claimStatuses) {
    const claimControlNumber =
      claimStatus?.claimReference?.patientControlNumber ||
      claimStatus?.patientControlNumber ||
      claimStatus?.claimControlNumber ||
      data?.claimReference?.patientControlNumber;

    const statusCategoryCode =
      claimStatus?.statusInformation?.[0]?.statusCategoryCode ||
      claimStatus?.statusCategoryCode ||
      claimStatus?.status?.categoryCode ||
      data?.statusCategoryCode;

    const payerName =
      data?.payer?.name ||
      data?.payerName ||
      'Unknown Payer';

    if (!claimControlNumber) {
      console.warn('[277CA] No claim control number in:',
        JSON.stringify(claimStatus).slice(0, 200));
      continue;
    }

    const statusMap: Record<string, string> = {
      'A1': 'acknowledged',
      'A2': 'rejected',
      'A3': 'rejected',
      'A4': 'acknowledged',
      'A6': 'acknowledged',
      'A7': 'acknowledged',
      'A8': 'acknowledged',
    };
    const newStatus = statusMap[statusCategoryCode] || 'acknowledged';

    const claimResult = await db.query(
      `SELECT id, status, organization_id FROM claims 
       WHERE id = $1 OR stedi_transaction_id = $2 
       LIMIT 1`,
      [claimControlNumber, transactionId]
    );

    if (!claimResult.rows.length) {
      console.warn('[277CA] No claim found for:', claimControlNumber);
      continue;
    }

    const claim = claimResult.rows[0];
    if (claim.status !== 'submitted') continue;

    await db.query(
      `UPDATE claims SET status=$1, updated_at=NOW() WHERE id=$2`,
      [newStatus, claim.id]
    );

    await db.query(
      `INSERT INTO claim_events 
       (id, claim_id, type, notes, timestamp, organization_id)
       VALUES ($1,$2,$3,$4,NOW(),$5)`,
      [
        crypto.randomUUID(),
        claim.id,
        '277CA Received',
        `Payer acknowledgment via webhook. Status: ${newStatus}. Code: ${statusCategoryCode}. Payer: ${payerName}`,
        claim.organization_id
      ]
    );

    console.log(`[277CA] Claim ${claim.id} → ${newStatus}`);
  }

  if (!claimStatuses.length) {
    console.warn('[277CA] Unexpected response structure:',
      JSON.stringify(data).slice(0, 500));
  }
}

export async function process835ERA(
  data: any,
  transactionId: string,
  db: any
): Promise<void> {
  const paymentInfo =
    data?.financialInformation ||
    data?.paymentInfo ||
    data?.payment ||
    {};

  const checkNumber =
    paymentInfo?.checkNumber ||
    paymentInfo?.traceNumber ||
    paymentInfo?.referenceNumber ||
    data?.checkNumber ||
    transactionId;

  const checkDate =
    paymentInfo?.checkDate ||
    paymentInfo?.effectiveDate ||
    data?.checkDate ||
    new Date().toISOString().slice(0, 10);

  const payerName =
    data?.payer?.name ||
    data?.payerName ||
    'Unknown Payer';

  const totalPayment = parseFloat(
    paymentInfo?.totalActualProviderPaymentAmount ||
    paymentInfo?.amount ||
    paymentInfo?.totalPayment ||
    data?.totalPayment ||
    '0'
  );

  const claimLines =
    data?.claimPaymentInformation ||
    data?.claims ||
    data?.claimPayments ||
    [];

  const existing = await db.query(
    'SELECT id FROM era_batches WHERE check_number = $1',
    [checkNumber]
  );
  if (existing.rows.length) {
    console.log(`[835] ERA ${checkNumber} already imported`);
    return;
  }

  let orgId: string | null = null;
  for (const line of claimLines) {
    const controlNum =
      line?.claimPaymentInfo?.patientControlNumber ||
      line?.patientControlNumber ||
      line?.claimControlNumber;
    if (!controlNum) continue;
    const match = await db.query(
      'SELECT organization_id FROM claims WHERE id=$1 LIMIT 1',
      [controlNum]
    );
    if (match.rows[0]?.organization_id) {
      orgId = match.rows[0].organization_id;
      break;
    }
  }

  const eraId = crypto.randomUUID();
  await db.query(
    `INSERT INTO era_batches 
     (id, organization_id, payer_name, check_number,
      check_date, total_amount, status, stedi_era_id,
      raw_data, source, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,'unposted',$7,$8,'stedi_webhook',NOW())`,
    [eraId, orgId, payerName, checkNumber, checkDate,
     totalPayment, transactionId, JSON.stringify(data)]
  );

  for (const line of claimLines) {
    const controlNum =
      line?.claimPaymentInfo?.patientControlNumber ||
      line?.patientControlNumber ||
      line?.claimControlNumber || '';

    const patientName = [
      line?.patient?.firstName || line?.patientFirstName,
      line?.patient?.lastName || line?.patientLastName
    ].filter(Boolean).join(' ') || 'Unknown';

    const billedAmount = parseFloat(
      line?.claimPaymentInfo?.totalClaimChargeAmount ||
      line?.billedAmount || '0'
    );
    const paidAmount = parseFloat(
      line?.claimPaymentInfo?.claimPaymentAmount ||
      line?.paidAmount || '0'
    );

    const adjustments =
      line?.claimAdjustments ||
      line?.adjustments ||
      [];

    await db.query(
      `INSERT INTO era_claim_lines
       (id, era_batch_id, claim_control_number,
        patient_name, billed_amount, allowed_amount,
        paid_amount, adjustment_codes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
      [
        crypto.randomUUID(), eraId, controlNum, patientName,
        billedAmount, paidAmount, paidAmount,
        JSON.stringify(adjustments.map((adj: any) => ({
          code: `${adj.claimAdjustmentGroupCode || adj.groupCode}-${adj.claimAdjustmentReasonCode || adj.reasonCode}`,
          amount: parseFloat(adj.claimAdjustmentAmount || adj.amount || '0'),
          reason: adj.reasonDescription || adj.claimAdjustmentReasonCode || ''
        })))
      ]
    );

    if (controlNum && adjustments.length > 0) {
      await applyCARCRules(controlNum, adjustments, db);
    }
  }

  console.log(`[835] Imported ERA ${checkNumber}, ${claimLines.length} lines, org: ${orgId}`);
}

async function applyCARCRules(
  claimControlNumber: string,
  adjustments: any[],
  db: any
): Promise<void> {
  const claimResult = await db.query(
    'SELECT id, organization_id FROM claims WHERE id=$1 LIMIT 1',
    [claimControlNumber]
  );
  if (!claimResult.rows.length) return;
  const claim = claimResult.rows[0];

  for (const adj of adjustments) {
    const carcCode =
      adj.claimAdjustmentReasonCode ||
      adj.reasonCode || '';

    const ruleResult = await db.query(
      'SELECT * FROM carc_posting_rules WHERE carc_code=$1',
      [carcCode]
    );

    if (!ruleResult.rows.length) continue;
    const rule = ruleResult.rows[0];

    switch (rule.default_action) {
      case 'auto_writeoff':
        await db.query(
          `UPDATE claims SET status='paid', updated_at=NOW() WHERE id=$1`,
          [claim.id]
        );
        break;
      case 'flag_appeal':
        await db.query(
          `UPDATE claims SET status='appeal_needed', updated_at=NOW() WHERE id=$1`,
          [claim.id]
        );
        break;
      case 'flag_review':
        await db.query(
          `UPDATE claims SET status='review_needed', updated_at=NOW() WHERE id=$1`,
          [claim.id]
        );
        break;
      case 'patient_responsibility':
        await db.query(
          `UPDATE claims SET status='patient_responsibility', updated_at=NOW() WHERE id=$1`,
          [claim.id]
        );
        break;
    }

    await db.query(
      `INSERT INTO claim_events
       (id, claim_id, type, notes, timestamp, organization_id)
       VALUES ($1,$2,$3,$4,NOW(),$5)`,
      [
        crypto.randomUUID(),
        claim.id,
        'ERA Adjustment',
        `CARC ${carcCode}: ${rule.description}. Action: ${rule.default_action}`,
        claim.organization_id
      ]
    );
  }
}
