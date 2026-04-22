import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronDown, ChevronRight, ExternalLink, CheckCircle2, AlertCircle, AlertTriangle,
  XCircle, Search, Radio, FileText, Loader2, Clock, FlaskConical,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Link } from "wouter";

const STATUS_COLORS: Record<string, string> = {
  paid: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  submitted: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  acknowledged: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  denied: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  suspended: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  pending: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  draft: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] || STATUS_COLORS.draft}`}>
      {status}
    </span>
  );
}

function ValidationBadge({ claim }: { claim: any }) {
  const testStatus = claim.last_test_status;
  const testErrors: any[] = (() => {
    const raw = claim.last_test_errors;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try { return JSON.parse(raw); } catch { return []; }
  })();

  if (!["draft", "created", "pending"].includes(claim.status)) return null;

  if (!testStatus) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full" data-testid={`badge-validation-none-${claim.id?.slice(0, 8)}`}>
        <FlaskConical className="h-3 w-3" /> Not tested
      </span>
    );
  }
  if (testStatus === "Accepted") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400 bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded-full" data-testid={`badge-validation-pass-${claim.id?.slice(0, 8)}`}>
        <CheckCircle2 className="h-3 w-3" /> Passed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30 px-2 py-0.5 rounded-full" data-testid={`badge-validation-fail-${claim.id?.slice(0, 8)}`}>
      <XCircle className="h-3 w-3" /> {testErrors.length || "?"} error{(testErrors.length || 0) !== 1 ? "s" : ""}
    </span>
  );
}

function EventRow({ event }: { event: any }) {
  const isTest = event.type === "Test Validation";
  const isError = !isTest && (event.type === "Denied" || (event.notes || "").toLowerCase().includes("reject") || (event.notes || "").toLowerCase().includes("error"));
  const isFixed = event.type === "MarkedFixed" || event.type === "Resubmitted";

  return (
    <div className={`ml-8 pl-4 border-l py-2 text-sm ${isError ? "border-red-300" : isTest ? "border-gray-200 dark:border-gray-700" : "border-muted"}`}>
      <div className="flex items-start gap-2">
        {isFixed ? <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" /> :
         isTest ? <FlaskConical className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" /> :
         isError ? <XCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" /> :
         <Clock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-medium ${isTest ? "text-muted-foreground" : ""}`}>{event.type}</span>
            <Badge variant="outline" className={`text-xs ${isTest ? "text-muted-foreground border-muted" : ""}`}>
              {event.timestamp ? format(new Date(event.timestamp), "MMM d, yyyy h:mm a") : "—"}
            </Badge>
            {isTest && <Badge variant="outline" className="text-xs text-gray-400 border-gray-200">Free test</Badge>}
          </div>
          {event.notes && <p className={`mt-0.5 ${isTest ? "text-muted-foreground/70" : "text-muted-foreground"}`}>{event.notes}</p>}
        </div>
      </div>
    </div>
  );
}

