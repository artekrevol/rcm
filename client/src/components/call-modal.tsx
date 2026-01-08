import { useState } from "react";
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

const sampleIntakeFlow = [
  { role: "agent", text: "Hello, thank you for calling ClaimShield Healthcare. My name is Alex. How can I help you today?" },
  { role: "patient", text: "Hi, I'm interested in getting information about your behavioral health services." },
  { role: "agent", text: "Of course! I'd be happy to help. May I start by getting your insurance information?" },
  { role: "patient", text: "Sure, I have Blue Cross Blue Shield." },
  { role: "agent", text: "Perfect. And what's your member ID number?" },
  { role: "patient", text: "It's BCB-12345678." },
  { role: "agent", text: "Thank you. And what state are you located in?" },
  { role: "patient", text: "I'm in Texas." },
  { role: "agent", text: "Great. What type of service are you interested in? We offer inpatient, outpatient, and detox programs." },
  { role: "patient", text: "I think outpatient would work best for my situation." },
  { role: "agent", text: "Understood. I have all the information I need. Do I have your consent to verify your benefits with your insurance company?" },
  { role: "patient", text: "Yes, you have my consent." },
  { role: "agent", text: "Thank you. A member of our team will follow up with you within 24 hours with your coverage details. Have a great day!" },
];

export function CallModal({
  open,
  onOpenChange,
  leadName,
  leadPhone,
  onCallComplete,
}: CallModalProps) {
  const [callStatus, setCallStatus] = useState<"idle" | "calling" | "in-call" | "completed">("idle");
  const [currentMessage, setCurrentMessage] = useState(0);
  const [transcript, setTranscript] = useState<typeof sampleIntakeFlow>([]);

  const startCall = () => {
    setCallStatus("calling");
    setTimeout(() => {
      setCallStatus("in-call");
      simulateConversation();
    }, 2000);
  };

  const simulateConversation = () => {
    let messageIndex = 0;
    const interval = setInterval(() => {
      if (messageIndex < sampleIntakeFlow.length) {
        setTranscript((prev) => [...prev, sampleIntakeFlow[messageIndex]]);
        setCurrentMessage(messageIndex);
        messageIndex++;
      } else {
        clearInterval(interval);
        setCallStatus("completed");
      }
    }, 1500);
  };

  const endCall = () => {
    onCallComplete({
      transcript: sampleIntakeFlow.map((m) => `${m.role}: ${m.text}`).join("\n"),
      summary: "Patient interested in outpatient behavioral health services. Has BCBS insurance (Member ID: BCB-12345678) in Texas. Consent obtained for VOB.",
      disposition: "qualified",
      extractedData: {
        insuranceCarrier: "Blue Cross Blue Shield",
        memberId: "BCB-12345678",
        serviceType: "Outpatient",
        state: "TX",
        consent: true,
        qualified: true,
        notes: "Interested in outpatient program",
      },
    });
    setCallStatus("idle");
    setTranscript([]);
    setCurrentMessage(0);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5 text-primary" />
            AI Voice Call
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
            </div>
          )}

          {callStatus === "calling" && (
            <div className="text-center py-8">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 mb-4 animate-pulse">
                <Phone className="h-8 w-8 text-amber-600 dark:text-amber-400" />
              </div>
              <p className="text-amber-600 dark:text-amber-400 font-medium">
                Connecting...
              </p>
            </div>
          )}

          {(callStatus === "in-call" || callStatus === "completed") && (
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {transcript.map((msg, idx) => (
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
              {callStatus === "in-call" && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Listening...</span>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {callStatus === "idle" && (
            <Button onClick={startCall} className="w-full gap-2" data-testid="button-start-call">
              <Phone className="h-4 w-4" />
              Start AI Intake
            </Button>
          )}
          {(callStatus === "calling" || callStatus === "in-call") && (
            <Button
              variant="destructive"
              onClick={endCall}
              className="w-full gap-2"
              data-testid="button-end-call"
            >
              <PhoneOff className="h-4 w-4" />
              End Call
            </Button>
          )}
          {callStatus === "completed" && (
            <Button onClick={endCall} className="w-full gap-2" data-testid="button-save-call">
              Save & Continue
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
