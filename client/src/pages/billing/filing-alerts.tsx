import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertTriangle,
  XCircle,
  Clock,
  Info,
  CheckCircle2,
  ExternalLink,
  BellOff,
  RefreshCw,
  Loader2,
  AlarmClock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";

type AlertStatus = "critical" | "urgent" | "caution" | "expired";

interface FilingAlert {
  id: string;
  claim_id: string;
  alert_status: AlertStatus;
  days_remaining: number;
  deadline_date: string;
  alert_sent_at: string;
  snoozed_until: string | null;
  claim_status: string;
  service_date: string;
  amount: number | null;
  plan_product: string | null;
  patient_name: string;
  payer_name: string | null;
  payer_id: string | null;
  last_activity_at: string | null;
}

interface AlertsResponse {
  alerts: FilingAlert[];
  total: number;
  summary: Record<string, number>;
  page: number;
  pageSize: number;
}

const STATUS_CONFIG: Record<AlertStatus, {
  label: string;
  icon: typeof XCircle;
  headerClass: string;
  badgeClass: string;
  borderClass: string;
  description: string;
}> = {
  critical: {
    label: "CRITICAL",
    icon: XCircle,
    headerClass: "bg-red-600 text-white",
    badgeClass: "bg-red-600 text-white",
    borderClass: "border-red-300 dark:border-red-800",
    description: "≤ 7 days to deadline — immediate action required",
  },
  urgent: {
    label: "URGENT",
    icon: AlertTriangle,
    headerClass: "bg-amber-500 text-white",
    badgeClass: "bg-amber-500 text-white",
    borderClass: "border-amber-300 dark:border-amber-700",
    description: "8–30 days to deadline",
  },
  caution: {
    label: "CAUTION",
    icon: Clock,
    headerClass: "bg-blue-600 text-white",
    badgeClass: "bg-blue-600 text-white",
    borderClass: "border-blue-300 dark:border-blue-700",
    description: "31–60 days to deadline",
  },
  expired: {
    label: "EXPIRED",
    icon: XCircle,
    headerClass: "bg-gray-900 text-white",
    badgeClass: "bg-gray-900 text-white",
    borderClass: "border-gray-400 dark:border-gray-600",
    description: "Past filing deadline",
  },
};

const SEVERITY_ORDER: AlertStatus[] = ["critical", "urgent", "caution", "expired"];

