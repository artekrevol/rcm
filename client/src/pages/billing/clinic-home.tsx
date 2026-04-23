import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { format } from "date-fns";
import {
  Building2, Users, CheckCircle2, XCircle, ExternalLink, Shield, FileText, CreditCard, ClipboardList, Settings
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";

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

function EditRoleDialog({ user, onSuccess }: { user: any; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(user.role);
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/admin/users/${user.id}`, { role }),
    onSuccess: () => {
      toast({ title: "Role updated" });
      setOpen(false);
      onSuccess();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 text-xs" data-testid={`button-edit-role-${user.id}`}>
          Edit Role
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>Change Role</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <p className="text-sm font-medium mb-1">{user.name}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger data-testid="select-role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="rcm_manager">RCM Manager</SelectItem>
              <SelectItem value="intake">Intake</SelectItem>
            </SelectContent>
          </Select>
          <Button
            className="w-full"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || role === user.role}
            data-testid="button-save-role"
          >
            {mutation.isPending ? "Saving..." : "Save Role"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ClinicHome() {
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: ps } = useQuery<any>({ queryKey: ["/api/billing/practice-settings"] });
  const { data: users = [] } = useQuery<any[]>({ queryKey: ["/api/admin/users"] });
  const { data: checklist } = useQuery<any>({ queryKey: ["/api/billing/onboarding-checklist"] });
  const { data: stats } = useQuery<any>({ queryKey: ["/api/billing/clinic/stats"] });
  const { data: stediStatus } = useQuery<any>({ queryKey: ["/api/billing/stedi/status"] });

  const oaConnected = !!(ps?.oa_connected && ps?.oa_sftp_username);
  const stediConnected = stediStatus?.configured === true;

  const steps = checklist?.steps ?? [];
  const SETUP_STEPS = [
    { label: "Practice information configured", done: steps[0]?.done ?? false, link: "/billing/settings?tab=practice" },
    { label: "At least one provider added", done: steps[1]?.done ?? false, link: "/billing/settings?tab=providers" },
    { label: "At least one payer in the system", done: steps[2]?.done ?? false, link: "/billing/settings?tab=payers" },
    { label: "Clearinghouse connected", done: steps[3]?.done ?? false, link: "/billing/settings?tab=clearinghouse" },
    { label: "Claim defaults saved", done: steps[4]?.done ?? false, link: "/billing/settings?tab=claim-defaults" },
    { label: "First claim created", done: steps[5]?.done ?? false, link: "/billing/claims/new" },
  ];

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-clinic-home-title">My Practice</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Your clinic's command center</p>
        </div>
        <Link href="/billing/settings">
          <Button variant="outline" size="sm" className="gap-1.5" data-testid="button-edit-practice">
            <Settings className="h-4 w-4" />
            Edit Settings
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Practice Profile */}
        <Card data-testid="card-practice-profile">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Practice Profile
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Practice Name" value={ps?.practice_name || "—"} />
            <Row label="Primary NPI" value={ps?.primary_npi || "—"} />
            <Row label="Tax ID" value={ps?.tax_id || "—"} />
            <Row label="Address" value={
              ps?.address
                ? `${ps.address.street || ""}, ${ps.address.city || ""}, ${ps.address.state || ""} ${ps.address.zip || ""}`.replace(/^,\s*/, "").trim() || "—"
                : "—"
            } />
            <Row label="Phone" value={ps?.phone || "—"} />
            <Row label="Default Place of Service" value={ps?.default_pos || "—"} />
            <div className="flex items-center justify-between py-1">
              <span className="text-muted-foreground">Clearinghouse</span>
              {stediConnected
                ? <Badge className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">✓ Connected to Stedi</Badge>
                : oaConnected
                  ? <Badge className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">✓ Connected to Office Ally</Badge>
                  : (
                    <Link href="/billing/settings?tab=clearinghouse">
                      <Badge variant="destructive" className="text-xs cursor-pointer">⚠ Not Configured</Badge>
                    </Link>
                  )
              }
            </div>
          </CardContent>
        </Card>

        {/* Clinic Setup Health */}
        <Card data-testid="card-setup-health">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Clinic Setup Health
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5">
              {SETUP_STEPS.map((step, i) => (
                <li key={i} className="flex items-center gap-3">
                  {step.done
                    ? <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                    : <XCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
                  }
                  <span className={`text-sm flex-1 ${step.done ? "" : "text-muted-foreground"}`}>{step.label}</span>
                  {!step.done && (
                    <Link href={step.link}>
                      <Button variant="ghost" size="sm" className="h-6 text-xs px-2 text-primary">
                        Fix This
                        <ExternalLink className="h-3 w-3 ml-1" />
                      </Button>
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Quick Stats */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Quick Stats (Last 30 Days)</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Claims Submitted", value: stats?.claimsSubmitted ?? "—", icon: FileText, testid: "stat-submitted" },
            { label: "Claims Paid", value: stats?.claimsPaid ?? "—", icon: CreditCard, testid: "stat-paid" },
            { label: "Active Follow-Ups", value: stats?.activeFollowups ?? "—", icon: ClipboardList, testid: "stat-followups" },
            { label: "Open Denials", value: stats?.openDenials ?? "—", icon: XCircle, testid: "stat-denials" },
          ].map(({ label, value, icon: Icon, testid }) => (
            <Card key={label} data-testid={`card-${testid}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
                <p className="text-2xl font-semibold">{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Team */}
      <Card data-testid="card-team">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Team ({users.length})
            </CardTitle>
            <Link href="/billing/settings/users">
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" data-testid="button-invite-user">
                Invite New User
              </Button>
            </Link>
          </div>
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
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u: any) => (
                  <tr key={u.id} className="border-t hover:bg-muted/20" data-testid={`row-team-${u.id}`}>
                    <td className="px-4 py-2.5 font-medium">{u.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{u.email}</td>
                    <td className="px-4 py-2.5"><RoleBadge role={u.role} /></td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs">
                      {u.last_active_at ? format(new Date(u.last_active_at), "MMM d, yyyy") : "Never"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {u.id !== user?.id && (
                        <EditRoleDialog
                          user={u}
                          onSuccess={() => queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] })}
                        />
                      )}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No users found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between py-1 gap-4">
      <span className="text-muted-foreground flex-shrink-0">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}
