import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { CMS1500_FIELDS } from './cms1500-fields';

export interface CMS1500Data {
  patientFirstName: string;
  patientLastName: string;
  patientDob: string;
  patientSex: string;
  patientAddress: string;
  patientCity: string;
  patientState: string;
  patientZip: string;
  patientPhone: string;

  insuredName: string;
  insuredIdNumber: string;
  groupNumber: string;
  relationshipToInsured: string;
  insuredDob: string;
  policyType: string;

  renderingProviderName: string;
  renderingProviderNPI: string;
  renderingProviderCredentials: string;
  referringProviderName: string;
  referringProviderNPI: string;

  // Box 17/17b — Ordering provider (home health)
  orderingProviderName?: string;
  orderingProviderNPI?: string;

  practiceNPI: string;
  practiceTaxId: string;
  practiceName: string;
  practiceAddress: string;
  practiceCity: string;
  practiceState: string;
  practiceZip: string;
  practicePhone: string;

  serviceDate: string;
  placeOfService: string;
  authorizationNumber: string;
  icd10Primary: string;
  icd10Secondary: string[];

  // Box 22 — Claim frequency / resubmission
  claimFrequencyCode?: string;
  originalClaimNumber?: string;

  // Box 10d — Homebound indicator
  homeboundIndicator?: boolean;

  serviceLines: Array<{
    code: string;
    modifier?: string;
    units: number;
    charge: number;
    diagnosisPointer: string;
  }>;

  totalCharge: number;
  claimId: string;
}

export async function generateCalibrationPDF(): Promise<Uint8Array> {
  const blankFormBytes = await fetch('/cms1500-blank.pdf').then(r => r.arrayBuffer());
  const pdfDoc = await PDFDocument.load(blankFormBytes);
  const pages = pdfDoc.getPages();
  const page = pages[0];
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  Object.entries(CMS1500_FIELDS).forEach(([name, [x, y]]) => {
    page.drawCircle({ x, y, size: 3, color: rgb(1, 0, 0) });
    page.drawText(name.slice(0, 12), {
      x: x + 4, y: y - 3, size: 4, font, color: rgb(1, 0, 0),
    });
  });

  return await pdfDoc.save();
}

