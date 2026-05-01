import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Workflow,
  Play,
  CheckCircle2,
  Clock,
  Phone,
  MessageSquare,
  Mail,
  Activity,
  GitBranch,
  Pause,
} from "lucide-react";

const STEP_TYPE_ICONS: Record<string, any> = {
  call: Phone,
  voice_call: Phone,
  sms: MessageSquare,
  sms_message: MessageSquare,
  email: Mail,
  email_message: Mail,
  wait: Clock,
  vob_check: Activity,
  branch: GitBranch,
  human_task: Pause,
  provider_match: GitBranch,
  appointment_schedule: Clock,
  webhook: Activity,
};

const STEP_TYPE_COLORS: Record<string, string> = {
  call: "bg-blue-50 text-blue-700 border-blue-200",
  voice_call: "bg-blue-50 text-blue-700 border-blue-200",
  sms: "bg-green-50 text-green-700 border-green-200",
  sms_message: "bg-green-50 text-green-700 border-green-200",
  email: "bg-purple-50 text-purple-700 border-purple-200",
  email_message: "bg-purple-50 text-purple-700 border-purple-200",
  wait: "bg-gray-50 text-gray-600 border-gray-200",
  vob_check: "bg-amber-50 text-amber-700 border-amber-200",
  branch: "bg-indigo-50 text-indigo-700 border-indigo-200",
  human_task: "bg-rose-50 text-rose-700 border-rose-200",
  provider_match: "bg-indigo-50 text-indigo-700 border-indigo-200",
  appointment_schedule: "bg-teal-50 text-teal-700 border-teal-200",
  webhook: "bg-orange-50 text-orange-700 border-orange-200",
};

function formatDistance(date: Date): string {
  const ms = date.getTime() - Date.now();
  const min = Math.round(ms / 60000);
  if (min < 1) return "<1 min";
  if (min < 60) return `${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}

export default function FlowsPage() {
  const [, setLocation] = useLocation();

  const { data: rawFlows, isLoading } = useQuery<any>({
    queryKey: ["/api/flows"],
    queryFn: () => fetch("/api/flows").then((r) => r.json()),
  });
  const flows: any[] = Array.isArray(rawFlows) ? rawFlows : [];

  const { data: rawActiveRuns } = useQuery<any>({
    queryKey: ["/api/flow-runs/active"],
    queryFn: () => fetch("/api/flow-runs/active").then((r) => r.json()),
    refetchInterval: 5000,
  });
  const activeRuns: any[] = Array.isArray(rawActiveRuns) ? rawActiveRuns : [];

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-page-title">Flows</h1>
          <p className="text-muted-foreground mt-1">
            Configurable intake sequences. Each flow defines how leads move through calls, SMS, email, and verification automatically.
          </p>
        </div>
      </div>

      {/* Metric strip */}
      <div className="grid grid-cols-3 gap-4 mt-6 mb-8">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-semibold" data-testid="text-active-flows">
              {flows.filter((f) => f.is_active).length}
            </div>
            <div className="text-sm text-muted-foreground mt-1">Active flows</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-semibold" data-testid="text-leads-in-flow">
              {activeRuns.length}
            </div>
            <div className="text-sm text-muted-foreground mt-1">Leads currently in a flow</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-semibold" data-testid="text-completed-runs">
              {flows.reduce((sum, f) => sum + (f.completed_run_count || 0), 0)}
            </div>
            <div className="text-sm text-muted-foreground mt-1">Completed runs (all time)</div>
          </CardContent>
        </Card>
      </div>

      {/* Flows list */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Workflow className="h-5 w-5" />
          Configured Flows
        </h2>

        {isLoading && (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div key={i} className="h-28 bg-muted rounded-lg animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && flows.length === 0 && (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              No flows configured yet.
            </CardContent>
          </Card>
        )}

        {flows.map((flow) => (
          <Card
            key={flow.id}
            className="cursor-pointer hover:border-blue-400 transition-colors"
            onClick={() => setLocation(`/intake/flows/${flow.id}`)}
            data-testid={`card-flow-${flow.id}`}
          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
                    {flow.name}
                    {flow.is_active ? (
                      <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Paused</Badge>
                    )}
                    {flow.org_name && (
                      <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                        {flow.org_name}
                      </Badge>
                    )}
                  </CardTitle>
                  {flow.description && (
                    <p className="text-sm text-muted-foreground mt-1">{flow.description}</p>
                  )}
                </div>
                <Button variant="outline" size="sm" data-testid={`button-view-flow-${flow.id}`}>
                  View Flow →
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-wrap gap-4 text-sm">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Trigger:</span>
                  <Badge variant="outline" className="font-mono text-xs">{flow.trigger_event}</Badge>
                  {flow.trigger_conditions && Object.keys(flow.trigger_conditions).length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      where {Object.entries(flow.trigger_conditions).map(([k, v]) => `${k}=${v}`).join(", ")}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Workflow className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{flow.step_count} steps</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Play className="h-3.5 w-3.5 text-blue-600" />
                  <span>{flow.active_run_count} active</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  <span>{flow.completed_run_count} completed</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Live Activity */}
      {activeRuns.length > 0 && (
        <div className="mt-10">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Activity className="h-5 w-5" />
            Live Activity
            <Badge variant="outline" className="text-xs ml-2">refreshes every 5s</Badge>
          </h2>
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30">
                  <tr className="text-left">
                    <th className="p-3 font-medium">Lead</th>
                    <th className="p-3 font-medium">Flow</th>
                    <th className="p-3 font-medium">Current Step</th>
                    <th className="p-3 font-medium">Progress</th>
                    <th className="p-3 font-medium">Next Action</th>
                  </tr>
                </thead>
                <tbody>
                  {activeRuns.map((run: any) => {
                    const Icon = STEP_TYPE_ICONS[run.current_step_type] || Activity;
                    const colorClass = STEP_TYPE_COLORS[run.current_step_type] || "bg-gray-50";
                    const nextActionDate = run.next_action_at ? new Date(run.next_action_at) : null;
                    const inFuture = nextActionDate && nextActionDate > new Date();
                    return (
                      <tr
                        key={run.id}
                        className="border-b hover:bg-muted/20 cursor-pointer"
                        onClick={() => setLocation(`/intake/deals/${run.lead_id}`)}
                        data-testid={`row-active-run-${run.id}`}
                      >
                        <td className="p-3">
                          <div className="font-medium">{run.lead_name || `Lead #${run.lead_id}`}</div>
                          <div className="text-xs text-muted-foreground">{run.lead_phone}</div>
                        </td>
                        <td className="p-3">
                          <span className="text-xs">{run.flow_name}</span>
                        </td>
                        <td className="p-3">
                          <Badge variant="outline" className={`${colorClass} font-normal`}>
                            <Icon className="h-3 w-3 mr-1" />
                            Step {run.current_step_order}: {run.current_step_type}
                          </Badge>
                        </td>
                        <td className="p-3">
                          <div className="text-xs">
                            {run.current_step_order} / {run.total_steps}
                          </div>
                          <div className="w-24 h-1.5 bg-gray-100 rounded-full mt-1">
                            <div
                              className="h-full bg-blue-500 rounded-full"
                              style={{ width: `${(run.current_step_order / run.total_steps) * 100}%` }}
                            />
                          </div>
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {nextActionDate && (inFuture ? `in ${formatDistance(nextActionDate)}` : "firing now")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