function ClaimRow({ claim, payers }: { claim: any; payers: any[] }) {
  const [expanded, setExpanded] = useState(false);
  const [showFixDialog, setShowFixDialog] = useState(false);
  const { toast } = useToast();

  const markFixedMutation = useMutation({
    mutationFn: async (resubmit: boolean) => {
      const res = await apiRequest("POST", `/api/billing/claims/${claim.id}/mark-fixed`, { resubmit });
      return res.json();
    },
    onSuccess: (_, resubmit) => {
      toast({ title: resubmit ? "Claim resubmitted" : "Marked as fixed" });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/claim-tracker"] });
      setShowFixDialog(false);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const events: any[] = claim.events || [];
  const hasErrors = ["denied", "suspended"].includes(claim.status);
  const payerName = claim.payer_name || claim.payer || "—";

  return (
    <>
      <Card className={`mb-2 ${hasErrors ? "border-red-200 dark:border-red-900" : ""}`} data-testid={`card-claim-tracker-${claim.id?.slice(0, 8)}`}>
        <CardContent className="p-0">
          <div className="flex items-center gap-3 p-4">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-muted-foreground hover:text-foreground"
              data-testid={`button-expand-claim-${claim.id?.slice(0, 8)}`}
            >
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <div className="flex-1 grid grid-cols-2 md:grid-cols-6 gap-3 text-sm min-w-0">
              <div>
                <p className="text-xs text-muted-foreground">Claim #</p>
                <p className="font-mono font-medium">{claim.id?.slice(0, 8)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Patient</p>
                <p className="font-medium truncate">{claim.patient_name || "Unknown"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Payer</p>
                <p className="truncate">{payerName}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Billed</p>
                <p className="font-medium">${(claim.amount || 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <StatusBadge status={claim.status} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Validation</p>
                <ValidationBadge claim={claim} />
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link href={`/billing/claims/${claim.id}`}>
                <Button variant="ghost" size="sm" data-testid={`button-open-claim-${claim.id?.slice(0, 8)}`}>
                  <FileText className="h-3.5 w-3.5 mr-1" /> Open Claim
                </Button>
              </Link>
              {claim.patient_record_id && (
                <Link href={`/billing/patients/${claim.patient_record_id}`}>
                  <Button variant="ghost" size="sm" data-testid={`button-open-patient-${claim.id?.slice(0, 8)}`}>
                    <ExternalLink className="h-3.5 w-3.5 mr-1" /> Patient
                  </Button>
                </Link>
              )}
              {hasErrors && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-orange-600 border-orange-300 hover:bg-orange-50"
                  onClick={() => setShowFixDialog(true)}
                  data-testid={`button-mark-fixed-${claim.id?.slice(0, 8)}`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark as Fixed
                </Button>
              )}
            </div>
          </div>

          {expanded && (
            <div className="border-t bg-muted/20 py-3 px-4 space-y-1">
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground ml-8 pl-4">No submission history recorded.</p>
              ) : (
                events.map((ev: any) => <EventRow key={ev.id} event={ev} />)
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showFixDialog} onOpenChange={setShowFixDialog}>
        <DialogContent data-testid="dialog-mark-fixed">
          <DialogHeader>
            <DialogTitle>Mark Error as Fixed</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Would you like to resubmit this claim?</p>
          <DialogFooter className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setShowFixDialog(false)} data-testid="button-cancel-fix">Cancel</Button>
            <Button
              variant="outline"
              onClick={() => markFixedMutation.mutate(false)}
              disabled={markFixedMutation.isPending}
              data-testid="button-dont-resubmit"
            >
              Don't Resubmit
            </Button>
            <Button
              onClick={() => markFixedMutation.mutate(true)}
              disabled={markFixedMutation.isPending}
              data-testid="button-resubmit-claim"
            >
              {markFixedMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Resubmit Claim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function ClaimTrackerPage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [payerFilter, setPayerFilter] = useState("all");
  const [patientSearch, setPatientSearch] = useState("");
  const [applied, setApplied] = useState<Record<string, string>>({});

  const { data: claims = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/billing/claim-tracker", applied],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (applied.statusFilter && applied.statusFilter !== "all") params.set("status", applied.statusFilter);
      if (applied.payerFilter && applied.payerFilter !== "all") params.set("payer_id", applied.payerFilter);
      if (applied.patientSearch) params.set("patient", applied.patientSearch);
      if (applied.dateFrom) params.set("date_from", applied.dateFrom);
      if (applied.dateTo) params.set("date_to", applied.dateTo);
      const res = await fetch(`/api/billing/claim-tracker?${params}`, { credentials: "include" });
      return res.json();
    },
  });

  const { data: payers = [] } = useQuery<any[]>({ queryKey: ["/api/payers"] });

  function handleSearch() {
    setApplied({ statusFilter, payerFilter, patientSearch, dateFrom, dateTo });
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Claim Tracker</h1>
        <p className="text-muted-foreground">Track claim submission status and resolution</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Search & Filter</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Date From</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-sm" data-testid="input-date-from" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date To</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-sm" data-testid="input-date-to" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-status-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                  <SelectItem value="acknowledged">Acknowledged</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="denied">Denied</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Payer</Label>
              <Select value={payerFilter} onValueChange={setPayerFilter}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-payer-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Payers</SelectItem>
                  {payers.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Patient</Label>
              <Input
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
                placeholder="Search patient..."
                className="h-8 text-sm"
                data-testid="input-patient-filter"
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
            </div>
          </div>
          <div className="flex justify-end mt-3">
            <Button onClick={handleSearch} size="sm" data-testid="button-search-tracker">
              <Search className="h-4 w-4 mr-2" /> Search
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : claims.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Radio className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p>No claims found. Try adjusting your filters.</p>
          </CardContent>
        </Card>
      ) : (
        <div data-testid="section-claim-tracker-results">
          <p className="text-sm text-muted-foreground mb-3">{claims.length} claim{claims.length !== 1 ? "s" : ""} found</p>
          {claims.map((claim: any) => (
            <ClaimRow key={claim.id} claim={claim} payers={payers} />
          ))}
        </div>
      )}
    </div>
  );
}
