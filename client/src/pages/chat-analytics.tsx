import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  Search,
  Download,
  Filter,
  ChevronLeft,
  ChevronRight,
  Phone,
  Mail,
  Eye,
} from "lucide-react";
import { format, formatDistanceToNow, subDays, isAfter, isBefore, parseISO } from "date-fns";
import type { ChatSession, Lead } from "@shared/schema";
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
  LineChart,
  Line,
  Area,
  AreaChart,
} from "recharts";
import { Link } from "wouter";

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

interface CallStats {
  totalCalls: number;
  answeredCalls: number;
  missedCalls: number;
  voicemailCalls: number;
  avgDuration: number;
  answeredRate: number;
  missedRate: number;
  voicemailRate: number;
}

interface TimeSeriesData {
  date: string;
  formattedDate: string;
  sessions: number;
  leads: number;
  appointments: number;
}

interface SessionWithLead extends ChatSession {
  lead?: Lead;
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

const ITEMS_PER_PAGE = 20;

export default function ChatAnalyticsPage() {
  const [activeTab, setActiveTab] = useState("analytics");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("30");
  const [currentPage, setCurrentPage] = useState(1);

  const { data: stats, isLoading: statsLoading } = useQuery<ChatStats>({
    queryKey: ["/api/chat-analytics/stats"],
  });

  const { data: callStats } = useQuery<CallStats>({
    queryKey: ["/api/calls-analytics/stats"],
  });

  const { data: timeSeries, isLoading: timeSeriesLoading } = useQuery<TimeSeriesData[]>({
    queryKey: ["/api/chat-analytics/timeseries", dateFilter],
  });

  const { data: sessions, isLoading: sessionsLoading } = useQuery<SessionWithLead[]>({
    queryKey: ["/api/chat-sessions"],
  });

  const { data: leads } = useQuery<Lead[]>({
    queryKey: ["/api/leads"],
  });

  // Create a map of leads by ID for quick lookup
  const leadsMap = useMemo(() => {
    if (!leads) return new Map();
    return new Map(leads.map(lead => [lead.id, lead]));
  }, [leads]);

  // Enrich sessions with lead data
  const enrichedSessions = useMemo(() => {
    if (!sessions) return [];
    return sessions.map(session => ({
      ...session,
      lead: session.leadId ? leadsMap.get(session.leadId) : undefined,
    }));
  }, [sessions, leadsMap]);

  // Filter sessions
  const filteredSessions = useMemo(() => {
    let filtered = enrichedSessions;
    
    // Date filter
    if (dateFilter !== "all") {
      const daysAgo = parseInt(dateFilter);
      const cutoffDate = subDays(new Date(), daysAgo);
      filtered = filtered.filter(s => isAfter(new Date(s.startedAt), cutoffDate));
    }
    
    // Status filter
    if (statusFilter !== "all") {
      filtered = filtered.filter(s => s.status === statusFilter);
    }
    
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(s => 
        s.lead?.name?.toLowerCase().includes(query) ||
        s.lead?.email?.toLowerCase().includes(query) ||
        s.lead?.phone?.includes(query) ||
        s.id.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  }, [enrichedSessions, dateFilter, statusFilter, searchQuery]);

  // Pagination
  const totalPages = Math.ceil(filteredSessions.length / ITEMS_PER_PAGE);
  const paginatedSessions = filteredSessions.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

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

  const getStatusBadge = (status: string, hasLead: boolean) => {
    if (status === "completed" && hasLead) {
      return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">Submitted</Badge>;
    }
    if (status === "completed") {
      return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100">Completed</Badge>;
    }
    if (status === "abandoned") {
      return <Badge variant="destructive">Abandoned</Badge>;
    }
    return <Badge variant="secondary">Active</Badge>;
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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="analytics" data-testid="tab-analytics">
            <BarChart3 className="h-4 w-4 mr-2" />
            Analytics
          </TabsTrigger>
          <TabsTrigger value="conversations" data-testid="tab-conversations">
            <MessageCircle className="h-4 w-4 mr-2" />
            All Conversations
          </TabsTrigger>
        </TabsList>

        <TabsContent value="analytics" className="space-y-6">
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

          {/* Time Series Chart */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Leads vs. Appointments
                  </CardTitle>
                  <CardDescription>Daily activity over the last {dateFilter} days</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="gap-1">
                    <div className="h-2 w-2 rounded-full bg-green-500" />
                    Leads
                  </Badge>
                  <Badge variant="outline" className="gap-1">
                    <div className="h-2 w-2 rounded-full bg-blue-500" />
                    Appointments
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {timeSeriesLoading ? (
                <Skeleton className="h-72 w-full" />
              ) : timeSeries && timeSeries.length > 0 ? (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timeSeries}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis 
                        dataKey="formattedDate" 
                        tick={{ fontSize: 11 }}
                        tickLine={false}
                        interval="preserveStartEnd"
                      />
                      <YAxis 
                        tick={{ fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--background))',
                          borderColor: 'hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="leads" 
                        stroke="#22c55e" 
                        fill="#22c55e" 
                        fillOpacity={0.2}
                        strokeWidth={2}
                        name="Leads"
                      />
                      <Area 
                        type="monotone" 
                        dataKey="appointments" 
                        stroke="#3b82f6" 
                        fill="#3b82f6" 
                        fillOpacity={0.2}
                        strokeWidth={2}
                        name="Appointments"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-72 flex items-center justify-center text-muted-foreground">
                  No time series data yet
                </div>
              )}
            </CardContent>
          </Card>

          {/* Call Performance - Only show if there are calls */}
          {callStats && callStats.totalCalls > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Phone className="h-5 w-5" />
                  Call Performance
                </CardTitle>
                <CardDescription>AI voice call statistics</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: "Answered", value: callStats.answeredCalls, color: "#22c55e" },
                            { name: "Missed", value: callStats.missedCalls, color: "#ef4444" },
                            { name: "Voicemail", value: callStats.voicemailCalls, color: "#f59e0b" },
                          ].filter(d => d.value > 0)}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={2}
                          dataKey="value"
                        >
                          {[
                            { name: "Answered", value: callStats.answeredCalls, color: "#22c55e" },
                            { name: "Missed", value: callStats.missedCalls, color: "#ef4444" },
                            { name: "Voicemail", value: callStats.voicemailCalls, color: "#f59e0b" },
                          ].filter(d => d.value > 0).map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-4">
                    <div className="text-center p-4 bg-muted/30 rounded-lg">
                      <p className="text-4xl font-bold">{formatDuration(callStats.avgDuration)}</p>
                      <p className="text-sm text-muted-foreground">avg. call duration</p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="p-2 rounded-lg bg-green-50 dark:bg-green-950">
                        <p className="text-lg font-bold text-green-600">{callStats.answeredRate}%</p>
                        <p className="text-xs text-muted-foreground">Answered</p>
                      </div>
                      <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950">
                        <p className="text-lg font-bold text-red-600">{callStats.missedRate}%</p>
                        <p className="text-xs text-muted-foreground">Missed</p>
                      </div>
                      <div className="p-2 rounded-lg bg-yellow-50 dark:bg-yellow-950">
                        <p className="text-lg font-bold text-yellow-600">{callStats.voicemailRate}%</p>
                        <p className="text-xs text-muted-foreground">Voicemail</p>
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold">{callStats.totalCalls}</p>
                      <p className="text-sm text-muted-foreground">total calls</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="conversations" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <CardTitle className="text-2xl">All Conversations</CardTitle>
                  <CardDescription>
                    View and filter all chat sessions
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" data-testid="button-export">
                    <Download className="h-4 w-4 mr-2" />
                    Export CSV
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Filters */}
              <div className="flex flex-wrap gap-3 items-center p-4 bg-muted/30 rounded-lg">
                <div className="flex items-center gap-2">
                  <Select value={dateFilter} onValueChange={setDateFilter}>
                    <SelectTrigger className="w-[180px]" data-testid="select-date-filter">
                      <Calendar className="h-4 w-4 mr-2" />
                      <SelectValue placeholder="Date range" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7">Last 7 days</SelectItem>
                      <SelectItem value="30">Last 30 days</SelectItem>
                      <SelectItem value="90">Last 90 days</SelectItem>
                      <SelectItem value="365">Last year</SelectItem>
                      <SelectItem value="all">All time</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="flex items-center gap-2">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[150px]" data-testid="select-status-filter">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any status</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="abandoned">Abandoned</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex-1 min-w-[200px]">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name, email, or phone..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                      data-testid="input-search"
                    />
                  </div>
                </div>

                {(statusFilter !== "all" || dateFilter !== "30" || searchQuery) && (
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => {
                      setStatusFilter("all");
                      setDateFilter("30");
                      setSearchQuery("");
                      setCurrentPage(1);
                    }}
                    data-testid="button-clear-filters"
                  >
                    Clear Filters
                  </Button>
                )}
              </div>

