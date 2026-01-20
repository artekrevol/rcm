import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  MessageCircle, 
  X, 
  Send, 
  Mic, 
  MicOff, 
  Phone, 
  PhoneOff,
  Loader2,
  Bot,
  User,
  Minimize2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import Vapi from "@vapi-ai/web";

interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  content: string;
  timestamp: Date;
}

interface VapiConfig {
  publicKey: string;
  assistantId: string;
  configured: boolean;
}

export function VapiChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isCallActive, setIsCallActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<"chat" | "voice">("chat");
  
  const vapiRef = useRef<Vapi | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch Vapi configuration
  const { data: config } = useQuery<VapiConfig>({
    queryKey: ["/api/vapi/widget-config"],
  });

  // Initialize Vapi when config is available
  useEffect(() => {
    if (!config?.publicKey || !config?.configured || vapiRef.current) return;

    const vapi = new Vapi(config.publicKey);
    vapiRef.current = vapi;

    vapi.on("call-start", () => {
      setIsCallActive(true);
      setIsConnected(true);
      addMessage("assistant", "Connected! I'm listening...");
    });

    vapi.on("call-end", () => {
      setIsCallActive(false);
      setIsConnected(false);
      setIsSpeaking(false);
      addMessage("assistant", "Call ended. How else can I help you?");
    });

    vapi.on("speech-start", () => {
      setIsSpeaking(true);
    });

    vapi.on("speech-end", () => {
      setIsSpeaking(false);
    });

    vapi.on("message", (message: any) => {
      if (message.type === "transcript" && message.transcriptType === "final") {
        const role = message.role === "assistant" ? "assistant" : "user";
        addMessage(role, message.transcript);
      }
    });

    vapi.on("error", (error: Error) => {
      console.error("Vapi error:", error);
      addMessage("assistant", "Sorry, there was an error. Please try again.");
    });

    return () => {
      if (vapiRef.current) {
        vapiRef.current.stop();
        vapiRef.current = null;
      }
    };
  }, [config]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && !isMinimized && inputRef.current && mode === "chat") {
      inputRef.current.focus();
    }
  }, [isOpen, isMinimized, mode]);

  const addMessage = useCallback((role: "assistant" | "user", content: string) => {
    const newMessage: ChatMessage = {
      id: `${Date.now()}-${Math.random()}`,
      role,
      content,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, newMessage]);
  }, []);

  const handleOpen = () => {
    setIsOpen(true);
    setIsMinimized(false);
    if (messages.length === 0) {
      addMessage("assistant", "Hi! I'm the ClaimShield AI assistant. How can I help you today? I can answer questions about our services, help you schedule an appointment, or connect you with our team.");
    }
  };

  const handleClose = () => {
    if (isCallActive && vapiRef.current) {
      vapiRef.current.stop();
    }
    setIsOpen(false);
    setIsMinimized(false);
  };

  const handleMinimize = () => {
    setIsMinimized(true);
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage = inputValue.trim();
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
      addMessage("assistant", "Sorry, I had trouble processing that. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartVoice = async () => {
    if (!vapiRef.current || !config?.assistantId) return;

    setMode("voice");
    try {
      await vapiRef.current.start(config.assistantId);
    } catch (error) {
      console.error("Failed to start voice call:", error);
      addMessage("assistant", "Couldn't start voice call. Please check your microphone permissions.");
      setMode("chat");
    }
  };

  const handleEndVoice = () => {
    if (vapiRef.current) {
      vapiRef.current.stop();
    }
    setMode("chat");
  };

  const handleToggleMute = () => {
    if (vapiRef.current) {
      const newMuted = !isMuted;
      vapiRef.current.setMuted(newMuted);
      setIsMuted(newMuted);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Don't render if not configured
  if (!config?.configured) {
    return null;
  }

  // Floating button when closed
  if (!isOpen) {
    return (
      <Button
        onClick={handleOpen}
        size="icon"
        className="fixed bottom-6 right-6 rounded-full shadow-lg z-50"
        data-testid="button-chat-widget"
      >
        <MessageCircle className="h-5 w-5" />
      </Button>
    );
  }

  // Minimized state
  if (isMinimized) {
    return (
      <div 
        className="fixed bottom-6 right-6 z-50 cursor-pointer hover-elevate"
        onClick={() => setIsMinimized(false)}
        data-testid="chat-widget-minimized"
      >
        <Card className="p-3 shadow-lg flex items-center gap-2">
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

  // Full chat window
  return (
    <Card className="fixed bottom-6 right-6 w-96 h-[500px] shadow-xl z-50 flex flex-col overflow-hidden" data-testid="chat-widget-window">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-primary text-primary-foreground">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          <div>
            <h3 className="font-semibold text-sm">ClaimShield AI</h3>
            <p className="text-xs opacity-80">
              {isCallActive ? "Voice call active" : "Online"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="text-primary-foreground"
            onClick={handleMinimize}
            data-testid="button-minimize-chat"
          >
            <Minimize2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-primary-foreground"
            onClick={handleClose}
            data-testid="button-close-chat"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4" ref={scrollRef}>
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "flex gap-2",
                message.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              {message.role === "assistant" && (
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
              )}
              <div
                className={cn(
                  "max-w-[75%] rounded-lg px-3 py-2 text-sm",
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                )}
              >
                {message.content}
              </div>
              {message.role === "user" && (
                <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                  <User className="h-4 w-4" />
                </div>
              )}
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-2 justify-start">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div className="bg-muted rounded-lg px-3 py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Voice call indicator */}
      {isCallActive && (
        <div className="px-4 py-2 bg-green-500/10 border-t border-green-500/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={cn(
                "h-3 w-3 rounded-full",
                isSpeaking ? "bg-green-500 animate-pulse" : "bg-green-500"
              )} />
              <span className="text-sm text-green-700 dark:text-green-400">
                {isSpeaking ? "AI is speaking..." : "Listening..."}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleToggleMute}
              >
                {isMuted ? <MicOff className="h-4 w-4 text-destructive" /> : <Mic className="h-4 w-4" />}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleEndVoice}
              >
                <PhoneOff className="h-4 w-4 mr-1" />
                End
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="p-4 border-t">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isCallActive ? "Voice call active..." : "Type a message..."}
            disabled={isLoading || isCallActive}
            className="flex-1"
            data-testid="input-chat-message"
          />
          {!isCallActive ? (
            <>
              <Button
                onClick={handleSendMessage}
                disabled={!inputValue.trim() || isLoading}
                size="icon"
                data-testid="button-send-message"
              >
                <Send className="h-4 w-4" />
              </Button>
              <Button
                onClick={handleStartVoice}
                variant="outline"
                size="icon"
                title="Start voice call"
                data-testid="button-start-voice"
              >
                <Phone className="h-4 w-4" />
              </Button>
            </>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground mt-2 text-center">
          Powered by ClaimShield AI
        </p>
      </div>
    </Card>
  );
}
