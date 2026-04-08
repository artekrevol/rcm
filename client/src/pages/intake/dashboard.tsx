import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, UserPlus, Phone, MessageCircle, CalendarDays, AlertTriangle, Clock } from "lucide-react";
import { format } from "date-fns";

interface PipelineStatus {
  status: string;
  count: number;
  sla_breach_count: number;
}

interface Appointment {
  id: string;
  title: string;
  lead_name: string | null;
  scheduled_at: string;
  status: string;
}

interface ChatSession {
  id: string;
  lead_name: string | null;
  status: string;
  started_at: string;
}

interface IntakeDashboardData {
  pipeline: PipelineStatus[];
  todayAppointments: Appointment[];
  recentChats: ChatSession[];
}

const PIPELINE_ORDER = ["new", "attempting_contact", "contacted", "qualified", "converted"];
const PIPELINE_LABELS: Record<string, string> = {
  new: "New",
  attempting_contact: "Attempting Contact",
  contacted: "Contacted",
  qualified: "Qualified",
  converted: "Converted",
};
const PIPELINE_COLORS: Record<string, string> = {
  new: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  attempting_contact: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  contacted: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  qualified: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  converted: "bg-green-500/10 text-green-700 dark:text-green-400",
};

export default function IntakeDashboard() {
  const [, navigate] = useLocation();

  const { data, isLoading } = useQuery<IntakeDashboardData>({
    queryKey: ["/api/intake/dashboard/stats"],
    queryFn: () => fetch("/api/intake/dashboard/stats", { credentials: "include" }).then(r => r.json()),
  });

  const pipelineMap = new Map((data?.pipeline || []).map(p => [p.status, p]));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Intake Dashboard</h1>
          <p className="text-muted-foreground text-sm">Lead pipeline overview and today's activity</p>
        </div>
        <Button onClick={() => navigate("/intake/deals")} className="gap-2" data-testid="button-add-lead">
          <UserPlus className="h-4 w-4" />
          Add New Lead
        </Button>
      </div>

      <div data-testid="section-pipeline">
        <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wide">Lead Pipeline</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
              ))
            : PIPELINE_ORDER.map((status) => {
                const item = pipelineMap.get(status);
                const count = item?.count || 0;
                const breaches = item?.sla_breach_count || 0;
                const showBreach = (status === "attempting_contact" || status === "contacted") && breaches > 0;
                return (
                  <Card
                    key={status}
                    data-testid={`card-pipeline-${status}`}
                    className="cursor-pointer hover:border-primary transition-colors"
                    onClick={() => navigate(`/intake/deals?status=${status}`)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PIPELINE_COLORS[status] || ""}`}>
                          {PIPELINE_LABELS[status]}
                        </span>
                        {showBreach && (
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-5 gap-1" data-testid={`badge-sla-${status}`}>
                            <AlertTriangle className="h-3 w-3" />
                            {breaches} SLA
                          </Badge>
                        )}
                      </div>
                      <p className="text-3xl font-bold" data-testid={`text-count-${status}`}>{count}</p>
                    </CardContent>
                  </Card>
                );
              })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="section-appointments">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              Today's Appointments
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : !data?.todayAppointments?.length ? (
              <p className="text-sm text-muted-foreground py-6 text-center" data-testid="text-no-appointments">No appointments scheduled for today</p>
            ) : (
              <div className="space-y-2">
                {data.todayAppointments.map((apt) => (
                  <div key={apt.id} className="flex items-center justify-between border rounded-lg px-3 py-2" data-testid={`row-appointment-${apt.id}`}>
                    <div className="flex items-center gap-3">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{apt.lead_name || apt.title || "Appointment"}</p>
                        <p className="text-xs text-muted-foreground">{apt.title}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">{format(new Date(apt.scheduled_at), "h:mm a")}</p>
                      <Badge variant="outline" className="text-[10px]">{apt.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="section-chats">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-muted-foreground" />
              Recent Chat Sessions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : !data?.recentChats?.length ? (
              <p className="text-sm text-muted-foreground py-6 text-center" data-testid="text-no-chats">No recent chat sessions</p>
            ) : (
              <div className="space-y-2">
                {data.recentChats.map((chat) => (
                  <div key={chat.id} className="flex items-center justify-between border rounded-lg px-3 py-2" data-testid={`row-chat-${chat.id}`}>
                    <div className="flex items-center gap-3">
                      <MessageCircle className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{chat.lead_name || `Session ${chat.id.slice(0, 8)}`}</p>
                        <p className="text-xs text-muted-foreground">{format(new Date(chat.started_at), "MMM d, h:mm a")}</p>
                      </div>
                    </div>
                    <Badge variant={chat.status === "completed" ? "default" : chat.status === "abandoned" ? "destructive" : "outline"} className="text-[10px]">
                      {chat.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
