/**
 * 证据链可视化组件
 * 
 * 用于展示 GraphRAG 推理过程中的证据链，支持溯源
 */

import React, { useState } from "react";
import "./EvidenceChain.css";

// ============================================================
// 类型定义
// ============================================================

export interface EvidenceItem {
  step: string;
  source: string;
  evidence: string;
  detail?: string;
}

interface EvidenceChainProps {
  /** 证据链数组 */
  evidenceChain: EvidenceItem[];
  /** 是否默认展开 */
  defaultExpanded?: boolean;
  /** 标题 */
  title?: string;
}

// ============================================================
// 图标选择
// ============================================================

const getStepIcon = (step: string): string => {
  if (step.includes("搜索")) return "🔍";
  if (step.includes("提取")) return "📝";
  if (step.includes("识别")) return "🎯";
  if (step.includes("构建")) return "🏗️";
  if (step.includes("计算")) return "📊";
  if (step.includes("增强")) return "✨";
  if (step.includes("查询")) return "❓";
  if (step.includes("解析")) return "🔬";
  return "🔹";
};

const getStepColor = (step: string): string => {
  if (step.includes("搜索")) return "#2196F3";
  if (step.includes("提取")) return "#4CAF50";
  if (step.includes("识别")) return "#FF9800";
  if (step.includes("构建")) return "#9C27B0";
  if (step.includes("计算")) return "#00BCD4";
  if (step.includes("增强")) return "#E91E63";
  return "#607D8B";
};

// ============================================================
// 子组件
// ============================================================

interface EvidenceNodeProps {
  item: EvidenceItem;
  isLast: boolean;
}

const EvidenceNode: React.FC<EvidenceNodeProps> = ({
  item,
  isLast,
}) => {
  const [expanded, setExpanded] = useState(false);
  const icon = getStepIcon(item.step);
  const color = getStepColor(item.step);

  return (
    <div className="evidence-node">
      {/* 时间线连接线 */}
      <div className="evidence-timeline">
        <div
          className="evidence-dot"
          style={{ borderColor: color, backgroundColor: `${color}20` }}
        >
          <span className="evidence-icon">{icon}</span>
        </div>
        {!isLast && <div className="evidence-line" />}
      </div>

      {/* 内容区域 */}
      <div className="evidence-content">
        <div className="evidence-header" onClick={() => setExpanded(!expanded)}>
          <div className="evidence-step">
            <span className="step-name" style={{ color }}>
              {item.step}
            </span>
            <span className="step-source">({item.source})</span>
          </div>
          {item.detail && (
            <button className="expand-btn">
              {expanded ? "▼" : "▶"}
            </button>
          )}
        </div>

        <div className="evidence-body">
          <p className="evidence-text">{item.evidence}</p>

          {/* 可展开的详情 */}
          {expanded && item.detail && (
            <div className="evidence-detail">
              {item.detail.split("\n").map((line, idx) => (
                <p key={idx} className="detail-line">
                  {line.trim()}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================
// 主组件
// ============================================================

export const EvidenceChain: React.FC<EvidenceChainProps> = ({
  evidenceChain,
  defaultExpanded = false,
  title = "🔗 推理证据链",
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (!evidenceChain || evidenceChain.length === 0) {
    return null;
  }

  return (
    <div className="evidence-chain-container">
      {/* 标题栏 */}
      <div
        className="evidence-chain-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <h3 className="evidence-chain-title">{title}</h3>
        <div className="evidence-chain-meta">
          <span className="evidence-count">{evidenceChain.length} 步骤</span>
          <button className="toggle-btn">{isExpanded ? "收起 ▲" : "展开 ▼"}</button>
        </div>
      </div>

      {/* 证据链内容 */}
      {isExpanded && (
        <div className="evidence-chain-body">
          {evidenceChain.map((item, index) => (
            <EvidenceNode
              key={index}
              item={item}
              isLast={index === evidenceChain.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default EvidenceChain;
