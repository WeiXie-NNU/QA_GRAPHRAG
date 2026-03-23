import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useLocation, useNavigate } from "react-router-dom";
import "@xyflow/react/dist/style.css";
import "./IndexPage.css";
import { CHAT_TITLE, TIANDITU_API_KEY } from "../lib/consts";
import { loadAdminGeoJson } from "../services/resourceService";
import { createNewThreadId } from "../services/threadService";
import { useAuth } from "../contexts";
import { DEFAULT_LOGIN_SUGGESTIONS } from "../services/authService";

type AdminLevel = "province" | "city" | "county";

interface CsvCase {
  title: string;
  province: string;
  place: string;
  lat: number | null;
  lng: number | null;
}

interface RegionCount {
  name: string;
  count: number;
}

type AgentFlowNodeKind = "entry" | "router" | "branch" | "core" | "capability" | "knowledge" | "delivery";

interface AgentFlowItem {
  id?: string;
  title: string;
  caption?: string;
  code?: string;
  active?: boolean;
}

interface AgentFlowNodeData extends Record<string, unknown> {
  title: string;
  chip?: string;
  description?: string;
  kind: AgentFlowNodeKind;
  active?: boolean;
  badges?: string[];
  items?: AgentFlowItem[];
  onActivateStage?: (stageId: string) => void;
}

const coreModules = [
  {
    id: "retrieval",
    title: "混合检索层",
    summary: "向量召回与知识图谱关系检索并行执行，提升复杂问题命中率。",
    points: ["向量召回", "实体对齐", "证据聚合"],
  },
  {
    id: "reasoning",
    title: "Agent 推理编排",
    summary: "使用 LangGraph 工作流拆解任务，按步骤执行、追踪、回溯。",
    points: ["步骤编排", "状态管理", "可解释链路"],
  },
  {
    id: "visual",
    title: "可视化展示层",
    summary: "将答案、关系网络和地理线索放到同一界面，便于演示与复核。",
    points: ["图谱视图", "地图联动", "证据面板"],
  },
  {
    id: "spatial",
    title: "案例空间分布",
    summary: "聚合历史案例的地理点位与相似区域，支持按分层查看统计。",
    points: ["省市县分层", "位置点分布", "案例数量统计"],
  },
];

const demoFlow = [
  "输入问题并创建线程",
  "查看 Agent 步骤进度",
  "打开图谱关系视图",
  "联动地图查看空间证据",
  "导出结果用于汇报",
];

const agentLogicQuickPath = [
  {
    id: "general_qa_prepare",
    code: "general_qa_prepare",
    title: "通用问答准备",
    text: "先整理通用问题上下文，准备进入对话代理。",
  },
  {
    id: "general_qa_agent",
    code: "general_qa_agent",
    title: "问答代理",
    text: "由 Agent 决定是否需要调用检索工具补充信息。",
  },
  {
    id: "general_qa_finalize",
    code: "general_qa_finalize",
    title: "直接回答返回",
    text: "整理回答并直接返回，适合非参数配置类问题。",
  },
] as const;

const agentLogicMainPath = [
  {
    id: "intake",
    code: "intake",
    title: "信息抽取",
    text: "抽取模型、地区、目标参数等关键条件。",
  },
  {
    id: "human_check",
    code: "human_check",
    title: "人工核对",
    text: "检查信息是否齐全，必要时进入人工确认。",
  },
  {
    id: "route",
    code: "route / complement / approval",
    title: "分支判断与补全",
    text: "决定直接检索还是先补齐条件，并在关键节点请求确认。",
  },
  {
    id: "gather_evidence_agent",
    code: "gather_evidence_agent",
    title: "证据检索",
    text: "组织 GraphRAG 检索、案例空间查询和证据汇总。",
  },
  {
    id: "synthesize",
    code: "synthesize",
    title: "综合推理",
    text: "把多来源证据整理成参数建议与解释链路。",
  },
  {
    id: "quality_check",
    code: "quality_check",
    title: "质量检查",
    text: "做最终复核，输出适合展示和追问的回答。",
  },
] as const;

const agentLogicSupportCards = [
  {
    id: "tools",
    chip: "Tool Layer",
    title: "GraphRAG 工具层",
    text: "graphrag_local_search、graphrag_global_search 与 get_cases 在这里被调度。",
    related: ["gather_evidence_agent", "synthesize"],
  },
  {
    id: "hitl",
    chip: "HITL Gate",
    title: "人工确认环节",
    text: "当地区、模型或参数缺失时，通过 human_check / approval 让用户补充信息。",
    related: ["human_check", "route"],
  },
  {
    id: "state",
    chip: "State Sync",
    title: "状态与线程同步",
    text: "步骤进度、可视化结果和回答内容会同步写入线程记录，支持续聊与回看。",
    related: ["quality_check"],
  },
] as const;

const agentLogicOutputs = [
  { id: "answer", title: "参数建议与结论回答", text: "输出结构化建议和最终解释。" },
  { id: "evidence", title: "证据摘要、图谱和地图联动", text: "把证据与空间线索一起交付前端。" },
  { id: "thread", title: "线程持久化与步骤状态回放", text: "将状态写回线程，支持续聊与复盘。" },
] as const;

const architectureSignals = [
  "更容易上手",
  "支持续聊记忆",
  "多步智能分析",
  "证据与地图联动",
];

