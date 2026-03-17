from __future__ import annotations

import csv
import json
import os
import re
from pathlib import Path
from typing import Annotated, Any, Dict, List, Literal, Optional, TypedDict

from dotenv import load_dotenv
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph, add_messages
from langgraph.prebuilt import ToolNode, tools_condition
from langgraph.types import Command, interrupt

try:
    from langchain_community.tools.tavily_search import TavilySearchResults
except Exception:  # pragma: no cover
    TavilySearchResults = None

load_dotenv()


PROSAIL_UNITS = {
    "Cab": "ug/cm2",
    "LAI": "m2/m2",
    "Cw": "cm",
}

CSV_FILE_PATH = Path(__file__).resolve().parents[1] / "resources" / "prosail_parameters.csv"


class AgentState(TypedDict, total=False):
    messages: Annotated[List[BaseMessage], add_messages]
    user_query: str
    intent_route: Literal["model_param_workflow", "general_qa"]
    intent_reason: str
    entities: Dict[str, Any]
    extraction_error: str
    human_check_status: Literal["passed", "needs_more_info"]
    missing_required_entities: List[str]
    has_location: bool
    geo_context: Dict[str, Any]
    human_feedback: str
    approval_status: Literal["approved", "rejected", "pending"]
    evidence: List[Dict[str, Any]]
    gather_iterations: int
    draft_reasoning: str
    recommendations: List[Dict[str, Any]]
    synthesis_text: str
    quality_report: Dict[str, Any]
    final_response: str


def _get_llm() -> Optional[ChatOpenAI]:
    if not os.getenv("OPENAI_API_KEY"):
        return None
    return ChatOpenAI(model=os.getenv("LLM_MODEL", "gpt-4o-mini"), temperature=0)


def _get_tavily_tool() -> Optional[Any]:
    if TavilySearchResults is None:
        return None
    if not os.getenv("TAVILY_API_KEY"):
        return None
    return TavilySearchResults(max_results=3)


def _latest_query(state: AgentState) -> str:
    return state.get("user_query", "")


def _safe_json_loads(text: str) -> Dict[str, Any]:
    try:
        text = text.strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\\n?", "", text)
            text = re.sub(r"\\n?```$", "", text)
        return json.loads(text)
    except Exception:
        return {}


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


def _location_to_text(location: Any) -> str:
    loc = _normalize_location(location)
    if loc["full_name"]:
        return loc["full_name"]
    parts = [loc["province"], loc["city"], loc["county"]]
    return " ".join([p for p in parts if p]).strip()


def _missing_required_entities(entities: Dict[str, Any]) -> List[str]:
    missing: List[str] = []
    loc = _normalize_location(entities.get("location"))
    if not (loc["full_name"] and loc["province"] and loc["city"] and loc["county"]):
        missing.append("location(full_name/province/city/county)")
    if not str(entities.get("model", "") or "").strip():
        missing.append("model")
    params = entities.get("parameters")
    if not isinstance(params, list) or len(params) == 0:
        missing.append("parameters")
    return missing


def _apply_entities_patch(entities: Dict[str, Any], patch: Any) -> Dict[str, Any]:
    if not isinstance(patch, dict):
        return entities
    updated = dict(entities)

    if "location" in patch:
        loc = _normalize_location(patch.get("location"))
        old = _normalize_location(updated.get("location"))
        updated["location"] = {
            "full_name": loc["full_name"] or old["full_name"],
            "province": loc["province"] or old["province"],
            "city": loc["city"] or old["city"],
            "county": loc["county"] or old["county"],
        }
    for key in ("model", "crop", "vegetation_type", "experiment_time_range"):
        if key in patch and str(patch.get(key, "")).strip():
            updated[key] = str(patch.get(key)).strip()
    if "parameters" in patch:
        p = patch.get("parameters")
        if isinstance(p, str):
            p = [x.strip() for x in p.split(",") if x.strip()]
        if isinstance(p, list):
            updated["parameters"] = p
    return updated


