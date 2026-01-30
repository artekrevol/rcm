import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
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
  DollarSign,
  Building2,
  Users,
  MessageSquare,
  PhoneCall,
  Image
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";

interface ConversationStep {
  id: string;
  type: "message" | "quick-reply" | "text-input" | "multi-select" | "phone-input" | "email-input" | "date-input" | "confirmation" | "appointment-picker" | "textarea-input" | "dob-input";
  message: string;
  tooltip?: string;
  options?: { label: string; value: string; icon?: React.ReactNode }[];
  placeholder?: string;
  field?: string;
  validation?: (value: string) => boolean;
  nextStep?: string | ((value: string) => string);
  skipCondition?: (data: Record<string, string>) => boolean;
  flowCategory?: string;
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
  // Welcome & Main Menu
  {
    id: "welcome",
    type: "message",
    message: "How can I help you today?",
    tooltip: "Select an option to get started.",
    nextStep: "main_menu"
  },
  {
    id: "main_menu",
    type: "quick-reply",
    message: "Please choose an option:",
    options: [
      { label: "Get Pricing", value: "pricing", icon: <DollarSign className="h-4 w-4" /> },
      { label: "Verify Insurance", value: "verify_insurance", icon: <Shield className="h-4 w-4" /> },
      { label: "Connect With Admissions", value: "admissions", icon: <Users className="h-4 w-4" /> },
      { label: "Ask A Question", value: "question", icon: <HelpCircle className="h-4 w-4" /> },
    ],
    field: "mainChoice",
    nextStep: (value) => {
      switch (value) {
        case "pricing": return "pricing_payment_type";
        case "verify_insurance": return "vob_treatment_type";
        case "admissions": return "admissions_treatment_type";
        case "question": return "question_topic";
        default: return "main_menu";
      }
    }
  },

