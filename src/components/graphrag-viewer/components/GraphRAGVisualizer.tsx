/**
 * GraphRAG Visualizer 主页面组件 (简化版)
 * 
 * 功能：
 * - 从指定路径加载 parquet 文件
 * - 支持多知识图谱切换
 * - 图谱可视化
 */

import React, { useState, useEffect } from "react";
import GraphViewer from "./GraphViewer";
import useFileHandler from "../hooks/useFileHandler";
import useGraphData from "../hooks/useGraphData";
import type { KnowledgeGraphConfig } from "../models/types";
import "./GraphRAGVisualizer.css";

// ============================================================
// 知识图谱配置
// ============================================================

const DEFAULT_KNOWLEDGE_GRAPHS: KnowledgeGraphConfig[] = [
  {
    id: "prosail",
    name: "PROSAIL 辐射传输模型",
    description: "植被辐射传输模型参数知识图谱",
    icon: "🌿",
    basePath: "/kg-data/prosail",
  },
  {
    id: "lue",
    name: "光能利用率模型 (LUE)",
    description: "光能利用率模型参数知识图谱",
    icon: "☀️",
    basePath: "/kg-data/lue",
  },
];

// ============================================================
// 组件 Props
// ============================================================

interface GraphRAGVisualizerProps {
  knowledgeGraphs?: KnowledgeGraphConfig[];
  defaultKnowledgeGraph?: string;
  initialDarkMode?: boolean;
}

// ============================================================
// 主组件
// ============================================================

const GraphRAGVisualizer: React.FC<GraphRAGVisualizerProps> = ({
  knowledgeGraphs = DEFAULT_KNOWLEDGE_GRAPHS,
  defaultKnowledgeGraph,
  initialDarkMode = true,
}) => {
  // ============ 知识图谱选择 ============
  const [selectedKG, setSelectedKG] = useState<string>(
    defaultKnowledgeGraph || knowledgeGraphs[0]?.id || ""
  );
  const [kgDropdownOpen, setKgDropdownOpen] = useState(false);

  // ============ 文件处理 ============
  const {
    entities,
    relationships,
    documents,
    textunits,
    communities,
    communityReports,
    covariates,
    loading,
    error,
    loadFromPath,
    clearData,
  } = useFileHandler();

  // ============ UI 状态 ============
  const [graphType, setGraphType] = useState<"2d" | "3d">("2d");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [darkMode, setDarkMode] = useState(initialDarkMode);

  // ============ 过滤选项 ============
  const [includeDocuments, setIncludeDocuments] = useState(false);
  const [includeTextUnits, setIncludeTextUnits] = useState(false);
  const [includeCommunities, setIncludeCommunities] = useState(false);
  const [includeCovariates, setIncludeCovariates] = useState(false);

  // ============ 计算属性 ============
  const hasDocuments = documents.length > 0;
  const hasTextUnits = textunits.length > 0;
  const hasCommunities = communities.length > 0 || communityReports.length > 0;
  const hasCovariates = covariates.length > 0;
  const hasData = entities.length > 0 || relationships.length > 0;

  const currentKG = knowledgeGraphs.find((kg) => kg.id === selectedKG) || knowledgeGraphs[0];

  // ============ 图数据 ============
  const graphData = useGraphData(
    entities,
    relationships,
    documents,
    textunits,
    communities,
    communityReports,
    covariates,
    { includeDocuments, includeTextUnits, includeCommunities, includeCovariates }
  );

  // ============ 加载知识图谱 ============
  useEffect(() => {
    if (currentKG) {
      loadFromPath(currentKG.basePath);
    }
  }, [selectedKG]);

  // ============ 切换知识图谱 ============
  const handleKGChange = (kgId: string) => {
    setSelectedKG(kgId);
    setKgDropdownOpen(false);
    clearData();
  };

  // ============ 渲染 ============
  return (
    <div className={`grv-page ${darkMode ? "grv-dark" : "grv-light"}`}>
      {/* 顶部导航 */}
      <header className="grv-header">
        <div className="grv-header-left">
          <h1 className="grv-title">GraphRAG Visualizer</h1>

          {/* 知识图谱选择器 */}
          <div className="grv-kg-selector">
            <button
              className="grv-kg-trigger"
              onClick={() => setKgDropdownOpen(!kgDropdownOpen)}
            >
              <span className="grv-kg-icon">{currentKG?.icon}</span>
              <span className="grv-kg-name">{currentKG?.name}</span>
              <span className="grv-kg-arrow">{kgDropdownOpen ? "▲" : "▼"}</span>
            </button>

            {kgDropdownOpen && (
              <div className="grv-kg-dropdown">
                {knowledgeGraphs.map((kg) => (
                  <button
                    key={kg.id}
                    className={`grv-kg-option ${kg.id === selectedKG ? "grv-kg-active" : ""}`}
                    onClick={() => handleKGChange(kg.id)}
                  >
                    <span className="grv-kg-icon">{kg.icon}</span>
                    <div className="grv-kg-info">
                      <span className="grv-kg-name">{kg.name}</span>
                      <span className="grv-kg-desc">{kg.description}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grv-header-right">
          {/* 主题切换 */}
          <button
            className="grv-theme-btn"
            onClick={() => setDarkMode(!darkMode)}
            title={darkMode ? "切换到浅色模式" : "切换到深色模式"}
          >
            {darkMode ? "🌙" : "☀️"}
          </button>
        </div>
      </header>

      {/* 主内容区 */}
      <main className="grv-main">
        {/* 加载状态 */}
        {loading && (
          <div className="grv-loading">
            <div className="grv-spinner"></div>
            <span>加载中...</span>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="grv-error">
            <span>⚠️ {error}</span>
            <button onClick={() => loadFromPath(currentKG.basePath)}>重试</button>
          </div>
        )}

        {/* 图谱视图 */}
        {hasData && !loading && (
          <GraphViewer
            data={graphData}
            graphType={graphType}
            isFullscreen={isFullscreen}
            darkMode={darkMode}
            includeDocuments={includeDocuments}
            includeTextUnits={includeTextUnits}
            includeCommunities={includeCommunities}
            includeCovariates={includeCovariates}
            hasDocuments={hasDocuments}
            hasTextUnits={hasTextUnits}
            hasCommunities={hasCommunities}
            hasCovariates={hasCovariates}
            onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
            onToggleGraphType={() => setGraphType(graphType === "2d" ? "3d" : "2d")}
            onIncludeDocumentsChange={setIncludeDocuments}
            onIncludeTextUnitsChange={setIncludeTextUnits}
            onIncludeCommunitiesChange={setIncludeCommunities}
            onIncludeCovariatesChange={setIncludeCovariates}
          />
        )}

        {/* 空数据提示 */}
        {!hasData && !loading && !error && (
          <div className="grv-empty">
            <span className="grv-empty-icon">📭</span>
            <h3>暂无数据</h3>
            <p>请选择一个知识图谱</p>
          </div>
        )}
      </main>
    </div>
  );
};

export default GraphRAGVisualizer;
