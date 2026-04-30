import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  PlayCircle,
  PauseCircle,
  Zap,
  Loader2,
  AlertTriangle,
  ChevronDown,
  RotateCcw,
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface FlowRunEvent {
  id: string;
  flow_run_id: string;
  event_type: string;
  step_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

interface FlowRun {
  id: string;
  status: "running" | "paused" | "completed" | "failed";
  current_step_index: number;
  next_action_at: string | null;
  started_at: string;
  completed_at: string | null;
  flow_name: string;
  current_step_label: string | null;
  attempt_count: number;
  failure_reason: string | null;
  events: FlowRunEvent[];
}

interface Flow {
  id: string;
  name: string;
  step_count: number;
  is_active: boolean;
}

/** A collapsed group of step_started / step_failed events for the same step_id */
interface FailureGroup {
  kind: "failure_group";
  stepId: string;
  stepType: string;
  attemptCount: number;
  failureReason: string | null;
  events: FlowRunEvent[];
  firstAt: string;
  lastAt: string;
}

type TimelineItem = FlowRunEvent | FailureGroup;

function isFailureGroup(item: TimelineItem): item is FailureGroup {
  return (item as FailureGroup).kind === "failure_group";
}

/**
 * Collapse consecutive step_started / step_failed event pairs that share the same
 * step_id into a single FailureGroup row. Non-repeated events pass through unchanged.
 */
function buildTimeline(events: FlowRunEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];

  // Group consecutive step_started + step_failed events by step_id
  let i = 0;

  while (i < events.length) {
    const ev = events[i];

    if (ev.event_type === "step_started" && ev.step_id) {
      // Look ahead to see if subsequent events for this step_id are only step_failed
      const stepId = ev.step_id;
      const collected: FlowRunEvent[] = [ev];
      let j = i + 1;

      while (j < events.length) {
        const next = events[j];
        if (next.step_id === stepId && (next.event_type === "step_failed" || next.event_type === "step_started")) {
          collected.push(next);
          j++;
        } else {
          break;
        }
      }

      // Only collapse into a group if there's at least one step_failed and no step_completed
      const hasFailure = collected.some((e) => e.event_type === "step_failed");
      const hasSuccess = collected.some((e) => e.event_type === "step_completed");

      if (hasFailure && !hasSuccess && collected.length > 1) {
        const startEvents = collected.filter((e) => e.event_type === "step_started");
        const failEvents = collected.filter((e) => e.event_type === "step_failed");
        const stepType =
          (collected[0].payload?.stepType as string) ||
          (collected[0].payload?.step_type as string) ||
          "unknown";
        const lastFail = failEvents[failEvents.length - 1];
        const failureReason =
          (lastFail?.payload?.reason as string) ||
          (lastFail?.payload?.error as string) ||
          null;

        items.push({
          kind: "failure_group",
          stepId,
          stepType,
          attemptCount: startEvents.length,
          failureReason,
          events: collected,
          firstAt: collected[0].created_at,
          lastAt: collected[collected.length - 1].created_at,
        });
        i = j;
        continue;
      }

      // Not a pure failure group — emit events individually
      for (const c of collected) {
        items.push(c);
      }
      i = j;
      continue;
    }

    items.push(ev);
    i++;
  }

  return items;
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  running: <PlayCircle className="h-4 w-4 text-blue-500" />,
  paused: <PauseCircle className="h-4 w-4 text-amber-500" />,
  completed: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
  failed: <XCircle className="h-4 w-4 text-red-500" />,
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  running: "default",
  paused: "secondary",
  completed: "outline",
  failed: "destructive",
};

const EVENT_ICON: Record<string, React.ReactNode> = {
  flow_started: <PlayCircle className="h-3 w-3 text-blue-400" />,
  flow_completed: <CheckCircle2 className="h-3 w-3 text-emerald-400" />,
  flow_failed: <XCircle className="h-3 w-3 text-red-400" />,
  flow_retried: <RotateCcw className="h-3 w-3 text-amber-400" />,
  step_started: <Clock className="h-3 w-3 text-slate-400" />,
  step_completed: <CheckCircle2 className="h-3 w-3 text-emerald-400" />,
  step_failed: <XCircle className="h-3 w-3 text-red-400" />,
  step_skipped: <Activity className="h-3 w-3 text-amber-400" />,
  step_advanced: <Activity className="h-3 w-3 text-slate-400" />,
  step_started_call: <PlayCircle className="h-3 w-3 text-indigo-400" />,
};

function safeDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function FailureGroupRow({ group }: { group: FailureGroup }) {
  const [open, setOpen] = useState(false);
  const firstAt = safeDate(group.firstAt);

  return (
    <li className="flex flex-col gap-1 text-xs" data-testid={`flow-failure-group-${group.stepId}`}>
      <div className="flex items-start gap-2">
        <span className="text-muted-foreground w-10 shrink-0 pt-0.5">
          {firstAt ? format(firstAt, "HH:mm") : "--"}
        </span>
        <span className="shrink-0 pt-0.5">
          <XCircle className="h-3 w-3 text-red-400" />
        </span>
        <Badge variant="destructive" className="shrink-0 text-[10px] h-4 px-1 font-normal">
          step failed
        </Badge>
        <span className="text-muted-foreground leading-tight break-words min-w-0 flex-1">
          <span className="font-medium capitalize">{group.stepType}</span>
          {" — failed after "}
          <span className="font-medium">{group.attemptCount} attempt{group.attemptCount !== 1 ? "s" : ""}</span>
        </span>
        {group.failureReason && (
          <button
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setOpen((o) => !o)}
            data-testid={`button-expand-failure-${group.stepId}`}
          >
            <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>
      {open && group.failureReason && (
        <div className="ml-12 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-2 text-[10px] text-red-800 dark:text-red-300 break-words">
          {group.failureReason}
        </div>
      )}
    </li>
  );
}

export function FlowInspector({ leadId }: { leadId: string }) {
  const { toast } = useToast();
  const [selectedFlowId, setSelectedFlowId] = useState<string>("");

  const { data: runs, isLoading: runsLoading } = useQuery<FlowRun[]>({
    queryKey: ["/api/leads", leadId, "flow-runs"],
    queryFn: () => fetch(`/api/leads/${leadId}/flow-runs`).then((r) => r.json()),
    refetchInterval: 15_000,
  });

  const { data: flows } = useQuery<Flow[]>({
    queryKey: ["/api/flows"],
    staleTime: 60_000,
  });

  const hasActiveRun = runs?.some((r) => r.status === "running");

  const triggerMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/leads/${leadId}/trigger-flow`, selectedFlowId ? { flowId: selectedFlowId } : {}),
    onSuccess: () => {
      toast({ title: "Flow started", description: "The lead has been enrolled in the flow." });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId, "flow-runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/flows"] });
      setSelectedFlowId("");
    },
    onError: (err: any) => {
      const msg = err?.message || "Failed to start flow";
      const alreadyActive = msg.includes("already enrolled");
      toast({
        title: alreadyActive ? "Already in a flow" : "Failed to start flow",
        description: alreadyActive
          ? "This lead is already enrolled in an active flow."
          : msg,
        variant: "destructive",
      });
    },
  });

  const retryMutation = useMutation({
    mutationFn: (flowRunId: string) =>
      apiRequest("POST", `/api/flow-runs/${flowRunId}/retry`, {}),
    onSuccess: () => {
      toast({ title: "Flow restarted", description: "The flow run is being retried from the failed step." });
      queryClient.invalidateQueries({ queryKey: ["/api/leads", leadId, "flow-runs"] });
    },
    onError: (err: any) => {
      toast({
        title: "Retry failed",
        description: err?.message || "Could not restart the flow run.",
        variant: "destructive",
      });
    },
  });

  if (runsLoading) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-24 bg-muted rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  const activeFlows = Array.isArray(flows) ? flows.filter((f) => f.is_active) : [];

  return (
    <div className="space-y-4 p-1">
      {/* Manual trigger panel */}
      <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Enroll in Flow</span>
          {hasActiveRun && (
            <Badge variant="secondary" className="ml-auto text-xs flex items-center gap-1">
              <Activity className="h-3 w-3" /> Flow running
            </Badge>
          )}
        </div>

        {hasActiveRun ? (
          <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-3">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>This lead is already enrolled in an active flow. It cannot be re-enrolled until the current run completes.</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {activeFlows.length > 1 && (
              <Select value={selectedFlowId} onValueChange={setSelectedFlowId}>
                <SelectTrigger className="h-8 text-xs flex-1" data-testid="select-flow">
                  <SelectValue placeholder="Select a flow (or enroll in all)" />
                </SelectTrigger>
                <SelectContent>
                  {activeFlows.map((f) => (
                    <SelectItem key={f.id} value={f.id} className="text-xs">
                      {f.name} ({f.step_count} steps)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => triggerMutation.mutate()}
              disabled={triggerMutation.isPending}
              data-testid="button-start-flow"
            >
              {triggerMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Zap className="h-3 w-3" />
              )}
              {activeFlows.length === 1 && !selectedFlowId
                ? `Start: ${activeFlows[0]?.name ?? "Flow"}`
                : "Start Flow"}
            </Button>
          </div>
        )}
      </div>

      {/* Flow run history */}
      {(!runs || runs.length === 0) ? (
        <div className="p-6 text-center text-muted-foreground">
          <Activity className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm font-medium">No flow runs yet</p>
          <p className="text-xs mt-1">Use the panel above to manually enroll this lead.</p>
        </div>
      ) : (
        runs.map((run) => {
          const nextAt = safeDate(run.next_action_at);
          const startedAt = safeDate(run.started_at);
          const timeline = buildTimeline(run.events);

          return (
            <Card key={run.id} data-testid={`flow-run-card-${run.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {STATUS_ICON[run.status] ?? <Activity className="h-4 w-4" />}
                    <CardTitle className="text-sm font-semibold">{run.flow_name}</CardTitle>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={STATUS_VARIANT[run.status] ?? "secondary"} className="capitalize">
                      {run.status}
                    </Badge>
                    {run.status === "failed" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 gap-1 text-[11px] px-2"
                        onClick={() => retryMutation.mutate(run.id)}
                        disabled={retryMutation.isPending}
                        data-testid={`button-retry-flow-${run.id}`}
                      >
                        {retryMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3 w-3" />
                        )}
                        Retry from this step
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mt-1">
                  {startedAt && (
                    <span>Started {formatDistanceToNow(startedAt, { addSuffix: true })}</span>
                  )}
                  {run.current_step_label && (
                    <span>
                      Current step:{" "}
                      <span className="font-medium text-foreground capitalize">
                        {run.current_step_label}
                      </span>
                    </span>
                  )}
                  {nextAt && run.status === "running" && (
                    <span>
                      Next action:{" "}
                      <span className="font-medium text-foreground">
                        {formatDistanceToNow(nextAt, { addSuffix: true })}
                      </span>
                    </span>
                  )}
                  {run.status === "failed" && run.failure_reason && (
                    <span className="text-red-600 dark:text-red-400">
                      Reason: <span className="font-medium">{run.failure_reason.slice(0, 80)}{run.failure_reason.length > 80 ? "…" : ""}</span>
                    </span>
                  )}
                </div>
              </CardHeader>

              <CardContent className="pt-0">
                <Separator className="mb-3" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Event Timeline
                </p>

                {timeline.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No events recorded yet.</p>
                ) : (
                  <ol className="space-y-1.5">
                    {timeline.map((item, idx) => {
                      if (isFailureGroup(item)) {
                        return <FailureGroupRow key={`fg-${item.stepId}-${idx}`} group={item} />;
                      }

                      const ev = item as FlowRunEvent;
                      const createdAt = safeDate(ev.created_at);
                      const message =
                        (ev.payload?.message as string) ||
                        (ev.payload?.reason as string) ||
                        ev.event_type;

                      return (
                        <li
                          key={ev.id}
                          className="flex items-start gap-2 text-xs"
                          data-testid={`flow-event-${ev.id}`}
                        >
                          <span className="text-muted-foreground w-10 shrink-0 pt-0.5">
                            {createdAt ? format(createdAt, "HH:mm") : "--"}
                          </span>
                          <span className="shrink-0 pt-0.5">
                            {EVENT_ICON[ev.event_type] ?? <Activity className="h-3 w-3 text-slate-400" />}
                          </span>
                          <Badge variant="outline" className="shrink-0 text-[10px] h-4 px-1 font-normal">
                            {ev.event_type.replace(/_/g, " ")}
                          </Badge>
                          <span className="text-muted-foreground leading-tight break-words min-w-0">
                            {message}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}
