import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Phone, PhoneOff, Loader2, Mic, MicOff, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useVapi } from "@/hooks/use-vapi";
import { useToast } from "@/hooks/use-toast";

interface CallModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadName: string;
  leadPhone: string;
  onCallComplete: (data: {
    transcript: string;
    summary: string;
    disposition: string;
    extractedData: {
      insuranceCarrier?: string;
      memberId?: string;
      serviceType?: string;
      state?: string;
      consent?: boolean;
      qualified?: boolean;
      notes?: string;
    };
  }) => void;
}

const HEALTHCARE_INTAKE_PROMPT = `You are Alex, a professional healthcare intake specialist at ClaimShield Healthcare. Your role is to conduct patient intake calls to gather insurance information and qualify leads for behavioral health services.

Your objectives during the call:
1. Greet the patient warmly and confirm their identity
2. Ask about their insurance provider (carrier name)
3. Request their member ID number
4. Ask what state they are located in
5. Inquire about the type of service they need (inpatient, outpatient, or detox)
6. Obtain verbal consent to verify their benefits with their insurance company
7. Thank them and let them know a team member will follow up within 24 hours

Guidelines:
- Be professional, empathetic, and patient
- Speak clearly and at a moderate pace
- If the patient seems confused, offer clarification
- Do not provide medical advice
- Keep the conversation focused on intake information
- If asked about coverage details, explain that you'll need to verify with their insurance first

Remember to extract and confirm:
- Insurance carrier name
- Member ID
- State of residence
- Service type preference
- Consent for verification

End the call politely after gathering all necessary information.`;

