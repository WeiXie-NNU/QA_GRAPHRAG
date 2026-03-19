from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import StructuredTool, tool
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition
from langgraph.types import interrupt

from copilotkit.langgraph import copilotkit_emit_state

from .config import get_llm_model, get_llm_streaming
from .geo_utils import enrich_geo_characteristics, geocode_place
from .graphrag_query import global_search, local_search
from .graphrag_storage import get_graphrag_storage
from .repository_registry import detect_kg_type, normalize_model_id
from .prosail_cases import (
    get_all_cases_as_geo_points,
    get_province_cases_as_geo_points,
)
from .state import PROSAIL_UNITS, TestAgentState, get_ui_state
from thread_message_store import append_thread_turn

DEFAULT_KG_ID = "prosail"
MAX_TOOL_CONTENT_LEN = 4000
MAX_HITL_RETRY = 3
SUPPORTED_KG_IDS = ("prosail", "lue")

MODEL_NAME_BY_KG = {
    "prosail": "PROSAIL",
    "lue": "LUE",
}

MODEL_PARAM_UNITS_BY_KG: Dict[str, Dict[str, str]] = {
    "prosail": {
        **PROSAIL_UNITS,
        "Car": "ug/cm2",
        "Cm": "g/cm2",
        "N": "-",
        "ALA": "deg",
        "hotspot": "-",
        "tts": "deg",
        "tto": "deg",
        "psi": "deg",
        "Cbrown": "-",
    },
    "lue": {
        "LUE_max": "-",
        "epsilon_max": "-",
        "FPAR": "-",
        "PAR": "MJ/m2/day",
        "APAR": "MJ/m2/day",
        "GPP": "gC/m2/day",
        "NPP": "gC/m2/day",
        "Tmin": "degC",
        "Topt": "degC",
        "Tmax": "degC",
        "VPD_scalar": "-",
        "W_scalar": "-",
    },
}

DEFAULT_PARAMS_BY_KG: Dict[str, List[str]] = {
    "prosail": ["Cab", "LAI", "Cw"],
    "lue": ["LUE_max", "FPAR", "PAR"],
}

PARAM_ALIASES: Dict[str, Dict[str, str]] = {
    "prosail": {
        "cab": "Cab",
        "lai": "LAI",
        "cw": "Cw",
        "car": "Car",
        "cm": "Cm",
        "n": "N",
        "ala": "ALA",
        "hotspot": "hotspot",
        "tts": "tts",
        "tto": "tto",
        "psi": "psi",
        "cbrown": "Cbrown",
        "叶绿素": "Cab",
        "叶面积指数": "LAI",
        "等效水厚度": "Cw",
        "类胡萝卜素": "Car",
        "干物质": "Cm",
    },
    "lue": {
        "lue": "LUE_max",
        "max lue": "LUE_max",
        "maximum light use efficiency": "LUE_max",
        "epsilon max": "LUE_max",
        "epsilon_max": "LUE_max",
        "emax": "LUE_max",
        "εmax": "LUE_max",
        "光能利用率": "LUE_max",
        "最大光能利用率": "LUE_max",
        "最大光能利用效率": "LUE_max",
        "fpar": "FPAR",
        "par": "PAR",
        "apar": "APAR",
        "gpp": "GPP",
        "npp": "NPP",
        "tmin": "Tmin",
        "topt": "Topt",
        "tmax": "Tmax",
        "vpd": "VPD_scalar",
        "w_scalar": "W_scalar",
    },
}


def _now_iso() -> str:
    return datetime.now().isoformat()


def _get_session_id(config: RunnableConfig) -> str:
    try:
        return str(config.get("configurable", {}).get("thread_id", "unknown"))[:8]
    except Exception:
        return "unknown"


def _safe_json_loads(text: str) -> Dict[str, Any]:
    try:
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\\n?", "", cleaned)
            cleaned = re.sub(r"\\n?```$", "", cleaned)
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _truncate(text: str, n: int = MAX_TOOL_CONTENT_LEN) -> str:
    return text if len(text) <= n else text[:n] + "..."


def _build_agent_state_marker(state: Dict[str, Any]) -> str:
    payload = {
        "steps": state.get("steps", []) or [],
        "evidence_chain": state.get("evidence_chain", []) or [],
    }
    return f"<!-- AGENT_STATE: {json.dumps(payload, ensure_ascii=False)} -->"


def _strip_agent_state_marker(text: str) -> str:
    return re.sub(r"\n*<!-- AGENT_STATE:\s*[\s\S]*?\s*-->\s*$", "", text).strip()


def _strip_agent_data_marker(text: str) -> str:
    return re.sub(r"\n*<!-- AGENT_DATA:[^>]* -->\s*$", "", text).strip()


def _latest_query(state: TestAgentState) -> str:
    # 必须优先读取当前轮的最新 HumanMessage，避免 user_query 跨轮残留污染路由。
    for msg in reversed(state.get("messages", [])):
        if isinstance(msg, HumanMessage):
            content = msg.content
            if isinstance(content, str):
                return content.strip()
            return str(content).strip()

    cached = state.get("user_query")
    if isinstance(cached, str) and cached.strip():
        return cached.strip()
    return ""


def _is_case_distribution_query(query: str) -> bool:
    q = (query or "").strip().lower()
    if not q:
        return False
    keywords = ("案例", "分布", "空间", "地图", "case", "distribution", "map")
    return any(k in q for k in keywords)


def _extract_province_from_query(query: str) -> str:
    q = (query or "").strip()
    if not q:
        return ""
    m = re.search(r"([\u4e00-\u9fa5]{2,8}(?:省|市|自治区|特别行政区))", q)
    return m.group(1) if m else ""


def _build_llm(streaming: Optional[bool] = None) -> ChatOpenAI:
    use_streaming = get_llm_streaming() if streaming is None else streaming
    return ChatOpenAI(
        model=get_llm_model(),
        temperature=0,
        streaming=use_streaming,
    )


def _is_streaming_transport_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(
        key in text
        for key in (
            "terminated",
            "und_err_socket",
            "connection",
            "stream",
            "broken pipe",
            "remoteprotocolerror",
        )
    )


async def _ainvoke_with_stream_fallback(
    llm: ChatOpenAI,
    messages: List[Any],
    config: RunnableConfig,
) -> Any:
    try:
        return await llm.ainvoke(messages, config)
    except Exception as exc:
        if get_llm_streaming() and _is_streaming_transport_error(exc):
            print(f"[AGENT:{_get_session_id(config)}] streaming failed, fallback to non-streaming: {exc}")
            fallback_llm = ChatOpenAI(
                model=get_llm_model(),
                temperature=0,
                streaming=False,
            )
            return await fallback_llm.ainvoke(messages, config)
        raise


async def _emit_ui(config: RunnableConfig, state: Dict[str, Any]) -> None:
    try:
        await copilotkit_emit_state(config, get_ui_state(state))
    except Exception as exc:
        print(f"[AGENT:{_get_session_id(config)}] emit_ui failed: {exc}")


