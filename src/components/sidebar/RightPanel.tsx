import React, { useState, useEffect } from 'react';
import './RightPanel.css';
import type { GeoPoint, GraphRAGResultSummary, GraphRAGResult } from '../../lib/types';
import { getCaseFullDetails, getCasePdfDownloadUrl, getGraphRAGResultById } from '../../services/threadService';
import { useDrawer } from '../../contexts';

// ============================================================
// 右侧面板内容类型定义
// ============================================================

export type PanelContentType = 
  | 'case-detail'      // 案例详情
  | 'local-search'     // Local Search 结果
  | 'global-search'    // Global Search 结果
  | 'evidence'         // 引用证据链
  | 'region-cases';    // 区域案例列表

export interface PanelContent {
  type: PanelContentType;
  title?: string;      // 可选标题，会根据类型自动生成
  data: any;
}

interface RightPanelProps {
  isOpen: boolean;
  content: PanelContent | null;
  onClose: () => void;
}

// ============================================================
// 辅助函数：根据类型获取图标
// ============================================================

function getIconForType(type: PanelContentType): string {
  switch (type) {
    case 'case-detail': return '📊';
    case 'local-search': return '🔍';
    case 'global-search': return '🌐';
    case 'evidence': return '📚';
    case 'region-cases': return '🗺️';
    default: return '📄';
  }
}

// 根据类型获取默认标题
function getTitleForType(type: PanelContentType): string {
  switch (type) {
    case 'case-detail': return '案例详情';
    case 'local-search': return 'Local Search';
    case 'global-search': return 'Global Search';
    case 'evidence': return '引用证据';
    case 'region-cases': return '区域案例';
    default: return '详情';
  }
}

// ============================================================
// 右侧面板主组件（嵌入式布局，非浮动）
// ============================================================

export const RightPanel: React.FC<RightPanelProps> = ({ 
  isOpen, 
  content, 
  onClose 
}) => {
  const renderContent = () => {
    if (!content) {
      return (
        <div className="panel-empty-state">
          <div className="empty-icon">📋</div>
          <p>点击消息中的按钮查看详情</p>
          <ul className="empty-hints">
            <li><span className="hint-icon">🔍</span> Local Search - 查看实体检索结果</li>
            <li><span className="hint-icon">🌐</span> Global Search - 查看社区分析</li>
            <li><span className="hint-icon">📊</span> 案例详情 - 查看参考案例</li>
          </ul>
        </div>
      );
    }

    switch (content.type) {
      case 'case-detail':
        return <CaseDetailContent data={content.data} />;
      case 'local-search':
        // 用 key 强制组件在 result_id 变化时重新挂载
        return <LocalSearchContent key={content.data?.result_id} data={content.data} />;
      case 'global-search':
        return <GlobalSearchContent key={content.data?.result_id} data={content.data} />;
      case 'evidence':
        return <EvidenceContent data={content.data} />;
      case 'region-cases':
        return <RegionCasesContent data={content.data} />;
      default:
        return <div className="panel-empty">未知内容类型</div>;
    }
  };

  // 获取显示标题
  const displayTitle = content?.title || (content ? getTitleForType(content.type) : '引用');

  return (
    <aside className={`right-panel ${isOpen ? 'open' : 'closed'}`}>
      {/* 面板头部 */}
      <div className="panel-header">
        <div className="panel-title">
          {content ? (
            <>
              <span className="panel-icon">{getIconForType(content.type)}</span>
              <h3>{displayTitle}</h3>
            </>
          ) : (
            <>
              <span className="panel-icon">📋</span>
              <h3>引用</h3>
            </>
          )}
        </div>
        <button 
          className="panel-close-btn" 
          onClick={onClose} 
          aria-label="关闭面板"
          title="关闭面板"
        >
          ✕
        </button>
      </div>

      {/* 面板内容 */}
      <div className="panel-body">
        {renderContent()}
      </div>
    </aside>
  );
};

// ============================================================
// 案例详情内容组件
// ============================================================

interface CaseDetailContentProps {
  data: GeoPoint;
}

