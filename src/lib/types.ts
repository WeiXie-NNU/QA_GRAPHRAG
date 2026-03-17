/**
 * 类型定义文件 - 对应后端 agent/test_agent/state.py
 * 
 * 参考: https://github.com/CopilotKit/open-research-ANA/blob/main/frontend/src/lib/types.ts
 * 
 * PROSAIL 模型参数推理 - 基于 GraphRAG 的知识驱动推理
 */

// ============================================================
// 步骤类型定义
// ============================================================

export interface StepItem {
  description: string;
  status: string;  // "pending" | "executing" | "complete"
  updates: string[];
}

// ============================================================
// 思考过程类型定义
// ============================================================

export interface ThinkingStep {
  id: string;                    // 步骤唯一标识
  node_name: string;             // 当前节点名称
  title: string;                 // 步骤标题
  content: string;               // 思考内容
  status: "thinking" | "complete" | "error";  // 步骤状态
  timestamp?: string;            // 时间戳
}

// ============================================================
// 地理坐标点类型
// ============================================================

export interface CaseParameter {
  name: string;
  category: string;
  min: number;
  max: number;
  unit: string;
}

export interface CaseDetails {
  case_id: string;
  paper_title?: string;          // 论文标题
  pdf_filename?: string;         // PDF文件名
  description: string;
  source_file: string;
  reliability: string;
  sensor_type: string;
  region_name: string;
  region_description: string;
}

export interface GeoPoint {
  id: string;
  kg_id?: string;              // 关联知识仓库（prosail/lue）
  name: string;
  lat: number;
  lng: number;
  value?: number;
  param_type?: string;  // 参数类型，如 "reference_case"
  param_name?: string;  // 参数名称，如 "Cab", "ALA", "Cw"
  similarity?: number;  // 相似度 (0-1)
  match_reason?: string;  // 匹配原因
  // 精简版字段（状态同步时使用）
  paper_title?: string;           // 论文标题（截断版）
  vegetation_type?: string;       // 植被类型
  point_type?: string;            // 点类型 "target" | "reference_case"
  // 完整版字段（API 获取时使用）
  case_details?: CaseDetails;  // 案例详情（仅 API 返回包含）
  parameters?: CaseParameter[];  // 参数配置列表（仅 API 返回包含）
}

// ============================================================
// PROSAIL 参数定义
// ============================================================

export interface PROSAILParams {
  Cab?: number;    // 叶绿素含量 (μg/cm²)
  ALA?: number;    // 平均叶倾角 (°)
  Cw?: number;     // 叶片等效水厚度 (cm)
  N?: number;      // 叶片结构参数
  LAI?: number;    // 叶面积指数
  LIDFa?: number;  // 叶倾角分布参数 a
  LIDFb?: number;  // 叶倾角分布参数 b
  hspot?: number;  // 热点参数
  rsoil0?: number; // 土壤亮度因子
}

// ============================================================
// 相似案例类型
// ============================================================

export interface SimilarCase {
  region_id: string;
  region_name: string;
  similarity: number;
  distance_km?: number;
  climate?: string;
  eco_category?: string;
  params: PROSAILParams;
}

// ============================================================
// 目标区域类型
// ============================================================

export interface TargetRegion {
  name: string;
  lat?: number;
  lng?: number;
  climate?: string;
  eco_category?: string;
}

// ============================================================
// GraphRAG 查询结果类型
// ============================================================

export interface PaperSource {
  file_name: string;
  title: string;
  authors: string;
  doi: string;
  journal: string;
  year: string;
  citation: string;
}

/**
 * GraphRAG 结果摘要 - 通过 CopilotKit 状态共享
 * 
 * 注意：完整的 context_data 和 source_documents 存储在数据库中，
 * 前端通过 API 按需获取，不再通过状态来回传递以减少带宽消耗。
 */
export interface GraphRAGResultSummary {
  search_type: "local" | "global";     // 搜索类型
  query: string;                        // 原始查询
  response: string;                     // LLM 生成的回答
  relevance_score: number;              // 相关性评分 (0-1)
  execution_time: number;               // 执行时间 (秒)
  result_id?: string;                   // 数据库记录 ID，用于获取完整结果
}

/**
 * GraphRAG 完整结果 - 从数据库 API 获取
 */
export interface GraphRAGResult {
  id: string;                           // 数据库记录 ID
  thread_id: string;                    // 对话线程 ID
  search_type: "local" | "global";      // 搜索类型
  query: string;                        // 原始查询
  response: string;                     // LLM 生成的回答
  context_data?: {                      // 上下文数据
    entities?: any[];
    relationships?: any[];
    communities?: any[];
    themes?: any[];
    source_documents?: string[];        // 来源文档ID列表
    paper_sources?: PaperSource[];      // 论文来源元数据
    [key: string]: any;
  };
  source_documents: string[];           // 来源文档
  relevance_score: number;              // 相关性评分 (0-1)
  execution_time: number;               // 执行时间 (秒)
  token_usage: number;                  // Token 消耗
  created_at: string;                   // 创建时间
}

// ============================================================
// 推理结果类型
// ============================================================

export interface ReasoningResult {
  target_region: TargetRegion;
  target_params: PROSAILParams;
  similar_cases: SimilarCase[];
  inference_method: string;
  confidence: number;
  reasoning_steps: string[];
  spatial_distribution?: GeoPoint[];
  report?: string;
}

// ============================================================
// Agent 状态定义 - 对应后端 PROSAILState
// ============================================================

export interface TestAgentState {
  // messages 由 CopilotKitState 自动管理
  messages?: any[];
  
  // 用户查询
  query?: string;
  
  // // 目标区域信息
  // target_region?: TargetRegion;
  
  // // 目标参数 (要推理的参数)
  // target_params?: PROSAILParams;
  
  // // 相似案例列表
  // similar_cases?: SimilarCase[];
  
  // 推理结果
  // reasoning_result?: ReasoningResult | null;
  
  // // GraphRAG 查询结果摘要（完整结果通过 API 获取）
  local_rag_result?: GraphRAGResultSummary;
  global_rag_result?: GraphRAGResultSummary;
  
  // 任务步骤 - 这是唯一通过 CopilotKit 状态实时同步的数据
  steps?: StepItem[];
  
  // // 地理坐标点 - 已移至数据库，通过 /api/geo/{id} 按需获取
  // // 不再通过 CopilotKit 状态同步，以减少 payload 大小
  // geo_points?: GeoPoint[];
  
  // 思考过程状态（用于实时渲染）
  thinking_steps?: ThinkingStep[];
  current_node?: string;
  current_thinking?: string;
  
  // // 证据链（用于推理结果展示）
  // evidence_chain?: any[];
}
