import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { StatusBadge, ClaimStatusBadge } from "@/components/status-badge";
import { RiskScoreCircle } from "@/components/risk-score";
import { ClaimTimeline } from "@/components/claim-timeline";
import { ExplainabilityDrawer } from "@/components/explainability-drawer";
import { PriorAuthSection } from "@/components/prior-auth-section";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  HelpCircle,
  Building2,
  FileText,
  Calendar,
  DollarSign,
  Send,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  Loader2,
  Download,
  ChevronDown,
  XCircle,
  Info,
  Zap,
  RefreshCw,
  FlaskConical,
  ChevronRight,
  Pencil,
  CheckCircle,
  AlarmClock,
  BellOff,
  Archive,
  Trash2,
} from "lucide-react";
import { format, differenceInDays, formatDistanceToNow } from "date-fns";
import type { Claim, ClaimEvent, RiskExplanation, Patient } from "@shared/schema";
import { generateAndDownloadClaimPdf } from "@/lib/generate-claim-pdf";

interface EdiValidation {
  ready: boolean;
  summary: string;
  warnings: { field: string; message: string; severity: "error" | "warning" }[];
}

const CARC_MAP: Record<string, { rootCause: string; action: string; fixField?: string }> = {
  "CO-96": { rootCause: "Non-covered service or not medically necessary per payer policy", action: "Obtain and attach medical necessity documentation, then resubmit with appeal letter", fixField: "homebound_indicator" },
  "CO-97": { rootCause: "Bundled service — this procedure is included in another code already billed", action: "Review CCI edits, remove duplicate code or add modifier -59 to unbundle", fixField: "service_lines" },
  "CO-4":  { rootCause: "Procedure code invalid, inconsistent, or modifier missing", action: "Review modifier requirements for this CPT code and resubmit with correct modifiers", fixField: "service_lines" },
  "CO-18": { rootCause: "Duplicate claim submitted", action: "Verify no prior submission exists; if unique service, add frequency modifier and resubmit" },
  "CO-22": { rootCause: "Patient covered by another payer as primary", action: "Submit to the primary payer first, then submit Coordination of Benefits (COB) to this payer" },
  "CO-29": { rootCause: "Timely filing limit exceeded", action: "File an appeal with proof of original timely submission (e.g., clearinghouse acknowledgment)" },
  "CO-45": { rootCause: "Charges exceed contractual allowed amount", action: "This is a contractual adjustment — post as adjustment, no appeal needed" },
  "PR-1":  { rootCause: "Patient deductible not yet met", action: "Bill patient for deductible amount; no resubmission needed" },
  "PR-2":  { rootCause: "Coinsurance applied", action: "Bill patient for coinsurance amount; no resubmission needed" },
  "PR-3":  { rootCause: "Copay collected at time of service", action: "Collect copay from patient if not yet collected; no resubmission needed" },
  "OA-23": { rootCause: "Payment adjusted based on prior payment or payment decision", action: "Review prior claim payments and apply credit balance if applicable" },
  "N30":   { rootCause: "Missing or invalid ordering provider information", action: "Add ordering provider name and NPI in Box 17/17b and resubmit", fixField: "ordering_provider_id" },
  "N286":  { rootCause: "Referring/ordering provider NPI is missing or invalid", action: "Verify provider NPI with NPPES registry and resubmit", fixField: "ordering_provider_id" },
  "B15":   { rootCause: "Payment adjusted for no prior authorization", action: "Obtain retroactive authorization from payer or file appeal with authorization proof" },
};

