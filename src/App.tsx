import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { CopilotKit, useCopilotChatInternal } from "@copilotkit/react-core";
import { randomUUID } from "@copilotkit/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import "@copilotkit/react-ui/styles.css";
import "./App.css";

import { ChatComposer } from "./components/chat/ChatComposer";
import { ModelSelector } from "./components/chat/ModelSelector";
import { WelcomeScreen } from "./components/chat/WelcomeScreen";
import { Sidebar } from "./components/sidebar";
import { AgentProvider, DrawerProvider, useAuth, useDrawer } from "./contexts";
import { CHAT_SUGGESTIONS, RUNTIME_URL } from "./lib/consts";
import type { AgentType } from "./lib/consts";
import {
  addThread,
  createNewThreadId,
  deleteThread,
  getThreadClientState,
  updateThreadName,
  type ThreadMeta,
} from "./services/threadService";
import {
  removeThreadFromListCache,
  renameThreadInListCache,
  THREADS_QUERY_KEY,
  upsertThreadInListCache,
  useThreadList,
} from "./hooks/useThreadList";

const LazyChatArea = lazy(() =>
  import("./components/chat/ChatArea").then((module) => ({
    default: module.ChatArea,
  }))
);
const LazyRightPanel = lazy(() =>
  import("./components/sidebar/RightPanel").then((module) => ({
    default: module.RightPanel,
  }))
);

function App() {
  return (
    <DrawerProvider>
      <AppContent />
    </DrawerProvider>
  );
}

