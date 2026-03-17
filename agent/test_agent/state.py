"""test_agent 状态定义（精简版）"""

from __future__ import annotations

from typing import Annotated, Any, Dict, List, Literal, Optional, TypedDict

from copilotkit import CopilotKitState


def last_value(left: Any, right: Any) -> Any:
    return right if right is not None else left


PROSAIL_PARAMS = {
    "N": {"name": "叶片结构参数", "unit": "-", "range": (1.0, 3.0)},
    "Cab": {"name": "叶绿素含量", "unit": "ug/cm2", "range": (0, 100)},
    "Car": {"name": "类胡萝卜素含量", "unit": "ug/cm2", "range": (0, 30)},
    "Cbrown": {"name": "褐色色素", "unit": "-", "range": (0, 1)},
    "Cw": {"name": "等效水厚度", "unit": "cm", "range": (0.001, 0.05)},
    "Cm": {"name": "干物质含量", "unit": "g/cm2", "range": (0.001, 0.02)},
    "LAI": {"name": "叶面积指数", "unit": "m2/m2", "range": (0, 10)},
    "ALA": {"name": "平均叶倾角", "unit": "deg", "range": (0, 90)},
    "hotspot": {"name": "热点参数", "unit": "-", "range": (0, 1)},
    "tts": {"name": "太阳天顶角", "unit": "deg", "range": (0, 90)},
    "tto": {"name": "观测天顶角", "unit": "deg", "range": (0, 90)},
    "psi": {"name": "相对方位角", "unit": "deg", "range": (0, 360)},
}

PROSAIL_UNITS = {
    "Cab": "ug/cm2",
    "LAI": "m2/m2",
    "Cw": "cm",
}

RouteType = Literal[
    "intent_route",
    "general_qa",
    "model_param_workflow",
]


class GeoLocation(TypedDict):
    lat: float
    lon: float
    display_name: str
    place_name: str
    country: Optional[str]
    state: Optional[str]
    city: Optional[str]
    bounding_box: Optional[List[float]]


class GeoCharacteristics(TypedDict):
    climate_zone: Optional[str]
    koppen_class: Optional[str]
    annual_temp: Optional[float]
    annual_precip: Optional[float]
    humidity: Optional[str]
    vegetation_type: Optional[str]
    biome: Optional[str]
    land_cover: Optional[str]
    phenology_stage: Optional[str]
    elevation: Optional[float]
    slope: Optional[float]
    aspect: Optional[str]
    terrain_type: Optional[str]
    soil_type: Optional[str]
    soil_moisture: Optional[str]
    season: Optional[str]
    data_source: Optional[str]


class GeoPoint(TypedDict):
    id: str
    name: str
    lat: float
    lng: float
    point_type: str
    value: Optional[float]
    param_type: Optional[str]
    metadata: Optional[Dict[str, Any]]


class TargetParam(TypedDict):
    param_code: str
    param_name: str
    unit: str
    valid_range: tuple
    priority: int
    user_hint: Optional[str]


class InferredParam(TypedDict):
    param_code: str
    param_name: str
    value: Optional[float]
    value_range: Optional[tuple]
    confidence: float
    unit: str
    reasoning_chain: List[str]
    evidence_sources: List[str]
    uncertainty_factors: List[str]


class GraphRAGQuery(TypedDict):
    query_text: str
    search_type: str
    context_params: Dict[str, Any]
    cot_prompt: Optional[str]


class GraphRAGResult(TypedDict):
    search_type: str
    query: str
    response: str
    context_data: Optional[Dict[str, Any]]
    source_documents: List[str]
    relevance_score: float
    execution_time: float
    token_usage: int


class StepItem(TypedDict):
    id: str
    node_name: str
    description: str
    status: str
    updates: List[str]
    started_at: Optional[str]
    completed_at: Optional[str]
    error_message: Optional[str]


class ThinkingLog(TypedDict):
    step_id: str
    node_name: str
    thinking_type: str
    content: str
    timestamp: str


class TestAgentState(CopilotKitState):
    user_query: Optional[str]
    intent_route: Optional[str]
    intent_reason: Optional[str]
    kg_id: Optional[str]

    entities: Optional[Dict[str, Any]]
    extraction_error: Optional[str]
    human_check_status: Optional[str]
    human_feedback: Optional[str]
    human_check_retry_count: Optional[int]
    missing_required_entities: Optional[List[str]]
    has_location: Optional[bool]
    geo_context: Optional[Dict[str, Any]]
    approval_status: Optional[str]
    approval_retry_count: Optional[int]

    recommendations: Optional[List[Dict[str, Any]]]
    synthesis_text: Optional[str]
    quality_report: Optional[Dict[str, Any]]

    local_rag_result: Annotated[Optional[Dict[str, Any]], last_value]
    global_rag_result: Annotated[Optional[Dict[str, Any]], last_value]

    final_response: Optional[str]
    final_answer: Optional[str]
    last_answer_msg_id: Optional[str]
    case_geo_data_id: Optional[str]

    steps: Annotated[Optional[List[Dict[str, Any]]], last_value]
    geo_points: Annotated[Optional[List[Dict[str, Any]]], last_value]
    thinking_logs: Annotated[Optional[List[Dict[str, Any]]], last_value]
    errors: Annotated[Optional[List[str]], last_value]


def get_ui_state(state: Dict[str, Any]) -> Dict[str, Any]:
    return {"steps": state.get("steps", [])}


def create_initial_state(user_input: str = "", debug: bool = False) -> Dict[str, Any]:
    return {
        "messages": [],
        "user_query": user_input,
        "intent_route": None,
        "intent_reason": None,
        "kg_id": None,
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
        "last_answer_msg_id": None,
        "case_geo_data_id": None,
        "steps": [],
        "geo_points": [],
        "thinking_logs": [],
        "errors": [],
        "debug_mode": debug,
    }


def get_prosail_param_info(param_code: str) -> Optional[Dict[str, Any]]:
    return PROSAIL_PARAMS.get(param_code)


def validate_param_value(param_code: str, value: float) -> tuple[bool, str]:
    param_info = PROSAIL_PARAMS.get(param_code)
    if not param_info:
        return False, f"未知参数: {param_code}"
    min_val, max_val = param_info["range"]
    if value < min_val or value > max_val:
        return False, f"{param_code} 值 {value} 超出有效范围 [{min_val}, {max_val}]"
    return True, ""


PROSAILState = TestAgentState
