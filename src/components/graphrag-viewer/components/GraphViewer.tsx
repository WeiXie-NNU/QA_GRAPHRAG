/**
 * GraphViewer 组件 (简化版)
 * 移植自 graphrag-visualizer 项目
 */

import React, { Suspense, lazy, useState, useCallback, useEffect, useRef } from "react";
import type Fuse from "fuse.js";
import type { CustomGraphData, CustomNode, CustomLink } from "../models/types";
import "./GraphViewer.css";

// ============================================================
// 类型和常量
// ============================================================

interface GraphViewerProps {
  data: CustomGraphData;
  graphType: "2d" | "3d";
  isFullscreen: boolean;
  darkMode: boolean;
  includeDocuments: boolean;
  includeTextUnits: boolean;
  includeCommunities: boolean;
  includeCovariates: boolean;
  hasDocuments: boolean;
  hasTextUnits: boolean;
  hasCommunities: boolean;
  hasCovariates: boolean;
  onToggleFullscreen: () => void;
  onToggleGraphType: () => void;
  onIncludeDocumentsChange: (value: boolean) => void;
  onIncludeTextUnitsChange: (value: boolean) => void;
  onIncludeCommunitiesChange: (value: boolean) => void;
  onIncludeCovariatesChange: (value: boolean) => void;
}

const loadGraphCanvas2D = () => import("./GraphCanvas2D");
const loadGraphCanvas3D = () => import("./GraphCanvas3D");

const LazyGraphCanvas2D = lazy(() => loadGraphCanvas2D());
const LazyGraphCanvas3D = lazy(() => loadGraphCanvas3D());

const NODE_R = 8;
const loadFuseModule = () => import("fuse.js").then((module) => module.default);

// ============================================================
// 主组件
// ============================================================

