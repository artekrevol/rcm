import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, DollarSign, AlertTriangle, CheckCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { MetricCard } from "@/components/metric-card";

export default function BillingDashboard() {
  const { data: metrics } = useQuery<any>({
    queryKey: ["/api/dashboard/metrics"],
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Billing Dashboard</h1>
        <p className="text-muted-foreground">Claims overview and revenue cycle metrics</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Claims"
          value={metrics?.totalClaims ?? 0}
          icon={<FileText className="h-5 w-5" />}
          variant="blue"
        />
        <MetricCard
          title="Revenue Protected"
          value={`$${((metrics?.revenueProtected ?? 0) / 1000).toFixed(0)}K`}
          icon={<DollarSign className="h-5 w-5" />}
          variant="green"
        />
        <MetricCard
          title="Claims at Risk"
          value={metrics?.claimsAtRisk ?? 0}
          icon={<AlertTriangle className="h-5 w-5" />}
          variant="amber"
        />
        <MetricCard
          title="Denials Prevented"
          value={metrics?.denialsPrevented ?? 0}
          icon={<CheckCircle className="h-5 w-5" />}
          variant="green"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Billing dashboard with claim creation wizard, patient management, and reporting coming soon.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
