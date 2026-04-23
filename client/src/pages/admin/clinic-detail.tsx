import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "wouter";
import { format } from "date-fns";
import {
  ArrowLeft, Building2, Users, FileText, AlertTriangle, CheckCircle2, XCircle, CreditCard, ClipboardList, Shield, UserCheck
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function RoleBadge({ role }: { role: string }) {
  const map: Record<string, string> = {
    admin: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    rcm_manager: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    intake: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
  };
  return (
    <Badge variant="secondary" className={`text-xs ${map[role] || ""}`}>
      {role.replace("_", " ")}
    </Badge>
  );
}

export default function ClinicDetail() {
  const { orgId } = useParams<{ orgId: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["/api/super-admin/orgs", orgId],
    queryFn: () => fetch(`/api/super-admin/orgs/${orgId}`, { credentials: "include" }).then(r => r.json()),
  });

  const impersonateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/super-admin/impersonate/${orgId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Impersonation started", description: `Now acting as ${data?.org?.name}` });
      setLocation("/billing/dashboard");
    },
    onError: (err: any) => {
      toast({ title: "Failed to impersonate", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground text-sm">Loading clinic data...</p>
      </div>
    );
  }

  if (error || !data || data.error) {
    return (
      <div className="p-6">
        <p className="text-destructive text-sm">Failed to load clinic: {data?.error || "Unknown error"}</p>
      </div>
    );
  }

  const { org, practiceSettings: ps, users, providerCount, payerCount, featureUsage: fu, frictionItems, stediConfigured } = data;

  const oaConnected = !!(ps?.oa_connected && ps?.oa_sftp_username);
  const clearinghouseConnected = oaConnected || !!stediConfigured;

  function formatAddress(addr: any): string {
    if (!addr) return "—";
    if (typeof addr === "string") {
      try { addr = JSON.parse(addr); } catch { return addr; }
    }
    return [addr.street || addr.address || addr.street1, addr.city, addr.state, addr.zip].filter(Boolean).join(", ") || "—";
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/admin/clinics">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" />
            All Clinics
          </Button>
        </Link>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-2 flex-1">
          <Building2 className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold" data-testid="text-clinic-name">{org.name}</h1>
        </div>
        <Badge variant="outline" className="text-xs">Read-Only</Badge>
        <Button
          size="sm"
          className="gap-1.5"
          data-testid="button-impersonate-clinic"
          onClick={() => impersonateMutation.mutate()}
          disabled={impersonateMutation.isPending}
        >
          <UserCheck className="h-4 w-4" />
          {impersonateMutation.isPending ? "Starting..." : "Impersonate Clinic"}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Clinic Profile */}
        <Card data-testid="card-clinic-profile">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Clinic Profile
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Practice Name" value={ps?.practice_name || "—"} />
            <Row label="Primary NPI" value={ps?.primary_npi || "—"} />
            <Row label="Tax ID" value={ps?.tax_id || "—"} />
            <Row label="Address" value={formatAddress(ps?.address)} />
            <Row label="Phone" value={ps?.phone || "—"} />
            <Row label="Providers" value={`${providerCount} configured`} />
            <Row label="Payers in System" value={`${payerCount} available`} />
            <div className="flex items-center justify-between py-1">
              <span className="text-muted-foreground">Clearinghouse</span>
              {clearinghouseConnected
                ? <Badge className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Connected</Badge>
                : <Badge variant="secondary" className="text-xs">Not configured</Badge>
              }
            </div>
          </CardContent>
        </Card>

        {/* Feature Usage */}
        <Card data-testid="card-feature-usage">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Feature Usage (Last 30 Days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Claims Created", value: fu?.claimsCreated ?? 0, icon: FileText },
                { label: "Claims Submitted", value: fu?.claimsSubmitted ?? 0, icon: Shield },
                { label: "ERAs Posted", value: fu?.erasPosted ?? 0, icon: CreditCard },
                { label: "Follow-Up Notes", value: fu?.followupNotes ?? 0, icon: ClipboardList },
                { label: "Eligibility Checks", value: fu?.eligibilityChecks ?? 0, icon: Users },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="rounded-lg border p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{label}</span>
                  </div>
                  <p className="text-xl font-semibold">{value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Users */}
      <Card data-testid="card-clinic-users">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Users ({users?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Name</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Email</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Role</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Last Active</th>
                </tr>
              </thead>
              <tbody>
                {(users || []).map((u: any) => (
                  <tr key={u.id} className="border-t hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-medium">{u.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{u.email}</td>
                    <td className="px-4 py-2.5"><RoleBadge role={u.role} /></td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs">
                      {u.last_active_at ? format(new Date(u.last_active_at), "MMM d, yyyy h:mm a") : "Never"}
                    </td>
                  </tr>
                ))}
                {(!users || users.length === 0) && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground text-sm">No users found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Friction Feed */}
      <Card data-testid="card-friction-feed">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Friction Feed
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(!frictionItems || frictionItems.length === 0) ? (
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-5 w-5" />
              <p className="text-sm">No friction detected in last 30 days</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {frictionItems.map((item: any, i: number) => (
                <li key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/40">
                  {item.icon === "error"
                    ? <XCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                    : <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                  }
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.description}</p>
                    {item.ids && item.ids.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Claim IDs: {item.ids.slice(0, 3).join(", ")}{item.ids.length > 3 ? ` +${item.ids.length - 3} more` : ""}
                      </p>
                    )}
                    {item.timestamp && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {format(new Date(item.timestamp), "MMM d, yyyy")}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}
