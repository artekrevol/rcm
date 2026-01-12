import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LeadStatusBadge } from "@/components/status-badge";
import { CallModal } from "@/components/call-modal";
import { LeadFormDialog } from "@/components/lead-form-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  ArrowLeft,
  Phone,
  Mail,
  MapPin,
  Calendar,
  FileText,
  Building2,
  CreditCard,
  MessageSquare,
  Plus,
  Clock,
  Shield,
  CheckCircle2,
  AlertCircle,
  Edit3,
  Save,
  ChevronDown,
  ChevronUp,
  Activity,
  Target,
  User,
  AlertTriangle,
  CheckCircle,
  PhoneCall,
  Pencil,
  PlayCircle,
  RefreshCw,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import type { Lead, Call, Patient } from "@shared/schema";

function PriorityBadge({ priority }: { priority: string }) {
  const variants: Record<string, string> = {
    P0: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0",
    P1: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0",
    P2: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-0",
  };
  return (
    <Badge variant="outline" className={variants[priority] || variants.P2}>
      {priority}
    </Badge>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  variant = "default",
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  variant?: "default" | "success" | "warning" | "danger";
}) {
  const variantStyles = {
    default: "text-muted-foreground",
    success: "text-emerald-600 dark:text-emerald-400",
    warning: "text-amber-600 dark:text-amber-400",
    danger: "text-red-600 dark:text-red-400",
  };
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
      <div className={`shrink-0 ${variantStyles[variant]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold">{value}</p>
      </div>
    </div>
  );
}

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [callModalOpen, setCallModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [expandedTranscripts, setExpandedTranscripts] = useState<Set<string>>(new Set());

  const { data: lead, isLoading: leadLoading } = useQuery<Lead>({
    queryKey: ["/api/leads", id],
  });

  const { data: calls } = useQuery<Call[]>({
    queryKey: ["/api/leads", id, "calls"],
  });

  const { data: patient } = useQuery<Patient | null>({
    queryKey: ["/api/leads", id, "patient"],
  });

  const updateLeadMutation = useMutation({
    mutationFn: async (updates: Partial<Lead>) => {
      return apiRequest("PATCH", `/api/leads/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/worklist"] });
      toast({ title: "Lead updated" });
    },
    onError: () => {
      toast({ title: "Failed to update lead", variant: "destructive" });
    },
  });

  const updateCallMutation = useMutation({
    mutationFn: async ({ callId, notes }: { callId: string; notes: string }) => {
      return apiRequest("PATCH", `/api/calls/${callId}`, { notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", id, "calls"] });
      toast({ title: "Notes saved" });
      setEditingNoteId(null);
    },
    onError: () => {
      toast({ title: "Failed to save notes", variant: "destructive" });
    },
  });

  const createClaimPacketMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/leads/${id}/claim-packet`);
    },
    onSuccess: (data: any) => {
      toast({ title: "Claim packet created" });
      setLocation(`/claims/${data.claimId}`);
    },
    onError: () => {
      toast({ title: "Failed to create claim packet", variant: "destructive" });
    },
  });

  const refreshCallMutation = useMutation({
    mutationFn: async (callId: string) => {
      const response = await apiRequest("POST", `/api/calls/${callId}/refresh`);
      // Handle 204 no content gracefully
      if (response.status === 204) {
        return { refreshed: false };
      }
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", id, "calls"] });
      if (data?.refreshed) {
        toast({ title: "Call data refreshed from Vapi" });
      } else {
        toast({ title: "No new data available yet", description: "Try again in a few moments" });
      }
    },
    onError: () => {
      toast({ title: "Failed to refresh call data", variant: "destructive" });
    },
  });

  const syncPatientMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/leads/${id}/sync-patient`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads/worklist"] });
      toast({ title: "Patient data synced to lead" });
    },
    onError: () => {
      toast({ title: "Failed to sync patient data", variant: "destructive" });
    },
  });

  const handleCallComplete = async (data: {
    transcript: string;
    summary: string;
    disposition: string;
    duration?: number;
    extractedData: any;
    vobData?: any;
  }) => {
    await apiRequest("POST", `/api/leads/${id}/call`, {
      transcript: data.transcript,
      summary: data.summary,
      disposition: data.disposition,
      duration: data.duration,
      extractedData: data.extractedData,
      vobData: data.vobData,
    });
    queryClient.invalidateQueries({ queryKey: ["/api/leads", id] });
    queryClient.invalidateQueries({ queryKey: ["/api/leads", id, "calls"] });
    queryClient.invalidateQueries({ queryKey: ["/api/leads", id, "patient"] });
    queryClient.invalidateQueries({ queryKey: ["/api/leads/worklist"] });
    toast({ title: "Call saved successfully" });
  };

  const toggleTranscript = (callId: string) => {
    setExpandedTranscripts((prev) => {
      const next = new Set(prev);
      if (next.has(callId)) {
        next.delete(callId);
      } else {
        next.add(callId);
      }
      return next;
    });
  };

  const startEditingNote = (call: Call) => {
    setEditingNoteId(call.id);
    setNoteText(call.notes || "");
  };

  const saveNote = (callId: string) => {
    updateCallMutation.mutate({ callId, notes: noteText });
  };

  const formatDuration = (seconds?: number | null) => {
    if (!seconds) return null;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const handleQuickAction = (action: string) => {
    switch (action) {
      case "mark_contacted":
        updateLeadMutation.mutate({
          status: "contacted",
          lastContactedAt: new Date().toISOString(),
          attemptCount: (lead?.attemptCount || 0) + 1,
        } as any);
        break;
      case "mark_qualified":
        updateLeadMutation.mutate({ status: "qualified" } as any);
        break;
      case "mark_lost":
        updateLeadMutation.mutate({ status: "lost" } as any);
        break;
    }
  };

  if (leadLoading) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="grid grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Lead not found</p>
      </div>
    );
  }

  const latestCall = calls?.[0];
  const extractedData = latestCall?.extractedData;
  const vobData = latestCall?.vobData;
  const vobScore = lead.vobScore || 0;
  const vobVariant = vobScore >= 75 ? "success" : vobScore >= 50 ? "warning" : "danger";

  return (
    <div className="p-4 space-y-4">
      {/* Header Strip */}
      <div className="flex items-center justify-between gap-4 pb-2 border-b">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/leads")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-semibold">{lead.name}</h1>
                <LeadStatusBadge status={lead.status} />
                <PriorityBadge priority={lead.priority || "P2"} />
                {/* Claim Risk Preview Badge */}
                <Badge 
                  variant="outline" 
                  className={
                    vobScore >= 75 
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0" 
                      : vobScore >= 50 
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0"
                        : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0"
                  }
                >
                  {vobScore >= 75 ? "Low Risk" : vobScore >= 50 ? "Medium Risk" : "High Risk"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {lead.phone} {lead.email && `• ${lead.email}`}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleQuickAction("mark_contacted")}
            disabled={updateLeadMutation.isPending}
            data-testid="button-mark-contacted"
          >
            <Clock className="h-4 w-4 mr-1" />
            Mark Contacted
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleQuickAction("mark_qualified")}
            disabled={updateLeadMutation.isPending}
            data-testid="button-mark-qualified"
          >
            <CheckCircle className="h-4 w-4 mr-1" />
            Qualified
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditModalOpen(true)}
            data-testid="button-edit-lead"
          >
            <Pencil className="h-4 w-4 mr-1" />
            Edit
          </Button>
          <Button
            variant="default"
            size="sm"
            className="gap-1"
            onClick={() => setCallModalOpen(true)}
            data-testid="button-call-lead"
          >
            <Phone className="h-4 w-4" />
            Call
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  size="sm"
                  onClick={() => createClaimPacketMutation.mutate()}
                  disabled={createClaimPacketMutation.isPending || !patient || vobScore < 100}
                  data-testid="button-create-claim"
                  className={vobScore >= 100 ? "bg-emerald-600 hover:bg-emerald-700" : ""}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Create Claim (Pre-Filled)
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {vobScore >= 100 ? (
                <p className="text-xs">VOB complete - ready to create claim</p>
              ) : (
                <p className="text-xs text-amber-500">Requires 100% VOB completeness ({vobScore}% complete)</p>
              )}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">VOB Completeness</span>
            <Activity className={`h-4 w-4 ${vobVariant === "success" ? "text-emerald-500" : vobVariant === "warning" ? "text-amber-500" : "text-red-500"}`} />
          </div>
          <div className="space-y-2">
            <p className="text-2xl font-bold">{vobScore}%</p>
            <Progress value={vobScore} className="h-2" />
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Attempts</span>
            <PhoneCall className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-2xl font-bold">{lead.attemptCount || 0}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {lead.lastContactedAt
              ? `Last: ${formatDistanceToNow(new Date(lead.lastContactedAt), { addSuffix: true })}`
              : "No contact yet"}
          </p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Next Action</span>
            <Target className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">{lead.nextAction || "Not set"}</p>
          {lead.nextActionAt && (
            <p className="text-xs text-muted-foreground mt-1">
              Due: {format(new Date(lead.nextActionAt), "MMM d, h:mm a")}
            </p>
          )}
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Last Outcome</span>
            {lead.lastOutcome === "success" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : lead.lastOutcome === "no_answer" ? (
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            ) : (
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <p className="text-sm font-medium capitalize">{lead.lastOutcome?.replace(/_/g, " ") || "None"}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Created {format(new Date(lead.createdAt), "MMM d, yyyy")}
          </p>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="calls" data-testid="tab-calls">
            Calls {calls && calls.length > 0 && <Badge variant="secondary" className="ml-1 h-5 px-1.5">{calls.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="insurance" data-testid="tab-insurance">Insurance</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Contact Info */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Contact Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{lead.phone}</span>
                </div>
                {lead.email && (
                  <div className="flex items-center gap-3">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{lead.email}</span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm capitalize">Source: {lead.source}</span>
                </div>
              </CardContent>
            </Card>

            {/* Service Info */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Service Request</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Service Needed</p>
                    <p className="text-sm font-medium">
                      {lead.serviceNeeded || extractedData?.serviceType || "Not specified"}
                    </p>
                  </div>
                </div>
                {lead.planType && (
                  <div className="flex items-center gap-3">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Plan Type</p>
                      <p className="text-sm font-medium">{lead.planType}</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Handoff Status */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Workflow Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">VOB Status</span>
                  <Badge variant="outline" className={
                    lead.vobStatus === "complete" 
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0"
                      : lead.vobStatus === "in_progress"
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0"
                      : ""
                  }>
                    {lead.vobStatus || "pending"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Handoff</span>
                  <Badge variant="outline" className={
                    lead.handoffStatus === "complete"
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0"
                      : ""
                  }>
                    {lead.handoffStatus || "not_started"}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent Activity */}
          {latestCall && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Latest Call</CardTitle>
                <CardDescription>
                  {format(new Date(latestCall.createdAt), "MMMM d, yyyy 'at' h:mm a")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-start gap-3">
                  <Badge variant="outline" className="capitalize shrink-0">
                    {latestCall.disposition}
                  </Badge>
                  <p className="text-sm text-muted-foreground">{latestCall.summary}</p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="calls" className="space-y-4">
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium">Call History</CardTitle>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => setCallModalOpen(true)}
              >
                <Phone className="h-4 w-4" />
                New Call
              </Button>
            </CardHeader>
            <CardContent>
              {calls && calls.length > 0 ? (
                <div className="space-y-4">
                  {calls.map((call) => (
                    <div key={call.id} className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="capitalize">
                              {call.disposition}
                            </Badge>
                            <span className="text-sm text-muted-foreground">
                              {format(new Date(call.createdAt), "MMM d, yyyy 'at' h:mm a")}
                            </span>
                            {call.duration && (
                              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                                <Clock className="h-3 w-3" />
                                {formatDuration(call.duration)}
                              </span>
                            )}
                            {call.vapiCallId && call.disposition === "in_progress" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 gap-1 text-xs"
                                onClick={() => refreshCallMutation.mutate(call.id)}
                                disabled={refreshCallMutation.isPending}
                                data-testid={`button-refresh-call-${call.id}`}
                              >
                                <RefreshCw className={`h-3 w-3 ${refreshCallMutation.isPending ? 'animate-spin' : ''}`} />
                                Refresh
                              </Button>
                            )}
                          </div>
                          <p className="text-sm mt-2">{call.summary}</p>
                        </div>
                      </div>

                      {call.transcript && (
                        <div className="bg-muted/50 rounded-lg overflow-hidden">
                          <button
                            onClick={() => toggleTranscript(call.id)}
                            className="w-full flex items-center justify-between p-3 text-left hover-elevate"
                            data-testid={`button-toggle-transcript-${call.id}`}
                          >
                            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              Transcript
                            </span>
                            {expandedTranscripts.has(call.id) ? (
                              <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )}
                          </button>
                          {expandedTranscripts.has(call.id) && (
                            <div className="px-4 pb-4">
                              <div className="text-sm whitespace-pre-wrap font-mono text-xs leading-relaxed max-h-64 overflow-y-auto">
                                {call.transcript}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {call.recordingUrl && (
                        <div className="bg-muted/50 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <PlayCircle className="h-4 w-4 text-muted-foreground" />
                            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              Recording
                            </span>
                          </div>
                          <audio
                            controls
                            className="w-full h-10"
                            src={call.recordingUrl}
                            data-testid={`audio-recording-${call.id}`}
                          >
                            Your browser does not support audio playback.
                          </audio>
                        </div>
                      )}

                      <div className="bg-muted/30 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Notes
                          </span>
                          {editingNoteId !== call.id ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => startEditingNote(call)}
                              className="h-7 gap-1"
                              data-testid={`button-edit-notes-${call.id}`}
                            >
                              <Edit3 className="h-3 w-3" />
                              Edit
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => saveNote(call.id)}
                              className="h-7 gap-1"
                              disabled={updateCallMutation.isPending}
                              data-testid={`button-save-notes-${call.id}`}
                            >
                              <Save className="h-3 w-3" />
                              Save
                            </Button>
                          )}
                        </div>
                        {editingNoteId === call.id ? (
                          <Textarea
                            value={noteText}
                            onChange={(e) => setNoteText(e.target.value)}
                            placeholder="Add notes about this call..."
                            className="min-h-[80px] text-sm"
                            data-testid={`textarea-notes-${call.id}`}
                          />
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            {call.notes || "No notes added yet."}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No calls recorded yet</p>
                  <Button
                    variant="outline"
                    className="mt-4 gap-2"
                    onClick={() => setCallModalOpen(true)}
                  >
                    <Phone className="h-4 w-4" />
                    Start First Call
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="insurance" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Insurance Info */}
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-medium">Insurance Details</CardTitle>
                {patient && vobScore < 100 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 h-7"
                    onClick={() => syncPatientMutation.mutate()}
                    disabled={syncPatientMutation.isPending}
                    data-testid="button-sync-patient"
                  >
                    <RefreshCw className={`h-3 w-3 ${syncPatientMutation.isPending ? 'animate-spin' : ''}`} />
                    Sync to Lead
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Carrier</p>
                    <p className="text-sm font-medium">
                      {lead.insuranceCarrier ||
                        patient?.insuranceCarrier ||
                        extractedData?.insuranceCarrier ||
                        "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Member ID</p>
                    <p className="text-sm font-mono">
                      {lead.memberId || patient?.memberId || extractedData?.memberId || "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">State</p>
                    <p className="text-sm">{patient?.state || extractedData?.state || "—"}</p>
                  </div>
                </div>
                {extractedData?.consent && (
                  <Badge
                    variant="outline"
                    className="gap-1 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0"
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    VOB Consent Obtained
                  </Badge>
                )}
              </CardContent>
            </Card>

            {/* Benefits Verification */}
            {vobData && vobData.verified ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Benefits Verification
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                      Verified
                    </span>
                    {vobData.networkStatus && (
                      <Badge variant="outline" className="ml-auto text-xs">
                        {vobData.networkStatus === "in_network" ? "In-Network" : "Out-of-Network"}
                      </Badge>
                    )}
                  </div>

                  <Separator />

                  <div className="grid grid-cols-2 gap-4">
                    {vobData.copay !== undefined && (
                      <div>
                        <p className="text-xs text-muted-foreground">Copay</p>
                        <p className="text-sm font-semibold">${vobData.copay}</p>
                      </div>
                    )}
                    {vobData.coinsurance !== undefined && (
                      <div>
                        <p className="text-xs text-muted-foreground">Coinsurance</p>
                        <p className="text-sm font-semibold">{vobData.coinsurance}%</p>
                      </div>
                    )}
                    {vobData.deductible !== undefined && (
                      <div>
                        <p className="text-xs text-muted-foreground">Deductible</p>
                        <p className="text-sm font-semibold">
                          ${vobData.deductibleMet || 0} / ${vobData.deductible}
                        </p>
                      </div>
                    )}
                    {vobData.outOfPocketMax !== undefined && (
                      <div>
                        <p className="text-xs text-muted-foreground">Out-of-Pocket Max</p>
                        <p className="text-sm font-semibold">
                          ${vobData.outOfPocketMet || 0} / ${vobData.outOfPocketMax}
                        </p>
                      </div>
                    )}
                  </div>

                  {vobData.priorAuthRequired && (
                    <div className="flex items-center gap-2 pt-2">
                      <AlertCircle className="h-4 w-4 text-amber-500" />
                      <span className="text-sm text-amber-600 dark:text-amber-400">
                        Prior Authorization Required
                      </span>
                    </div>
                  )}

                  {(vobData.effectiveDate || vobData.termDate) && (
                    <div className="text-xs text-muted-foreground pt-2">
                      Coverage: {vobData.effectiveDate || "—"} to {vobData.termDate || "Ongoing"}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Benefits Verification
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-8">
                    <Shield className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">Not yet verified</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Complete an AI call to verify benefits
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <CallModal
        open={callModalOpen}
        onOpenChange={setCallModalOpen}
        leadId={lead.id}
        leadName={lead.name}
        leadPhone={lead.phone}
        onCallComplete={handleCallComplete}
      />

      <LeadFormDialog
        open={editModalOpen}
        onOpenChange={setEditModalOpen}
        lead={lead}
        mode="edit"
      />
    </div>
  );
}
