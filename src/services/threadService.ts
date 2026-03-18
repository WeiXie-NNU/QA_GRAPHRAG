/**
 * 线程管理服务
 * 
 * 核心概念：
 * - threadId 由前端生成（UUID v4）
 * - 后端 LangGraph checkpointer 会自动根据 threadId 存储状态
 * - 线程元数据统一存储在后端数据库（跨 origin 共享）
 * - GraphRAG 结果存储在后端数据库，通过 API 按需获取
 */

import { AGENT_API_URL } from "../lib/consts";
import type { AgentType } from "../lib/consts";
import type { GraphRAGResult, GraphRAGResultSummary, GeoPoint } from "../lib/types";
import { getCurrentUserId } from "./authService";

// 旧数据库/旧前端兼容代码（localStorage 迁移）已按需停用，先保留注释便于回滚：
// const LEGACY_STORAGE_KEY = "graphrag_threads";
// const STORAGE_KEY_V2 = "graphrag_threads_v2";
// let cacheCleanupDone = false;
// let threadMetaMigrationDone = false;
// function clearLegacyThreadCacheOnce(): void { ... }
// async function migrateLocalThreadMetaToServer(agent: AgentType = "test"): Promise<void> { ... }
const THREADS_CACHE_KEY_PREFIX = "graphrag_threads_server_cache_v2";
const REQUEST_TIMEOUT_MS = 8000;

function getThreadsCacheKey(userId?: string | null): string {
  return `${THREADS_CACHE_KEY_PREFIX}:${userId || "guest"}`;
}

