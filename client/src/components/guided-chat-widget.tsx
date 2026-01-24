import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { 
  MessageCircle, 
  X, 
  Send, 
  Loader2,
  Bot,
  User,
  Minimize2,
  HelpCircle,
  CheckCircle2,
  ArrowRight,
  Calendar,
  Phone,
  Mail,
  Shield,
  Heart,
  Clock,
  ChevronLeft
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";

interface ConversationStep {
  id: string;
  type: "message" | "quick-reply" | "text-input" | "multi-select" | "phone-input" | "email-input" | "date-input" | "confirmation" | "appointment-picker";
  message: string;
  tooltip?: string;
  options?: { label: string; value: string; icon?: React.ReactNode }[];
  placeholder?: string;
  field?: string;
  validation?: (value: string) => boolean;
  nextStep?: string | ((value: string) => string);
  skipCondition?: (data: Record<string, string>) => boolean;
}

interface AppointmentSlot {
  date: string;
  time: string;
  formatted: string;
  isoDate: string;
}

interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  content: string;
  timestamp: Date;
  isQuickReply?: boolean;
}

const conversationFlow: ConversationStep[] = [
  {
    id: "welcome",
    type: "message",
    message: "Hi there! I'm your ClaimShield AI assistant. I'm here to help you get started with our healthcare services. This will only take a few minutes.",
    tooltip: "We're here to help you navigate healthcare services and ensure you get the care you need.",
    nextStep: "service_type"
  },
  {
    id: "service_type",
    type: "quick-reply",
    message: "What type of service are you looking for today?",
    tooltip: "Select the option that best describes your healthcare needs.",
    options: [
      { label: "Mental Health", value: "mental_health", icon: <Heart className="h-4 w-4" /> },
      { label: "Physical Therapy", value: "physical_therapy", icon: <Shield className="h-4 w-4" /> },
      { label: "Primary Care", value: "primary_care", icon: <Heart className="h-4 w-4" /> },
      { label: "Specialist Referral", value: "specialist", icon: <Shield className="h-4 w-4" /> },
      { label: "Other Services", value: "other", icon: <HelpCircle className="h-4 w-4" /> }
    ],
    field: "serviceNeeded",
    nextStep: "urgency"
  },
  {
    id: "urgency",
    type: "quick-reply",
    message: "How soon do you need to be seen?",
    tooltip: "This helps us prioritize and find the right appointment time for you.",
    options: [
      { label: "As soon as possible", value: "urgent", icon: <Clock className="h-4 w-4" /> },
      { label: "Within a week", value: "this_week", icon: <Calendar className="h-4 w-4" /> },
      { label: "Within a month", value: "this_month", icon: <Calendar className="h-4 w-4" /> },
      { label: "Just exploring options", value: "exploring", icon: <HelpCircle className="h-4 w-4" /> }
    ],
    field: "urgency",
    nextStep: "insurance_check"
  },
  {
    id: "insurance_check",
    type: "quick-reply",
    message: "Do you currently have health insurance?",
    tooltip: "We accept most major insurance plans and can help verify your coverage.",
    options: [
      { label: "Yes, I have insurance", value: "yes" },
      { label: "No, I don't have insurance", value: "no" },
      { label: "I'm not sure", value: "unsure" }
    ],
    field: "hasInsurance",
    nextStep: (value) => value === "yes" ? "insurance_carrier" : "contact_name"
  },
  {
    id: "insurance_carrier",
    type: "quick-reply",
    message: "Great! Which insurance carrier do you have?",
    tooltip: "Select your insurance provider from the list below.",
    options: [
      { label: "Blue Cross Blue Shield", value: "bcbs" },
      { label: "Aetna", value: "aetna" },
      { label: "UnitedHealthcare", value: "united" },
      { label: "Cigna", value: "cigna" },
      { label: "Medicare", value: "medicare" },
      { label: "Medicaid", value: "medicaid" },
      { label: "Other", value: "other" }
    ],
    field: "insuranceCarrier",
    nextStep: "member_id"
  },
  {
    id: "member_id",
    type: "text-input",
    message: "What is your Member ID? You can find this on your insurance card.",
    tooltip: "Your Member ID helps us verify your benefits and coverage quickly.",
    placeholder: "Enter your Member ID",
    field: "memberId",
    nextStep: "contact_name"
  },
  {
    id: "contact_name",
    type: "text-input",
    message: "Thanks! Now, what's your name?",
    tooltip: "We'll use this to personalize your experience and set up your account.",
    placeholder: "Enter your full name",
    field: "name",
    validation: (value) => value.trim().length >= 2,
    nextStep: "contact_phone"
  },
  {
    id: "contact_phone",
    type: "phone-input",
    message: "What's the best phone number to reach you?",
    tooltip: "We'll only use this to contact you about your appointment and care.",
    placeholder: "(555) 555-5555",
    field: "phone",
    validation: (value) => /^\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}$/.test(value.replace(/\s/g, '')),
    nextStep: "contact_email"
  },
  {
    id: "contact_email",
    type: "email-input",
    message: "And your email address?",
    tooltip: "We'll send appointment confirmations and important updates here.",
    placeholder: "your@email.com",
    field: "email",
    validation: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    nextStep: "best_time"
  },
  {
    id: "best_time",
    type: "quick-reply",
    message: "When is the best time to reach you?",
    tooltip: "We'll try to call during your preferred time window.",
    options: [
      { label: "Morning (9am-12pm)", value: "morning" },
      { label: "Afternoon (12pm-5pm)", value: "afternoon" },
      { label: "Evening (5pm-8pm)", value: "evening" },
      { label: "Anytime", value: "anytime" }
    ],
    field: "bestTimeToCall",
    nextStep: "schedule_preference"
  },
  {
    id: "schedule_preference",
    type: "quick-reply",
    message: "Would you like to schedule an appointment now, or would you prefer a callback first?",
    tooltip: "Choose what works best for you.",
    options: [
      { label: "Schedule now", value: "schedule", icon: <Calendar className="h-4 w-4" /> },
      { label: "Request callback", value: "callback", icon: <Phone className="h-4 w-4" /> },
      { label: "Just send me info", value: "email", icon: <Mail className="h-4 w-4" /> }
    ],
    field: "schedulePreference",
    nextStep: (value) => value === "schedule" ? "appointment_slots" : "confirmation"
  },
  {
    id: "appointment_slots",
    type: "appointment-picker",
    message: "Great! Here are the available appointment times. Select one that works for you:",
    tooltip: "Choose from the available time slots. All times shown in Central Time.",
    field: "appointmentSlot",
    nextStep: "confirmation"
  },
  {
    id: "confirmation",
    type: "confirmation",
    message: "Perfect! I've collected all the information I need. Here's a summary of what you shared:",
    tooltip: "Review your information before we proceed.",
    nextStep: "complete"
  },
  {
    id: "complete",
    type: "message",
    message: "Thank you! Our team will reach out to you shortly. Is there anything else I can help you with?",
    tooltip: "Feel free to ask any questions about our services."
  }
];

