import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AdminLayout } from "@/components/admin-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, CheckCircle2, Clock, AlertTriangle, XCircle, Shield, BookOpen, Users, BarChart3, RefreshCw, Filter, Trophy, Database, DollarSign, MapPin, Activity } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const SECTION_LABELS: Record<string, string> = {
  timely_filing: "Timely Filing",
  prior_auth: "Prior Auth",
  modifiers: "Modifiers",
  appeals: "Appeals",
  cci: "CCI Edits",
};

const SECTION_COLORS: Record<string, string> = {
  timely_filing: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  prior_auth: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  modifiers: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  appeals: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  cci: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

const CHANGE_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  approved: { label: "Approved", color: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
  edited: { label: "Edited", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
  data_corrected: { label: "Data Corrected", color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300" },
  reopened: { label: "Reopened", color: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  needs_reverification: { label: "Needs Reverification", color: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300" },
  created: { label: "Created", color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
};

function freshnessColor(days: number | null) {
  if (days == null) return "text-muted-foreground";
  if (days <= 90) return "text-green-700 dark:text-green-400";
  if (days <= 180) return "text-amber-700 dark:text-amber-400";
  return "text-red-700 dark:text-red-400";
}

function freshnessBg(days: number | null) {
  if (days == null) return "bg-muted/40";
  if (days <= 90) return "bg-green-50 dark:bg-green-950/20";
  if (days <= 180) return "bg-amber-50 dark:bg-amber-950/20";
  return "bg-red-50 dark:bg-red-950/20";
}

export default function RulesDatabasePage() {
  const { toast } = useToast();
  const [historyUser, setHistoryUser] = useState("");
  const [historyPayer, setHistoryPayer] = useState("");
  const [historyType, setHistoryType] = useState("");
  const [ingestLog, setIngestLog] = useState<string[]>([]);
  const [ingestRunning, setIngestRunning] = useState(false);
  const ingestLogRef = useRef<HTMLDivElement>(null);

  const { data: overview, isLoading: overviewLoading } = useQuery<any>({
    queryKey: ["/api/admin/rules-database/overview"],
    queryFn: async () => {
      const res = await fetch("/api/admin/rules-database/overview", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: freshness = [], isLoading: freshnessLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/rules-database/freshness"],
    queryFn: async () => {
      const res = await fetch("/api/admin/rules-database/freshness", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const historyParams = new URLSearchParams();
  if (historyUser) historyParams.set("user", historyUser);
  if (historyPayer) historyParams.set("payer", historyPayer);
  if (historyType) historyParams.set("change_type", historyType);

  const { data: history = [], isLoading: historyLoading, refetch: refetchHistory } = useQuery<any[]>({
    queryKey: ["/api/admin/rules-database/history", historyUser, historyPayer, historyType],
    queryFn: async () => {
      const res = await fetch(`/api/admin/rules-database/history?${historyParams}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: leaderboard = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/rules-database/leaderboard"],
    queryFn: async () => {
      const res = await fetch("/api/admin/rules-database/leaderboard", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: rateCoverage, isLoading: rateCoverageLoading, refetch: refetchRateCoverage } = useQuery<any>({
    queryKey: ["/api/admin/rate-coverage"],
    queryFn: async () => {
      const res = await fetch("/api/admin/rate-coverage", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    retry: false,
  });

  const { data: cmsConflicts = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/rules-database/cms-conflicts"],
    queryFn: async () => {
      const res = await fetch("/api/admin/rules-database/cms-conflicts", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const reverifyMutation = useMutation({
    mutationFn: (itemId: string) => apiRequest("PATCH", `/api/admin/extraction-items/${itemId}/reverify`, {}),
    onSuccess: () => {
      toast({ title: "Rule flagged for re-verification" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/rules-database"] });
    },
  });

  const sectionTypeCounts: Record<string, number> = {};
  (overview?.bySectionType || []).forEach((r: any) => { sectionTypeCounts[r.section_type] = r.cnt; });

  return (
    <AdminLayout>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="heading-rules-database">
            <Shield className="h-6 w-6 text-primary" />
            Rules Database
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Versioned, auditable payer rules extracted from provider manuals and CMS data.
          </p>
        </div>

        {/* A. Overview Cards */}
        {overviewLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Card data-testid="card-total-approved">
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground">Total Approved Rules</p>
                  <p className="text-3xl font-bold mt-1">{overview?.totalApproved ?? 0}</p>
                  <p className="text-xs text-muted-foreground mt-1">across all payers & types</p>
                </CardContent>
              </Card>
              <Card data-testid="card-pending-count">
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground">Pending Review</p>
                  <p className="text-3xl font-bold mt-1 text-amber-600">{overview?.pendingCount ?? 0}</p>
                  <p className="text-xs text-muted-foreground mt-1">awaiting reviewer action</p>
                </CardContent>
              </Card>
              <Card data-testid="card-coverage-pct">
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground">Top-20 Payer Coverage</p>
                  <p className="text-3xl font-bold mt-1 text-primary">{overview?.coveragePct ?? 0}%</p>
                  <p className="text-xs text-muted-foreground mt-1">{overview?.coveredPayers}/{overview?.totalTopPayers} payers with ≥1 rule</p>
                </CardContent>
              </Card>
              <Card data-testid="card-recent-changes">
                <CardContent className="pt-4 pb-4">
                  <p className="text-xs text-muted-foreground">Changed (Last 7 Days)</p>
                  <p className="text-3xl font-bold mt-1 text-green-600">{overview?.recentChanges ?? 0}</p>
                  <p className="text-xs text-muted-foreground mt-1">new or updated rules</p>
                </CardContent>
              </Card>
            </div>

            {/* Section Type Breakdown */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Rules by Section Type</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(SECTION_LABELS).map(([key, label]) => (
                    <div key={key} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-card" data-testid={`section-count-${key}`}>
                      <span className={`inline-block w-2 h-2 rounded-full ${
                        key === "timely_filing" ? "bg-blue-500" :
                        key === "prior_auth" ? "bg-purple-500" :
                        key === "modifiers" ? "bg-amber-500" :
                        key === "appeals" ? "bg-orange-500" : "bg-red-500"
                      }`} />
                      <span className="text-xs font-medium">{label}</span>
                      <span className="text-xs text-muted-foreground ml-1">({sectionTypeCounts[key] ?? 0})</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-card">
                    <span className="inline-block w-2 h-2 rounded-full bg-gray-500" />
                    <span className="text-xs font-medium">NCCI CCI Edits</span>
                    <span className="text-xs text-muted-foreground ml-1">({overview?.ncciTotalEdits?.toLocaleString() ?? 0})</span>
                    {overview?.ncciVersion && (
                      <Badge className="text-[10px] py-0 ml-1">{overview.ncciVersion}</Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {/* B. Rule Freshness Table */}
        <Card data-testid="card-freshness-table">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Rule Freshness
            </CardTitle>
            <CardDescription className="text-xs">
              Color key: <span className="text-green-700 dark:text-green-400">Green</span> = verified within 90 days,{" "}
              <span className="text-amber-700 dark:text-amber-400">Amber</span> = 90–180 days,{" "}
              <span className="text-red-700 dark:text-red-400">Red</span> = over 180 days
            </CardDescription>
          </CardHeader>
          <CardContent>
            {freshnessLoading ? (
              <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : freshness.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No approved rules on file yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Payer</th>
                      <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Section</th>
                      <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Last Verified</th>
                      <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Days Since</th>
                      <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">Rules</th>
                      <th className="text-left py-2 text-xs font-medium text-muted-foreground">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {freshness.map((row: any, i: number) => (
                      <tr key={i} className={`border-b last:border-0 ${freshnessBg(row.days_since)}`} data-testid={`row-freshness-${i}`}>
                        <td className="py-2 pr-4 font-medium">{row.payer_name || "Unknown"}</td>
                        <td className="py-2 pr-4">
                          <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${SECTION_COLORS[row.section_type] || "bg-muted text-muted-foreground"}`}>
                            {SECTION_LABELS[row.section_type] || row.section_type}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-xs text-muted-foreground">
                          {row.last_verified ? format(new Date(row.last_verified), "MMM d, yyyy") : "Never"}
                        </td>
                        <td className={`py-2 pr-4 text-xs font-semibold ${freshnessColor(row.days_since)}`}>
                          {row.days_since != null ? `${row.days_since}d ago` : "Unknown"}
                        </td>
                        <td className="py-2 pr-4 text-xs">{row.approved_count}</td>
                        <td className="py-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-[11px] text-muted-foreground hover:text-foreground"
                            onClick={() => window.location.href = "/admin/payer-manuals"}
                            data-testid={`button-view-freshness-${i}`}
                          >
                            Review
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* C. Rule Activity Log */}
        <Card data-testid="card-activity-log">
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Rule Activity Log
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={() => refetchHistory()} data-testid="button-refresh-history">
                <RefreshCw className="h-3 w-3 mr-1" />Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Filters */}
            <div className="flex flex-wrap gap-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Filter className="h-3 w-3" />Filter:</div>
              <Input
                placeholder="User email..."
                value={historyUser}
                onChange={(e) => setHistoryUser(e.target.value)}
                className="h-7 text-xs w-36"
                data-testid="input-filter-user"
              />
              <Input
                placeholder="Payer name..."
                value={historyPayer}
                onChange={(e) => setHistoryPayer(e.target.value)}
                className="h-7 text-xs w-36"
                data-testid="input-filter-payer"
              />
              <select
                value={historyType}
                onChange={(e) => setHistoryType(e.target.value)}
                className="h-7 text-xs border border-input rounded px-2 bg-background"
                data-testid="select-filter-type"
              >
                <option value="">All types</option>
                {Object.keys(CHANGE_TYPE_CONFIG).map((t) => (
                  <option key={t} value={t}>{CHANGE_TYPE_CONFIG[t].label}</option>
                ))}
              </select>
            </div>

            {historyLoading ? (
              <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : history.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground" data-testid="empty-history">
                No rule changes recorded yet. Changes appear here as rules are approved or edited.
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {history.map((row: any) => {
                  const cfg = CHANGE_TYPE_CONFIG[row.change_type] || { label: row.change_type, color: "bg-muted text-muted-foreground" };
                  return (
                    <div key={row.id} className="flex items-start gap-3 py-2 border-b last:border-0" data-testid={`history-row-${row.id}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${cfg.color}`}>{cfg.label}</span>
                          {row.payer_name && <span className="text-xs font-medium">{row.payer_name}</span>}
                          {row.section_type && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${SECTION_COLORS[row.section_type] || "bg-muted text-muted-foreground"}`}>
                              {SECTION_LABELS[row.section_type] || row.section_type}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">by {row.changed_by}</p>
                        {row.change_notes && <p className="text-xs text-muted-foreground italic mt-0.5">"{row.change_notes}"</p>}
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap" title={row.changed_at ? format(new Date(row.changed_at), "PPpp") : ""}>
                        {row.changed_at ? formatDistanceToNow(new Date(row.changed_at), { addSuffix: true }) : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* D. Leaderboard */}
          <Card data-testid="card-leaderboard">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-500" />
                Top Contributors
              </CardTitle>
              <CardDescription className="text-xs">Rules approved and edited per reviewer</CardDescription>
            </CardHeader>
            <CardContent>
              {leaderboard.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No activity recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {leaderboard.map((row: any, i: number) => (
                    <div key={row.user_email} className={`flex items-center gap-3 py-2 ${i < 3 ? "border-b" : ""}`} data-testid={`leaderboard-row-${i}`}>
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        i === 0 ? "bg-amber-100 text-amber-700" :
                        i === 1 ? "bg-gray-100 text-gray-600" :
                        i === 2 ? "bg-orange-100 text-orange-700" : "bg-muted text-muted-foreground"
                      }`}>
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{row.user_email}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.rules_approved} approved · {row.rules_edited} edited
                          {row.last_activity && ` · Last: ${format(new Date(row.last_activity), "MMM d")}`}
                        </p>
                      </div>
                      <Badge className="text-[11px]">{row.rules_approved} rules</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* E. CMS Validation Panel */}
          <Card data-testid="card-cms-conflicts">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                CMS Validation Issues
              </CardTitle>
              <CardDescription className="text-xs">Approved rules with values outside expected CMS reference ranges</CardDescription>
            </CardHeader>
            <CardContent>
              {cmsConflicts.length === 0 ? (
                <div className="py-6 text-center" data-testid="empty-cms-conflicts">
                  <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No conflicts detected — all approved timely filing rules are within the 60–365 day CMS range.</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[280px] overflow-y-auto">
                  {cmsConflicts.map((row: any) => (
                    <div key={row.item_id} className="flex items-center gap-2 py-1.5 border-b last:border-0" data-testid={`cms-conflict-${row.item_id}`}>
                      <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium">{row.payer_name}</p>
                        <p className="text-xs text-muted-foreground">Timely filing: {row.extracted_days} days (expected 60–365)</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[11px]"
                        onClick={() => reverifyMutation.mutate(row.item_id)}
                        data-testid={`button-flag-conflict-${row.item_id}`}
                      >
                        Flag
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Rate Reference Data Coverage (Task 9) ───────────────────────── */}
        <div className="mt-6 space-y-4" data-testid="section-rate-coverage">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-600" />
              Reimbursement Reference Data
            </h3>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchRateCoverage()}
                disabled={rateCoverageLoading}
                data-testid="button-refresh-rate-coverage"
              >
                <RefreshCw className={`h-3 w-3 mr-1 ${rateCoverageLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button
                size="sm"
                disabled={ingestRunning}
                data-testid="button-run-rate-ingest"
                onClick={async () => {
                  setIngestLog([]);
                  setIngestRunning(true);
                  try {
                    const resp = await fetch("/api/admin/rate-ingest", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      credentials: "include",
                      body: JSON.stringify({ cms: true, va: true, localityOnly: true }),
                    });
                    const reader = resp.body!.getReader();
                    const decoder = new TextDecoder();
                    while (true) {
                      const { done, value } = await reader.read();
                      if (done) break;
                      const text = decoder.decode(value);
                      for (const line of text.split("\n")) {
                        if (line.startsWith("data: ")) {
                          try {
                            const parsed = JSON.parse(line.slice(6));
                            if (parsed.msg) setIngestLog((prev) => [...prev, parsed.msg]);
                            if (parsed.done) { refetchRateCoverage(); }
                          } catch {}
                        }
                      }
                      if (ingestLogRef.current) ingestLogRef.current.scrollTop = ingestLogRef.current.scrollHeight;
                    }
                  } catch (e: any) {
                    setIngestLog((prev) => [...prev, `Error: ${e.message}`]);
                  } finally {
                    setIngestRunning(false);
                  }
                }}
              >
                {ingestRunning ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Database className="h-3 w-3 mr-1" />}
                {ingestRunning ? "Ingesting..." : "Run Ingest"}
              </Button>
            </div>
          </div>

          {/* Coverage stat tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "PFS RVU Codes", key: "pfs", icon: <Activity className="h-4 w-4 text-blue-500" />, desc: "Medicare Physician Fee Schedule" },
              { label: "GPCI Localities", key: "gpci", icon: <MapPin className="h-4 w-4 text-purple-500" />, desc: "Geographic Practice Cost Indices" },
              { label: "Locality-County", key: "locco", icon: <MapPin className="h-4 w-4 text-indigo-500" />, desc: "County-to-locality mapping" },
              { label: "VA Fee Schedule", key: "vafs", icon: <Shield className="h-4 w-4 text-green-500" />, desc: "VA Community Care rates" },
            ].map(({ label, key, icon, desc }) => {
              const d = rateCoverage?.[key];
              return (
                <Card key={key} data-testid={`card-rate-coverage-${key}`}>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-2 mb-1">
                      {icon}
                      <span className="text-xs font-medium text-muted-foreground">{label}</span>
                    </div>
                    {rateCoverageLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : d ? (
                      <>
                        <p className="text-2xl font-bold">{(d.rows ?? 0).toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">{desc}{d.year ? ` · ${d.year}` : ""}</p>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">Not loaded</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Chajinel locality + sample calcs */}
          {rateCoverage && (rateCoverage.pfs?.rows > 0 || rateCoverage.vafs?.rows > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card data-testid="card-chajinel-locality">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Chajinel — Resolved Locality
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {rateCoverage.chajinel?.localityCode ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">MAC Carrier</span>
                        <span className="font-mono font-medium">{rateCoverage.chajinel.macCarrier}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Locality Code</span>
                        <span className="font-mono font-medium">{rateCoverage.chajinel.localityCode}</span>
                      </div>
                      {rateCoverage.chajinel.localityName && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Locality Name</span>
                          <span className="text-right text-xs max-w-[180px] leading-tight">{rateCoverage.chajinel.localityName.split("(")[0].trim()}</span>
                        </div>
                      )}
                      <Badge variant="secondary" className="text-xs">San Mateo County → SF Locality</Badge>
                    </>
                  ) : (
                    <p className="text-muted-foreground text-xs">Run CMS ingest to resolve locality</p>
                  )}
                </CardContent>
              </Card>

              <Card data-testid="card-sample-calcs">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Sample Expected Payments (Chajinel / SF)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {rateCoverage.sampleCalcs?.length > 0 ? (
                    <div className="space-y-1.5">
                      {rateCoverage.sampleCalcs.map((s: any) => (
                        <div key={s.code} className="flex items-center justify-between text-xs" data-testid={`rate-sample-${s.code}`}>
                          <span className="font-mono font-medium">{s.code}</span>
                          {s.result.expected_amount !== null ? (
                            <span className="text-green-700 dark:text-green-400 font-medium">${s.result.expected_amount.toFixed(2)}</span>
                          ) : (
                            <span className="text-muted-foreground">No rate</span>
                          )}
                          <span className="text-[10px] text-muted-foreground max-w-[120px] truncate text-right">
                            {s.result.rate_source === "medicare_pfs" ? "Medicare PFS" : s.result.rate_source === "va_fee_schedule" ? "VA FS" : "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-xs">Run ingest to see sample calculations</p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Ingest log */}
          {ingestLog.length > 0 && (
            <Card data-testid="card-ingest-log">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Ingest Log</CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  ref={ingestLogRef}
                  className="bg-muted/60 rounded p-3 text-xs font-mono space-y-0.5 max-h-48 overflow-y-auto"
                  data-testid="ingest-log-output"
                >
                  {ingestLog.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                  {ingestRunning && <div className="text-muted-foreground animate-pulse">Running…</div>}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
