import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { CopilotKit, useCopilotChatInternal } from "@copilotkit/react-core";
import { randomUUID } from "@copilotkit/shared";
import "@copilotkit/react-ui/styles.css";

import { ChatComposer } from "./ChatComposer";
import { HITLInterruptLayer } from "./HITLInterruptLayer";
import { ModelSelector } from "./ModelSelector";
import { WelcomeScreen } from "./WelcomeScreen";
import { AgentProvider } from "../../contexts/AgentContext";
import { CHAT_SUGGESTIONS, RUNTIME_URL } from "../../lib/consts";
import type { AgentType } from "../../lib/consts";

const LazyChatArea = lazy(() => import("./ChatArea").then((module) => ({ default: module.ChatArea })));

interface ChatRuntimePaneProps {
  agent: AgentType;
  threadId: string;
  userId: string;
  isNewThread: boolean;
  threadExists: boolean;
  persistedMessageCount: number;
  onFirstMessage: (message: string) => Promise<void>;
}

function ChatAreaFallback() {
  return (
    <div className="chat-loading-shell" aria-hidden="true">
      <div className="chat-loading-header" />
      <div className="chat-loading-messages">
        <div className="chat-loading-row chat-loading-row-user" />
        <div className="chat-loading-row chat-loading-row-assistant" />
        <div className="chat-loading-row chat-loading-row-assistant short" />
      </div>
      <div className="chat-loading-input" />
    </div>
  );
}

function NewThreadStage({
  agent,
  onSend,
}: {
  agent: AgentType;
  onSend: (message: string) => Promise<void>;
}) {
  const suggestions = CHAT_SUGGESTIONS[agent] || [];
  const [draft, setDraft] = useState("");
  const [pendingFirstMessage, setPendingFirstMessage] = useState<{ id: string; text: string } | null>(null);
  const submittedFirstMessageIdRef = useRef<string | null>(null);
  const {
    messages,
    sendMessage,
    isLoading,
    stopGeneration,
    interrupt,
    agent: connectedAgent,
  } = useCopilotChatInternal();
  const hasPendingInterrupt = Boolean(interrupt);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const textarea = document.querySelector(".copilotKitInput textarea") as HTMLTextAreaElement | null;
      textarea?.focus();
    }, 100);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!pendingFirstMessage) {
      return;
    }

    const userMessageAppeared = (messages as any[] | undefined)?.some(
      (message) =>
        message?.role === "user" &&
        String(message?.id ?? "") === pendingFirstMessage.id
    );

    if (!userMessageAppeared) {
      return;
    }

    if (submittedFirstMessageIdRef.current === pendingFirstMessage.id) {
      return;
    }
    submittedFirstMessageIdRef.current = pendingFirstMessage.id;

    void onSend(pendingFirstMessage.text).catch((error) => {
      console.error("创建首条消息线程失败:", error);
    });
    setPendingFirstMessage(null);
  }, [messages, onSend, pendingFirstMessage]);

  const handleSend = useCallback(async (message: string) => {
    const trimmed = message.trim();
    if (!trimmed || !connectedAgent || pendingFirstMessage) {
      return;
    }

    const firstMessageId = randomUUID();
    submittedFirstMessageIdRef.current = null;
    setPendingFirstMessage({ id: firstMessageId, text: trimmed });

    void sendMessage({
      id: firstMessageId,
      role: "user",
      content: trimmed,
    }).catch((error) => {
      setPendingFirstMessage((current) =>
        current?.id === firstMessageId ? null : current
      );
      setDraft(trimmed);
      console.error("发送首条消息失败:", error);
    });
  }, [connectedAgent, pendingFirstMessage, sendMessage]);

  return (
    <>
      <header className="chat-header">
        <div className="chat-header-left">
          <ModelSelector />
        </div>
      </header>

      <div className="chat-container with-welcome">
        <div className="new-thread-stage-layout">
          <WelcomeScreen visible={true} variant="inline" />
          <div className="new-thread-stage-composer">
            <ChatComposer
              disabled={!connectedAgent || Boolean(pendingFirstMessage) || hasPendingInterrupt}
              inProgress={isLoading}
              value={draft}
              onValueChange={setDraft}
              onSend={handleSend}
              onStop={stopGeneration}
              placeholder={hasPendingInterrupt ? "请先完成当前人工审核" : "询问任何问题"}
            />
          </div>
          {suggestions.length > 0 && (
            <div className="new-thread-stage-suggestions">
              <div className="suggestions-grid">
                {suggestions.map((suggestion, index) => (
                  <button key={index} className="suggestion-item" onClick={() => setDraft(suggestion)}>
                    <span className="suggestion-icon">💡</span>
                    <span className="suggestion-text">{suggestion}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function ChatRuntimePane({
  agent,
  threadId,
  userId,
  isNewThread,
  threadExists,
  persistedMessageCount,
  onFirstMessage,
}: ChatRuntimePaneProps) {
  return (
    <CopilotKit
      key={`${userId}-${agent}-${threadId}`}
      runtimeUrl={RUNTIME_URL}
      agent={agent}
      threadId={threadId}
    >
      <AgentProvider agentName={agent}>
        <HITLInterruptLayer />
        {isNewThread ? (
          <NewThreadStage agent={agent} onSend={onFirstMessage} />
        ) : (
          <Suspense fallback={<ChatAreaFallback />}>
            <LazyChatArea
              agent={agent}
              threadId={threadId}
              userId={userId}
              persistedMessageCount={persistedMessageCount}
              shouldLoadHistory={threadExists && !isNewThread}
              key={`${userId}:${threadId}:${threadExists ? "known" : "unknown"}`}
            />
          </Suspense>
        )}
      </AgentProvider>
    </CopilotKit>
  );
}
