/**
 * 常量配置文件
 * 
 * 集中管理所有应用程序常量，便于维护和修改
 * 参考: https://github.com/CopilotKit/open-research-ANA/blob/main/frontend/src/lib/consts.ts
 */

// ============================================================
// API 配置
// ============================================================

const getDefaultApiBase = (): string => {
  if (typeof window === "undefined") return "http://localhost:8090";
  const { protocol, hostname } = window.location;
  // 使用固定端口是当前项目最稳定、最通用的联调方式。
  return `${protocol}//${hostname}:8090`;
};

const getDefaultRuntimeUrl = (): string => {
  if (typeof window === "undefined") return "http://localhost:4000/copilotkit";
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:4000/copilotkit`;
};

/** CopilotKit Runtime 服务地址（可通过 VITE_RUNTIME_URL 覆盖） */
export const RUNTIME_URL = (import.meta as any)?.env?.VITE_RUNTIME_URL || getDefaultRuntimeUrl();

/** Agent 服务地址（可通过 VITE_AGENT_API_URL 覆盖） */
export const AGENT_API_URL = (import.meta as any)?.env?.VITE_AGENT_API_URL || getDefaultApiBase();

/** 天地图 API Key - 请在 https://console.tianditu.gov.cn/ 申请 */
export const TIANDITU_API_KEY = "22f0012a5cbb142ca6f11736d13d20aa";

// ============================================================
// Agent 类型配置
// ============================================================

/** Agent 类型定义 */
export type AgentType =  "test";

// ============================================================
// 聊天配置
// ============================================================

/** 聊天标题 */
export const CHAT_TITLE = "GraphRAG 智能问答";

/** 聊天指令 - 按 Agent 类型 */
export const CHAT_INSTRUCTIONS: Record<AgentType, string> = {
  test: "你是一个知识图谱增强的智能助手，基于 GraphRAG 技术。请用中文回答。",
};

/** 提问建议 - 按 Agent 类型 */
export const CHAT_SUGGESTIONS: Record<AgentType, string[]> = {
  test: [
    "苏州地区典型农作物的 Cab、LAI 和 Cw 参数推荐值",
    "亚热带红树林生态系统的 LAI 和 ALA 参数范围及季节变化规律",
    "温带落叶林在生长旺季的 N、Cab、Car 和 Cm 参数配置方案",
    "干旱区稀疏植被的 LAI、psoil 和 hotspot 参数反演策略",
  ],
};

// ============================================================
// UI 配置
// ============================================================

/** 状态颜色配置 */
export const STATUS_COLORS = {
  complete: "#4ade80",
  executing: "#fbbf24",
  pending: "#a0a0a0",
  failed: "#ef4444",
} as const;

/** 步骤状态类型 */
export type StepStatus = keyof typeof STATUS_COLORS;

// ============================================================
// 本地存储键名
// ============================================================

export const STORAGE_KEYS = {
  THREADS: "graphrag_threads",
  AGENT_STATE_PREFIX: "graphrag_agent_state_",
} as const;
