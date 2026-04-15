import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { CreditCard, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, Loader2, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Link } from "wouter";

const ERA_STATUS_COLORS: Record<string, string> = {
  unposted: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  posted: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  needs_review: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  skipped: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

function adjustmentGroupBadge(code: string) {
  if (code?.startsWith("CO-") || code?.startsWith("CO")) return <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-xs">{code} — Contractual</Badge>;
  if (code?.startsWith("PR-") || code?.startsWith("PR")) return <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 text-xs">{code} — Patient Resp</Badge>;
  if (code?.startsWith("OA-") || code?.startsWith("OA")) return <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 text-xs">{code} — Other Adj</Badge>;
  return <Badge variant="outline" className="text-xs">{code}</Badge>;
}

function ERALineRow({ line }: { line: any }) {
  const [expanded, setExpanded] = useState(false);
  const serviceLines: any[] = typeof line.service_lines === "string" ? JSON.parse(line.service_lines) : (line.service_lines || []);

  return (
    <div className="border rounded-lg mb-2">
      <button
        className="w-full flex items-center gap-3 p-3 text-sm text-left hover:bg-muted/30"
        onClick={() => setExpanded(!expanded)}
        data-testid={`button-expand-era-line-${line.id?.slice(0, 8)}`}
      >
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <div className="flex-1 grid grid-cols-2 md:grid-cols-5 gap-2">
          <div>
            <p className="text-xs text-muted-foreground">Claim</p>
            <p className="font-mono">{line.claim_id ? line.claim_id.slice(0, 8) : "Unmatched"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Patient</p>
            <p>{line.patient_name || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">DOS</p>
            <p>{line.dos ? format(new Date(line.dos), "MM/dd/yyyy") : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Billed / Allowed / Paid</p>
            <p>
              <span className="text-muted-foreground">${(line.billed_amount || 0).toFixed(2)}</span>
              {" / "}
              <span className="text-muted-foreground">${(line.allowed_amount || 0).toFixed(2)}</span>
              {" / "}
              <span className="font-medium text-green-600">${(line.paid_amount || 0).toFixed(2)}</span>
            </p>
          </div>
          <div>
            {line.claim_id && (
              <Link href={`/billing/claims/${line.claim_id}`}>
                <Button variant="ghost" size="sm" className="h-6 text-xs">View Claim</Button>
              </Link>
            )}
          </div>
        </div>
      </button>

      {expanded && serviceLines.length > 0 && (
        <div className="border-t bg-muted/10 p-3 space-y-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b">
                <th className="text-left p-1">CPT</th>
                <th className="text-right p-1">Billed</th>
                <th className="text-right p-1">Allowed</th>
                <th className="text-right p-1">Paid</th>
                <th className="text-right p-1">Adj</th>
                <th className="text-left p-1 pl-3">CARC / RARC</th>
              </tr>
            </thead>
            <tbody>
              {serviceLines.map((sl: any, i: number) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="p-1 font-mono">{sl.cpt || sl.code || "—"}</td>
                  <td className="p-1 text-right">${(sl.billed || 0).toFixed(2)}</td>
                  <td className="p-1 text-right">${(sl.allowed || 0).toFixed(2)}</td>
                  <td className="p-1 text-right text-green-600">${(sl.paid || 0).toFixed(2)}</td>
                  <td className="p-1 text-right text-red-600">${((sl.billed || 0) - (sl.paid || 0)).toFixed(2)}</td>
                  <td className="p-1 pl-3 space-x-1">
                    {sl.carc && adjustmentGroupBadge(sl.carc)}
                    {sl.carc_desc && <span className="text-muted-foreground">{sl.carc_desc}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ERADetail({ era, onBack }: { era: any; onBack: () => void }) {
  const { toast } = useToast();
  const [confirmAction, setConfirmAction] = useState<string | null>(null);

  const actionMutation = useMutation({
    mutationFn: async (action: string) => {
      const res = await apiRequest("PATCH", `/api/billing/eras/${era.id}`, { action });
      return res.json();
    },
    onSuccess: (_, action) => {
      toast({ title: action === "post" ? "ERA posted" : action === "review" ? "Marked for review" : "ERA skipped" });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/eras"] });
      setConfirmAction(null);
      onBack();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const lines: any[] = era.lines || [];
  const totalBilled = lines.reduce((s: number, l: any) => s + (l.billed_amount || 0), 0);
  const totalAllowed = lines.reduce((s: number, l: any) => s + (l.allowed_amount || 0), 0);
  const totalPaid = lines.reduce((s: number, l: any) => s + (l.paid_amount || 0), 0);

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onBack} className="gap-2" data-testid="button-era-back">
        <ArrowLeft className="h-4 w-4" /> Back to ERA list
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <CardTitle>{era.payer_name}</CardTitle>
              <div className="text-sm text-muted-foreground mt-1 space-x-4">
                {era.check_number && <span>Check #: <strong>{era.check_number}</strong></span>}
                {era.payment_date && <span>Payment Date: <strong>{format(new Date(era.payment_date), "MM/dd/yyyy")}</strong></span>}
                <span>Total: <strong>${(era.total_amount || 0).toFixed(2)}</strong></span>
              </div>
            </div>
            <Badge className={ERA_STATUS_COLORS[era.status] || ERA_STATUS_COLORS.unposted}>
              {era.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center border rounded-lg p-3 mb-4 bg-muted/20">
            <div>
              <p className="text-xs text-muted-foreground">Total Billed</p>
              <p className="text-lg font-bold">${totalBilled.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Allowed</p>
              <p className="text-lg font-bold">${totalAllowed.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Paid</p>
              <p className="text-lg font-bold text-green-600">${totalPaid.toFixed(2)}</p>
            </div>
          </div>

          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No claim lines in this ERA.</p>
          ) : (
            lines.map((line: any) => <ERALineRow key={line.id} line={line} />)
          )}
        </CardContent>
      </Card>

      {era.status === "unposted" && (
        <div className="flex gap-3 flex-wrap">
          <Button onClick={() => setConfirmAction("post")} data-testid="button-post-era">
            <CheckCircle2 className="h-4 w-4 mr-2" /> Post This ERA
          </Button>
          <Button variant="outline" onClick={() => actionMutation.mutate("review")} disabled={actionMutation.isPending} data-testid="button-review-era">
            <AlertTriangle className="h-4 w-4 mr-2" /> Review Manually
          </Button>
          <Button variant="ghost" onClick={() => actionMutation.mutate("skip")} disabled={actionMutation.isPending} data-testid="button-skip-era">
            Skip
          </Button>
        </div>
      )}

      <Dialog open={confirmAction === "post"} onOpenChange={(o) => !o && setConfirmAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm ERA Posting</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will post ${totalPaid.toFixed(2)} in payments to {lines.filter((l: any) => l.claim_id).length} matched claim(s) and mark them as paid. This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button onClick={() => actionMutation.mutate("post")} disabled={actionMutation.isPending} data-testid="button-confirm-post-era">
              {actionMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Post Payments
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ERAPage() {
  const [selectedEraId, setSelectedEraId] = useState<string | null>(null);

  const { data: eras = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/billing/eras"],
  });

  const { data: selectedEra } = useQuery<any>({
    queryKey: ["/api/billing/eras", selectedEraId],
    queryFn: async () => {
      if (!selectedEraId) return null;
      const res = await fetch(`/api/billing/eras/${selectedEraId}`, { credentials: "include" });
      return res.json();
    },
    enabled: !!selectedEraId,
  });

  if (selectedEraId && selectedEra) {
    return (
      <div className="p-6">
        <ERADetail era={selectedEra} onBack={() => setSelectedEraId(null)} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">ERA Posting</h1>
        <p className="text-muted-foreground">Review and post electronic remittance advice (835 files)</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : eras.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <CreditCard className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No ERA batches received yet</p>
            <p className="text-sm mt-1">835 remittance files from Office Ally will appear here when available.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3" data-testid="section-era-list">
          {eras.map((era: any) => (
            <Card
              key={era.id}
              className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => setSelectedEraId(era.id)}
              data-testid={`card-era-${era.id?.slice(0, 8)}`}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <CreditCard className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold">{era.payer_name}</p>
                      <div className="text-sm text-muted-foreground flex gap-3 flex-wrap">
                        {era.check_number && <span>Check #{era.check_number}</span>}
                        {era.payment_date && <span>{format(new Date(era.payment_date), "MM/dd/yyyy")}</span>}
                        <span>{era.line_count || 0} claim line(s)</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Total Payment</p>
                      <p className="text-lg font-bold text-green-600">${(era.total_amount || 0).toFixed(2)}</p>
                    </div>
                    <Badge className={ERA_STATUS_COLORS[era.status] || ERA_STATUS_COLORS.unposted}>
                      {era.status === "unposted" ? "Unposted" :
                       era.status === "posted" ? "Posted" :
                       era.status === "needs_review" ? "Needs Review" : "Skipped"}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