def _create_step(node_name: str, description: str, status: str = "pending") -> Dict[str, Any]:
    return {
        "id": str(uuid.uuid4())[:8],
        "node_name": node_name,
        "description": description,
        "status": status,
        "updates": [],
        "started_at": None,
        "completed_at": None,
        "error_message": None,
    }


def _set_step(steps: List[Dict[str, Any]], idx: int, status: str, updates: List[str]) -> List[Dict[str, Any]]:
    if idx >= len(steps):
        return steps
    item = dict(steps[idx])
    item["status"] = status
    item["updates"] = updates
    if status == "running" and not item.get("started_at"):
        item["started_at"] = _now_iso()
    if status in ("completed", "error"):
        item["completed_at"] = _now_iso()
    steps[idx] = item
    return steps


def _normalize_location(location: Any) -> Dict[str, str]:
    if isinstance(location, dict):
        return {
            "full_name": str(location.get("full_name", "") or "").strip(),
            "province": str(location.get("province", "") or "").strip(),
            "city": str(location.get("city", "") or "").strip(),
            "county": str(location.get("county", "") or "").strip(),
        }
    if isinstance(location, str):
        txt = location.strip()
        return {"full_name": txt, "province": "", "city": "", "county": ""}
    return {"full_name": "", "province": "", "city": "", "county": ""}


def _normalize_kg_id(kg_id: Any) -> str:
    normalized = normalize_model_id(str(kg_id or ""))
    return normalized if normalized in SUPPORTED_KG_IDS else "none"


def _model_name_for_kg(kg_id: str) -> str:
    return MODEL_NAME_BY_KG.get(kg_id, "UNKNOWN")


def _resolve_kg_for_state(state: TestAgentState, query: str = "") -> str:
    state_kg = _normalize_kg_id(state.get("kg_id"))
    if state_kg in SUPPORTED_KG_IDS:
        return state_kg
    detected = detect_kg_type(query or _latest_query(state))
    return detected if detected in SUPPORTED_KG_IDS else DEFAULT_KG_ID


def _available_params_for_kg(kg_id: str) -> List[str]:
    return list(MODEL_PARAM_UNITS_BY_KG.get(kg_id, {}).keys())


def _canonicalize_params(raw_params: List[Any], kg_id: str) -> List[str]:
    aliases = PARAM_ALIASES.get(kg_id, {})
    known = set(_available_params_for_kg(kg_id))
    normalized: List[str] = []
    for item in raw_params:
        if not isinstance(item, str):
            continue
        key = item.strip()
        if not key:
            continue
        mapped = aliases.get(key.lower(), key)
        if mapped in known and mapped not in normalized:
            normalized.append(mapped)
    return normalized


def _infer_params_from_query(query: str, kg_id: str) -> List[str]:
    aliases = PARAM_ALIASES.get(kg_id, {})
    q = (query or "").lower()
    found: List[str] = []
    for key, param in aliases.items():
        if key.lower() in q and param not in found:
            found.append(param)
    return found


def _expected_unit_for_param(kg_id: str, param_code: str) -> str:
    return MODEL_PARAM_UNITS_BY_KG.get(kg_id, {}).get(param_code, "-")


def _location_to_text(location: Any) -> str:
    loc = _normalize_location(location)
    if loc["full_name"]:
        return loc["full_name"]
    return " ".join([x for x in [loc["province"], loc["city"], loc["county"]] if x]).strip()


def _missing_required_entities(entities: Dict[str, Any]) -> List[str]:
    missing: List[str] = []
    loc = _normalize_location(entities.get("location"))
    # 位置信息仅“省份”必填；市/县改为可选，用于逐级细化。
    if not loc["province"]:
        missing.append("location.province")
    if not str(entities.get("model", "") or "").strip():
        missing.append("model")
    params = entities.get("parameters")
    if not isinstance(params, list) or not params:
        missing.append("parameters")
    return missing


def _collect_latest_tool_results(messages: List[Any]) -> Dict[str, Dict[str, Any]]:
    # 仅从“当前轮”（最后一条 HumanMessage 之后）提取工具结果，避免历史污染。
    start_idx = 0
    for i in range(len(messages) - 1, -1, -1):
        if isinstance(messages[i], HumanMessage):
            start_idx = i + 1
            break

    results: Dict[str, Dict[str, Any]] = {}
    for msg in messages[start_idx:]:
        if not isinstance(msg, ToolMessage):
            continue
        tool_name = msg.name or ""
        if tool_name not in ("graphrag_local_search", "graphrag_global_search"):
            continue
        content = msg.content if isinstance(msg.content, str) else str(msg.content)
        parsed = _safe_json_loads(content)
        if not parsed:
            parsed = {
                "search_type": "local" if "local" in tool_name else "global",
                "response": content,
            }
        key = "local" if "local" in tool_name else "global"
        results[key] = parsed
    return results


def _collect_latest_case_geo_payload(messages: List[Any]) -> Optional[Dict[str, Any]]:
    """提取最近一次 get_cases 工具返回的空间分布结果。"""
    start_idx = 0
    for i in range(len(messages) - 1, -1, -1):
        if isinstance(messages[i], HumanMessage):
            start_idx = i + 1
            break

    for msg in reversed(messages[start_idx:]):
        if not isinstance(msg, ToolMessage):
            continue
        if (msg.name or "") != "get_cases":
            continue
        content = msg.content if isinstance(msg.content, str) else str(msg.content)
        parsed = _safe_json_loads(content)
        if not parsed:
            continue
        geo_points = parsed.get("geo_points")
        if isinstance(geo_points, list) and geo_points:
            return {
                "place_name": str(parsed.get("place_name", "") or ""),
                "geo_points": geo_points,
            }
    return None


