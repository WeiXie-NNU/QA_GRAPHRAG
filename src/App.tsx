import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CopilotKit } from "@copilotkit/react-core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import "@copilotkit/react-ui/styles.css";
import "./App.css";

import { Sidebar } from "./components/sidebar";
import { AgentProvider, DrawerProvider, useAuth, useDrawer } from "./contexts";
import { RUNTIME_URL } from "./lib/consts";
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const threadId = urlThreadId!;
  const { closeDrawer } = useDrawer();
  const { currentUser, users, switchUser, logout } = useAuth();

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

  const clientStateQuery = useQuery({
    queryKey: ["thread-client-state", currentUserId, agent, threadId],
    queryFn: () => getThreadClientState(threadId, agent),
    enabled: Boolean(threadId) && !threadInList,
    staleTime: 30_000,
  });

  const isNewThread =
    pendingNewThreadId === threadId ||
    (!threadInList && clientStateQuery.data?.thread_exists === false);

  const invalidateThreads = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY(currentUserId, agent) });
  }, [agent, currentUserId, queryClient]);

  const handleNewChat = useCallback(() => {
    const newThreadId = createNewThreadId();
    closeDrawer();
    setPendingNewThreadId(newThreadId);
    navigate(`/chat/${newThreadId}`, { replace: true });
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

  const handleFirstMessage = useCallback((message: string) => {
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

    void (async () => {
      try {
        await addThread(threadMeta);
      } finally {
        invalidateThreads();
      }
    })();
  }, [agent, currentUserId, invalidateThreads, isNewThread, queryClient, threadId]);

  const handleSwitchAccount = useCallback((userId: string) => {
    if (userId === currentUserId) {
      return;
    }

    closeDrawer();
    setPendingNewThreadId(null);
    switchUser(userId);
    navigate("/", { replace: true });
  }, [closeDrawer, currentUserId, navigate, switchUser]);

  const handleLogout = useCallback(() => {
    closeDrawer();
    setPendingNewThreadId(null);
    logout();
    navigate("/login", { replace: true });
  }, [closeDrawer, logout, navigate]);

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
        users={users}
        onNewChat={handleNewChat}
        onSwitchThread={handleSwitchThread}
        onSwitchUser={handleSwitchAccount}
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
            <Suspense fallback={<ChatAreaFallback />}>
              <LazyChatArea
                agent={agent}
                threadId={threadId}
                userId={currentUserId}
                onFirstMessage={handleFirstMessage}
                isNewThread={isNewThread}
              />
            </Suspense>
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
