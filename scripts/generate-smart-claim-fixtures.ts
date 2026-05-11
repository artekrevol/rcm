/**
 * Generates synthetic Smart Claim test fixture PDFs using pdf-lib.
 * Creates two VA referral PDFs and two matching QB invoice PDFs.
 *
 * Patient 1: ANDERSON TEST FIXTURE  EDIPI: 9999999999  SEOC: 1.28.2 (12-16 hrs/week)
 * Patient 2: BENNETT TEST FIXTURE   EDIPI: 9999999998  SEOC: 1.38.2 (21-25 hrs/week)
 *
 * Run: npx tsx scripts/generate-smart-claim-fixtures.ts
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as fs from "fs";
import * as path from "path";

const VA_DIR = path.resolve("test/fixtures/va-referrals");
const QB_DIR = path.resolve("test/fixtures/qb-invoices");

interface FixtureSpec {
  filename: string;
  edipi: string;
  lastName: string;
  firstName: string;
  dob: string;
  gender: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  authNumber: string;
  issueDate: string;
  expirationDate: string;
  seocCode: string;
  seocDesc: string;
  icd10: string;
  icd10Desc: string;
  facilityName: string;
  stationNumber: string;
  network: string;
  requestingProvider: string;
  invoiceNumber: string;
  invoiceDate: string;
  lineItems: Array<{
    date: string;
    description: string;
    hours: number;
    rate: number;
    total: number;
  }>;
}

const FIXTURES: FixtureSpec[] = [
  {
    filename: "anderson",
    edipi: "9999999999",
    lastName: "ANDERSON",
    firstName: "TEST FIXTURE",
    dob: "03/15/1968",
    gender: "Male",
    address: "123 SYNTHETIC LANE",
    city: "RICHMOND",
    state: "VA",
    zip: "23220",
    phone: "804-555-0100",
    authNumber: "TW-FIXTURE-2026-001",
    issueDate: "01/01/2026",
    expirationDate: "06/30/2026",
    seocCode: "1.28.2",
    seocDesc: "Home Health Aide Services (15-min units) - 12-16 hours/week",
    icd10: "Z74.09",
    icd10Desc: "Other reduced mobility",
    facilityName: "Richard L. Roudebush VA Medical Center",
    stationNumber: "583",
    network: "CC Network 4",
    requestingProvider: "SMITH, JOHN",
    invoiceNumber: "QB-FIXTURE-001",
    invoiceDate: "04/30/2026",
    lineItems: [
      { date: "04/01/2026", description: "Home Health Aide Services", hours: 14, rate: 28.50, total: 399.00 },
      { date: "04/08/2026", description: "Home Health Aide Services", hours: 14, rate: 28.50, total: 399.00 },
      { date: "04/15/2026", description: "Home Health Aide Services", hours: 13, rate: 28.50, total: 370.50 },
      { date: "04/22/2026", description: "Home Health Aide Services", hours: 14, rate: 28.50, total: 399.00 },
      { date: "04/29/2026", description: "Home Health Aide Services", hours: 7,  rate: 28.50, total: 199.50 },
    ],
  },
  {
    filename: "bennett",
    edipi: "9999999998",
    lastName: "BENNETT",
    firstName: "TEST FIXTURE",
    dob: "07/22/1955",
    gender: "Female",
    address: "456 FIXTURE ROAD",
    city: "NORFOLK",
    state: "VA",
    zip: "23510",
    phone: "757-555-0200",
    authNumber: "TW-FIXTURE-2026-002",
    issueDate: "01/01/2026",
    expirationDate: "06/30/2026",
    seocCode: "1.38.2",
    seocDesc: "Home Health Aide Services (15-min units) - 21-25 hours/week",
    icd10: "M79.3",
    icd10Desc: "Panniculitis, unspecified",
    facilityName: "Hampton VA Medical Center",
    stationNumber: "590",
    network: "CC Network 4",
    requestingProvider: "JONES, MARY",
    invoiceNumber: "QB-FIXTURE-002",
    invoiceDate: "04/30/2026",
    lineItems: [
      { date: "04/01/2026", description: "Home Health Aide Services", hours: 22, rate: 28.50, total: 627.00 },
      { date: "04/08/2026", description: "Home Health Aide Services", hours: 24, rate: 28.50, total: 684.00 },
      { date: "04/15/2026", description: "Home Health Aide Services", hours: 23, rate: 28.50, total: 655.50 },
      { date: "04/22/2026", description: "Home Health Aide Services", hours: 22, rate: 28.50, total: 627.00 },
      { date: "04/29/2026", description: "Home Health Aide Services", hours: 11, rate: 28.50, total: 313.50 },
    ],
  },
];

async function createVaReferralPdf(spec: FixtureSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  const { width, height } = page.getSize();

  let y = height - 40;
  const leftMargin = 50;
  const col2 = 300;
  const lineH = 18;
  const smallLineH = 14;

  function drawTitle(text: string) {
    page.drawText(text, { x: leftMargin, y, font: boldFont, size: 14, color: rgb(0, 0, 0.6) });
    y -= lineH + 6;
    page.drawLine({ start: { x: leftMargin, y }, end: { x: width - leftMargin, y }, thickness: 1, color: rgb(0.4, 0.4, 0.4) });
    y -= 10;
  }

  function drawSection(label: string) {
    y -= 4;
    page.drawText(label, { x: leftMargin, y, font: boldFont, size: 10, color: rgb(0.2, 0.2, 0.2) });
    y -= smallLineH + 2;
  }

  function drawKV(key: string, value: string, x = leftMargin) {
    page.drawText(`${key}:`, { x, y, font: boldFont, size: 9, color: rgb(0.3, 0.3, 0.3) });
    page.drawText(value, { x: x + 140, y, font, size: 9, color: rgb(0, 0, 0) });
    y -= smallLineH;
  }

  function drawKVRow(pairs: Array<[string, string]>) {
    const startY = y;
    for (let i = 0; i < pairs.length; i++) {
      const xOff = leftMargin + i * 180;
      page.drawText(`${pairs[i][0]}:`, { x: xOff, y: startY, font: boldFont, size: 9, color: rgb(0.3, 0.3, 0.3) });
      page.drawText(pairs[i][1], { x: xOff + 100, y: startY, font, size: 9, color: rgb(0, 0, 0) });
    }
    y -= smallLineH;
  }

  // ── Header ─────────────────────────────────────────────────────────────────
  drawTitle("VA COMMUNITY CARE — REFERRAL / AUTHORIZATION");

  page.drawText("Department of Veterans Affairs", { x: leftMargin, y, font: boldFont, size: 9 });
  page.drawText("Office of Community Care", { x: col2, y, font, size: 9 });
  y -= smallLineH;
  page.drawText("Community Care Network", { x: leftMargin, y, font, size: 9 });
  y -= lineH;

  // ── Patient section ────────────────────────────────────────────────────────
  drawSection("VETERAN / PATIENT INFORMATION");
  drawKV("Veteran Name", `${spec.lastName}, ${spec.firstName}`);
  drawKV("Veteran EDIPI", spec.edipi);
  drawKV("Date of Birth", spec.dob);
  drawKVRow([["Gender", spec.gender], ["SSN", "999-99-9999"]]);
  drawKV("Address", spec.address);
  drawKVRow([["City", spec.city], ["State", spec.state], ["Zip", spec.zip]]);
  drawKV("Phone", spec.phone);

  // ── Authorization section ──────────────────────────────────────────────────
  drawSection("AUTHORIZATION INFORMATION");
  drawKV("Authorization Number", spec.authNumber);
  drawKVRow([["Issue Date", spec.issueDate], ["Expiration Date", spec.expirationDate]]);
  drawKV("Priority", "Routine");
  drawKV("SEOC Code", spec.seocCode);
  drawKV("Authorized Services", spec.seocDesc);
  drawKV("Duration", "180");
  drawKV("Program Authority", "MISSION Act");
  drawKV("Network", spec.network);

  // ── Diagnosis section ──────────────────────────────────────────────────────
  drawSection("DIAGNOSIS");
  drawKV("Diagnosis", `${spec.icd10} ${spec.icd10Desc}`);
  drawKV("Recommended Treatment", "Home Health Aide services per SEOC authorization");

  // ── Facility section ───────────────────────────────────────────────────────
  drawSection("ORDERING FACILITY");
  drawKV("Facility Name", spec.facilityName);
  drawKV("Station Number", spec.stationNumber);
  drawKV("Facility Address", "1201 Broad Rock Blvd, Richmond VA 23249");
  drawKV("Facility Phone", "800-303-1111");
  drawKV("Facility Fax", "877-999-0034");

  // ── Provider section ───────────────────────────────────────────────────────
  drawSection("REQUESTING PROVIDER");
  drawKV("Requesting Provider", spec.requestingProvider);
  drawKV("Requesting Provider Specialty", "Primary Care");

  // ── Services table header ──────────────────────────────────────────────────
  drawSection("AUTHORIZED SERVICES TABLE");
  y -= 4;
  const tStartY = y;
  const cols = [leftMargin, leftMargin + 200, leftMargin + 360];
  page.drawRectangle({ x: leftMargin, y: y - 2, width: width - 100, height: 14, color: rgb(0.85, 0.85, 0.85) });
  page.drawText("Service Description", { x: cols[0] + 2, y, font: boldFont, size: 8 });
  page.drawText("Unit Type", { x: cols[1] + 2, y, font: boldFont, size: 8 });
  page.drawText("Authorized Hours/Week", { x: cols[2] + 2, y, font: boldFont, size: 8 });
  y -= smallLineH;
  page.drawText(spec.seocDesc, { x: cols[0] + 2, y, font, size: 8 });
  page.drawText("15-min units", { x: cols[1] + 2, y, font, size: 8 });
  page.drawText(spec.seocCode === "1.28.2" ? "12-16" : "21-25", { x: cols[2] + 2, y, font, size: 8 });
  y -= lineH + 6;

  // ── Misc ───────────────────────────────────────────────────────────────────
  drawKV("Category of Care", "Home Health");
  drawKV("Type of Care", "Home Health Aide");
  drawKV("Rate Basis", "Per 15-min Unit");
  drawKV("Allergies", "NKDA");
  drawKV("Medications", "Lisinopril 10mg, Metformin 500mg");
  drawKV("Care Coordination", "No");

  const bytes = await doc.save();
  return bytes;
}

async function createQbInvoicePdf(spec: FixtureSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  const { width, height } = page.getSize();

  let y = height - 40;
  const leftMargin = 50;
  const lineH = 18;
  const smallLineH = 14;

  function drawKV(key: string, value: string, x = leftMargin) {
    page.drawText(`${key}:`, { x, y, font: boldFont, size: 9, color: rgb(0.3, 0.3, 0.3) });
    page.drawText(value, { x: x + 130, y, font, size: 9, color: rgb(0, 0, 0) });
    y -= smallLineH;
  }

  // ── Agency header (top of invoice — parsed as "agency_name" by qb-parser) ──
  page.drawText("Caritas Home Care Agency", { x: leftMargin, y, font: boldFont, size: 13, color: rgb(0, 0.3, 0.6) });
  y -= smallLineH;
  page.drawText("100 Care Blvd, Richmond VA 23220", { x: leftMargin, y, font, size: 9 });
  y -= smallLineH;
  page.drawText("Phone: 804-555-9000  |  EIN: 54-9999001", { x: leftMargin, y, font, size: 9 });
  y -= lineH + 10;

  // ── Invoice header ─────────────────────────────────────────────────────────
  page.drawText("INVOICE", { x: leftMargin, y, font: boldFont, size: 16, color: rgb(0.2, 0.2, 0.2) });
  y -= lineH + 4;

  drawKV("Invoice No", spec.invoiceNumber);
  drawKV("Invoice Date", spec.invoiceDate);
  drawKV("Due Date", "05/30/2026");
  drawKV("Bill To", `${spec.lastName}, ${spec.firstName}`);
  drawKV("Account", "VA Community Care");
  y -= 8;

  // ── Line items table ───────────────────────────────────────────────────────
  const colDate = leftMargin;
  const colDesc = leftMargin + 85;
  const colHrs  = leftMargin + 295;
  const colRate = leftMargin + 355;
  const colAmt  = leftMargin + 415;

  page.drawRectangle({ x: leftMargin, y: y - 2, width: width - 100, height: 14, color: rgb(0.85, 0.85, 0.85) });
  page.drawText("Service Date", { x: colDate + 2, y, font: boldFont, size: 8 });
  page.drawText("Description",  { x: colDesc + 2, y, font: boldFont, size: 8 });
  page.drawText("Hours",        { x: colHrs  + 2, y, font: boldFont, size: 8 });
  page.drawText("Rate",         { x: colRate + 2, y, font: boldFont, size: 8 });
  page.drawText("Amount",       { x: colAmt  + 2, y, font: boldFont, size: 8 });
  y -= smallLineH;

  let subtotal = 0;
  for (const li of spec.lineItems) {
    page.drawText(li.date,                       { x: colDate + 2, y, font, size: 8 });
    page.drawText(li.description,                { x: colDesc + 2, y, font, size: 8 });
    page.drawText(li.hours.toString(),           { x: colHrs  + 2, y, font, size: 8 });
    page.drawText(`$${li.rate.toFixed(2)}`,      { x: colRate + 2, y, font, size: 8 });
    page.drawText(`$${li.total.toFixed(2)}`,     { x: colAmt  + 2, y, font, size: 8 });
    subtotal += li.total;
    y -= smallLineH;
  }

  y -= 6;
  page.drawLine({ start: { x: leftMargin, y }, end: { x: width - 50, y }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
  y -= smallLineH;

  drawKV("Subtotal", `$${subtotal.toFixed(2)}`, colRate - 30);
  drawKV("Total",    `$${subtotal.toFixed(2)}`, colRate - 30);

  y -= lineH;
  page.drawText("Thank you for your business.", { x: leftMargin, y, font, size: 9, color: rgb(0.5, 0.5, 0.5) });
  y -= smallLineH;
  page.drawText("VA Community Care Authorization Required for all services rendered.", { x: leftMargin, y, font, size: 8, color: rgb(0.5, 0.5, 0.5) });

  const bytes = await doc.save();
  return bytes;
}

async function main() {
  console.log("Generating Smart Claim test fixtures...\n");

  for (const spec of FIXTURES) {
    // VA Referral PDF
    const vaPdf = await createVaReferralPdf(spec);
    const vaPath = path.join(VA_DIR, `${spec.filename}-va-referral.pdf`);
    fs.writeFileSync(vaPath, vaPdf);
    console.log(`✓ VA referral: ${vaPath} (${vaPdf.byteLength} bytes)`);

    // QB Invoice PDF
    const qbPdf = await createQbInvoicePdf(spec);
    const qbPath = path.join(QB_DIR, `${spec.filename}-qb-invoice.pdf`);
    fs.writeFileSync(qbPath, qbPdf);
    console.log(`✓ QB invoice:  ${qbPath} (${qbPdf.byteLength} bytes)`);
  }

  console.log("\nAll fixtures generated successfully.");
}

main().catch((err) => {
  console.error("Fixture generation failed:", err);
  process.exit(1);
});
