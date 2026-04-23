import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  LineChart, Line,
} from "recharts";
import { Download, FileBarChart, TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react";
import { format, subDays, parseISO } from "date-fns";

function exportCSV(rows: Record<string, any>[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? "")).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function fmt$(n: number) { return `$${(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtPct(n: number) { return `${(n || 0).toFixed(1)}%`; }

interface Filters {
  startDate: string;
  endDate: string;
  payerId: string;
  providerId: string;
}

function FilterBar({ filters, setFilters }: { filters: Filters; setFilters: (f: Filters) => void }) {
  const { data: payers = [] } = useQuery<any[]>({ queryKey: ["/api/payers"] });
  const { data: providers = [] } = useQuery<any[]>({ queryKey: ["/api/billing/providers"] });

  return (
    <div className="flex flex-wrap gap-3 items-end bg-muted/30 rounded-lg p-3 border">
      <div className="space-y-1">
        <Label className="text-xs">From</Label>
        <Input type="date" className="h-8 text-sm w-36" value={filters.startDate}
          onChange={(e) => setFilters({ ...filters, startDate: e.target.value })} data-testid="input-report-start-date" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">To</Label>
        <Input type="date" className="h-8 text-sm w-36" value={filters.endDate}
          onChange={(e) => setFilters({ ...filters, endDate: e.target.value })} data-testid="input-report-end-date" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Payer</Label>
        <Select value={filters.payerId} onValueChange={(v) => setFilters({ ...filters, payerId: v })}>
          <SelectTrigger className="h-8 text-sm w-44" data-testid="select-report-payer">
            <SelectValue placeholder="All payers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All payers</SelectItem>
            {payers.map((p: any) => <SelectItem key={p.payer_id || p.id} value={p.payer_id || p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Provider</Label>
        <Select value={filters.providerId} onValueChange={(v) => setFilters({ ...filters, providerId: v })}>
          <SelectTrigger className="h-8 text-sm w-44" data-testid="select-report-provider">
            <SelectValue placeholder="All providers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All providers</SelectItem>
            {providers.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.first_name} {p.last_name}, {p.credentials}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function agingBucket(days: number) {
  if (days <= 30) return "0–30";
  if (days <= 60) return "31–60";
  if (days <= 90) return "61–90";
  return "90+";
}

const BUCKET_ORDER = ["0–30", "31–60", "61–90", "90+"];

function ARAgingReport({ filters }: { filters: Filters }) {
  const params = new URLSearchParams();
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  if (filters.payerId !== "all") params.set("payerId", filters.payerId);
  if (filters.providerId !== "all") params.set("providerId", filters.providerId);

  const { data, isLoading } = useQuery<any[]>({
    queryKey: ["/api/billing/reports/ar-aging", params.toString()],
    queryFn: () => fetch(`/api/billing/reports/ar-aging?${params}`, { credentials: "include" }).then(r => r.json()),
  });

  const rows = Array.isArray(data) ? data : [];

  const bucketSummary = useMemo(() => {
    const map: Record<string, { count: number; amount: number }> = {};
    for (const b of BUCKET_ORDER) map[b] = { count: 0, amount: 0 };
    for (const r of rows) {
      const b = agingBucket(r.days_outstanding || 0);
      map[b].count++;
      map[b].amount += r.billed_amount || 0;
    }
    return map;
  }, [rows]);

  const sortedRows = useMemo(() => [...rows].sort((a, b) => (b.days_outstanding || 0) - (a.days_outstanding || 0)), [rows]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Outstanding claims not yet paid — sorted by days outstanding descending</p>
        <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => exportCSV(sortedRows.map(r => ({
          "Patient": r.patient_name, "Payer": r.payer, "Claim ID": r.claim_id?.slice(0, 8),
          "DOS": r.dos ? format(parseISO(r.dos), "MM/dd/yyyy") : "", "Billed": r.billed_amount,
          "Days Outstanding": r.days_outstanding, "Status": r.status, "Follow-Up Date": r.follow_up_date || ""
        })), "ar-aging.csv")} data-testid="button-export-ar-aging">
          <Download className="h-3 w-3" /> Export CSV
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {BUCKET_ORDER.map((b) => (
          <Card key={b} className={b === "90+" ? "border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-950/20" : ""}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground font-medium">{b} Days</p>
              <p className="text-xl font-bold mt-0.5">{fmt$(bucketSummary[b].amount)}</p>
              <p className="text-xs text-muted-foreground">{bucketSummary[b].count} claim{bucketSummary[b].count !== 1 ? "s" : ""}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="font-medium">No outstanding claims</p>
          <p className="text-sm mt-1">All claims in this period have been resolved.</p>
        </CardContent></Card>
      ) : (
        <div className="border rounded-lg overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Payer</TableHead>
                <TableHead>Claim ID</TableHead>
                <TableHead>DOS</TableHead>
                <TableHead className="text-right">Billed</TableHead>
                <TableHead className="text-right">Days Out</TableHead>
                <TableHead>Bucket</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Follow-Up</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((r, i) => {
                const days = r.days_outstanding || 0;
                const bucket = agingBucket(days);
                return (
                  <TableRow key={r.claim_id || i} data-testid={`row-ar-${r.claim_id?.slice(0, 8)}`}>
                    <TableCell className="font-medium">{r.patient_name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{r.payer || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.claim_id?.slice(0, 8)}</TableCell>
                    <TableCell>{r.dos ? format(parseISO(r.dos), "MM/dd/yy") : "—"}</TableCell>
                    <TableCell className="text-right">{fmt$(r.billed_amount)}</TableCell>
                    <TableCell className="text-right font-medium">{days}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={bucket === "90+" ? "border-red-300 text-red-700 dark:text-red-400" : bucket === "61–90" ? "border-orange-300 text-orange-700" : ""}>{bucket}</Badge>
                    </TableCell>
                    <TableCell><Badge variant="secondary" className="capitalize text-xs">{r.status}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.follow_up_date ? format(parseISO(r.follow_up_date), "MM/dd/yy") : "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function DenialAnalysisReport({ filters }: { filters: Filters }) {
  const params = new URLSearchParams();
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  if (filters.payerId !== "all") params.set("payerId", filters.payerId);
  if (filters.providerId !== "all") params.set("providerId", filters.providerId);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/billing/reports/denial-analysis", params.toString()],
    queryFn: () => fetch(`/api/billing/reports/denial-analysis?${params}`, { credentials: "include" }).then(r => r.json()),
  });

  const payerRows: any[] = data?.byPayer || [];
  const reasonRows: any[] = data?.byReason || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Denial patterns by payer and CARC code</p>
        <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => exportCSV(payerRows.map(r => ({
          "Payer": r.payer, "Submitted": r.total_submitted, "Denied": r.total_denied,
          "Denial Rate %": r.denial_rate?.toFixed(1), "Top Denial Reason": r.top_denial_reason,
          "Avg Days to Denial": r.avg_days_to_denial?.toFixed(0)
        })), "denial-analysis.csv")} data-testid="button-export-denials">
          <Download className="h-3 w-3" /> Export CSV
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : payerRows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="font-medium">No denials found in this period</p>
        </CardContent></Card>
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">Denial Rate by Payer</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={payerRows} margin={{ top: 4, right: 16, left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="payer" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v: any) => `${Number(v).toFixed(1)}%`} />
                  <Bar dataKey="denial_rate" name="Denial Rate %" fill="hsl(var(--destructive))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payer</TableHead>
                  <TableHead className="text-right">Submitted</TableHead>
                  <TableHead className="text-right">Denied</TableHead>
                  <TableHead className="text-right">Denial Rate</TableHead>
                  <TableHead>Top Denial Reason</TableHead>
                  <TableHead className="text-right">Avg Days to Denial</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payerRows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{r.payer}</TableCell>
                    <TableCell className="text-right">{r.total_submitted}</TableCell>
                    <TableCell className="text-right">{r.total_denied}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={r.denial_rate > 5 ? "destructive" : "secondary"} className="text-xs">{fmtPct(r.denial_rate)}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.top_denial_reason || "—"}</TableCell>
                    <TableCell className="text-right">{r.avg_days_to_denial ? Math.round(r.avg_days_to_denial) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {reasonRows.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Denial Reasons Ranked by Frequency</h3>
              <div className="border rounded-lg overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>CARC Code</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Count</TableHead>
                      <TableHead className="text-right">% of All Denials</TableHead>
                      <TableHead className="text-right">Avg Billed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reasonRows.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono">{r.carc_code || "—"}</TableCell>
                        <TableCell className="text-sm">{r.description}</TableCell>
                        <TableCell className="text-right">{r.count}</TableCell>
                        <TableCell className="text-right">{fmtPct(r.pct_of_total)}</TableCell>
                        <TableCell className="text-right">{fmt$(r.avg_billed)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CollectionsReport({ filters }: { filters: Filters }) {
  const params = new URLSearchParams();
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  if (filters.payerId !== "all") params.set("payerId", filters.payerId);
  if (filters.providerId !== "all") params.set("providerId", filters.providerId);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/billing/reports/collections", params.toString()],
    queryFn: () => fetch(`/api/billing/reports/collections?${params}`, { credentials: "include" }).then(r => r.json()),
  });

  const summary = data?.summary || {};
  const monthly: any[] = data?.monthly || [];

  const collectionRate = summary.total_billed > 0 ? (summary.total_paid / summary.total_billed) * 100 : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Revenue collected vs billed over time</p>
        <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => exportCSV(monthly.map(r => ({
          "Month": r.month, "Billed": r.billed, "Paid": r.paid, "Adjusted": r.adjusted,
          "Outstanding": r.outstanding, "Collection Rate %": r.collection_rate?.toFixed(1)
        })), "collections.csv")} data-testid="button-export-collections">
          <Download className="h-3 w-3" /> Export CSV
        </Button>
      </div>

      {isLoading ? <Skeleton className="h-40" /> : (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "Total Billed", value: fmt$(summary.total_billed), color: "" },
            { label: "Total Paid", value: fmt$(summary.total_paid), color: "text-green-600 dark:text-green-400" },
            { label: "Total Adjusted", value: fmt$(summary.total_adjusted), color: "text-blue-600 dark:text-blue-400" },
            { label: "Total Outstanding", value: fmt$(summary.total_outstanding), color: "text-amber-600 dark:text-amber-400" },
            { label: "Collection Rate", value: fmtPct(collectionRate), color: collectionRate >= 90 ? "text-green-600" : "text-amber-600" },
          ].map((c) => (
            <Card key={c.label}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p className={`text-xl font-bold mt-0.5 ${c.color}`}>{c.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!isLoading && monthly.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Billed vs Paid (Last 12 Months)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={monthly} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: any) => fmt$(Number(v))} />
                <Legend />
                <Line type="monotone" dataKey="billed" name="Billed" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="paid" name="Paid" stroke="#22c55e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {!isLoading && monthly.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <TrendingUp className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="font-medium">No collections data for this period</p>
        </CardContent></Card>
      ) : !isLoading && (
        <div className="border rounded-lg overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Billed</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Adjusted</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead className="text-right">Collection Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {monthly.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.month}</TableCell>
                  <TableCell className="text-right">{fmt$(r.billed)}</TableCell>
                  <TableCell className="text-right text-green-600">{fmt$(r.paid)}</TableCell>
                  <TableCell className="text-right text-blue-600">{fmt$(r.adjusted)}</TableCell>
                  <TableCell className="text-right text-amber-600">{fmt$(r.outstanding)}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={r.collection_rate >= 90 ? "default" : "secondary"} className="text-xs">{fmtPct(r.collection_rate)}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function CleanClaimReport({ filters }: { filters: Filters }) {
  const params = new URLSearchParams();
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);
  if (filters.payerId !== "all") params.set("payerId", filters.payerId);
  if (filters.providerId !== "all") params.set("providerId", filters.providerId);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/billing/reports/clean-claim-rate", params.toString()],
    queryFn: () => fetch(`/api/billing/reports/clean-claim-rate?${params}`, { credentials: "include" }).then(r => r.json()),
  });

  const rows: any[] = data?.rows || [];
  const overall = data?.overall || {};

  const BENCHMARK_FPRR = 90;
  const BENCHMARK_DENIAL = 5;
  const BENCHMARK_AR_DAYS = 45;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">First-pass resolution rate — claims paid on first submission without denial or correction</p>
        <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => exportCSV(rows.map(r => ({
          "Payer": r.payer, "Claims Submitted": r.total_submitted, "First Pass Paid": r.first_pass_paid,
          "FPRR %": r.fprr?.toFixed(1), "Benchmark": "90%+", "vs Benchmark": r.fprr >= 90 ? "Above" : "Below"
        })), "clean-claim-rate.csv")} data-testid="button-export-fprr">
          <Download className="h-3 w-3" /> Export CSV
        </Button>
      </div>

      {isLoading ? <Skeleton className="h-32" /> : (
        <div className="grid grid-cols-3 gap-3">
          <Card className={overall.fprr >= BENCHMARK_FPRR ? "border-green-200 dark:border-green-800 bg-green-50/30 dark:bg-green-950/20" : "border-amber-200 dark:border-amber-800"}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Overall FPRR</p>
              <p className={`text-2xl font-bold mt-0.5 ${overall.fprr >= BENCHMARK_FPRR ? "text-green-600 dark:text-green-400" : "text-amber-600"}`}>{fmtPct(overall.fprr || 0)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Benchmark: {BENCHMARK_FPRR}%+</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Denial Rate Benchmark</p>
              <p className="text-2xl font-bold mt-0.5 text-muted-foreground">&lt;{BENCHMARK_DENIAL}%</p>
              <p className="text-xs text-muted-foreground mt-0.5">Industry standard</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">A/R Days Benchmark</p>
              <p className="text-2xl font-bold mt-0.5 text-muted-foreground">&lt;{BENCHMARK_AR_DAYS}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Industry standard</p>
            </CardContent>
          </Card>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">
          <FileBarChart className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="font-medium">No submitted claims in this period</p>
        </CardContent></Card>
      ) : (
        <div className="border rounded-lg overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payer</TableHead>
                <TableHead className="text-right">Claims Submitted</TableHead>
                <TableHead className="text-right">First Pass Paid</TableHead>
                <TableHead className="text-right">FPRR %</TableHead>
                <TableHead className="text-right">Benchmark</TableHead>
                <TableHead className="text-right">vs Benchmark</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.payer}</TableCell>
                  <TableCell className="text-right">{r.total_submitted}</TableCell>
                  <TableCell className="text-right">{r.first_pass_paid}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={r.fprr >= BENCHMARK_FPRR ? "default" : "destructive"} className="text-xs">{fmtPct(r.fprr)}</Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-xs">90%+</TableCell>
                  <TableCell className="text-right">
                    {r.fprr >= BENCHMARK_FPRR
                      ? <span className="text-green-600 text-xs font-medium">+{(r.fprr - BENCHMARK_FPRR).toFixed(1)}%</span>
                      : <span className="text-red-600 text-xs font-medium">{(r.fprr - BENCHMARK_FPRR).toFixed(1)}%</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export default function BillingReports() {
  const defaultEnd = format(new Date(), "yyyy-MM-dd");
  const defaultStart = format(subDays(new Date(), 90), "yyyy-MM-dd");

  const [filters, setFilters] = useState<Filters>({
    startDate: defaultStart,
    endDate: defaultEnd,
    payerId: "all",
    providerId: "all",
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Reports</h1>
        <p className="text-muted-foreground">Revenue cycle analytics — live data, exportable to CSV</p>
      </div>

      <FilterBar filters={filters} setFilters={setFilters} />

      <Tabs defaultValue="ar-aging">
        <TabsList className="grid grid-cols-4 w-full max-w-2xl">
          <TabsTrigger value="ar-aging" data-testid="tab-ar-aging">A/R Aging</TabsTrigger>
          <TabsTrigger value="denials" data-testid="tab-denials">Denial Analysis</TabsTrigger>
          <TabsTrigger value="collections" data-testid="tab-collections">Collections</TabsTrigger>
          <TabsTrigger value="fprr" data-testid="tab-fprr">Clean Claim Rate</TabsTrigger>
        </TabsList>

        <TabsContent value="ar-aging" className="mt-4">
          <ARAgingReport filters={filters} />
        </TabsContent>
        <TabsContent value="denials" className="mt-4">
          <DenialAnalysisReport filters={filters} />
        </TabsContent>
        <TabsContent value="collections" className="mt-4">
          <CollectionsReport filters={filters} />
        </TabsContent>
        <TabsContent value="fprr" className="mt-4">
          <CleanClaimReport filters={filters} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
