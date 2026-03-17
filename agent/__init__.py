"""
LangGraph Agents for CopilotKit

提供多种推理代理实现:
- test_agent: PROSAIL 参数推理引擎（基于 GraphRAG + CoT）
"""

# 导入 test_agent 模块
from .test_agent import (
    build_graph,
    TestAgentState,
    create_initial_state,
    PROSAIL_PARAMS,
)

# 为 demo.py 提供兼容性
try:
    from .test_agent.agent import build_graph as test_agent_graph
except ImportError:
    test_agent_graph = None

__all__ = [
    "build_graph",
    "TestAgentState", 
    "create_initial_state",
    "PROSAIL_PARAMS",
    "test_agent_graph",
]
