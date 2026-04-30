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
import { Activity, CheckCircle2, XCircle, Clock, PlayCircle, PauseCircle, Zap, Loader2, AlertTriangle } from "lucide-react";
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
  events: FlowRunEvent[];
}

interface Flow {
  id: string;
  name: string;
  step_count: number;
  is_active: boolean;
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

          return (
            <Card key={run.id} data-testid={`flow-run-card-${run.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {STATUS_ICON[run.status] ?? <Activity className="h-4 w-4" />}
                    <CardTitle className="text-sm font-semibold">{run.flow_name}</CardTitle>
                  </div>
                  <Badge variant={STATUS_VARIANT[run.status] ?? "secondary"} className="shrink-0 capitalize">
                    {run.status}
                  </Badge>
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
                </div>
              </CardHeader>

              <CardContent className="pt-0">
                <Separator className="mb-3" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Event Timeline
                </p>

                {run.events.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No events recorded yet.</p>
                ) : (
                  <ol className="space-y-1.5">
                    {run.events.map((ev) => {
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
