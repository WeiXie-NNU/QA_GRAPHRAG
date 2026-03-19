"""LangGraph Agents for CopilotKit."""

from __future__ import annotations

from importlib import import_module
from typing import Any


__all__ = [
    "build_graph",
    "TestAgentState",
    "create_initial_state",
    "PROSAIL_PARAMS",
    "test_agent_graph",
]


def __getattr__(name: str) -> Any:
    if name in {"build_graph", "TestAgentState", "create_initial_state", "PROSAIL_PARAMS"}:
        module = import_module(".test_agent", __name__)
        return getattr(module, name)
    if name == "test_agent_graph":
        try:
            module = import_module(".test_agent.agent", __name__)
        except ImportError:
            return None
        return getattr(module, "build_graph", None)
    msg = f"module {__name__!r} has no attribute {name!r}"
    raise AttributeError(msg)