function TimelyFilingWidget({ claim }: { claim: any }) {
  const { toast } = useToast();
  const tfStatus: string | null = claim.timely_filing_status ?? null;
  const daysRemaining: number | null = claim.timely_filing_days_remaining ?? null;
  const deadlineDate: string | null = claim.timely_filing_deadline ?? null;
  const lastEvaluated: string | null = claim.timely_filing_last_evaluated_at ?? null;

  const reEvalMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/billing/claims/${claim.id}/timely-filing-evaluate`, {}),
    onSuccess: () => {
      toast({ title: "Evaluation triggered", description: "Timely filing status will refresh shortly." });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/claims", claim.id] });
    },
    onError: () => toast({ title: "Re-evaluation failed", variant: "destructive" }),
  });

  const snoozeMutation = useMutation({
    mutationFn: async () => {
      const alertsRes = await fetch(`/api/billing/filing-alerts?claim_id=${claim.id}`, { credentials: "include" });
      if (!alertsRes.ok) throw new Error("No alerts found");
      const data = await alertsRes.json();
      const alert = data.alerts?.[0];
      if (!alert) throw new Error("No active alert for this claim");
      return apiRequest("POST", `/api/billing/filing-alerts/${alert.id}/snooze`, { days: 7 });
    },
    onSuccess: () => toast({ title: "Alert snoozed for 7 days" }),
    onError: () => toast({ title: "Snooze failed — no active alert found", variant: "destructive" }),
  });

  if (!tfStatus || tfStatus === "safe") {
    if (!tfStatus) return null;
    return (
      <Card className="border-green-200 dark:border-green-800 bg-green-50/30 dark:bg-green-950/10" data-testid="card-timely-filing-safe">
        <CardHeader className="pb-1">
          <CardTitle className="text-sm font-medium text-green-700 dark:text-green-400 flex items-center gap-2">
            <AlarmClock className="h-4 w-4" />
            Timely Filing
            <Badge className="ml-auto bg-green-600 text-white text-[10px]">SAFE</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-3">
          <p className="text-xs text-muted-foreground">
            {daysRemaining != null ? `${daysRemaining} days remaining` : "Deadline on track"}
            {deadlineDate && ` · Deadline ${format(new Date(deadlineDate), "MMM d, yyyy")}`}
          </p>
        </CardContent>
      </Card>
    );
  }

  const statusConfig: Record<string, { label: string; color: string; borderClass: string; bgClass: string; textClass: string }> = {
    caution: {
      label: "CAUTION",
      color: "bg-blue-600",
      borderClass: "border-blue-200 dark:border-blue-800",
      bgClass: "bg-blue-50/30 dark:bg-blue-950/10",
      textClass: "text-blue-700 dark:text-blue-400",
    },
    urgent: {
      label: "URGENT",
      color: "bg-amber-500",
      borderClass: "border-amber-200 dark:border-amber-700",
      bgClass: "bg-amber-50/40 dark:bg-amber-950/10",
      textClass: "text-amber-700 dark:text-amber-400",
    },
    critical: {
      label: "CRITICAL",
      color: "bg-red-600",
      borderClass: "border-red-300 dark:border-red-800",
      bgClass: "bg-red-50/50 dark:bg-red-950/20",
      textClass: "text-red-700 dark:text-red-400",
    },
    expired: {
      label: "EXPIRED",
      color: "bg-gray-700",
      borderClass: "border-gray-400 dark:border-gray-600",
      bgClass: "bg-gray-50/50 dark:bg-gray-900/20",
      textClass: "text-gray-700 dark:text-gray-300",
    },
  };

  const cfg = statusConfig[tfStatus] ?? statusConfig.caution;

  return (
    <Card className={`${cfg.borderClass} ${cfg.bgClass}`} data-testid="card-timely-filing">
      <CardHeader className="pb-1">
        <CardTitle className={`text-sm font-medium ${cfg.textClass} flex items-center gap-2`}>
          <AlarmClock className="h-4 w-4" />
          Timely Filing
          <Badge className={`ml-auto ${cfg.color} text-white text-[10px]`} data-testid="badge-tf-status">
            {cfg.label}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-3 space-y-3">
        <div className="space-y-1.5">
          {daysRemaining != null && (
            <p className={`text-xl font-bold ${cfg.textClass}`} data-testid="text-tf-days">
              {tfStatus === "expired"
                ? `${Math.abs(daysRemaining)} days overdue`
                : `${daysRemaining} days remaining`}
            </p>
          )}
          {deadlineDate && (
            <p className="text-xs text-muted-foreground" data-testid="text-tf-deadline">
              Payer deadline: {format(new Date(deadlineDate), "MMMM d, yyyy")}
            </p>
          )}
          {lastEvaluated && (
            <p className="text-xs text-muted-foreground">
              Evaluated {formatDistanceToNow(new Date(lastEvaluated), { addSuffix: true })}
            </p>
          )}
        </div>

        {tfStatus === "expired" && (
          <div className="rounded-md bg-gray-800 text-gray-100 text-xs p-2 leading-relaxed">
            This claim has passed its timely filing window. Options: write-off or appeal with late-filing cause documentation.
          </div>
        )}

        {tfStatus === "critical" && (
          <div className="rounded-md bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-200 text-xs p-2">
            Immediate action required — submit or appeal before the deadline passes.
          </div>
        )}

        <div className="flex gap-2 flex-wrap pt-1">
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7 px-2"
            onClick={() => reEvalMutation.mutate()}
            disabled={reEvalMutation.isPending}
            data-testid="button-tf-reeval"
          >
            {reEvalMutation.isPending
              ? <Loader2 className="h-3 w-3 animate-spin mr-1" />
              : <RefreshCw className="h-3 w-3 mr-1" />}
            Re-evaluate
          </Button>
          {tfStatus !== "expired" && (
            <Button
              size="sm"
              variant="ghost"
              className="text-xs h-7 px-2"
              onClick={() => snoozeMutation.mutate()}
              disabled={snoozeMutation.isPending}
              data-testid="button-tf-snooze"
            >
              <BellOff className="h-3 w-3 mr-1" />
              Snooze 7d
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function getDenialInfo(reasonCode: string) {
  const normalized = reasonCode?.trim().toUpperCase();
  for (const [key, val] of Object.entries(CARC_MAP)) {
    if (normalized === key || normalized.includes(key.replace("-", ""))) return val;
  }
  return { rootCause: "Payer-specific denial reason", action: "Contact payer for clarification and review EOB for additional remark codes" };
}

function DenialRecoveryPanel({ claimId, claimStatus, onNavigate }: { claimId: string; claimStatus: string; onNavigate: (path: string) => void }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/billing/claims", claimId, "denial-recovery"],
    queryFn: () => fetch(`/api/billing/claims/${claimId}/denial-recovery`, { credentials: "include" }).then(r => r.json()),
  });

  const resubmitMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/billing/claims/${claimId}/oa-submit`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/claims", claimId] });
    },
  });

  if (isLoading) return null;

  const denials: any[] = data?.denials || [];
  const eraLines: any[] = data?.eraLines || [];

  // Gather all reason codes
  const codes: string[] = [];
  denials.forEach((d: any) => { if (d.denial_reason_text) codes.push(d.denial_reason_text); });
  eraLines.forEach((e: any) => { if (e.adjustment_reason) codes.push(e.adjustment_reason); });

  const primaryCode = codes[0] || "Unknown";
  const info = getDenialInfo(primaryCode);

  return (
    <Card className="border-orange-200 dark:border-orange-800 bg-orange-50/40 dark:bg-orange-950/10" data-testid="card-denial-recovery">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium text-orange-800 dark:text-orange-200 flex items-center gap-2">
          <Info className="h-4 w-4" />
          Denial Recovery Agent
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Denial Code</p>
            <p className="text-sm font-mono font-semibold mt-0.5" data-testid="text-recovery-code">{primaryCode}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Root Cause</p>
            <p className="text-sm mt-0.5 text-foreground" data-testid="text-recovery-root-cause">{info.rootCause}</p>
          </div>
          <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-xs text-blue-700 dark:text-blue-300 font-medium">Recommended Action</p>
            <p className="text-sm text-blue-800 dark:text-blue-200 mt-0.5" data-testid="text-recovery-action">{info.action}</p>
          </div>
        </div>

        {eraLines.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">ERA Payment History</p>
            {eraLines.slice(0, 3).map((line: any, i: number) => (
              <div key={i} className="text-xs flex items-center justify-between py-1 border-b last:border-0">
                <span className="text-muted-foreground">{line.check_number}</span>
                <span className="font-mono">${parseFloat(line.paid_amount || 0).toFixed(2)} paid / ${parseFloat(line.billed_amount || 0).toFixed(2)} billed</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          {info.fixField && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onNavigate(`/billing/claims/new?claimId=${claimId}`)}
              data-testid="button-fix-claim"
              className="flex-1"
            >
              <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
              Fix This Claim
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => resubmitMutation.mutate()}
            disabled={resubmitMutation.isPending}
            data-testid="button-validate-resubmit"
            className="flex-1"
          >
            {resubmitMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
            Validate &amp; Resubmit
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ClaimDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [explainOpen, setExplainOpen] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [cms1500Loading, setCms1500Loading] = useState(false);
  const [cms1500Done, setCms1500Done] = useState(false);
  const [submittingOA, setSubmittingOA] = useState(false);
  const [ediValidating, setEdiValidating] = useState(false);
  const [ediValidation, setEdiValidation] = useState<EdiValidation | null>(null);
  const [ediDownloading, setEdiDownloading] = useState(false);
  const [timelinessPdfLoading, setTimelinessPdfLoading] = useState(false);
  const [appealPdfLoading, setAppealPdfLoading] = useState(false);
  const [checking277, setChecking277] = useState(false);
  const [check277Result, setCheck277Result] = useState<{ found: boolean; status?: string; message?: string } | null>(null);
  const [validationErrorsExpanded, setValidationErrorsExpanded] = useState(false);
  const [testingClaim, setTestingClaim] = useState(false);
  const [showArchiveClaimDialog, setShowArchiveClaimDialog] = useState(false);

  const { data: practiceSettings } = useQuery<any>({
    queryKey: ["/api/billing/practice-settings"],
  });
  const { data: stediStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/billing/stedi/status"],
    queryFn: async () => {
      const res = await fetch("/api/billing/stedi/status");
      if (!res.ok) return { configured: false };
      return res.json();
    },
  });
  const stediConfigured = stediStatus?.configured ?? false;

  const { data: claim, isLoading: claimLoading } = useQuery<Claim>({
    queryKey: ["/api/claims", id],
  });

  const { data: events } = useQuery<ClaimEvent[]>({
    queryKey: ["/api/claims", id, "events"],
  });

  const { data: explanation } = useQuery<RiskExplanation>({
    queryKey: ["/api/claims", id, "explanation"],
  });

  const { data: patient } = useQuery<Patient | null>({
    queryKey: ["/api/claims", id, "patient"],
  });

  const submitClaimMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/billing/claims/${id}/submit-stedi`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testMode: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
      return data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/claims", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/claims", id, "events"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/claims"] });
      if (data.success) {
        toast({
          title: "Claim submitted to Stedi",
          description: data.transactionId
            ? `Transaction ID: ${data.transactionId}`
            : "Claim submitted successfully",
        });
      } else {
        const errDetail = (data.validationErrors || []).map((e: any) => e.message || e).join("; ");
        toast({
          title: "Stedi rejected the claim",
          description: data.error || errDetail || "Submission failed",
          variant: "destructive",
        });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Submission failed", description: err.message, variant: "destructive" });
    },
  });

  const markReadyMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PATCH", `/api/billing/claims/${id}`, { status: "created" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/claims", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/claim-tracker"] });
      toast({ title: "Claim marked as ready", description: "You can now review and submit this claim." });
    },
    onError: () => {
      toast({ title: "Failed to update claim status", variant: "destructive" });
    },
  });

  const archiveClaimMutation = useMutation({
    mutationFn: async () => apiRequest("PATCH", `/api/billing/claims/${id}/archive`, {}),
    onSuccess: () => {
      setShowArchiveClaimDialog(false);
      queryClient.invalidateQueries({ queryKey: ["/api/claims", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/claim-tracker"] });
      setLocation("/billing/claims");
      toast({ title: claim?.status === "draft" ? "Draft discarded" : "Claim archived", description: claim?.status === "draft" ? "The draft has been removed." : "The claim has been hidden from your dashboard but retained per HIPAA requirements." });
    },
    onError: () => toast({ title: "Error", description: "Failed to archive claim", variant: "destructive" }),
  });

  if (claimLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (!claim) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Claim not found</p>
      </div>
    );
  }

  const lastEvent = events?.[events.length - 1];
  const isStuck =
    lastEvent?.type === "Pending" &&
    differenceInDays(new Date(), new Date(lastEvent.timestamp)) > 7;
  const stuckDays = lastEvent
    ? differenceInDays(new Date(), new Date(lastEvent.timestamp))
    : 0;

  const isBlocked = claim.readinessStatus === "RED";
  const canSubmit = stediConfigured && claim.readinessStatus === "GREEN" && ["created", "ready"].includes(claim.status);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLocation("/claims")}
          data-testid="button-back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold font-mono">
              {claim.id.slice(0, 8)}
            </h1>
            <StatusBadge status={claim.readinessStatus as "GREEN" | "YELLOW" | "RED"} size="md" />
            <ClaimStatusBadge status={claim.status} />
            {isStuck && (
              <Badge variant="outline" className="gap-1 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0 animate-pulse">
                <AlertTriangle className="h-3 w-3" />
                Stuck {stuckDays} days
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground mt-1">
            Created {format(new Date(claim.createdAt), "MMMM d, yyyy")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="gap-2"
                disabled={pdfGenerating || cms1500Loading}
                data-testid="button-download-pdf"
              >
                {(pdfGenerating || cms1500Loading) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {(pdfGenerating || cms1500Loading) ? "Generating..." : "Download PDF"}
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                data-testid="menu-cms1500"
                onClick={async () => {
                  if (!id) return;
                  setCms1500Loading(true);
                  try {
                    const { buildCMS1500DataFromClaim, generateCMS1500PDF } = await import('@/lib/generate-cms1500');
                    const formData = await buildCMS1500DataFromClaim(id);
                    const pdfBytes = await generateCMS1500PDF(formData);
                    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `CMS1500-${formData.patientLastName || 'claim'}-${formData.serviceDate || 'date'}.pdf`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    await fetch(`/api/billing/claims/${id}/pdf-generated`, { method: 'PATCH', credentials: 'include' });
                    queryClient.invalidateQueries({ queryKey: ["/api/claims", id] });
                    setCms1500Done(true);
                    toast({ title: "CMS-1500 downloaded", description: "Upload this form to your Availity portal to submit the claim." });
                  } catch (err: any) {
                    toast({ title: "PDF generation failed", description: err.message, variant: "destructive" });
                  } finally {
                    setCms1500Loading(false);
                  }
                }}
              >
                {cms1500Done ? "Re-download CMS-1500 form" : "CMS-1500 form"} — for Availity upload
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="menu-summary-pdf"
                onClick={async () => {
                  if (!id) return;
                  setPdfGenerating(true);
                  try {
                    await generateAndDownloadClaimPdf(id);
                    queryClient.invalidateQueries({ queryKey: ["/api/claims", id] });
                    toast({ title: "Claim summary downloaded." });
                  } catch (err: any) {
                    toast({ title: "PDF generation failed", description: err.message, variant: "destructive" });
                  } finally {
                    setPdfGenerating(false);
                  }
                }}
              >
                Claim summary — readable format
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="menu-edi-837p"
                disabled={ediValidating}
                onClick={async () => {
                  if (!id) return;
                  setEdiValidating(true);
                  try {
                    const res = await fetch(`/api/billing/claims/${id}/edi-validate`, { credentials: "include" });
                    const data = await res.json();
                    setEdiValidation({
                      ready: data.ready ?? false,
                      summary: data.summary || data.error || "Validation check failed",
                      warnings: Array.isArray(data.warnings) ? data.warnings : [],
                    });
                  } catch {
                    setEdiValidation({ ready: false, summary: "Validation check failed", warnings: [] });
                  } finally {
                    setEdiValidating(false);
                  }
                }}
              >
                {ediValidating ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Checking…</> : "Download 837P EDI — for electronic submission"}
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="menu-timely-filing"
                disabled={timelinessPdfLoading}
                onClick={async () => {
                  if (!id) return;
                  setTimelinessPdfLoading(true);
                  try {
                    const res = await fetch(`/api/billing/claims/${id}/letter-data`, { credentials: "include" });
                    if (!res.ok) throw new Error("Failed to fetch letter data");
                    const letterData = await res.json();
                    const { generateTimelinessPDF } = await import('@/lib/generate-letters');
                    const pdfBytes = await generateTimelinessPDF(letterData);
                    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `ProofOfTimelyFiling-${letterData.patient?.full_name?.replace(/\s+/g, '_') || 'claim'}.pdf`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    toast({ title: "Proof of timely filing downloaded." });
                  } catch (err: any) {
                    toast({ title: "PDF generation failed", description: err.message, variant: "destructive" });
                  } finally {
                    setTimelinessPdfLoading(false);
                  }
                }}
              >
                {timelinessPdfLoading ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Generating…</> : "Proof of timely filing letter"}
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="menu-appeal-letter"
                disabled={appealPdfLoading}
                onClick={async () => {
                  if (!id) return;
                  setAppealPdfLoading(true);
                  try {
                    const res = await fetch(`/api/billing/claims/${id}/letter-data`, { credentials: "include" });
                    if (!res.ok) throw new Error("Failed to fetch letter data");
                    const letterData = await res.json();
                    const { generateAppealLetterPDF } = await import('@/lib/generate-letters');
                    const pdfBytes = await generateAppealLetterPDF(letterData);
                    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `AppealLetter-${letterData.patient?.full_name?.replace(/\s+/g, '_') || 'claim'}.pdf`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    toast({ title: "Appeal letter downloaded." });
                  } catch (err: any) {
                    toast({ title: "PDF generation failed", description: err.message, variant: "destructive" });
                  } finally {
                    setAppealPdfLoading(false);
                  }
                }}
              >
                {appealPdfLoading ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Generating…</> : "Appeal letter — dispute denied claim"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {stediConfigured && claim.status === "submitted" && (claim as any).submissionMethod === "stedi" && (
            <Button
              variant="outline"
              className="gap-2"
              disabled={checking277}
              onClick={async () => {
                setChecking277(true);
                setCheck277Result(null);
                try {
                  const res = await fetch(`/api/billing/claims/${id}/check-277`, { method: "POST", credentials: "include" });
                  const data = await res.json();
                  setCheck277Result(data);
                  if (data.found) {
                    queryClient.invalidateQueries({ queryKey: ["/api/claims", id] });
                    queryClient.invalidateQueries({ queryKey: ["/api/claims", id, "events"] });
                    toast({ title: `277CA: ${data.status}`, description: `Acknowledgment received from payer.` });
                  } else {
                    toast({ title: "No acknowledgment yet", description: data.message });
                  }
                } catch (err: any) {
                  toast({ title: "Check failed", description: err.message, variant: "destructive" });
                } finally {
                  setChecking277(false);
                }
              }}
              data-testid="button-check-277"
            >
              {checking277 ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {checking277 ? "Checking..." : "Check 277 Status"}
            </Button>
          )}
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setExplainOpen(true)}
            data-testid="button-explain"
          >
            <HelpCircle className="h-4 w-4" />
            Why this decision?
          </Button>
          {stediConfigured && ["draft", "created", "ready", "pending"].includes(claim.status) && (
            <Button
              variant="outline"
              className="gap-2"
              disabled={testingClaim}
              onClick={async () => {
                setTestingClaim(true);
                try {
                  const res = await fetch(`/api/billing/claims/${id}/test-stedi`, { method: "POST", credentials: "include" });
                  const data = await res.json();
                  const payerLabel = data.payerName
                    ? `${data.payerName}${data.payerEdiId ? ` (${data.payerEdiId})` : ""}`
                    : "payer";
                  if (data.success) {
                    toast({
                      title: "Claim passed validation",
                      description: `EDI validated against ${payerLabel}${data.isFrcpbTestPayer ? " — Stedi test payer" : ""}. Ready to submit.`,
                    });
                  } else {
                    const errCount = (data.validationErrors || []).length;
                    toast({
                      title: `Validation failed — ${payerLabel}`,
                      description: errCount > 0 ? `${errCount} issue(s) found. See Validation Status for details.` : (data.error || "Stedi validation failed"),
                      variant: "destructive",
                    });
                  }
                  queryClient.invalidateQueries({ queryKey: ["/api/claims", id] });
                  queryClient.invalidateQueries({ queryKey: ["/api/claims", id, "events"] });
                } catch (err: any) {
                  toast({ title: "Test failed", description: err.message, variant: "destructive" });
                } finally {
                  setTestingClaim(false);
                }
              }}
              data-testid="button-run-test-validation"
            >
              {testingClaim ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
              {testingClaim ? "Validating..." : "Run Test Validation"}
            </Button>
          )}
          {canSubmit && (
            <Button
              className="gap-2"
              onClick={() => submitClaimMutation.mutate()}
              disabled={submitClaimMutation.isPending}
              data-testid="button-submit-claim"
            >
              {submitClaimMutation.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" />Submitting…</>
                : <><Send className="h-4 w-4" />Submit via Stedi</>}
            </Button>
          )}
        </div>
      </div>

      {isBlocked && (
        <Card className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
          <CardContent className="p-4 flex items-start gap-4">
            <div className="h-10 w-10 rounded-full bg-red-100 dark:bg-red-900/50 flex items-center justify-center shrink-0">
              <ShieldAlert className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-red-800 dark:text-red-300">
                Blocked before submission — Authorization likely required
              </h3>
              <p className="text-sm text-red-700/80 dark:text-red-400/80 mt-1">
                This claim has been flagged as high-risk and requires additional verification
                before it can be submitted.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Badge className="bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300 border-0">
                  Potential revenue protected: ${claim.amount.toLocaleString()}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Risk Assessment</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center py-4">
              <RiskScoreCircle score={claim.riskScore} size={100} />
              <div className="mt-4 w-full">
                <StatusBadge
                  status={claim.readinessStatus as "GREEN" | "YELLOW" | "RED"}
                  size="lg"
                  className="w-full justify-center"
                />
              </div>
            </CardContent>
          </Card>

          {(claim.status === "denied" || claim.status === "appealed") && (claim.reason || claim.nextStep) && (
            <Card className="border-red-200 dark:border-red-900" data-testid="card-denial-info">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium text-red-700 dark:text-red-400 flex items-center gap-2">
                  <XCircle className="h-4 w-4" />
                  Denial Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {claim.reason && (
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Denial Reason</p>
                    <p className="text-sm mt-0.5" data-testid="text-denial-reason">{claim.reason}</p>
                  </div>
                )}
                {claim.nextStep && (
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Recommended Next Step</p>
                    <p className="text-sm mt-0.5" data-testid="text-denial-next-step">{claim.nextStep}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {(claim.status === "denied" || claim.status === "appealed") && (
            <DenialRecoveryPanel claimId={claim.id} claimStatus={claim.status} onNavigate={setLocation} />
          )}

          <TimelyFilingWidget claim={claim} />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Claim Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Payer</p>
                  <p className="text-sm font-medium truncate">{claim.payer}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">HCPCS Codes</p>
                  <p className="text-sm font-mono truncate">
                    {claim.cptCodes?.join(", ")}
                  </p>
                  {claim.serviceLines?.some((sl: any) => sl.locationName) && (
                    <p className="text-xs text-muted-foreground mt-0.5" data-testid="text-va-locality">
                      VA locality: {claim.serviceLines.find((sl: any) => sl.locationName)?.locationName}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <DollarSign className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Amount</p>
                  <p className="text-sm font-semibold">
                    ${claim.amount.toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Created</p>
                  <p className="text-sm">
                    {format(new Date(claim.createdAt), "MMM d, yyyy")}
                  </p>
                </div>
              </div>
              {(claim as any).submissionMethod && (claim as any).submissionMethod !== "manual" && (
                <div className="flex items-start gap-3">
                  <Zap className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Submitted via</p>
                    <p className="text-sm font-medium capitalize">{(claim as any).submissionMethod === "stedi" ? "Stedi clearinghouse" : (claim as any).submissionMethod}</p>
                    {(claim as any).stediTransactionId && (
                      <p className="text-xs font-mono text-muted-foreground mt-0.5 truncate" data-testid="text-stedi-txn-id">{(claim as any).stediTransactionId}</p>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Validation Status Card (from Stedi test) */}
          {(() => {
            const testStatus = (claim as any).last_test_status || (claim as any).lastTestStatus;
            const testAt = (claim as any).last_test_at || (claim as any).lastTestAt;
            const testCorrelationId = (claim as any).last_test_correlation_id || (claim as any).lastTestCorrelationId;
            const testErrors: any[] = (() => {
              const raw = (claim as any).last_test_errors || (claim as any).lastTestErrors;
              if (!raw) return [];
              if (Array.isArray(raw)) return raw;
              try { return JSON.parse(raw); } catch { return []; }
            })();
            const relativeTime = testAt ? formatDistanceToNow(new Date(testAt), { addSuffix: true }) : null;

            if (!testStatus) {
              return (
                <Card data-testid="card-validation-status-none">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FlaskConical className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-xs font-medium">Validation Status</p>
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 inline-block" /> Not yet validated
                          </span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            }

            const passed = testStatus === "Accepted";
            return (
              <Card className={passed ? "border-green-200 dark:border-green-800" : "border-red-200 dark:border-red-800"} data-testid="card-validation-status">
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <FlaskConical className={`h-4 w-4 shrink-0 ${passed ? "text-green-600" : "text-red-500"}`} />
                      <div>
                        <p className="text-xs font-medium">Validation Status</p>
                        <div className={`inline-flex items-center gap-1 text-xs mt-0.5 font-medium ${passed ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`} data-testid="text-validation-status">
                          {passed
                            ? <><CheckCircle2 className="h-3 w-3" /> Passed validation</>
                            : <><XCircle className="h-3 w-3" /> Failed — {testErrors.length} error{testErrors.length !== 1 ? "s" : ""}</>
                          }
                        </div>
                        {relativeTime && <p className="text-xs text-muted-foreground">Last tested {relativeTime}</p>}
                        {passed && testCorrelationId && (
                          <p className="text-xs text-muted-foreground font-mono mt-0.5" data-testid="text-stedi-correlation-id">
                            Ref: {testCorrelationId}
                          </p>
                        )}
                      </div>
                    </div>
                    {!passed && testErrors.length > 0 && (
                      <button
                        onClick={() => setValidationErrorsExpanded(v => !v)}
                        className="text-muted-foreground hover:text-foreground shrink-0"
                        data-testid="button-toggle-validation-errors"
                      >
                        {validationErrorsExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    )}
                  </div>
                  {!passed && validationErrorsExpanded && testErrors.length > 0 && (
                    <div className="space-y-1.5 pt-1 border-t">
                      {testErrors.slice(0, 5).map((err: any, i: number) => (
                        <div key={i} className="text-xs bg-red-50 dark:bg-red-950/30 rounded p-2">
                          {err.code && err.code !== "UNKNOWN" && <span className="font-mono text-red-600 dark:text-red-400 mr-1">{err.code}:</span>}
                          <span className="text-muted-foreground">{err.message || String(err)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {check277Result && (
            <div className={`p-3 rounded-lg border text-sm ${check277Result.found ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800" : "bg-muted border-border"}`} data-testid="panel-277-result">
              {check277Result.found ? (
                <div className="flex items-start gap-2 text-green-800 dark:text-green-200">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-green-600" />
                  <div>
                    <p className="font-medium">277CA received — {check277Result.status}</p>
                    <p className="text-xs mt-0.5">Claim status updated. See timeline below.</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 text-muted-foreground">
                  <Info className="h-4 w-4 mt-0.5 shrink-0" />
                  <p className="text-xs">{check277Result.message}</p>
                </div>
              )}
            </div>
          )}

          {patient && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">Patient Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Insurance</span>
                  <span className="font-medium">{patient.insuranceCarrier}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Member ID</span>
                  <span className="font-mono text-xs">{patient.memberId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Plan Type</span>
                  <span>{patient.planType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">State</span>
                  <span>{patient.state}</span>
                </div>
              </CardContent>
            </Card>
          )}

          <PriorAuthSection
            encounterId={claim.encounterId}
            patientId={claim.patientId}
            payer={claim.payer}
            serviceType={claim.cptCodes?.[0] || "General Services"}
          />
        </div>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-medium">Claim Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            {events && events.length > 0 ? (
              <ClaimTimeline
                events={events}
                isStuck={isStuck}
                stuckDays={stuckDays}
              />
            ) : (
              <div className="text-center py-12">
                <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">No events recorded yet</p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Action Checklist
              </CardTitle>
            </CardHeader>
            <CardContent>
              {explanation?.recommendations ? (
                <div className="space-y-3">
                  {explanation.recommendations.map((rec, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-3 p-2 rounded-lg"
                    >
                      <div
                        className={`h-5 w-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                          rec.completed
                            ? "bg-emerald-100 dark:bg-emerald-900/30"
                            : "bg-muted"
                        }`}
                      >
                        {rec.completed && (
                          <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm ${
                            rec.completed ? "line-through text-muted-foreground" : ""
                          }`}
                        >
                          {rec.action}
                        </p>
                        <Badge
                          variant="outline"
                          className={`mt-1 text-xs border-0 ${
                            rec.priority === "high"
                              ? "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                              : rec.priority === "medium"
                              ? "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                              : "bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-400"
                          }`}
                        >
                          {rec.priority}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No actions required
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => setExplainOpen(true)}
              >
                <HelpCircle className="h-4 w-4 mr-2" />
                View Risk Analysis
              </Button>
              {["draft", "created", "ready", "denied", "returned"].includes(claim.status) && (
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => setLocation(`/billing/claims/new?claimId=${claim.id}${claim.patientId ? `&patientId=${claim.patientId}` : ""}`)}
                  data-testid="button-continue-editing"
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  {claim.status === "draft" ? "Continue Editing Draft" : "Edit Claim"}
                </Button>
              )}
              {claim.status === "draft" && (
                <Button
                  className="w-full justify-start"
                  onClick={() => markReadyMutation.mutate()}
                  disabled={markReadyMutation.isPending}
                  data-testid="button-mark-ready"
                >
                  {markReadyMutation.isPending
                    ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    : <CheckCircle className="h-4 w-4 mr-2" />}
                  Finalize Draft
                </Button>
              )}
              {practiceSettings?.oa_connected &&
                ["exported", "draft", "created"].includes(claim.status) && (
                  <Button
                    className="w-full justify-start"
                    onClick={async () => {
                      setSubmittingOA(true);
                      try {
                        const res = await fetch(`/api/billing/claims/${claim.id}/submit-oa`, {
                          method: "POST",
                          credentials: "include",
                        });
                        const result = await res.json();
                        if (result.success) {
                          toast({ title: "Claim submitted successfully", description: `File: ${result.filename}` });
                          queryClient.invalidateQueries({ queryKey: ["/api/claims", id] });
                        } else {
                          toast({ title: "Submission failed", description: result.error || result.message, variant: "destructive" });
                        }
                      } catch (err: any) {
                        toast({ title: "Submission failed", description: err.message, variant: "destructive" });
                      } finally {
                        setSubmittingOA(false);
                      }
                    }}
                    disabled={submittingOA}
                    data-testid="button-submit-oa"
                  >
                    {submittingOA ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4 mr-2" />
                        Submit via Office Ally
                      </>
                    )}
                  </Button>
                )}
              {!practiceSettings?.oa_connected && !stediConfigured &&
                ["exported", "created", "draft"].includes(claim.status) && (
                  <Button
                    variant="outline"
                    className="w-full justify-start text-muted-foreground"
                    onClick={() => setLocation("/billing/settings?tab=clearinghouse")}
                    data-testid="button-connect-oa"
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Configure a clearinghouse to submit electronically
                  </Button>
                )}
              {!claim.archived_at && ["draft", "submitted", "denied", "paid", "exported", "created", "rejected", "void"].includes(claim.status) && (
                <Button
                  variant="ghost"
                  className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setShowArchiveClaimDialog(true)}
                  data-testid="button-archive-claim"
                >
                  {claim.status === "draft" ? (
                    <><Trash2 className="h-4 w-4 mr-2" />Discard Draft</>
                  ) : (
                    <><Archive className="h-4 w-4 mr-2" />Archive Claim</>
                  )}
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Archive / Discard dialog */}
      <Dialog open={showArchiveClaimDialog} onOpenChange={setShowArchiveClaimDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {claim.status === "draft" ? "Discard Draft" : "Archive Claim"}
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 text-sm text-muted-foreground">
            {claim.status === "draft" ? (
              <p>This draft will be permanently discarded. This action cannot be undone.</p>
            ) : (
              <p>This claim will be hidden from your dashboard but retained in the system per HIPAA and state retention requirements.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowArchiveClaimDialog(false)} data-testid="button-archive-claim-cancel">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => archiveClaimMutation.mutate()}
              disabled={archiveClaimMutation.isPending}
              data-testid="button-archive-claim-confirm"
            >
              {archiveClaimMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {claim.status === "draft" ? "Discard Draft" : "Archive Claim"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ExplainabilityDrawer
        open={explainOpen}
        onOpenChange={setExplainOpen}
        explanation={explanation || null}
        claimId={claim.id.slice(0, 8)}
      />

      <Dialog open={!!ediValidation} onOpenChange={(o) => { if (!o) setEdiValidation(null); }}>
        <DialogContent className="max-w-lg" data-testid="dialog-edi-validate">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {ediValidation?.ready
                ? <CheckCircle2 className="h-5 w-5 text-green-500" />
                : <AlertTriangle className="h-5 w-5 text-amber-500" />}
              EDI Pre-Submission Check
            </DialogTitle>
            <DialogDescription>{ediValidation?.summary}</DialogDescription>
          </DialogHeader>

          {ediValidation && (ediValidation.warnings || []).length > 0 && (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {(ediValidation.warnings || []).map((w, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${
                    w.severity === "error"
                      ? "bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300"
                      : "bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300"
                  }`}
                  data-testid={`validation-item-${i}`}
                >
                  {w.severity === "error"
                    ? <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    : <Info className="h-4 w-4 mt-0.5 shrink-0" />}
                  <span>{w.message}</span>
                </div>
              ))}
            </div>
          )}

          {ediValidation?.ready && (ediValidation.warnings || []).length === 0 && (
            <p className="text-sm text-green-700 dark:text-green-400">
              All required fields are complete. This claim is ready to submit.
            </p>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEdiValidation(null)} data-testid="button-edi-cancel">
              Cancel
            </Button>
            {!ediValidation?.ready && (
              <Button
                variant="outline"
                disabled={ediDownloading}
                data-testid="button-edi-download-anyway"
                onClick={async () => {
                  setEdiDownloading(true);
                  try {
                    const res = await fetch(`/api/billing/claims/${id}/edi`, { credentials: "include" });
                    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || "Failed"); }
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a"); a.href = url; a.download = `claim_${id}_837P.edi`;
                    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                    setEdiValidation(null);
                    toast({ title: "837P EDI downloaded (with warnings)", description: "Review the issues above before submitting." });
                  } catch (err: any) {
                    toast({ title: "EDI download failed", description: err.message, variant: "destructive" });
                  } finally { setEdiDownloading(false); }
                }}
              >
                {ediDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Download anyway"}
              </Button>
            )}
            <Button
              disabled={ediDownloading}
              data-testid="button-edi-download-confirm"
              onClick={async () => {
                setEdiDownloading(true);
                try {
                  const res = await fetch(`/api/billing/claims/${id}/edi`, { credentials: "include" });
                  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || "Failed"); }
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href = url; a.download = `claim_${id}_837P.edi`;
                  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
                  setEdiValidation(null);
                  toast({ title: "837P EDI file downloaded", description: "Upload to your Office Ally or Availity portal for electronic submission." });
                } catch (err: any) {
                  toast({ title: "EDI download failed", description: err.message, variant: "destructive" });
                } finally { setEdiDownloading(false); }
              }}
            >
              {ediDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Download className="h-4 w-4 mr-1" /> Download EDI</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