const CaseDetailContent: React.FC<CaseDetailContentProps> = ({ data }) => {
  const { openDrawer } = useDrawer();
  const { case_details, parameters } = data;
  const backContent = (data as any)?.__backContent as PanelContent | undefined;

  if (!case_details || !parameters) {
    return <div className="panel-empty">案例数据不完整</div>;
  }

  const paperTitle = case_details.paper_title || case_details.source_file?.replace('.pdf', '') || '未知来源';
  const pdfFilename = case_details.pdf_filename || case_details.source_file || '';
  
  const handleDownloadPDF = () => {
    const caseId = String((data as any)?.id || case_details.case_id || '').trim();
    if (!caseId) return;
    const kgId = String((data as any)?.kg_id || '').trim() || undefined;
    const pdfPath = getCasePdfDownloadUrl(caseId, kgId, pdfFilename || undefined);
    const link = document.createElement('a');
    link.href = pdfPath;
    link.download = pdfFilename || `${caseId}.pdf`;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 按类别分组参数
  const paramsByCategory: { [key: string]: typeof parameters } = {};
  parameters.forEach(param => {
    const category = param.category || '其他';
    if (!paramsByCategory[category]) {
      paramsByCategory[category] = [];
    }
    paramsByCategory[category].push(param);
  });

  const latText = typeof data.lat === 'number' ? `${data.lat.toFixed(4)}°` : '-';
  const lngText = typeof data.lng === 'number' ? `${data.lng.toFixed(4)}°` : '-';

  return (
    <div className="case-detail-content">
      {backContent && (
        <button
          className="rc-back-btn"
          onClick={() => openDrawer(backContent)}
          title="返回区域案例列表"
        >
          ← 返回案例列表
        </button>
      )}
      {/* 案例ID和相似度 */}
      <section className="panel-section">
        <div className="case-id-badge">
          <span className="badge-label">案例ID</span>
          <span className="badge-value">{case_details.case_id}</span>
        </div>
      </section>

      {/* 区域信息 */}
      <section className="panel-section">
        <h4 className="section-title">
          <span className="title-icon">📍</span>
          研究区域
        </h4>
        <div className="info-card">
          <div className="info-item">
            <span className="info-label">区域名称</span>
            <span className="info-value">{case_details.region_name}</span>
          </div>
          <div className="info-item">
            <span className="info-label">坐标</span>
            <span className="info-value">{latText}, {lngText}</span>
          </div>
          {case_details.region_description && (
            <div className="info-item full-width">
              <span className="info-label">描述</span>
              <p className="info-description">{case_details.region_description}</p>
            </div>
          )}
        </div>
      </section>

      {/* 实验信息 */}
      <section className="panel-section">
        <h4 className="section-title">
          <span className="title-icon">🔬</span>
          实验信息
        </h4>
        <div className="info-card">
          <div className="info-item">
            <span className="info-label">传感器</span>
            <span className="info-value sensor-tag">{case_details.sensor_type}</span>
          </div>
          <div className="info-item">
            <span className="info-label">可靠性</span>
            <span className={`reliability-tag reliability-${case_details.reliability.toLowerCase()}`}>
              {case_details.reliability}
            </span>
          </div>
          {case_details.description && (
            <div className="info-item full-width">
              <span className="info-label">描述</span>
              <p className="info-description">{case_details.description}</p>
            </div>
          )}
        </div>
      </section>

      {/* 参数配置 */}
      <section className="panel-section">
        <h4 className="section-title">
          <span className="title-icon">⚙️</span>
          PROSAIL参数配置
          <span className="param-count">{parameters.length}个</span>
        </h4>
        
        {Object.entries(paramsByCategory).map(([category, params]) => (
          <div key={category} className="param-category">
            <div className="category-header">{category}</div>
            <div className="param-table">
              <div className="param-table-header">
                <div className="param-col-name">参数</div>
                <div className="param-col-range">范围</div>
                <div className="param-col-unit">单位</div>
              </div>
              {params.map((param, idx) => (
                <div key={idx} className="param-table-row">
                  <div className="param-col-name param-name">{param.name}</div>
                  <div className="param-col-range param-range">
                    [{param.min?.toFixed(3) ?? 'N/A'}, {param.max?.toFixed(3) ?? 'N/A'}]
                  </div>
                  <div className="param-col-unit param-unit">{param.unit || '-'}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* 论文信息 */}
      <section className="panel-section">
        <h4 className="section-title">
          <span className="title-icon">📄</span>
          论文来源
        </h4>
        <div className="paper-card">
          <div className="paper-title">{paperTitle}</div>
          <div className="paper-actions">
            <div className="paper-file">
              <span className="file-icon">📎</span>
              <span className="file-name">{pdfFilename}</span>
            </div>
            {pdfFilename && (
              <button 
                className="download-pdf-btn"
                onClick={handleDownloadPDF}
                title="下载PDF"
              >
                <span className="download-icon">⬇️</span>
                下载PDF
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

// ============================================================
// GraphRAG 搜索结果通用组件
// ============================================================

interface SearchContentProps {
  data: GraphRAGResultSummary;
  type: 'local' | 'global';
}

const SearchContent: React.FC<SearchContentProps> = ({ data, type }) => {
  const [fullResult, setFullResult] = useState<GraphRAGResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!data?.result_id) return;
    setLoading(true);
    getGraphRAGResultById(data.result_id)
      .then(result => setFullResult(result))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [data?.result_id]);

  if (!data) {
    return <div className="panel-empty">暂无 {type === 'local' ? 'Local' : 'Global'} Search 结果</div>;
  }

  const contextData = fullResult?.context_data;
  const entities = type === 'local'
    ? (contextData?.entities || contextData?.matched_entities || [])
    : [];
  const relationships = type === 'local'
    ? (contextData?.relationships || contextData?.matched_relationships || [])
    : [];
  const reports = type === 'global'
    ? (contextData?.reports || contextData?.matched_reports || contextData?.communities || [])
    : [];

  return (
    <div className="search-content">
      {/* 摘要信息 */}
      <div className="search-summary">
        <div className="summary-item">
          <span className="summary-label">相关性</span>
          <span className="summary-value">{((fullResult?.relevance_score ?? data.relevance_score) * 100).toFixed(0)}%</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">执行时间</span>
          <span className="summary-value">{(fullResult?.execution_time ?? data.execution_time)?.toFixed(2)}s</span>
        </div>
        {fullResult?.token_usage && (
          <div className="summary-item">
            <span className="summary-label">Token 消耗</span>
            <span className="summary-value">{fullResult.token_usage}</span>
          </div>
        )}
      </div>

      {/* 查询内容 */}
      <section className="panel-section">
        <h4 className="section-title">
          <span className="title-icon">{type === 'local' ? '🔍' : '🌐'}</span>
          查询
        </h4>
        <div className="query-box">{fullResult?.query || data.query}</div>
      </section>

      {/* 响应内容 */}
      <section className="panel-section">
        <h4 className="section-title">
          <span className="title-icon">💬</span>
          响应
        </h4>
        <div className="response-box">{fullResult?.response || data.response}</div>
      </section>

      {/* 加载状态 */}
      {loading && (
        <div className="loading-indicator">
          <span className="spinner">⏳</span> 加载{type === 'local' ? '实体' : '社区报告'}数据...
        </div>
      )}

      {/* Local Search: 实体列表 */}
      {entities.length > 0 && (
        <section className="panel-section">
          <h4 className="section-title">
            <span className="title-icon">🏷️</span>
            检索到的实体
            <span className="param-count">{entities.length}个</span>
          </h4>
          <div className="entity-list">
            {entities.map((entity: any, idx: number) => (
              <div key={idx} className="entity-card">
                <div className="entity-header">
                  <span className="entity-name">{entity.name || entity.title}</span>
                  <span className="entity-type">{entity.type || entity.entity_type}</span>
                </div>
                {entity.description && (
                  <p className="entity-description">{entity.description}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Local Search: 关系列表 */}
      {relationships.length > 0 && (
        <section className="panel-section">
          <h4 className="section-title">
            <span className="title-icon">🔗</span>
            实体关系
            <span className="param-count">{relationships.length}条</span>
          </h4>
          <div className="relationship-list">
            {relationships.map((rel: any, idx: number) => (
              <div key={idx} className="relationship-card">
                <div className="rel-nodes">
                  <span className="rel-source">{rel.source}</span>
                  <span className="rel-arrow">→</span>
                  <span className="rel-target">{rel.target}</span>
                </div>
                {rel.description && (
                  <p className="rel-description">{rel.description}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Global Search: 社区报告 */}
      {reports.length > 0 && (
        <section className="panel-section">
          <h4 className="section-title">
            <span className="title-icon">📊</span>
            社区分析报告
            <span className="param-count">{reports.length}份</span>
          </h4>
          <div className="community-list">
            {reports.map((report: any, idx: number) => (
              <div key={idx} className="community-card">
                <div className="community-header">
                  <span className="community-id">报告 {idx + 1}</span>
                  {report.rating && (
                    <span className="community-rating">评分: {report.rating}</span>
                  )}
                </div>
                <h5 className="community-title">{report.title}</h5>
                <p className="community-summary">{report.summary || report.content}</p>
                {report.findings?.length > 0 && (
                  <div className="community-findings">
                    <div className="findings-header">主要发现</div>
                    <ul className="findings-list">
                      {report.findings.slice(0, 5).map((finding: string, fIdx: number) => (
                        <li key={fIdx}>{finding}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

// 为兼容性保留的别名组件
const LocalSearchContent: React.FC<{ data: GraphRAGResultSummary }> = ({ data }) => (
  <SearchContent data={data} type="local" />
);

const GlobalSearchContent: React.FC<{ data: GraphRAGResultSummary }> = ({ data }) => (
  <SearchContent data={data} type="global" />
);

// ============================================================
// 引用证据内容组件
// ============================================================

interface EvidenceContentProps {
  data: any[];
}

const EvidenceContent: React.FC<EvidenceContentProps> = ({ data }) => {
  if (!data || data.length === 0) {
    return <div className="panel-empty">暂无引用证据</div>;
  }

  return (
    <div className="evidence-content">
      <section className="panel-section">
        <h4 className="section-title">
          <span className="title-icon">📚</span>
          证据链
          <span className="param-count">{data.length}条</span>
        </h4>
        <div className="evidence-chain">
          {data.map((item: any, idx: number) => (
            <div key={idx} className="evidence-item">
              <div className="evidence-timeline">
                <div className="evidence-dot">
                  <span className="evidence-number">{idx + 1}</span>
                </div>
                {idx < data.length - 1 && <div className="evidence-line" />}
              </div>
              <div className="evidence-body">
                <div className="evidence-header">
                  <span className="evidence-step">{item.step}</span>
                  <span className="evidence-source">{item.source}</span>
                </div>
                <p className="evidence-text">{item.evidence}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

// ============================================================
// 区域案例列表内容组件
// ============================================================

interface RegionCsvCase {
  caseId?: string;
  title: string;
  province: string;
  siteName: string;
  time: string;
  vegetation: string;
  lat: number | null;
  lng: number | null;
  lai: string;
  cab: string;
}

interface RegionCasesData {
  name: string;
  level: string;
  cases: RegionCsvCase[];
  geoPoints: GeoPoint[];
}

const RegionCasesContent: React.FC<{ data: RegionCasesData }> = ({ data }) => {
  const { openDrawer } = useDrawer();
  const { name, level, cases = [], geoPoints = [] } = data;

  const levelLabel = level === 'province' ? '省级' : level === 'city' ? '市级' : '县级';

  const handleCaseClick = async (csvCase: RegionCsvCase) => {
    const backContent: PanelContent = {
      type: 'region-cases',
      title: `${name}的建模案例`,
      data,
    };
    const defaultKgId = geoPoints[0]?.kg_id || "prosail";

    if (csvCase.caseId) {
      const fullByCaseId = await getCaseFullDetails(csvCase.caseId, defaultKgId);
      if (fullByCaseId?.case_details && fullByCaseId?.parameters) {
        openDrawer({
          type: 'case-detail',
          title: '案例详情',
          data: { ...fullByCaseId, __backContent: backContent } as any,
        });
        return;
      }
    }

    const norm = (s: string) => (s || "").replace(/\s+/g, "").toLowerCase();
    const csvTitleNorm = norm(csvCase.title || "");
    const csvSiteNorm = norm(csvCase.siteName || "");
    const csvProvNorm = norm(csvCase.province || "");

    const byTitle = geoPoints.find((pt) => {
      const ptTitle = norm(pt.case_details?.paper_title || pt.name || "");
      if (!ptTitle || !csvTitleNorm) return false;
      return ptTitle.includes(csvTitleNorm.slice(0, 14)) || csvTitleNorm.includes(ptTitle.slice(0, 14));
    });

    const byCoord =
      csvCase.lat != null && csvCase.lng != null
        ? geoPoints.find(
            (pt) =>
              Math.abs((pt.lat ?? 0) - csvCase.lat!) < 1e-4 &&
              Math.abs((pt.lng ?? 0) - csvCase.lng!) < 1e-4
          )
        : undefined;

    const byRegion = geoPoints.find((pt) => {
      const ptNameNorm = norm(pt.name || "");
      return (
        (!!csvSiteNorm && ptNameNorm.includes(csvSiteNorm)) ||
        (!!csvProvNorm && ptNameNorm.includes(csvProvNorm))
      );
    });

    const matched = byTitle || byCoord || byRegion;
    if (!matched) {
      window.alert("未找到该案例详情，请稍后重试。");
      return;
    }

    const fullData = await getCaseFullDetails(matched.id, matched.kg_id);
    const merged = { ...matched, ...(fullData || {}) };
    if (merged?.case_details && merged?.parameters) {
      openDrawer({
        type: 'case-detail',
        title: '案例详情',
        data: { ...merged, __backContent: backContent } as any,
      });
      return;
    }

    window.alert("案例详情加载失败，请稍后重试。");
  };

  return (
    <div className="rc-list-view">
      {/* 区域信息条 */}
      <div className="rc-region-bar">
        <span className="rc-level-badge">{levelLabel}</span>
        <span className="rc-region-name">{name}</span>
        <span className="rc-count">{cases.length} 条</span>
      </div>

      {cases.length === 0 ? (
        <div className="panel-empty">
          <div className="empty-icon">🔍</div>
          <p>该区域暂无建模案例记录</p>
        </div>
      ) : (
        <div className="rc-cases">
          {cases.map((c, i) => {
            const hasGeoPoint = geoPoints.some((pt) => {
              const ptTitle = pt.case_details?.paper_title || pt.name || '';
              const shortKey = (c.title || '').slice(0, 12);
              return shortKey && ptTitle.includes(shortKey);
            });
            return (
              <div
                key={i}
                className={`rc-case-card ${hasGeoPoint ? 'rc-has-detail' : ''}`}
                onClick={() => handleCaseClick(c)}
                title={hasGeoPoint ? '点击查看完整案例详情' : '点击尝试匹配并查看详情'}
              >
                <div className="rc-case-index">{i + 1}</div>
                <div className="rc-case-body">
                  <div className="rc-case-title">{c.title}</div>
                  <div className="rc-case-meta">
                    {c.siteName && <span>📍 {c.siteName}</span>}
                    {c.vegetation && <span>🌿 {c.vegetation}</span>}
                    {c.time && <span>📅 {c.time}</span>}
                  </div>
                  {(c.lai || c.cab) && (
                    <div className="rc-case-params">
                      {c.lai && <span>LAI: {c.lai}</span>}
                      {c.cab && <span>Cab: {c.cab}</span>}
                    </div>
                  )}
                </div>
                <div className="rc-case-arrow">📊</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default RightPanel;
