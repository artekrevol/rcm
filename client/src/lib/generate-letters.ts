import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const LINE_H = 16;
const LEFT = 60;
const RIGHT = 540;
const TOP = 750;

interface PageWriter {
  page: any;
  font: any;
  boldFont: any;
  y: number;
  newPage: () => void;
}

function createWriter(doc: PDFDocument, font: any, boldFont: any): PageWriter {
  const writer: PageWriter = {
    page: doc.addPage([612, 792]),
    font,
    boldFont,
    y: TOP,
    newPage() {
      this.page = doc.addPage([612, 792]);
      this.y = TOP;
    },
  };
  return writer;
}

function writeLine(w: PageWriter, text: string, opts?: { bold?: boolean; size?: number; indent?: number }) {
  const size = opts?.size ?? 11;
  const x = LEFT + (opts?.indent ?? 0);
  if (w.y < 80) w.newPage();
  w.page.drawText(text, { x, y: w.y, size, font: opts?.bold ? w.boldFont : w.font, color: rgb(0, 0, 0) });
  w.y -= LINE_H * (size / 10);
}

function writeBlank(w: PageWriter, lines = 1) {
  w.y -= LINE_H * lines;
}

function wrapText(text: string, maxChars = 90): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if ((current + " " + w).trim().length > maxChars) {
      if (current) lines.push(current.trim());
      current = w;
    } else {
      current = current ? current + " " + w : w;
    }
  }
  if (current) lines.push(current.trim());
  return lines;
}

function writeParagraph(w: PageWriter, text: string, opts?: { bold?: boolean; size?: number }) {
  const lines = wrapText(text, 90);
  for (const line of lines) writeLine(w, line, opts);
  writeBlank(w);
}

function drawHR(w: PageWriter) {
  w.page.drawLine({ start: { x: LEFT, y: w.y + 4 }, end: { x: RIGHT, y: w.y + 4 }, thickness: 0.5, color: rgb(0.4, 0.4, 0.4) });
  w.y -= 8;
}

export async function generateTimelinessPDF(letterData: any): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = createWriter(doc, font, bold);

  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const { practice, payer, patient, claim, submissionDate, tcn } = letterData;

  // Header
  writeLine(w, practice?.practice_name || "Billing Practice", { bold: true, size: 13 });
  writeLine(w, practice?.phone || "", { size: 10 });
  writeLine(w, practice?.email || "", { size: 10 });
  writeBlank(w);
  writeLine(w, today, { size: 11 });
  writeBlank(w);

  // Addressee
  writeLine(w, payer?.name || "Insurance Payer", { bold: true });
  if (payer?.address) writeLine(w, payer.address, { size: 10 });
  writeBlank(w);

  // Subject
  writeLine(w, "RE: PROOF OF TIMELY FILING", { bold: true, size: 12 });
  drawHR(w);
  writeBlank(w);

  // Claim info block
  writeLine(w, `Patient Name:          ${patient?.full_name || "—"}`);
  writeLine(w, `Member ID:             ${patient?.member_id || "—"}`);
  writeLine(w, `Date of Birth:         ${patient?.dob || "—"}`);
  writeLine(w, `Service Date:          ${claim?.service_date ? new Date(claim.service_date).toLocaleDateString() : "—"}`);
  writeLine(w, `Claim Amount:          $${(claim?.amount || 0).toFixed(2)}`);
  writeLine(w, `Original Submission:   ${submissionDate ? new Date(submissionDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "—"}`);
  if (tcn) writeLine(w, `Transaction Control #: ${tcn}`);
  writeBlank(w, 2);

  // Body
  writeParagraph(w, `To Whom It May Concern,`);
  writeParagraph(w, `This letter serves as official proof that the above-referenced claim was submitted within the contractual timely filing period. Please find below the documentation supporting the original submission date.`);
  writeParagraph(w, `Our records confirm that the claim was originally filed on or before the above-noted submission date. The claim was submitted electronically via our billing system and has a verifiable transaction control number. If you require additional documentation (e.g., EDI acknowledgment, clearinghouse confirmation), we are prepared to provide it upon request.`);
  writeParagraph(w, `We respectfully request that this claim be reprocessed in accordance with your timely filing policies and that any denial based on untimely filing be reversed. If you have questions or require further documentation, please contact our billing department at the number above.`);

  writeLine(w, "Sincerely,");
  writeBlank(w, 2);
  writeLine(w, practice?.practice_name || "Billing Department", { bold: true });
  writeLine(w, "Medical Billing Department");

  return doc.save();
}

