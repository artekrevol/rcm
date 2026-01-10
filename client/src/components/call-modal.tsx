import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Phone, PhoneOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface CallModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadName: string;
  leadPhone: string;
  onCallComplete: (data: {
    transcript: string;
    summary: string;
    disposition: string;
    duration?: number;
    extractedData: {
      insuranceCarrier?: string;
      memberId?: string;
      serviceType?: string;
      state?: string;
      consent?: boolean;
      qualified?: boolean;
      notes?: string;
    };
    vobData?: {
      verified?: boolean;
      copay?: number;
      deductible?: number;
      coinsurance?: number;
      priorAuthRequired?: boolean;
      networkStatus?: "in_network" | "out_of_network";
    };
  }) => void;
}

export function CallModal({
  open,
  onOpenChange,
  leadId,
  leadName,
  leadPhone,
  onCallComplete,
}: CallModalProps) {
  const { toast } = useToast();
  const [callStatus, setCallStatus] = useState<"idle" | "connecting" | "ringing" | "in-progress" | "completed" | "failed">("idle");
  const [vapiCallId, setVapiCallId] = useState<string | null>(null);
  const [callData, setCallData] = useState<{ transcript: string; summary: string; duration?: number } | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!open) {
      setCallStatus("idle");
      setVapiCallId(null);
      setCallData(null);
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  const pollCallStatus = async (callId: string) => {
    try {
      const response = await fetch(`/api/vapi/call-status/${callId}`);
      if (!response.ok) return;
      
      const data = await response.json();
      
      if (data.status === "ringing") {
        setCallStatus("ringing");
      } else if (data.status === "in-progress") {
        setCallStatus("in-progress");
      } else if (data.status === "ended") {
        setCallStatus("completed");
        setCallData({
          transcript: data.transcript || "",
          summary: data.summary || "",
          duration: data.duration,
        });
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      } else if (data.status === "failed" || data.endedReason === "error") {
        setCallStatus("failed");
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      }
    } catch (error) {
      console.error("Error polling call status:", error);
    }
  };

  const handleStartCall = async () => {
    setCallStatus("connecting");
    
    try {
      const response = await fetch("/api/vapi/outbound-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          customerNumber: leadPhone,
          customerName: leadName,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok || data.error) {
        throw new Error(data.error || "Failed to initiate call");
      }
      
      setVapiCallId(data.vapiCallId);
      setCallStatus("ringing");
      
      pollingRef.current = setInterval(() => {
        pollCallStatus(data.vapiCallId);
      }, 2000);
      
    } catch (error: any) {
      toast({
        title: "Call Failed",
        description: error.message || "Failed to initiate call",
        variant: "destructive",
      });
      setCallStatus("idle");
    }
  };

  const handleEndCall = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    
    const extractedData = callData?.transcript 
      ? extractDataFromTranscript(callData.transcript)
      : { qualified: false, notes: "Call ended without transcript" };
    
    const vobData = extractVobDataFromTranscript(callData?.transcript || "");
    
    onCallComplete({
      transcript: callData?.transcript || "",
      summary: callData?.summary || "Call completed",
      disposition: extractedData.qualified ? "qualified" : "needs_follow_up",
      extractedData,
      duration: callData?.duration,
      vobData,
    });
    
    setCallStatus("idle");
    setVapiCallId(null);
    setCallData(null);
    onOpenChange(false);
  };

  const extractVobDataFromTranscript = (transcript: string) => {
    const text = transcript.toLowerCase();
    
    const copayMatch = text.match(/\$(\d+)\s*copay/i);
    const deductibleMatch = text.match(/deductible.*?\$(\d+)/i) || text.match(/\$(\d+).*?deductible/i);
    const coinsuranceMatch = text.match(/(\d+)%\s*coinsurance/i) || text.match(/coinsurance.*?(\d+)%/i);
    
    const hasVerification = /verif|confirm|check.*benefit|benefit.*check/i.test(text);
    const priorAuthRequired = /prior auth|authorization required|need.*auth/i.test(text);
    const inNetwork = /in.?network|participating provider/i.test(text);
    const outOfNetwork = /out.?of.?network|non.?participating/i.test(text);
    
    if (!hasVerification && !copayMatch && !deductibleMatch) {
      return undefined;
    }
    
    return {
      verified: hasVerification || !!copayMatch || !!deductibleMatch,
      copay: copayMatch ? parseInt(copayMatch[1]) : undefined,
      deductible: deductibleMatch ? parseInt(deductibleMatch[1]) : undefined,
      coinsurance: coinsuranceMatch ? parseInt(coinsuranceMatch[1]) : undefined,
      priorAuthRequired,
      networkStatus: inNetwork ? "in_network" as const : outOfNetwork ? "out_of_network" as const : undefined,
    };
  };

  const extractDataFromTranscript = (transcript: string) => {
    const text = transcript.toLowerCase();
    
    const carriers = [
      { pattern: /blue cross|bcbs|blue shield/i, name: "Blue Cross Blue Shield" },
      { pattern: /united|unitedhealthcare|uhc/i, name: "UnitedHealthcare" },
      { pattern: /aetna/i, name: "Aetna" },
      { pattern: /cigna/i, name: "Cigna" },
      { pattern: /humana/i, name: "Humana" },
      { pattern: /medicare/i, name: "Medicare" },
      { pattern: /medicaid/i, name: "Medicaid" },
    ];
    
    let insuranceCarrier: string | undefined;
    for (const carrier of carriers) {
      if (carrier.pattern.test(text)) {
        insuranceCarrier = carrier.name;
        break;
      }
    }
    
    const memberIdMatch = text.match(/\b([a-z]{2,4}[-\s]?\d{6,12})\b/i);
    const memberId = memberIdMatch ? memberIdMatch[1].toUpperCase() : undefined;
    
    const statePatterns = [
      { pattern: /texas|tx\b/i, code: "TX" },
      { pattern: /california|ca\b/i, code: "CA" },
      { pattern: /florida|fl\b/i, code: "FL" },
      { pattern: /new york|ny\b/i, code: "NY" },
      { pattern: /illinois|il\b/i, code: "IL" },
    ];
    
    let state: string | undefined;
    for (const st of statePatterns) {
      if (st.pattern.test(text)) {
        state = st.code;
        break;
      }
    }
    
    const hasConsent = /consent|agree|yes|confirm/i.test(text);
    
    let serviceType = "Unknown";
    if (/outpatient/i.test(text)) serviceType = "Outpatient";
    else if (/inpatient/i.test(text)) serviceType = "Inpatient";
    else if (/detox/i.test(text)) serviceType = "Detox";
    
    return {
      insuranceCarrier,
      memberId,
      serviceType,
      state,
      consent: hasConsent,
      qualified: !!(insuranceCarrier && hasConsent),
      notes: `Call duration: ${callData?.duration || 0}s`,
    };
  };

  const getStatusDisplay = () => {
    switch (callStatus) {
      case "connecting":
        return { text: "Connecting...", color: "text-amber-600 dark:text-amber-400" };
      case "ringing":
        return { text: "Ringing...", color: "text-amber-600 dark:text-amber-400" };
      case "in-progress":
        return { text: "Call in progress", color: "text-green-600 dark:text-green-400" };
      case "completed":
        return { text: "Call completed", color: "text-green-600 dark:text-green-400" };
      case "failed":
        return { text: "Call failed", color: "text-red-600 dark:text-red-400" };
      default:
        return { text: "", color: "" };
    }
  };

  const statusDisplay = getStatusDisplay();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-primary" />
            AI Voice Intake
          </DialogTitle>
          <DialogDescription>
            Calling {leadName} at {leadPhone}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {callStatus === "idle" && (
            <div className="text-center py-8">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-4">
                <Phone className="h-8 w-8 text-primary" />
              </div>
              <p className="text-muted-foreground">
                Click below to call the patient for insurance verification
              </p>
            </div>
          )}

          {(callStatus === "connecting" || callStatus === "ringing") && (
            <div className="text-center py-8">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 mb-4 animate-pulse">
                <Phone className="h-8 w-8 text-amber-600 dark:text-amber-400" />
              </div>
              <p className={cn("font-medium", statusDisplay.color)}>
                {statusDisplay.text}
              </p>
            </div>
          )}

          {callStatus === "in-progress" && (
            <div className="text-center py-8">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30 mb-4">
                <Phone className="h-8 w-8 text-green-600 dark:text-green-400 animate-pulse" />
              </div>
              <p className={cn("font-medium", statusDisplay.color)}>
                {statusDisplay.text}
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                AI agent is speaking with {leadName}
              </p>
            </div>
          )}

          {callStatus === "completed" && callData && (
            <div className="space-y-4">
              <div className="text-center">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30 mb-2">
                  <Phone className="h-6 w-6 text-green-600 dark:text-green-400" />
                </div>
                <p className={cn("font-medium", statusDisplay.color)}>
                  {statusDisplay.text}
                </p>
                {callData.duration && (
                  <p className="text-sm text-muted-foreground">
                    Duration: {Math.floor(callData.duration / 60)}m {callData.duration % 60}s
                  </p>
                )}
              </div>
              
              {callData.summary && (
                <div className="border rounded-lg p-3 bg-muted/30">
                  <p className="text-sm font-medium mb-1">Call Summary</p>
                  <p className="text-sm text-muted-foreground">{callData.summary}</p>
                </div>
              )}
              
              {callData.transcript && (
                <div className="border rounded-lg p-3 bg-muted/30 max-h-40 overflow-y-auto">
                  <p className="text-sm font-medium mb-1">Transcript</p>
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap">{callData.transcript}</p>
                </div>
              )}
            </div>
          )}

          {callStatus === "failed" && (
            <div className="text-center py-8">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
                <PhoneOff className="h-8 w-8 text-red-600 dark:text-red-400" />
              </div>
              <p className={cn("font-medium", statusDisplay.color)}>
                {statusDisplay.text}
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Please try again or check the phone number
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {callStatus === "idle" && (
            <Button 
              onClick={handleStartCall} 
              className="w-full gap-2" 
              data-testid="button-start-call"
            >
              <Phone className="h-4 w-4" />
              Call Patient
            </Button>
          )}
          {(callStatus === "connecting" || callStatus === "ringing") && (
            <Button
              variant="outline"
              disabled
              className="w-full gap-2"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              {statusDisplay.text}
            </Button>
          )}
          {callStatus === "in-progress" && (
            <div className="w-full text-center">
              <p className="text-sm text-muted-foreground mb-2">
                Call in progress - waiting for completion
              </p>
              <Button
                variant="outline"
                disabled
                className="w-full gap-2"
                data-testid="button-in-progress"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                AI agent speaking...
              </Button>
            </div>
          )}
          {callStatus === "completed" && (
            <Button onClick={handleEndCall} className="w-full gap-2" data-testid="button-save-call">
              Save & Continue
            </Button>
          )}
          {callStatus === "failed" && (
            <div className="flex gap-2 w-full">
              <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
                Cancel
              </Button>
              <Button onClick={handleStartCall} className="flex-1 gap-2">
                <Phone className="h-4 w-4" />
                Retry
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