              {/* Table */}
              {sessionsLoading ? (
                <div className="space-y-4">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : paginatedSessions.length > 0 ? (
                <>
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead className="font-semibold">Prospect</TableHead>
                          <TableHead className="font-semibold">Contact</TableHead>
                          <TableHead className="font-semibold">Source</TableHead>
                          <TableHead className="font-semibold">Status</TableHead>
                          <TableHead className="font-semibold">Created</TableHead>
                          <TableHead className="font-semibold">Updated</TableHead>
                          <TableHead className="w-[80px]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedSessions.map((session) => (
                          <TableRow key={session.id} className="hover-elevate" data-testid={`row-conversation-${session.id}`}>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <div className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-medium ${
                                  session.lead 
                                    ? 'bg-primary/10 text-primary' 
                                    : 'bg-muted text-muted-foreground'
                                }`}>
                                  {session.lead?.name 
                                    ? session.lead.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
                                    : '?'
                                  }
                                </div>
                                <div>
                                  <p className="font-medium">
                                    {session.lead?.name || `Visitor #${session.id.slice(0, 8)}`}
                                  </p>
                                  {session.collectedData?.serviceNeeded && (
                                    <p className="text-xs text-muted-foreground">
                                      {(session.collectedData.serviceNeeded as string).replace(/_/g, ' ')}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              {session.lead ? (
                                <div className="space-y-1">
                                  <div className="flex items-center gap-1.5 text-sm">
                                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                                    <a href={`tel:${session.lead.phone}`} className="text-primary hover:underline">
                                      {session.lead.phone}
                                    </a>
                                  </div>
                                  <div className="flex items-center gap-1.5 text-sm">
                                    <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                                    <a href={`mailto:${session.lead.email}`} className="text-primary hover:underline">
                                      {session.lead.email}
                                    </a>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-muted-foreground text-sm">Not provided</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="font-normal">
                                Web Assistant
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {getStatusBadge(session.status, !!session.leadId)}
                            </TableCell>
                            <TableCell className="text-sm">
                              <div>
                                {format(new Date(session.startedAt), "MMM d, yyyy")}
                              </div>
                              <div className="text-muted-foreground text-xs">
                                {format(new Date(session.startedAt), "h:mm a")}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm">
                              <div>
                                {format(new Date(session.lastActivityAt || session.startedAt), "MMM d, yyyy")}
                              </div>
                              <div className="text-muted-foreground text-xs">
                                {format(new Date(session.lastActivityAt || session.startedAt), "h:mm a")}
                              </div>
                            </TableCell>
                            <TableCell>
                              {session.leadId ? (
                                <Link href={`/leads/${session.leadId}`}>
                                  <Button variant="ghost" size="icon" data-testid={`button-view-${session.id}`}>
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                </Link>
                              ) : (
                                <Button variant="ghost" size="icon" disabled>
                                  <Eye className="h-4 w-4 opacity-50" />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Pagination */}
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, filteredSessions.length)} of {filteredSessions.length} conversations
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        data-testid="button-prev-page"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <div className="flex items-center gap-1">
                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                          let pageNum: number;
                          if (totalPages <= 5) {
                            pageNum = i + 1;
                          } else if (currentPage <= 3) {
                            pageNum = i + 1;
                          } else if (currentPage >= totalPages - 2) {
                            pageNum = totalPages - 4 + i;
                          } else {
                            pageNum = currentPage - 2 + i;
                          }
                          return (
                            <Button
                              key={pageNum}
                              variant={currentPage === pageNum ? "default" : "outline"}
                              size="sm"
                              onClick={() => setCurrentPage(pageNum)}
                              className="w-8"
                              data-testid={`button-page-${pageNum}`}
                            >
                              {pageNum}
                            </Button>
                          );
                        })}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        data-testid="button-next-page"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <MessageCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No conversations found</p>
                  <p className="text-sm">Try adjusting your filters or start a conversation using the chat widget</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