function AppContent() {
  const { threadId: urlThreadId } = useParams<{ threadId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const threadId = urlThreadId!;
  const { closeDrawer } = useDrawer();
  const { currentUser, logout } = useAuth();

  const agent: AgentType = "test";
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [pendingNewThreadId, setPendingNewThreadId] = useState<string | null>(null);
  const currentUserId = currentUser?.id ?? "guest";

  const {
    threads,
    hasMoreThreads,
    isLoadingThreads,
    isLoadingMoreThreads,
    loadMoreThreads,
  } = useThreadList(agent, currentUserId);

  const threadInList = useMemo(
    () => threads.find((item) => item.id === threadId) ?? null,
    [threadId, threads],
  );
  const routeState = location.state as { isNewThread?: boolean } | null;

  const clientStateQuery = useQuery({
    queryKey: ["thread-client-state", currentUserId, agent, threadId],
    queryFn: () => getThreadClientState(threadId, agent),
    enabled: Boolean(threadId),
    staleTime: 30_000,
  });
  const hasMeaningfulAgentState =
    (
      Array.isArray(clientStateQuery.data?.agentState?.steps) &&
      clientStateQuery.data.agentState.steps.length > 0
    ) ||
    Boolean(clientStateQuery.data?.agentState?.local_rag_result) ||
    Boolean(clientStateQuery.data?.agentState?.global_rag_result);
  const hasPersistedConversationData =
    hasMeaningfulAgentState ||
    Number(clientStateQuery.data?.message_count || 0) > 0;

  const isRouteMarkedNewThread =
    routeState?.isNewThread === true &&
    !hasPersistedConversationData;
  const threadExists = hasPersistedConversationData;
  const isNewThread =
    pendingNewThreadId === threadId ||
    isRouteMarkedNewThread ||
    (!threadInList && clientStateQuery.data?.thread_exists === false);

  const invalidateThreads = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY(currentUserId, agent) });
  }, [agent, currentUserId, queryClient]);

  const handleNewChat = useCallback(() => {
    const newThreadId = createNewThreadId();
    closeDrawer();
    setPendingNewThreadId(newThreadId);
    navigate(`/chat/${newThreadId}`, { replace: true, state: { isNewThread: true } });
  }, [closeDrawer, navigate]);

  const handleSwitchThread = useCallback((id: string) => {
    closeDrawer();
    setPendingNewThreadId(null);
    navigate(`/chat/${id}`, { replace: true });
  }, [closeDrawer, navigate]);

  const handleDeleteThread = useCallback(async (id: string) => {
    const thread = threads.find((item) => item.id === id);
    removeThreadFromListCache(queryClient, currentUserId, agent, id);

    const deleted = await deleteThread(id, thread?.agent || agent);
    if (!deleted) {
      invalidateThreads();
      return;
    }

    if (id === threadId) {
      handleNewChat();
    }
    invalidateThreads();
  }, [agent, currentUserId, handleNewChat, invalidateThreads, queryClient, threadId, threads]);

  const handleRenameThread = useCallback((id: string, newName: string) => {
    const nextName = newName.trim();
    if (!nextName) return;

    renameThreadInListCache(queryClient, currentUserId, agent, id, nextName);
    void (async () => {
      try {
        await updateThreadName(id, nextName);
      } finally {
        invalidateThreads();
      }
    })();
  }, [agent, currentUserId, invalidateThreads, queryClient]);

  const handleFirstMessage = useCallback(async (message: string) => {
    if (!isNewThread) return;

    const trimmed = message.trim().replace(/\n/g, " ");
    const name = trimmed.length <= 20 ? trimmed : `${trimmed.slice(0, 20)}...`;
    const threadMeta: ThreadMeta = {
      id: threadId,
      name,
      createdAt: new Date().toISOString(),
      agent,
      userId: currentUserId,
    };

    upsertThreadInListCache(queryClient, currentUserId, agent, threadMeta);
    setPendingNewThreadId(null);
    navigate(`/chat/${threadId}`, { replace: true });

    try {
      await addThread(threadMeta);
    } finally {
      invalidateThreads();
    }
  }, [agent, currentUserId, invalidateThreads, isNewThread, navigate, queryClient, threadId]);

  const handleLogout = useCallback(() => {
    closeDrawer();
    setPendingNewThreadId(null);
    queryClient.clear();
    logout();
    navigate("/", { replace: true });
  }, [closeDrawer, logout, navigate, queryClient]);

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  if (!currentUser) {
    return null;
  }

  return (
    <div className={`app-layout ${sidebarOpen ? "sidebar-expanded" : "sidebar-collapsed"}`}>
      <Sidebar
        currentThreadId={threadId}
        threads={threads}
        currentUser={currentUser}
        onNewChat={handleNewChat}
        onSwitchThread={handleSwitchThread}
        onLogout={handleLogout}
        onDeleteThread={handleDeleteThread}
        onRenameThread={handleRenameThread}
        hasMoreThreads={hasMoreThreads}
        isLoadingThreads={isLoadingThreads}
        isLoadingMoreThreads={isLoadingMoreThreads}
        onLoadMoreThreads={() => {
          void loadMoreThreads();
        }}
        isOpen={sidebarOpen}
        onToggle={handleToggleSidebar}
      />

      <main className="main-content">
        <CopilotKit
          key={`${currentUserId}-${agent}-${threadId}`}
          runtimeUrl={RUNTIME_URL}
          agent={agent}
          threadId={threadId}
        >
          <AgentProvider agentName={agent}>
            {isNewThread ? (
              <NewThreadStage agent={agent} onSend={handleFirstMessage} />
            ) : (
              <Suspense fallback={<ChatAreaFallback />}>
                <LazyChatArea
                  agent={agent}
                  threadId={threadId}
                  userId={currentUserId}
                  shouldLoadHistory={threadExists && !isNewThread}
                  key={`${currentUserId}:${threadId}:${threadExists ? "known" : "unknown"}`}
                />
              </Suspense>
            )}
          </AgentProvider>
        </CopilotKit>
      </main>

      <RightPanelContent />
    </div>
  );
}

function RightPanelContent() {
  const { isOpen, content, closeDrawer } = useDrawer();
  if (!isOpen && !content) {
    return null;
  }
  return (
    <Suspense fallback={null}>
      <LazyRightPanel isOpen={isOpen} content={content} onClose={closeDrawer} />
    </Suspense>
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
    agent: connectedAgent,
  } = useCopilotChatInternal();

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
              disabled={!connectedAgent || Boolean(pendingFirstMessage)}
              inProgress={isLoading}
              value={draft}
              onValueChange={setDraft}
              onSend={handleSend}
              onStop={stopGeneration}
              placeholder="询问任何问题"
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

export default App;
