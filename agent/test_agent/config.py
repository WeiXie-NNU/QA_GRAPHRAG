"""
Test Agent 配置模块 - 支持动态 LLM 模型切换
"""

import os
from typing import Optional
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# 默认 LLM 模型
DEFAULT_LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")
DEFAULT_LLM_STREAMING = os.getenv("LLM_STREAMING", "true").lower() in ("1", "true", "yes", "on")

# 支持的 LLM 模型列表
SUPPORTED_LLM_MODELS = [
    {"value": "gpt-4o", "label": "GPT-4o"},
    {"value": "gpt-4o-mini", "label": "GPT-4o-mini"},
    {"value": "gpt-4-turbo", "label": "GPT-4 Turbo"},
    {"value": "gpt-3.5-turbo", "label": "GPT-3.5 Turbo"},
    {"value": "claude-3-5-sonnet-20241022", "label": "Claude 3.5 Sonnet"},
    {"value": "claude-3-opus-20240229", "label": "Claude 3 Opus"},
]

# 全局模型配置（可在运行时动态修改）
_current_llm_model = DEFAULT_LLM_MODEL


def set_llm_model(model: str):
    """设置当前使用的 LLM 模型"""
    global _current_llm_model
    _current_llm_model = model
    print(f"[CONFIG] LLM 模型已切换到: {model}")


def get_llm_model() -> str:
    """获取当前使用的 LLM 模型"""
    return _current_llm_model


def get_llm_streaming() -> bool:
    """是否启用流式输出"""
    return DEFAULT_LLM_STREAMING


def get_supported_models() -> list:
    """获取支持的模型列表"""
    return SUPPORTED_LLM_MODELS