const architectureExplorerPanels = [
  {
    id: "entry",
    title: "统一入口体验",
    headline: "从首页到问答页切换自然，第一次进入也能快速开始演示。",
    summary:
      "用户从首页登录后即可进入问答工作台，不需要理解底层流程，也能顺畅完成提问、查看结果和继续追问。",
    details: [
      "首页即入口，登录、进入系统、查看演示问题都集中在同一位置",
      "从开始提问到查看图谱和地图，不需要跳出当前工作流",
      "适合产品演示、汇报介绍和第一次上手体验",
    ],
    relatedLayers: ["entry"],
    accent: "#9b8cff",
    soft: "rgba(155, 140, 255, 0.18)",
    surfaceCards: [
      { title: "首页入口", caption: "登录后即可开始提问" },
      { title: "对话工作台", caption: "问题、结果与追问在同一页" },
      { title: "结果联动", caption: "图谱与地图同步联动查看" },
    ],
    floatingBadges: ["单入口", "低学习成本", "演示友好"],
  },
  {
    id: "memory",
    title: "会话记忆与续聊",
    headline: "每次回来都能接着问，而不是重新开始。",
    summary:
      "系统会保留每条对话线程的上下文、历史回答和关键状态，让用户继续追问时仍然保持前后连贯。",
    details: [
      "线程化会话让不同问题和不同用户彼此分开",
      "支持继续追问、补充条件和回看历史结果",
      "演示现场切换线程时，状态和内容都能平滑恢复",
    ],
    relatedLayers: ["entry", "memory"],
    accent: "#f2c94c",
    soft: "rgba(242, 201, 76, 0.2)",
    surfaceCards: [
      { title: "历史线程", caption: "不同主题的会话彼此独立" },
      { title: "状态恢复", caption: "返回时自动接上此前上下文" },
      { title: "继续追问", caption: "补充条件后仍保持连贯" },
    ],
    floatingBadges: ["线程记忆", "续聊体验", "状态恢复"],
  },
  {
    id: "reasoning",
    title: "多步智能推理",
    headline: "系统会自动拆解问题、逐步分析，再给出更可信的回答。",
    summary:
      "面对复杂问题时，系统不是直接生成一句答案，而是先理解问题、组织推理步骤、再综合输出，过程更清晰。",
    details: [
      "先理解问题意图，再进入多步骤分析",
      "重要节点可以进行人工确认，避免关键信息遗漏",
      "最终答案会结合检索结果和推理结论一起给出",
    ],
    relatedLayers: ["reasoning"],
    accent: "#5b7cff",
    soft: "rgba(91, 124, 255, 0.18)",
    surfaceCards: [
      { title: "问题理解", caption: "先识别意图和任务重点" },
      { title: "步骤推理", caption: "分步分析而不是直接给结论" },
      { title: "质量复核", caption: "关键节点可进行人工确认" },
    ],
    floatingBadges: ["多步推理", "过程可见", "更可信"],
  },
  {
    id: "evidence",
    title: "证据与空间线索",
    headline: "不只告诉你结论，还告诉你依据和相关区域线索。",
    summary:
      "系统会把图谱关系、证据摘要、地图点位和区域分布放到一起，帮助用户理解结论从哪里来。",
    details: [
      "图谱关系和证据摘要可以一起查看",
      "地图点位和区域统计帮助理解空间分布",
      "更适合需要解释来源、复核结果的场景",
    ],
    relatedLayers: ["evidence"],
    accent: "#63dfbf",
    soft: "rgba(99, 223, 191, 0.18)",
    surfaceCards: [
      { title: "证据链", caption: "答案与依据同时展示" },
      { title: "关系图谱", caption: "实体关系帮助理解来龙去脉" },
      { title: "地图线索", caption: "空间分布与区域特征一起看" },
    ],
    floatingBadges: ["证据可见", "地图联动", "空间洞察"],
  },
  {
    id: "delivery",
    title: "演示与复核输出",
    headline: "既能用来现场演示，也方便人工确认和结果复盘。",
    summary:
      "整个界面围绕“看得懂、讲得清、能复核”来设计，用户能快速理解系统特点，也能回看关键依据与过程。",
    details: [
      "回答、步骤、证据、地图在一个页面联动展示",
      "适合对外演示、内部沟通和人工确认",
      "减少只看结论时的信息断层",
    ],
    relatedLayers: ["delivery"],
    accent: "#ff9e57",
    soft: "rgba(255, 158, 87, 0.18)",
    surfaceCards: [
      { title: "展示输出", caption: "面向汇报的清晰表达方式" },
      { title: "人工复核", caption: "关键信息可以快速回看确认" },
      { title: "多视图联动", caption: "回答、证据和空间信息同屏呈现" },
    ],
    floatingBadges: ["汇报友好", "可解释", "可复盘"],
  },
] as const;

const caseIntakeSteps = [
  {
    title: "手动上传材料",
    text: "支持上传案例文档、报告或整理后的原始材料，作为新的案例来源。",
  },
  {
    title: "自动抽取字段",
    text: "系统对案例中的关键内容进行结构化抽取，整理主题、区域、参数和证据摘要。",
  },
  {
    title: "沉淀进入案例库",
    text: "整理后的案例可直接入库，为后续相似问题检索、对比分析和汇报展示提供基础。",
  },
] as const;

const caseIntakeBenefits = [
  "补充案例库内容，不只依赖已有样本",
  "让后续问答能参考更多历史案例与经验",
  "把上传、抽取、入库做成统一流程，便于演示与维护",
] as const;

const architecturePlatformLayers = [
  {
    id: "entry",
    title: "会话编排",
    caption: "承接首页入口、线程创建与工作台联动",
    panelId: "entry",
  },
  {
    id: "memory",
    title: "上下文记忆",
    caption: "保存历史状态，让用户追问自然不断线",
    panelId: "memory",
  },
  {
    id: "reasoning",
    title: "多步推理",
    caption: "理解问题、拆解步骤并组织可信回答",
    panelId: "reasoning",
  },
  {
    id: "evidence",
    title: "证据整合",
    caption: "把图谱、地图和摘要证据并入分析链路",
    panelId: "evidence",
  },
  {
    id: "delivery",
    title: "展示复核",
    caption: "把结果包装成更适合演示与确认的输出",
    panelId: "delivery",
  },
] as const;

