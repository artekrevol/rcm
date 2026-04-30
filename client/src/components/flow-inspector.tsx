import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Activity, CheckCircle2, XCircle, Clock, PlayCircle, PauseCircle } from "lucide-react";

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
  const { data: runs, isLoading } = useQuery<FlowRun[]>({
    queryKey: ["/api/leads", leadId, "flow-runs"],
    queryFn: () =>
      fetch(`/api/leads/${leadId}/flow-runs`).then((r) => r.json()),
    refetchInterval: 15_000, // poll every 15s to show live progress
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-24 bg-muted rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (!runs?.length) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <Activity className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm font-medium">No automation flows for this lead</p>
        <p className="text-xs mt-1">Flows trigger automatically when a lead is created and matches flow conditions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-1">
      {runs.map((run) => {
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
                    Current step: <span className="font-medium text-foreground capitalize">{run.current_step_label}</span>
                  </span>
                )}
                {nextAt && run.status === "running" && (
                  <span>
                    Next action: <span className="font-medium text-foreground">{formatDistanceToNow(nextAt, { addSuffix: true })}</span>
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
                        <span className="text-muted-foreground leading-tight break-words min-w-0">{message}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
