import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricCard, RevenueProtectedCard } from "@/components/metric-card";
import { StatusBadge, ClaimStatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShieldAlert,
  FileWarning,
  Clock,
  Building2,
  TrendingUp,
  AlertTriangle,
  ArrowRight,
  FileText,
} from "lucide-react";
import { format } from "date-fns";
import type { DashboardMetrics, Claim } from "@shared/schema";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const weeklyTrendData = [
  { name: "Week 1", claims: 142, denials: 18, prevented: 15 },
  { name: "Week 2", claims: 156, denials: 12, prevented: 22 },
  { name: "Week 3", claims: 138, denials: 8, prevented: 28 },
  { name: "Week 4", claims: 167, denials: 6, prevented: 34 },
];

export default function DashboardPage() {
  const [, setLocation] = useLocation();

  const { data: metrics, isLoading: metricsLoading } = useQuery<DashboardMetrics>({
    queryKey: ["/api/dashboard/metrics"],
  });

  const { data: recentClaims, isLoading: claimsLoading } = useQuery<Claim[]>({
    queryKey: ["/api/claims/recent"],
  });

  const { data: alerts } = useQuery<Array<{ id: string; type: string; title: string; description: string; claimId: string; severity: string; timestamp: string }>>({
    queryKey: ["/api/dashboard/alerts"],
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Real-time overview of your claim health
          </p>
        </div>
        <Badge variant="outline" className="text-xs">
          Last updated: {format(new Date(), "MMM d, h:mm a")}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {metricsLoading ? (
          <>
            {[...Array(4)].map((_, i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <Skeleton className="h-4 w-24 mb-2" />
                  <Skeleton className="h-8 w-16" />
                </CardContent>
              </Card>
            ))}
          </>
        ) : metrics ? (
          <>
            <MetricCard
              title="Denials Prevented"
              value={metrics.denialsPrevented}
              icon={<ShieldAlert className="h-5 w-5" />}
              trend={{ value: 12, label: "vs last week" }}
            />
            <MetricCard
              title="Claims at Risk"
              value={metrics.claimsAtRisk}
              icon={<FileWarning className="h-5 w-5" />}
              subtitle="Requiring attention"
            />
            <MetricCard
              title="Avg AR Days"
              value={`${metrics.avgArDays} days`}
              icon={<Clock className="h-5 w-5" />}
              trend={{ value: -5, label: "improvement" }}
            />
            <MetricCard
              title="Top Payer Risk"
              value={metrics.topPayerRisk}
              icon={<Building2 className="h-5 w-5" />}
              subtitle="Highest denial rate"
            />
          </>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
            <CardTitle className="text-base font-medium">
              Monthly Trend
            </CardTitle>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-primary" />
                <span className="text-muted-foreground">Claims</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-emerald-500" />
                <span className="text-muted-foreground">Prevented</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-red-500" />
                <span className="text-muted-foreground">Denials</span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={weeklyTrendData}>
                  <defs>
                    <linearGradient id="colorClaims" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorDenials" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(0 72% 50%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(0 72% 50%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="claims"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorClaims)"
                  />
                  <Area
                    type="monotone"
                    dataKey="prevented"
                    stroke="hsl(145 70% 42%)"
                    strokeWidth={2}
                    fillOpacity={0.5}
                    fill="hsl(145 70% 42% / 0.2)"
                  />
                  <Area
                    type="monotone"
                    dataKey="denials"
                    stroke="hsl(0 72% 50%)"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorDenials)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <RevenueProtectedCard
            amount={metrics?.revenueProtected || 0}
            claimsProtected={metrics?.denialsPrevented || 0}
          />

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Active Alerts
              </CardTitle>
              <Badge variant="secondary" className="text-xs">
                {alerts?.length || 0}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {alerts?.slice(0, 3).map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 cursor-pointer hover-elevate"
                  onClick={() => setLocation(`/claims/${alert.claimId}`)}
                  data-testid={`alert-${alert.id}`}
                >
                  <div className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${alert.severity === "high" ? "bg-red-500" : "bg-amber-500"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{alert.title}</p>
                    <p className="text-xs text-muted-foreground">{alert.description}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {format(new Date(alert.timestamp), "MMM d, h:mm a")}
                    </p>
                  </div>
                </div>
              )) || (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No active alerts
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Recent Claims
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1"
            onClick={() => setLocation("/claims")}
            data-testid="button-view-all-claims"
          >
            View all
            <ArrowRight className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {claimsLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : recentClaims?.length ? (
            <div className="space-y-2">
              {recentClaims.slice(0, 5).map((claim) => (
                <div
                  key={claim.id}
                  className="flex items-center justify-between gap-4 p-3 rounded-lg hover-elevate cursor-pointer"
                  onClick={() => setLocation(`/claims/${claim.id}`)}
                  data-testid={`claim-row-${claim.id}`}
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="font-mono text-sm text-muted-foreground">
                      {claim.id.slice(0, 8)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{claim.payer}</p>
                      <p className="text-xs text-muted-foreground">
                        {claim.cptCodes?.join(", ")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <StatusBadge status={claim.readinessStatus as "GREEN" | "YELLOW" | "RED"} />
                    <ClaimStatusBadge status={claim.status} />
                    <p className="font-medium text-sm min-w-[80px] text-right">
                      ${claim.amount.toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              No claims found
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
