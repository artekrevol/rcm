import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, Clock, CheckCircle2, XCircle, AlertTriangle, Calendar } from "lucide-react";
import { format, isPast, differenceInDays } from "date-fns";
import { useLocation } from "wouter";

interface PriorAuthRecord {
  id: string;
  encounter_id: string;
  patient_id: string;
  patient_name: string;
  payer_name: string;
  service_type: string;
  status: string;
  auth_number: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  denied_at: string | null;
  expiration_date: string | null;
  notes: string | null;
  created_at: string;
}

const statusConfig: Record<string, { icon: any; color: string; label: string }> = {
  pending: { icon: Clock, color: "bg-amber-500/10 text-amber-700", label: "Pending" },
  submitted: { icon: Clock, color: "bg-blue-500/10 text-blue-700", label: "Submitted" },
  approved: { icon: CheckCircle2, color: "bg-emerald-500/10 text-emerald-700", label: "Approved" },
  denied: { icon: XCircle, color: "bg-red-500/10 text-red-700", label: "Denied" },
  expired: { icon: AlertTriangle, color: "bg-gray-500/10 text-gray-700", label: "Expired" },
};

export default function PriorAuthPage() {
  const [, navigate] = useLocation();

  const { data: auths, isLoading } = useQuery<PriorAuthRecord[]>({
    queryKey: ["/api/billing/prior-auths"],
    queryFn: () => fetch("/api/billing/prior-auths", { credentials: "include" }).then(r => r.json()),
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Prior Authorizations</h1>
        <p className="text-muted-foreground text-sm">Track authorization status across all claims</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : !auths?.length ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Shield className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <h2 className="text-lg font-semibold" data-testid="text-empty">No prior authorizations found</h2>
            <p className="text-muted-foreground text-sm mt-1">Prior authorizations will appear here when created from claim details.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {auths.map((auth) => {
            const cfg = statusConfig[auth.status] || statusConfig.pending;
            const Icon = cfg.icon;
            const isExpiringSoon = auth.expiration_date && !isPast(new Date(auth.expiration_date)) && differenceInDays(new Date(auth.expiration_date), new Date()) <= 14;

            return (
              <Card key={auth.id} className="cursor-pointer hover:border-primary/30 transition-colors" onClick={() => auth.claim_id ? navigate(`/billing/claims/${auth.claim_id}`) : null} data-testid={`card-auth-${auth.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${cfg.color}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{auth.patient_name}</p>
                        <p className="text-xs text-muted-foreground">{auth.service_type} • {auth.payer_name}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isExpiringSoon && (
                        <Badge variant="destructive" className="text-[10px]">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          Expiring Soon
                        </Badge>
                      )}
                      <Badge className={`${cfg.color} border-0`}>{cfg.label}</Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 mt-3 text-xs text-muted-foreground">
                    {auth.auth_number && <span>Auth #: {auth.auth_number}</span>}
                    {auth.expiration_date && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Expires {format(new Date(auth.expiration_date), "MMM d, yyyy")}
                      </span>
                    )}
                    <span>Requested {format(new Date(auth.requested_date || auth.created_at), "MMM d, yyyy")}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