function withUserHeaders(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  const userId = getCurrentUserId();
  if (userId) {
    headers.set("X-User-Id", userId);
  }

  return {
    ...init,
    headers,
  };
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...withUserHeaders(init), signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

// 线程元数据（存储在后端）
export interface ThreadMeta {
  id: string;
  name: string;
  createdAt: string;
  agent: AgentType;
  updatedAt?: string;
  userId?: string;
}

// 历史消息
export interface HistoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface ThreadPageMessage extends HistoryMessage {
  createdAt?: string;
  rowId?: number;
}

// Agent 状态（进度条数据）- 简化版，不包含完整 GraphRAG 结果
// 注意：geo_points 已移至数据库，通过 API 按需获取，不再保存到 localStorage
export interface AgentStateSnapshot {
  steps?: any[];
  // geo_points 移除 - 通过 /api/geo/{id} 按需获取
  local_rag_result?: GraphRAGResultSummary;  // 只包含摘要
  global_rag_result?: GraphRAGResultSummary; // 只包含摘要
  timestamp?: number;
}

// 后端返回的线程状态
export interface ThreadState {
  thread_id: string;
  thread_exists: boolean;
  messages: HistoryMessage[];
  agentState?: AgentStateSnapshot; // 新增：Agent 状态快照
}

export interface ThreadMessagesPage {
  thread_id: string;
  messages: ThreadPageMessage[];
  has_more: boolean;
  next_before_id?: number | null;
  count: number;
}

// GraphRAG 结果 API 响应
export interface GraphRAGLatestResponse {
  thread_id: string;
  local: GraphRAGResult | null;
  global: GraphRAGResult | null;
}

/**
 * 生成新的线程 ID（UUID v4）
 * 兼容非 HTTPS 环境（局域网访问）
 */
export function createNewThreadId(): string {
  // 优先使用标准 crypto.randomUUID()
  if (crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  
  // Fallback: 使用 crypto.getRandomValues() 或 Math.random()
  // UUID v4 格式: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (crypto.getRandomValues ? crypto.getRandomValues(new Uint8Array(1))[0] : Math.random() * 256) | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * 从 localStorage 获取所有线程
 */
export function getThreads(userId?: string | null): ThreadMeta[] {
  // 非权威快照，仅用于服务端暂不可达时的 UI 回显。
  try {
    const resolvedUserId = userId ?? getCurrentUserId();
    const raw = localStorage.getItem(getThreadsCacheKey(resolvedUserId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ThreadMeta[];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item) => !item?.userId || item.userId === resolvedUserId)
      .map((item) => ({
        ...item,
        userId: item?.userId ?? resolvedUserId ?? undefined,
      }));
  } catch {
    return [];
  }
}

interface ThreadsApiResponse {
  threads?: ThreadMeta[] | string[];
  thread_ids?: string[];
  count?: number;
  offset?: number;
  limit?: number;
  has_more?: boolean;
}

export interface ThreadsPage {
  threads: ThreadMeta[];
  count: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface ThreadClientState {
  thread_id: string;
  thread_exists: boolean;
  agentState?: AgentStateSnapshot | null;
  message_count: number;
}

export function saveThreadsCacheSnapshot(threads: ThreadMeta[], userId?: string | null): void {
  try {
    const resolvedUserId = userId ?? getCurrentUserId();
    const snapshot = threads.map((thread) => ({
      ...thread,
      userId: thread.userId ?? resolvedUserId ?? undefined,
    }));
    localStorage.setItem(getThreadsCacheKey(resolvedUserId), JSON.stringify(snapshot));
  } catch {}
}

function normalizeThreadRows(rows: ThreadMeta[], agent: AgentType): ThreadMeta[] {
  return rows.map((item) => ({
    id: String(item.id),
    name: String(item.name || `历史对话 ${String(item.id).slice(0, 8)}`),
    createdAt: String(item.createdAt || new Date().toISOString()),
    agent: (item.agent || agent) as AgentType,
    updatedAt: item.updatedAt,
    userId: item.userId,
  }));
}

export async function getThreadsPageFromServer(
  agent: AgentType = "test",
  options: {
    offset?: number;
    limit?: number;
  } = {},
): Promise<ThreadsPage | null> {
  const doFetch = async (withAgent: boolean): Promise<ThreadsPage> => {
    const params = new URLSearchParams();
    params.set("offset", String(options.offset ?? 0));
    params.set("limit", String(options.limit ?? 30));
    if (withAgent) {
      params.set("agent", agent);
    }

    const response = await fetchWithTimeout(`${AGENT_API_URL}/threads?${params.toString()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as ThreadsApiResponse;

    if (Array.isArray(data.threads) && data.threads.length > 0 && typeof data.threads[0] === "object") {
      const rows = normalizeThreadRows(data.threads as ThreadMeta[], agent);
      return {
        threads: rows,
        count: Number(data.count || rows.length),
        offset: Number(data.offset || options.offset || 0),
        limit: Number(data.limit || options.limit || 30),
        hasMore: Boolean(data.has_more),
      };
    }

    const ids = Array.isArray(data.thread_ids)
      ? data.thread_ids
      : (Array.isArray(data.threads) ? (data.threads as string[]) : []);
    const rows = ids.map((id) => ({
      id,
      name: `历史对话 ${id.slice(0, 8)}`,
      createdAt: new Date().toISOString(),
      agent,
    }));
    return {
      threads: rows,
      count: Number(data.count || rows.length),
      offset: Number(data.offset || options.offset || 0),
      limit: Number(data.limit || options.limit || 30),
      hasMore: Boolean(data.has_more),
    };
  };

  try {
    return await doFetch(false);
  } catch (e) {
    if (!isAbortError(e)) {
      console.warn("无过滤线程分页拉取失败，尝试按 agent 过滤重试:", e);
    }
  }

  for (let i = 0; i < 2; i++) {
    try {
      return await doFetch(true);
    } catch (e) {
      if (!isAbortError(e)) {
        console.warn(`按 agent 分页拉取线程失败(重试 ${i + 1}/2):`, e);
      }
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }

  return null;
}

/**
 * 从后端拉取线程元数据（唯一权威来源）
 */
export async function syncThreadsFromServer(
  agent: AgentType = "test",
  userId?: string | null,
): Promise<ThreadMeta[]> {
  const firstPage = await getThreadsPageFromServer(agent, { offset: 0, limit: 200 });
  if (firstPage) {
    saveThreadsCacheSnapshot(firstPage.threads, userId);
    return firstPage.threads;
  }

  const doFetch = async (withAgent: boolean): Promise<ThreadMeta[]> => {
    const url = withAgent
      ? `${AGENT_API_URL}/threads?agent=${encodeURIComponent(agent)}`
      : `${AGENT_API_URL}/threads`;
    const response = await fetchWithTimeout(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as ThreadsApiResponse;

    if (Array.isArray(data.threads) && data.threads.length > 0 && typeof data.threads[0] === "object") {
      const rows = normalizeThreadRows(data.threads as ThreadMeta[], agent);
      saveThreadsCacheSnapshot(rows, userId);
      return rows;
    }

    const ids = Array.isArray(data.thread_ids)
      ? data.thread_ids
      : (Array.isArray(data.threads) ? (data.threads as string[]) : []);
    const rows = ids.map((id) => ({
      id,
      name: `历史对话 ${id.slice(0, 8)}`,
      createdAt: new Date().toISOString(),
      agent,
    }));
    saveThreadsCacheSnapshot(rows, userId);
    return rows;
  };

  // 最常见容错：重试 + 无 agent 过滤优先（避免后端 agent 字段历史不一致导致空列表）。
  try {
    return await doFetch(false);
  } catch (e) {
    if (!isAbortError(e)) {
      console.warn("无过滤线程同步失败，尝试按 agent 过滤重试:", e);
    }
  }

  for (let i = 0; i < 2; i++) {
    try {
      return await doFetch(true);
    } catch (e) {
      if (!isAbortError(e)) {
        console.warn(`按 agent 拉取线程失败(重试 ${i + 1}/2):`, e);
      }
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }

  return getThreads(userId);
}

export async function getThreadClientState(
  threadId: string,
  agent: AgentType = "test",
): Promise<ThreadClientState | null> {
  try {
    const response = await fetchWithTimeout(
      `${AGENT_API_URL}/threads/${threadId}/client-state?agent=${encodeURIComponent(agent)}`,
      { method: "GET" },
    );
    if (!response.ok) return null;
    return (await response.json()) as ThreadClientState;
  } catch (e) {
    console.warn("获取线程轻量状态失败:", e);
    return null;
  }
}

/**
 * 保存线程的 Agent 状态快照
 */
export async function saveThreadAgentState(threadId: string, agentState: AgentStateSnapshot): Promise<void> {
  try {
    await fetchWithTimeout(`${AGENT_API_URL}/threads/${threadId}/agent-state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...agentState,
        timestamp: Date.now(),
      }),
    });
  } catch (e) {
    console.warn("保存 Agent 状态到后端失败:", e);
  }
}

/**
 * 获取线程的 Agent 状态快照
 */
export async function getThreadAgentState(threadId: string): Promise<AgentStateSnapshot | null> {
  try {
    const response = await fetchWithTimeout(`${AGENT_API_URL}/threads/${threadId}/agent-state`);
    if (!response.ok) return null;
    const data = await response.json();
    return (data?.agentState || null) as AgentStateSnapshot | null;
  } catch (e) {
    console.warn("从后端加载 Agent 状态失败:", e);
    return null;
  }
}



export async function addThread(thread: ThreadMeta): Promise<void> {
  await fetchWithTimeout(`${AGENT_API_URL}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...thread,
      userId: thread.userId ?? getCurrentUserId() ?? undefined,
    }),
  });
}

/**
 * 删除线程
 */
export async function deleteThread(threadId: string, _agent: AgentType = "test"): Promise<boolean> {
  // 删除后端线程与元数据（含 agent-state）
  try {
    const response = await fetchWithTimeout(`${AGENT_API_URL}/threads/${threadId}`, {
      method: "DELETE",
    });
    return response.ok;
  } catch (e) {
    console.warn("后端删除失败:", e);
    return false;
  }
}

/**
 * 更新线程名称
 */
export async function updateThreadName(threadId: string, newName: string): Promise<void> {
  await fetchWithTimeout(`${AGENT_API_URL}/threads/${threadId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: newName }),
  });
}

