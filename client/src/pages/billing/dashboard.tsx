import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  FileText,
  DollarSign,
  AlertTriangle,
  CheckCircle,
  Clock,
  Shield,
  XCircle,
  Plus,
  ChevronRight,
  User,
  TrendingUp,
  TrendingDown,
  Activity,
  X,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { MetricCard } from "@/components/metric-card";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";

function formatCurrency(n: number) {
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return `$${n.toLocaleString()}`;
}

function statusDot(status: string) {
  if (status === "paid") return "bg-green-500";
  if (["denied", "suspended"].includes(status)) return "bg-red-500";
  if (["submitted", "acknowledged", "pending"].includes(status)) return "bg-yellow-500";
  return "bg-gray-400";
}

function StatusBadgeSmall({ status }: { status: string }) {
  const colors: Record<string, string> = {
    paid: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    denied: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    draft: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    exported: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    submitted: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    pending: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.draft}`} data-testid={`badge-status-${status}`}>
      {status}
    </span>
  );
}

function OnboardingChecklist() {
  const [, setLocation] = useLocation();
  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/billing/onboarding-checklist"],
    staleTime: 30_000,
  });

  const dismissMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/billing/onboarding-checklist/dismiss", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/billing/onboarding-checklist"] });
    },
  });

  if (isLoading || !data) return null;
  const { steps = [], completedCount = 0, total = 6, allDone, dismissedAt } = data;

  // Hide if all done and dismissed
  if (allDone && dismissedAt) return null;

  const pct = Math.round((completedCount / total) * 100);

  return (
    <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20" data-testid="card-onboarding">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-blue-600" />
            <CardTitle className="text-base font-semibold text-blue-900 dark:text-blue-100">
              Get Started with ClaimShield
            </CardTitle>
            <Badge variant="secondary" className="text-xs" data-testid="badge-progress">
              {completedCount}/{total}
            </Badge>
          </div>
          {allDone && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => dismissMutation.mutate()}
              data-testid="button-dismiss-onboarding"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        <Progress value={pct} className="h-1.5 mt-1" data-testid="progress-onboarding" />
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {steps.map((step: any) => (
            <button
              key={step.id}
              onClick={() => setLocation(step.link)}
              className={`flex items-center gap-2.5 text-left p-2.5 rounded-lg border transition-colors text-sm w-full
                ${step.done
                  ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20 text-green-800 dark:text-green-200"
                  : "border-border bg-background hover:bg-muted/50 text-foreground"
                }`}
              data-testid={`onboarding-step-${step.id}`}
            >
              {step.done
                ? <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                : <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
              }
              <span className={step.done ? "line-through opacity-70" : ""}>{step.label}</span>
            </button>
          ))}
        </div>
        {allDone && (
          <p className="text-sm text-green-700 dark:text-green-300 mt-3 font-medium text-center" data-testid="text-onboarding-complete">
            All steps complete — you're ready to bill!
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function BillingDashboard() {
  const { data: stats, isLoading } = useQuery<any>({
    queryKey: ["/api/billing/dashboard/stats"],
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20" />)}
        </div>
      </div>
    );
  }

  const pipeline = stats?.pipeline || { paid: { count: 0, amount: 0 }, inProcess: { count: 0, amount: 0 }, draft: { count: 0, amount: 0 }, denied: { count: 0, amount: 0 } };
  const alerts = stats?.alerts || { deniedClaims: { count: 0, amount: 0 }, staleDrafts: 0, timelyFilingRisk: 0, highRiskClaims: 0 };
  const benchmarks = stats?.benchmarks || { arDays: 0, denialRate: 0, fprrValue: 0 };
  const recentPatients = stats?.recentPatients || [];
  const recentClaims = stats?.recentClaims || [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Billing Dashboard</h1>
        <p className="text-muted-foreground">Claims overview and revenue cycle metrics</p>
      </div>

      <OnboardingChecklist />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="section-pipeline">
        <Link href="/billing/claims?status=paid">
          <MetricCard
            title="Paid"
            value={pipeline.paid.count}
            subtitle={formatCurrency(pipeline.paid.amount)}
            icon={<CheckCircle className="h-5 w-5" />}
            variant="green"
            className="cursor-pointer hover:border-green-300 transition-colors"
          />
        </Link>
        <Link href="/billing/claims?status=in_process">
          <MetricCard
            title="In Process"
            value={pipeline.inProcess.count}
            subtitle={formatCurrency(pipeline.inProcess.amount)}
            icon={<Clock className="h-5 w-5" />}
            variant="blue"
            className="cursor-pointer hover:border-blue-300 transition-colors"
          />
        </Link>
        <Link href="/billing/claims?status=draft">
          <MetricCard
            title="Drafts"
            value={pipeline.draft.count}
            subtitle={formatCurrency(pipeline.draft.amount)}
            icon={<FileText className="h-5 w-5" />}
            variant="default"
            className="cursor-pointer hover:border-muted-foreground/30 transition-colors"
          />
        </Link>
        <Link href="/billing/claims?status=denied">
          <MetricCard
            title="Denied"
            value={pipeline.denied.count}
            subtitle={formatCurrency(pipeline.denied.amount)}
            icon={<XCircle className="h-5 w-5" />}
            variant="amber"
            className="cursor-pointer hover:border-amber-300 transition-colors"
          />
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="section-alerts">
        <Link href="/billing/claims?status=denied">
          <Card className="cursor-pointer hover:border-red-300 transition-colors" data-testid="alert-denied">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="text-sm font-medium">Denied Claims</p>
                <p className="text-lg font-bold text-red-600">{alerts.deniedClaims.count}</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/billing/claims?status=draft">
          <Card className="cursor-pointer hover:border-yellow-300 transition-colors" data-testid="alert-stale-drafts">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center shrink-0">
                <Clock className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              </div>
              <div>
                <p className="text-sm font-medium">Stale Drafts</p>
                <p className="text-lg font-bold text-yellow-600">{alerts.staleDrafts}</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/billing/claims">
          <Card className="cursor-pointer hover:border-orange-300 transition-colors" data-testid="alert-timely-filing">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="text-sm font-medium">Filing Risk</p>
                <p className="text-lg font-bold text-orange-600">{alerts.timelyFilingRisk}</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/billing/claims">
          <Card className="cursor-pointer hover:border-red-300 transition-colors" data-testid="alert-high-risk">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                <Shield className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <p className="text-sm font-medium">High Risk</p>
                <p className="text-lg font-bold text-red-600">{alerts.highRiskClaims}</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="section-benchmarks">
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
              <Activity className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">A/R Days</p>
              <p className="text-2xl font-bold" data-testid="text-ar-days">{benchmarks.arDays?.toFixed(1) ?? "—"}</p>
              <p className="text-xs text-muted-foreground">Target: &lt;45 days</p>
            </div>
            {benchmarks.arDays > 0 && (
              <div className={`ml-auto shrink-0 ${benchmarks.arDays <= 45 ? "text-green-600" : "text-red-600"}`}>
                {benchmarks.arDays <= 45 ? <TrendingDown className="h-5 w-5" /> : <TrendingUp className="h-5 w-5" />}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
              <XCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Denial Rate</p>
              <p className="text-2xl font-bold" data-testid="text-denial-rate">{benchmarks.denialRate?.toFixed(1) ?? "—"}%</p>
              <p className="text-xs text-muted-foreground">Target: &lt;5%</p>
            </div>
            {benchmarks.denialRate > 0 && (
              <div className={`ml-auto shrink-0 ${benchmarks.denialRate <= 5 ? "text-green-600" : "text-red-600"}`}>
                {benchmarks.denialRate <= 5 ? <TrendingDown className="h-5 w-5" /> : <TrendingUp className="h-5 w-5" />}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
              <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">FPRR</p>
              <p className="text-2xl font-bold" data-testid="text-fprr">{benchmarks.fprrValue?.toFixed(1) ?? "—"}%</p>
              <p className="text-xs text-muted-foreground">First Pass Resolution Rate</p>
            </div>
            {benchmarks.fprrValue > 0 && (
              <div className={`ml-auto shrink-0 ${benchmarks.fprrValue >= 90 ? "text-green-600" : "text-yellow-600"}`}>
                {benchmarks.fprrValue >= 90 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {recentPatients.length > 0 && (
        <div data-testid="section-recent-patients">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Recent Patients</h2>
            <Link href="/billing/patients">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" data-testid="link-all-patients">
                View all <ChevronRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {recentPatients.map((p: any) => (
              <Card key={p.id} className="min-w-[200px] shrink-0" data-testid={`card-patient-${p.id?.slice(0, 8)}`}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className={`h-2.5 w-2.5 rounded-full ${statusDot(p.last_claim_status || "")}`} />
                    <p className="font-medium text-sm truncate">
                      {p.first_name || ""} {p.last_name || p.lead_name || "Unknown"}
                    </p>
                  </div>
                  {p.last_service_date && (
                    <p className="text-xs text-muted-foreground">
                      Last: {format(new Date(p.last_service_date), "MMM d, yyyy")}
                    </p>
                  )}
                  {p.insurance_carrier && (
                    <p className="text-xs text-muted-foreground truncate">{p.insurance_carrier}</p>
                  )}
                  <Link href={`/billing/claims/new?patientId=${p.id}`}>
                    <Button variant="outline" size="sm" className="w-full gap-1 mt-1" data-testid={`button-new-claim-patient-${p.id?.slice(0, 8)}`}>
                      <Plus className="h-3 w-3" /> New Claim
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div data-testid="section-recent-claims">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Recent Claims</h2>
          <Link href="/billing/claims">
            <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" data-testid="link-all-claims">
              View all <ChevronRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium text-muted-foreground">Claim ID</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Patient</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Payer</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">Amount</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {recentClaims.map((c: any) => (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30 cursor-pointer" data-testid={`row-claim-${c.id?.slice(0, 8)}`}>
                      <td className="p-3">
                        <Link href={`/billing/claims/${c.id}`} className="font-mono text-primary hover:underline">
                          {c.id?.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="p-3">{c.patient_name || "Unknown"}</td>
                      <td className="p-3 text-muted-foreground">{c.payer || "—"}</td>
                      <td className="p-3 text-right font-medium">${(c.amount || 0).toLocaleString()}</td>
                      <td className="p-3"><StatusBadgeSmall status={c.status} /></td>
                      <td className="p-3 text-muted-foreground">
                        {c.created_at ? format(new Date(c.created_at), "MMM d, yyyy") : "—"}
                      </td>
                    </tr>
                  ))}
                  {recentClaims.length === 0 && (
                    <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No claims yet. Create your first claim to get started.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