const GraphViewer: React.FC<GraphViewerProps> = ({
  data,
  graphType,
  isFullscreen,
  darkMode,
  includeDocuments,
  includeTextUnits,
  includeCommunities,
  includeCovariates,
  hasDocuments,
  hasTextUnits,
  hasCommunities,
  hasCovariates,
  onToggleFullscreen,
  onToggleGraphType,
  onIncludeDocumentsChange,
  onIncludeTextUnitsChange,
  onIncludeCommunitiesChange,
  onIncludeCovariatesChange,
}) => {
  // ============ 状态 ============
  const [highlightNodes, setHighlightNodes] = useState<Set<CustomNode>>(new Set());
  const [highlightLinks, setHighlightLinks] = useState<Set<CustomLink>>(new Set());
  const [hoverNode, setHoverNode] = useState<CustomNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<CustomNode | null>(null);
  const [selectedRelationship, setSelectedRelationship] = useState<CustomLink | null>(null);
  const [linkedNodes, setLinkedNodes] = useState<CustomNode[]>([]);
  const [linkedRelationships, setLinkedRelationships] = useState<CustomLink[]>([]);

  // UI 状态
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<(CustomNode | CustomLink)[]>([]);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  const [bottomDrawerOpen, setBottomDrawerOpen] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [showLinkLabels, setShowLinkLabels] = useState(false);
  const [showHighlight, setShowHighlight] = useState(true);

  const graphRef = useRef<any>();
  const fuseRef = useRef<Fuse<CustomNode | CustomLink> | null>(null);

  const nodeCount = data.nodes.length;
  const linkCount = data.links.length;

  useEffect(() => {
    fuseRef.current = null;
  }, [data]);

  const getSearchIndex = useCallback(async () => {
    if (fuseRef.current) {
      return fuseRef.current;
    }

    const FuseModule = await loadFuseModule();
    const nextFuse = new FuseModule([...data.nodes, ...data.links], {
      keys: ["uuid", "id", "name", "type", "description", "source", "target", "title", "summary"],
      threshold: 0.3,
    });
    fuseRef.current = nextFuse;
    return nextFuse;
  }, [data]);

  // ============ 高亮圆环 ============
  const paintRing = useCallback(
    (node: CustomNode, ctx: CanvasRenderingContext2D) => {
      ctx.beginPath();
      ctx.arc(node.x!, node.y!, NODE_R * 1.4, 0, 2 * Math.PI, false);
      if (highlightNodes.has(node)) {
        ctx.fillStyle = node === hoverNode ? "red" : "orange";
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = "gray";
        ctx.globalAlpha = 0.3;
      }
      ctx.fill();
      ctx.globalAlpha = 1;
    },
    [hoverNode, highlightNodes]
  );

  // ============ 事件处理 ============
  const handleNodeHover = useCallback((node: CustomNode | null) => {
    const newHighlightNodes = new Set<CustomNode>();
    const newHighlightLinks = new Set<CustomLink>();

    if (node) {
      newHighlightNodes.add(node);
      node.neighbors?.forEach((neighbor) => newHighlightNodes.add(neighbor));
      node.links?.forEach((link) => newHighlightLinks.add(link));
    }

    setHighlightNodes(newHighlightNodes);
    setHighlightLinks(newHighlightLinks);
    setHoverNode(node);
  }, []);

  const handleLinkHover = useCallback((link: CustomLink | null) => {
    const newHighlightNodes = new Set<CustomNode>();
    const newHighlightLinks = new Set<CustomLink>();

    if (link) {
      newHighlightLinks.add(link);
      if (typeof link.source !== "string") newHighlightNodes.add(link.source as CustomNode);
      if (typeof link.target !== "string") newHighlightNodes.add(link.target as CustomNode);
    }

    setHighlightNodes(newHighlightNodes);
    setHighlightLinks(newHighlightLinks);
  }, []);

  const handleNodeClick = useCallback((node: CustomNode) => {
    setSelectedRelationship(null);
    setSelectedNode(node);
    setLinkedNodes(node.neighbors || []);
    setLinkedRelationships(node.links || []);
    setBottomDrawerOpen(true);

    // 居中到节点
    if (graphRef.current) {
      if (graphType === "2d") {
        graphRef.current.centerAt(node.x, node.y, 1000);
        graphRef.current.zoom(8, 1000);
      } else {
        graphRef.current.cameraPosition(
          { x: node.x, y: node.y, z: 300 },
          { x: node.x, y: node.y, z: 0 },
          3000
        );
      }
    }

    // 高亮
    const newHighlightNodes = new Set<CustomNode>();
    newHighlightNodes.add(node);
    node.neighbors?.forEach((neighbor) => newHighlightNodes.add(neighbor));
    setHighlightNodes(newHighlightNodes);

    const newHighlightLinks = new Set<CustomLink>();
    node.links?.forEach((link) => newHighlightLinks.add(link));
    setHighlightLinks(newHighlightLinks);
    setHoverNode(node);
  }, [graphType]);

  const handleLinkClick = useCallback((link: CustomLink) => {
    setSelectedRelationship(link);
    setSelectedNode(null);

    const sourceNode = typeof link.source === "object" ? (link.source as CustomNode) : null;
    const targetNode = typeof link.target === "object" ? (link.target as CustomNode) : null;
    setLinkedNodes([sourceNode, targetNode].filter(Boolean) as CustomNode[]);
    setLinkedRelationships([]);
    setBottomDrawerOpen(true);
  }, []);

  // ============ 搜索 ============
  const handleSearch = useCallback(async () => {
    if (!searchTerm.trim()) {
      setSearchResults([]);
      return;
    }

    const fuse = await getSearchIndex();
    const results = fuse.search(searchTerm).map((r) => r.item);
    const nodeResults = results.filter((item): item is CustomNode => "neighbors" in item);
    const linkResults = results.filter(
      (item): item is CustomLink => "source" in item && "target" in item
    );
    setSearchResults([...nodeResults, ...linkResults]);
    setRightDrawerOpen(true);
  }, [getSearchIndex, searchTerm]);

  const handleFocusButtonClick = (node: CustomNode) => {
    const newHighlightNodes = new Set<CustomNode>();
    newHighlightNodes.add(node);
    node.neighbors?.forEach((neighbor) => newHighlightNodes.add(neighbor));
    setHighlightNodes(newHighlightNodes);
    setHoverNode(node);

    if (graphRef.current) {
      if (graphType === "2d") {
        graphRef.current.centerAt(node.x, node.y, 1000);
        graphRef.current.zoom(8, 1000);
      } else {
        graphRef.current.cameraPosition(
          { x: node.x, y: node.y, z: 300 },
          { x: node.x, y: node.y, z: 0 },
          3000
        );
      }
    }

    setRightDrawerOpen(false);
  };

  const warmupAlternateGraph = useCallback(() => {
    if (graphType === "2d") {
      void loadGraphCanvas3D();
      return;
    }

    void loadGraphCanvas2D();
  }, [graphType]);

  const warmupSearchEngine = useCallback(() => {
    void getSearchIndex();
  }, [getSearchIndex]);

  // ============ 渲染函数 ============
  const renderNodeLabel = (node: CustomNode, ctx: CanvasRenderingContext2D) => {
    if (!showLabels) return;

    const label = node.name || "";
    const fontSize = 4;
    const padding = 2;
    ctx.font = `${fontSize}px Sans-Serif`;

    const backgroundColor = darkMode ? "rgba(0, 0, 0, 0.6)" : "rgba(255, 255, 255, 0.7)";
    const textColor = darkMode ? "#ffffff" : "#000000";

    const textWidth = ctx.measureText(label).width;
    const boxWidth = textWidth + padding * 2;
    const boxHeight = fontSize + padding * 2;

    // 绘制背景
    ctx.beginPath();
    const radius = 3;
    ctx.moveTo(node.x! - boxWidth / 2 + radius, node.y! - boxHeight / 2);
    ctx.lineTo(node.x! + boxWidth / 2 - radius, node.y! - boxHeight / 2);
    ctx.quadraticCurveTo(node.x! + boxWidth / 2, node.y! - boxHeight / 2, node.x! + boxWidth / 2, node.y! - boxHeight / 2 + radius);
    ctx.lineTo(node.x! + boxWidth / 2, node.y! + boxHeight / 2 - radius);
    ctx.quadraticCurveTo(node.x! + boxWidth / 2, node.y! + boxHeight / 2, node.x! + boxWidth / 2 - radius, node.y! + boxHeight / 2);
    ctx.lineTo(node.x! - boxWidth / 2 + radius, node.y! + boxHeight / 2);
    ctx.quadraticCurveTo(node.x! - boxWidth / 2, node.y! + boxHeight / 2, node.x! - boxWidth / 2, node.y! + boxHeight / 2 - radius);
    ctx.lineTo(node.x! - boxWidth / 2, node.y! - boxHeight / 2 + radius);
    ctx.quadraticCurveTo(node.x! - boxWidth / 2, node.y! - boxHeight / 2, node.x! - boxWidth / 2 + radius, node.y! - boxHeight / 2);
    ctx.closePath();
    ctx.fillStyle = backgroundColor;
    ctx.fill();

    // 绘制文字
    ctx.fillStyle = textColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, node.x!, node.y!);
  };

  // ============ 渲染 ============
  return (
    <div className={`grv-viewer ${isFullscreen ? "grv-fullscreen" : ""} ${darkMode ? "grv-dark" : ""}`}>
      {/* 控制面板 */}
      <div className="grv-controls">
        <button
          className="grv-search-btn"
          onClick={() => setRightDrawerOpen(true)}
          onMouseEnter={warmupSearchEngine}
          onFocus={warmupSearchEngine}
        >
          🔍 搜索
        </button>
        <button
          className="grv-btn-icon"
          onClick={onToggleGraphType}
          onMouseEnter={warmupAlternateGraph}
          onFocus={warmupAlternateGraph}
        >
          🌐 {graphType === "2d" ? "3D" : "2D"}
        </button>
        <button className="grv-btn-icon" onClick={onToggleFullscreen}>
          {isFullscreen ? "⬜" : "⬛"}
        </button>

        <div className="grv-checkbox-group">
          <label><input type="checkbox" checked={showLabels} onChange={() => setShowLabels(!showLabels)} /> 节点标签</label>
          <label><input type="checkbox" checked={showLinkLabels} onChange={() => setShowLinkLabels(!showLinkLabels)} /> 关系标签</label>
          <label><input type="checkbox" checked={showHighlight} onChange={() => setShowHighlight(!showHighlight)} /> 高亮效果</label>
        </div>

        <div className="grv-checkbox-group">
          {hasDocuments && <label><input type="checkbox" checked={includeDocuments} onChange={() => onIncludeDocumentsChange(!includeDocuments)} /> 文档</label>}
          {hasTextUnits && <label><input type="checkbox" checked={includeTextUnits} onChange={() => onIncludeTextUnitsChange(!includeTextUnits)} /> 文本块</label>}
          {hasCommunities && <label><input type="checkbox" checked={includeCommunities} onChange={() => onIncludeCommunitiesChange(!includeCommunities)} /> 社区</label>}
          {hasCovariates && <label><input type="checkbox" checked={includeCovariates} onChange={() => onIncludeCovariatesChange(!includeCovariates)} /> 协变量</label>}
        </div>
      </div>

      {/* 统计信息 */}
      <div className="grv-stats">
        <span>节点: {nodeCount}</span>
        <span>关系: {linkCount}</span>
      </div>

      {/* 搜索抽屉 */}
      {rightDrawerOpen && (
        <div className="grv-search-drawer">
          <div className="grv-drawer-header">
            <input
              type="text"
              placeholder="搜索节点或关系..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onFocus={warmupSearchEngine}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void handleSearch();
                }
              }}
            />
            <button onClick={() => void handleSearch()}>搜索</button>
            <button onClick={() => setRightDrawerOpen(false)}>✕</button>
          </div>
          <div className="grv-search-results">
            {searchResults.filter((item): item is CustomNode => "neighbors" in item).length > 0 && (
              <div className="grv-result-section">
                <h4>节点</h4>
                {searchResults
                  .filter((item): item is CustomNode => "neighbors" in item)
                  .slice(0, 20)
                  .map((node) => (
                    <div key={node.uuid} className="grv-result-item" onClick={() => handleFocusButtonClick(node)}>
                      <span className="grv-type-badge">{node.type}</span>
                      <span>{node.name}</span>
                    </div>
                  ))}
              </div>
            )}
            {searchResults.filter((item): item is CustomLink => "source" in item && "target" in item).length > 0 && (
              <div className="grv-result-section">
                <h4>关系</h4>
                {searchResults
                  .filter((item): item is CustomLink => "source" in item && "target" in item)
                  .slice(0, 20)
                  .map((link, idx) => (
                    <div key={idx} className="grv-result-item" onClick={() => handleLinkClick(link)}>
                      <span className="grv-type-badge">{link.type}</span>
                      <span>{typeof link.source === "string" ? link.source : (link.source as CustomNode)?.name} → {typeof link.target === "string" ? link.target : (link.target as CustomNode)?.name}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 详情抽屉 */}
      {bottomDrawerOpen && (
        <div className="grv-detail-drawer">
          <div className="grv-drawer-header">
            <h3>{selectedNode ? selectedNode.name : "关系详情"}</h3>
            <button onClick={() => setBottomDrawerOpen(false)}>✕</button>
          </div>
          <div className="grv-detail-content">
            {selectedNode && (
              <>
                <div className="grv-detail-row">
                  <span className="grv-type-badge">{selectedNode.type || "NODE"}</span>
                </div>
                {selectedNode.uuid && <div className="grv-detail-row"><label>UUID:</label><span>{selectedNode.uuid}</span></div>}
                {selectedNode.human_readable_id !== undefined && <div className="grv-detail-row"><label>序号:</label><span>{selectedNode.human_readable_id}</span></div>}
                {selectedNode.description && <div className="grv-detail-row"><label>描述:</label><span>{selectedNode.description}</span></div>}
                {selectedNode.summary && <div className="grv-detail-row"><label>摘要:</label><span>{selectedNode.summary}</span></div>}
                {selectedNode.text && <div className="grv-detail-row"><label>文本:</label><span className="grv-text-content">{selectedNode.text}</span></div>}
                
                {linkedNodes.length > 0 && (
                  <div className="grv-linked-section">
                    <h4>关联节点 ({linkedNodes.length})</h4>
                    {linkedNodes.slice(0, 10).map((n, i) => (
                      <div key={i} className="grv-linked-item" onClick={() => handleNodeClick(n)}>
                        <span className="grv-type-badge-sm">{n.type}</span>
                        <span>{n.name}</span>
                      </div>
                    ))}
                  </div>
                )}
                {linkedRelationships.length > 0 && (
                  <div className="grv-linked-section">
                    <h4>关联关系 ({linkedRelationships.length})</h4>
                    {linkedRelationships.slice(0, 10).map((r, i) => (
                      <div key={i} className="grv-linked-item">
                        <span className="grv-type-badge-sm">{r.type}</span>
                        <span>{typeof r.source === "string" ? r.source : (r.source as CustomNode)?.name} → {typeof r.target === "string" ? r.target : (r.target as CustomNode)?.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {selectedRelationship && (
              <>
                <div className="grv-detail-row"><span className="grv-type-badge">{selectedRelationship.type || "RELATED"}</span></div>
                <div className="grv-detail-row"><label>源:</label><span>{typeof selectedRelationship.source === "string" ? selectedRelationship.source : (selectedRelationship.source as CustomNode)?.name}</span></div>
                <div className="grv-detail-row"><label>目标:</label><span>{typeof selectedRelationship.target === "string" ? selectedRelationship.target : (selectedRelationship.target as CustomNode)?.name}</span></div>
                {selectedRelationship.weight !== undefined && <div className="grv-detail-row"><label>权重:</label><span>{selectedRelationship.weight}</span></div>}
                {selectedRelationship.description && <div className="grv-detail-row"><label>描述:</label><span>{selectedRelationship.description}</span></div>}
              </>
            )}
          </div>
        </div>
      )}

      {/* 图谱 */}
      <Suspense fallback={<div className="grv-loading"><div className="grv-spinner"></div><span>图谱引擎加载中...</span></div>}>
        {graphType === "2d" ? (
          <LazyGraphCanvas2D
            data={data}
            graphRef={graphRef}
            darkMode={darkMode}
            showHighlight={showHighlight}
            showLabels={showLabels}
            showLinkLabels={showLinkLabels}
            highlightNodes={highlightNodes}
            highlightLinks={highlightLinks}
            onNodeHover={handleNodeHover}
            onLinkHover={handleLinkHover}
            onNodeClick={handleNodeClick}
            onLinkClick={handleLinkClick}
            paintRing={paintRing}
            renderNodeLabel={renderNodeLabel}
          />
        ) : (
          <LazyGraphCanvas3D
            data={data}
            graphRef={graphRef}
            darkMode={darkMode}
            showHighlight={showHighlight}
            showLabels={showLabels}
            showLinkLabels={showLinkLabels}
            highlightLinks={highlightLinks}
            onNodeHover={handleNodeHover}
            onLinkHover={handleLinkHover}
            onNodeClick={handleNodeClick}
            onLinkClick={handleLinkClick}
          />
        )}
      </Suspense>
    </div>
  );
};

export default GraphViewer;