const stepOrder = ["welcome", "service_type", "urgency", "insurance_check", "insurance_carrier", "member_id", "contact_name", "contact_phone", "contact_email", "best_time", "schedule_preference", "appointment_slots", "confirmation", "complete"];

function formatPhone(value: string): string {
  const cleaned = value.replace(/\D/g, '');
  if (cleaned.length <= 3) return cleaned;
  if (cleaned.length <= 6) return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
  return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
}

function generateAppointmentSlots(): AppointmentSlot[] {
  const slots: AppointmentSlot[] = [];
  const now = new Date();
  const times = ["9:00 AM", "10:00 AM", "11:00 AM", "1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"];
  
  for (let dayOffset = 1; dayOffset <= 5; dayOffset++) {
    const date = new Date(now);
    date.setDate(date.getDate() + dayOffset);
    
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    
    const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    
    times.slice(0, 3).forEach(time => {
      const [hourStr, period] = time.split(' ');
      const [hours] = hourStr.split(':').map(Number);
      const hour24 = period === 'PM' && hours !== 12 ? hours + 12 : hours;
      
      const isoDate = new Date(date);
      isoDate.setHours(hour24, 0, 0, 0);
      
      slots.push({
        date: dateStr,
        time,
        formatted: `${dateStr} at ${time}`,
        isoDate: isoDate.toISOString()
      });
    });
  }
  
  return slots.slice(0, 6);
}

