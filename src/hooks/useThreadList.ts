import { type InfiniteData, type QueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import type { AgentType } from "../lib/consts";
import {
  getThreads,
  getThreadsPageFromServer,
  saveThreadsCacheSnapshot,
  type ThreadMeta,
  type ThreadsPage,
} from "../services/threadService";

const THREADS_PAGE_SIZE = 30;

export const THREADS_QUERY_KEY = (userId: string, agent: AgentType) =>
  ["threads", userId, agent] as const;

function updateInfiniteThreadPages(
  data: InfiniteData<ThreadsPage, number> | undefined,
  updater: (threads: ThreadMeta[]) => ThreadMeta[],
): InfiniteData<ThreadsPage, number> | undefined {
  if (!data?.pages?.length) return data;

  const merged = updater(mergeThreads(data.pages));
  const firstPage = data.pages[0];

  return {
    pageParams: data.pageParams,
    pages: [
      {
        ...firstPage,
        threads: merged,
        count: merged.length,
        hasMore: firstPage.hasMore,
      },
    ],
  };
}

function mergeThreads(pages: ThreadsPage[]): ThreadMeta[] {
  const merged: ThreadMeta[] = [];
  const seen = new Set<string>();

  for (const page of pages) {
    for (const thread of page.threads) {
      if (seen.has(thread.id)) continue;
      seen.add(thread.id);
      merged.push(thread);
    }
  }

  return merged;
}

export function useThreadList(agent: AgentType, userId: string) {
  const cachedThreads = useMemo(() => getThreads(userId), [userId]);

  const query = useInfiniteQuery({
    queryKey: THREADS_QUERY_KEY(userId, agent),
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const page = await getThreadsPageFromServer(agent, {
        offset: Number(pageParam || 0),
        limit: THREADS_PAGE_SIZE,
      });

      if (!page) {
        throw new Error("Failed to load thread list");
      }

      return page;
    },
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined;
      return allPages.reduce((acc, page) => acc + page.threads.length, 0);
    },
    placeholderData:
      cachedThreads.length > 0
        ? {
            pages: [
              {
                threads: cachedThreads,
                count: cachedThreads.length,
                offset: 0,
                limit: cachedThreads.length,
                hasMore: false,
              },
            ],
            pageParams: [0],
          }
        : undefined,
  });

  const threads = useMemo(() => mergeThreads(query.data?.pages ?? []), [query.data?.pages]);

  useEffect(() => {
    if (threads.length > 0) {
      saveThreadsCacheSnapshot(threads, userId);
    }
  }, [threads, userId]);

  return {
    ...query,
    cachedThreads,
    threads,
    hasMoreThreads: Boolean(query.hasNextPage),
    isLoadingThreads: query.isPending && threads.length === 0,
    isLoadingMoreThreads: query.isFetchingNextPage,
    loadMoreThreads: query.fetchNextPage,
  };
}

export function upsertThreadInListCache(
  queryClient: QueryClient,
  userId: string,
  agent: AgentType,
  thread: ThreadMeta,
): void {
  queryClient.setQueryData<InfiniteData<ThreadsPage, number> | undefined>(
    THREADS_QUERY_KEY(userId, agent),
    (current) =>
      updateInfiniteThreadPages(current, (threads) => [
        thread,
        ...threads.filter((item) => item.id !== thread.id),
      ]),
  );
}

export function removeThreadFromListCache(
  queryClient: QueryClient,
  userId: string,
  agent: AgentType,
  threadId: string,
): void {
  queryClient.setQueryData<InfiniteData<ThreadsPage, number> | undefined>(
    THREADS_QUERY_KEY(userId, agent),
    (current) =>
      updateInfiniteThreadPages(current, (threads) =>
        threads.filter((thread) => thread.id !== threadId),
      ),
  );
}

export function renameThreadInListCache(
  queryClient: QueryClient,
  userId: string,
  agent: AgentType,
  threadId: string,
  name: string,
): void {
  queryClient.setQueryData<InfiniteData<ThreadsPage, number> | undefined>(
    THREADS_QUERY_KEY(userId, agent),
    (current) =>
      updateInfiniteThreadPages(current, (threads) =>
        threads.map((thread) =>
          thread.id === threadId ? { ...thread, name } : thread,
        ),
      ),
  );
}
