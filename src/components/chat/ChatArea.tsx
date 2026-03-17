import React, { useEffect, useCallback, useMemo, useRef, useState } from "react";
import {
  useCopilotAdditionalInstructions,
  useCopilotChatInternal,
  useLangGraphInterrupt,
} from "@copilotkit/react-core";
import { randomUUID } from "@copilotkit/shared";
import { AssistantMessage } from "./AssistantMessage";
import { ChatComposer } from "./ChatComposer";
import {
  DefaultImageRenderer,
  DefaultRenderMessage,
  DefaultUserMessage,
} from "./DefaultChatRenderers";
import { VirtualizedMessages } from "./VirtualizedMessages";
import { useThreadHistory } from "./useThreadHistory";
import { WelcomeScreen } from "./WelcomeScreen";
import { ModelSelector } from "./ModelSelector";
import { HITLInterruptCard } from "./HITLInterruptCard";
import { useAgent } from "../../contexts";
import { CHAT_INSTRUCTIONS, CHAT_SUGGESTIONS } from "../../lib/consts";
import type { AgentType } from "../../lib/consts";
import { saveThreadAgentState } from "../../services/threadService";
import type { AgentStateSnapshot } from "../../services/threadService";

const PERF_OBSERVE_KEY = "__graphrag_perf_observe_v1__";

interface ChatAreaProps {
  agent: AgentType;
  threadId: string;
  userId: string;
  onFirstMessage: (message: string) => void;
  isNewThread: boolean;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  agent,
  threadId,
  userId,
  onFirstMessage,
  isNewThread,
}) => {
  const { state: agentState, running } = useAgent();
  useCopilotAdditionalInstructions({ instructions: CHAT_INSTRUCTIONS[agent] }, [agent]);
  const {
    messages,
    isLoading,
    sendMessage,
    stopGeneration,
    interrupt,
    agent: connectedAgent,
  } = useCopilotChatInternal({
    onSubmitMessage: onFirstMessage,
  });
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>("");
  const virtualizedMessagesPropsRef = useRef<Record<string, unknown>>({});
  const {
    historyMessages,
    hasOlderHistory,
    isHistoryLoading,
    isLoadingOlderHistory,
    loadOlderHistory,
  } = useThreadHistory({
    threadId,
    agent,
    userId,
    enabled: !isNewThread,
  });
  const [perfObserve, setPerfObserve] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PERF_OBSERVE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const togglePerfObserve = useCallback(() => {
    setPerfObserve((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PERF_OBSERVE_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);

  virtualizedMessagesPropsRef.current = {
    perfEnabled: perfObserve,
    historyMessages: historyMessages as any,
    hasOlderHistory,
    isLoadingOlderHistory: isLoadingOlderHistory || isHistoryLoading,
    initialMessages: "",
    interruptElement: interrupt,
    onLoadOlderHistory: loadOlderHistory,
    threadKey: threadId,
  };

  const MessagesWithPerf = useMemo(() => {
    return (props: any) => (
      <VirtualizedMessages
        {...props}
        {...(virtualizedMessagesPropsRef.current as any)}
      />
    );
  }, []);

  useEffect(() => {
    if (!agentState?.steps?.length) return;

    const snapshot: AgentStateSnapshot = {
      steps: agentState.steps,
      local_rag_result: agentState.local_rag_result,
      global_rag_result: agentState.global_rag_result,
    };

    const snapshotStr = JSON.stringify(snapshot);
    if (snapshotStr === lastSavedRef.current) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(() => {
      void saveThreadAgentState(threadId, snapshot);
      lastSavedRef.current = snapshotStr;
    }, running ? 1200 : 250);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [agentState, running, threadId]);

  useEffect(() => {
    if (!isNewThread) return;
    const timer = setTimeout(() => {
      const textarea = document.querySelector(".copilotKitInput textarea") as HTMLTextAreaElement | null;
      textarea?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [isNewThread, threadId]);

  useLangGraphInterrupt({
    render: ({ event, resolve }) => {
      return <HITLInterruptCard eventValue={event?.value} resolve={resolve as any} />;
    },
  }, [threadId]);

  const hasMessages = (messages?.length ?? 0) > 0 || historyMessages.length > 0;
  const showWelcome = isNewThread && !hasMessages;
  const suggestions = CHAT_SUGGESTIONS[agent] || [];

  const handleSuggestionClick = useCallback((suggestion: string) => {
    const textarea = document.querySelector(".copilotKitInput textarea") as HTMLTextAreaElement | null;
    if (!textarea) return;

    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (valueSetter) {
      valueSetter.call(textarea, suggestion);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
    textarea.focus();
  }, []);

  const handleSendMessage = useCallback(
    async (content: string) => {
      if (!connectedAgent) {
        return;
      }

      await sendMessage({
        id: randomUUID(),
        role: "user",
        content,
      });
    },
    [connectedAgent, sendMessage]
  );

  return (
    <>
      <header className="chat-header">
        <div className="chat-header-left">
          <ModelSelector />
          <button
            type="button"
            onClick={togglePerfObserve}
            title="临时性能观测开关（仅前端显示）"
            style={{
              marginLeft: 10,
              height: 30,
              padding: "0 10px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              background: perfObserve ? "#0f766e" : "#ffffff",
              color: perfObserve ? "#ffffff" : "#334155",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            性能观测 {perfObserve ? "ON" : "OFF"}
          </button>
        </div>
      </header>

      <div className={`chat-container ${showWelcome ? "with-welcome" : ""}`}>
        {showWelcome && (
          <>
            <WelcomeScreen visible={true} />
            {suggestions.length > 0 && (
              <div className="suggestions-container">
                <div className="suggestions-grid">
                  {suggestions.map((suggestion, index) => (
                    <button key={index} className="suggestion-item" onClick={() => handleSuggestionClick(suggestion)}>
                      <span className="suggestion-icon">💡</span>
                      <span className="suggestion-text">{suggestion}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className="copilotKitChat">
          <MessagesWithPerf
            messages={messages as any}
            inProgress={isLoading}
            RenderMessage={DefaultRenderMessage as any}
            AssistantMessage={AssistantMessage as any}
            UserMessage={DefaultUserMessage as any}
            ImageRenderer={DefaultImageRenderer as any}
          />
          <ChatComposer
            disabled={!connectedAgent}
            inProgress={isLoading}
            onSend={handleSendMessage}
            onStop={stopGeneration}
            placeholder="询问任何问题"
          />
        </div>
      </div>
    </>
  );
};

export default ChatArea;
