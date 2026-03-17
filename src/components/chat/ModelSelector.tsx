/**
 * 模型选择器组件
 * 
 * 放置在聊天区域左上角，提供 LLM 模型切换功能
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { AGENT_API_URL } from "../../lib/consts";
import "./ModelSelector.css";

// ============================================================
// 类型定义
// ============================================================

interface LLMModel {
  value: string;
  label: string;
}

interface ModelSelectorProps {
  /** 额外的 CSS 类名 */
  className?: string;
}

// ============================================================
// 模型选择器组件
// ============================================================

export const ModelSelector: React.FC<ModelSelectorProps> = ({ className }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentLLM, setCurrentLLM] = useState<string>("gpt-4o-mini");
  const [availableModels, setAvailableModels] = useState<LLMModel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, []);

  // 加载模型列表
  useEffect(() => {
    const loadModels = async () => {
      setIsLoading(true);
      let timer: number | undefined;
      try {
        const controller = new AbortController();
        timer = window.setTimeout(() => controller.abort(), 8000);
        const response = await fetch(`${AGENT_API_URL}/api/llm/models`, {
          signal: controller.signal,
        });
        const data = await response.json();
        setAvailableModels(data.models || []);
        setCurrentLLM(data.current || "gpt-4o-mini");
        console.log("[ModelSelector] 加载模型列表:", data);
      } catch (error) {
        console.error("[ModelSelector] 加载模型列表失败:", error);
        setCurrentLLM("gpt-4o-mini");
        setAvailableModels([
          { value: "gpt-4o-mini", label: "GPT-4o Mini" },
        ]);
      } finally {
        if (timer) window.clearTimeout(timer);
        setIsLoading(false);
      }
    };
    loadModels();
  }, []);

  // 切换模型
  const handleModelChange = useCallback(async (model: string) => {
    try {
      const response = await fetch(`${AGENT_API_URL}/api/llm/set-model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const data = await response.json();
      if (data.success) {
        setCurrentLLM(model);
        console.log("[ModelSelector] 模型已切换:", model);
      }
    } catch (error) {
      console.error("[ModelSelector] 切换模型失败:", error);
    }
    setIsOpen(false);
  }, []);

  // 获取当前模型的显示名称
  const currentModelLabel = availableModels.find(m => m.value === currentLLM)?.label || currentLLM;

  return (
    <div className={`model-selector-header ${className || ""}`} ref={dropdownRef}>
      <button
        className={`model-selector-btn ${isOpen ? "open" : ""}`}
        onClick={() => setIsOpen(!isOpen)}
        disabled={isLoading}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label="选择模型"
      >
        <span className="model-name">{isLoading ? "加载中..." : currentModelLabel}</span>
        <span className="arrow" aria-hidden="true">
          <svg viewBox="0 0 20 20" fill="none">
            <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {isOpen && (
        <div className="model-dropdown">
          <div className="model-dropdown-header">Latest</div>
          <div className="model-dropdown-list" role="listbox" aria-label="模型列表">
            {availableModels.map((model) => (
              <div
                key={model.value}
                className={`model-option ${model.value === currentLLM ? "selected" : ""}`}
                onClick={() => handleModelChange(model.value)}
                role="option"
                aria-selected={model.value === currentLLM}
              >
                <div className="model-option-name">
                  {model.label}
                  {model.value === currentLLM && <span className="check">✓</span>}
                </div>
                <div className="model-option-desc">
                  {getModelDescription(model.value)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// 获取模型描述
function getModelDescription(modelValue: string): string {
  const descriptions: Record<string, string> = {
    "gpt-4o": "旗舰模型，适合复杂推理任务",
    "gpt-4o-mini": "快速响应，性价比高",
    "gpt-4-turbo": "GPT-4 增强版，更强推理能力",
    "gpt-3.5-turbo": "经典模型，快速稳定",
    "claude-3-opus": "Claude 旗舰，深度分析",
    "claude-3-sonnet": "Claude 均衡，日常使用",
    "deepseek-chat": "DeepSeek 对话模型",
    "deepseek-reasoner": "DeepSeek 推理增强",
  };
  return descriptions[modelValue] || "AI 语言模型";
}

export default ModelSelector;