const architectureKnowledgeAssets = [
  {
    id: "cases",
    title: "案例库",
    caption: "沉淀相似问题、参数经验与历史结果参考",
  },
  {
    id: "graph",
    title: "知识图谱",
    caption: "组织实体与关系，为答案建立解释链路",
  },
  {
    id: "geo",
    title: "空间线索",
    caption: "连接地图点位、区域分布与地理证据",
  },
] as const;

const invisibleHandleStyle = {
  width: 8,
  height: 8,
  opacity: 0,
  pointerEvents: "none" as const,
};

const AgentFlowNodeCard: React.FC<NodeProps> = ({ data }) => {
  const nodeData = data as AgentFlowNodeData;
  const isCore = nodeData.kind === "core";

  return (
    <div className={`agent-flow-node agent-flow-node-${nodeData.kind} ${nodeData.active ? "is-active" : ""}`}>
      <Handle type="target" id="t-top" position={Position.Top} style={invisibleHandleStyle} />
      <Handle type="target" id="t-right" position={Position.Right} style={invisibleHandleStyle} />
      <Handle type="target" id="t-bottom" position={Position.Bottom} style={invisibleHandleStyle} />
      <Handle type="target" id="t-left" position={Position.Left} style={invisibleHandleStyle} />
      <Handle type="source" id="s-top" position={Position.Top} style={invisibleHandleStyle} />
      <Handle type="source" id="s-right" position={Position.Right} style={invisibleHandleStyle} />
      <Handle type="source" id="s-bottom" position={Position.Bottom} style={invisibleHandleStyle} />
      <Handle type="source" id="s-left" position={Position.Left} style={invisibleHandleStyle} />

      <div className="agent-flow-node-header">
        {nodeData.chip ? <span className="agent-flow-node-chip">{nodeData.chip}</span> : <span />}
        {nodeData.badges?.length ? (
          <div className="agent-flow-node-badges">
            {nodeData.badges.map((badge) => (
              <span key={badge}>{badge}</span>
            ))}
          </div>
        ) : null}
      </div>

      <h4>{nodeData.title}</h4>
      {nodeData.description ? <p>{nodeData.description}</p> : null}

      {isCore && nodeData.items?.length ? (
        <div className="agent-flow-core-shell">
          <div className="agent-flow-core-line" />
          <div className="agent-flow-core-steps">
            {nodeData.items.map((item, index) => (
              <button
                key={item.id ?? item.title}
                type="button"
                className={`agent-flow-core-step ${item.active ? "is-active" : ""}`}
                onMouseEnter={() => {
                  if (item.id) {
                    nodeData.onActivateStage?.(item.id);
                  }
                }}
                onClick={() => {
                  if (item.id) {
                    nodeData.onActivateStage?.(item.id);
                  }
                }}
              >
                <span className="agent-flow-core-step-index">{String(index + 1).padStart(2, "0")}</span>
                <div className="agent-flow-core-step-copy">
                  <strong>{item.title}</strong>
                  {item.code ? <code>{item.code}</code> : null}
                  {item.caption ? <span>{item.caption}</span> : null}
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {!isCore && nodeData.items?.length ? (
        <div className={`agent-flow-item-list agent-flow-item-list-${nodeData.kind}`}>
          {nodeData.items.map((item) => (
            <div key={item.id ?? item.title} className={`agent-flow-item ${item.active ? "is-active" : ""}`}>
              <strong>{item.title}</strong>
              {item.code ? <code>{item.code}</code> : null}
              {item.caption ? <span>{item.caption}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const agentFlowNodeTypes = {
  logic: AgentFlowNodeCard,
};

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }

  fields.push(field);
  return fields;
}

function parseCsvText(text: string): CsvCase[] {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const idx = (key: string) => headers.findIndex((h) => h.includes(key));

  const titleIdx = idx("论文标题");
  const provIdx = idx("省份");
  const placeIdx = idx("地名");
  const latIdx = idx("纬度");
  const lngIdx = idx("经度");

  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const latStr = latIdx >= 0 ? (cols[latIdx] || "").trim() : "";
    const lngStr = lngIdx >= 0 ? (cols[lngIdx] || "").trim() : "";

    return {
      title: titleIdx >= 0 ? (cols[titleIdx] || "").trim() : "",
      province: provIdx >= 0 ? (cols[provIdx] || "").trim() : "",
      place: placeIdx >= 0 ? (cols[placeIdx] || "").trim() : "",
      lat: latStr ? Number.parseFloat(latStr) : null,
      lng: lngStr ? Number.parseFloat(lngStr) : null,
    };
  });
}

function normalizeName(name: string): string {
  return name
    .replace(/省|市|自治区|壮族|回族|维吾尔自治区|维吾尔|特别行政区|地区|盟|自治州|自治县|县|区/g, "")
    .trim();
}

function isPointInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersect = (yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function isPointInGeometry(lat: number, lng: number, geometry: any): boolean {
  if (!geometry || !geometry.coordinates) return false;

  if (geometry.type === "Polygon") {
    return isPointInRing(lat, lng, geometry.coordinates[0]);
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon: number[][][]) => polygon.length > 0 && isPointInRing(lat, lng, polygon[0]));
  }

  return false;
}

function getFeatureName(feature: any): string {
  const props = feature?.properties || {};
  return props.name || props.NAME || props.省 || props.市 || props.县 || props.adcode_name || "未命名区域";
}

function countByLevel(cases: CsvCase[], level: AdminLevel, geoData: any | null): RegionCount[] {
  const features = geoData?.features || [];

  const validCases = cases.filter(
    (c) => c.lat != null && c.lng != null && Number.isFinite(c.lat) && Number.isFinite(c.lng)
  ) as Array<CsvCase & { lat: number; lng: number }>;

  if (level === "province") {
    const byName = new Map<string, number>();
    validCases.forEach((c) => {
      const key = normalizeName(c.province || c.place || "");
      if (!key) return;
      byName.set(key, (byName.get(key) || 0) + 1);
    });

    const rows: RegionCount[] = features.map((feature: any) => {
      const name = getFeatureName(feature);
      const key = normalizeName(name);
      return { name, count: byName.get(key) || 0 };
    });

    return rows.filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
  }

  const rows: RegionCount[] = features.map((feature: any) => {
    const name = getFeatureName(feature);
    const count = validCases.reduce((acc, c) => (isPointInGeometry(c.lat, c.lng, feature.geometry) ? acc + 1 : acc), 0);
    return { name, count };
  });

  return rows.filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
}

function buildSpatialMapHtml(cases: CsvCase[], level: AdminLevel, geoData: any | null): string {
  const points = cases
    .filter((c) => c.lat != null && c.lng != null && Number.isFinite(c.lat) && Number.isFinite(c.lng))
    .map((c) => ({
      title: c.title,
      province: c.province,
      place: c.place,
      lat: c.lat as number,
      lng: c.lng as number,
    }));

  if (!geoData) return "";
  const style =
    level === "province"
      ? { color: "#3b82f6", weight: 1.6, fillOpacity: 0.06 }
      : level === "city"
        ? { color: "#8b5cf6", weight: 1.0, fillOpacity: 0.04 }
        : { color: "#64748b", weight: 0.7, fillOpacity: 0.03 };

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
      html, body, #map { margin: 0; width: 100%; height: 100%; }
      .case-dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: #ef4444;
        border: 2px solid #fff;
        box-shadow: 0 2px 6px rgba(239, 68, 68, 0.55);
      }
      .leaflet-popup-content { margin: 10px 12px; font-family: Arial, sans-serif; }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script>
      const chinaBounds = L.latLngBounds([
        [3.5, 73.0],
        [54.5, 136.0]
      ]);

      const map = L.map('map', {
        attributionControl: false,
        maxBounds: chinaBounds,
        maxBoundsViscosity: 1.0,
        minZoom: 3,
        maxZoom: 12,
      }).setView([35.8, 104.1], 3.6);

      L.tileLayer('https://t{s}.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILECOL={x}&TILEROW={y}&TILEMATRIX={z}&tk=${TIANDITU_API_KEY}', {
        subdomains: ['0','1','2','3','4','5','6','7'],
        maxZoom: 18
      }).addTo(map);

      L.tileLayer('https://t{s}.tianditu.gov.cn/cva_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cva&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILECOL={x}&TILEROW={y}&TILEMATRIX={z}&tk=${TIANDITU_API_KEY}', {
        subdomains: ['0','1','2','3','4','5','6','7'],
        maxZoom: 18
      }).addTo(map);

      const geoLayer = L.geoJSON(${JSON.stringify(geoData)}, {
        style: {
          color: '${style.color}',
          weight: ${style.weight},
          fillOpacity: ${style.fillOpacity}
        }
      }).addTo(map);

      const points = ${JSON.stringify(points)};
      const bounds = [];

      points.forEach(function(p) {
        const marker = L.marker([p.lat, p.lng], {
          icon: L.divIcon({ className: 'case-dot', iconSize: [10,10], iconAnchor: [5,5] })
        }).addTo(map);

        marker.bindPopup(
          '<strong>' + (p.place || '案例点') + '</strong><br/>' +
          '<small>' + (p.province || '') + '</small><br/>' +
          '<small>' + (p.title || '') + '</small>'
        );

        bounds.push([p.lat, p.lng]);
      });

      // 默认先完整显示中国范围，保证全国边界可见
      map.fitBounds(chinaBounds, { padding: [18, 18], maxZoom: 6 });

      map.panInsideBounds(chinaBounds, { animate: false });
    </script>
  </body>
  </html>
  `;
}

export const IndexPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser, users, login } = useAuth();
  const spatialSectionRef = useRef<HTMLElement | null>(null);
  const [csvCases, setCsvCases] = useState<CsvCase[]>([]);
  const [adminLevel, setAdminLevel] = useState<AdminLevel>("province");
  const [adminGeoData, setAdminGeoData] = useState<any | null>(null);
  const [isAdminGeoLoading, setIsAdminGeoLoading] = useState(true);
  const [shouldLoadSpatial, setShouldLoadSpatial] = useState(false);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [loginName, setLoginName] = useState("");
  const [loginError, setLoginError] = useState("");
  const [activeArchitecturePanelId, setActiveArchitecturePanelId] = useState<string>("memory");
  const [activeAgentStageId, setActiveAgentStageId] = useState<string>(agentLogicMainPath[0].id);

  const handleEnterSystem = () => {
    if (!currentUser) {
      setIsLoginOpen(true);
      setLoginError("请先登录后再进入系统");
      return;
    }
    const newThreadId = createNewThreadId();
    navigate(`/chat/${newThreadId}`, { state: { isNewThread: true } });
  };

  const handleJumpToGithub = () => {
    window.open("https://github.com/WeiXie-NNU/QA_GRAPHRAG", "_blank");
  };

  useEffect(() => {
    const ids = agentLogicMainPath.map((item) => item.id);
    let cursor = 0;
    const timer = window.setInterval(() => {
      cursor = (cursor + 1) % ids.length;
      setActiveAgentStageId(ids[cursor]);
    }, 2400);
    return () => window.clearInterval(timer);
  }, []);

  const loginSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const names = [...users.map((user) => user.name), ...DEFAULT_LOGIN_SUGGESTIONS];
    return names.filter((item) => {
      const key = item.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [users]);

  const handleLogin = (value: string) => {
    const nextName = value.trim();
    if (!nextName) {
      setLoginError("请输入用户名");
      return;
    }

    try {
      login(nextName);
      setLoginName("");
      setLoginError("");
      setIsLoginOpen(false);
      navigate("/", { replace: true });
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "登录失败");
    }
  };

  useEffect(() => {
    const state = location.state as { showLogin?: boolean } | null;
    if (state?.showLogin) {
      setIsLoginOpen(true);
      setLoginError((prev) => prev || "请先登录后再进入对话页面");
      navigate(location.pathname, { replace: true });
    }
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    if (shouldLoadSpatial) return;
    const target = spatialSectionRef.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      setShouldLoadSpatial(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoadSpatial(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px 0px" },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [shouldLoadSpatial]);

  useEffect(() => {
    if (!shouldLoadSpatial) return;
    const candidates = ["/resources/repositories/PROSAIL/parameters.csv"];
    (async () => {
      for (const path of candidates) {
        try {
          const res = await fetch(path);
          if (!res.ok) continue;
          const text = await res.text();
          setCsvCases(parseCsvText(text));
          return;
        } catch {
          // try next path
        }
      }
      setCsvCases([]);
    })();
  }, [shouldLoadSpatial]);

  useEffect(() => {
    if (!shouldLoadSpatial) return;
    let cancelled = false;
    setIsAdminGeoLoading(true);
    void loadAdminGeoJson(adminLevel)
      .then((payload) => {
        if (!cancelled) {
          setAdminGeoData(payload);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("行政区划资源加载失败:", error);
          setAdminGeoData(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsAdminGeoLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [adminLevel, shouldLoadSpatial]);

  const regionRows = useMemo(
    () => countByLevel(csvCases, adminLevel, adminGeoData),
    [adminGeoData, adminLevel, csvCases],
  );

  const validCaseCount = useMemo(
    () => csvCases.filter((c) => c.lat != null && c.lng != null && Number.isFinite(c.lat) && Number.isFinite(c.lng)).length,
    [csvCases]
  );

  const totalRows = regionRows.length;

  const spatialMapHtml = useMemo(
    () => buildSpatialMapHtml(csvCases, adminLevel, adminGeoData),
    [adminGeoData, adminLevel, csvCases],
  );

  const activeArchitecturePanel = useMemo(
    () =>
      architectureExplorerPanels.find((panel) => panel.id === activeArchitecturePanelId) ??
      architectureExplorerPanels[0],
    [activeArchitecturePanelId],
  );

  const agentFlowNodes = useMemo<Node<AgentFlowNodeData>[]>(() => {
    const supportActive = new Set(
      agentLogicSupportCards
        .filter((card) => card.related.some((item) => item === activeAgentStageId))
        .map((card) => card.id),
    );

    return [
      {
        id: "entry",
        type: "logic",
        position: { x: 430, y: 32 },
        style: { width: 370 },
        data: {
          chip: "Input Layer",
          title: "用户问题 + 线程上下文",
          description: "当前轮消息、历史线程状态与用户身份一起进入后端编排。",
          badges: ["User Query", "Thread State"],
          kind: "entry",
        },
      },
      {
        id: "intent_route",
        type: "logic",
        position: { x: 492, y: 174 },
        style: { width: 248 },
        data: {
          chip: "Intent Router",
          title: "问题路由",
          description: "区分通用问答快返，或进入参数推理中枢。",
          badges: ["Fast Path", "Reasoning Path"],
          kind: "router",
        },
      },
      {
        id: "general_qa_branch",
        type: "logic",
        position: { x: 40, y: 286 },
        style: { width: 280 },
        data: {
          chip: "General QA Fast Path",
          title: "通用问答支路",
          description: "针对非参数配置类问题，快速整理上下文、调用问答代理并直接返回。",
          badges: ["Prepare", "Agent", "Finalize"],
          items: agentLogicQuickPath.map((step) => ({
            id: step.id,
            title: step.title,
            code: step.code,
            caption: step.text,
          })),
          kind: "branch",
        },
      },
      {
        id: "reasoning_core",
        type: "logic",
        position: { x: 340, y: 250 },
        style: { width: 500 },
        data: {
          chip: "LangGraph Orchestrator",
          title: "推理编排中枢",
          description: "把抽取、确认、检索、综合与质量检查组织成一次完整的后端推理闭环。",
          badges: ["Planner", "GraphRAG", "HITL"],
          items: agentLogicMainPath.map((step) => ({
            id: step.id,
            title: step.title,
            code: step.code,
            caption: step.text,
            active: activeAgentStageId === step.id,
          })),
          kind: "core",
          active: true,
          onActivateStage: setActiveAgentStageId,
        },
      },
      ...agentLogicSupportCards.map((card, index) => ({
        id: card.id,
        type: "logic" as const,
        position: { x: 900, y: 286 + (index * 170) },
        style: { width: 260 },
        data: {
          chip: card.chip,
          title: card.title,
          description: card.text,
          kind: "capability" as const,
          active: supportActive.has(card.id),
        },
      })),
      {
        id: "knowledge_base",
        type: "logic",
        position: { x: 40, y: 636 },
        style: { width: 280 },
        data: {
          chip: "Knowledge Base",
          title: "案例库 + 知识图谱 + 空间线索",
          description: "GraphRAG 会联合相似案例、实体关系与空间线索，为参数推理补足证据。",
          badges: ["案例库", "知识图谱", "空间线索"],
          kind: "knowledge",
        },
      },
      {
        id: "delivery",
        type: "logic",
        position: { x: 358, y: 776 },
        style: { width: 470 },
        data: {
          chip: "Delivery Layer",
          title: "前端展示与线程沉淀",
          description: "把回答、证据、地图/图谱联动与线程状态一起交付前端，方便演示、复核和续聊。",
          badges: ["Answer", "Evidence", "Replay"],
          items: agentLogicOutputs.map((item) => ({
            id: item.id,
            title: item.title,
            caption: item.text,
          })),
          kind: "delivery",
        },
      },
    ];
  }, [activeAgentStageId]);

  const agentFlowEdges = useMemo<Edge[]>(() => {
    const supportActive = new Set(
      agentLogicSupportCards
        .filter((card) => card.related.some((item) => item === activeAgentStageId))
        .map((card) => card.id),
    );

    const muted = {
      stroke: "rgba(148, 163, 184, 0.36)",
      strokeWidth: 1.5,
    };

    const live = {
      stroke: "rgba(99, 102, 241, 0.58)",
      strokeWidth: 1.9,
    };

    const warm = {
      stroke: "rgba(251, 146, 60, 0.54)",
      strokeWidth: 1.8,
    };

    const makeEdge = (
      id: string,
      source: string,
      target: string,
      sourceHandle: string,
      targetHandle: string,
      active = false,
      colorMode: "indigo" | "orange" = "indigo",
    ): Edge => ({
      id,
      source,
      target,
      sourceHandle,
      targetHandle,
      type: "bezier",
      animated: false,
      style: active ? (colorMode === "orange" ? warm : live) : muted,
      markerEnd: active
        ? {
            type: MarkerType.Arrow,
            color: colorMode === "orange" ? warm.stroke : live.stroke,
            width: 16,
            height: 16,
          }
        : undefined,
    });

    return [
      makeEdge("entry-route", "entry", "intent_route", "s-bottom", "t-top", true),
      makeEdge("route-core", "intent_route", "reasoning_core", "s-bottom", "t-top", true),
      makeEdge("route-quick", "intent_route", "general_qa_branch", "s-left", "t-top", false),
      makeEdge("core-tools", "reasoning_core", "tools", "s-right", "t-left", supportActive.has("tools"), "orange"),
      makeEdge("core-hitl", "reasoning_core", "hitl", "s-right", "t-left", supportActive.has("hitl"), "orange"),
      makeEdge("core-state", "reasoning_core", "state", "s-right", "t-left", supportActive.has("state"), "orange"),
      makeEdge("knowledge-tools", "knowledge_base", "tools", "s-right", "t-bottom", false),
      makeEdge("core-delivery", "reasoning_core", "delivery", "s-bottom", "t-top", true),
    ];
  }, [activeAgentStageId]);

  return (
    <div className="index-page">
      <header className="index-header">
        <div className="header-content">
          <a className="logo" href="#intro">GraphRAG Agent</a>
          <nav className="nav-links">
            <a href="#overview">产品能力</a>
            <a href="#architecture">架构设计</a>
            <a href="#demo">演示流程</a>
            <a href="#case-intake">案例抽取</a>
            <a href="#spatial">空间分布</a>
          </nav>
          <div className="header-actions">
            <button
              type="button"
              className={`login-trigger ${currentUser ? "logged-in" : ""}`}
              onClick={() => {
                setLoginError("");
                setIsLoginOpen(true);
              }}
            >
              {currentUser ? `已登录 · ${currentUser.name}` : "用户登录"}
            </button>
            <button className="enter-btn" onClick={handleEnterSystem}>
              进入系统
            </button>
          </div>
        </div>
      </header>

      <main>
        <section id="intro" className="hero-section">
          <div className="hero-content">
            <p className="hero-kicker">PRODUCT DEMO READY</p>
            <h1 className="hero-title">GraphRAG 智能问答与推理演示平台</h1>
            <p className="hero-description">
              {CHAT_TITLE} 面向产品演示场景，支持从问题输入到证据复核的全流程展示。
              你可以在一个页面中演示问答、推理步骤、知识图谱和地图线索。
            </p>
            <div className="runtime-pill-row">
              <span>Frontend :3000</span>
              <span>Runtime :4000</span>
              <span>Agent :8090</span>
            </div>
            <div className="hero-actions">
              <button className="btn-primary" onClick={handleEnterSystem}>
                立即演示
              </button>
              <button className="btn-secondary" onClick={handleJumpToGithub}>
                查看源码
              </button>
            </div>
            <div className="hero-metrics">
              <article>
                <h3>演示友好</h3>
                <p>单入口展示问答与推理全过程</p>
              </article>
              <article>
                <h3>可解释输出</h3>
                <p>结论 + 证据 + 关系链路同步可见</p>
              </article>
              <article>
                <h3>线程化会话</h3>
                <p>支持多轮追问与历史状态恢复</p>
              </article>
            </div>
          </div>
        </section>

        <section id="overview" className="content-section overview-section">
          <div className="section-head">
            <p>产品能力</p>
            <h2>增强参数推理的四层能力</h2>
          </div>
          <div className="module-grid">
            {coreModules.map((module) => (
              <article className="module-card" key={module.id}>
                <h3>{module.title}</h3>
                <p>{module.summary}</p>
                <ul>
                  {module.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section id="architecture" className="content-section architecture-section">
          <div className="section-head architecture-head">
            <p>架构设计</p>
            <h2>面向用户体验的智能问答系统能力</h2>
          </div>

          <div className="architecture-signal-row">
            {architectureSignals.map((signal) => (
              <span key={signal}>{signal}</span>
            ))}
          </div>

          <div className="architecture-explorer">
            <div className="architecture-accordion">
              {architectureExplorerPanels.map((panel) => {
                const isActive = panel.id === activeArchitecturePanel.id;
                return (
                  <article
                    key={panel.id}
                    className={`architecture-accordion-card ${isActive ? "active" : ""}`}
                    style={
                      {
                        "--architecture-accent": panel.accent,
                        "--architecture-soft": panel.soft,
                      } as React.CSSProperties
                    }
                  >
                    <button
                      type="button"
                      className="architecture-accordion-trigger"
                      onClick={() => setActiveArchitecturePanelId(panel.id)}
                    >
                      <span>{panel.title}</span>
                      <span className="architecture-accordion-icon">{isActive ? "−" : "+"}</span>
                    </button>

                    {isActive ? (
                      <div className="architecture-accordion-body">
                        <h3>{panel.headline}</h3>
                        <p>{panel.summary}</p>
                        <div className="architecture-chip-row">
                          {panel.floatingBadges.map((badge) => (
                            <span key={badge}>{badge}</span>
                          ))}
                        </div>
                        <ul>
                          {panel.details.map((detail) => (
                            <li key={detail}>{detail}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>

            <div
              className="architecture-scene"
              style={
                {
                  "--scene-accent": activeArchitecturePanel.accent,
                  "--scene-soft": activeArchitecturePanel.soft,
                } as React.CSSProperties
              }
            >
              <div className="scene-user-layer">
                <div className="scene-layer-chip">用户层</div>
                <div className="scene-user-board">
                  <div className="scene-user-card-grid">
                    {activeArchitecturePanel.surfaceCards.map((card, index) => (
                      <article
                        key={card.title}
                        className={`scene-user-card scene-user-card-${index + 1}`}
                      >
                        <div className="scene-user-card-screen">
                          <span />
                          <span />
                          <span />
                        </div>
                        <strong>{card.title}</strong>
                        <p>{card.caption}</p>
                      </article>
                    ))}
                  </div>
                </div>
              </div>

              <div className="scene-platform-layer">
                
                <svg className="scene-connector-lines" viewBox="0 0 1000 760" preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <marker
                      id="scene-arrow"
                      markerWidth="10"
                      markerHeight="10"
                      refX="8"
                      refY="5"
                      orient="auto"
                      markerUnits="userSpaceOnUse"
                    >
                      <path
                        d="M1 1 L8 5 L1 9"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.25"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </marker>
                  </defs>
                  <circle cx="604" cy="388" r="2.8" className="scene-connector-hub" />
                  <path d="M604 388 C580 310 530 226 468 152" markerEnd="url(#scene-arrow)" />
                  <path d="M604 388 C604 306 604 228 604 152" markerEnd="url(#scene-arrow)" />
                  <path d="M604 388 C628 310 678 226 740 152" markerEnd="url(#scene-arrow)" />
                  <path d="M604 388 C580 468 532 560 480 662" markerEnd="url(#scene-arrow)" />
                  <path d="M604 388 C604 476 604 566 604 662" markerEnd="url(#scene-arrow)" />
                  <path d="M604 388 C628 468 676 560 728 662" markerEnd="url(#scene-arrow)" />
                </svg>

                <div className="scene-platform-rail">
                  {architecturePlatformLayers.map((layer, index) => {
                    const isActive = (activeArchitecturePanel.relatedLayers as readonly string[]).includes(layer.id);
                    return (
                      <button
                        key={layer.id}
                        type="button"
                        className={`scene-platform-pill scene-platform-pill-${index + 1} ${isActive ? "active" : ""}`}
                        onClick={() => setActiveArchitecturePanelId(layer.panelId)}
                      >
                        {layer.title}
                      </button>
                    );
                  })}
                </div>

                <div className="scene-platform-center">
                  
                  <div className="scene-platform-stack">
                    {architecturePlatformLayers.map((layer, index) => {
                      const isActive = (activeArchitecturePanel.relatedLayers as readonly string[]).includes(layer.id);
                      return (
                        <button
                          key={layer.id}
                          type="button"
                          className={`scene-diamond scene-diamond-${index + 1} ${isActive ? "active" : ""}`}
                          onClick={() => setActiveArchitecturePanelId(layer.panelId)}
                        >
                          <strong>{layer.title}</strong>
                          <span>{layer.caption}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="scene-knowledge-layer">
                <div className="scene-layer-chip">知识层</div>

                <div className="scene-knowledge-board">
                  {architectureKnowledgeAssets.map((asset) => (
                      <article
                        key={asset.id}
                        className="scene-knowledge-card"
                      >
                        <strong>{asset.title}</strong>
                        <span>{asset.caption}</span>
                      </article>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="demo" className="content-section workflow-section">
          <div className="section-head">
            <p>演示流程</p>
            <h2>智能体推理流程</h2>
          </div>
          <div className="demo-panel">
            <div className="demo-chat-box">
              <h3>演示脚本片段</h3>
              <p className="chat-line user">用户: 请推荐苏州农作物 Cab 与 LAI 参数区间。</p>
              <p className="chat-line assistant">Agent: 已检索 12 条文献证据，正在进行多步骤参数推理...</p>
              <p className="chat-line assistant">Agent: 已生成参数建议并关联相似区域案例，点击右侧查看图谱与地图。</p>
            </div>
            <div className="demo-checklist">
              <h3>演示观察点</h3>
              <ul>
                <li>步骤进度是否实时更新</li>
                <li>结论是否携带证据来源</li>
                <li>图谱关系与地理分布是否一致</li>
              </ul>
            </div>
          </div>

          <div className="agent-logic-board">
            <div className="agent-logic-header">
              <div>
                <p className="agent-logic-eyebrow">LangGraph Backend</p>
                <h3>后端智能体逻辑框图</h3>
              </div>
              <p>
                后端不是一次性给答案，而是先路由问题，再按分支调用抽取、检索、人工确认和综合回答节点。
              </p>
            </div>

            <div className="agent-logic-meta">
              <span>中央编排中枢</span>
              <span>通用问答快路径</span>
              <span>GraphRAG / 人工确认 / 状态写回</span>
              <span>支持拖动画布与缩放查看</span>
            </div>

            <div className="agent-flow-canvas">
              <ReactFlow
                nodes={agentFlowNodes}
                edges={agentFlowEdges}
                nodeTypes={agentFlowNodeTypes}
                fitView
                fitViewOptions={{ padding: 0.12, maxZoom: 1.05 }}
                minZoom={0.55}
                maxZoom={1.4}
                nodesDraggable={false}
                elementsSelectable={false}
                nodesConnectable={false}
                zoomOnDoubleClick={false}
                proOptions={{ hideAttribution: true }}
              >
                <Background variant={BackgroundVariant.Dots} gap={24} size={1.1} color="#d8e0f2" />
              </ReactFlow>
            </div>
          </div>

          <div className="workflow-track">
            {demoFlow.map((step, index) => (
              <div className="workflow-step" key={step}>
                <div className="step-index">{String(index + 1).padStart(2, "0")}</div>
                <p>{step}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="case-intake" className="content-section case-intake-section">
          <div className="section-head">
            <p>案例抽取</p>
            <h2>手动上传并抽取案例入库</h2>
          </div>

          <div className="case-intake-grid">
            <article className="case-intake-card case-intake-flow-card">
              <div className="case-intake-upload-mock">
                <div className="case-intake-upload-icon">+</div>
                <div>
                  <strong>上传案例材料</strong>
                  <span>支持文档、报告与整理后的案例文件</span>
                </div>
              </div>

              <div className="case-intake-step-list">
                {caseIntakeSteps.map((step, index) => (
                  <div className="case-intake-step" key={step.title}>
                    <div className="case-intake-step-index">{String(index + 1).padStart(2, "0")}</div>
                    <div>
                      <h3>{step.title}</h3>
                      <p>{step.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="case-intake-card case-intake-value-card">
              <div className="case-intake-badge">Case Pipeline</div>
              <h3>把新增案例持续沉淀为系统资产</h3>
              <p>
                这个模块面向日常运营和案例补充场景，让系统不仅能回答问题，也能不断扩充自己的案例基础。
              </p>

              <div className="case-intake-pill-row">
                <span>手动上传</span>
                <span>结构抽取</span>
                <span>案例入库</span>
              </div>

              <ul>
                {caseIntakeBenefits.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          </div>
        </section>

        <section id="spatial" className="content-section spatial-section" ref={spatialSectionRef}>
          <div className="section-head">
            <p>空间分布</p>
            <h2>案例点位地图与省市县分层统计</h2>
          </div>

          <div className="spatial-summary-row">
            <div className="summary-pill">CSV 总案例: {csvCases.length}</div>
            <div className="summary-pill">含坐标案例: {validCaseCount}</div>
            <div className="summary-pill">当前分层统计项: {totalRows}</div>
          </div>

          <div className="spatial-level-switch">
            <button
              className={adminLevel === "province" ? "active" : ""}
              onClick={() => setAdminLevel("province")}
            >
              省级
            </button>
            <button
              className={adminLevel === "city" ? "active" : ""}
              onClick={() => setAdminLevel("city")}
            >
              市级
            </button>
            <button
              className={adminLevel === "county" ? "active" : ""}
              onClick={() => setAdminLevel("county")}
            >
              县级
            </button>
          </div>

          <div className="spatial-grid">
            <article className="spatial-card map-preview-card">
              <h3>案例位置点分布地图</h3>
              <p>使用项目中的省/市/县 GeoJSON 边界，叠加模型案例库参数点位。</p>
              <div className="spatial-map-wrap">
                {!shouldLoadSpatial || isAdminGeoLoading || !spatialMapHtml ? (
                  <div className="empty-cell">地图边界数据加载中...</div>
                ) : (
                  <iframe title="案例空间分布地图" srcDoc={spatialMapHtml} className="spatial-map-iframe" />
                )}
              </div>
            </article>

            <article className="spatial-card spatial-feature-card">
              <h3>{adminLevel === "province" ? "省级" : adminLevel === "city" ? "市级" : "县级"}案例数量统计</h3>
              <p>统计维度自动跟随当前地图分层切换。</p>
              <div className="spatial-table-wrap">
                <table className="spatial-table">
                  <thead>
                    <tr>
                      <th>区域名称</th>
                      <th>案例个数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regionRows.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="empty-cell">暂无可统计数据</td>
                      </tr>
                    ) : (
                      regionRows.map((row) => (
                        <tr key={row.name}>
                          <td>{row.name}</td>
                          <td>{row.count}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        </section>

        <section className="content-section">
          <div className="section-head">
            <p>系统展示</p>
            <h2>现在开始你的使用</h2>
          </div>
          <div className="final-cta">
            {/* <h3>现在开始你的使用</h3> */}
            <p>从首页进入系统即可创建新线程，快速完成一次端到端演示。</p>
            <div className="hero-actions">
              <button className="btn-primary" onClick={handleEnterSystem}>
                进入演示
              </button>
              <button className="btn-secondary" onClick={handleJumpToGithub}>
                阅读源码
              </button>
            </div>
          </div>
        </section>
      </main>

      {isLoginOpen && (
        <div className="index-login-overlay" onClick={() => setIsLoginOpen(false)}>
          <div className="index-login-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="index-login-copy">
              <p className="index-login-eyebrow">USER ACCESS</p>
              <h2>登录后进入对话系统</h2>
              <p>输入用户名即可登录，同一用户名会自动匹配自己的历史记录。</p>
            </div>

            <div className="index-login-form">
              <label htmlFor="index-login-name">用户名</label>
              <input
                id="index-login-name"
                value={loginName}
                onChange={(event) => {
                  setLoginName(event.target.value);
                  if (loginError) setLoginError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    handleLogin(loginName);
                  }
                }}
                placeholder="例如：Demo / Researcher / Alice"
                autoFocus
              />
              {loginError ? <p className="index-login-error">{loginError}</p> : null}
              <div className="index-login-actions">
                <button
                  type="button"
                  className="index-login-cancel"
                  onClick={() => setIsLoginOpen(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="index-login-submit"
                  onClick={() => handleLogin(loginName)}
                >
                  登录
                </button>
              </div>
            </div>

            <div className="index-login-section">
              <p>快捷登录</p>
              <div className="index-login-chip-list">
                {loginSuggestions.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="index-login-chip"
                    onClick={() => handleLogin(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            {users.length > 0 && (
              <div className="index-login-section">
                <p>最近账号</p>
                <div className="index-login-user-list">
                  {users.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      className="index-login-user"
                      onClick={() => handleLogin(user.name)}
                    >
                      <span
                        className="index-login-user-avatar"
                        style={{ backgroundColor: user.avatarColor }}
                      >
                        {user.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="index-login-user-meta">
                        <strong>{user.name}</strong>
                        <small>{user.id}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
