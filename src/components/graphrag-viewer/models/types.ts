/**
 * GraphRAG Visualizer 类型定义
 * 移植自 graphrag-visualizer 项目
 */

import type { GraphData, NodeObject, LinkObject } from "react-force-graph-2d";

// ============================================================
// 基础数据类型 - 对应 parquet 文件结构
// ============================================================

export interface Entity {
  id: string;
  human_readable_id?: number;
  title: string;
  type: string;
  description?: string;
  text_unit_ids?: string[];
  graph_embedding?: number[];
  description_embedding?: number[];
}

export interface Relationship {
  id: string;
  human_readable_id?: number;
  source: string;
  target: string;
  type?: string;
  description?: string;
  weight?: number;
  combined_degree?: number;
  text_unit_ids?: string[];
}

export interface Document {
  id: string;
  human_readable_id?: number;
  title: string;
  text?: string;
  text_unit_ids?: string[];
}

export interface TextUnit {
  id: string;
  human_readable_id?: number;
  text: string;
  n_tokens?: number;
  document_ids?: string[];
  entity_ids?: string[];
  relationship_ids?: string[];
}

export interface Community {
  id: string;
  human_readable_id?: number;
  community: number;
  parent?: number;
  level: number;
  title: string;
  entity_ids?: string[];
  relationship_ids?: string[];
  text_unit_ids?: string[];
  period?: string;
  size?: number;
}

export interface Finding {
  summary: string;
  explanation: string;
}

export interface CommunityReport {
  id: string;
  human_readable_id?: number;
  community: number;
  parent?: number;
  level: number;
  title: string;
  summary?: string;
  full_content?: string;
  rank?: number;
  rank_explanation?: string;
  findings?: Finding[];
  full_content_json?: string;
  period?: string;
  size?: number;
}

export interface Covariate {
  id: string;
  human_readable_id?: number;
  covariate_type: string;
  type?: string;
  description?: string;
  subject_id?: string;
  object_id?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
  source_text?: string;
  text_unit_id?: string;
}

// ============================================================
// 图数据类型 - 用于可视化
// ============================================================

export interface CustomNode extends NodeObject {
  uuid?: string;
  id: string;
  name?: string;
  title?: string;
  type?: string;
  description?: string;
  human_readable_id?: number;
  text_unit_ids?: string[];
  text?: string;
  summary?: string;
  explanation?: string;
  covariate_type?: string;
  findings?: Finding[];
  neighbors?: CustomNode[];
  links?: CustomLink[];
  color?: string;
}

export interface CustomLink extends LinkObject {
  id?: string;
  source: string | CustomNode;
  target: string | CustomNode;
  type?: string;
  weight?: number;
  description?: string;
  text_unit_ids?: string[];
  human_readable_id?: number;
  combined_degree?: number;
}

export interface CustomGraphData extends GraphData {
  nodes: CustomNode[];
  links: CustomLink[];
}

// ============================================================
// 搜索结果类型
// ============================================================

export interface SearchResult {
  response: string;
  context_data: {
    entities?: Array<{ id: string; entity: string; description: string }>;
    relationships?: Array<{ id: string; source: string; target: string; description: string }>;
    reports?: Array<{ id: string; title: string; summary: string }>;
    sources?: Array<{ id: string; text: string }>;
    claims?: Array<{ id: string; subject_id: string; type: string; description: string }>;
  };
  completion_time: number;
  llm_calls: number;
  prompt_tokens: number;
}

// ============================================================
// 文件处理类型
// ============================================================

export type FileSchema = 
  | "entity"
  | "relationship"
  | "document"
  | "text_unit"
  | "community"
  | "community_report"
  | "covariate";

export const FILE_SCHEMA_MAPPING: Record<string, FileSchema> = {
  "entities.parquet": "entity",
  "relationships.parquet": "relationship",
  "documents.parquet": "document",
  "text_units.parquet": "text_unit",
  "communities.parquet": "community",
  "community_reports.parquet": "community_report",
  "covariates.parquet": "covariate",
  // GraphRAG v1.x 兼容
  "create_final_entities.parquet": "entity",
  "create_final_relationships.parquet": "relationship",
  "create_final_documents.parquet": "document",
  "create_final_text_units.parquet": "text_unit",
  "create_final_communities.parquet": "community",
  "create_final_community_reports.parquet": "community_report",
  "create_final_covariates.parquet": "covariate",
};

// ============================================================
// 知识图谱配置
// ============================================================

export interface KnowledgeGraphConfig {
  id: string;
  name: string;
  description: string;
  icon: string;
  basePath: string;  // 服务器路径，如 /kg-data/prosail
}
