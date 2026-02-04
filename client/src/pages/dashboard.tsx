import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MetricCard, RevenueProtectedCard } from "@/components/metric-card";
import { StatusBadge, ClaimStatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShieldAlert,
  FileWarning,
  Clock,
  Building2,
  AlertTriangle,
  ArrowRight,
  FileText,
  ExternalLink,
  Bell,
} from "lucide-react";
import { format } from "date-fns";
import type { DashboardMetrics, Claim } from "@shared/schema";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const monthlyTrendData = [
  { name: "Jul", claims: 420, prevented: 85, denials: 35 },
  { name: "Aug", claims: 380, prevented: 92, denials: 28 },
  { name: "Sep", claims: 450, prevented: 110, denials: 22 },
  { name: "Oct", claims: 520, prevented: 145, denials: 18 },
  { name: "Nov", claims: 480, prevented: 160, denials: 15 },
  { name: "Dec", claims: 550, prevented: 180, denials: 12 },
  { name: "Jan", claims: 510, prevented: 175, denials: 10 },
];

export default function DashboardPage() {
  const [, setLocation] = useLocation();
  const [timePeriod, setTimePeriod] = useState("month");

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
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Revenue cycle overview and real-time alerts
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="text-xs">
            Last 30 Days
          </Badge>
          <Button variant="default" size="sm" className="gap-2" data-testid="button-view-alerts">
            <Bell className="h-4 w-4" />
            View All Alerts
          </Button>
        </div>
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
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
            <CardTitle className="text-base font-medium">
              Monthly Trends
            </CardTitle>
            <Tabs value={timePeriod} onValueChange={setTimePeriod}>
              <TabsList className="h-8">
                <TabsTrigger value="week" className="text-xs px-3 h-7">Week</TabsTrigger>
                <TabsTrigger value="month" className="text-xs px-3 h-7">Month</TabsTrigger>
                <TabsTrigger value="quarter" className="text-xs px-3 h-7">Quarter</TabsTrigger>
                <TabsTrigger value="year" className="text-xs px-3 h-7">Year</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlyTrendData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="claims"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                    name="Total Claims"
                  />
                  <Line
                    type="monotone"
                    dataKey="prevented"
                    stroke="hsl(145 70% 42%)"
                    strokeWidth={2}
                    dot={false}
                    name="Prevented"
                  />
                  <Line
                    type="monotone"
                    dataKey="denials"
                    stroke="hsl(0 72% 50%)"
                    strokeWidth={2}
                    dot={false}
                    name="Denials"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center justify-center gap-6 mt-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="h-0.5 w-4 bg-primary rounded" />
                <span className="text-muted-foreground">Total Claims</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-0.5 w-4 bg-emerald-500 rounded" />
                <span className="text-muted-foreground">Prevented</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-0.5 w-4 bg-red-500 rounded" />
                <span className="text-muted-foreground">Denials</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <RevenueProtectedCard
          amount={metrics?.revenueProtected || 2400000}
          claimsProtected={metrics?.denialsPrevented || 156}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
          <CardTitle className="text-base font-medium">
            Active Alerts
          </CardTitle>
          <Button variant="ghost" size="sm" className="gap-1 text-sm" data-testid="link-view-all-alerts">
            View All
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {alerts?.slice(0, 4).map((alert) => (
            <div
              key={alert.id}
              className="flex items-center justify-between gap-4 p-3 rounded-lg hover-elevate cursor-pointer border border-transparent hover:border-border"
              onClick={() => setLocation(`/claims/${alert.claimId}`)}
              data-testid={`alert-${alert.id}`}
            >
              <div className="flex items-center gap-3">
                <div className={`h-2 w-2 rounded-full shrink-0 ${alert.severity === "high" ? "bg-red-500" : "bg-amber-500"}`} />
                <div>
                  <p className="text-sm font-medium">{alert.title}</p>
                  <p className="text-xs text-muted-foreground">{alert.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <span className="text-xs text-muted-foreground">
                  {format(new Date(alert.timestamp), "h:mm a")}
                </span>
                <Button variant="outline" size="sm" className="h-7">
                  View
                </Button>
              </div>
            </div>
          )) || (
            <p className="text-sm text-muted-foreground text-center py-4">
              No active alerts
            </p>
          )}
        </CardContent>
      </Card>

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