def _build_graphrag_result_summary(
    result: Optional[Dict[str, Any]],
    search_type: str,
    result_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    if not isinstance(result, dict):
        return None
    return {
        "search_type": search_type,
        "query": str(result.get("query", "") or ""),
        "response": str(result.get("response", "") or ""),
        "relevance_score": float(result.get("relevance_score", 0.0) or 0.0),
        "execution_time": float(result.get("execution_time", 0.0) or 0.0),
        "result_id": result_id,
    }


async def _persist_latest_graphrag_results(
    state: TestAgentState,
    config: RunnableConfig,
) -> Dict[str, Optional[Dict[str, Any]]]:
    """提取当前轮 GraphRAG 工具结果，持久化后返回摘要。"""
    tool_results = _collect_latest_tool_results(state.get("messages", []))
    if not tool_results:
        return {"local": None, "global": None}

    storage = get_graphrag_storage()
    thread_id = str(config.get("configurable", {}).get("thread_id", "unknown"))
    summaries: Dict[str, Optional[Dict[str, Any]]] = {"local": None, "global": None}

    for key in ("local", "global"):
        result = tool_results.get(key)
        if not isinstance(result, dict):
            continue

        result_id: Optional[str] = None
        try:
            result_id = await storage.save_result(
                thread_id=thread_id,
                search_type=key,
                query=str(result.get("query", "") or ""),
                response=str(result.get("response", "") or ""),
                context_data=result.get("context_data") if isinstance(result.get("context_data"), dict) else {},
                source_documents=result.get("source_documents") if isinstance(result.get("source_documents"), list) else [],
                relevance_score=float(result.get("relevance_score", 0.0) or 0.0),
                execution_time=float(result.get("execution_time", 0.0) or 0.0),
                token_usage=int(result.get("token_usage", 0) or 0),
            )
        except Exception as exc:
            print(f"[AGENT:{_get_session_id(config)}] save {key} graphrag result failed: {exc}")

        summaries[key] = _build_graphrag_result_summary(result, key, result_id)

    return summaries


def _build_agent_data_marker(
    local_result_id: Optional[str] = None,
    global_result_id: Optional[str] = None,
    geo_data_id: Optional[str] = None,
) -> str:
    return (
        f"<!-- AGENT_DATA:{local_result_id or ''}:{global_result_id or ''}:{geo_data_id or ''} -->"
    )


async def _persist_case_geo_data_if_any(state: TestAgentState, config: RunnableConfig) -> Optional[str]:
    """若本轮调用 get_cases 返回空间分布，则落库并返回 geo_data_id。"""
    payload = _collect_latest_case_geo_payload(state.get("messages", []))
    if not payload:
        return None
    try:
        storage = get_graphrag_storage()
        thread_id = str(config.get("configurable", {}).get("thread_id", "unknown"))
        return await storage.save_geo_data(
            thread_id=thread_id,
            place_name=payload.get("place_name", ""),
            geo_points=payload.get("geo_points", []),
            target_params=[],
        )
    except Exception as exc:
        print(f"[AGENT:{_get_session_id(config)}] save case geo data failed: {exc}")
        return None


async def _persist_visible_turn(
    state: TestAgentState,
    config: RunnableConfig,
    assistant_content: str,
    agent_name: str = "test",
) -> None:
    assistant_text = str(assistant_content or "")
    if not assistant_text.strip():
        return

    latest_user_message: Optional[HumanMessage] = None
    for msg in reversed(state.get("messages", [])):
        if isinstance(msg, HumanMessage):
            latest_user_message = msg
            break

    if latest_user_message is None:
        return

    thread_id = str(config.get("configurable", {}).get("thread_id", "") or "").strip()
    if not thread_id:
        return

    user_content = (
        latest_user_message.content
        if isinstance(latest_user_message.content, str)
        else str(latest_user_message.content)
    )
    if not user_content.strip():
        return

    user_message_id = str(getattr(latest_user_message, "id", "") or uuid.uuid4())
    assistant_message_id = f"assistant:{user_message_id}"

    try:
        await append_thread_turn(
            thread_id=thread_id,
            agent=agent_name,
            turn_id=user_message_id,
            user_message_id=user_message_id,
            user_content=user_content,
            assistant_message_id=assistant_message_id,
            assistant_content=assistant_text,
        )
    except Exception as exc:
        print(f"[AGENT:{_get_session_id(config)}] persist_visible_turn failed: {exc}")


def _normalize_interrupt_decision(decision: Any) -> Dict[str, Any]:
    if isinstance(decision, dict):
        return decision
    if isinstance(decision, str):
        parsed = _safe_json_loads(decision)
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _is_terminate_decision(decision: Dict[str, Any]) -> bool:
    action = str(decision.get("action", "")).strip().lower()
    terminate = bool(decision.get("terminate", False))
    return terminate or action in {"terminate", "stop", "exit", "cancel"}


def _safe_interrupt(payload: Dict[str, Any], fallback: Dict[str, Any], config: RunnableConfig) -> Dict[str, Any]:
    """在少数上下文丢失场景下兜底，避免 interrupt 异常直接打断整个流。"""
    try:
        raw = interrupt(payload)
        return _normalize_interrupt_decision(raw)
    except RuntimeError as exc:
        if "outside of a runnable context" in str(exc):
            print(f"[AGENT:{_get_session_id(config)}] interrupt context lost, fallback decision: {exc}")
            data = dict(fallback)
            data["_interrupt_context_lost"] = True
            return data
        raise


@tool("get_cases")
def get_cases_tool(province: str = "", kg_id: str = DEFAULT_KG_ID) -> str:
    """
    查询模型参数案例空间分布（仅地图数据）。
    province 可选：按省份筛选空间分布。
    kg_id 可选：指定知识仓库（prosail | lue）。
    """
    try:
        resolved_kg = kg_id if kg_id in ("prosail", "lue") else DEFAULT_KG_ID
        if province and province.strip():
            geo_points = get_province_cases_as_geo_points(province.strip(), kg_id=resolved_kg)
            place_name = province.strip()
        else:
            geo_points = get_all_cases_as_geo_points(kg_id=resolved_kg)
            place_name = "全国案例库"

        payload = {
            "view": "spatial",
            "kg_id": resolved_kg,
            "place_name": place_name,
            "count": len(geo_points),
            "geo_points": geo_points,
        }
        return json.dumps(payload, ensure_ascii=False)
    except Exception as exc:
        return json.dumps(
            {"view": "spatial", "error": f"加载案例空间分布失败: {exc}", "geo_points": []},
            ensure_ascii=False,
        )


async def _graphrag_local_search_async(
    query: str,
    kg_id: str = DEFAULT_KG_ID,
    response_type: str = "Multiple Paragraphs",
) -> str:
    """GraphRAG local search：实体级精确检索。"""
    query = (query or "").strip()
    if not query:
        return json.dumps(
            {
                "search_type": "local",
                "kg_id": kg_id,
                "query": "",
                "response": "缺少 query 参数，已跳过 local search。",
                "context_data": {},
                "source_documents": [],
                "execution_time": 0.0,
                "token_usage": 0,
                "relevance_score": 0.0,
            },
            ensure_ascii=False,
        )
    start = datetime.now()
    response, context_data = await local_search(query, kg_id=kg_id, response_type=response_type)
    text = response if isinstance(response, str) else str(response)
    result = {
        "search_type": "local",
        "kg_id": kg_id,
        "query": query,
        "response": _truncate(text),
        "context_data": context_data if isinstance(context_data, dict) else {"raw": str(context_data)},
        "source_documents": (context_data or {}).get("source_documents", []) if isinstance(context_data, dict) else [],
        "execution_time": (datetime.now() - start).total_seconds(),
        "token_usage": max(1, len(text) // 4),
        "relevance_score": 0.8 if text else 0.0,
    }
    return json.dumps(result, ensure_ascii=False)


async def _graphrag_global_search_async(
    query: str,
    kg_id: str = DEFAULT_KG_ID,
    response_type: str = "Multiple Paragraphs",
) -> str:
    """GraphRAG global search：社区级综合检索。"""
    query = (query or "").strip()
    if not query:
        return json.dumps(
            {
                "search_type": "global",
                "kg_id": kg_id,
                "query": "",
                "response": "缺少 query 参数，已跳过 global search。",
                "context_data": {},
                "source_documents": [],
                "execution_time": 0.0,
                "token_usage": 0,
                "relevance_score": 0.0,
            },
            ensure_ascii=False,
        )
    start = datetime.now()
    response, context_data = await global_search(query, kg_id=kg_id, response_type=response_type)
    text = response if isinstance(response, str) else str(response)
    result = {
        "search_type": "global",
        "kg_id": kg_id,
        "query": query,
        "response": _truncate(text),
        "context_data": context_data if isinstance(context_data, dict) else {"raw": str(context_data)},
        "source_documents": (context_data or {}).get("source_documents", []) if isinstance(context_data, dict) else [],
        "execution_time": (datetime.now() - start).total_seconds(),
        "token_usage": max(1, len(text) // 4),
        "relevance_score": 0.75 if text else 0.0,
    }
    return json.dumps(result, ensure_ascii=False)


def _graphrag_local_search_sync(
    query: str,
    kg_id: str = DEFAULT_KG_ID,
    response_type: str = "Multiple Paragraphs",
) -> str:
    return json.dumps(
        {
            "search_type": "local",
            "kg_id": kg_id,
            "query": query,
            "error": "sync_invoke_not_supported_use_async",
            "response_type": response_type,
        },
        ensure_ascii=False,
    )


def _graphrag_global_search_sync(
    query: str,
    kg_id: str = DEFAULT_KG_ID,
    response_type: str = "Multiple Paragraphs",
) -> str:
    return json.dumps(
        {
            "search_type": "global",
            "kg_id": kg_id,
            "query": query,
            "error": "sync_invoke_not_supported_use_async",
            "response_type": response_type,
        },
        ensure_ascii=False,
    )


def _handle_tool_error(err: Exception) -> str:
    """ToolNode 统一错误兜底，避免单个工具错误直接中断整个会话流。"""
    return json.dumps(
        {
            "error": "tool_execution_failed",
            "message": str(err),
        },
        ensure_ascii=False,
    )


def _build_tools() -> List[Any]:
    local_tool = StructuredTool.from_function(
        func=_graphrag_local_search_sync,
        coroutine=_graphrag_local_search_async,
        name="graphrag_local_search",
        description="GraphRAG Local Search（实体级检索），优先用于参数证据检索。",
    )
    global_tool = StructuredTool.from_function(
        func=_graphrag_global_search_sync,
        coroutine=_graphrag_global_search_async,
        name="graphrag_global_search",
        description="GraphRAG Global Search（社区级检索），当 local 证据不足时使用。",
    )
    return [get_cases_tool, local_tool, global_tool]


TOOLS = _build_tools()
GENERAL_QA_TOOL_NODE = ToolNode(TOOLS, handle_tool_errors=_handle_tool_error)
EVIDENCE_TOOL_NODE = ToolNode(TOOLS, handle_tool_errors=_handle_tool_error)


async def intent_route_node(state: TestAgentState, config: RunnableConfig) -> Dict[str, Any]:
    query = _latest_query(state)
    # 内部路由节点不应把 JSON 过程内容流到前端
    llm = _build_llm(streaming=False)

    # 每轮对话都从全新步骤开始，避免复用上一轮 completed 状态导致“非渐进式渲染”。
    steps = [
        _create_step("intent_route", "🎯 意图路由", "running"),
        _create_step("intake", "📝 信息抽取"),
        _create_step("evidence", "🔧 证据检索与工具调用"),
        _create_step("synthesize", "✨ 参数综合"),
        _create_step("quality", "✅ 质量检查与回答"),
    ]
    steps = _set_step(steps, 0, "running", ["正在识别问题类型"])
    await _emit_ui(
        config,
        {
            "steps": steps,
            # 清空上一轮临时结果，避免新一轮加载态误用旧数据
            "local_rag_result": None,
            "global_rag_result": None,
        },
    )

    route = "general_qa"
    reason = "默认走通用问答"
    kg_id = "none"
    quick_kg = detect_kg_type(query)

    try:
        prompt = f"""你是路由分类器。判断用户问题是否属于“模型参数在区域如何设置”。
只输出 JSON:
{{
  \"route\": \"model_param_workflow\" 或 \"general_qa\",
  \"reason\": \"一句话理由\",
  \"kg_id\": \"prosail\" | \"lue\" | \"none\"
}}
用户问题: {query}
"""
        resp = await _ainvoke_with_stream_fallback(llm, [SystemMessage(content=prompt)], config)
        parsed = _safe_json_loads(resp.content if isinstance(resp.content, str) else str(resp.content))
        route = str(parsed.get("route", route))
        reason = str(parsed.get("reason", reason))
        kg_id = str(parsed.get("kg_id", "none"))
    except Exception:
        if quick_kg in ("prosail", "lue"):
            route = "model_param_workflow"
            kg_id = quick_kg
            reason = "关键词匹配到知识图谱"

    if route not in ("model_param_workflow", "general_qa"):
        route = "general_qa"
    if kg_id not in ("prosail", "lue", "none"):
        kg_id = "none"

    # 对 LLM 路由结果做二次校正：关键词匹配到模型仓库时，优先挂载对应 KG。
    if quick_kg in ("prosail", "lue") and kg_id == "none":
        kg_id = quick_kg

    # 参数意图 + 可识别模型时，强制进入参数工作流，避免误走 general_qa。
    query_lower = query.lower()
    param_intent = any(
        k in query_lower
        for k in ("参数", "取值", "设置", "推荐", "最大光能利用率", "epsilon", "εmax", "emax")
    )
    if route == "general_qa" and quick_kg in ("prosail", "lue") and param_intent:
        route = "model_param_workflow"
        reason = f"关键词识别为 {quick_kg} 参数问题，强制路由到参数流程"

    steps = _set_step(steps, 0, "completed", [f"route={route}", f"kg={kg_id}", reason])
    await _emit_ui(config, {"steps": steps})

    return {
        "steps": steps,
        "user_query": query,
        "intent_route": route,
        "intent_reason": reason,
        "kg_id": kg_id,
        # 每轮开始时清空临时状态，避免上一轮残留污染当前决策与渲染。
        "entities": None,
        "extraction_error": None,
        "human_check_status": None,
        "human_feedback": None,
        "human_check_retry_count": 0,
        "missing_required_entities": [],
        "has_location": None,
        "geo_context": None,
        "approval_status": None,
        "approval_retry_count": 0,
        "recommendations": [],
        "synthesis_text": None,
        "quality_report": None,
        "local_rag_result": None,
        "global_rag_result": None,
        "final_response": None,
        "final_answer": None,
        "case_geo_data_id": None,
        "errors": [],
    }


def intent_route_decision(state: TestAgentState) -> str:
    route = state.get("intent_route", "general_qa")
    return route if route in ("model_param_workflow", "general_qa") else "general_qa"


async def general_qa_prepare_node(state: TestAgentState, config: RunnableConfig) -> Dict[str, Any]:
    steps = list(state.get("steps") or [])
    steps = _set_step(steps, 2, "running", ["通用问答：准备消息上下文"])
    await _emit_ui(config, {"steps": steps})
    # 输入的人类消息已由 CopilotKit/LangGraph 注入到 state["messages"]，
    # 这里不要再次追加 HumanMessage，避免同一轮用户消息重复。
    return {"steps": steps}


async def general_qa_agent_node(state: TestAgentState, config: RunnableConfig) -> Dict[str, Any]:
    query = _latest_query(state)
    # 常见编排做法：对“案例空间分布”使用确定性分支，避免 LLM 自由生成冗长中间文本。
    if _is_case_distribution_query(query):
        steps = list(state.get("steps") or [])
        steps = _set_step(steps, 2, "completed", ["案例分布查询：已生成地图数据"])
        steps = _set_step(steps, 4, "running", ["正在整理地图结果"])
        await _emit_ui(config, {"steps": steps})

        province = _extract_province_from_query(query)
        query_kg = detect_kg_type(query)
        state_kg = state.get("kg_id") if state.get("kg_id") in ("prosail", "lue") else "none"
        resolved_kg = state_kg if state_kg != "none" else (query_kg if query_kg in ("prosail", "lue") else DEFAULT_KG_ID)
        # 常见做法：节点内直接调用业务函数；@tool 仅通过 ToolNode/LLM tool_calls 触发。
        if province and province.strip():
            geo_points = get_province_cases_as_geo_points(province.strip(), kg_id=resolved_kg)
            place_name = province.strip()
        else:
            geo_points = get_all_cases_as_geo_points(kg_id=resolved_kg)
            place_name = "全国案例库"

        geo_data_id: Optional[str] = None
        if geo_points:
            try:
                storage = get_graphrag_storage()
                thread_id = str(config.get("configurable", {}).get("thread_id", "unknown"))
                geo_data_id = await storage.save_geo_data(
                    thread_id=thread_id,
                    place_name=place_name,
                    geo_points=geo_points,
                    target_params=[],
                )
            except Exception as exc:
                print(f"[AGENT:{_get_session_id(config)}] save direct case geo data failed: {exc}")

        if geo_data_id:
            answer_text = "已为你加载案例空间分布，请直接查看下方地图。"
        else:
            answer_text = "未获取到可用地图数据，请稍后重试。"
        # 统一由 finalize 节点落最终消息，避免单轮重复 assistant message。
        return {
            "steps": steps,
            "final_response": answer_text,
            "final_answer": answer_text,
            "case_geo_data_id": geo_data_id,
        }

    # 仅最终通用回答开启流式
    llm = _build_llm(streaming=True)
    bound = llm.bind_tools(TOOLS)
    system_prompt = """你是中文问答助手。可调用工具：
- get_cases
- graphrag_local_search
- graphrag_global_search
规则：
- 仅在需要证据时调用工具。
- 当用户问“案例分布/空间分布/地图”时，优先调用 get_cases（只返回地图分布数据，不要输出表格）。
- 根据用户问题自动识别并传递 kg_id（当前支持：prosail, lue）。
- 调用 graphrag_local_search / graphrag_global_search 时，必须传 query（使用用户原问题或其等价改写），不要空参数调用。
- 优先 local，再按需 global。
- 最终回答保持简洁并指出证据来源。"""
    resp = await _ainvoke_with_stream_fallback(
        bound,
        [SystemMessage(content=system_prompt)] + state.get("messages", []),
        config,
    )
    # 当本轮已产出最终回答（无 tool_calls）时，先把步骤推进到“回答中”，
    # finalize 再把同一条消息收敛为 completed，形成渐进式渲染。
    if not getattr(resp, "tool_calls", None):
        steps = list(state.get("steps") or [])
        steps = _set_step(steps, 2, "completed", ["通用问答：证据检索与工具调用完成"])
        steps = _set_step(steps, 4, "running", ["通用问答：正在整理最终回答"])
        await _emit_ui(config, {"steps": steps})

        text = resp.content if isinstance(resp.content, str) else str(resp.content)
        return {
            "steps": steps,
            "final_response": text,
            "final_answer": text,
        }

    # 中间 tool_call 消息不向前端暴露文本，避免“过程文案”显示在聊天区。
    resp.content = ""
    return {"messages": [resp]}


async def general_qa_finalize_node(state: TestAgentState, config: RunnableConfig) -> Dict[str, Any]:
    final_text = str(state.get("final_response") or state.get("final_answer") or "").strip()
    if not final_text:
        final_text = "未生成回答。"
        for msg in reversed(state.get("messages", [])):
            if isinstance(msg, AIMessage):
                if not getattr(msg, "tool_calls", None):
                    final_text = msg.content if isinstance(msg.content, str) else str(msg.content)
                    final_text = _strip_agent_state_marker(final_text)
                    final_text = _strip_agent_data_marker(final_text)
                    break

    steps = list(state.get("steps") or [])
    steps = _set_step(steps, 4, "completed", ["通用问答完成"])
    await _emit_ui(config, {"steps": steps})
    rag_summaries = await _persist_latest_graphrag_results(state, config)
    local_summary = rag_summaries.get("local")
    global_summary = rag_summaries.get("global")
    geo_data_id = state.get("case_geo_data_id") or await _persist_case_geo_data_if_any(state, config)
    # 调用案例空间分布工具后，回答强制简化为一行，避免冗长文本列表。
    if geo_data_id:
        final_text = "已为你加载案例空间分布，请直接查看下方地图。"
    agent_data_marker = _build_agent_data_marker(
        (local_summary or {}).get("result_id") if isinstance(local_summary, dict) else None,
        (global_summary or {}).get("result_id") if isinstance(global_summary, dict) else None,
        geo_data_id,
    )
    final_with_state = f"{final_text}\n\n{agent_data_marker}\n{_build_agent_state_marker({'steps': steps})}"
    await _persist_visible_turn(state, config, final_with_state)
    payload: Dict[str, Any] = {
        "steps": steps,
        "final_response": final_text,
        "final_answer": final_text,
        "local_rag_result": local_summary,
        "global_rag_result": global_summary,
        # 追加一条新的最终 AI 消息，避免复用旧 message id
        # 与 CopilotKit regenerate/time-travel 的 checkpoint 对齐失败。
        "messages": [AIMessage(content=final_with_state)],
    }
    return payload


async def intake_node(state: TestAgentState, config: RunnableConfig) -> Dict[str, Any]:
    query = _latest_query(state)
    # 信息抽取属于内部步骤，关闭流式避免过程文本泄露
    llm = _build_llm(streaming=False)
    resolved_kg = _resolve_kg_for_state(state, query)
    default_model = _model_name_for_kg(resolved_kg)
    allowed_params = _available_params_for_kg(resolved_kg)
    allowed_params_text = ", ".join(allowed_params)

    steps = list(state.get("steps") or [])
    steps = _set_step(steps, 1, "running", ["抽取 location/model/parameters"])
    await _emit_ui(config, {"steps": steps})

    entities: Dict[str, Any] = {
        "location": {"full_name": "", "province": "", "city": "", "county": ""},
        "model": default_model,
        "parameters": [],
        "vegetation_type": "",
        "experiment_time_range": "",
    }

    prompt = f"""你是信息抽取器。只输出 JSON:
{{
  \"location\": {{\"full_name\":\"\",\"province\":\"\",\"city\":\"\",\"county\":\"\"}},
  \"model\": \"{default_model}\",
  \"parameters\": [],
  \"vegetation_type\": \"\",
  \"experiment_time_range\": \"\"
}}
要求：
- model 必须是最相关模型（当前优先候选: {default_model}）
- parameters 仅从下列参数中选择：{allowed_params_text}
- 如果用户问“最大光能利用率/epsilon max/εmax”，应识别为 LUE_max
用户问题: {query}
"""
    parsed: Dict[str, Any] = {}
    try:
        resp = await _ainvoke_with_stream_fallback(llm, [SystemMessage(content=prompt)], config)
        parsed = _safe_json_loads(resp.content if isinstance(resp.content, str) else str(resp.content))
    except Exception:
        parsed = {}

    if parsed:
        entities["location"] = _normalize_location(parsed.get("location"))
        entities["model"] = str(parsed.get("model", default_model) or default_model)
        params = parsed.get("parameters")
        if isinstance(params, list):
            entities["parameters"] = _canonicalize_params(params, resolved_kg)
        entities["vegetation_type"] = str(parsed.get("vegetation_type", "") or "")
        entities["experiment_time_range"] = str(parsed.get("experiment_time_range", "") or "")

    parsed_model_kg = _normalize_kg_id(entities.get("model"))
    if parsed_model_kg in SUPPORTED_KG_IDS:
        resolved_kg = parsed_model_kg
        entities["model"] = _model_name_for_kg(resolved_kg)
    else:
        entities["model"] = _model_name_for_kg(resolved_kg)

    entities["parameters"] = _canonicalize_params(entities.get("parameters", []), resolved_kg)
    if not entities["parameters"]:
        quick = _infer_params_from_query(query, resolved_kg)
        entities["parameters"] = quick or list(DEFAULT_PARAMS_BY_KG.get(resolved_kg, []))

    missing = _missing_required_entities(entities)
    has_location = "location.province" not in missing

    steps = _set_step(steps, 1, "completed", [f"参数: {','.join(entities['parameters'])}", f"has_location={has_location}"])
    await _emit_ui(config, {"steps": steps})

    return {
        "steps": steps,
        "kg_id": resolved_kg,
        "entities": entities,
        "missing_required_entities": missing,
        "has_location": has_location,
        "human_check_status": "needs_more_info",
    }


def human_check_node(state: TestAgentState, config: RunnableConfig) -> Dict[str, Any]:
    entities = state.get("entities", {})
    missing = _missing_required_entities(entities)
    steps = list(state.get("steps") or [])
    steps = _set_step(steps, 1, "running", ["等待人工审核抽取结果(HITL)"])
    retry_count = int(state.get("human_check_retry_count") or 0)

    payload = {
        "task": "请审查 intake 实体抽取结果",
        "required_fields": [
            "location.province",
            "model",
            "parameters",
        ],
        "optional_fields": [
            "location.full_name",
            "location.city",
            "location.county",
            "vegetation_type",
            "experiment_time_range",
        ],
        "missing_required": missing,
        "entities": entities,
        "instruction": "请返回 {'approved': bool, 'feedback': str, 'entities_patch': {...}}",
    }
    decision = _safe_interrupt(
        payload=payload,
        fallback={"approved": False, "feedback": "HITL中断异常，默认未通过", "entities_patch": {}},
        config=config,
    )
    approved = bool(decision.get("approved", False))
    feedback = str(decision.get("feedback", ""))
    patch = decision.get("entities_patch", {})
    terminated = _is_terminate_decision(decision)
    context_lost = bool(decision.get("_interrupt_context_lost"))

    if isinstance(patch, dict):
        for k, v in patch.items():
            if k == "location" and isinstance(v, dict):
                old = _normalize_location(entities.get("location"))
                new_loc = _normalize_location(v)
                entities["location"] = {
                    "full_name": new_loc["full_name"] or old["full_name"],
                    "province": new_loc["province"] or old["province"],
                    "city": new_loc["city"] or old["city"],
                    "county": new_loc["county"] or old["county"],
                }
            elif v not in (None, "", []):
                entities[k] = v

    missing_after = _missing_required_entities(entities)
    passed = approved and len(missing_after) == 0
    next_retry = retry_count + 1
    bypassed = False
    if terminated:
        steps = _set_step(
            steps,
            1,
            "completed",
            ["人工审核选择结束本次推理，流程已终止"],
        )
        status = "terminated"
    elif context_lost:
        bypassed = True
    elif not passed and next_retry >= MAX_HITL_RETRY:
        bypassed = True

    if not terminated and bypassed:
        steps = _set_step(
            steps,
            1,
            "completed",
            [
                "HITL 暂不可用或重试上限已达，已自动继续流程",
                f"missing={missing_after or 'none'}",
            ],
        )
        status = "bypassed"
    else:
        status = "passed" if passed else "needs_more_info"
        steps = _set_step(
            steps,
            1,
            "completed",
            [f"HITL审核: {'通过' if passed else '未通过'}", f"missing={missing_after or 'none'}"],
        )

    errors = list(state.get("errors") or [])
    if context_lost:
        errors.append("HITL interrupt context lost; bypassed human_check")

    return {
        "steps": steps,
        "entities": entities,
        "human_feedback": feedback,
        "human_check_status": status,
        "missing_required_entities": missing_after,
        "has_location": "location.province" not in missing_after,
        "human_check_retry_count": next_retry,
        "errors": errors,
    }


def human_check_decision(state: TestAgentState) -> str:
    status = state.get("human_check_status")
    if status == "terminated":
        return "terminate"
    if status in ("passed", "bypassed"):
        return "route"
    return "human_check"


async def route_node(state: TestAgentState, config: RunnableConfig) -> Dict[str, Any]:
    return {}


def route_decision(state: TestAgentState) -> str:
    return "complement" if state.get("has_location", False) else "gather_evidence_agent"


async def complement_node(state: TestAgentState, config: RunnableConfig) -> Dict[str, Any]:
    steps = list(state.get("steps") or [])
    steps = _set_step(steps, 2, "running", ["正在补全地理上下文"])
    await _emit_ui(config, {"steps": steps})

    entities = state.get("entities", {})
    location_text = _location_to_text(entities.get("location"))
    geo_context: Dict[str, Any] = {
        "location": location_text,
        "climate": "unknown",
        "soil": "unknown",
        "notes": "",
    }

    if location_text:
        geo = await geocode_place(location_text)
        if geo:
            geo_chars = await enrich_geo_characteristics(geo)
            geo_context["climate"] = str(geo_chars.get("climate_zone", "unknown"))
            geo_context["soil"] = str(geo_chars.get("soil_type", "unknown") or "unknown")
            geo_context["notes"] = str(geo_chars)

    steps = _set_step(steps, 2, "running", ["地理上下文补全完成，等待人工审批"])
    await _emit_ui(config, {"steps": steps})
    return {"steps": steps, "geo_context": geo_context, "approval_status": "pending"}


def approval_node(state: TestAgentState, config: RunnableConfig) -> Dict[str, Any]:
    steps = list(state.get("steps") or [])
    steps = _set_step(steps, 2, "running", ["等待人工审批地理信息(HITL)"])
    retry_count = int(state.get("approval_retry_count") or 0)

    payload = {
        "task": "请审批地理信息补全结果",
        "geo_context": state.get("geo_context", {}),
        "instruction": "返回 {'approved': true/false, 'feedback': '...'}",
    }
    decision = _safe_interrupt(
        payload=payload,
        fallback={"approved": False, "feedback": "HITL中断异常，默认驳回"},
        config=config,
    )
    approved = bool(decision.get("approved", False))
    feedback = str(decision.get("feedback", ""))
    terminated = _is_terminate_decision(decision)
    context_lost = bool(decision.get("_interrupt_context_lost"))
    next_retry = retry_count + 1

    if terminated:
        approval_status = "terminated"
        steps = _set_step(
            steps,
            2,
            "completed",
            ["人工审批选择结束本次推理，流程已终止"],
        )
    elif context_lost or (not approved and next_retry >= MAX_HITL_RETRY):
        approval_status = "approved"
        steps = _set_step(
            steps,
            2,
            "completed",
            ["HITL 审批不可用或重试上限已达，自动继续后续流程"],
        )
    else:
        approval_status = "approved" if approved else "rejected"
        steps = _set_step(steps, 2, "running", [f"审批结果: {'通过' if approved else '驳回'}"])

    errors = list(state.get("errors") or [])
    if context_lost:
        errors.append("HITL interrupt context lost; bypassed approval")

    return {
        "steps": steps,
        "approval_status": approval_status,
        "human_feedback": feedback,
        "approval_retry_count": next_retry,
        "errors": errors,
    }


def approval_route(state: TestAgentState) -> str:
    status = state.get("approval_status")
    if status == "terminated":
        return "terminate"
    return "gather_evidence_agent" if status == "approved" else "complement"


async def terminate_node(state: TestAgentState, config: RunnableConfig) -> Dict[str, Any]:
    steps = list(state.get("steps") or [])
    steps = _set_step(steps, 4, "completed", ["用户已结束本次推理"])
    final_response = "已根据你的选择结束本次推理。你可以直接发起新问题继续。"
    state_marker = _build_agent_state_marker({"steps": steps})
    final_with_state = f"{final_response}\n{state_marker}"
    await _persist_visible_turn(state, config, final_with_state)
    return {
        "steps": steps,
        "final_response": final_response,
        "final_answer": final_response,
        "messages": [AIMessage(content=final_with_state)],
    }


async def gather_evidence_agent_node(state: TestAgentState, config: RunnableConfig) -> Dict[str, Any]:
    steps = list(state.get("steps") or [])
    steps = _set_step(steps, 2, "running", ["Agent 正在调用 GraphRAG tools"])
    await _emit_ui(config, {"steps": steps})

    # 工具决策阶段关闭流式，避免 tool-call 过程内容渲染到聊天区
    llm = _build_llm(streaming=False)
    bound = llm.bind_tools(TOOLS)

    query = _latest_query(state)
    entities = state.get("entities", {})
    kg_id = state.get("kg_id") if state.get("kg_id") in ("prosail", "lue") else DEFAULT_KG_ID

    local_hint = f"请先用 graphrag_local_search，kg_id={kg_id}。"
    global_hint = f"如 local 不足，再用 graphrag_global_search，kg_id={kg_id}。"

    system_prompt = f"""你是证据收集助手。你的任务是收集回答问题所需证据。
用户问题: {query}
实体: {json.dumps(entities, ensure_ascii=False)}
规则:
- {local_hint}
- {global_hint}
- 最多调用 2 次工具。
- 调用 graphrag_local_search / graphrag_global_search 时必须传 query，值用用户问题或提炼后的等价查询。
- 证据足够时直接给出简短结论。"""

    resp = await _ainvoke_with_stream_fallback(
        bound,
        [SystemMessage(content=system_prompt)] + state.get("messages", []),
        config,
    )
    return {"messages": [resp], "steps": steps}


async def synthesize_node(state: TestAgentState, config: RunnableConfig) -> Dict[str, Any]:
    steps = list(state.get("steps") or [])
    steps = _set_step(steps, 3, "running", ["正在综合 local/global 检索结果"])
    await _emit_ui(config, {"steps": steps})

    tool_results = _collect_latest_tool_results(state.get("messages", []))
    local_result = tool_results.get("local")
    global_result = tool_results.get("global")
    rag_summaries = await _persist_latest_graphrag_results(state, config)

    query = _latest_query(state)
    entities = state.get("entities", {})
    kg_id = _resolve_kg_for_state(state, query)
    model_name = _model_name_for_kg(kg_id)
    allowed_params = _available_params_for_kg(kg_id)
    sample_param = (entities.get("parameters") or [None])[0] if isinstance(entities.get("parameters"), list) else None
    if not isinstance(sample_param, str) or sample_param not in allowed_params:
        sample_param = DEFAULT_PARAMS_BY_KG.get(kg_id, ["param"])[0]
    sample_unit = _expected_unit_for_param(kg_id, sample_param)
    # 综合节点输出结构化 JSON，关闭流式避免中间结果展示
    llm = _build_llm(streaming=False)

    synth_prompt = f"""你是遥感参数推荐助手。根据证据给出参数建议。
用户问题: {query}
模型: {model_name} (kg_id={kg_id})
仅可推荐参数: {', '.join(allowed_params)}
实体: {json.dumps(entities, ensure_ascii=False)}
Local Search: {json.dumps(local_result or {}, ensure_ascii=False)}
Global Search: {json.dumps(global_result or {}, ensure_ascii=False)}
输出 JSON:
{{
  \"recommendations\": [{{\"parameter\":\"{sample_param}\",\"value\":\"...\",\"unit\":\"{sample_unit}\",\"reason\":\"...\",\"evidence_ids\":[]}}],
  \"summary\": \"...\"
}}"""

    recommendations: List[Dict[str, Any]] = []
    summary = ""

    try:
        resp = await _ainvoke_with_stream_fallback(llm, [SystemMessage(content=synth_prompt)], config)
        parsed = _safe_json_loads(resp.content if isinstance(resp.content, str) else str(resp.content))
        recommendations = parsed.get("recommendations", []) if isinstance(parsed.get("recommendations", []), list) else []
        summary = str(parsed.get("summary", "") or "")
    except Exception:
        recommendations = []

    recommendations = [
        rec for rec in recommendations
        if isinstance(rec, dict) and str(rec.get("parameter", "")) in set(allowed_params)
    ]

    if not recommendations:
        fallback_params = entities.get("parameters") if isinstance(entities.get("parameters"), list) else []
        fallback_params = [p for p in fallback_params if p in allowed_params]
        if not fallback_params:
            fallback_params = list(DEFAULT_PARAMS_BY_KG.get(kg_id, []))
        for p in fallback_params:
            recommendations.append(
                {
                    "parameter": p,
                    "value": "N/A",
                    "unit": _expected_unit_for_param(kg_id, p),
                    "reason": "证据不足，建议补充检索",
                    "evidence_ids": [],
                }
            )
        summary = summary or "已给出保守参数建议。"

    steps = _set_step(steps, 3, "completed", [f"生成参数建议 {len(recommendations)} 项"])
    await _emit_ui(config, {"steps": steps})

    local_summary = rag_summaries.get("local") if local_result else None
    global_summary = rag_summaries.get("global") if global_result else None

    return {
        "steps": steps,
        "recommendations": recommendations,
        "synthesis_text": summary,
        "local_rag_result": local_summary,
        "global_rag_result": global_summary,
    }


async def quality_check_node(state: TestAgentState, config: RunnableConfig) -> Dict[str, Any]:
    recommendations = state.get("recommendations", [])
    kg_id = _resolve_kg_for_state(state, _latest_query(state))

    coverage_issues: List[str] = []
    unit_issues: List[str] = []

    for rec in recommendations:
        p = str(rec.get("parameter", ""))
        if not rec.get("reason"):
            coverage_issues.append(f"{p}: 缺少推理依据")
        expected = _expected_unit_for_param(kg_id, p)
        if expected:
            unit = str(rec.get("unit", "") or "")
            if unit and expected != "-" and unit != expected:
                unit_issues.append(f"{p}: 单位应为 {expected}，当前 {unit}")

    passed = not coverage_issues and not unit_issues
    report = {
        "passed": passed,
        "coverage_issues": coverage_issues,
        "unit_issues": unit_issues,
        "evidence_count": (1 if state.get("local_rag_result") else 0) + (1 if state.get("global_rag_result") else 0),
    }

    if passed:
        lines = ["参数推荐（通过质量检查）:"]
        for rec in recommendations:
            lines.append(f"- {rec.get('parameter')}: {rec.get('value')} {rec.get('unit')} | {rec.get('reason')}")
        lines.append("")
        lines.append(f"说明: {state.get('synthesis_text', '')}")
        final_response = "\n".join(lines)
    else:
        final_response = (
            "质量检查未通过。\n"
            f"证据问题: {coverage_issues or '无'}\n"
            f"单位问题: {unit_issues or '无'}\n"
            "请补充证据或修正单位后重试。"
        )

    local_id = (state.get("local_rag_result") or {}).get("result_id", "") if isinstance(state.get("local_rag_result"), dict) else ""
    global_id = (state.get("global_rag_result") or {}).get("result_id", "") if isinstance(state.get("global_rag_result"), dict) else ""
    geo_data_id = await _persist_case_geo_data_if_any(state, config)
    final_content = final_response + f"\n\n{_build_agent_data_marker(local_id, global_id, geo_data_id)}"

    steps = list(state.get("steps") or [])
    steps = _set_step(steps, 4, "completed", ["质量检查完成", "已生成最终回答"])
    await _emit_ui(config, {"steps": steps})
    state_marker = _build_agent_state_marker({"steps": steps})
    final_with_state = f"{final_content}\n{state_marker}"
    await _persist_visible_turn(state, config, final_with_state)

    return {
        "steps": steps,
        "quality_report": report,
        "final_response": final_response,
        "final_answer": final_response,
        # 只返回新增 AI 消息，避免把历史消息整段重复追加。
        "messages": [AIMessage(content=final_with_state)],
    }


def build_workflow() -> StateGraph:
    graph = StateGraph(TestAgentState)

    graph.add_node("intent_route", intent_route_node)

    graph.add_node("general_qa_prepare", general_qa_prepare_node)
    graph.add_node("general_qa_agent", general_qa_agent_node)
    graph.add_node("general_qa_tools", GENERAL_QA_TOOL_NODE)
    graph.add_node("general_qa_finalize", general_qa_finalize_node)

    graph.add_node("intake", intake_node)
    graph.add_node("human_check", human_check_node)
    graph.add_node("route", route_node)
    graph.add_node("complement", complement_node)
    graph.add_node("approval", approval_node)
    graph.add_node("terminate", terminate_node)
    graph.add_node("gather_evidence_agent", gather_evidence_agent_node)
    graph.add_node("gather_evidence_tools", EVIDENCE_TOOL_NODE)
    graph.add_node("synthesize", synthesize_node)
    graph.add_node("quality_check", quality_check_node)

    graph.add_edge(START, "intent_route")
    graph.add_conditional_edges(
        "intent_route",
        intent_route_decision,
        {
            "model_param_workflow": "intake",
            "general_qa": "general_qa_prepare",
        },
    )

    graph.add_edge("general_qa_prepare", "general_qa_agent")
    graph.add_conditional_edges(
        "general_qa_agent",
        tools_condition,
        {
            "tools": "general_qa_tools",
            "__end__": "general_qa_finalize",
        },
    )
    graph.add_edge("general_qa_tools", "general_qa_agent")
    graph.add_edge("general_qa_finalize", END)

    graph.add_edge("intake", "human_check")
    graph.add_conditional_edges(
        "human_check",
        human_check_decision,
        {
            "route": "route",
            "human_check": "human_check",
            "terminate": "terminate",
        },
    )
    graph.add_conditional_edges(
        "route",
        route_decision,
        {
            "complement": "complement",
            "gather_evidence_agent": "gather_evidence_agent",
        },
    )
    graph.add_edge("complement", "approval")
    graph.add_conditional_edges(
        "approval",
        approval_route,
        {
            "gather_evidence_agent": "gather_evidence_agent",
            "complement": "complement",
            "terminate": "terminate",
        },
    )

    graph.add_conditional_edges(
        "gather_evidence_agent",
        tools_condition,
        {
            "tools": "gather_evidence_tools",
            "__end__": "synthesize",
        },
    )
    graph.add_edge("gather_evidence_tools", "gather_evidence_agent")
    graph.add_edge("synthesize", "quality_check")
    graph.add_edge("quality_check", END)
    graph.add_edge("terminate", END)

    return graph


def build_graph(checkpointer: Optional[Any] = None):
    workflow = build_workflow()
    if checkpointer is None:
        checkpointer = MemorySaver()
    return workflow.compile(checkpointer=checkpointer)


PROSAILState = TestAgentState


if __name__ == "__main__":
    import asyncio

    graph = build_graph(MemorySaver())
    cfg = {"configurable": {"thread_id": "demo-thread"}}

    async def _run() -> None:
        question = input("请输入问题: ").strip()
        result = await graph.ainvoke({"messages": [HumanMessage(content=question)]}, config=cfg)
        print(result.get("final_response", result.get("final_answer", "")))

    asyncio.run(_run())