  // ========== GET PRICING FLOW ==========
  {
    id: "pricing_payment_type",
    type: "quick-reply",
    message: "We accept both private pay and insurance. Which will you be using?",
    flowCategory: "pricing",
    options: [
      { label: "Insurance", value: "insurance", icon: <Shield className="h-4 w-4" /> },
      { label: "Private Pay", value: "private_pay", icon: <DollarSign className="h-4 w-4" /> }
    ],
    field: "paymentType",
    nextStep: (value) => value === "insurance" ? "pricing_insurance_type" : "pricing_treatment_type"
  },
  {
    id: "pricing_insurance_type",
    type: "quick-reply",
    message: "What type of insurance do you have?",
    flowCategory: "pricing",
    options: [
      { label: "Blue Cross Blue Shield", value: "bcbs" },
      { label: "Aetna", value: "aetna" },
      { label: "UnitedHealthcare", value: "united" },
      { label: "Cigna", value: "cigna" },
      { label: "Humana", value: "humana" },
      { label: "Other", value: "other" }
    ],
    field: "insuranceCarrier",
    nextStep: "pricing_verify_prompt"
  },
  {
    id: "pricing_verify_prompt",
    type: "quick-reply",
    message: "We accept several providers. Let's start by verifying some information on your coverage.",
    flowCategory: "pricing",
    options: [
      { label: "Verify Insurance", value: "verify", icon: <Shield className="h-4 w-4" /> }
    ],
    field: "pricingInsuranceVerify",
    nextStep: "pricing_vob_treatment_type"
  },
  {
    id: "pricing_vob_treatment_type",
    type: "quick-reply",
    message: "What type of treatment is the patient looking for?",
    flowCategory: "pricing",
    options: [
      { label: "Inpatient", value: "inpatient", icon: <Building2 className="h-4 w-4" /> },
      { label: "Outpatient", value: "outpatient", icon: <Clock className="h-4 w-4" /> }
    ],
    field: "treatmentType",
    nextStep: "pricing_vob_patient_name"
  },
  {
    id: "pricing_vob_patient_name",
    type: "text-input",
    message: "What is the patient's first and last name?",
    flowCategory: "pricing",
    placeholder: "Enter full name",
    field: "name",
    validation: (value) => value.trim().length >= 2,
    nextStep: "pricing_vob_email"
  },
  {
    id: "pricing_vob_email",
    type: "email-input",
    message: "What is your email address?",
    flowCategory: "pricing",
    placeholder: "your@email.com",
    field: "email",
    validation: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    nextStep: "pricing_vob_phone"
  },
  {
    id: "pricing_vob_phone",
    type: "phone-input",
    message: "What is your phone number?",
    flowCategory: "pricing",
    placeholder: "(555) 555-5555",
    field: "phone",
    validation: (value) => /^\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}$/.test(value.replace(/\s/g, '')),
    nextStep: "pricing_vob_dob"
  },
  {
    id: "pricing_vob_dob",
    type: "dob-input",
    message: "What is the patient's date of birth? (MM-DD-YYYY)",
    flowCategory: "pricing",
    placeholder: "MM-DD-YYYY",
    field: "dateOfBirth",
    validation: (value) => /^(0[1-9]|1[0-2])[-\/](0[1-9]|[12]\d|3[01])[-\/](19|20)\d{2}$/.test(value),
    nextStep: "pricing_vob_member_id"
  },
  {
    id: "pricing_vob_member_id",
    type: "text-input",
    message: "What is the insurance ID number?",
    flowCategory: "pricing",
    placeholder: "Enter Member/Policy ID",
    field: "memberId",
    nextStep: "vob_confirmation"
  },
  {
    id: "pricing_treatment_type",
    type: "quick-reply",
    message: "What type of treatment are you looking for?",
    flowCategory: "pricing",
    options: [
      { label: "Inpatient", value: "inpatient", icon: <Building2 className="h-4 w-4" /> },
      { label: "Outpatient", value: "outpatient", icon: <Clock className="h-4 w-4" /> }
    ],
    field: "treatmentType",
    nextStep: "pricing_seeking_for"
  },
  {
    id: "pricing_seeking_for",
    type: "quick-reply",
    message: "Who are you seeking treatment for?",
    flowCategory: "pricing",
    options: [
      { label: "Myself", value: "myself", icon: <User className="h-4 w-4" /> },
      { label: "Someone Else", value: "someone_else", icon: <Users className="h-4 w-4" /> }
    ],
    field: "seekingFor",
    nextStep: "contact_name"
  },

  // ========== VERIFY INSURANCE (VOB) FLOW ==========
  {
    id: "vob_treatment_type",
    type: "quick-reply",
    message: "What type of treatment is the patient looking for?",
    flowCategory: "verify_insurance",
    options: [
      { label: "Inpatient", value: "inpatient", icon: <Building2 className="h-4 w-4" /> },
      { label: "Outpatient", value: "outpatient", icon: <Clock className="h-4 w-4" /> }
    ],
    field: "treatmentType",
    nextStep: "vob_patient_name"
  },
  {
    id: "vob_patient_name",
    type: "text-input",
    message: "What is the patient's first and last name?",
    flowCategory: "verify_insurance",
    placeholder: "Enter full name",
    field: "name",
    validation: (value) => value.trim().length >= 2,
    nextStep: "contact_email"
  },

  // ========== CONNECT WITH ADMISSIONS FLOW ==========
  {
    id: "admissions_treatment_type",
    type: "quick-reply",
    message: "What type of treatment are you looking for?",
    flowCategory: "admissions",
    options: [
      { label: "Inpatient", value: "inpatient", icon: <Building2 className="h-4 w-4" /> },
      { label: "Outpatient", value: "outpatient", icon: <Clock className="h-4 w-4" /> }
    ],
    field: "treatmentType",
    nextStep: "admissions_seeking_for"
  },
  {
    id: "admissions_seeking_for",
    type: "quick-reply",
    message: "Who are you seeking treatment for?",
    flowCategory: "admissions",
    options: [
      { label: "Myself", value: "myself", icon: <User className="h-4 w-4" /> },
      { label: "Someone Else", value: "someone_else", icon: <Users className="h-4 w-4" /> }
    ],
    field: "seekingFor",
    nextStep: "admissions_name"
  },
  {
    id: "admissions_name",
    type: "text-input",
    message: "What is your first and last name?",
    flowCategory: "admissions",
    placeholder: "Enter your full name",
    field: "name",
    validation: (value) => value.trim().length >= 2,
    nextStep: "contact_email"
  },

  // ========== ASK A QUESTION FLOW ==========
  {
    id: "question_topic",
    type: "quick-reply",
    message: "What is your question in regard to?",
    flowCategory: "question",
    options: [
      { label: "Treatment Options", value: "treatment", icon: <Heart className="h-4 w-4" /> },
      { label: "Insurance & Payment", value: "insurance", icon: <Shield className="h-4 w-4" /> },
      { label: "Scheduling", value: "scheduling", icon: <Calendar className="h-4 w-4" /> },
      { label: "Something Else", value: "other", icon: <HelpCircle className="h-4 w-4" /> }
    ],
    field: "questionTopic",
    nextStep: "question_text"
  },
  {
    id: "question_text",
    type: "textarea-input",
    message: "What is your question?",
    flowCategory: "question",
    placeholder: "Type your question here...",
    field: "questionText",
    validation: (value) => value.trim().length >= 5,
    nextStep: "question_contact_prompt"
  },
  {
    id: "question_contact_prompt",
    type: "message",
    message: "To provide a response, we need some basic contact information. What is your first and last name?",
    flowCategory: "question",
    nextStep: "question_name"
  },
  {
    id: "question_name",
    type: "text-input",
    message: "",
    flowCategory: "question",
    placeholder: "Enter your full name",
    field: "name",
    validation: (value) => value.trim().length >= 2,
    nextStep: "contact_email"
  },

  // ========== SHARED CONTACT COLLECTION ==========
  {
    id: "contact_name",
    type: "text-input",
    message: "What is your first and last name?",
    placeholder: "Enter your full name",
    field: "name",
    validation: (value) => value.trim().length >= 2,
    nextStep: "contact_email"
  },
  {
    id: "contact_email",
    type: "email-input",
    message: "What is your email address?",
    placeholder: "your@email.com",
    field: "email",
    validation: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    nextStep: "contact_phone"
  },
  {
    id: "contact_phone",
    type: "phone-input",
    message: "What is your phone number?",
    placeholder: "(555) 555-5555",
    field: "phone",
    validation: (value) => /^\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}$/.test(value.replace(/\s/g, '')),
    nextStep: "route_after_contact"
  },

  // ========== VOB ADDITIONAL INFO ==========
  {
    id: "vob_dob",
    type: "dob-input",
    message: "What is the patient's date of birth? (MM-DD-YYYY)",
    flowCategory: "verify_insurance",
    placeholder: "MM-DD-YYYY",
    field: "dateOfBirth",
    validation: (value) => /^(0[1-9]|1[0-2])[-\/](0[1-9]|[12]\d|3[01])[-\/](19|20)\d{2}$/.test(value),
    nextStep: "vob_insurance_provider"
  },
  {
    id: "vob_insurance_provider",
    type: "quick-reply",
    message: "Who is the insurance provider?",
    flowCategory: "verify_insurance",
    options: [
      { label: "Blue Cross Blue Shield", value: "bcbs" },
      { label: "Aetna", value: "aetna" },
      { label: "UnitedHealthcare", value: "united" },
      { label: "Cigna", value: "cigna" },
      { label: "Humana", value: "humana" },
      { label: "Medicare", value: "medicare" },
      { label: "Medicaid", value: "medicaid" },
      { label: "Other", value: "other" }
    ],
    field: "insuranceCarrier",
    nextStep: "vob_member_id"
  },
  {
    id: "vob_member_id",
    type: "text-input",
    message: "What is the insurance ID number?",
    flowCategory: "verify_insurance",
    placeholder: "Enter Member/Policy ID",
    field: "memberId",
    nextStep: "vob_confirmation"
  },
  {
    id: "vob_confirmation",
    type: "confirmation",
    message: "Thank you, one of our team members will reach out shortly to confirm your insurance has been verified!",
    flowCategory: "verify_insurance",
    nextStep: "complete"
  },

  // ========== ADMISSIONS ADDITIONAL INFO ==========
  {
    id: "admissions_additional_info",
    type: "textarea-input",
    message: "Please provide any additional information you would like us to know.",
    flowCategory: "admissions",
    placeholder: "Type any additional details here...",
    field: "additionalInfo",
    nextStep: "contact_preference"
  },

  // ========== CONTACT PREFERENCE ==========
  {
    id: "contact_preference",
    type: "quick-reply",
    message: "Which would you like to do?",
    options: [
      { label: "Text Us", value: "text", icon: <MessageSquare className="h-4 w-4" /> },
      { label: "Call Me", value: "call", icon: <PhoneCall className="h-4 w-4" /> }
    ],
    field: "contactPreference",
    nextStep: "confirmation"
  },

  // ========== AFTER FLOW OPTIONS ==========
  {
    id: "after_flow_options",
    type: "quick-reply",
    message: "Is there anything else I can help you with?",
    options: [
      { label: "Get Pricing", value: "pricing", icon: <DollarSign className="h-4 w-4" /> },
      { label: "Connect With Admissions", value: "admissions", icon: <Users className="h-4 w-4" /> },
      { label: "Ask A Question", value: "question", icon: <HelpCircle className="h-4 w-4" /> },
      { label: "No, Thank You", value: "done", icon: <CheckCircle2 className="h-4 w-4" /> }
    ],
    nextStep: (value) => {
      switch (value) {
        case "pricing": return "pricing_payment_type";
        case "admissions": return "admissions_treatment_type";
        case "question": return "question_topic";
        default: return "complete";
      }
    }
  },

  // ========== CONFIRMATION & COMPLETE ==========
  {
    id: "confirmation",
    type: "confirmation",
    message: "Thank you, one of our team members will be in touch shortly! Please note that if you have reached out after-hours, someone will be in touch the next business day.",
    tooltip: "Review your information before we proceed.",
    nextStep: "complete"
  },
  {
    id: "complete",
    type: "message",
    message: "Thank you for contacting us! Is there anything else I can help you with?",
    tooltip: "Feel free to ask any questions about our services."
  }
];

