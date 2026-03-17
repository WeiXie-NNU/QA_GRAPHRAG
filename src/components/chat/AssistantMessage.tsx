/**
 * 自定义助手消息渲染组件
 * 
 * 处理消息中的特殊标记，渲染进度条、地图、Markdown、证据链等内容
 * GraphRAG结果通过按钮在右侧面板显示，案例分布图在回答末尾显示
 * 
 * 多轮对话支持：每条消息包含其对应的 Agent 数据 ID，
 * 点击按钮时根据该 ID 从数据库获取正确的结果
 * 
 * 数据格式: <!-- AGENT_DATA:local_id:global_id:geo_data_id -->
 */

import React, { Suspense, lazy, memo, useCallback, useEffect, useMemo, useState } from "react";
import type { ProgressData } from "../progress";
import type { EvidenceItem } from "../evidence";
import { useAgent, useDrawer } from "../../contexts";
import { useViewportActivation } from "../../hooks/useViewportActivation";
import {
  parseAgentState,
  removeAgentStateMarker,
  parseAgentDataIds,
  removeAgentDataMarker,
} from "../../lib/utils";
import { getGeoDataById } from "../../services/threadService";
import type { GraphRAGResultSummary, GeoPoint } from "../../lib/types";
import "./AssistantMessage.css";

const LazyGeoVisualization = lazy(() =>
  import("../geo").then((module) => ({ default: module.GeoVisualization }))
);
const LazyMarkdownMessage = lazy(() => import("./MarkdownMessage"));
const LazyProgressDisplay = lazy(() =>
  import("../progress").then((module) => ({ default: module.ProgressDisplay }))
);
const LazyEvidenceChain = lazy(() =>
  import("../evidence").then((module) => ({ default: module.EvidenceChain }))
);

const LONG_MESSAGE_THRESHOLD = 800;
const RICH_PANEL_IDLE_TIMEOUT = 300;

// ============================================================
// 类型定义
// ============================================================

interface AssistantMessageProps {
  /** 消息对象 */
  message: {
    content?: string;
    toolCalls?: unknown[];
  };
  /** 是否正在加载 */
  isLoading?: boolean;
  /** 是否正在流式生成 */
  isGenerating?: boolean;
  /** 子组件（如 action 渲染结果） */
  subComponent?: React.ReactNode;
  /** 是否当前正在交互的消息（CopilotKit 注入） */
  isCurrentMessage?: boolean;
}

// 扩展 AgentState 类型
interface AgentState extends ProgressData {
  evidence_chain?: EvidenceItem[];
}

interface AssistantMessageBaseProps extends AssistantMessageProps {
  runtimeState?: any;
  runtimeRunning?: boolean;
}

// ============================================================
// 主组件
// ============================================================

