import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sparkles, Loader2, AlertCircle, AlertTriangle, CheckCircle2,
  ChevronDown, ChevronRight, User, Shield, Stethoscope, ClipboardList,
  UserCheck, FileText, Activity, Trash2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const LOADING_MESSAGES = [
  "Reading VA referral…",
  "Reading invoice…",
  "Matching to authorization…",
  "Checking PGBA rules…",
  "Running conflict detection…",
];

function useRotatingMessage(active: boolean): string {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % LOADING_MESSAGES.length), 3000);
    return () => clearInterval(t);
  }, [active]);
  return LOADING_MESSAGES[idx];
}

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === "error")
    return <Badge variant="destructive" className="text-xs">Error</Badge>;
  if (severity === "warning")
    return <Badge variant="outline" className="border-amber-500 text-amber-600 text-xs">Warning</Badge>;
  return <Badge variant="secondary" className="text-xs">Info</Badge>;
}

function ConfidenceIndicator({ confidence }: { confidence?: number }) {
  if (confidence === undefined) return null;
  const low = confidence < 0.85;
  return (
    <span
      className={`text-xs ml-1 ${low ? "text-amber-500" : "text-muted-foreground"}`}
      title={`Confidence: ${Math.round(confidence * 100)}%`}
    >
      {Math.round(confidence * 100)}%
    </span>
  );
}

