"""test_agent 模块导出。"""

from __future__ import annotations

from importlib import import_module
from typing import Any


__all__ = [
    "build_workflow",
    "build_graph",
    "TestAgentState",
    "PROSAIL_PARAMS",
    "create_initial_state",
]


def __getattr__(name: str) -> Any:
    if name in {"build_workflow", "build_graph"}:
        module = import_module(".agent", __name__)
        return getattr(module, name)
    if name in {"TestAgentState", "PROSAIL_PARAMS", "create_initial_state"}:
        module = import_module(".state", __name__)
        return getattr(module, name)
    msg = f"module {__name__!r} has no attribute {name!r}"
    raise AttributeError(msg)
