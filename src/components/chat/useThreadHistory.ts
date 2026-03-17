import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import type { AgentType } from "../../lib/consts";
import {
  getThreadMessagesPage,
  type ThreadMessagesPage,
  type ThreadPageMessage,
} from "../../services/threadService";

const INITIAL_HISTORY_PAGE_SIZE = 20;
const OLDER_HISTORY_PAGE_SIZE = 24;
const HISTORY_CACHE_PREFIX = "graphrag_thread_history_v1:";
const HISTORY_CACHE_MAX_MESSAGES = 120;
const memoryHistoryCache = new Map<string, ThreadHistoryCacheSnapshot>();

interface ThreadHistoryCacheSnapshot {
  messages: ThreadPageMessage[];
  hasOlderHistory: boolean;
  nextBeforeId: number | null;
}

interface UseThreadHistoryOptions {
  threadId: string;
  agent: AgentType;
  userId: string;
  enabled: boolean;
}

function mergeMessages(pages: ThreadMessagesPage[]): ThreadPageMessage[] {
  const seen = new Set<string>();
  const merged: ThreadPageMessage[] = [];

  for (let i = pages.length - 1; i >= 0; i -= 1) {
    const page = pages[i];
    for (const message of page.messages ?? []) {
      const messageId = String(message.id || "");
      if (!messageId || seen.has(messageId)) continue;
      seen.add(messageId);
      merged.push(message);
    }
  }

  return merged;
}

function getHistoryCacheKey(userId: string, threadId: string): string {
  return `${HISTORY_CACHE_PREFIX}${userId}:${threadId}`;
}

function readHistoryCache(userId: string, threadId: string): ThreadHistoryCacheSnapshot | null {
  const cacheKey = getHistoryCacheKey(userId, threadId);
  const memoryCached = memoryHistoryCache.get(cacheKey);
  if (memoryCached) {
    return memoryCached;
  }

  try {
    const raw = sessionStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ThreadHistoryCacheSnapshot;
    if (!Array.isArray(parsed?.messages)) return null;

    const snapshot = {
      messages: parsed.messages,
      hasOlderHistory: Boolean(parsed.hasOlderHistory),
      nextBeforeId: parsed.nextBeforeId ?? null,
    };
    memoryHistoryCache.set(cacheKey, snapshot);
    return snapshot;
  } catch {
    return null;
  }
}

function writeHistoryCache(
  userId: string,
  threadId: string,
  messages: ThreadPageMessage[],
  hasOlderHistory: boolean,
  nextBeforeId: number | null,
): void {
  try {
    const capped = messages.slice(-HISTORY_CACHE_MAX_MESSAGES);
    const effectiveNextBeforeId =
      capped.length > 0 ? capped[0].rowId ?? nextBeforeId ?? null : nextBeforeId ?? null;

    const payload: ThreadHistoryCacheSnapshot = {
      messages: capped,
      hasOlderHistory: hasOlderHistory || capped.length < messages.length,
      nextBeforeId: effectiveNextBeforeId,
    };

    const cacheKey = getHistoryCacheKey(userId, threadId);
    memoryHistoryCache.set(cacheKey, payload);
    sessionStorage.setItem(cacheKey, JSON.stringify(payload));
  } catch {}
}

function makePlaceholderPage(
  threadId: string,
  cached: ThreadHistoryCacheSnapshot,
): ThreadMessagesPage {
  return {
    thread_id: threadId,
    messages: cached.messages,
    has_more: cached.hasOlderHistory,
    next_before_id: cached.nextBeforeId,
    count: cached.messages.length,
  };
}

export function useThreadHistory({
  threadId,
  agent,
  userId,
  enabled,
}: UseThreadHistoryOptions) {
  const cached = useMemo(
    () => (enabled && threadId && userId ? readHistoryCache(userId, threadId) : null),
    [enabled, threadId, userId],
  );

  const query = useInfiniteQuery({
    queryKey: ["thread-history", userId, agent, threadId],
    enabled: enabled && !!threadId,
    initialPageParam: {
      beforeId: null as number | null,
      limit: INITIAL_HISTORY_PAGE_SIZE,
    },
    queryFn: async ({ pageParam }) => {
      const page = await getThreadMessagesPage(threadId, {
        agent,
        beforeId: pageParam.beforeId,
        limit: pageParam.limit,
      });

      if (!page) {
        throw new Error("Failed to load thread history");
      }

      return page;
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more || lastPage.next_before_id == null) {
        return undefined;
      }

      return {
        beforeId: lastPage.next_before_id,
        limit: OLDER_HISTORY_PAGE_SIZE,
      };
    },
    staleTime: 15_000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    placeholderData:
      cached != null
        ? {
            pages: [makePlaceholderPage(threadId, cached)],
            pageParams: [{ beforeId: null, limit: INITIAL_HISTORY_PAGE_SIZE }],
          }
        : undefined,
  });

  const historyMessages = useMemo(
    () => mergeMessages(query.data?.pages ?? []),
    [query.data?.pages],
  );

  const hasOlderHistory = Boolean(query.hasNextPage);

  useEffect(() => {
    if (!threadId || historyMessages.length === 0) return;
    const latestPage = query.data?.pages?.[query.data.pages.length - 1];
    writeHistoryCache(
      userId,
      threadId,
      historyMessages,
      hasOlderHistory,
      latestPage?.next_before_id ?? null,
    );
  }, [hasOlderHistory, historyMessages, query.data?.pages, threadId, userId]);

  return {
    historyMessages,
    hasOlderHistory,
    isHistoryLoading: query.isPending && historyMessages.length === 0,
    isLoadingOlderHistory: query.isFetchingNextPage,
    loadOlderHistory: () => {
      if (!query.hasNextPage || query.isFetchingNextPage) {
        return Promise.resolve();
      }
      return query.fetchNextPage().then(() => undefined);
    },
  };
}
