import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { format } from "date-fns";
import { RefreshCw, Building2, Users, FileText, CreditCard, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { queryClient } from "@/lib/queryClient";

export default function AdminOverview() {
  const { data: orgs = [], isLoading: orgsLoading } = useQuery<any[]>({
    queryKey: ["/api/super-admin/orgs"],
  });
  const { data: vitals } = useQuery<any>({
    queryKey: ["/api/super-admin/vitals"],
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["/api/super-admin/orgs"] });
    queryClient.invalidateQueries({ queryKey: ["/api/super-admin/vitals"] });
  }

  return (
    <div className="p-6 space-y-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-admin-title">Platform Overview</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{format(new Date(), "MMMM d, yyyy")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} data-testid="button-refresh-overview">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Platform Vitals */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Platform Vitals</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <Card data-testid="card-vitals-orgs">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Clinics</p>
              <p className="text-2xl font-semibold mt-1">{vitals?.totalOrgs ?? "—"}</p>
            </CardContent>
          </Card>
          <Card data-testid="card-vitals-claims">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Claims</p>
              <p className="text-2xl font-semibold mt-1">{vitals?.totalClaims ?? "—"}</p>
            </CardContent>
          </Card>
          <Card data-testid="card-vitals-eras">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total ERAs Posted</p>
              <p className="text-2xl font-semibold mt-1">{vitals?.totalEras ?? "—"}</p>
            </CardContent>
          </Card>
          <Card data-testid="card-vitals-users">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Users</p>
              <p className="text-2xl font-semibold mt-1">{vitals?.totalUsers ?? "—"}</p>
            </CardContent>
          </Card>
          <Card data-testid="card-vitals-recent">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Claims (Last 7 Days)</p>
              <p className="text-2xl font-semibold mt-1">{vitals?.claimsLast7Days ?? "—"}</p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Clinic Cards */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Clinics ({orgs.length})</h2>
        {orgsLoading ? (
          <p className="text-muted-foreground text-sm">Loading clinics...</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {orgs.map((org: any) => (
              <Card key={org.id} className="hover:border-primary/50 transition-colors" data-testid={`card-clinic-${org.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <CardTitle className="text-base leading-tight">{org.name}</CardTitle>
                    </div>
                    <div className="flex gap-1 flex-wrap justify-end">
                      {org.has_billing && <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">Billing</Badge>}
                      {org.has_intake && <Badge variant="secondary" className="text-xs bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400">Intake</Badge>}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Created {format(new Date(org.created_at), "MMM d, yyyy")}
                  </p>
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="flex items-center justify-center gap-1 text-muted-foreground mb-0.5">
                        <Users className="h-3 w-3" />
                      </div>
                      <p className="text-lg font-semibold">{org.user_count}</p>
                      <p className="text-xs text-muted-foreground">Users</p>
                    </div>
                    <div>
                      <div className="flex items-center justify-center gap-1 text-muted-foreground mb-0.5">
                        <FileText className="h-3 w-3" />
                      </div>
                      <p className="text-lg font-semibold">{org.total_claims}</p>
                      <p className="text-xs text-muted-foreground">Claims</p>
                    </div>
                    <div>
                      <div className="flex items-center justify-center gap-1 text-muted-foreground mb-0.5">
                        <TrendingUp className="h-3 w-3" />
                      </div>
                      <p className="text-lg font-semibold">{org.claims_last_30d}</p>
                      <p className="text-xs text-muted-foreground">Last 30d</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <p className="text-xs text-muted-foreground">
                      Setup: {org.onboarding_steps}/6 steps
                    </p>
                    <Link href={`/admin/clinics/${org.id}`}>
                      <Button size="sm" variant="outline" className="h-7 text-xs" data-testid={`button-view-clinic-${org.id}`}>
                        View Clinic
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