/**
 * 从后端获取线程历史消息（需要后端支持）
 */
export async function getThreadHistory(threadId: string, _agent: AgentType = "test"): Promise<ThreadState | null> {
  try {
    const response = await fetchWithTimeout(`${AGENT_API_URL}/threads/${threadId}/state`, {
      method: "GET",
    });
    
    if (!response.ok) {
      return null;
    }
    
    return await response.json();
  } catch (e) {
    console.error("获取线程历史失败:", e);
    return null;
  }
}


// ============================================================
// GraphRAG 结果 API
// ============================================================

/**
 * 获取指定线程的最新 GraphRAG 结果（Local + Global）
 * 
 * @param threadId 对话线程 ID
 * @returns Local 和 Global 结果，如果没有则为 null
 */
export async function getLatestGraphRAGResults(threadId: string): Promise<GraphRAGLatestResponse | null> {
  try {
    const response = await fetch(`${AGENT_API_URL}/api/graphrag/latest/${threadId}`);
    
    if (!response.ok) {
      console.warn(`获取 GraphRAG 结果失败: ${response.status}`);
      return null;
    }
    
    return await response.json();
  } catch (e) {
    console.error("获取 GraphRAG 结果失败:", e);
    return null;
  }
}

/**
 * 根据 ID 获取单个 GraphRAG 结果
 * 
 * @param resultId 结果记录 ID
 * @returns GraphRAG 结果详情
 */
export async function getGraphRAGResultById(resultId: string): Promise<GraphRAGResult | null> {
  try {
    const response = await fetch(`${AGENT_API_URL}/api/graphrag/result/${resultId}`);
    
    if (!response.ok) {
      console.warn(`获取 GraphRAG 结果失败: ${response.status}`);
      return null;
    }
    
    return await response.json();
  } catch (e) {
    console.error("获取 GraphRAG 结果失败:", e);
    return null;
  }
}

/**
 * 获取指定线程的所有 GraphRAG 结果
 * 
 * @param threadId 对话线程 ID
 * @param searchType 可选，过滤搜索类型
 * @returns GraphRAG 结果列表
 */