def get_cases_as_markdown() -> str:
    """
    将 prosail_parameters.csv 读取并返回 Markdown 格式表格
    只保留核心展示字段，避免内容过长
    """
    if not CSV_FILE_PATH.exists():
        return "⚠️ 案例库文件不存在，请检查 resources/prosail_parameters.csv"

    # 要展示的列（名称 → 显示标题）
    display_columns = [
        ("省份", "省份"),
        ("地名", "地点"),
        ("实验时间", "时间"),
        ("植被类型", "植被类型"),
        ("叶面积指数LAI", "LAI"),
        ("叶绿素Cab(μg/cm²)", "Cab(μg/cm²)"),
        ("等效水厚度Cw", "Cw"),
        ("干物质含量Cm(g/cm²)", "Cm(g/cm²)"),
        ("叶片结构参数N", "N"),
        ("论文标题", "来源论文"),
    ]

    try:
        with open(CSV_FILE_PATH, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            rows = list(reader)
    except Exception as e:
        return f"⚠️ 读取案例库失败: {e}"

    if not rows:
        return "案例库当前为空。"

    headers = [title for _, title in display_columns]
    header_line = "| " + " | ".join(headers) + " |"
    separator = "| " + " | ".join(["---"] * len(headers)) + " |"

    data_lines: List[str] = []
    for row in rows:
        cells: List[str] = []
        for col_key, _ in display_columns:
            val = (row.get(col_key) or "").strip()
            if col_key == "论文标题" and len(val) > 30:
                val = val[:30] + "…"
            val = val.replace("|", "/")
            cells.append(val)
        data_lines.append("| " + " | ".join(cells) + " |")

    total = len(rows)
    summary = f"共收录 **{total}** 条 PROSAIL 建模案例（来源: `resources/prosail_parameters.csv`）"
    table = "\n".join([header_line, separator] + data_lines)
    return summary + "\n\n" + table


@tool("get_cases")
def get_cases_tool() -> str:
    """
    查询 PROSAIL 参数案例库。
    适用场景:
    - 用户明确询问“案例库里有哪些案例”
    - 用户明确询问参数在不同省市/区域的空间分布
    - 用户希望查看历史建模样例及来源论文
    返回:
    - Markdown 表格，包含省份/地点/时间/植被类型/LAI/Cab/Cw/Cm/N/来源论文
    """
    return get_cases_as_markdown()


@tool("tavily_web_search")
def tavily_web_search_tool(query: str, max_results: int = 5) -> str:
    """
    联网检索最新或外部事实信息。
    适用场景:
    - 需要最新动态、时效性信息、公开网页事实核验
    - 本地知识不足时补充证据
    参数:
    - query: 检索查询词
    - max_results: 返回结果数量(1-8)
    返回:
    - 精简后的 JSON 字符串，包含 title/url/content
    """
    tool_inst = _get_tavily_tool()
    if not tool_inst:
        return json.dumps(
            {
                "error": "tavily_unavailable",
                "reason": "未安装 Tavily 工具或未配置 TAVILY_API_KEY",
            },
            ensure_ascii=False,
        )

    limit = max(1, min(int(max_results), 8))
    raw = tool_inst.invoke(query)
    records: List[Dict[str, str]] = []
    for item in raw[:limit]:
        if isinstance(item, dict):
            records.append(
                {
                    "title": str(item.get("title", "") or ""),
                    "url": str(item.get("url", "") or ""),
                    "content": str(item.get("content", "") or "")[:800],
                }
            )
        else:
            records.append({"title": "", "url": "", "content": str(item)[:800]})
    return json.dumps(records, ensure_ascii=False)


def _get_general_qa_tools() -> List[Any]:
    return [get_cases_tool, tavily_web_search_tool]


def intent_route_node(state: AgentState) -> Dict[str, Any]:
    """
    顶层路由:
    - model_param_workflow: 生态模型参数在特定区域如何设置的问题
    - general_qa: 其他普通问答
    """
    query = _latest_query(state)
    llm = _get_llm()
    print(f"[DEBUG][intent_route] query={query}")

    default_route = "general_qa"
    default_reason = "默认走通用 QA 分支"

    if llm:
        prompt = f"""你是路由分类器。判断用户问题是否属于“某生态模型参数在某区域该如何设置”。
若是返回 model_param_workflow，否则返回 general_qa。
只输出 JSON:
{{
  "route": "model_param_workflow" 或 "general_qa",
  "reason": "一句话理由"
}}

用户问题: {query}
"""
        resp = llm.invoke([SystemMessage(content=prompt), HumanMessage(content=query)])
        parsed = _safe_json_loads(resp.content if isinstance(resp.content, str) else str(resp.content))
        route = parsed.get("route", default_route)
        reason = parsed.get("reason", default_reason)
        if route not in ("model_param_workflow", "general_qa"):
            route = default_route
        print(f"[DEBUG][intent_route] route={route}, reason={reason}")
        return {"intent_route": route, "intent_reason": reason}

    # 无 LLM 时的简易兜底路由（仅用于不中断流程）
    q = query.lower()
    model_keywords = ["prosail", "参数", "cab", "lai", "cw", "区域", "地区", "地点", "作物"]
    hit = sum(1 for k in model_keywords if k in q)
    route = "model_param_workflow" if hit >= 2 else "general_qa"
    reason = f"无 LLM，关键词命中 {hit} 个"
    print(f"[DEBUG][intent_route] route={route}, reason={reason}")
    return {"intent_route": route, "intent_reason": reason}


def intent_route_decision(state: AgentState) -> str:
    decision = state.get("intent_route", "general_qa")
    print(f"[DEBUG][intent_route] decision={decision}")
    return decision


def general_qa_prepare_node(state: AgentState) -> Dict[str, Any]:
    """初始化通用 QA 消息状态。"""
    query = _latest_query(state)
    print(f"[DEBUG][general_qa_prepare] query={query}")
    return {"messages": [HumanMessage(content=query)]}


def general_qa_agent_node(state: AgentState) -> Dict[str, Any]:
    """
    通用 QA Agent 节点:
    - 使用 bind_tools 注册工具描述
    - 由模型自行决定是否调用 get_cases / tavily_web_search
    """
    llm = _get_llm()
    if not llm:
        return {"messages": [AIMessage(content="当前未配置 OPENAI_API_KEY，无法执行通用 QA。")]}

    system_prompt = """你是一个通用问答智能体，可调用工具辅助回答。
可用工具:
1) get_cases: 查询本地 PROSAIL 案例库，适合“案例库/空间分布/各地区参数样例”。
2) tavily_web_search: 联网搜索，适合需要外部事实或时效信息的问题。

决策要求:
- 能直接回答时不要滥用工具。
- 需要证据或最新信息时主动调用合适工具。
- 回答时引用你使用到的关键信息来源。"""
    tools = _get_general_qa_tools()
    bound = llm.bind_tools(tools)
    msgs = [SystemMessage(content=system_prompt)] + state.get("messages", [])
    resp = bound.invoke(msgs)
    return {"messages": [resp]}


def general_qa_finalize_node(state: AgentState) -> Dict[str, Any]:
    """提取通用 QA 最终回答。"""
    final_text = "未生成回答。"
    for msg in reversed(state.get("messages", [])):
        if isinstance(msg, AIMessage):
            tool_calls = getattr(msg, "tool_calls", None)
            if not tool_calls:
                final_text = msg.content if isinstance(msg.content, str) else str(msg.content)
                break
    print(f"[DEBUG][general_qa_finalize] final_response_len={len(final_text)}")
    return {"final_response": final_text}


def intake_node(state: AgentState) -> Dict[str, Any]:
    """通过 LLM 解析用户问题，抽取生态模型参数推理实体。"""
    query = _latest_query(state)
    llm = _get_llm()
    print(f"[DEBUG][intake] query={query}")

    entities = {
        "location": {
            "full_name": "",
            "province": "",
            "city": "",
            "county": "",
        },
        "parameters": [],
        "model": None,
        "crop": None,
        "vegetation_type": None,
        "experiment_time_range": None,
    }

    if not llm:
        print("[DEBUG][intake] OPENAI_API_KEY missing, skip LLM extraction")
        missing_required = _missing_required_entities(entities)
        return {
            "entities": entities,
            "extraction_error": "未配置 OPENAI_API_KEY，无法执行 LLM 信息抽取。",
            "human_check_status": "needs_more_info",
            "missing_required_entities": missing_required,
            "has_location": False,
            "approval_status": "pending",
            "evidence": [],
            "gather_iterations": 0,
        }

    prompt = f"""你是生态模型问答的信息抽取器。请从用户问题中提取实体，并输出严格 JSON。
字段:
- location: 地理位置对象，必须包含 full_name/province/city/county 四个字段（未知填空字符串）
- model: 生态模型名称（如 PROSAIL）
- parameters: 需要推理的参数列表（仅允许 Cab/LAI/Cw/Car/Cm/N/ALA/hotspot/tts/tto/psi，未知则 []）
- vegetation_type: 植被生态类型（可选，未知填空字符串）
- experiment_time_range: 实验时间范围（可选，未知填空字符串）

返回示例:
{{
  "location": {{
    "full_name": "河南省商丘市梁园区",
    "province": "河南省",
    "city": "商丘市",
    "county": "梁园区"
  }},
  "model": "PROSAIL",
  "parameters": ["Cab", "LAI", "Cw"],
  "vegetation_type": "冬小麦",
  "experiment_time_range": "2020-2022"
}}

用户问题: {query}
只输出 JSON，不要输出其它内容。"""
    resp = llm.invoke([SystemMessage(content=prompt), HumanMessage(content=query)])
    parsed = _safe_json_loads(resp.content if isinstance(resp.content, str) else str(resp.content))
    if parsed:
        if "location" in parsed:
            entities["location"] = _normalize_location(parsed.get("location"))
        for k in ("model", "vegetation_type", "experiment_time_range"):
            if k in parsed:
                entities[k] = parsed.get(k)
        # 向后兼容 crop
        entities["crop"] = parsed.get("vegetation_type") or parsed.get("crop")
        entities["parameters"] = parsed.get("parameters", [])
        print(f"[DEBUG][intake] parsed_entities={entities}")
    else:
        print("[DEBUG][intake] LLM returned non-JSON or empty JSON")

    # LLM-only: 仅做最小格式清洗，不做规则推断
    allowed_params = {"Cab", "LAI", "Cw", "Car", "Cm", "N", "ALA", "hotspot", "tts", "tto", "psi"}
    if not isinstance(entities.get("parameters"), list):
        entities["parameters"] = []
    entities["parameters"] = [p for p in entities["parameters"] if p in allowed_params]

    missing_required = _missing_required_entities(entities)
    has_location = "location(full_name/province/city/county)" not in missing_required
    print(
        f"[DEBUG][intake] has_location={has_location}, missing_required={missing_required}, "
        f"extraction_error={'none' if parsed else 'LLM parse failed'}"
    )
    return {
        "entities": entities,
        "extraction_error": "" if parsed else "LLM 抽取失败或返回非 JSON。",
        "human_check_status": "needs_more_info",
        "missing_required_entities": missing_required,
        "has_location": has_location,
        "approval_status": "pending",
        "evidence": [],
        "gather_iterations": 0,
    }


def human_check_node(state: AgentState) -> Dict[str, Any]:
    """
    intake 后的人在回路审查节点:
    - 人工审查必填/选填实体
    - 必填项缺失时，要求补填并重复审查
    """
    entities = state.get("entities", {})
    missing_required = _missing_required_entities(entities)
    print(f"[DEBUG][human_check] enter, missing_required={missing_required}, entities={entities}")

    payload = {
        "task": "请审查 intake 实体抽取结果",
        "required_fields": [
            "location.full_name",
            "location.province",
            "location.city",
            "location.county",
            "model",
            "parameters",
        ],
        "optional_fields": ["vegetation_type", "experiment_time_range"],
        "missing_required": missing_required,
        "entities": entities,
        "instruction": (
            "请返回 {'approved': bool, 'feedback': str, 'entities_patch': {...}}。"
            " 若必填项缺失，请在 entities_patch 中补齐。"
        ),
    }
    decision = interrupt(payload)
    print(f"[DEBUG][human_check] resumed decision={decision}")

    approved = bool(decision.get("approved", False)) if isinstance(decision, dict) else False
    feedback = decision.get("feedback", "") if isinstance(decision, dict) else ""
    patch = decision.get("entities_patch", {}) if isinstance(decision, dict) else {}
    updated_entities = _apply_entities_patch(entities, patch)

    missing_after = _missing_required_entities(updated_entities)
    passed = approved and (len(missing_after) == 0)
    print(f"[DEBUG][human_check] passed={passed}, missing_after={missing_after}")

    return {
        "entities": updated_entities,
        "human_feedback": feedback,
        "human_check_status": "passed" if passed else "needs_more_info",
        "missing_required_entities": missing_after,
        "has_location": "location(full_name/province/city/county)" not in missing_after,
    }


def human_check_decision(state: AgentState) -> str:
    decision = "route" if state.get("human_check_status") == "passed" else "human_check"
    print(f"[DEBUG][human_check] decision={decision}")
    return decision


def route_node(state: AgentState) -> Dict[str, Any]:
    """路由占位节点，真正分支由条件边决定。"""
    print(f"[DEBUG][route] has_location={state.get('has_location', False)}")
    return {}


def route_decision(state: AgentState) -> str:
    decision = "complement" if state.get("has_location", False) else "gather_evidence"
    print(f"[DEBUG][route] decision={decision}")
    return decision


def complement_node(state: AgentState) -> Dict[str, Any]:
    """基于地理位置补全气候/土壤等信息。"""
    entities = state.get("entities", {})
    location = _location_to_text(entities.get("location"))
    feedback = state.get("human_feedback", "")
    tavily = _get_tavily_tool()
    print(f"[DEBUG][complement] location={location}, has_tavily={bool(tavily)}, feedback={feedback}")

    geo_context: Dict[str, Any] = {
        "location": location,
        "climate": "unknown",
        "soil": "unknown",
        "notes": "",
    }
    new_evidence: List[Dict[str, Any]] = []

    if tavily and location:
        query = f"{location} 气候 土壤 作物生长条件"
        if feedback:
            query += f" 审批反馈: {feedback}"
        results = tavily.invoke(query)
        snippets: List[str] = []
        for idx, item in enumerate(results[:3], start=1):
            content = item.get("content", "") if isinstance(item, dict) else str(item)
            url = item.get("url", "") if isinstance(item, dict) else ""
            snippets.append(content[:220])
            new_evidence.append(
                {
                    "id": f"geo-{idx}",
                    "type": "geo",
                    "source": url or "tavily",
                    "snippet": content[:260],
                }
            )
        geo_context["notes"] = "\n".join(snippets)
        print(f"[DEBUG][complement] geo_evidence_added={len(new_evidence)}")
    else:
        print("[DEBUG][complement] skip web enrichment (missing tavily or location)")

    return {
        "geo_context": geo_context,
        "evidence": state.get("evidence", []) + new_evidence,
    }


def approval_node(state: AgentState) -> Dict[str, Any]:
    """HITL 审批节点：不通过则返回 complement 重试。"""
    print("[DEBUG][approval] entering interrupt, waiting human decision...")
    payload = {
        "task": "请审批地理信息补全结果",
        "geo_context": state.get("geo_context", {}),
        "instruction": "返回 {'approved': true/false, 'feedback': '...'}",
    }
    human_decision = interrupt(payload)
    print(f"[DEBUG][approval] resumed with decision={human_decision}")

    approved = bool(human_decision.get("approved", False)) if isinstance(human_decision, dict) else False
    feedback = human_decision.get("feedback", "") if isinstance(human_decision, dict) else ""
    return {
        "approval_status": "approved" if approved else "rejected",
        "human_feedback": feedback,
    }


def approval_route(state: AgentState) -> str:
    decision = "gather_evidence" if state.get("approval_status") == "approved" else "complement"
    print(f"[DEBUG][approval] route_after_approval={decision}")
    return decision


def gather_evidence_node(state: AgentState) -> Dict[str, Any]:
    """工具调用循环（最多3次），使用 Tavily 搜索补证并形成推理草稿。"""
    query = _latest_query(state)
    entities = state.get("entities", {})
    evidence = list(state.get("evidence", []))
    tavily = _get_tavily_tool()
    llm = _get_llm()
    print(f"[DEBUG][gather_evidence] start, existing_evidence={len(evidence)}, has_tavily={bool(tavily)}, has_llm={bool(llm)}")

    max_loops = 3
    loops = 0
    reasoning_notes: List[str] = []

    while loops < max_loops:
        loops += 1
        print(f"[DEBUG][gather_evidence] loop={loops}")

        # 让 LLM 决定这一轮是否继续搜索及查询词
        search_query = query
        need_search = True
        if llm:
            planner_prompt = f"""你是检索规划器。根据当前信息决定是否继续检索。
返回 JSON: {{"need_search": true/false, "search_query": "...", "reason": "..."}}
用户问题: {query}
实体: {json.dumps(entities, ensure_ascii=False)}
已有证据条数: {len(evidence)}"""
            plan_resp = llm.invoke([SystemMessage(content=planner_prompt)])
            plan = _safe_json_loads(plan_resp.content if isinstance(plan_resp.content, str) else str(plan_resp.content))
            need_search = bool(plan.get("need_search", True))
            search_query = plan.get("search_query", query)
            if plan.get("reason"):
                reasoning_notes.append(f"第{loops}轮计划: {plan['reason']}")

        if not need_search:
            print("[DEBUG][gather_evidence] planner decided stop search")
            break

        if tavily:
            results = tavily.invoke(search_query)
            print(f"[DEBUG][gather_evidence] search_query={search_query}, results={len(results)}")
            for i, item in enumerate(results[:2], start=1):
                content = item.get("content", "") if isinstance(item, dict) else str(item)
                url = item.get("url", "") if isinstance(item, dict) else ""
                evidence.append(
                    {
                        "id": f"ev-{loops}-{i}",
                        "type": "web",
                        "source": url or "tavily",
                        "snippet": content[:320],
                        "query": search_query,
                    }
                )
        else:
            missing = []
            if TavilySearchResults is None:
                missing.append("langchain-community 未安装或 Tavily 工具不可导入")
            if not os.getenv("TAVILY_API_KEY"):
                missing.append("TAVILY_API_KEY 未设置")
            reason = "；".join(missing) if missing else "未知原因"
            reasoning_notes.append(f"Tavily 不可用，跳过检索。({reason})")
            print(f"[DEBUG][gather_evidence] tavily unavailable: {reason}")
            break

    draft_reasoning = "\n".join(reasoning_notes) if reasoning_notes else "完成证据收集。"
    print(f"[DEBUG][gather_evidence] done, loops={loops}, evidence={len(evidence)}")
    return {
        "evidence": evidence,
        "gather_iterations": loops,
        "draft_reasoning": draft_reasoning,
    }


def synthesize_node(state: AgentState) -> Dict[str, Any]:
    """综合证据，生成具体参数推荐。"""
    llm = _get_llm()
    entities = state.get("entities", {})
    evidence = state.get("evidence", [])
    query = _latest_query(state)

    default_params = entities.get("parameters") or ["Cab", "LAI", "Cw"]
    recs: List[Dict[str, Any]] = []
    synthesis_text = ""
    print(f"[DEBUG][synthesize] start, evidence={len(evidence)}, params={default_params}, has_llm={bool(llm)}")

    if llm:
        prompt = f"""你是遥感生态建模助手。基于证据给出参数推荐。
要求输出 JSON:
{{
  "recommendations": [
    {{"parameter": "Cab", "value": "40-55", "unit": "ug/cm2", "reason": "...", "evidence_ids": ["ev-1-1"]}}
  ],
  "summary": "..."
}}
用户问题: {query}
目标参数: {default_params}
证据: {json.dumps(evidence, ensure_ascii=False)}
"""
        resp = llm.invoke([SystemMessage(content=prompt)])
        parsed = _safe_json_loads(resp.content if isinstance(resp.content, str) else str(resp.content))
        recs = parsed.get("recommendations", [])
        synthesis_text = parsed.get("summary", "")

    if not recs:
        for p in default_params:
            recs.append(
                {
                    "parameter": p,
                    "value": "N/A",
                    "unit": PROSAIL_UNITS.get(p, "-") if p in PROSAIL_UNITS else "-",
                    "reason": "证据不足，需补检索",
                    "evidence_ids": [],
                }
            )
        synthesis_text = synthesis_text or "未能形成高置信推荐。"
    print(f"[DEBUG][synthesize] generated_recommendations={len(recs)}")

    return {
        "recommendations": recs,
        "synthesis_text": synthesis_text,
    }


def quality_check_node(state: AgentState) -> Dict[str, Any]:
    """质量检查：证据覆盖 + 单位一致性，通过后输出 response。"""
    recommendations = state.get("recommendations", [])
    evidence = state.get("evidence", [])
    evidence_ids = {e.get("id") for e in evidence}

    coverage_issues: List[str] = []
    unit_issues: List[str] = []

    for rec in recommendations:
        p = rec.get("parameter")
        rec_evs = rec.get("evidence_ids", []) or []
        if len(rec_evs) < 1:
            coverage_issues.append(f"{p}: 缺少证据")
        unresolved = [eid for eid in rec_evs if eid not in evidence_ids]
        if unresolved:
            coverage_issues.append(f"{p}: 引用了不存在的证据 {unresolved}")

        if p in PROSAIL_UNITS:
            expected = PROSAIL_UNITS[p].lower().replace("²", "2")
            actual = str(rec.get("unit", "")).lower().replace("²", "2")
            if actual != expected:
                unit_issues.append(f"{p}: 单位应为 {PROSAIL_UNITS[p]}，当前为 {rec.get('unit')}")

    passed = not coverage_issues and not unit_issues
    print(
        f"[DEBUG][quality_check] passed={passed}, evidence_count={len(evidence)}, "
        f"coverage_issues={len(coverage_issues)}, unit_issues={len(unit_issues)}"
    )
    quality_report = {
        "passed": passed,
        "coverage_issues": coverage_issues,
        "unit_issues": unit_issues,
        "evidence_count": len(evidence),
    }

    if passed:
        lines = ["参数推荐（通过质量检查）:"]
        for rec in recommendations:
            lines.append(
                f"- {rec.get('parameter')}: {rec.get('value')} {rec.get('unit')} | 证据: {rec.get('evidence_ids', [])}"
            )
        lines.append(f"\n说明: {state.get('synthesis_text', '')}")
        final_response = "\n".join(lines)
    else:
        tavily_unavailable_hint = ""
        if not evidence:
            if TavilySearchResults is None or not os.getenv("TAVILY_API_KEY"):
                tavily_unavailable_hint = (
                    "\n提示: 当前未成功调用 Tavily。请检查 `langchain-community` 和 `TAVILY_API_KEY`。"
                )
        final_response = (
            "质量检查未通过。\n"
            f"证据问题: {coverage_issues or '无'}\n"
            f"单位问题: {unit_issues or '无'}\n"
            "请补充证据或修正单位后重试。"
            f"{tavily_unavailable_hint}"
        )

    return {
        "quality_report": quality_report,
        "final_response": final_response,
    }


def build_graph(checkpointer: Optional[Any] = None):
    """构建满足以下编排的 LangGraph:
    START -> intent_route
        -> model_param_workflow: intake -> human_check(HITL) -> route
                                   -> (complement -> approval(HITL) -> gather_evidence | gather_evidence)
                                   -> synthesize -> quality_check -> END
        -> general_qa: qa_prepare -> qa_agent -> [tools]* -> qa_finalize -> END
    """
    graph = StateGraph(AgentState)
    qa_tools = _get_general_qa_tools()
    qa_tool_node = ToolNode(qa_tools)

    graph.add_node("intent_route", intent_route_node)
    graph.add_node("general_qa_prepare", general_qa_prepare_node)
    graph.add_node("general_qa_agent", general_qa_agent_node)
    graph.add_node("general_qa_tools", qa_tool_node)
    graph.add_node("general_qa_finalize", general_qa_finalize_node)
    graph.add_node("intake", intake_node)
    graph.add_node("human_check", human_check_node)
    graph.add_node("route", route_node)
    graph.add_node("complement", complement_node)
    graph.add_node("approval", approval_node)
    graph.add_node("gather_evidence", gather_evidence_node)
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
        },
    )
    graph.add_conditional_edges(
        "route",
        route_decision,
        {
            "complement": "complement",
            "gather_evidence": "gather_evidence",
        },
    )
    graph.add_edge("complement", "approval")
    graph.add_conditional_edges(
        "approval",
        approval_route,
        {
            "gather_evidence": "gather_evidence",
            "complement": "complement",
        },
    )
    graph.add_edge("gather_evidence", "synthesize")
    graph.add_edge("synthesize", "quality_check")
    graph.add_edge("quality_check", END)

    return graph.compile(checkpointer=checkpointer)