export async function generateCMS1500PDF(data: CMS1500Data): Promise<Uint8Array> {
  const blankFormBytes = await fetch('/cms1500-blank.pdf').then(r => r.arrayBuffer());
  const pdfDoc = await PDFDocument.load(blankFormBytes);
  const pages = pdfDoc.getPages();
  const page = pages[0];
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSize = 8;
  const black = rgb(0, 0, 0);

  function draw(fieldName: string, text: string, size: number = fontSize) {
    const coords = CMS1500_FIELDS[fieldName];
    if (!coords || !text) return;
    const [x, y] = coords;
    page.drawText(String(text).toUpperCase().slice(0, 28), {
      x, y, size, font, color: black,
    });
  }

  function drawX(fieldName: string) {
    const coords = CMS1500_FIELDS[fieldName];
    if (!coords) return;
    const [x, y] = coords;
    page.drawText('X', { x, y, size: fontSize, font, color: black });
  }

  function parseDOB(dob: string): { mm: string; dd: string; yy: string } | null {
    if (!dob) return null;
    const iso = dob.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return { yy: iso[1], mm: iso[2], dd: iso[3] };
    const us = dob.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (us) return { mm: us[1].padStart(2,'0'), dd: us[2].padStart(2,'0'), yy: us[3] };
    const short = dob.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
    if (short) return { mm: short[1].padStart(2,'0'), dd: short[2].padStart(2,'0'), yy: `20${short[3]}` };
    return null;
  }

  function fmtServiceDate(dateStr: string): string {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '';
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const yyyy = String(d.getFullYear());
      return `${mm}${dd}${yyyy}`;
    } catch { return ''; }
  }

  const payer = (data.policyType || '').toLowerCase();
  if (payer.includes('medicare')) drawX('insuranceTypeMedicare');
  else if (payer.includes('medicaid')) drawX('insuranceTypeMedicaid');
  else if (payer.includes('tricare')) drawX('insuranceTypeTricare');
  else if (payer.includes('va') || payer.includes('champva')) drawX('insuranceTypeChampva');
  else drawX('insuranceTypeOther');

  draw('insuredIdNumber', data.insuredIdNumber || '');

  const lastName = (data.patientLastName || '').trim();
  const firstName = (data.patientFirstName || '').trim();
  draw('patientName', lastName && firstName ? `${lastName}, ${firstName}` : lastName || firstName);

  const dob = parseDOB(data.patientDob || '');
  if (dob) {
    draw('patientDobMM', dob.mm);
    draw('patientDobDD', dob.dd);
    draw('patientDobYY', dob.yy);
  }
  const sex = (data.patientSex || '').toLowerCase();
  if (sex === 'male' || sex === 'm') drawX('patientSexMale');
  else if (sex === 'female' || sex === 'f') drawX('patientSexFemale');

  const insuredName = (data.relationshipToInsured || '').toLowerCase() === 'self'
    ? (lastName && firstName ? `${lastName}, ${firstName}` : lastName || firstName)
    : (data.insuredName || '');
  draw('insuredName', insuredName);

  draw('patientAddress', data.patientAddress || '');
  draw('patientCity', data.patientCity || '');
  draw('patientState', data.patientState || '');
  draw('patientZip', data.patientZip || '');
  draw('patientPhone', (data.patientPhone || '').replace(/\D/g, '').slice(0, 10));

  const rel = (data.relationshipToInsured || 'self').toLowerCase();
  if (rel === 'self') drawX('relationshipSelf');
  else if (rel === 'spouse') drawX('relationshipSpouse');
  else if (rel === 'child') drawX('relationshipChild');
  else drawX('relationshipOther');

  draw('insuredGroupNumber', data.groupNumber || '');

  draw('patientSignature', 'SIGNATURE ON FILE');
  draw('insuredSignature', 'SIGNATURE ON FILE');

  if (data.serviceDate) {
    const svcDob = parseDOB(data.serviceDate) || (() => {
      try {
        const d = new Date(data.serviceDate);
        if (!isNaN(d.getTime())) return {
          mm: String(d.getMonth() + 1).padStart(2, '0'),
          dd: String(d.getDate()).padStart(2, '0'),
          yy: String(d.getFullYear()),
        };
      } catch { return null; }
      return null;
    })();
    if (svcDob) {
      draw('currentIllnessMM', svcDob.mm);
      draw('currentIllnessDD', svcDob.dd);
      draw('currentIllnessYY', svcDob.yy);
    }
  }

  // Box 17/17b: prefer ordering provider, fall back to referring provider
  const boxProviderName = data.orderingProviderName || data.referringProviderName || '';
  const boxProviderNPI  = data.orderingProviderNPI  || data.referringProviderNPI  || '';
  draw('referringProviderName', boxProviderName);
  draw('referringProviderNPI',  boxProviderNPI);

  // Box 22: Resubmission code + original claim number
  if (data.claimFrequencyCode && data.claimFrequencyCode !== '1') {
    draw('box22FrequencyCode', data.claimFrequencyCode);
    if (data.originalClaimNumber) draw('box22OrigClaimNumber', data.originalClaimNumber);
  }

  // Box 10d: Homebound indicator
  if (data.homeboundIndicator) draw('box10dHomebound', 'Y');

  if (data.icd10Primary) draw('diagnosisA', data.icd10Primary);
  if (data.icd10Secondary?.[0]) draw('diagnosisB', data.icd10Secondary[0]);
  if (data.icd10Secondary?.[1]) draw('diagnosisC', data.icd10Secondary[1]);
  if (data.icd10Secondary?.[2]) draw('diagnosisD', data.icd10Secondary[2]);

  draw('priorAuthNumber', data.authorizationNumber || '');

  const lineKeys = [1, 2, 3, 4, 5, 6];
  const svcDate = fmtServiceDate(data.serviceDate);

  data.serviceLines.slice(0, 6).forEach((line, i) => {
    const n = lineKeys[i];
    draw(`line${n}DateFrom`,          svcDate);
    draw(`line${n}DateTo`,            svcDate);
    draw(`line${n}PlaceOfService`,    data.placeOfService || '12');
    draw(`line${n}ProcedureCode`,     line.code || '');
    if (line.modifier) draw(`line${n}Modifier`, line.modifier);
    draw(`line${n}DiagnosisPointer`,  line.diagnosisPointer || 'A');
    draw(`line${n}Charges`,           line.charge.toFixed(2));
    draw(`line${n}Units`,             String(Math.ceil(line.units)));
    draw(`line${n}NPI`,               data.renderingProviderNPI || '');
  });

  draw('federalTaxId', (data.practiceTaxId || '').replace('-', ''));
  drawX('taxIdTypeEIN');

  draw('patientAccountNumber', (data.claimId || '').slice(0, 14));

  drawX('acceptAssignmentYes');

  draw('totalCharge', data.totalCharge.toFixed(2));

  draw('amountPaid', '0.00');

  const providerSig = [data.renderingProviderName, data.renderingProviderCredentials]
    .filter(Boolean).join(', ');
  draw('physicianSignature', providerSig);
  draw('signatureDate', svcDate);

  draw('serviceFacilityName', `${lastName}, ${firstName}`);
  draw('serviceFacilityAddress', data.patientAddress || '');
  draw('serviceFacilityCityStateZip',
    [data.patientCity, data.patientState, data.patientZip].filter(Boolean).join(' '));

  draw('billingProviderName', data.practiceName || '');
  draw('billingProviderPhone', (data.practicePhone || '').replace(/\D/g, '').slice(0, 10));
  draw('billingProviderAddress', data.practiceAddress || '');
  draw('billingProviderCityStateZip',
    [data.practiceCity, data.practiceState, data.practiceZip].filter(Boolean).join(' '));
  draw('billingProviderNPI', data.practiceNPI || '');

  return await pdfDoc.save();
}

