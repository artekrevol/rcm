import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CheckCircle2, Circle, Clock, AlertTriangle, RefreshCw, Play,
  Loader2, ExternalLink, ChevronDown, ChevronUp, Radio, Zap
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ScraperStatus {
  payer_code: string;
  circuit: { state: string; consecutive_errors: number; reopens_at?: string };
  last_run: {
    id: string; started_at: string; completed_at: string; status: string;
    used_fallback: boolean; documents_new: string; documents_updated: string; documents_unchanged: string;
  } | null;
  documents_tracked: number;
}

interface StatusResponse {
  scrapers: ScraperStatus[];
  unlinked_supplement_warning: string | null;
}

interface ScrapeRun {
  id: string; payer_code: string; started_at: string; completed_at: string;
  status: string; used_fallback: boolean; triggered_by: string;
  documents_discovered: string; documents_new: string; documents_updated: string;
  documents_unchanged: string; bulletins_discovered: string; error_count: number;
  report: Record<string, unknown> | null;
}

interface Discovery {
  id: string; document_name: string; document_type: string;
  source_url_canonical: string; source_acquisition_method: string;
  created_at: string; payer_name: string; extraction_count: number; notes: string;
}

// ── Stage definitions for Live Demo ──────────────────────────────────────────
const DEMO_STAGES = [
  { key: "discovering", label: "Discovering documents on UHCprovider.com" },
  { key: "comparing",   label: "Comparing against existing corpus" },
  { key: "fetching",    label: "Fetching new or updated documents" },
  { key: "extracting",  label: "Extracting payer rules from documents" },
  { key: "complete",    label: "Demo complete" },
];