const AssistantMessageBase: React.FC<AssistantMessageBaseProps> = ({
  message,
  isLoading,
  isGenerating,
  subComponent,
  isCurrentMessage,
  runtimeState,
  runtimeRunning,
}) => {
  const contextState = runtimeState;
  
  // 从 DrawerContext 获取打开面板的方法
  const { openDrawer } = useDrawer();
  
  const content = useMemo(
    () => (typeof message?.content === "string" ? message.content : ""),
    [message?.content]
  );
  const isStreaming = !!isLoading || !!isGenerating;
  const { ref: activationRef, isActive: isNearViewport } = useViewportActivation<HTMLDivElement>({
    enabled: !isCurrentMessage && !isStreaming,
    rootMargin: "600px 0px",
  });
  const shouldActivateRichContent = !!isCurrentMessage || isStreaming || isNearViewport;
  const hasToolCalls = Array.isArray(message?.toolCalls) && message.toolCalls.length > 0;

  // 解析各种类型的内容
  const agentState = useMemo(() => parseAgentState(content) as AgentState | null, [content]);
  
  // 解析消息中的 Agent 数据 ID
  // 格式: <!-- AGENT_DATA:local_id:global_id:geo_data_id -->
  const agentDataIds = useMemo(() => parseAgentDataIds(content), [content]);

  // 存储从 API 获取的 geo_points
  const [messageGeoPoints, setMessageGeoPoints] = useState<GeoPoint[] | null>(null);
  const [isLoadingGeoData, setIsLoadingGeoData] = useState(false);
  const [loadedGeoDataId, setLoadedGeoDataId] = useState<string | null>(null);

  useEffect(() => {
    setMessageGeoPoints(null);
    setIsLoadingGeoData(false);
    setLoadedGeoDataId(null);
  }, [agentDataIds?.geoDataId]);

  // 当消息包含 geoDataId 时，从 API 获取 geo_points
  useEffect(() => {
    const geoDataId = agentDataIds?.geoDataId;
    if (!geoDataId || isLoading || !shouldActivateRichContent || loadedGeoDataId === geoDataId) {
      return;
    }

    let canceled = false;
    setIsLoadingGeoData(true);
    getGeoDataById(geoDataId)
      .then((data) => {
        if (canceled) return;
        setMessageGeoPoints(data?.geo_points || []);
        setLoadedGeoDataId(geoDataId);
      })
      .catch((err) => {
        if (canceled) return;
        console.error("获取地图数据失败:", err);
      })
      .finally(() => {
        if (!canceled) {
          setIsLoadingGeoData(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [agentDataIds?.geoDataId, isLoading, loadedGeoDataId, shouldActivateRichContent]);

  // 移除标记后的纯文本内容
  const textContent = useMemo(
    () => removeAgentDataMarker(removeAgentStateMarker(content)),
    [content]
  );
  const [enableRichText, setEnableRichText] = useState(false);
  const [enableRichPanels, setEnableRichPanels] = useState(false);

  const hasPersistedProgress = !!agentState?.steps?.length;
  const hasRuntimeActiveStep = !!contextState?.steps?.some((step: any) => {
    const status = step?.status;
    return status === "running" || status === "executing";
  });
  const shouldRenderRuntimeProgress = !!isCurrentMessage;
  const runtimeProgressData =
    !hasPersistedProgress &&
    shouldRenderRuntimeProgress &&
    (isLoading || runtimeRunning) &&
    hasRuntimeActiveStep &&
    contextState?.steps?.length
      ? { steps: contextState.steps }
      : null;
  const progressData = agentState || runtimeProgressData;

  // 判断是否有实际内容需要显示
  const hasTextContent = textContent && textContent.length > 0;
  const hasAgentState = !!progressData?.steps?.length;
  const hasSubComponent = !!subComponent;
  const hasEvidenceChain = hasAgentState && agentState?.evidence_chain && agentState.evidence_chain.length > 0;
  
  // 判断是否显示 GraphRAG 按钮
  // - 已完成的消息 (isLoading=false)：只有消息中包含 AGENT_DATA 标记才显示
  // - 正在加载的消息 (isLoading=true)：使用全局状态判断
  // 这样可以避免历史消息都显示按钮并都指向同一个结果
  const hasLocalResult = isLoading 
    ? !!contextState?.local_rag_result 
    : !!agentDataIds?.localResultId;
  const hasGlobalResult = isLoading 
    ? !!contextState?.global_rag_result 
    : !!agentDataIds?.globalResultId;
  const hasGraphRAGResults = hasLocalResult || hasGlobalResult;
  
  // 判断是否显示地图
  // - 实时加载中 (isLoading=true)：不显示地图（geo_points 不再通过状态同步以减少 payload）
  // - 已完成消息 (isLoading=false)：从 API 获取该消息绑定的 geo_points 并显示
  // 注意：contextState?.geo_points 在新架构下始终为 undefined
  const geoPointsToDisplay = isStreaming ? undefined : messageGeoPoints;
  const hasGeoPoints = geoPointsToDisplay && geoPointsToDisplay.length > 0;
  const hasGeoDataId = !!agentDataIds?.geoDataId;
  const shouldDelayRichText = !isStreaming && textContent.length >= LONG_MESSAGE_THRESHOLD;
  const shouldUsePlainText = isStreaming || !enableRichText;
  const hasDeferredPanels = hasAgentState || hasEvidenceChain;

  useEffect(() => {
    if (!textContent) {
      setEnableRichText(false);
      return;
    }

    if (!shouldActivateRichContent) {
      setEnableRichText(false);
      return;
    }

    if (isStreaming) {
      setEnableRichText(false);
      return;
    }

    if (!shouldDelayRichText) {
      setEnableRichText(true);
      return;
    }

    setEnableRichText(false);

    let canceled = false;
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    if (typeof idleWindow.requestIdleCallback === "function") {
      const handle = idleWindow.requestIdleCallback(
        () => {
          if (!canceled) {
            setEnableRichText(true);
          }
        },
        { timeout: 250 }
      );

      return () => {
        canceled = true;
        idleWindow.cancelIdleCallback?.(handle);
      };
    }

    const timer = window.setTimeout(() => {
      if (!canceled) {
        setEnableRichText(true);
      }
    }, 32);

    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [isStreaming, shouldActivateRichContent, shouldDelayRichText, textContent]);

  useEffect(() => {
    if (!hasDeferredPanels || !shouldActivateRichContent) {
      setEnableRichPanels(false);
      return;
    }

    if (isCurrentMessage || isStreaming) {
      setEnableRichPanels(true);
      return;
    }

    setEnableRichPanels(false);

    let canceled = false;
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    if (typeof idleWindow.requestIdleCallback === "function") {
      const handle = idleWindow.requestIdleCallback(
        () => {
          if (!canceled) {
            setEnableRichPanels(true);
          }
        },
        { timeout: RICH_PANEL_IDLE_TIMEOUT }
      );

      return () => {
        canceled = true;
        idleWindow.cancelIdleCallback?.(handle);
      };
    }

    const timer = window.setTimeout(() => {
      if (!canceled) {
        setEnableRichPanels(true);
      }
    }, 64);

    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [hasDeferredPanels, isCurrentMessage, isStreaming, shouldActivateRichContent]);

  // 打开 GraphRAG 结果面板
  const openSearchDrawer = useCallback(
    (type: "local-search" | "global-search", resultId: string | null | undefined, contextData: GraphRAGResultSummary | undefined) => {
      if (isLoading && contextData) {
        openDrawer({ type, data: contextData });
      } else if (resultId) {
        openDrawer({
          type,
          data: {
            search_type: type === "local-search" ? "local" : "global",
            query: "",
            response: "加载中...",
            relevance_score: 0,
            execution_time: 0,
            result_id: resultId,
          } as GraphRAGResultSummary,
        });
      }
    },
    [isLoading, openDrawer]
  );

  // 如果完全没有内容，只显示子组件（不带头像）
  if (!hasTextContent && !hasAgentState && !isLoading) {
    return <>{subComponent}</> || null;
  }

  // CopilotKit 常见做法：工具调用中间消息（toolCalls）不作为正文渲染。
  if (hasToolCalls && !isLoading && !hasAgentState) {
    return null;
  }

  // 避免实时进度被历史/非当前消息重复渲染成“空块”。
  if (!hasPersistedProgress && !shouldRenderRuntimeProgress && !hasTextContent && !hasSubComponent) {
    return null;
  }

  return (
    <div ref={activationRef} className="assistant-message-wrapper">
      {/* 内容区域 */}
      <div className="assistant-content">
        {/* 进度条（如果有智能体状态） */}
        {hasAgentState && enableRichPanels && (
          <Suspense fallback={null}>
            <LazyProgressDisplay progressData={progressData as ProgressData} />
          </Suspense>
        )}

        {/* 文本内容 - 使用 Markdown 渲染 */}
        {hasTextContent && (
          shouldUsePlainText ? (
            <div className="assistant-text assistant-text-plain">{textContent}</div>
          ) : (
            <Suspense fallback={<div className="assistant-text assistant-text-plain">{textContent}</div>}>
              <LazyMarkdownMessage
                className="assistant-text markdown-content"
                content={textContent}
              />
            </Suspense>
          )
        )}

        {/* 证据链可视化（如果有） */}
        {hasEvidenceChain && enableRichPanels && (
          <Suspense fallback={null}>
            <LazyEvidenceChain
              evidenceChain={agentState!.evidence_chain!}
              title="🔗 推理证据链"
              defaultExpanded={false}
            />
          </Suspense>
        )}

        {/* 子组件（如 action 渲染结果） */}
        {hasSubComponent && (
          <div className="assistant-sub">{subComponent}</div>
        )}

        {/* 案例分布图（地理数据可视化） - 放在报告末尾 */}
        {hasGeoPoints && !isStreaming && !isLoadingGeoData && (
          <div className="case-distribution-section">
            <h2 className="case-distribution-title">📍 案例分布图</h2>
            <Suspense fallback={<div className="geo-loading">加载地图组件中...</div>}>
              <LazyGeoVisualization geoPoints={geoPointsToDisplay!} />
            </Suspense>
          </div>
        )}

        {/* 地图数据加载中 */}
        {hasGeoDataId && !hasGeoPoints && isLoadingGeoData && (
          <div className="case-distribution-section">
            <h2 className="case-distribution-title">📍 案例分布图</h2>
            <div className="geo-loading">加载地图数据中...</div>
          </div>
        )}

        {/* GraphRAG 查询按钮 */}
        {hasGraphRAGResults && !isStreaming && (
          <div className="graphrag-buttons">
            {hasLocalResult && (
              <button 
                className="graphrag-btn local-btn"
                onClick={() => openSearchDrawer('local-search', agentDataIds?.localResultId, contextState?.local_rag_result)}
              >
                <span className="btn-icon">🔍</span>
                <span className="btn-text">Local Search 结果</span>
              </button>
            )}
            {hasGlobalResult && (
              <button 
                className="graphrag-btn global-btn"
                onClick={() => openSearchDrawer('global-search', agentDataIds?.globalResultId, contextState?.global_rag_result)}
              >
                <span className="btn-icon">🌐</span>
                <span className="btn-text">Global Search 结果</span>
              </button>
            )}
          </div>
        )}

        {/* 加载状态 */}
        {isStreaming && !hasTextContent && (
          <div className="assistant-loading">加载中...</div>
        )}
      </div>

      {!isStreaming && (hasTextContent || hasAgentState || hasSubComponent) && (
        <div className="assistant-divider" aria-hidden="true" />
      )}
    </div>
  );
};

const StaticAssistantMessage = memo((props: AssistantMessageProps) => (
  <AssistantMessageBase {...props} runtimeState={null} runtimeRunning={false} />
));

const CurrentAssistantMessage: React.FC<AssistantMessageProps> = (props) => {
  const agentContext = useAgent();
  return (
    <AssistantMessageBase
      {...props}
      runtimeState={agentContext?.state}
      runtimeRunning={!!agentContext?.running}
    />
  );
};

function areEqual(prev: AssistantMessageProps, next: AssistantMessageProps): boolean {
  return (
    prev.isLoading === next.isLoading &&
    prev.isCurrentMessage === next.isCurrentMessage &&
    prev.subComponent === next.subComponent &&
    prev.message?.content === next.message?.content &&
    prev.message?.toolCalls === next.message?.toolCalls
  );
}

export const AssistantMessage = memo((props: AssistantMessageProps) => {
  if (props.isCurrentMessage) return <CurrentAssistantMessage {...props} />;
  return <StaticAssistantMessage {...props} />;
}, areEqual);

export default AssistantMessage;
