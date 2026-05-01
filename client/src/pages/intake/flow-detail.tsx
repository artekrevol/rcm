import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Phone,
  MessageSquare,
  Mail,
  Clock,
  Activity,
  GitBranch,
  Pause,
  ArrowDown,
  CheckCircle2,
  Play,
} from "lucide-react";

const STEP_TYPE_LABELS: Record<string, string> = {
  call: "AI Voice Call",
  voice_call: "AI Voice Call",
  sms: "SMS Message",
  sms_message: "SMS Message",
  email: "Email",
  email_message: "Email",
  wait: "Wait",
  vob_check: "Insurance Verification (Stedi)",
  branch: "Conditional Branch",
  human_task: "Human Review",
  provider_match: "Provider Matching",
  appointment_schedule: "Schedule Appointment",
  webhook: "Webhook",
};

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

function formatDelay(min: number): string {
  if (!min || min === 0) return "immediate";
  if (min < 60) return `wait ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `wait ${hr}h`;
  return `wait ${Math.round(hr / 24)}d`;
}

export default function FlowDetailPage() {
  const [, params] = useRoute<{ id: string }>("/intake/flows/:id");
  const [, setLocation] = useLocation();

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/flows", params?.id],
    queryFn: () => fetch(`/api/flows/${params?.id}`).then((r) => r.json()),
    enabled: !!params?.id,
    refetchInterval: 5000,
  });

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading flow...</div>;
  if (!data?.flow) return <div className="p-8 text-muted-foreground">Flow not found.</div>;

  const { flow, steps, recent_runs } = data;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setLocation("/intake/flows")}
        className="mb-4"
        data-testid="button-back-to-flows"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to Flows
      </Button>

      <div className="flex items-start justify-between mb-2">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-flow-name">
            {flow.name}
          </h1>
          {flow.description && (
            <p className="text-muted-foreground mt-1">{flow.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          {flow.is_active ? (
            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Active</Badge>
          ) : (
            <Badge variant="secondary">Paused</Badge>
          )}
        </div>
      </div>

      {/* Trigger card */}
      <Card className="mt-6 border-dashed">
        <CardContent className="pt-6">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Trigger</div>
          <div className="font-medium">
            When{" "}
            <code className="bg-muted px-1.5 py-0.5 rounded text-sm">{flow.trigger_event}</code>
            {flow.trigger_conditions && Object.keys(flow.trigger_conditions).length > 0 && (
              <span className="text-muted-foreground">
                {" "}where{" "}
                {Object.entries(flow.trigger_conditions).map(([k, v]: any, i, arr) => (
                  <span key={k}>
                    <code className="bg-muted px-1.5 py-0.5 rounded text-sm">{k} = "{v}"</code>
                    {i < arr.length - 1 && " AND "}
                  </span>
                ))}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Visual sequence */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold mb-4">Sequence ({steps.length} steps)</h2>
        <div className="relative">
          {steps.map((step: any, idx: number) => {
            const Icon = STEP_TYPE_ICONS[step.step_type] || Activity;
            const colorClass = STEP_TYPE_COLORS[step.step_type] || "bg-gray-50";
            const isLast = idx === steps.length - 1;
            return (
              <div key={step.id} data-testid={`flow-step-${step.step_order}`}>
                <Card className={`${colorClass} border`}>
                  <CardContent className="py-4">
                    <div className="flex items-start gap-4">
                      <div className="flex flex-col items-center">
                        <div className="w-8 h-8 rounded-full bg-white border-2 border-current flex items-center justify-center font-semibold text-sm">
                          {step.step_order}
                        </div>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Icon className="h-4 w-4" />
                          <div className="font-semibold">
                            {STEP_TYPE_LABELS[step.step_type] || step.step_type}
                          </div>
                          {step.channel && (
                            <Badge variant="outline" className="text-xs font-mono">
                              via {step.channel}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-xs ml-auto">
                            <Clock className="h-3 w-3 mr-1" />
                            {formatDelay(step.delay_minutes || 0)}
                          </Badge>
                        </div>
                        {step.template_key && (
                          <div className="text-xs mt-2 opacity-70 flex items-center gap-1">
                            <span className="font-mono bg-white/60 px-1.5 py-0.5 rounded border">
                              template: {step.template_key}
                            </span>
                          </div>
                        )}
                        {step.template_inline && (
                          <div className="text-sm mt-2 italic opacity-80 bg-white/50 p-2 rounded border">
                            "{step.template_inline}"
                          </div>
                        )}
                        {step.condition && (
                          <div className="text-xs mt-2 font-mono opacity-70 flex items-center gap-1">
                            <GitBranch className="h-3 w-3" />
                            <span>only if: {step.condition.field} {step.condition.operator} {JSON.stringify(step.condition.value)}</span>
                          </div>
                        )}
                        {step.success_condition && (
                          <div className="text-xs mt-2 font-mono opacity-70">
                            Branch: if {step.success_condition.field} {step.success_condition.op}{" "}
                            {step.success_condition.value}
                          </div>
                        )}
                        {step.max_attempts > 1 && (
                          <div className="text-xs mt-1 opacity-70">
                            Retry up to {step.max_attempts} times, {step.retry_delay_minutes} min apart
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
                {!isLast && (
                  <div className="flex justify-center py-1">
                    <ArrowDown className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent runs */}
      {recent_runs && recent_runs.length > 0 && (
        <div className="mt-10">
          <h2 className="text-lg font-semibold mb-4">Recent Runs</h2>
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/30">
                  <tr className="text-left">
                    <th className="p-3 font-medium">Lead</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium">Current Step</th>
                    <th className="p-3 font-medium">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {recent_runs.map((run: any) => (
                    <tr
                      key={run.id}
                      className="border-b hover:bg-muted/20 cursor-pointer"
                      onClick={() => setLocation(`/intake/deals/${run.lead_id}`)}
                      data-testid={`row-recent-run-${run.id}`}
                    >
                      <td className="p-3">
                        <div className="font-medium">{run.lead_name || `Lead #${run.lead_id}`}</div>
                        <div className="text-xs text-muted-foreground">{run.lead_phone}</div>
                      </td>
                      <td className="p-3">
                        {run.status === "running" && (
                          <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">
                            <Play className="h-3 w-3 mr-1" />
                            Running
                          </Badge>
                        )}
                        {run.status === "completed" && (
                          <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Completed
                          </Badge>
                        )}
                        {run.status === "failed" && <Badge variant="destructive">Failed</Badge>}
                        {run.status === "paused" && <Badge variant="secondary">Paused</Badge>}
                      </td>
                      <td className="p-3 text-xs">
                        Step {run.current_step_order ?? "—"} ({run.current_step_type ?? "n/a"})
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {new Date(run.started_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
