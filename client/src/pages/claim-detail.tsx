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
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
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
} from "lucide-react";
import { format, differenceInDays } from "date-fns";
import type { Claim, ClaimEvent, RiskExplanation, Patient } from "@shared/schema";

export default function ClaimDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [explainOpen, setExplainOpen] = useState(false);

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
                  <p className="text-xs text-muted-foreground">CPT Codes</p>
                  <p className="text-sm font-mono truncate">
                    {claim.cptCodes?.join(", ")}
                  </p>
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
    </div>
  );
}