if __name__ == "__main__":
    from langgraph.checkpoint.memory import MemorySaver

    app = build_graph(checkpointer=MemorySaver())
    config = {"configurable": {"thread_id": "demo-hitl"}}

    # user_question = "请给出河南商丘冬小麦在PROSAIL中的Cab、LAI、Cw推荐参数"
    user_question = input("请输入问题: ").strip()
    

    result = app.invoke({"user_query": user_question}, config=config)

    # HITL 循环：每次遇到 interrupt 都由人工输入审批结果
    while "__interrupt__" in result:
        print("\n[需要人工审核]")
        interrupts = result.get("__interrupt__", [])
        for idx, item in enumerate(interrupts, start=1):
            payload = getattr(item, "value", item)
            print(f"  审核任务 {idx}: {payload}")

        payload = getattr(interrupts[0], "value", interrupts[0]) if interrupts else {}
        task = payload.get("task", "") if isinstance(payload, dict) else ""

        if task == "请审查 intake 实体抽取结果":
            current_entities = payload.get("entities", {}) if isinstance(payload, dict) else {}
            print("\n[实体审查]")
            print(f"当前抽取结果: {current_entities}")
            print(f"缺失必填项: {payload.get('missing_required', [])}")

            decision = input("实体是否通过审查? [y/n]: ").strip().lower()
            approved = decision in ("y", "yes", "1", "true")
            feedback = input("请输入审查反馈(可为空): ").strip()

            print("\n如需补填请直接输入，留空表示保持当前值。")
            loc = current_entities.get("location", {}) if isinstance(current_entities, dict) else {}
            full_name = input(f"full_name [{loc.get('full_name', '')}]: ").strip()
            province = input(f"province [{loc.get('province', '')}]: ").strip()
            city = input(f"city [{loc.get('city', '')}]: ").strip()
            county = input(f"county [{loc.get('county', '')}]: ").strip()
            model = input(f"model [{current_entities.get('model', '')}]: ").strip()
            params_raw = input(f"parameters(逗号分隔) [{','.join(current_entities.get('parameters', []))}]: ").strip()
            vegetation_type = input(
                f"vegetation_type [{current_entities.get('vegetation_type', '')}]: "
            ).strip()
            experiment_time_range = input(
                f"experiment_time_range [{current_entities.get('experiment_time_range', '')}]: "
            ).strip()

            patch: Dict[str, Any] = {"location": {}}
            if full_name:
                patch["location"]["full_name"] = full_name
            if province:
                patch["location"]["province"] = province
            if city:
                patch["location"]["city"] = city
            if county:
                patch["location"]["county"] = county
            if not patch["location"]:
                patch.pop("location")
            if model:
                patch["model"] = model
            if params_raw:
                patch["parameters"] = [x.strip() for x in params_raw.split(",") if x.strip()]
            if vegetation_type:
                patch["vegetation_type"] = vegetation_type
            if experiment_time_range:
                patch["experiment_time_range"] = experiment_time_range

            resume_payload = {"approved": approved, "feedback": feedback, "entities_patch": patch}
        else:
            decision = input("是否通过审批? [y/n]: ").strip().lower()
            approved = decision in ("y", "yes", "1", "true")
            feedback = input("请输入反馈(可为空): ").strip()
            resume_payload = {"approved": approved, "feedback": feedback}

        result = app.invoke(Command(resume=resume_payload), config=config)

    print("\n[最终结果]")
    print(result.get("final_response", result))
