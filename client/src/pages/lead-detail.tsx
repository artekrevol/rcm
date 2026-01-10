import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { LeadStatusBadge } from "@/components/status-badge";
import { CallModal } from "@/components/call-modal";
import { Skeleton } from "@/components/ui/skeleton";
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
  DollarSign,
  Shield,
  CheckCircle2,
  AlertCircle,
  Edit3,
  Save,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { format } from "date-fns";
import type { Lead, Call, Patient } from "@shared/schema";

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [callModalOpen, setCallModalOpen] = useState(false);
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
    toast({ title: "Call saved successfully" });
  };

  const toggleTranscript = (callId: string) => {
    setExpandedTranscripts(prev => {
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

  if (leadLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64 lg:col-span-2" />
        </div>
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

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLocation("/leads")}
          data-testid="button-back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold">{lead.name}</h1>
            <LeadStatusBadge status={lead.status} />
          </div>
          <p className="text-muted-foreground mt-1">
            Created {format(new Date(lead.createdAt), "MMMM d, yyyy")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setCallModalOpen(true)}
            data-testid="button-call-lead"
          >
            <Phone className="h-4 w-4" />
            Call with AI
          </Button>
          <Button
            className="gap-2"
            onClick={() => createClaimPacketMutation.mutate()}
            disabled={createClaimPacketMutation.isPending || !patient}
            data-testid="button-create-claim"
          >
            <Plus className="h-4 w-4" />
            Create Claim Packet
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">Contact Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
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

          {(patient || extractedData) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-medium">Insurance Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Carrier</p>
                    <p className="text-sm font-medium">
                      {patient?.insuranceCarrier || extractedData?.insuranceCarrier || "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Member ID</p>
                    <p className="text-sm font-mono">
                      {patient?.memberId || extractedData?.memberId || "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">State</p>
                    <p className="text-sm">
                      {patient?.state || extractedData?.state || "—"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Service Type</p>
                    <p className="text-sm">
                      {extractedData?.serviceType || "—"}
                    </p>
                  </div>
                </div>
                {extractedData?.consent && (
                  <Badge variant="outline" className="gap-1 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0">
                    VOB Consent Obtained
                  </Badge>
                )}
              </CardContent>
            </Card>
          )}

          {vobData && vobData.verified && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-medium flex items-center gap-2">
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
          )}
        </div>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Call History
            </CardTitle>
          </CardHeader>
          <CardContent>
            {calls && calls.length > 0 ? (
              <div className="space-y-6">
                {calls.map((call) => (
                  <div key={call.id} className="space-y-4">
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

                    <div className="bg-muted/30 rounded-lg p-4">
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
                    
                    <Separator />
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
      </div>

      <CallModal
        open={callModalOpen}
        onOpenChange={setCallModalOpen}
        leadId={lead.id}
        leadName={lead.name}
        leadPhone={lead.phone}
        onCallComplete={handleCallComplete}
      />
    </div>
  );
}