export async function generateAppealLetterPDF(letterData: any): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = createWriter(doc, font, bold);

  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const { practice, payer, patient, claim, denialDate, denialCode, denialDescription, submissionDate, tcn } = letterData;

  // Header
  writeLine(w, practice?.practice_name || "Billing Practice", { bold: true, size: 13 });
  writeLine(w, practice?.phone || "", { size: 10 });
  writeLine(w, practice?.email || "", { size: 10 });
  writeBlank(w);
  writeLine(w, today, { size: 11 });
  writeBlank(w);

  // Addressee
  writeLine(w, "Appeals Department", { bold: true });
  writeLine(w, payer?.name || "Insurance Payer", { bold: true });
  if (payer?.address) writeLine(w, payer.address, { size: 10 });
  writeBlank(w);

  // Subject
  writeLine(w, "RE: FORMAL APPEAL OF CLAIM DENIAL", { bold: true, size: 12 });
  drawHR(w);
  writeBlank(w);

  // Claim info block
  writeLine(w, `Patient Name:          ${patient?.full_name || "—"}`);
  writeLine(w, `Member ID:             ${patient?.member_id || "—"}`);
  writeLine(w, `Date of Birth:         ${patient?.dob || "—"}`);
  writeLine(w, `Service Date:          ${claim?.service_date ? new Date(claim.service_date).toLocaleDateString() : "—"}`);
  writeLine(w, `Claim Amount:          $${(claim?.amount || 0).toFixed(2)}`);
  writeLine(w, `Original Submission:   ${submissionDate ? new Date(submissionDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "—"}`);
  if (tcn) writeLine(w, `Transaction Control #: ${tcn}`);
  if (denialDate) writeLine(w, `Denial Date:           ${new Date(denialDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`);
  if (denialCode) writeLine(w, `Denial Code:           ${denialCode}`);
  if (denialDescription) writeLine(w, `Denial Reason:         ${denialDescription}`);
  writeBlank(w, 2);

  // Body
  writeParagraph(w, `To Whom It May Concern,`);
  writeParagraph(w, `We are writing to formally appeal the denial of the above-referenced claim. This appeal is submitted in accordance with your organization's appeals process and the applicable state and federal regulations governing the timely review of denied claims.`);

  if (denialCode) {
    writeParagraph(w, `The claim was denied with reason code ${denialCode}${denialDescription ? ` (${denialDescription})` : ""}. We respectfully dispute this determination and request a thorough review of the clinical and administrative documentation supporting this claim.`);
  }

  writeParagraph(w, `The services rendered were medically necessary and appropriate for the patient's condition and diagnosis. The treating provider followed all applicable clinical guidelines and documentation requirements. We have attached all supporting documentation including: (1) the complete medical record, (2) the original claim, (3) the explanation of benefits, and (4) any relevant prior authorization documentation.`);

  writeParagraph(w, `We request that you overturn the denial and process this claim for payment in accordance with the member's plan benefits and our contractual agreement. If this appeal is not resolved in our favor at this level, we request information regarding the next level of appeal available.`);

  writeParagraph(w, `Please acknowledge receipt of this appeal and provide a decision within the timeframe required by your policy and applicable law. If you require additional information or documentation, please contact us promptly at the number above.`);

  writeLine(w, "Sincerely,");
  writeBlank(w, 2);
  writeLine(w, practice?.practice_name || "Billing Department", { bold: true });
  writeLine(w, "Medical Billing Department");

  writeLine(w, "", { size: 10 });
  writeBlank(w, 2);
  drawHR(w);
  writeLine(w, "Enclosures: Medical Records, Original Claim, EOB, Prior Authorization (if applicable)", { size: 9 });

  return doc.save();
}
