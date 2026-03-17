/**
 * 进度显示组件 - 简洁版
 * 
 * 模仿 open-research-ANA 项目的进度条样式
 * - 简洁的线性布局
 * - 只显示已完成和正在执行的步骤
 * - 每个步骤可折叠
 */

import React, { useState } from "react";
import "./ProgressDisplay.css";

// ============================================================
// 类型定义
// ============================================================

export interface Step {
  description: string;
  status: string;
  updates?: string[];
}

export interface ProgressData {
  steps: Step[];
}

interface ProgressDisplayProps {
  /** 进度数据 */
  progressData: ProgressData;
}

// ============================================================
// 辅助函数：清理 update 文本中的前导勾号
// ============================================================
function cleanUpdateText(text: string): string {
  // 移除开头的 ✓、√、✔ 等勾号和空格
  return text.replace(/^[✓√✔\s]+/, '').trim();
}

// ============================================================
// 主组件
// ============================================================

export const ProgressDisplay: React.FC<ProgressDisplayProps> = ({
  progressData,
}) => {
  // 跟踪每个步骤的展开/折叠状态
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());

  // 空数据检查
  if (!progressData?.steps || progressData.steps.length === 0) {
    return null;
  }

  const visibleSteps = progressData.steps
    .map((step, originalIndex) => ({ step, originalIndex }))
    .filter(({ step }) => {
      const status = step.status;
      return (
        status === "complete" ||
        status === "completed" ||
        status === "running" ||
        status === "executing" ||
        status === "failed" ||
        status === "error"
      );
    });

  if (visibleSteps.length === 0) {
    return null;
  }

  // 切换步骤展开状态
  const toggleStep = (index: number) => {
    setExpandedSteps(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  return (
    <div className="progress-container" data-test-id="progress-steps">
      <div className="progress-list">
        {visibleSteps.map(({ step, originalIndex }, visibleIndex) => {
          // 判断状态
          const isComplete = step.status === "complete" || step.status === "completed";
          const isRunning = step.status === "running" || step.status === "executing";
          const isFailed = step.status === "failed" || step.status === "error";

          // 是否有子更新信息
          const visibleUpdates = (step.updates || [])
            .map(cleanUpdateText)
            .filter(Boolean);
          const hasUpdates = visibleUpdates.length > 0;
          
          // 是否展开（正在运行的默认展开，已完成的默认折叠）
          const isExpanded = expandedSteps.has(originalIndex) || isRunning;
          const isLastVisible = visibleIndex === visibleSteps.length - 1;

          return (
            <div
              key={`${originalIndex}-${step.description}`}
              className={`progress-step ${isComplete ? "done" : ""} ${isRunning ? "running" : ""} ${isFailed ? "failed" : ""}`}
              data-test-id={isComplete ? "progress-step-item_done" : "progress-step-item_loading"}
            >
              {/* 左侧状态指示器 */}
              <div className="step-indicator">
                <div className={`step-circle ${isComplete ? "done" : ""} ${isRunning ? "running" : ""} ${isFailed ? "failed" : ""}`}>
                  {isComplete ? (
                    <svg className="check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  ) : isFailed ? (
                    <span className="error-icon">✕</span>
                  ) : (
                    <div className="spinner"></div>
                  )}
                </div>
                {/* 连接线 */}
                {!isLastVisible && (
                  <div className={`step-line ${isComplete ? "done" : ""}`}></div>
                )}
              </div>

              {/* 右侧内容 */}
              <div className="step-content">
                {/* 标题行 - 可点击折叠 */}
                <div 
                  className={`step-header ${hasUpdates ? "clickable" : ""}`}
                  onClick={() => hasUpdates && toggleStep(originalIndex)}
                >
                  <span className="step-text">{step.description}</span>
                  {hasUpdates && (
                    <span className={`step-toggle ${isExpanded ? "expanded" : ""}`}>
                      ▼
                    </span>
                  )}
                </div>
                
                {/* 子更新信息 - 可折叠 */}
                {hasUpdates && isExpanded && (
                  <div className="step-updates">
                    {visibleUpdates.map((update, idx) => (
                      <div key={idx} className="step-update">
                        <span>{update}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ProgressDisplay;
