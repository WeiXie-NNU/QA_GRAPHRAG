import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { AgentType } from "../../lib/consts";
import {
  getThreadClientState,
  getThreadMessagesPage,
  type ThreadMessagesPage,
  type ThreadPageMessage,
} from "../../services/threadService";

const INITIAL_HISTORY_PAGE_SIZE = 20;
const OLDER_HISTORY_PAGE_SIZE = 24;

interface UseThreadHistoryOptions {
  threadId: string;
  agent: AgentType;
  userId: string;
  enabled: boolean;
  anchorBeforeMessageId?: string | null;
  visibleMessageCount?: number;
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

export function useThreadHistory({
  threadId,
  agent,
  userId,
  enabled,
  anchorBeforeMessageId = null,
  visibleMessageCount = 0,
}: UseThreadHistoryOptions) {
  const isQueryEnabled = Boolean(enabled && threadId);
  const clientStateQuery = useQuery({
    queryKey: ["thread-client-state", userId, agent, threadId],
    enabled: isQueryEnabled,
    queryFn: async () => getThreadClientState(threadId, agent),
    staleTime: 15_000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });

  const query = useInfiniteQuery({
    queryKey: ["thread-history", userId, agent, threadId, anchorBeforeMessageId || "latest"],
    enabled: false,
    initialPageParam: {
      beforeId: null as number | null,
      beforeMessageId: anchorBeforeMessageId,
      limit: INITIAL_HISTORY_PAGE_SIZE,
    },
    queryFn: async ({ pageParam }) => {
      const page = await getThreadMessagesPage(threadId, {
        agent,
        beforeId: pageParam.beforeId,
        beforeMessageId: pageParam.beforeMessageId,
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
        beforeMessageId: null,
        limit: OLDER_HISTORY_PAGE_SIZE,
      };
    },
    staleTime: 15_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const historyMessages = useMemo(
    () => mergeMessages(query.data?.pages ?? []),
    [query.data?.pages],
  );

  const persistedMessageCount = Number(clientStateQuery.data?.message_count || 0);
  const hasFetchedAnyHistoryPage = (query.data?.pages.length ?? 0) > 0;
  const hasOlderHistory = isQueryEnabled && (
    hasFetchedAnyHistoryPage
      ? Boolean(query.hasNextPage)
      : Boolean(anchorBeforeMessageId) && persistedMessageCount > visibleMessageCount
  );

  return {
    historyMessages,
    hasOlderHistory,
    isHistoryLoading: isQueryEnabled && clientStateQuery.isPending && !anchorBeforeMessageId,
    isLoadingOlderHistory: isQueryEnabled && query.isFetchingNextPage,
    loadOlderHistory: () => {
      if (!isQueryEnabled || !anchorBeforeMessageId || query.isFetchingNextPage) {
        return Promise.resolve();
      }
      if (hasFetchedAnyHistoryPage && !query.hasNextPage) {
        return Promise.resolve();
      }
      return query.fetchNextPage().then(() => undefined);
    },
  };
}