function getFlowSteps(mainChoice: string, paymentType?: string): string[] {
  const baseSteps = ["welcome", "main_menu"];
  
  switch (mainChoice) {
    case "pricing":
      if (paymentType === "insurance") {
        return [...baseSteps, "pricing_payment_type", "pricing_insurance_type", "pricing_verify_prompt", "pricing_vob_treatment_type", "pricing_vob_patient_name", "pricing_vob_email", "pricing_vob_phone", "pricing_vob_dob", "pricing_vob_member_id", "vob_confirmation", "complete"];
      }
      return [...baseSteps, "pricing_payment_type", "pricing_treatment_type", "pricing_seeking_for", "contact_name", "contact_email", "contact_phone", "contact_preference", "confirmation", "complete"];
    case "verify_insurance":
      return [...baseSteps, "vob_treatment_type", "vob_patient_name", "contact_email", "contact_phone", "vob_dob", "vob_insurance_provider", "vob_member_id", "vob_confirmation", "complete"];
    case "admissions":
      return [...baseSteps, "admissions_treatment_type", "admissions_seeking_for", "admissions_name", "contact_email", "contact_phone", "admissions_additional_info", "contact_preference", "confirmation", "complete"];
    case "question":
      return [...baseSteps, "question_topic", "question_text", "question_contact_prompt", "question_name", "contact_email", "contact_phone", "confirmation", "complete"];
    default:
      return baseSteps;
  }
}

