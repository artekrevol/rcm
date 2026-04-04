import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9, fontFamily: "Helvetica", color: "#1a1a1a" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  headerLeft: { fontSize: 14, fontFamily: "Helvetica-Bold", color: "#0f172a" },
  headerRight: { textAlign: "right", fontSize: 8, color: "#64748b" },
  headerRightTitle: { fontSize: 16, fontFamily: "Helvetica-Bold", color: "#0f172a", marginBottom: 4 },
  dividerThick: { borderBottomWidth: 2, borderBottomColor: "#0f172a", marginBottom: 16 },
  dividerThin: { borderBottomWidth: 1, borderBottomColor: "#cbd5e1", marginVertical: 8 },
  sectionTitle: { fontSize: 10, fontFamily: "Helvetica-Bold", color: "#0f172a", marginBottom: 8, marginTop: 12, textTransform: "uppercase", letterSpacing: 1 },
  row: { flexDirection: "row", marginBottom: 3 },
  label: { width: 150, color: "#64748b", fontSize: 9 },
  value: { flex: 1, fontSize: 9, fontFamily: "Helvetica-Bold" },
  tableHeader: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#94a3b8", paddingBottom: 4, marginBottom: 4 },
  tableHeaderText: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#64748b", textTransform: "uppercase" },
  tableRow: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0" },
  tableCell: { fontSize: 9 },
  totalRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 8, paddingTop: 6, borderTopWidth: 1.5, borderTopColor: "#0f172a" },
  totalLabel: { fontSize: 10, fontFamily: "Helvetica-Bold", marginRight: 12 },
  totalValue: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40 },
  footerDivider: { borderBottomWidth: 2, borderBottomColor: "#0f172a", marginBottom: 8 },
  footerText: { fontSize: 7, color: "#94a3b8" },
  footerNote: { fontSize: 7, color: "#94a3b8", marginTop: 6, fontStyle: "italic" },
  diagRow: { flexDirection: "row", marginBottom: 2 },
  diagLabel: { width: 20, fontFamily: "Helvetica-Bold", fontSize: 9 },
  diagValue: { flex: 1, fontSize: 9 },
  footnote: { fontSize: 7, color: "#94a3b8", marginTop: 4, fontStyle: "italic" },
});

export interface ClaimPdfData {
  claimId: string;
  generatedAt: string;
  patient: {
    firstName: string;
    lastName: string;
    dob: string;
    sex: string;
    insuredName: string;
    relationshipToInsured: string;
    payerName: string;
    memberId: string;
    groupNumber: string;
    authorizationNumber: string;
  };
  provider: {
    practiceName: string;
    billingNpi: string;
    taxId: string;
    renderingName: string;
    renderingNpi: string;
    renderingCredentials: string;
    taxonomyCode: string;
    referringName: string;
    referringNpi: string;
  };
  service: {
    dateOfService: string;
    placeOfService: string;
    posCode: string;
  };
  serviceLines: Array<{
    code: string;
    modifier: string;
    description: string;
    units: number;
    rate: number;
    total: number;
  }>;
  claimTotal: number;
  diagnoses: Array<{ pointer: string; code: string; description: string }>;
  isLegacy: boolean;
}

const POS_MAP: Record<string, string> = {
  "12": "Home",
  "11": "Office",
  "13": "Assisted Living Facility",
  "02": "Telehealth",
  "21": "Hospital",
  "99": "Other",
};

