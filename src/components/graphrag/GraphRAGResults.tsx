/**
 * GraphRAG 查询结果显示组件
 * 
 * 显示 Local Search 和 Global Search 的查询结果
 * 
 * 架构优化：
 * - 初始显示摘要信息（从 CopilotKit 状态获取）
 * - 展开时按需从 API 获取完整数据（包括 context_data）
 * - 减少状态同步的数据量
 */

import React, { useState, useCallback } from "react";
import type { GraphRAGResult, GraphRAGResultSummary } from "../../lib/types";
import { getGraphRAGResultById } from "../../services/threadService";
import "./GraphRAGResults.css";

interface GraphRAGResultsProps {
  /** Local Search 结果摘要（从状态获取） */
  localResult?: GraphRAGResultSummary;
  /** Global Search 结果摘要（从状态获取） */
  globalResult?: GraphRAGResultSummary;
}

export const GraphRAGResults: React.FC<GraphRAGResultsProps> = ({
  localResult,
  globalResult,
}) => {
  const [expandedSection, setExpandedSection] = useState<"local" | "global" | null>(null);
  // 缓存完整结果（从 API 获取）
  const [fullResults, setFullResults] = useState<{
    local?: GraphRAGResult;
    global?: GraphRAGResult;
  }>({});
  const [loading, setLoading] = useState<{local: boolean; global: boolean}>({
    local: false,
    global: false,
  });

  if (!localResult && !globalResult) {
    return null;
  }

  // 点击展开时获取完整数据
  const toggleSection = useCallback(async (section: "local" | "global") => {
    // 如果是折叠操作
    if (expandedSection === section) {
      setExpandedSection(null);
      return;
    }

    setExpandedSection(section);

    // 如果已有缓存的完整结果，直接使用
    if (fullResults[section]) {
      return;
    }

    // 获取对应的摘要结果
    const summaryResult = section === "local" ? localResult : globalResult;
    if (!summaryResult?.result_id) {
      // 没有 result_id，无法从 API 获取完整数据
      return;
    }

    // 从 API 获取完整结果
    setLoading(prev => ({ ...prev, [section]: true }));
    try {
      const fullResult = await getGraphRAGResultById(summaryResult.result_id);
      if (fullResult) {
        setFullResults(prev => ({ ...prev, [section]: fullResult }));
      }
    } catch (error) {
      console.error(`获取 ${section} 完整结果失败:`, error);
    } finally {
      setLoading(prev => ({ ...prev, [section]: false }));
    }
  }, [expandedSection, fullResults, localResult, globalResult]);

  const renderResult = (summaryResult: GraphRAGResultSummary, searchType: "local" | "global") => {
    const isExpanded = expandedSection === searchType;
    const isLoading = loading[searchType];
    // 优先使用完整结果，否则使用摘要
    const fullResult = fullResults[searchType];
    const result = fullResult || summaryResult;
    
    return (
      <div className={`graphrag-result ${searchType}`} key={searchType}>
        {/* 标题栏 */}
        <div 
          className="result-header"
          onClick={() => toggleSection(searchType)}
        >
          <div className="header-left">
            <span className="result-icon">
              {searchType === "local" ? "🎯" : "🌐"}
            </span>
            <span className="result-title">
              {searchType === "local" ? "Local Search" : "Global Search"}
            </span>
            <span className="result-badge">
              相关性: {(result.relevance_score * 100).toFixed(0)}%
            </span>
          </div>
          <div className="header-right">
            <span className="expand-icon">{isExpanded ? "▼" : "▶"}</span>
          </div>
        </div>

        {/* 展开内容 */}
        {isExpanded && (
          <div className="result-content">
            {isLoading ? (
              <div className="loading-indicator">
                <span className="spinner">⏳</span> 加载完整数据...
              </div>
            ) : (
              <>
                {/* 查询信息 */}
                <div className="result-section">
                  <h4 className="section-title">📋 查询</h4>
                  <div className="query-text">{result.query}</div>
                </div>

                {/* 响应内容 */}
                <div className="result-section">
                  <h4 className="section-title">💬 响应</h4>
                  <div className="response-text">{result.response}</div>
                </div>

                {/* 上下文数据 - 仅完整结果有 */}
                {fullResult?.context_data && Object.keys(fullResult.context_data).length > 0 && (
                  <div className="result-section">
                    <h4 className="section-title">📊 上下文数据</h4>
                    <div className="context-data">
                      {Object.entries(fullResult.context_data).map(([key, value]) => (
                        <div key={key} className="context-item">
                          <span className="context-key">{key}:</span>
                          <span className="context-value">
                            {Array.isArray(value) 
                              ? `${value.length} 项` 
                              : typeof value === 'object' 
                                ? JSON.stringify(value, null, 2)
                                : String(value)
                            }
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 论文来源 */}
                {fullResult?.context_data?.paper_sources && fullResult.context_data.paper_sources.length > 0 && (
                  <div className="result-section">
                    <h4 className="section-title">📖 论文来源</h4>
                    <div className="paper-sources">
                      {fullResult.context_data.paper_sources.map((paper: any, idx: number) => (
                        <div key={idx} className="paper-source-item">
                          <div className="paper-title">
                            {paper.title || paper.file_name}
                          </div>
                          {paper.authors && (
                            <div className="paper-authors">作者: {paper.authors}</div>
                          )}
                          <div className="paper-meta">
                            {paper.journal && <span className="paper-journal">{paper.journal}</span>}
                            {paper.year && <span className="paper-year">{paper.year}</span>}
                          </div>
                          {paper.doi && (
                            <div className="paper-doi">
                              <a 
                                href={`https://doi.org/${paper.doi}`} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="doi-link"
                              >
                                DOI: {paper.doi}
                              </a>
                            </div>
                          )}
                          {paper.citation && (
                            <div className="paper-citation">
                              引用格式: {paper.citation}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 来源文档ID（保留但折叠） */}
                {fullResult?.source_documents && fullResult.source_documents.length > 0 && (
                  <details className="result-section source-documents-details">
                    <summary className="section-title">📚 来源文档 ({fullResult.source_documents.length})</summary>
                    <ul className="source-list">
                      {fullResult.source_documents.map((doc, idx) => (
                        <li key={idx} className="source-item">{doc}</li>
                      ))}
                    </ul>
                  </details>
                )}

                {/* 元数据 */}
                <div className="result-meta">
                  <span className="meta-item">⏱ {result.execution_time.toFixed(2)}s</span>
                  {fullResult?.token_usage !== undefined && (
                    <span className="meta-item">🎫 {fullResult.token_usage} tokens</span>
                  )}
                  {summaryResult.result_id && !fullResult && (
                    <span className="meta-item hint">💡 展开查看完整数据</span>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="graphrag-results-container">
      <div className="results-header">
        <h3>🔍 GraphRAG 查询结果</h3>
      </div>
      <div className="results-list">
        {localResult && renderResult(localResult, "local")}
        {globalResult && renderResult(globalResult, "global")}
      </div>
    </div>
  );
};

export default GraphRAGResults;
