import { useState, useEffect, useCallback, useRef } from "react";
import Vapi from "@vapi-ai/web";

interface VapiMessage {
  role: "agent" | "user";
  text: string;
  timestamp: Date;
}

interface UseVapiOptions {
  publicKey: string;
  onMessage?: (message: VapiMessage) => void;
  onCallStart?: () => void;
  onCallEnd?: () => void;
  onError?: (error: Error) => void;
}

interface UseVapiReturn {
  isConnected: boolean;
  isCallActive: boolean;
  isSpeaking: boolean;
  messages: VapiMessage[];
  volumeLevel: number;
  startCall: (assistantConfig: AssistantConfig) => Promise<void>;
  endCall: () => void;
  toggleMute: () => void;
  isMuted: boolean;
}

interface AssistantConfig {
  firstMessage?: string;
  systemPrompt: string;
  leadName: string;
  leadPhone: string;
  model?: string;
  voice?: string;
}

export function useVapi({ publicKey, onMessage, onCallStart, onCallEnd, onError }: UseVapiOptions): UseVapiReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isCallActive, setIsCallActive] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [messages, setMessages] = useState<VapiMessage[]>([]);
  const [volumeLevel, setVolumeLevel] = useState(0);
  
  const vapiRef = useRef<Vapi | null>(null);
  const onMessageRef = useRef(onMessage);
  const onCallStartRef = useRef(onCallStart);
  const onCallEndRef = useRef(onCallEnd);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onMessageRef.current = onMessage;
    onCallStartRef.current = onCallStart;
    onCallEndRef.current = onCallEnd;
    onErrorRef.current = onError;
  }, [onMessage, onCallStart, onCallEnd, onError]);

  useEffect(() => {
    if (!publicKey || vapiRef.current) return;

    const vapi = new Vapi(publicKey);
    vapiRef.current = vapi;

    vapi.on("call-start", () => {
      setIsCallActive(true);
      setIsConnected(true);
      onCallStartRef.current?.();
    });

    vapi.on("call-end", () => {
      setIsCallActive(false);
      setIsConnected(false);
      setIsSpeaking(false);
      onCallEndRef.current?.();
    });

    vapi.on("speech-start", () => {
      setIsSpeaking(true);
    });

    vapi.on("speech-end", () => {
      setIsSpeaking(false);
    });

    vapi.on("volume-level", (level: number) => {
      setVolumeLevel(level);
    });

    vapi.on("error", (error: Error) => {
      console.error("Vapi error:", error);
      onErrorRef.current?.(error);
    });

    vapi.on("message", (message: any) => {
      if (message.type === "transcript" && message.transcriptType === "final") {
        const newMessage: VapiMessage = {
          role: message.role === "assistant" ? "agent" : "user",
          text: message.transcript,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, newMessage]);
        onMessageRef.current?.(newMessage);
      }
    });

    return () => {
      if (vapiRef.current) {
        vapiRef.current.stop();
        vapiRef.current = null;
      }
    };
  }, [publicKey]);

  const startCall = useCallback(async (config: AssistantConfig) => {
    if (!vapiRef.current) return;

    setMessages([]);
    
    const assistantOverrides = {
      firstMessage: config.firstMessage || `Hello, this is Alex from Claim Shield Health. Am I speaking with ${config.leadName}?`,
      model: {
        provider: "openai" as const,
        model: "gpt-4o-mini" as const,
        messages: [
          {
            role: "system" as const,
            content: config.systemPrompt,
          },
        ],
      },
      voice: {
        provider: "11labs" as const,
        voiceId: config.voice || "21m00Tcm4TlvDq8ikWAM",
      },
    };

    try {
      await vapiRef.current.start(assistantOverrides);
    } catch (error) {
      console.error("Failed to start Vapi call:", error);
      onErrorRef.current?.(error as Error);
    }
  }, []);

  const endCall = useCallback(() => {
    if (vapiRef.current) {
      vapiRef.current.stop();
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (vapiRef.current) {
      const newMuted = !isMuted;
      vapiRef.current.setMuted(newMuted);
      setIsMuted(newMuted);
    }
  }, [isMuted]);

  return {
    isConnected,
    isCallActive,
    isSpeaking,
    messages,
    volumeLevel,
    startCall,
    endCall,
    toggleMute,
    isMuted,
  };
}
