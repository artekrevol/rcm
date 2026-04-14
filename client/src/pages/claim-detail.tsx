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
} from "lucide-react";
import { format, differenceInDays } from "date-fns";
import type { Claim, ClaimEvent, RiskExplanation, Patient } from "@shared/schema";
import { generateAndDownloadClaimPdf } from "@/lib/generate-claim-pdf";

interface EdiValidation {
  ready: boolean;
  summary: string;
  warnings: { field: string; message: string; severity: "error" | "warning" }[];
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

  const { data: practiceSettings } = useQuery<any>({
    queryKey: ["/api/billing/practice-settings"],
  });

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
      return apiRequest("POST", `/api/claims/${id}/submit`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/claims", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/claims", id, "events"] });
      toast({ title: "Claim submitted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to submit claim", variant: "destructive" });
    },
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
  const canSubmit = claim.readinessStatus === "GREEN" && claim.status === "created";

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
                    const data: EdiValidation = await res.json();
                    setEdiValidation(data);
                  } catch {
                    setEdiValidation({ ready: false, summary: "Validation check failed", warnings: [] });
                  } finally {
                    setEdiValidating(false);
                  }
                }}
              >
                {ediValidating ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Checking…</> : "837P EDI file — for Office Ally / electronic submission"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setExplainOpen(true)}
            data-testid="button-explain"
          >
            <HelpCircle className="h-4 w-4" />
            Why this decision?
          </Button>
          {canSubmit && (
            <Button
              className="gap-2"
              onClick={() => submitClaimMutation.mutate()}
              disabled={submitClaimMutation.isPending}
              data-testid="button-submit-claim"
            >
              <Send className="h-4 w-4" />
              Submit Claim
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
            </CardContent>
          </Card>

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
              {!practiceSettings?.oa_connected &&
                ["exported", "created", "draft"].includes(claim.status) && (
                  <Button
                    variant="outline"
                    className="w-full justify-start text-muted-foreground"
                    onClick={() => setLocation("/billing/settings?tab=clearinghouse")}
                    data-testid="button-connect-oa"
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Connect Office Ally to submit electronically
                  </Button>
                )}
              {claim.status === "denied" && (
                <Button variant="outline" className="w-full justify-start">
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  File Appeal
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

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

          {ediValidation && ediValidation.warnings.length > 0 && (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {ediValidation.warnings.map((w, i) => (
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

          {ediValidation?.ready && ediValidation.warnings.length === 0 && (
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