export function CallModal({
  open,
  onOpenChange,
  leadName,
  leadPhone,
  onCallComplete,
}: CallModalProps) {
  const { toast } = useToast();
  const vapiPublicKey = import.meta.env.VITE_VAPI_PUBLIC_KEY;
  
  const [callStatus, setCallStatus] = useState<"idle" | "connecting" | "in-call" | "completed">("idle");

  const {
    isCallActive,
    isSpeaking,
    messages,
    volumeLevel,
    startCall,
    endCall,
    toggleMute,
    isMuted,
  } = useVapi({
    publicKey: vapiPublicKey || "",
    onCallStart: () => {
      setCallStatus("in-call");
    },
    onCallEnd: () => {
      if (callStatus === "in-call") {
        setCallStatus("completed");
      }
    },
    onError: (error) => {
      toast({
        title: "Call Error",
        description: error.message || "Failed to connect the call",
        variant: "destructive",
      });
      setCallStatus("idle");
    },
  });

  useEffect(() => {
    if (!open) {
      setCallStatus("idle");
    }
  }, [open]);

  const handleStartCall = async () => {
    if (!vapiPublicKey) {
      toast({
        title: "Configuration Required",
        description: "Please configure the VITE_VAPI_PUBLIC_KEY environment variable",
        variant: "destructive",
      });
      return;
    }

    setCallStatus("connecting");
    await startCall({
      systemPrompt: HEALTHCARE_INTAKE_PROMPT,
      leadName,
      leadPhone,
      firstMessage: `Hello, this is Alex from ClaimShield Healthcare. Am I speaking with ${leadName}?`,
    });
  };

  const handleEndCall = () => {
    endCall();
    
    const transcript = messages.map((m) => `${m.role}: ${m.text}`).join("\n");
    
    const extractedData = extractDataFromTranscript(messages);
    
    onCallComplete({
      transcript,
      summary: generateSummary(messages, extractedData),
      disposition: extractedData.qualified ? "qualified" : "needs_follow_up",
      extractedData,
    });
    
    setCallStatus("idle");
    onOpenChange(false);
  };

  const extractDataFromTranscript = (msgs: typeof messages) => {
    const fullText = msgs.map(m => m.text.toLowerCase()).join(" ");
    
    const carriers = [
      "blue cross", "bcbs", "united", "aetna", "cigna", "humana", "medicare", "medicaid"
    ];
    const foundCarrier = carriers.find(c => fullText.includes(c));
    
    const memberIdMatch = fullText.match(/\b([a-z]{2,4}[-\s]?\d{6,12})\b/i);
    
    const states = ["texas", "california", "florida", "new york", "illinois", "ohio", "pennsylvania"];
    const foundState = states.find(s => fullText.includes(s));
    
    const hasConsent = fullText.includes("consent") || fullText.includes("yes") || fullText.includes("agree");
    
    let serviceType = "Unknown";
    if (fullText.includes("outpatient")) serviceType = "Outpatient";
    else if (fullText.includes("inpatient")) serviceType = "Inpatient";
    else if (fullText.includes("detox")) serviceType = "Detox";
    
    return {
      insuranceCarrier: foundCarrier ? foundCarrier.charAt(0).toUpperCase() + foundCarrier.slice(1) : undefined,
      memberId: memberIdMatch ? memberIdMatch[1].toUpperCase() : undefined,
      serviceType,
      state: foundState ? foundState.charAt(0).toUpperCase() + foundState.slice(1) : undefined,
      consent: hasConsent,
      qualified: !!(foundCarrier && hasConsent),
      notes: `AI intake call completed with ${msgs.length} exchanges`,
    };
  };

  const generateSummary = (msgs: typeof messages, data: ReturnType<typeof extractDataFromTranscript>) => {
    const parts = [];
    if (data.insuranceCarrier) parts.push(`Insurance: ${data.insuranceCarrier}`);
    if (data.memberId) parts.push(`Member ID: ${data.memberId}`);
    if (data.state) parts.push(`State: ${data.state}`);
    if (data.serviceType !== "Unknown") parts.push(`Service: ${data.serviceType}`);
    if (data.consent) parts.push("Consent obtained for VOB");
    
    return parts.length > 0 
      ? `Patient intake completed. ${parts.join(". ")}.`
      : `Intake call with ${msgs.length} exchanges. Manual review recommended.`;
  };

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
                Click below to start an AI-powered intake call
              </p>
              {!vapiPublicKey && (
                <p className="text-sm text-destructive mt-2">
                  VITE_VAPI_PUBLIC_KEY not configured
                </p>
              )}
            </div>
          )}

          {callStatus === "connecting" && (
            <div className="text-center py-8">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 mb-4 animate-pulse">
                <Phone className="h-8 w-8 text-amber-600 dark:text-amber-400" />
              </div>
              <p className="text-amber-600 dark:text-amber-400 font-medium">
                Connecting to Vapi...
              </p>
            </div>
          )}

          {(callStatus === "in-call" || callStatus === "completed") && (
            <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "h-3 w-3 rounded-full",
                    isCallActive ? "bg-green-500 animate-pulse" : "bg-gray-400"
                  )} />
                  <span className="text-sm text-muted-foreground">
                    {isCallActive ? (isSpeaking ? "Agent speaking..." : "Listening...") : "Call ended"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Volume2 className="h-4 w-4 text-muted-foreground" />
                  <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-primary transition-all duration-100"
                      style={{ width: `${volumeLevel * 100}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3 max-h-64 overflow-y-auto border rounded-lg p-3 bg-muted/30">
                {messages.length === 0 && callStatus === "in-call" && (
                  <div className="flex items-center justify-center py-4 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Waiting for conversation...
                  </div>
                )}
                {messages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "flex",
                      msg.role === "agent" ? "justify-start" : "justify-end"
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                        msg.role === "agent"
                          ? "bg-muted"
                          : "bg-primary text-primary-foreground"
                      )}
                    >
                      <p className="text-xs font-medium mb-1 opacity-70">
                        {msg.role === "agent" ? "AI Agent" : "Patient"}
                      </p>
                      {msg.text}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {callStatus === "idle" && (
            <Button 
              onClick={handleStartCall} 
              className="w-full gap-2" 
              data-testid="button-start-call"
              disabled={!vapiPublicKey}
            >
              <Phone className="h-4 w-4" />
              Start AI Intake
            </Button>
          )}
          {callStatus === "connecting" && (
            <Button
              variant="outline"
              disabled
              className="w-full gap-2"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              Connecting...
            </Button>
          )}
          {callStatus === "in-call" && (
            <>
              <Button
                variant="outline"
                onClick={toggleMute}
                className="gap-2"
                data-testid="button-mute"
              >
                {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                {isMuted ? "Unmute" : "Mute"}
              </Button>
              <Button
                variant="destructive"
                onClick={handleEndCall}
                className="flex-1 gap-2"
                data-testid="button-end-call"
              >
                <PhoneOff className="h-4 w-4" />
                End Call
              </Button>
            </>
          )}
          {callStatus === "completed" && (
            <Button onClick={handleEndCall} className="w-full gap-2" data-testid="button-save-call">
              Save & Continue
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
