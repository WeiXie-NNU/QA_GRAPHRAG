import React from 'react';
import { createPortal } from 'react-dom';
import './CaseDetailSidebar.css';
import type { GeoPoint } from '../lib/types';
import { getCasePdfDownloadUrl } from '../services/threadService';

interface CaseDetailSidebarProps {
  caseData: GeoPoint | null;
  onClose: () => void;
}

export const CaseDetailSidebar: React.FC<CaseDetailSidebarProps> = ({ caseData, onClose }) => {
  if (!caseData || !caseData.case_details || !caseData.parameters) {
    console.warn('[CaseDetailSidebar] 案例数据不完整:', caseData);
    return null;
  }

  const { case_details, parameters, similarity = 0, match_reason = '' } = caseData;

  // 使用新增的论文标题字段，或从source_file提取
  const paperTitle = case_details.paper_title || case_details.source_file?.replace('.pdf', '') || '未知来源';
  const pdfFilename = case_details.pdf_filename || case_details.source_file || '';
  
  // PDF下载处理
  const handleDownloadPDF = () => {
    const caseId = String((caseData as any)?.id || case_details.case_id || '').trim();
    if (!caseId) return;
    const kgId = String((caseData as any)?.kg_id || '').trim() || undefined;
    const pdfPath = getCasePdfDownloadUrl(caseId, kgId, pdfFilename || undefined);
    
    // 创建临时链接下载
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

  // 使用 Portal 将侧边栏渲染到 body 根节点，避免层叠上下文问题
  return createPortal(
    <div className="case-sidebar-overlay" onClick={onClose}>
      <div className="case-sidebar" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="case-sidebar-header">
          <div className="case-sidebar-title">
            <span className="case-icon">📊</span>
            <h3>案例详情</h3>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        {/* 内容区域 */}
        <div className="case-sidebar-content">
          {/* 案例ID和相似度 */}
          <section className="case-section">
            <div className="case-id-badge">
              <span className="badge-label">案例ID</span>
              <span className="badge-value">{case_details.case_id}</span>
            </div>
            <div className="similarity-badge">
              <span className="similarity-label">相似度</span>
              <span className="similarity-value">{(similarity * 100).toFixed(0)}%</span>
              <div className="similarity-bar">
                <div 
                  className="similarity-fill" 
                  style={{ width: `${similarity * 100}%` }}
                />
              </div>
            </div>
            {match_reason && (
              <div className="match-reason">
                <span className="reason-icon">🎯</span>
                <span>{match_reason}</span>
              </div>
            )}
          </section>

          {/* 区域信息 */}
          <section className="case-section">
            <h4 className="section-title">
              <span className="title-icon">📍</span>
              研究区域
            </h4>
            <div className="info-card">
              <div className="info-item">
                <span className="info-label">区域名称:</span>
                <span className="info-value">{case_details.region_name}</span>
              </div>
              <div className="info-item">
                <span className="info-label">坐标:</span>
                <span className="info-value">
                  {caseData.lat != null ? caseData.lat.toFixed(4) : 'N/A'}°, {caseData.lng != null ? caseData.lng.toFixed(4) : 'N/A'}°
                </span>
              </div>
              {case_details.region_description && (
                <div className="info-item full-width">
                  <span className="info-label">描述:</span>
                  <p className="info-description">{case_details.region_description}</p>
                </div>
              )}
            </div>
          </section>

          {/* 实验信息 */}
          <section className="case-section">
            <h4 className="section-title">
              <span className="title-icon">🔬</span>
              实验信息
            </h4>
            <div className="info-card">
              <div className="info-item">
                <span className="info-label">传感器:</span>
                <span className="info-value sensor-tag">{case_details.sensor_type}</span>
              </div>
              <div className="info-item">
                <span className="info-label">可靠性:</span>
                <span className={`reliability-tag reliability-${case_details.reliability.toLowerCase()}`}>
                  {case_details.reliability}
                </span>
              </div>
              {case_details.description && (
                <div className="info-item full-width">
                  <span className="info-label">描述:</span>
                  <p className="info-description">{case_details.description}</p>
                </div>
              )}
            </div>
          </section>

          {/* 参数配置表格 */}
          <section className="case-section">
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
                        [{param.min != null ? param.min.toFixed(3) : 'N/A'}, {param.max != null ? param.max.toFixed(3) : 'N/A'}]
                      </div>
                      <div className="param-col-unit param-unit">{param.unit || '-'}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>

          {/* 论文信息 */}
          <section className="case-section">
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
      </div>
    </div>,
    document.body
  );
};
