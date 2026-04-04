import { pdf } from "@react-pdf/renderer";
import { createElement } from "react";
import { ClaimSummaryDocument, buildClaimPdfData } from "@/components/claim-pdf";
import { apiRequest } from "@/lib/queryClient";

export async function generateAndDownloadClaimPdf(claimId: string): Promise<void> {
  const res = await fetch(`/api/billing/claims/${claimId}/pdf-data`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch claim data for PDF");
  const { claim, patient, provider, practice, payerName } = await res.json();

  const data = buildClaimPdfData({ claim, patient, provider, practice, payerName });

  const doc = createElement(ClaimSummaryDocument, { data });
  const blob = await pdf(doc).toBlob();

  const patientName = `${patient?.first_name || ""}${patient?.last_name || patient?.lead_name || "claim"}`.replace(/\s+/g, "_");
  const filename = `ClaimSummary_${patientName}_${claimId.slice(0, 8)}.pdf`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  await apiRequest("PATCH", `/api/billing/claims/${claimId}/pdf-generated`);
}
