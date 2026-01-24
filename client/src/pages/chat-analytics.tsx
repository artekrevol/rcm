import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MessageCircle,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  Calendar,
  TrendingUp,
  ArrowRight,
  BarChart3,
  Target,
  AlertCircle,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import type { ChatSession } from "@shared/schema";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

interface ChatStats {
  totalSessions: number;
  completedSessions: number;
  abandonedSessions: number;
  activeSessions: number;
  leadsGenerated: number;
  appointmentsBooked: number;
  avgSessionDuration: number;
  conversionRate: number;
  dropoffByStep: Record<string, number>;
}

const COLORS = ["#22c55e", "#ef4444", "#f59e0b", "#3b82f6"];

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function MetricCard({ 
  title, 
  value, 
  subtitle, 
  icon: Icon, 
  trend,
  color = "text-primary"
}: { 
  title: string; 
  value: string | number; 
  subtitle?: string; 
  icon: React.ElementType;
  trend?: { value: number; isPositive: boolean };
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            )}
          </div>
          <div className="p-2 rounded-lg bg-muted">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>
        {trend && (
          <div className={`flex items-center gap-1 mt-2 text-sm ${trend.isPositive ? 'text-green-600' : 'text-red-600'}`}>
            <TrendingUp className={`h-4 w-4 ${!trend.isPositive ? 'rotate-180' : ''}`} />
            <span>{trend.isPositive ? '+' : ''}{trend.value}% vs last week</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ChatAnalyticsPage() {
  const { data: stats, isLoading: statsLoading } = useQuery<ChatStats>({
    queryKey: ["/api/chat-analytics/stats"],
  });

  const { data: sessions, isLoading: sessionsLoading } = useQuery<ChatSession[]>({
    queryKey: ["/api/chat-sessions"],
  });

  const sessionStatusData = stats ? [
    { name: "Completed", value: stats.completedSessions, color: "#22c55e" },
    { name: "Abandoned", value: stats.abandonedSessions, color: "#ef4444" },
    { name: "Active", value: stats.activeSessions, color: "#3b82f6" },
  ].filter(d => d.value > 0) : [];

  const dropoffData = stats ? Object.entries(stats.dropoffByStep).map(([step, count]) => ({
    step: step.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    count,
  })).sort((a, b) => b.count - a.count).slice(0, 6) : [];

  const stepLabels: Record<string, string> = {
    welcome: "Welcome",
    service_type: "Service Selection",
    urgency: "Urgency",
    has_insurance: "Insurance Check",
    insurance_carrier: "Insurance Carrier",
    member_id: "Member ID",
    name: "Name",
    phone: "Phone",
    email: "Email",
    best_time: "Best Time to Call",
    schedule_preference: "Schedule Preference",
    appointment_picker: "Appointment",
    confirmation: "Confirmation",
    complete: "Complete",
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold" data-testid="text-page-title">Chat Analytics</h1>
          <p className="text-muted-foreground mt-1">
            Track chat widget performance and visitor engagement
          </p>
        </div>
        <Badge variant="outline" className="text-xs">
          Last updated: {format(new Date(), "MMM d, h:mm a")}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsLoading ? (
          [...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))
        ) : stats ? (
          <>
            <MetricCard
              title="Total Conversations"
              value={stats.totalSessions}
              subtitle="All chat sessions"
              icon={MessageCircle}
            />
            <MetricCard
              title="Leads Generated"
              value={stats.leadsGenerated}
              subtitle={`${stats.conversionRate}% conversion rate`}
              icon={Users}
              color="text-green-600"
            />
            <MetricCard
              title="Appointments Booked"
              value={stats.appointmentsBooked}
              subtitle="Via chat widget"
              icon={Calendar}
              color="text-blue-600"
            />
            <MetricCard
              title="Avg. Duration"
              value={formatDuration(stats.avgSessionDuration)}
              subtitle="Per completed session"
              icon={Clock}
            />
          </>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Conversion Funnel
            </CardTitle>
            <CardDescription>Session outcomes breakdown</CardDescription>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : sessionStatusData.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={sessionStatusData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {sessionStatusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground">
                No session data yet
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Drop-off Points
            </CardTitle>
            <CardDescription>Where visitors abandon the chat</CardDescription>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : dropoffData.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dropoffData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis 
                      type="category" 
                      dataKey="step" 
                      width={100}
                      tick={{ fontSize: 12 }}
                    />
                    <Tooltip />
                    <Bar dataKey="count" fill="#ef4444" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground">
                No drop-off data yet
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Recent Conversations
              </CardTitle>
              <CardDescription>Latest chat widget sessions</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {sessionsLoading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : sessions && sessions.length > 0 ? (
            <ScrollArea className="h-96">
              <div className="space-y-3">
                {sessions.slice(0, 20).map((session) => (
                  <div
                    key={session.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover-elevate"
                    data-testid={`row-session-${session.id}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-full ${
                        session.status === 'completed' ? 'bg-green-100 dark:bg-green-900' :
                        session.status === 'abandoned' ? 'bg-red-100 dark:bg-red-900' :
                        'bg-blue-100 dark:bg-blue-900'
                      }`}>
                        {session.status === 'completed' ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : session.status === 'abandoned' ? (
                          <XCircle className="h-4 w-4 text-red-600" />
                        ) : (
                          <Clock className="h-4 w-4 text-blue-600" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            Session #{session.id.slice(0, 8)}
                          </span>
                          <Badge 
                            variant={session.status === 'completed' ? 'default' : 
                                    session.status === 'abandoned' ? 'destructive' : 'secondary'}
                            className="text-xs"
                          >
                            {session.status}
                          </Badge>
                          {session.leadId && (
                            <Badge variant="outline" className="text-xs text-green-600">
                              Lead Created
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Last step: {stepLabels[session.currentStepId] || session.currentStepId}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">
                        {formatDistanceToNow(new Date(session.startedAt), { addSuffix: true })}
                      </p>
                      {session.qualificationScore && (
                        <p className="text-xs text-muted-foreground">
                          Score: {session.qualificationScore}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <MessageCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No chat sessions yet</p>
              <p className="text-sm">Start a conversation using the chat widget to see analytics</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