// ── Sub-components ────────────────────────────────────────────────────────────
function CircuitBadge({ state }: { state: string }) {
  const map: Record<string, { label: string; className: string }> = {
    closed:    { label: "Healthy",    className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
    open:      { label: "Open",       className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
    half_open: { label: "Half-open",  className: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" },
  };
  const cfg = map[state] ?? map.closed;
  return <Badge className={cn("text-xs font-medium border-0", cfg.className)}>{cfg.label}</Badge>;
}

function RunStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    partial: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
    failed:  "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    running: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    circuit_open: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    already_running: "bg-muted text-muted-foreground",
  };
  return (
    <Badge className={cn("text-xs border-0 capitalize", map[status] ?? "bg-muted text-muted-foreground")}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

function StageRow({ stageKey, label, activeKey, completedKeys, message }: {
  stageKey: string; label: string; activeKey: string | null;
  completedKeys: string[]; message?: string;
}) {
  const isComplete = completedKeys.includes(stageKey);
  const isActive = activeKey === stageKey;

  return (
    <div className={cn(
      "flex items-start gap-3 py-2.5 transition-all duration-500",
      isActive && "opacity-100",
      !isActive && !isComplete && "opacity-30",
    )}>
      <div className="mt-0.5 shrink-0">
        {isComplete ? (
          <CheckCircle2 className="h-5 w-5 text-green-500" />
        ) : isActive ? (
          <Loader2 className="h-5 w-5 text-primary animate-spin" />
        ) : (
          <Circle className="h-5 w-5 text-muted-foreground" />
        )}
      </div>
      <div>
        <p className={cn("text-sm font-medium", isComplete && "text-foreground", isActive && "text-foreground", !isActive && !isComplete && "text-muted-foreground")}>
          {label}
        </p>
        {(isActive || isComplete) && message && (
          <p className="text-xs text-muted-foreground mt-0.5">{message}</p>
        )}
      </div>
    </div>
  );
}

// ── Reset Circuit Dialog ──────────────────────────────────────────────────────
function ResetCircuitDialog({ payerCode, open, onClose }: {
  payerCode: string; open: boolean; onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const resetMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/scrapers/circuit/${payerCode}/reset`, { reason }),
    onSuccess: () => {
      toast({ title: "Circuit reset", description: `${payerCode.toUpperCase()} circuit breaker reset.` });
      qc.invalidateQueries({ queryKey: ["/api/admin/scrapers/status"] });
      setReason("");
      onClose();
    },
    onError: (err: Error) => toast({ title: "Reset failed", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset circuit breaker — {payerCode.toUpperCase()}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Label>Reason for reset</Label>
          <Input
            data-testid="input-circuit-reset-reason"
            placeholder="e.g. UHC site was temporarily down, now recovered"
            value={reason}
            onChange={e => setReason(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            data-testid="button-confirm-circuit-reset"
            onClick={() => resetMutation.mutate()}
            disabled={!reason.trim() || resetMutation.isPending}
          >
            {resetMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Reset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ScrapersPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: statusData, isLoading: statusLoading } = useQuery<StatusResponse>({
    queryKey: ["/api/admin/scrapers/status"],
    refetchInterval: 15_000,
  });

  const { data: runs = [], isLoading: runsLoading } = useQuery<ScrapeRun[]>({
    queryKey: ["/api/admin/scrapers/runs"],
    refetchInterval: 8_000,
  });

  const { data: discoveries = [] } = useQuery<Discovery[]>({
    queryKey: ["/api/admin/scrapers/discoveries"],
    refetchInterval: 30_000,
  });

  // ── Demo state ──────────────────────────────────────────────────────────────
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoRunId, setDemoRunId] = useState<string | null>(null);
  const [activeStage, setActiveStage] = useState<string | null>(null);
  const [completedStages, setCompletedStages] = useState<string[]>([]);
  const [stageMessages, setStageMessages] = useState<Record<string, string>>({});
  const [usedFallback, setUsedFallback] = useState(false);
  const [newRuleCount, setNewRuleCount] = useState<number | null>(null);
  const [demoComplete, setDemoComplete] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // ── Reset circuit dialog ────────────────────────────────────────────────────
  const [resetTarget, setResetTarget] = useState<string | null>(null);

  // ── Expanded run rows ───────────────────────────────────────────────────────
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const startDemo = async () => {
    if (demoRunning) return;
    setDemoRunning(true);
    setDemoComplete(false);
    setActiveStage(null);
    setCompletedStages([]);
    setStageMessages({});
    setUsedFallback(false);
    setNewRuleCount(null);

    try {
      const res = await apiRequest(
        "POST", "/api/admin/scrapers/run",
        { payer_code: "uhc", triggeredBy: "demo_button", allowFallback: true }
      );
      const result = await res.json() as { run_id: string; status: string };

      const runId = result.run_id;
      setDemoRunId(runId);

      // Open SSE stream
      const es = new EventSource(`/api/admin/scrapers/runs/${runId}/stream`);
      eventSourceRef.current = es;

      const stageOrder = DEMO_STAGES.map(s => s.key);

      es.onmessage = (event) => {
        const msg = JSON.parse(event.data) as {
          stage: string; message: string;
          payload?: { count?: number; used_fallback?: boolean; new_extraction_item_count?: number };
        };

        setStageMessages(prev => ({ ...prev, [msg.stage]: msg.message }));

        if (msg.payload?.used_fallback) setUsedFallback(true);

        if (msg.stage === "complete") {
          if (msg.payload?.new_extraction_item_count != null) {
            setNewRuleCount(msg.payload.new_extraction_item_count as number);
          }
          setCompletedStages(stageOrder);
          setActiveStage(null);
          setDemoComplete(true);
          setDemoRunning(false);
          qc.invalidateQueries({ queryKey: ["/api/admin/scrapers/status"] });
          qc.invalidateQueries({ queryKey: ["/api/admin/scrapers/runs"] });
          qc.invalidateQueries({ queryKey: ["/api/admin/scrapers/discoveries"] });
          es.close();
        } else {
          const idx = stageOrder.indexOf(msg.stage);
          if (idx >= 0) {
            setActiveStage(msg.stage);
            setCompletedStages(stageOrder.slice(0, idx));
          }
        }
      };

      es.onerror = () => {
        es.close();
        if (!demoComplete) {
          setDemoRunning(false);
          toast({ title: "Connection lost", description: "Lost connection to live scrape stream.", variant: "destructive" });
        }
      };
    } catch (err: Error | unknown) {
      setDemoRunning(false);
      toast({ title: "Demo failed to start", description: (err as Error).message, variant: "destructive" });
    }
  };

  // Run scraper (non-demo button in table)
  const runMutation = useMutation({
    mutationFn: (payerCode: string) =>
      apiRequest("POST", "/api/admin/scrapers/run", { payer_code: payerCode, triggeredBy: "manual_admin" }),
    onSuccess: () => {
      toast({ title: "Scrape started", description: "Check the Run History for progress." });
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["/api/admin/scrapers/runs"] });
        qc.invalidateQueries({ queryKey: ["/api/admin/scrapers/status"] });
      }, 1000);
    },
    onError: (err: Error) => toast({ title: "Failed to start", description: err.message, variant: "destructive" }),
  });

  useEffect(() => {
    return () => { eventSourceRef.current?.close(); };
  }, []);

  const uhcStatus = statusData?.scrapers.find(s => s.payer_code === "uhc");

  return (
    <div className="space-y-8 p-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Crawler Engine</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Automated document discovery and corpus enrichment for configured payers.
        </p>
      </div>

      {statusData?.unlinked_supplement_warning && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {statusData.unlinked_supplement_warning}
        </div>
      )}

      {/* Section 1 — Configured scrapers */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Configured Scrapers</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payer</TableHead>
                <TableHead>Last Run</TableHead>
                <TableHead>Docs Tracked</TableHead>
                <TableHead>Circuit</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statusLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : (
                (statusData?.scrapers ?? [{ payer_code: "uhc", circuit: { state: "closed", consecutive_errors: 0 }, last_run: null, documents_tracked: 0 }]).map(s => (
                  <TableRow key={s.payer_code} data-testid={`row-scraper-${s.payer_code}`}>
                    <TableCell className="font-medium uppercase">{s.payer_code}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {s.last_run
                        ? new Date(s.last_run.started_at).toLocaleString()
                        : "Never"}
                    </TableCell>
                    <TableCell>{s.documents_tracked}</TableCell>
                    <TableCell><CircuitBadge state={s.circuit.state} /></TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          data-testid={`button-run-scraper-${s.payer_code}`}
                          size="sm" variant="outline"
                          onClick={() => runMutation.mutate(s.payer_code)}
                          disabled={runMutation.isPending}
                        >
                          <Play className="h-3.5 w-3.5 mr-1.5" />
                          Run scraper
                        </Button>
                        {s.circuit.state !== "closed" && (
                          <Button
                            data-testid={`button-reset-circuit-${s.payer_code}`}
                            size="sm" variant="ghost"
                            onClick={() => setResetTarget(s.payer_code)}
                          >
                            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                            Reset circuit
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Section 2 — Live Demo */}
      <Card className="border-primary/20 shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Zap className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">Live UHC Crawler Demo</CardTitle>
                  {usedFallback && (
                    <Badge className="text-xs border-0 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" data-testid="badge-cached">
                      Cached
                    </Badge>
                  )}
                </div>
                <CardDescription>
                  Watch the crawler discover and ingest UHC documents in real time.
                </CardDescription>
              </div>
            </div>
            <Button
              data-testid="button-run-live-demo"
              size="lg"
              onClick={startDemo}
              disabled={demoRunning}
              className="min-w-[140px]"
            >
              {demoRunning
                ? <><Radio className="h-4 w-4 mr-2 animate-pulse" />Running...</>
                : <><Play className="h-4 w-4 mr-2" />Run Live Demo</>
              }
            </Button>
          </div>
        </CardHeader>

        {(demoRunning || demoComplete || activeStage) && (
          <CardContent>
            <div className="border rounded-lg p-4 bg-muted/30 space-y-1 divide-y divide-border/50">
              {DEMO_STAGES.map(({ key, label }) => (
                <StageRow
                  key={key}
                  stageKey={key}
                  label={label}
                  activeKey={activeStage}
                  completedKeys={completedStages}
                  message={stageMessages[key]}
                />
              ))}
            </div>

            {demoComplete && newRuleCount != null && (
              <div className="mt-4 flex items-center gap-3 rounded-md border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950 px-4 py-3">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    {newRuleCount} new rule{newRuleCount !== 1 ? "s" : ""} ready for review.
                  </p>
                </div>
                {demoRunId && (
                  <a
                    href={`/admin/payer-manuals?run_id=${demoRunId}`}
                    className="text-xs text-green-700 dark:text-green-300 hover:underline flex items-center gap-1"
                    data-testid="link-view-results"
                  >
                    View results <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Section 3 — Discovery feed */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Newly Discovered Documents</CardTitle>
          <CardDescription>Documents added to the corpus via the crawler in the last 30 days.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {discoveries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No discovered documents yet. Run the scraper to populate this feed.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payer</TableHead>
                  <TableHead>Document</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Discovered</TableHead>
                  <TableHead>Extractions</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {discoveries.map(d => (
                  <TableRow key={d.id} data-testid={`row-discovery-${d.id}`}>
                    <TableCell className="text-sm font-medium">{d.payer_name ?? "—"}</TableCell>
                    <TableCell className="text-sm max-w-xs truncate">{d.document_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs capitalize">
                        {d.document_type.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(d.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-sm">{d.extraction_count}</TableCell>
                    <TableCell>
                      {d.source_url_canonical && (
                        <a
                          href={d.source_url_canonical}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground"
                          data-testid={`link-doc-url-${d.id}`}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Section 4 — Run history */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Run History</CardTitle>
          <CardDescription>Last 20 scrape runs across all payers. Click a row to expand the full report.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {runsLoading ? (
            <p className="text-sm text-muted-foreground text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></p>
          ) : runs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No runs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payer</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>New</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Unchanged</TableHead>
                  <TableHead>Errors</TableHead>
                  <TableHead>Fallback</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map(run => (
                  <>
                    <TableRow
                      key={run.id}
                      data-testid={`row-run-${run.id}`}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}
                    >
                      <TableCell className="font-medium uppercase">{run.payer_code}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(run.started_at).toLocaleString()}
                      </TableCell>
                      <TableCell><RunStatusBadge status={run.status} /></TableCell>
                      <TableCell className="text-sm">{run.documents_new ?? "—"}</TableCell>
                      <TableCell className="text-sm">{run.documents_updated ?? "—"}</TableCell>
                      <TableCell className="text-sm">{run.documents_unchanged ?? "—"}</TableCell>
                      <TableCell className="text-sm">
                        {(run.error_count ?? 0) > 0
                          ? <span className="text-red-600 dark:text-red-400">{run.error_count}</span>
                          : "0"}
                      </TableCell>
                      <TableCell>
                        {run.used_fallback && (
                          <Badge className="text-xs border-0 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">Cached</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {expandedRunId === run.id
                          ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </TableCell>
                    </TableRow>
                    {expandedRunId === run.id && (
                      <TableRow key={`${run.id}-expanded`}>
                        <TableCell colSpan={9} className="bg-muted/20 p-4">
                          <pre className="text-xs text-muted-foreground whitespace-pre-wrap overflow-auto max-h-60">
                            {JSON.stringify(run.report, null, 2)}
                          </pre>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Reset Circuit Dialog */}
      {resetTarget && (
        <ResetCircuitDialog
          payerCode={resetTarget}
          open={!!resetTarget}
          onClose={() => setResetTarget(null)}
        />
      )}
    </div>
  );
}