export async function buildCMS1500DataFromClaim(claimId: string): Promise<CMS1500Data> {
  const res = await fetch(`/api/billing/claims/${claimId}/pdf-data`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Failed to fetch claim data: ${res.status}`);
  const { claim, patient, provider, orderingProvider, practice, payerName } = await res.json();

  const addr = typeof patient?.address === 'object' && patient.address !== null
    ? patient.address
    : {};

  const alphaPointers = ['A','B','C','D','E','F'];
  let serviceLines: CMS1500Data['serviceLines'] = [];
  if (Array.isArray(claim.service_lines) && claim.service_lines.length > 0) {
    serviceLines = claim.service_lines.map((line: any, i: number) => ({
      code:             line.code || line.hcpcsCode || '',
      modifier:         line.modifier || '',
      units:            Number(line.units) || 1,
      charge:           Number(line.totalCharge || line.charge || 0),
      diagnosisPointer: line.diagnosisPointers || line.diagnosisPointer || line.diagnosis_pointer || alphaPointers[i] || 'A',
    }));
  } else if (Array.isArray(claim.cpt_codes) && claim.cpt_codes.length > 0) {
    const perLine = Number(claim.amount || 0) / claim.cpt_codes.length;
    serviceLines = claim.cpt_codes.map((code: string, i: number) => ({
      code,
      modifier: '',
      units: 1,
      charge: Math.round(perLine * 100) / 100,
      diagnosisPointer: alphaPointers[i] || 'A',
    }));
  }

  let icd10Secondary: string[] = [];
  if (claim.icd10_secondary) {
    try {
      icd10Secondary = Array.isArray(claim.icd10_secondary)
        ? claim.icd10_secondary
        : JSON.parse(claim.icd10_secondary);
    } catch { icd10Secondary = []; }
  }

  return {
    patientFirstName:          patient?.first_name || '',
    patientLastName:           patient?.last_name  || '',
    patientDob:                patient?.dob        || '',
    patientSex:                patient?.sex        || '',
    patientAddress:            addr.street || (typeof patient?.address === 'string' ? patient.address : '') || '',
    patientCity:               addr.city   || '',
    patientState:              addr.state  || patient?.state || '',
    patientZip:                addr.zip    || '',
    patientPhone:              patient?.phone || '',

    insuredName:               patient?.insured_name || '',
    insuredIdNumber:           patient?.member_id    || '',
    groupNumber:               patient?.group_number || '',
    relationshipToInsured:     patient?.relationship_to_insured || 'Self',
    insuredDob:                patient?.dob  || '',
    policyType:                payerName     || patient?.insurance_carrier || '',

    renderingProviderName:     provider ? `${provider.first_name || ''} ${provider.last_name || ''}`.trim() : '',
    renderingProviderNPI:      provider?.npi         || '',
    renderingProviderCredentials: provider?.credentials || '',
    referringProviderName:     patient?.referring_provider_name || '',
    referringProviderNPI:      patient?.referring_provider_npi  || '',

    practiceNPI:               practice?.primary_npi    || '',
    practiceTaxId:             practice?.tax_id          || '',
    practiceName:              practice?.practice_name   || '',
    practiceAddress:           practice?.address?.street || '',
    practiceCity:              practice?.address?.city   || '',
    practiceState:             practice?.address?.state  || '',
    practiceZip:               practice?.address?.zip    || '',
    practicePhone:             practice?.phone           || '',

    serviceDate:               claim.service_date    || claim.created_at || '',
    placeOfService:            claim.place_of_service || '12',
    authorizationNumber:       claim.authorization_number || '',
    icd10Primary:              claim.icd10_primary   || '',
    icd10Secondary,

    // Box 17/17b — Ordering provider (separate from rendering provider)
    orderingProviderName:      orderingProvider
      ? [orderingProvider.first_name, orderingProvider.last_name].filter(Boolean).join(' ')
      : undefined,
    orderingProviderNPI:       orderingProvider?.npi || undefined,

    // Box 22 — Claim frequency / resubmission
    claimFrequencyCode:        claim.claim_frequency_code || undefined,
    originalClaimNumber:       claim.orig_claim_number || undefined,

    // Box 10d — Homebound indicator
    homeboundIndicator:        !!claim.homebound_indicator,

    serviceLines,
    totalCharge: Number(claim.amount) || 0,
    claimId:    claim.id || '',
  };
}