function formatPhone(value: string): string {
  const cleaned = value.replace(/\D/g, '');
  if (cleaned.length <= 3) return cleaned;
  if (cleaned.length <= 6) return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
  return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
}

function formatDob(value: string): string {
  const cleaned = value.replace(/\D/g, '');
  if (cleaned.length <= 2) return cleaned;
  if (cleaned.length <= 4) return `${cleaned.slice(0, 2)}-${cleaned.slice(2)}`;
  return `${cleaned.slice(0, 2)}-${cleaned.slice(2, 4)}-${cleaned.slice(4, 8)}`;
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sessionInitialized = useRef(false);

  const currentStep = conversationFlow.find(s => s.id === currentStepId);
  const flowSteps = getFlowSteps(collectedData.mainChoice || "", collectedData.paymentType);
  const currentStepIndex = flowSteps.indexOf(currentStepId);
  const progressPercent = flowSteps.length > 1 ? Math.round((currentStepIndex / (flowSteps.length - 1)) * 100) : 0;

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
        
        if (data.returningLead) {
          setReturningLead(data.returningLead);
        }
        
        if (data.resumed && data.messages.length > 0) {
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
          const firstName = data.returningLead.name.split(' ')[0];
          addMessageWithPersist("assistant", `Welcome back, ${firstName}! How can I help you today?`, data.session.id, "welcome");
          setCurrentStepId("main_menu");
          setTimeout(() => {
            const menuStep = conversationFlow.find(s => s.id === "main_menu");
            if (menuStep) {
              addMessageWithPersist("assistant", menuStep.message, data.session.id, "main_menu");
            }
          }, 500);
        } else {
          const welcomeStep = conversationFlow.find(s => s.id === "welcome");
          if (welcomeStep) {
            addMessageWithPersist("assistant", welcomeStep.message, data.session.id, "welcome");
            setCurrentStepId("main_menu");
            setTimeout(() => {
              const menuStep = conversationFlow.find(s => s.id === "main_menu");
              if (menuStep) {
                addMessageWithPersist("assistant", menuStep.message, data.session.id, "main_menu");
              }
            }, 500);
          }
        }
      } catch (error) {
        console.error("Failed to init session:", error);
        const welcomeStep = conversationFlow.find(s => s.id === "welcome");
        if (welcomeStep) {
          addMessage("assistant", welcomeStep.message);
          setCurrentStepId("main_menu");
          setTimeout(() => {
            const menuStep = conversationFlow.find(s => s.id === "main_menu");
            if (menuStep) {
              addMessage("assistant", menuStep.message);
            }
          }, 500);
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
    if (isOpen && !isMinimized) {
      if (currentStep?.type === "textarea-input" && textareaRef.current) {
        textareaRef.current.focus();
      } else if (inputRef.current && currentStep?.type !== "quick-reply" && currentStep?.type !== "confirmation") {
        inputRef.current.focus();
      }
    }
  }, [isOpen, isMinimized, currentStepId]);
  
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
  };

  const handleClose = () => {
    setIsOpen(false);
    setIsMinimized(false);
  };

  const handleMinimize = () => {
    setIsMinimized(true);
  };

  const getNextStepAfterContact = (): string => {
    const mainChoice = collectedData.mainChoice;
    switch (mainChoice) {
      case "pricing":
        return "contact_preference";
      case "verify_insurance":
        return "vob_dob";
      case "admissions":
        return "admissions_additional_info";
      case "question":
        return "confirmation";
      default:
        return "confirmation";
    }
  };

  const goToNextStep = (value: string, displayValue?: string) => {
    if (!currentStep) return;

    const updatedData = currentStep.field 
      ? { ...collectedData, [currentStep.field]: value }
      : collectedData;
    
    if (currentStep.field) {
      setCollectedData(updatedData);
    }

    addMessage("user", displayValue || value, true);

    let nextStepId: string | undefined;
    
    if (typeof currentStep.nextStep === "function") {
      nextStepId = currentStep.nextStep(value);
    } else {
      nextStepId = currentStep.nextStep;
    }
    
    if (nextStepId === "route_after_contact") {
      nextStepId = getNextStepAfterContact();
    }

    if (nextStepId) {
      setIsLoading(true);
      setTimeout(() => {
        let actualNextStep = nextStepId;
        const nextStep = conversationFlow.find(s => s.id === nextStepId);
        
        if (nextStep?.skipCondition && nextStep.skipCondition(updatedData)) {
          if (typeof nextStep.nextStep === "string") {
            actualNextStep = nextStep.nextStep;
          }
        }

        setCurrentStepId(actualNextStep!);
        const step = conversationFlow.find(s => s.id === actualNextStep);
        if (step) {
          if (step.type === "confirmation") {
            addMessage("assistant", step.message);
            submitLeadWithData(updatedData);
          } else if (step.type === "appointment-picker") {
            addMessage("assistant", step.message);
            setAppointmentSlots(generateAppointmentSlots());
          } else if (step.message) {
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
      if (currentStep.type === "dob-input") {
        addMessage("assistant", "Please enter a valid date in MM-DD-YYYY format.");
      } else if (currentStep.type === "email-input") {
        addMessage("assistant", "Please enter a valid email address.");
      } else if (currentStep.type === "phone-input") {
        addMessage("assistant", "Please enter a valid phone number.");
      } else {
        addMessage("assistant", "Please enter a valid value and try again.");
      }
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

  const submitLeadWithData = async (data: Record<string, string>) => {
    setIsLoading(true);
    try {
      const mainChoice = data.mainChoice || "unknown";
      let priority = "P2";
      if (mainChoice === "admissions" || data.contactPreference === "call") {
        priority = "P0";
      } else if (mainChoice === "verify_insurance" || data.paymentType === "insurance") {
        priority = "P1";
      }

      const notes: string[] = [];
      if (mainChoice) notes.push(`Flow: ${mainChoice}`);
      if (data.treatmentType) notes.push(`Treatment: ${data.treatmentType}`);
      if (data.seekingFor) notes.push(`For: ${data.seekingFor}`);
      if (data.paymentType) notes.push(`Payment: ${data.paymentType}`);
      if (data.dateOfBirth) notes.push(`DOB: ${data.dateOfBirth}`);
      if (data.contactPreference) notes.push(`Contact preference: ${data.contactPreference}`);
      if (data.questionTopic) notes.push(`Question topic: ${data.questionTopic}`);
      if (data.questionText) notes.push(`Question: ${data.questionText}`);
      if (data.additionalInfo) notes.push(`Additional info: ${data.additionalInfo}`);

      const leadData = {
        name: data.name || "Website Visitor",
        phone: data.phone?.replace(/\D/g, '') || "",
        email: data.email || "",
        source: "chat_widget",
        status: "new",
        priority,
        serviceNeeded: data.treatmentType || "",
        insuranceCarrier: data.insuranceCarrier || "",
        memberId: data.memberId || "",
        bestTimeToCall: data.contactPreference === "call" ? "anytime" : "",
        notes: notes.join(". ") + "."
      };

      const leadResponse = await apiRequest("POST", "/api/leads", leadData);
      const lead = await leadResponse.json();
      setCreatedLeadId(lead.id);
      
      // Send automatic SMS follow-up
      if (lead.id && data.phone && data.contactPreference !== "call") {
        try {
          const firstName = (data.name || "").split(' ')[0] || "there";
          await apiRequest("POST", `/api/leads/${lead.id}/send-sms`, {
            message: `Hello, ${firstName}, this is Claim Shield Health. Thank you for contacting us. Do you have any immediate questions we can answer?`
          });
        } catch (smsError) {
          console.error("Failed to send follow-up SMS:", smsError);
        }
      }
      
      // Send confirmation email
      if (lead.id && data.email) {
        try {
          await apiRequest("POST", `/api/leads/${lead.id}/send-confirmation`, {
            appointmentDate: data.appointmentSlot || null
          });
        } catch (emailError) {
          console.error("Failed to send confirmation email:", emailError);
        }
      }
      
      // Mark session as completed
      if (sessionId && lead.id) {
        try {
          const qualScore = priority === "P0" ? 90 : priority === "P1" ? 70 : 50;
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
          addMessage("assistant", completeStep.message);
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

    if (currentStep.type === "textarea-input") {
      return (
        <div className="p-3 border-t">
          <div className="flex flex-col gap-2">
            <Textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={currentStep.placeholder || "Type your response..."}
              disabled={isLoading}
              className="min-h-[80px] resize-none"
              data-testid="input-textarea-response"
            />
            <Button
              onClick={handleTextSubmit}
              disabled={!inputValue.trim() || isLoading}
              className="self-end"
              data-testid="button-submit-textarea"
            >
              <Send className="h-4 w-4 mr-1.5" />
              Submit
            </Button>
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
              {collectedData.treatmentType && <p><span className="text-muted-foreground">Treatment:</span> {collectedData.treatmentType}</p>}
              {collectedData.insuranceCarrier && <p><span className="text-muted-foreground">Insurance:</span> {collectedData.insuranceCarrier.toUpperCase()}</p>}
              {collectedData.dateOfBirth && <p><span className="text-muted-foreground">DOB:</span> {collectedData.dateOfBirth}</p>}
              {collectedData.memberId && <p><span className="text-muted-foreground">Member ID:</span> {collectedData.memberId}</p>}
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
              {collectedData.treatmentType && <p><span className="text-muted-foreground">Treatment:</span> {collectedData.treatmentType}</p>}
            </div>
          </Card>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => {
                setIsComplete(false);
                setCurrentStepId("main_menu");
                addMessage("assistant", "What else can I help you with?");
              }}
              data-testid="button-start-over"
            >
              Start New Inquiry
            </Button>
          </div>
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
      } else if (currentStep.type === "dob-input") {
        value = formatDob(value);
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
          <span className="text-sm font-medium">Claim Shield Health</span>
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
              <h3 className="font-semibold text-sm">Claim Shield Health</h3>
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

        {currentStepId !== "welcome" && currentStepId !== "main_menu" && currentStepId !== "complete" && collectedData.mainChoice && (
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
            
            {returningLead && currentStepId === "main_menu" && (
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
                    setCurrentStepId("admissions_treatment_type");
                    setCollectedData(prev => ({ ...prev, mainChoice: "admissions" }));
                    const step = conversationFlow.find(s => s.id === "admissions_treatment_type");
                    if (step && sessionId) {
                      addMessageWithPersist("assistant", step.message, sessionId, "admissions_treatment_type");
                    }
                  }}
                  data-testid="button-schedule-tour"
                >
                  <span>Connect With Admissions</span>
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button 
                  variant="default" 
                  className="w-full"
                  onClick={() => window.open(`/deals/${returningLead.id}`, '_blank')}
                  data-testid="button-view-profile"
                >
                  View My Profile
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
            Powered by Claim Shield Health
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
