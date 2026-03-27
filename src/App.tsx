import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import "./App.css";

import { Sidebar } from "./components/sidebar";
import { useAuth } from "./contexts/AuthContext";
import { DrawerProvider, useDrawer } from "./contexts/DrawerContext";
import type { AgentType } from "./lib/consts";
import {
  addThread,
  createNewThreadId,
  deleteThread,
  getThreadBootstrapState,
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

const loadChatRuntimePane = () => import("./components/chat/ChatRuntimePane");
const LazyChatRuntimePane = lazy(() =>
  loadChatRuntimePane().then((module) => ({
    default: module.default,
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
  const shouldBootstrapThread =
    Boolean(threadId) &&
    !pendingNewThreadId &&
    routeState?.isNewThread !== true;

  const threadBootstrapQuery = useQuery({
    queryKey: ["thread-bootstrap", currentUserId, agent, threadId],
    queryFn: () => getThreadBootstrapState(threadId, { agent, limit: 40 }),
    enabled: shouldBootstrapThread,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const hasMeaningfulAgentState =
    (
      Array.isArray(threadBootstrapQuery.data?.agentState?.steps) &&
      threadBootstrapQuery.data.agentState.steps.length > 0
    ) ||
    Boolean(threadBootstrapQuery.data?.agentState?.local_rag_result) ||
    Boolean(threadBootstrapQuery.data?.agentState?.global_rag_result);
  const hasPersistedConversationData =
    hasMeaningfulAgentState ||
    Number(threadBootstrapQuery.data?.message_count || 0) > 0;

  const isRouteMarkedNewThread =
    routeState?.isNewThread === true &&
    !hasPersistedConversationData;
  const threadExists = Boolean(threadBootstrapQuery.data?.thread_exists);
  const isNewThread =
    pendingNewThreadId === threadId ||
    isRouteMarkedNewThread ||
    (
      threadBootstrapQuery.isFetched &&
      threadBootstrapQuery.data?.thread_exists === false &&
      !threadInList
    );

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

  useEffect(() => {
    const preloadRuntime = () => {
      void loadChatRuntimePane();
    };

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    if (typeof idleWindow.requestIdleCallback === "function") {
      const handle = idleWindow.requestIdleCallback(preloadRuntime, { timeout: 1200 });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }

    const timer = window.setTimeout(preloadRuntime, 180);
    return () => window.clearTimeout(timer);
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
        <Suspense fallback={<ChatRuntimeFallback />}>
          <LazyChatRuntimePane
            agent={agent}
            threadId={threadId}
            userId={currentUserId}
            isNewThread={isNewThread}
            threadExists={threadExists}
            persistedMessageCount={Number(threadBootstrapQuery.data?.message_count || 0)}
            bootstrapMessages={threadBootstrapQuery.data?.messages ?? []}
            onFirstMessage={handleFirstMessage}
          />
        </Suspense>
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

function ChatRuntimeFallback() {
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