export async function getGraphRAGResults(
  threadId: string, 
  searchType?: "local" | "global"
): Promise<GraphRAGResult[]> {
  try {
    let url = `${AGENT_API_URL}/api/graphrag/results/${threadId}`;
    if (searchType) {
      url += `?search_type=${searchType}`;
    }
    
    const response = await fetch(url);
    
    if (!response.ok) {
      console.warn(`获取 GraphRAG 结果失败: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    return data.results || [];
  } catch (e) {
    console.error("获取 GraphRAG 结果失败:", e);
    return [];
  }
}


// ============================================================
// 案例详情 API
// ============================================================

/**
 * 获取 PROSAIL 案例的完整详情
 * 
 * 前端地图标记的 GeoPoint 只包含精简信息，
 * 完整的 case_details 和 parameters 通过此 API 按需获取
 * 
 * @param caseId 案例 ID
 * @returns 完整的案例详情
 */
export async function getCaseFullDetails(caseId: string, kgId?: string): Promise<GeoPoint | null> {
  try {
    const params = new URLSearchParams();
    if (kgId) params.set("kg_id", kgId);
    const url = `${AGENT_API_URL}/api/case/${encodeURIComponent(caseId)}${params.toString() ? `?${params.toString()}` : ""}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      console.warn(`获取案例详情失败: ${response.status}`);
      return null;
    }
    
    return await response.json();
  } catch (e) {
    console.error("获取案例详情失败:", e);
    return null;
  }
}


// ============================================================
// 地图数据 API
// ============================================================

/**
 * 地图数据记录
 * 存储 geo_points 和 target_params
 */
export interface GeoDataRecord {
  id: string;
  thread_id: string;
  geo_points: GeoPoint[];
  target_params: string[];
  created_at: string;
}

export async function getThreadMessagesPage(
  threadId: string,
  options: {
    beforeId?: number | null;
    limit?: number;
    agent?: AgentType;
  } = {},
): Promise<ThreadMessagesPage | null> {
  try {
    const params = new URLSearchParams();
    if (options.beforeId != null) {
      params.set("before_id", String(options.beforeId));
    }
    params.set("limit", String(options.limit ?? 40));
    if (options.agent) {
      params.set("agent", options.agent);
    }

    const query = params.toString();
    const response = await fetchWithTimeout(
      `${AGENT_API_URL}/threads/${threadId}/messages${query ? `?${query}` : ""}`,
      { method: "GET" },
      15000,
    );

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (e) {
    console.error("分页获取线程历史失败:", e);
    return null;
  }
}

/**
 * 获取案例 PDF 下载地址（后端按 case_id + kg_id 自动定位到 repositories/<MODEL>/paper_pdf）
 */
export function getCasePdfDownloadUrl(caseId: string, kgId?: string, filenameHint?: string): string {
  const params = new URLSearchParams();
  if (kgId) params.set("kg_id", kgId);
  if (filenameHint) params.set("filename", filenameHint);
  const query = params.toString();
  return `${AGENT_API_URL}/api/case/${encodeURIComponent(caseId)}/pdf${query ? `?${query}` : ""}`;
}

const geoDataCache = new Map<string, GeoDataRecord | null>();
const geoDataPending = new Map<string, Promise<GeoDataRecord | null>>();

/**
 * 根据 ID 获取单个地图数据
 * 
 * @param dataId 地图数据 ID
 * @returns 地图数据记录
 */
export async function getGeoDataById(dataId: string): Promise<GeoDataRecord | null> {
  if (!dataId) return null;
  if (geoDataCache.has(dataId)) {
    return geoDataCache.get(dataId) ?? null;
  }

  const pending = geoDataPending.get(dataId);
  if (pending) {
    return pending;
  }

  const request = (async () => {
  try {
    const response = await fetch(`${AGENT_API_URL}/api/geo/${dataId}`);
    
    if (!response.ok) {
      console.warn(`获取地图数据失败: ${response.status}`);
      geoDataCache.set(dataId, null);
      return null;
    }
    
    const data = (await response.json()) as GeoDataRecord;
    geoDataCache.set(dataId, data);
    return data;
  } catch (e) {
    console.error("获取地图数据失败:", e);
    geoDataCache.set(dataId, null);
    return null;
  } finally {
    geoDataPending.delete(dataId);
  }
  })();

  geoDataPending.set(dataId, request);
  return request;
}

/**
 * 获取指定线程的所有地图数据
 * 
 * @param threadId 对话线程 ID
 * @returns 地图数据列表
 */
export async function getGeoDataByThread(threadId: string): Promise<GeoDataRecord[]> {
  try {
    const response = await fetch(`${AGENT_API_URL}/api/geo/thread/${threadId}`);
    
    if (!response.ok) {
      console.warn(`获取线程地图数据失败: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    return data.data || [];
  } catch (e) {
    console.error("获取线程地图数据失败:", e);
    return [];
  }
}