function EditableField({
  label, value, fieldKey, confidence, onChange,
}: {
  label: string;
  value: string;
  fieldKey: string;
  confidence?: number;
  onChange: (key: string, val: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground flex items-center gap-1">
        {label}
        <ConfidenceIndicator confidence={confidence} />
      </Label>
      <Input
        data-testid={`input-field-${fieldKey}`}
        value={value ?? ""}
        onChange={(e) => onChange(fieldKey, e.target.value)}
        className={`h-8 text-sm ${confidence !== undefined && confidence < 0.85 ? "border-amber-400" : ""}`}
      />
    </div>
  );
}

function ConflictCard({
  conflict, resolved, onResolve,
}: {
  conflict: any;
  resolved: string | null;
  onResolve: (type: string, resolution: string) => void;
}) {
  return (
    <div
      data-testid={`conflict-${conflict.type}`}
      className={`rounded-lg border p-4 space-y-3 ${conflict.severity === "error"
        ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20"
        : "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20"}`}
    >
      <div className="flex items-start gap-2">
        <AlertCircle className={`h-4 w-4 mt-0.5 flex-shrink-0 ${conflict.severity === "error" ? "text-red-500" : "text-amber-500"}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <SeverityBadge severity={conflict.severity} />
            <span className="text-sm font-medium">{conflict.description}</span>
          </div>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap pl-6">
        {(conflict.resolution_options ?? []).map((opt: any) => (
          <Button
            key={opt.value}
            size="sm"
            variant={resolved === opt.value ? "default" : "outline"}
            data-testid={`button-resolve-${conflict.type}-${opt.value}`}
            onClick={() => onResolve(conflict.type, opt.value)}
            className="text-xs h-7"
          >
            {resolved === opt.value && <CheckCircle2 className="h-3 w-3 mr-1" />}
            {opt.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export default function SmartClaimPreviewPage() {
  const { draftId } = useParams<{ draftId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [edits, setEdits] = useState<Record<string, any>>({});
  const [resolvedConflicts, setResolvedConflicts] = useState<Record<string, string>>({});
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    patient: true, authorization: true, diagnosis: true, serviceLines: true,
    validation: true, conflicts: true, clinical: false, referring: false,
  });

  const rotatingMsg = useRotatingMessage(true);

  const { data: draft, isLoading } = useQuery({
    queryKey: ["/api/billing/smart-claims", draftId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/billing/smart-claims/${draftId}`);
      if (!res.ok) throw new Error("Failed to load draft");
      return res.json();
    },
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return 3000;
      return ["processing", "uploading"].includes(d.status) ? 3000 : false;
    },
    staleTime: 0,
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/billing/smart-claims/${draftId}/confirm`, {
        user_edits: { ...edits, resolved_conflicts: resolvedConflicts },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Confirmation failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Claim created", description: "Draft claim ready for review and submission." });
      navigate(`/billing/claims/${data.claimId}`);
    },
    onError: (err: any) => {
      toast({ title: "Cannot confirm", description: err.message, variant: "destructive" });
    },
  });

  const discardMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/billing/smart-claims/${draftId}`);
      if (!res.ok) throw new Error("Discard failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Draft discarded" });
      navigate("/billing/claims");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const saveEditsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/billing/smart-claims/${draftId}`, {
        user_edits: { ...edits, resolved_conflicts: resolvedConflicts },
      });
      if (!res.ok) throw new Error("Save failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/smart-claims", draftId] });
      toast({ title: "Changes saved" });
    },
  });

  const handleFieldEdit = (path: string, value: string) => {
    setEdits((prev) => ({ ...prev, [path]: value }));
  };

  const handleResolveConflict = (type: string, resolution: string) => {
    setResolvedConflicts((prev) => ({ ...prev, [type]: resolution }));
  };

  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const isProcessing = !draft || ["uploading", "processing"].includes(draft?.status);
  const isError = draft?.status === "error";
  const isReady = draft?.status === "ready";

  const extracted = draft?.extracted_data ?? {};
  const va = extracted.va ?? {};
  const qb = extracted.qb ?? {};
  const conflicts: any[] = draft?.conflicts ?? [];
  const valResult = draft?.validation_result ?? null;
  const confLog = draft?.confidence_log ?? {};

  const unresolvedErrorConflicts = conflicts.filter(
    (c) => c.severity === "error" && !resolvedConflicts[c.type]
  );
  const validationErrors = (valResult?.violations ?? []).filter(
    (v: any) => v.severity === "error"
  );
  const canConfirm =
    isReady &&
    unresolvedErrorConflicts.length === 0 &&
    validationErrors.length === 0 &&
    !confirmMutation.isPending;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isProcessing) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="flex flex-col items-center gap-6 py-16">
          <div className="relative">
            <div className="rounded-full bg-primary/10 p-6">
              <Sparkles className="h-10 w-10 text-primary" />
            </div>
            <div className="absolute -bottom-1 -right-1 rounded-full bg-background p-1">
              <Loader2 className="h-5 w-5 text-primary animate-spin" />
            </div>
          </div>
          <div className="text-center">
            <h2 className="text-lg font-semibold" data-testid="text-processing-status">
              {rotatingMsg}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Textract is reading your documents. This usually takes 15–25 seconds.
            </p>
          </div>
          <div className="w-full max-w-xs bg-muted rounded-full h-1.5 overflow-hidden">
            <div className="bg-primary h-full rounded-full animate-pulse" style={{ width: "60%" }} />
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Extraction failed</AlertTitle>
          <AlertDescription>
            {draft?.error_message ?? "An error occurred while processing your documents."}
          </AlertDescription>
        </Alert>
        <Button
          variant="outline"
          className="mt-4"
          data-testid="button-go-back"
          onClick={() => navigate("/billing/claims/smart-new")}
        >
          Try again
        </Button>
      </div>
    );
  }

  const SectionHeader = ({
    icon: Icon, title, sectionKey, badge,
  }: { icon: any; title: string; sectionKey: string; badge?: React.ReactNode }) => (
    <CollapsibleTrigger
      className="w-full flex items-center justify-between py-3 px-4 hover:bg-muted/50 rounded-lg transition-colors"
      onClick={() => toggleSection(sectionKey)}
      data-testid={`section-toggle-${sectionKey}`}
    >
      <div className="flex items-center gap-2 font-medium text-sm">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {title}
        {badge}
      </div>
      {openSections[sectionKey] ? (
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      ) : (
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      )}
    </CollapsibleTrigger>
  );

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold" data-testid="text-preview-title">Review Smart Claim</h1>
            <p className="text-xs text-muted-foreground">Review and edit before confirming.</p>
          </div>
        </div>
        <Badge
          variant={isReady ? "default" : "secondary"}
          className="text-xs"
          data-testid="badge-draft-status"
        >
          {draft?.status ?? "unknown"}
        </Badge>
      </div>

      {/* Section 7: Validation Results */}
      {valResult?.violations?.length > 0 && (
        <Collapsible open={openSections.validation}>
          <Card className="border-amber-200 dark:border-amber-800">
            <CardHeader className="pb-0">
              <SectionHeader icon={Activity} title="Validation Results" sectionKey="validation"
                badge={
                  <Badge variant={validationErrors.length > 0 ? "destructive" : "secondary"} className="ml-1 text-xs">
                    {validationErrors.length > 0 ? `${validationErrors.length} error(s)` : "Warnings only"}
                  </Badge>
                }
              />
            </CardHeader>
            <CollapsibleContent>
              <CardContent className="pt-2 space-y-2">
                {(valResult.violations ?? []).sort((a: any, b: any) =>
                  a.severity === "error" ? -1 : 1
                ).map((v: any, i: number) => (
                  <div key={i} data-testid={`violation-${v.code ?? i}`}
                    className={`flex gap-3 text-sm p-3 rounded-lg ${v.severity === "error"
                      ? "bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800"
                      : "bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800"}`}
                  >
                    <AlertTriangle className={`h-4 w-4 flex-shrink-0 mt-0.5 ${v.severity === "error" ? "text-red-500" : "text-amber-500"}`} />
                    <div>
                      <span className="font-medium">{v.code}</span>
                      {" — "}
                      {v.message}
                      {v.suggestedFix && (
                        <p className="text-xs text-muted-foreground mt-0.5">Suggested: {v.suggestedFix}</p>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* Section 8: Conflicts */}
      {conflicts.length > 0 && (
        <Collapsible open={openSections.conflicts}>
          <Card className="border-red-200 dark:border-red-800">
            <CardHeader className="pb-0">
              <SectionHeader icon={AlertCircle} title="Conflicts" sectionKey="conflicts"
                badge={
                  <Badge variant={unresolvedErrorConflicts.length > 0 ? "destructive" : "secondary"} className="ml-1 text-xs">
                    {unresolvedErrorConflicts.length > 0
                      ? `${unresolvedErrorConflicts.length} unresolved`
                      : "All resolved"}
                  </Badge>
                }
              />
            </CardHeader>
            <CollapsibleContent>
              <CardContent className="pt-2 space-y-3">
                {conflicts.map((c, i) => (
                  <ConflictCard
                    key={i}
                    conflict={c}
                    resolved={resolvedConflicts[c.type] ?? null}
                    onResolve={handleResolveConflict}
                  />
                ))}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* Section 1: Patient */}
      <Collapsible open={openSections.patient}>
        <Card>
          <CardHeader className="pb-0">
            <SectionHeader icon={User} title="Patient" sectionKey="patient"
              badge={
                <Badge variant="outline" className="ml-1 text-xs">
                  {extracted.patient_match_status === "existing-match" ? "Existing patient" : "New patient"}
                </Badge>
              }
            />
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="pt-2 grid grid-cols-2 gap-3">
              <EditableField label="First Name" value={edits.first_name ?? va.patient?.first_name ?? ""}
                fieldKey="first_name" confidence={confLog.va?.patient} onChange={handleFieldEdit} />
              <EditableField label="Last Name" value={edits.last_name ?? va.patient?.last_name ?? ""}
                fieldKey="last_name" confidence={confLog.va?.patient} onChange={handleFieldEdit} />
              <EditableField label="Middle Name" value={edits.middle_name ?? va.patient?.middle_name ?? ""}
                fieldKey="middle_name" onChange={handleFieldEdit} />
              <EditableField label="Date of Birth" value={edits.dob ?? va.patient?.dob ?? ""}
                fieldKey="dob" confidence={confLog.va?.dob} onChange={handleFieldEdit} />
              <EditableField label="EDIPI" value={edits.edipi ?? va.patient?.edipi ?? ""}
                fieldKey="edipi" confidence={confLog.va?.edipi} onChange={handleFieldEdit} />
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Gender</Label>
                <p className="text-sm h-8 flex items-center" data-testid="text-patient-gender">
                  {va.patient?.gender === "M" ? "Male" : "Female"}
                </p>
              </div>
              <div className="col-span-2">
                <EditableField label="Address" value={edits.address_line1 ?? va.patient?.address?.line1 ?? ""}
                  fieldKey="address_line1" confidence={confLog.va?.address} onChange={handleFieldEdit} />
              </div>
              <EditableField label="City" value={edits.city ?? va.patient?.address?.city ?? ""}
                fieldKey="city" onChange={handleFieldEdit} />
              <div className="grid grid-cols-2 gap-2">
                <EditableField label="State" value={edits.state ?? va.patient?.address?.state ?? ""}
                  fieldKey="state" onChange={handleFieldEdit} />
                <EditableField label="ZIP" value={edits.zip ?? va.patient?.address?.zip ?? ""}
                  fieldKey="zip" onChange={handleFieldEdit} />
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Section 2: Authorization */}
      <Collapsible open={openSections.authorization}>
        <Card>
          <CardHeader className="pb-0">
            <SectionHeader icon={Shield} title="Authorization" sectionKey="authorization" />
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="pt-2 grid grid-cols-2 gap-3">
              <EditableField label="Auth Number" value={edits.auth_number ?? va.authorization?.auth_number ?? ""}
                fieldKey="auth_number" confidence={confLog.va?.authorization} onChange={handleFieldEdit} />
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Priority</Label>
                <p className="text-sm h-8 flex items-center" data-testid="text-auth-priority">
                  {va.authorization?.priority ?? "—"}
                </p>
              </div>
              <EditableField label="Issue Date" value={edits.issue_date ?? va.authorization?.issue_date ?? ""}
                fieldKey="issue_date" onChange={handleFieldEdit} />
              <EditableField label="Expiration Date" value={edits.expiration_date ?? va.authorization?.expiration_date ?? ""}
                fieldKey="expiration_date" onChange={handleFieldEdit} />
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">SEOC Code</Label>
                <p className="text-sm h-8 flex items-center font-mono" data-testid="text-seoc-code">
                  {va.authorization?.seoc_code ?? "—"}
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Suggested HCPCS</Label>
                <p className="text-sm h-8 flex items-center font-mono" data-testid="text-hcpcs">
                  {va.suggested_hcpcs ?? "—"}
                </p>
              </div>
              {(va.authorization?.authorized_services ?? []).length > 0 && (
                <div className="col-span-2">
                  <Label className="text-xs text-muted-foreground mb-2 block">Authorized Services</Label>
                  <div className="space-y-1.5">
                    {va.authorization.authorized_services.map((svc: any, i: number) => (
                      <div key={i} data-testid={`authorized-service-${i}`}
                        className="text-sm flex items-center gap-2 py-1.5 px-3 bg-muted rounded-md">
                        {svc.is_primary && <Badge variant="outline" className="text-xs">Primary</Badge>}
                        <span className="flex-1 truncate">{svc.description}</span>
                        <Badge variant="secondary" className="text-xs flex-shrink-0">{svc.billing_unit_type}</Badge>
                        <span className="text-xs text-muted-foreground flex-shrink-0">{svc.max_units_per_period_text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Section 3: Diagnosis */}
      <Collapsible open={openSections.diagnosis}>
        <Card>
          <CardHeader className="pb-0">
            <SectionHeader icon={Stethoscope} title="Diagnosis" sectionKey="diagnosis" />
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="pt-2 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <EditableField label="Primary ICD-10" value={edits.primary_icd10_code ?? va.diagnosis?.primary_icd10_code ?? ""}
                  fieldKey="primary_icd10_code" confidence={confLog.va?.diagnosis} onChange={handleFieldEdit} />
                <div className="col-span-2">
                  <EditableField label="Description" value={edits.primary_description ?? va.diagnosis?.primary_description ?? ""}
                    fieldKey="primary_description" onChange={handleFieldEdit} />
                </div>
              </div>
              {(va.diagnosis?.co_morbidities ?? []).length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">
                    Co-morbidities (informational only — not on EDI)
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {va.diagnosis.co_morbidities.map((c: string, i: number) => (
                      <Badge key={i} variant="secondary" className="text-xs" data-testid={`comorbidity-${i}`}>
                        {c}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Section 6: Service Lines */}
      <Collapsible open={openSections.serviceLines}>
        <Card>
          <CardHeader className="pb-0">
            <SectionHeader icon={FileText} title={`Service Lines (${qb.line_items?.length ?? 0})`} sectionKey="serviceLines" />
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="pt-2">
              {(qb.line_items ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No service lines extracted from invoice.</p>
              ) : (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-5 text-xs text-muted-foreground px-2 pb-1">
                    <span>Date</span>
                    <span className="col-span-2">Description</span>
                    <span className="text-right">Hours × Rate</span>
                    <span className="text-right">Total</span>
                  </div>
                  {[...qb.line_items].sort((a: any, b: any) =>
                    a.service_date > b.service_date ? 1 : -1
                  ).map((li: any, i: number) => (
                    <div key={i} data-testid={`service-line-${i}`}
                      className="grid grid-cols-5 text-sm py-2 px-2 rounded-md hover:bg-muted/50 items-center">
                      <span className="text-xs text-muted-foreground">{li.service_date}</span>
                      <span className="col-span-2 truncate text-xs">{li.description}</span>
                      <span className="text-right text-xs text-muted-foreground">
                        {li.hours}h × ${li.rate}
                      </span>
                      <span className="text-right font-medium text-xs">
                        ${li.total?.toFixed(2)}
                      </span>
                    </div>
                  ))}
                  <div className="border-t pt-2 flex justify-between text-sm font-semibold px-2 mt-1">
                    <span>Total</span>
                    <span data-testid="text-services-total">
                      ${qb.services_rendered_total?.toFixed(2) ?? "0.00"}
                    </span>
                  </div>
                  {qb.caregiver_tips && (
                    <div className="flex justify-between text-sm px-2 text-muted-foreground">
                      <span>Caregiver Tips</span>
                      <span>${qb.caregiver_tips?.toFixed(2)}</span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Section 4: Clinical Context (collapsed) */}
      <Collapsible open={openSections.clinical}>
        <Card>
          <CardHeader className="pb-0">
            <SectionHeader icon={ClipboardList} title="Clinical Context" sectionKey="clinical" />
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="pt-2 space-y-3 text-sm">
              {va.clinical_context?.allergies?.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Allergies</Label>
                  <div className="flex flex-wrap gap-1">
                    {va.clinical_context.allergies.map((a: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-xs">{a}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {va.clinical_context?.active_medications?.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Active Medications</Label>
                  <div className="flex flex-wrap gap-1">
                    {va.clinical_context.active_medications.map((m: string, i: number) => (
                      <Badge key={i} variant="outline" className="text-xs">{m}</Badge>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                {va.clinical_context?.is_diabetic && <Badge variant="secondary" className="text-xs">Diabetic</Badge>}
                {va.clinical_context?.is_pregnant && <Badge variant="secondary" className="text-xs">Pregnant</Badge>}
                {va.clinical_context?.has_mva_or_work_injury && <Badge variant="secondary" className="text-xs">MVA / Work Injury</Badge>}
                {va.clinical_context?.care_coordination_required && <Badge variant="secondary" className="text-xs">Care Coordination Required</Badge>}
              </div>
              {va.clinical_context?.recommended_treatment && (
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Recommended Treatment</Label>
                  <p className="text-sm text-muted-foreground">{va.clinical_context.recommended_treatment}</p>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Section 5: Referring Provider (collapsed) */}
      {va.referring_provider && (
        <Collapsible open={openSections.referring}>
          <Card>
            <CardHeader className="pb-0">
              <SectionHeader icon={UserCheck} title="Referring Provider" sectionKey="referring"
                badge={
                  <Badge variant="outline" className="ml-1 text-xs text-muted-foreground">
                    Informational only — not on EDI for VA CCN
                  </Badge>
                }
              />
            </CardHeader>
            <CollapsibleContent>
              <CardContent className="pt-2 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <Label className="text-xs text-muted-foreground">First Name</Label>
                  <p data-testid="text-ref-prov-first">{va.referring_provider.first_name}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Last Name</Label>
                  <p data-testid="text-ref-prov-last">{va.referring_provider.last_name}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Raw NPI (station-prefixed)</Label>
                  <p className="font-mono text-xs" data-testid="text-ref-prov-npi">
                    {va.referring_provider.raw_npi || "—"}
                  </p>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* Section 9: Action Buttons */}
      <div className="flex items-center justify-between gap-3 pt-2 border-t">
        <Button
          variant="ghost"
          size="sm"
          data-testid="button-discard-draft"
          disabled={discardMutation.isPending || confirmMutation.isPending}
          onClick={() => discardMutation.mutate()}
          className="text-destructive hover:text-destructive gap-1.5"
        >
          {discardMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          Discard
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            data-testid="button-save-later"
            disabled={saveEditsMutation.isPending || confirmMutation.isPending}
            onClick={() => saveEditsMutation.mutate()}
          >
            {saveEditsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Save & Continue Later
          </Button>
          <Button
            size="sm"
            data-testid="button-confirm-claim"
            disabled={!canConfirm}
            onClick={() => confirmMutation.mutate()}
            className="gap-1.5"
          >
            {confirmMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Create Claim →
          </Button>
        </div>
      </div>

      {!canConfirm && isReady && (
        <p className="text-xs text-muted-foreground text-center" data-testid="text-confirm-blocked-reason">
          {unresolvedErrorConflicts.length > 0
            ? `Resolve ${unresolvedErrorConflicts.length} conflict(s) above before confirming.`
            : validationErrors.length > 0
            ? "Fix validation errors before confirming."
            : ""}
        </p>
      )}
    </div>
  );
}
