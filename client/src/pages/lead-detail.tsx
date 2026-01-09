import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
} from "lucide-react";
import { format } from "date-fns";
import type { Lead, Call, Patient } from "@shared/schema";

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [callModalOpen, setCallModalOpen] = useState(false);

  const { data: lead, isLoading: leadLoading } = useQuery<Lead>({
    queryKey: ["/api/leads", id],
  });

  const { data: calls } = useQuery<Call[]>({
    queryKey: ["/api/leads", id, "calls"],
  });

  const { data: patient } = useQuery<Patient | null>({
    queryKey: ["/api/leads", id, "patient"],
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

  const handleCallComplete = async (data: any) => {
    await apiRequest("POST", `/api/leads/${id}/call`, data);
    queryClient.invalidateQueries({ queryKey: ["/api/leads", id] });
    queryClient.invalidateQueries({ queryKey: ["/api/leads", id, "calls"] });
    queryClient.invalidateQueries({ queryKey: ["/api/leads", id, "patient"] });
    toast({ title: "Call saved successfully" });
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
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="capitalize">
                            {call.disposition}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            {format(new Date(call.createdAt), "MMM d, yyyy 'at' h:mm a")}
                          </span>
                        </div>
                        <p className="text-sm mt-2">{call.summary}</p>
                      </div>
                    </div>
                    
                    <div className="bg-muted/50 rounded-lg p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
                        Transcript
                      </p>
                      <div className="text-sm whitespace-pre-wrap font-mono text-xs leading-relaxed">
                        {call.transcript}
                      </div>
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
