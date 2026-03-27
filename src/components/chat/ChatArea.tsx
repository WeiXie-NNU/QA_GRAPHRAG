import React, { useEffect, useCallback, useMemo, useRef, useState } from "react";
import {
  useCopilotAdditionalInstructions,
  useCopilotChatInternal,
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
import { ModelSelector } from "./ModelSelector";
import { useAgent } from "../../contexts/AgentContext";
import { CHAT_INSTRUCTIONS } from "../../lib/consts";
import type { AgentType } from "../../lib/consts";
import { saveThreadAgentState } from "../../services/threadService";
import type { AgentStateSnapshot, ThreadPageMessage } from "../../services/threadService";

const PERF_OBSERVE_KEY = "__graphrag_perf_observe_v1__";

interface ChatAreaProps {
  agent: AgentType;
  threadId: string;
  userId: string;
  persistedMessageCount: number;
  bootstrapMessages: ThreadPageMessage[];
  shouldLoadHistory: boolean;
}

function hasMessageContent(content: unknown): boolean {
  if (typeof content === "string") {
    return content.trim().length > 0;
  }

  if (!Array.isArray(content)) {
    return false;
  }

  return content.some((part) => {
    if (typeof part === "string") {
      return part.trim().length > 0;
    }

    if (!part || typeof part !== "object") {
      return false;
    }

    if ((part as any).type === "text") {
      return String((part as any).text ?? "").trim().length > 0;
    }

    return true;
  });
}

function getHistoryAnchorMessageId(messages: any[]): string | null {
  for (const message of messages) {
    if (!message || (message.role !== "user" && message.role !== "assistant")) {
      continue;
    }

    if (message.name === "coagent-state-render") {
      continue;
    }

    const messageId = String(message.id || "").trim();
    if (!messageId) {
      continue;
    }

    if (!hasMessageContent(message.content) && !message.image) {
      continue;
    }

    return messageId;
  }

  return null;
}

function countVisibleRestoredMessages(messages: any[]): number {
  const seenIds = new Set<string>();
  let count = 0;

  for (const message of messages) {
    if (!message || (message.role !== "user" && message.role !== "assistant")) {
      continue;
    }

    if (message.name === "coagent-state-render") {
      continue;
    }

    if (!hasMessageContent(message.content) && !message.image) {
      continue;
    }

    const messageId = String(message.id || "").trim();
    if (messageId) {
      if (seenIds.has(messageId)) {
        continue;
      }
      seenIds.add(messageId);
    }

    count += 1;
  }

  return count;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  agent,
  threadId,
  userId,
  persistedMessageCount,
  bootstrapMessages,
  shouldLoadHistory,
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
  });
  const hasPendingInterrupt = Boolean(interrupt);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>("");
  const normalizedBootstrapMessages = useMemo(
    () => bootstrapMessages as any[],
    [bootstrapMessages],
  );
  const restoredMessageSource = useMemo(
    () => [...normalizedBootstrapMessages, ...(messages as any[])],
    [messages, normalizedBootstrapMessages],
  );
  const restoredVisibleMessageCount = useMemo(
    () => countVisibleRestoredMessages(restoredMessageSource),
    [restoredMessageSource],
  );
  const historyAnchorMessageId = useMemo(
    () => getHistoryAnchorMessageId(restoredMessageSource),
    [restoredMessageSource],
  );
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
    enabled: shouldLoadHistory,
    anchorBeforeMessageId: historyAnchorMessageId,
    persistedMessageCount,
    visibleMessageCount: restoredVisibleMessageCount,
  });
  const isPerfObserveAvailable = import.meta.env.DEV;
  const [perfObserve, setPerfObserve] = useState<boolean>(() => {
    if (!isPerfObserveAvailable) {
      return false;
    }
    try {
      return localStorage.getItem(PERF_OBSERVE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const togglePerfObserve = useCallback(() => {
    if (!isPerfObserveAvailable) {
      return;
    }
    setPerfObserve((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PERF_OBSERVE_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  }, [isPerfObserveAvailable]);

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
          {isPerfObserveAvailable ? (
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
          ) : null}
        </div>
      </header>

      <div className="chat-container">
        <div className="copilotKitChat">
          <VirtualizedMessages
            messages={messages as any}
            inProgress={isLoading}
            RenderMessage={DefaultRenderMessage as any}
            AssistantMessage={AssistantMessage as any}
            UserMessage={DefaultUserMessage as any}
            ImageRenderer={DefaultImageRenderer as any}
            perfEnabled={perfObserve}
            historyMessages={historyMessages as any}
            hasOlderHistory={hasOlderHistory}
            isLoadingOlderHistory={isLoadingOlderHistory || isHistoryLoading}
            initialMessages={normalizedBootstrapMessages as any}
            onLoadOlderHistory={loadOlderHistory}
            threadKey={threadId}
          />
          <ChatComposer
            disabled={!connectedAgent || hasPendingInterrupt}
            inProgress={isLoading}
            onSend={handleSendMessage}
            onStop={stopGeneration}
            placeholder={hasPendingInterrupt ? "请先完成当前人工审核" : "询问任何问题"}
          />
        </div>
      </div>
    </>
  );
};

export default ChatArea;