function getOrCreateVisitorToken(): string {
  const STORAGE_KEY = "claimshield_visitor_token";
  let token = localStorage.getItem(STORAGE_KEY);
  if (!token) {
    token = `visitor_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    localStorage.setItem(STORAGE_KEY, token);
  }
  return token;
}

function GuidedChatContent() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentStepId, setCurrentStepId] = useState("welcome");
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [collectedData, setCollectedData] = useState<Record<string, string>>({});
  const [isComplete, setIsComplete] = useState(false);
  const [appointmentSlots, setAppointmentSlots] = useState<AppointmentSlot[]>([]);
  const [createdLeadId, setCreatedLeadId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionResumed, setSessionResumed] = useState(false);
  const [returningLead, setReturningLead] = useState<{ id: string; name: string; email: string; phone: string; originalVisitDate: string } | null>(null);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionInitialized = useRef(false);

  const currentStep = conversationFlow.find(s => s.id === currentStepId);
  const currentStepIndex = stepOrder.indexOf(currentStepId);
  const progressPercent = Math.round((currentStepIndex / (stepOrder.length - 1)) * 100);

  // Initialize or resume session when chat opens
  useEffect(() => {
    const initSession = async () => {
      if (!isOpen || sessionInitialized.current) return;
      sessionInitialized.current = true;
      
      try {
        const visitorToken = getOrCreateVisitorToken();
        const response = await apiRequest("POST", "/api/chat-sessions/init", {
          visitorToken,
          referrerUrl: window.location.href,
          userAgent: navigator.userAgent,
        });
        const data = await response.json();
        
        setSessionId(data.session.id);
        
        // Check if this is a returning lead
        if (data.returningLead) {
          setReturningLead(data.returningLead);
        }
        
        if (data.resumed && data.messages.length > 0) {
          // Resume existing session
          setSessionResumed(true);
          const resumedMessages: ChatMessage[] = data.messages.map((m: { id: string; type: string; content: string; createdAt: string }) => ({
            id: m.id,
            role: m.type === "user" ? "user" : "assistant",
            content: m.content,
            timestamp: new Date(m.createdAt),
          }));
          setMessages(resumedMessages);
          setCurrentStepId(data.session.currentStepId);
          setCollectedData(data.session.collectedData || {});
          
          if (data.session.status === "completed") {
            setIsComplete(true);
            if (data.session.leadId) {
              setCreatedLeadId(data.session.leadId);
            }
          }
        } else if (data.returningLead) {
          // Returning lead - show personalized welcome back
          const firstName = data.returningLead.name.split(' ')[0];
          addMessageWithPersist("assistant", `Welcome back, ${firstName}! What can we help you with today?`, data.session.id, "welcome_back");
        } else {
          // New session - add welcome message
          const welcomeStep = conversationFlow.find(s => s.id === "welcome");
          if (welcomeStep) {
            addMessageWithPersist("assistant", welcomeStep.message, data.session.id, "welcome");
          }
        }
      } catch (error) {
        console.error("Failed to init session:", error);
        // Fallback to local-only mode
        const welcomeStep = conversationFlow.find(s => s.id === "welcome");
        if (welcomeStep) {
          addMessage("assistant", welcomeStep.message);
        }
      }
    };
    
    initSession();
  }, [isOpen]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (isOpen && !isMinimized && inputRef.current && currentStep?.type !== "quick-reply" && currentStep?.type !== "confirmation") {
      inputRef.current.focus();
    }
  }, [isOpen, isMinimized, currentStepId]);
  
  // Update session when step changes
  useEffect(() => {
    if (sessionId && currentStepId) {
      apiRequest("PATCH", `/api/chat-sessions/${sessionId}`, {
        currentStepId,
        collectedData,
      }).catch(console.error);
    }
  }, [sessionId, currentStepId, collectedData]);

  const addMessageWithPersist = async (role: "assistant" | "user", content: string, sessId: string, stepId?: string) => {
    const newMessage: ChatMessage = {
      id: `${Date.now()}-${Math.random()}`,
      role,
      content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, newMessage]);
    
    try {
      await apiRequest("POST", `/api/chat-sessions/${sessId}/messages`, {
        type: role === "assistant" ? "bot" : "user",
        content,
        stepId,
      });
    } catch (error) {
      console.error("Failed to persist message:", error);
    }
  };

  const addMessage = (role: "assistant" | "user", content: string, isQuickReply = false, stepId?: string) => {
    const newMessage: ChatMessage = {
      id: `${Date.now()}-${Math.random()}`,
      role,
      content,
      timestamp: new Date(),
      isQuickReply
    };
    setMessages((prev) => [...prev, newMessage]);
    
    // Persist message if we have a session
    if (sessionId) {
      apiRequest("POST", `/api/chat-sessions/${sessionId}/messages`, {
        type: role === "assistant" ? "bot" : "user",
        content,
        stepId: stepId || currentStepId,
      }).catch(console.error);
    }
  };

  const handleOpen = () => {
    setIsOpen(true);
    setIsMinimized(false);
    // Welcome message is now handled by initSession
  };

  const handleClose = () => {
    setIsOpen(false);
    setIsMinimized(false);
  };

  const handleMinimize = () => {
    setIsMinimized(true);
  };

  const goToNextStep = (value: string, displayValue?: string) => {
    if (!currentStep) return;

    if (currentStep.field) {
      setCollectedData(prev => ({ ...prev, [currentStep.field!]: value }));
    }

    addMessage("user", displayValue || value, true);

    let nextStepId: string | undefined;
    if (typeof currentStep.nextStep === "function") {
      nextStepId = currentStep.nextStep(value);
    } else {
      nextStepId = currentStep.nextStep;
    }

    if (nextStepId) {
      setIsLoading(true);
      setTimeout(() => {
        let actualNextStep = nextStepId;
        const nextStep = conversationFlow.find(s => s.id === nextStepId);
        
        if (nextStep?.skipCondition && nextStep.skipCondition(collectedData)) {
          if (typeof nextStep.nextStep === "string") {
            actualNextStep = nextStep.nextStep;
          }
        }

        setCurrentStepId(actualNextStep!);
        const step = conversationFlow.find(s => s.id === actualNextStep);
        if (step) {
          if (step.type === "confirmation") {
            addMessage("assistant", step.message);
            submitLead();
          } else if (step.type === "appointment-picker") {
            addMessage("assistant", step.message);
            setAppointmentSlots(generateAppointmentSlots());
          } else {
            addMessage("assistant", step.message);
          }
        }
        setIsLoading(false);
      }, 600);
    }
  };

  const handleQuickReply = (option: { label: string; value: string }) => {
    goToNextStep(option.value, option.label);
  };

  const handleTextSubmit = () => {
    const value = inputValue.trim();
    if (!value || !currentStep) return;

    if (currentStep.validation && !currentStep.validation(value)) {
      addMessage("assistant", "Please enter a valid value and try again.");
      return;
    }

    setInputValue("");
    goToNextStep(value);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleTextSubmit();
    }
  };

  const submitLead = async () => {
    setIsLoading(true);
    try {
      const leadData = {
        name: collectedData.name || "Website Visitor",
        phone: collectedData.phone?.replace(/\D/g, '') || "",
        email: collectedData.email || "",
        source: "chat_widget",
        status: "new",
        priority: collectedData.urgency === "urgent" ? "P0" : collectedData.urgency === "this_week" ? "P1" : "P2",
        serviceNeeded: collectedData.serviceNeeded || "",
        insuranceCarrier: collectedData.insuranceCarrier || "",
        memberId: collectedData.memberId || "",
        bestTimeToCall: collectedData.bestTimeToCall || "",
        notes: `Schedule preference: ${collectedData.schedulePreference || "not specified"}. Has insurance: ${collectedData.hasInsurance || "unknown"}.`
      };

      const leadResponse = await apiRequest("POST", "/api/leads", leadData);
      const lead = await leadResponse.json();
      setCreatedLeadId(lead.id);
      
      if (collectedData.appointmentSlot && lead.id) {
        const appointmentData = {
          leadId: lead.id,
          title: `${collectedData.serviceNeeded?.replace(/_/g, ' ') || 'Initial'} Consultation - ${collectedData.name}`,
          description: `Scheduled via chat widget. Service: ${collectedData.serviceNeeded?.replace(/_/g, ' ') || 'General'}`,
          scheduledAt: collectedData.appointmentSlot,
          duration: 30,
          timezone: "America/Chicago",
          status: "scheduled"
        };
        await apiRequest("POST", "/api/appointments", appointmentData);
      }
      
      // Send confirmation email
      if (lead.id && collectedData.email) {
        try {
          await apiRequest("POST", `/api/leads/${lead.id}/send-confirmation`, {
            appointmentDate: collectedData.appointmentSlot || null
          });
        } catch (emailError) {
          console.error("Failed to send confirmation email:", emailError);
        }
      }
      
      // Mark session as completed
      if (sessionId && lead.id) {
        try {
          const qualScore = collectedData.urgency === "urgent" ? 90 : 
                           collectedData.urgency === "this_week" ? 70 : 50;
          await apiRequest("POST", `/api/chat-sessions/${sessionId}/complete`, {
            leadId: lead.id,
            qualificationScore: qualScore
          });
        } catch (error) {
          console.error("Failed to complete session:", error);
        }
      }
      
      setIsComplete(true);
      
      setTimeout(() => {
        setCurrentStepId("complete");
        const completeStep = conversationFlow.find(s => s.id === "complete");
        if (completeStep) {
          const completionMessage = collectedData.appointmentSlot 
            ? `Your appointment has been scheduled! We've sent a confirmation to ${collectedData.email}. Is there anything else I can help you with?`
            : completeStep.message;
          addMessage("assistant", completionMessage);
        }
        setIsLoading(false);
      }, 500);
    } catch (error) {
      console.error("Failed to submit lead:", error);
      addMessage("assistant", "I apologize, but I had trouble saving your information. Please try again or call us directly.");
      setIsLoading(false);
    }
  };

  const handleFreeformMessage = async () => {
    const userMessage = inputValue.trim();
    if (!userMessage) return;

    addMessage("user", userMessage);
    setInputValue("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage }),
      });

      const data = await response.json();
      if (data.reply) {
        addMessage("assistant", data.reply);
      }
    } catch (error) {
      console.error("Chat error:", error);
      addMessage("assistant", "I apologize, I had trouble with that. How else can I help you?");
    } finally {
      setIsLoading(false);
    }
  };

  const renderInputArea = () => {
    if (!currentStep) return null;

    if (currentStep.type === "quick-reply" && currentStep.options) {
      return (
        <div className="p-3 border-t space-y-2">
          <div className="flex flex-wrap gap-2">
            {currentStep.options.map((option, idx) => (
              <Button
                key={idx}
                variant="outline"
                size="sm"
                className="flex items-center gap-1.5 hover-elevate"
                onClick={() => handleQuickReply(option)}
                disabled={isLoading}
                data-testid={`button-option-${option.value}`}
              >
                {option.icon}
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      );
    }

    if (currentStep.type === "appointment-picker") {
      return (
        <div className="p-3 border-t">
          <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
            {appointmentSlots.map((slot, idx) => (
              <Button
                key={idx}
                variant="outline"
                size="sm"
                className="flex flex-col items-center gap-0.5 h-auto py-2 hover-elevate"
                onClick={() => {
                  setCollectedData(prev => ({ ...prev, appointmentSlot: slot.isoDate }));
                  goToNextStep(slot.isoDate, slot.formatted);
                }}
                disabled={isLoading}
                data-testid={`button-slot-${idx}`}
              >
                <Calendar className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-medium">{slot.date}</span>
                <span className="text-xs text-muted-foreground">{slot.time}</span>
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground text-center mt-2">All times Central Time (CST)</p>
        </div>
      );
    }

    if (currentStep.type === "confirmation") {
      return (
        <div className="p-3 border-t">
          <Card className="p-3 mb-3 bg-muted/50">
            <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              Your Information
            </h4>
            <div className="space-y-1 text-sm">
              {collectedData.name && <p><span className="text-muted-foreground">Name:</span> {collectedData.name}</p>}
              {collectedData.phone && <p><span className="text-muted-foreground">Phone:</span> {collectedData.phone}</p>}
              {collectedData.email && <p><span className="text-muted-foreground">Email:</span> {collectedData.email}</p>}
              {collectedData.serviceNeeded && <p><span className="text-muted-foreground">Service:</span> {collectedData.serviceNeeded.replace(/_/g, ' ')}</p>}
              {collectedData.insuranceCarrier && <p><span className="text-muted-foreground">Insurance:</span> {collectedData.insuranceCarrier.toUpperCase()}</p>}
              {collectedData.appointmentSlot && (
                <p><span className="text-muted-foreground">Appointment:</span> {new Date(collectedData.appointmentSlot).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
              )}
            </div>
          </Card>
          {isLoading ? (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="ml-2 text-sm">Saving your information...</span>
            </div>
          ) : null}
        </div>
      );
    }

    if (currentStep.id === "complete" || isComplete) {
      return (
        <div className="p-3 border-t space-y-3">
          <Card className="p-3 bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800">
            <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5 text-green-700 dark:text-green-300">
              <CheckCircle2 className="h-4 w-4" />
              Submission Confirmed
            </h4>
            <div className="space-y-1 text-sm">
              {collectedData.name && <p><span className="text-muted-foreground">Name:</span> {collectedData.name}</p>}
              {collectedData.phone && <p><span className="text-muted-foreground">Phone:</span> {collectedData.phone}</p>}
              {collectedData.email && <p><span className="text-muted-foreground">Email:</span> {collectedData.email}</p>}
              {collectedData.serviceNeeded && <p><span className="text-muted-foreground">Service:</span> {collectedData.serviceNeeded.replace(/_/g, ' ')}</p>}
              {collectedData.insuranceCarrier && <p><span className="text-muted-foreground">Insurance:</span> {collectedData.insuranceCarrier.toUpperCase()}</p>}
              {collectedData.appointmentSlot && (
                <p><span className="text-muted-foreground">Appointment:</span> {new Date(collectedData.appointmentSlot).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
              )}
            </div>
            {createdLeadId && (
              <Button 
                variant="outline" 
                size="sm" 
                className="mt-3 w-full"
                onClick={() => window.open(`/leads/${createdLeadId}`, '_blank')}
                data-testid="button-view-details"
              >
                <ArrowRight className="h-4 w-4 mr-1.5" />
                View Full Details
              </Button>
            )}
          </Card>
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleFreeformMessage(); }}
              placeholder="Ask a question..."
              disabled={isLoading}
              className="flex-1"
              data-testid="input-chat-message"
            />
            <Button
              onClick={handleFreeformMessage}
              disabled={!inputValue.trim() || isLoading}
              size="icon"
              data-testid="button-send-message"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      );
    }

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      let value = e.target.value;
      if (currentStep.type === "phone-input") {
        value = formatPhone(value);
      }
      setInputValue(value);
    };

    return (
      <div className="p-3 border-t">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={currentStep.placeholder || "Type your response..."}
            disabled={isLoading}
            type={currentStep.type === "email-input" ? "email" : "text"}
            className="flex-1"
            data-testid="input-guided-response"
          />
          <Button
            onClick={handleTextSubmit}
            disabled={!inputValue.trim() || isLoading}
            size="icon"
            data-testid="button-submit-response"
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  };

  if (!isOpen) {
    return (
      <div
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 2147483647,
        }}
      >
        <div className="relative">
          <Button
            onClick={handleOpen}
            size="icon"
            className="h-14 w-14 rounded-full shadow-lg"
            data-testid="button-chat-widget"
          >
            <MessageCircle className="h-6 w-6" />
          </Button>
          <span className="absolute -top-1 -right-1 h-4 w-4 bg-green-500 rounded-full border-2 border-background animate-pulse" />
        </div>
      </div>
    );
  }

  if (isMinimized) {
    return (
      <div 
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 2147483647,
          cursor: 'pointer',
        }}
        onClick={() => setIsMinimized(false)}
        data-testid="chat-widget-minimized"
      >
        <Card className="p-3 shadow-lg flex items-center gap-2 hover-elevate">
          <Bot className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium">ClaimShield AI</span>
          {messages.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {messages.length}
            </Badge>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 2147483647,
      }}
    >
      <Card className="w-[380px] h-[520px] shadow-xl flex flex-col overflow-hidden" data-testid="chat-widget-window">
        <div className="flex items-center justify-between p-3 border-b bg-primary text-primary-foreground">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-full bg-primary-foreground/20 flex items-center justify-center">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-sm">ClaimShield AI</h3>
              <p className="text-xs opacity-80">Here to help you</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="text-primary-foreground hover:bg-primary-foreground/20"
              onClick={handleMinimize}
              data-testid="button-minimize-chat"
            >
              <Minimize2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-primary-foreground hover:bg-primary-foreground/20"
              onClick={handleClose}
              data-testid="button-close-chat"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {currentStepId !== "welcome" && currentStepId !== "complete" && (
          <div className="px-3 py-2 border-b bg-muted/30">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">Progress</span>
              <span className="text-xs font-medium">{progressPercent}%</span>
            </div>
            <Progress value={progressPercent} className="h-1.5" />
          </div>
        )}

        <ScrollArea className="flex-1">
          <div className="p-3 space-y-3" ref={scrollRef}>
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex gap-2",
                  message.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                {message.role === "assistant" && (
                  <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Bot className="h-3.5 w-3.5 text-primary" />
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                    message.role === "user"
                      ? message.isQuickReply 
                        ? "bg-primary/80 text-primary-foreground"
                        : "bg-primary text-primary-foreground"
                      : "bg-muted"
                  )}
                  data-testid={`message-${message.role}`}
                >
                  {message.content}
                </div>
                {message.role === "user" && (
                  <div className="h-7 w-7 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                    <User className="h-3.5 w-3.5 text-primary-foreground" />
                  </div>
                )}
              </div>
            ))}
            
            {/* Welcome Back Card for Returning Leads - shows immediately when returning lead opens chat */}
            {returningLead && (
              <Card className="bg-muted/50 p-4 space-y-3" data-testid="card-welcome-back">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-semibold text-base">Come visit us!</h4>
                    <p className="text-sm text-muted-foreground">The best way to experience our services is in person. We would love to have you!</p>
                  </div>
                  <div className="flex -space-x-2">
                    <div className="h-8 w-8 rounded-full bg-primary/20 border-2 border-background flex items-center justify-center">
                      <User className="h-4 w-4 text-primary" />
                    </div>
                  </div>
                </div>
                <Button 
                  variant="outline" 
                  className="w-full justify-between" 
                  onClick={() => {
                    setIsComplete(false);
                    setCurrentStepId("schedule_preference");
                    const scheduleStep = conversationFlow.find(s => s.id === "schedule_preference");
                    if (scheduleStep && sessionId) {
                      addMessageWithPersist("assistant", scheduleStep.message, sessionId, "schedule_preference");
                    }
                  }}
                  data-testid="button-schedule-tour"
                >
                  <span>Schedule A Consultation</span>
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button 
                  variant="default" 
                  className="w-full"
                  onClick={() => window.open(`/leads/${returningLead.id}`, '_blank')}
                  data-testid="button-view-profile"
                >
                  View My Profile
                </Button>
                <Button 
                  variant="secondary" 
                  className="w-full"
                  onClick={() => {
                    setCurrentStepId("service_type");
                    const serviceStep = conversationFlow.find(s => s.id === "service_type");
                    if (serviceStep && sessionId) {
                      addMessageWithPersist("assistant", "What else can I help you with?", sessionId, "service_type");
                    }
                    setIsComplete(false);
                  }}
                  data-testid="button-ask-more"
                >
                  Explore More Options
                </Button>
              </Card>
            )}

            {isLoading && currentStepId !== "confirmation" && (
              <div className="flex gap-2 justify-start">
                <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Bot className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="bg-muted rounded-lg px-3 py-2">
                  <div className="flex gap-1">
                    <span className="h-2 w-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="h-2 w-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="h-2 w-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {renderInputArea()}

        <div className="px-3 py-1.5 border-t bg-muted/20">
          <p className="text-[10px] text-muted-foreground text-center">
            Powered by ClaimShield AI • Your data is secure
          </p>
        </div>
      </Card>
    </div>
  );
}

export function GuidedChatWidget() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return createPortal(
    <GuidedChatContent />,
    document.body
  );
}