function formatCurrency(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ClaimSummaryDocument({ data }: { data: ClaimPdfData }) {
  const d = data;
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.headerLeft}>[ClaimShield]</Text>
          <View style={styles.headerRight}>
            <Text style={styles.headerRightTitle}>CLAIM SUMMARY</Text>
            <Text>Generated: {d.generatedAt}</Text>
            <Text>Claim ID: {d.claimId.slice(0, 8)}</Text>
          </View>
        </View>
        <View style={styles.dividerThick} />

        <Text style={styles.sectionTitle}>Patient Information</Text>
        <InfoRow label="Patient Name" value={`${d.patient.firstName} ${d.patient.lastName}`.trim() || "N/A"} />
        <InfoRow label="Date of Birth" value={d.patient.dob || "N/A"} />
        <InfoRow label="Sex" value={d.patient.sex || "Not specified"} />
        <InfoRow label="Insured Name" value={d.patient.insuredName || `${d.patient.firstName} ${d.patient.lastName}`.trim() || "N/A"} />
        <InfoRow label="Relationship" value={d.patient.relationshipToInsured || "Self"} />
        <InfoRow label="Payer" value={d.patient.payerName || "N/A"} />
        <InfoRow label="Member ID" value={d.patient.memberId || "N/A"} />
        <InfoRow label="Group Number" value={d.patient.groupNumber || "N/A"} />
        <InfoRow label="Authorization #" value={d.patient.authorizationNumber || "N/A"} />

        <Text style={styles.sectionTitle}>Provider Information</Text>
        <InfoRow label="Billing Practice" value={d.provider.practiceName || "N/A"} />
        <InfoRow label="Billing NPI" value={d.provider.billingNpi || "N/A"} />
        <InfoRow label="Tax ID" value={d.provider.taxId || "N/A"} />
        <InfoRow label="Rendering Provider" value={d.provider.renderingName || "N/A"} />
        <InfoRow label="Rendering NPI" value={d.provider.renderingNpi || "N/A"} />
        <InfoRow label="Taxonomy Code" value={d.provider.taxonomyCode || "N/A"} />
        <InfoRow label="Referring Provider" value={d.provider.referringName || "N/A"} />
        <InfoRow label="Referring NPI" value={d.provider.referringNpi || "N/A"} />

        <Text style={styles.sectionTitle}>Service Information</Text>
        <InfoRow label="Date of Service" value={d.service.dateOfService || "N/A"} />
        <InfoRow label="Place of Service" value={d.service.placeOfService ? `${d.service.placeOfService} (${d.service.posCode})` : "N/A"} />

        <Text style={styles.sectionTitle}>Service Lines</Text>
        <View style={styles.dividerThin} />
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderText, { width: 60 }]}>Code</Text>
          <Text style={[styles.tableHeaderText, { width: 40 }]}>Mod</Text>
          <Text style={[styles.tableHeaderText, { flex: 1 }]}>Description</Text>
          <Text style={[styles.tableHeaderText, { width: 45, textAlign: "right" }]}>Units</Text>
          <Text style={[styles.tableHeaderText, { width: 65, textAlign: "right" }]}>Rate</Text>
          <Text style={[styles.tableHeaderText, { width: 70, textAlign: "right" }]}>Total</Text>
        </View>
        {d.serviceLines.map((line, i) => (
          <View key={i} style={styles.tableRow}>
            <Text style={[styles.tableCell, { width: 60 }]}>{line.code}</Text>
            <Text style={[styles.tableCell, { width: 40 }]}>{line.modifier || ""}</Text>
            <Text style={[styles.tableCell, { flex: 1 }]}>{line.description}</Text>
            <Text style={[styles.tableCell, { width: 45, textAlign: "right" }]}>{line.units}</Text>
            <Text style={[styles.tableCell, { width: 65, textAlign: "right" }]}>{formatCurrency(line.rate)}</Text>
            <Text style={[styles.tableCell, { width: 70, textAlign: "right" }]}>{formatCurrency(line.total)}</Text>
          </View>
        ))}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>CLAIM TOTAL:</Text>
          <Text style={styles.totalValue}>{formatCurrency(d.claimTotal)}</Text>
        </View>
        {d.isLegacy && (
          <Text style={styles.footnote}>* Claim created before line-item detail was available.</Text>
        )}

        <Text style={styles.sectionTitle}>Diagnosis Codes</Text>
        {d.diagnoses.map((dx, i) => (
          <View key={i} style={styles.diagRow}>
            <Text style={styles.diagLabel}>{dx.pointer}:</Text>
            <Text style={styles.diagValue}>{dx.code}{dx.description ? ` \u2014 ${dx.description}` : ""}</Text>
          </View>
        ))}
        {d.diagnoses.length === 0 && <Text style={{ color: "#94a3b8", fontSize: 9 }}>No diagnosis codes entered.</Text>}

        <View style={styles.footer}>
          <View style={styles.footerDivider} />
          <Text style={styles.footerText}>Submit this claim via your Availity portal.</Text>
          <Text style={styles.footerText}>Claim ID: {d.claimId.slice(0, 8)} | Generated: {d.generatedAt}</Text>
          <Text style={styles.footerNote}>
            NOTE: This is a claim summary for reference. Medicare-certified home health agencies billing under a facility NPI require a UB-04 form. Contact your billing consultant if unsure.
          </Text>
        </View>
      </Page>
    </Document>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}:</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export function buildClaimPdfData(opts: {
  claim: any;
  patient: any;
  provider: any;
  practice: any;
  payerName: string;
}): ClaimPdfData {
  const { claim, patient, provider, practice, payerName } = opts;
  const now = new Date();
  const generatedAt = now.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const posCode = claim.place_of_service || claim.placeOfService || "";
  const posDesc = POS_MAP[posCode] || posCode;

  const hasServiceLines = claim.service_lines && Array.isArray(claim.service_lines) && claim.service_lines.length > 0;
  const isLegacy = !hasServiceLines && claim.cpt_codes && Array.isArray(claim.cpt_codes) && claim.cpt_codes.length > 0;

  let serviceLines: ClaimPdfData["serviceLines"] = [];
  let claimTotal = 0;

  if (hasServiceLines) {
    serviceLines = claim.service_lines.map((l: any) => ({
      code: l.hcpcs_code || l.code || "",
      modifier: l.modifier || "",
      description: l.description || "",
      units: l.units || 1,
      rate: l.rate_per_unit || l.ratePerUnit || 0,
      total: l.total_charge || l.totalCharge || 0,
    }));
    claimTotal = serviceLines.reduce((s, l) => s + l.total, 0);
  } else if (isLegacy) {
    const codes = claim.cpt_codes as string[];
    const approxRate = (claim.amount || 0) / codes.length;
    serviceLines = codes.map((code: string) => ({
      code,
      modifier: "",
      description: "N/A *",
      units: 1,
      rate: approxRate,
      total: approxRate,
    }));
    claimTotal = claim.amount || 0;
  }

  const diagnoses: ClaimPdfData["diagnoses"] = [];
  const pointers = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
  if (claim.icd10_primary || claim.icd10Primary) {
    diagnoses.push({ pointer: "A", code: claim.icd10_primary || claim.icd10Primary, description: "" });
  }
  const secondary = claim.icd10_secondary || claim.icd10Secondary;
  if (secondary && Array.isArray(secondary)) {
    secondary.forEach((code: string, i: number) => {
      diagnoses.push({ pointer: pointers[i + 1] || String(i + 2), code, description: "" });
    });
  }

  const svcDate = claim.service_date || claim.serviceDate;
  let dateOfService = "N/A";
  if (svcDate) {
    try { dateOfService = new Date(svcDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }); } catch { dateOfService = String(svcDate); }
  }

  const provName = provider
    ? `${provider.first_name || ""} ${provider.last_name || ""}`.trim() + (provider.credentials ? `, ${provider.credentials}` : "")
    : "N/A";

  return {
    claimId: claim.id,
    generatedAt,
    patient: {
      firstName: patient?.first_name || patient?.firstName || "",
      lastName: patient?.last_name || patient?.lastName || patient?.lead_name || patient?.leadName || "Unknown",
      dob: patient?.dob || "N/A",
      sex: patient?.sex || "Not specified",
      insuredName: patient?.insured_name || patient?.insuredName || "",
      relationshipToInsured: patient?.relationship_to_insured || patient?.relationshipToInsured || "Self",
      payerName: payerName || claim.payer || "N/A",
      memberId: patient?.member_id || patient?.memberId || "N/A",
      groupNumber: patient?.group_number || patient?.groupNumber || "N/A",
      authorizationNumber: claim.authorization_number || claim.authorizationNumber || patient?.authorization_number || "N/A",
    },
    provider: {
      practiceName: practice?.practice_name || practice?.practiceName || "N/A",
      billingNpi: practice?.primary_npi || practice?.primaryNpi || "N/A",
      taxId: practice?.tax_id || practice?.taxId || "N/A",
      renderingName: provName,
      renderingNpi: provider?.npi || "N/A",
      renderingCredentials: provider?.credentials || "",
      taxonomyCode: provider?.taxonomy_code || provider?.taxonomyCode || practice?.taxonomy_code || "N/A",
      referringName: patient?.referring_provider_name || patient?.referringProviderName || "N/A",
      referringNpi: patient?.referring_provider_npi || patient?.referringProviderNpi || "N/A",
    },
    service: {
      dateOfService,
      placeOfService: posDesc,
      posCode,
    },
    serviceLines,
    claimTotal,
    diagnoses,
    isLegacy,
  };
}