export default function FilingAlertsPage() {
  const { toast } = useToast();
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterPayerId, setFilterPayerId] = useState<string>("");
  const [searchQ, setSearchQ] = useState("");

  const { data, isLoading, refetch, isFetching } = useQuery<AlertsResponse>({
    queryKey: ["/api/billing/filing-alerts", filterStatus, filterPayerId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterStatus && filterStatus !== "all") params.set("status", filterStatus);
      if (filterPayerId) params.set("payer_id", filterPayerId);
      const res = await fetch(`/api/billing/filing-alerts?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load alerts");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: async (alertId: string) => {
      await apiRequest("POST", `/api/billing/filing-alerts/${alertId}/acknowledge`, {});
    },
    onSuccess: () => {
      toast({ title: "Alert acknowledged" });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/filing-alerts"] });
    },
  });

  const snoozeMutation = useMutation({
    mutationFn: async (alertId: string) => {
      await apiRequest("POST", `/api/billing/filing-alerts/${alertId}/snooze`, { days: 7 });
    },
    onSuccess: () => {
      toast({ title: "Alert snoozed for 7 days" });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/filing-alerts"] });
    },
  });

  const alerts = data?.alerts || [];
  const summary = data?.summary || {};
  const total = data?.total || 0;

  const unacknowledgedTotal = Object.values(summary).reduce((a, b) => a + b, 0);

  // Filter by search
  const filtered = searchQ.trim()
    ? alerts.filter((a) =>
        a.patient_name?.toLowerCase().includes(searchQ.toLowerCase()) ||
        a.payer_name?.toLowerCase().includes(searchQ.toLowerCase()) ||
        a.claim_id?.toLowerCase().includes(searchQ.toLowerCase())
      )
    : alerts;

  // Group by status in severity order
  const grouped: Record<AlertStatus, FilingAlert[]> = {
    critical: [],
    urgent: [],
    caution: [],
    expired: [],
  };
  for (const alert of filtered) {
    if (grouped[alert.alert_status]) {
      grouped[alert.alert_status].push(alert);
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2" data-testid="text-page-title">
            <AlarmClock className="h-6 w-6" />
            Filing Alerts
            {unacknowledgedTotal > 0 && (
              <Badge className="bg-red-600 text-white ml-2" data-testid="badge-total-alerts">
                {unacknowledgedTotal}
              </Badge>
            )}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Claims approaching or past their payer timely filing deadline
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          data-testid="button-refresh"
        >
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="ml-1.5">Refresh</span>
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {SEVERITY_ORDER.map((status) => {
          const cfg = STATUS_CONFIG[status];
          const cnt = summary[status] || 0;
          return (
            <button
              key={status}
              className={`rounded-lg p-3 text-left border-2 transition-all ${
                filterStatus === status ? cfg.borderClass + " ring-2 ring-offset-1 ring-current" : "border-transparent bg-muted/50"
              }`}
              onClick={() => setFilterStatus(filterStatus === status ? "all" : status)}
              data-testid={`card-summary-${status}`}
            >
              <p className={`text-xs font-semibold uppercase tracking-wider ${
                status === "critical" ? "text-red-600" :
                status === "urgent" ? "text-amber-600" :
                status === "caution" ? "text-blue-600" : "text-gray-600"
              }`}>{cfg.label}</p>
              <p className="text-3xl font-bold mt-0.5">{cnt}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{cfg.description}</p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Input
          placeholder="Search patient, payer, claim ID..."
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          className="max-w-xs"
          data-testid="input-search"
        />
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
            <SelectItem value="caution">Caution</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>
        {(filterStatus !== "all" || searchQ) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setFilterStatus("all"); setSearchQ(""); }}
            data-testid="button-clear-filters"
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Alert List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card data-testid="card-empty-state">
          <CardContent className="py-16 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3" />
            <p className="font-semibold text-lg">All clear!</p>
            <p className="text-muted-foreground text-sm mt-1">
              {searchQ || filterStatus !== "all"
                ? "No alerts match your current filters."
                : "No unacknowledged timely filing alerts. The guardian hasn't surfaced any risks."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8" data-testid="list-alert-groups">
          {SEVERITY_ORDER.map((status) => {
            const group = grouped[status];
            if (group.length === 0) return null;
            const cfg = STATUS_CONFIG[status];
            const Icon = cfg.icon;
            return (
              <div key={status} data-testid={`section-${status}`}>
                {/* Section Header */}
                <div className={`rounded-t-lg px-4 py-2.5 flex items-center gap-2 ${cfg.headerClass}`}>
                  <Icon className="h-4 w-4" />
                  <span className="font-semibold text-sm uppercase tracking-wider">
                    {cfg.label} — {group.length} claim{group.length !== 1 ? "s" : ""}
                  </span>
                  <span className="ml-auto text-xs opacity-80">{cfg.description}</span>
                </div>

                {/* Alert Rows */}
                <div className={`border-2 rounded-b-lg divide-y ${cfg.borderClass}`}>
                  {group.map((alert, i) => (
                    <div
                      key={alert.id}
                      className="p-4 hover:bg-muted/30 transition-colors"
                      data-testid={`alert-row-${status}-${i}`}
                    >
                      <div className="flex items-start gap-4 flex-wrap">
                        {/* Left: claim info */}
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm" data-testid={`text-patient-${i}`}>
                              {alert.patient_name || "Unknown Patient"}
                            </span>
                            <Badge variant="outline" className="text-[10px]">
                              {alert.claim_status}
                            </Badge>
                            {alert.plan_product && (
                              <Badge variant="outline" className="text-[10px]">{alert.plan_product}</Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                            <span>{alert.payer_name || "Unknown Payer"}</span>
                            {alert.service_date && (
                              <span>Service: {format(new Date(alert.service_date), "MMM d, yyyy")}</span>
                            )}
                            {alert.amount != null && (
                              <span>${alert.amount.toFixed(2)}</span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                            <span>
                              Deadline:{" "}
                              <strong className={
                                status === "critical" ? "text-red-600" :
                                status === "urgent" ? "text-amber-600" :
                                status === "expired" ? "text-gray-900 dark:text-gray-100" : "text-blue-600"
                              }>
                                {format(new Date(alert.deadline_date), "MMM d, yyyy")}
                              </strong>
                            </span>
                            <span className={`font-semibold ${
                              status === "expired" ? "text-gray-700 dark:text-gray-300" :
                              status === "critical" ? "text-red-600" :
                              status === "urgent" ? "text-amber-600" : "text-blue-600"
                            }`}>
                              {status === "expired"
                                ? `${Math.abs(alert.days_remaining)} days overdue`
                                : `${alert.days_remaining} days remaining`}
                            </span>
                            {alert.last_activity_at && (
                              <span className="text-muted-foreground">
                                Last activity {formatDistanceToNow(new Date(alert.last_activity_at), { addSuffix: true })}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Right: actions */}
                        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                          <Link href={`/billing/claims/${alert.claim_id}`}>
                            <Button
                              size="sm"
                              className={status === "critical" ? "bg-red-600 hover:bg-red-700" : ""}
                              data-testid={`button-take-action-${i}`}
                            >
                              <ExternalLink className="h-3.5 w-3.5 mr-1" />
                              Take Action
                            </Button>
                          </Link>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => snoozeMutation.mutate(alert.id)}
                            disabled={snoozeMutation.isPending}
                            data-testid={`button-snooze-${i}`}
                            title="Snooze for 7 days"
                          >
                            <BellOff className="h-3.5 w-3.5 mr-1" />
                            Snooze 7d
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => acknowledgeMutation.mutate(alert.id)}
                            disabled={acknowledgeMutation.isPending}
                            data-testid={`button-acknowledge-${i}`}
                            title="Acknowledge this alert"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                            Acknowledge
                          </Button>
                        </div>
                      </div>

                      {/* Expired — special actions */}
                      {status === "expired" && (
                        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 flex gap-2 flex-wrap">
                          <Button size="sm" variant="outline" className="text-xs">
                            Mark as Written Off
                          </Button>
                          <Button size="sm" variant="outline" className="text-xs">
                            File Late with Cause Documentation
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer info */}
      <p className="text-xs text-muted-foreground" data-testid="text-total-count">
        Showing {filtered.length} of {total} unacknowledged alert{total !== 1 ? "s" : ""}.
        The Guardian evaluates active claims daily at 6 AM UTC.
      </p>
    </div>
  );
}
