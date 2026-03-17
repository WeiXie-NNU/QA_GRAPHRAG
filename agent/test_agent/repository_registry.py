"""
模型知识仓库注册与路径解析。

统一目录结构：
- resources/repositories/<MODEL>/...
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Literal


PROJECT_ROOT = Path(__file__).resolve().parents[2]
RESOURCES_DIR = PROJECT_ROOT / "resources"

REPOSITORY_ROOT_CANDIDATES = [
    RESOURCES_DIR / "repositories",
]

DEFAULT_MODEL_ID = "prosail"

MODEL_ALIASES: Dict[str, str] = {
    "prosail": "prosail",
    "prospect_sail": "prosail",
    "lue": "lue",
    "light_use_efficiency": "lue",
    "light_use_efficiency_model": "lue",
}

MODEL_DIR_MAP: Dict[str, str] = {
    "prosail": "PROSAIL",
    "lue": "LUE",
}


@dataclass(frozen=True)
class ModelRepository:
    model_id: str
    model_dir: Path
    kg_dir: Path
    kg_output_dir: Path
    settings_file: Path
    env_file: Path
    cases_csv: Path
    papers_dir: Path


@dataclass
class KnowledgeGraph:
    id: str
    name: str
    description: str
    capability: str
    keywords: List[str]
    output_dir: Path
    env_file: Optional[Path]
    enabled: bool = True
    priority: int = 0


def normalize_model_id(model_id: Optional[str]) -> str:
    raw = (model_id or "").strip().lower()
    return MODEL_ALIASES.get(raw, raw)


def get_repository_root() -> Path:
    for candidate in REPOSITORY_ROOT_CANDIDATES:
        if candidate.exists():
            return candidate
    return REPOSITORY_ROOT_CANDIDATES[0]


def _registry_file_path() -> Path:
    return get_repository_root() / "registry.json"


def _build_repository(model_id: str) -> Optional[ModelRepository]:
    normalized = normalize_model_id(model_id)
    dir_name = MODEL_DIR_MAP.get(normalized, normalized.upper())
    model_dir = get_repository_root() / dir_name
    if not model_dir.exists():
        return None

    kg_dir = model_dir / "kg"
    if not kg_dir.exists():
        kg_dir = model_dir

    kg_output_dir = kg_dir / "output"
    settings_file = kg_dir / "settings.yaml"
    env_file = kg_dir / ".env"
    cases_csv = model_dir / "parameters.csv"
    papers_dir = model_dir / "paper_pdf"

    return ModelRepository(
        model_id=normalized,
        model_dir=model_dir,
        kg_dir=kg_dir,
        kg_output_dir=kg_output_dir,
        settings_file=settings_file,
        env_file=env_file,
        cases_csv=cases_csv,
        papers_dir=papers_dir,
    )


def list_available_model_ids() -> List[str]:
    root = get_repository_root()
    if not root.exists():
        return []

    available: List[str] = []
    for model_id, dir_name in MODEL_DIR_MAP.items():
        model_dir = root / dir_name
        if model_dir.exists():
            available.append(model_id)
    return available


def get_repository(model_id: Optional[str]) -> Optional[ModelRepository]:
    normalized = normalize_model_id(model_id)
    if not normalized:
        normalized = DEFAULT_MODEL_ID

    return _build_repository(normalized)


def get_default_repository() -> Optional[ModelRepository]:
    return get_repository(DEFAULT_MODEL_ID)


def get_cases_csv_path(model_id: Optional[str]) -> Path:
    normalized = normalize_model_id(model_id) or DEFAULT_MODEL_ID
    repo = _build_repository(normalized)
    if repo:
        return repo.cases_csv
    dir_name = MODEL_DIR_MAP.get(normalized, normalized.upper())
    return get_repository_root() / dir_name / "parameters.csv"


def _default_knowledge_graph_specs() -> Dict[str, Dict[str, Any]]:
    return {
        "prosail": {
            "name": "PROSAIL 植被辐射传输模型",
            "description": "PROSAIL 辐射传输模型参数知识图谱",
            "capability": "PROSAIL 叶片/冠层参数（Cab, LAI, Cw, Car, Cm, N 等）推理与配置。",
            "keywords": [
                "prosail",
                "prospect",
                "sail",
                "cab",
                "car",
                "cw",
                "cm",
                "lai",
                "hotspot",
                "叶绿素",
                "叶面积指数",
                "冠层",
            ],
            "model_dir_name": "PROSAIL",
            "kg_output_subpath": "kg/output",
            "env_file_subpath": "kg/.env",
            "enabled": True,
            "priority": 10,
        },
        "lue": {
            "name": "光能利用率模型（LUE）",
            "description": "Light Use Efficiency 模型参数知识图谱",
            "capability": "LUE/GPP/NPP/FPAR/PAR 及温度水分胁迫参数推理。",
            "keywords": [
                "lue",
                "light use efficiency",
                "light-use efficiency",
                "epsilon",
                "epsilon max",
                "epsilon_max",
                "εmax",
                "emax",
                "maximum light use efficiency",
                "gpp",
                "npp",
                "fpar",
                "par",
                "max lue",
                "最大光能利用率",
                "光能利用率",
                "最大利用率",
                "光能利用效率",
                "生产力",
                "碳通量",
            ],
            "model_dir_name": "LUE",
            "kg_output_subpath": "kg/output",
            "env_file_subpath": "kg/.env",
            "enabled": True,
            "priority": 20,
        },
    }


def _load_registry_specs() -> Dict[str, Dict[str, Any]]:
    registry_file = _registry_file_path()
    defaults = _default_knowledge_graph_specs()
    if not registry_file.exists():
        return defaults

    try:
        raw = json.loads(registry_file.read_text(encoding="utf-8"))
    except Exception:
        return defaults

    items = raw.get("knowledge_repositories") if isinstance(raw, dict) else None
    if not isinstance(items, list) or not items:
        return defaults

    specs: Dict[str, Dict[str, Any]] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        kg_id = str(item.get("id", "")).strip().lower()
        if not kg_id:
            continue
        base = defaults.get(kg_id, {})
        merged = {**base, **item}
        specs[kg_id] = merged

    return specs or defaults


def _build_knowledge_graphs() -> Dict[str, KnowledgeGraph]:
    prosail_repo = get_repository("prosail")
    lue_repo = get_repository("lue")
    root = get_repository_root()
    repo_map = {
        "prosail": prosail_repo,
        "lue": lue_repo,
    }
    specs = _load_registry_specs()

    graphs: Dict[str, KnowledgeGraph] = {}
    for kg_id, spec in specs.items():
        model_id = normalize_model_id(kg_id) or kg_id
        repo = repo_map.get(model_id)
        model_dir_name = str(spec.get("model_dir_name", MODEL_DIR_MAP.get(model_id, model_id.upper())))
        model_dir = root / model_dir_name

        kg_output_subpath = str(spec.get("kg_output_subpath", "kg/output"))
        env_file_subpath = str(spec.get("env_file_subpath", "kg/.env"))

        output_dir = repo.kg_output_dir if repo else (model_dir / Path(kg_output_subpath))
        env_file = repo.env_file if repo else (model_dir / Path(env_file_subpath))

        keywords = [str(k).strip() for k in spec.get("keywords", []) if str(k).strip()]

        graphs[model_id] = KnowledgeGraph(
            id=model_id,
            name=str(spec.get("name", model_id.upper())),
            description=str(spec.get("description", "")),
            capability=str(spec.get("capability", "")),
            keywords=keywords,
            output_dir=output_dir,
            env_file=env_file,
            enabled=bool(spec.get("enabled", True)),
            priority=int(spec.get("priority", 0)),
        )
    return graphs


KNOWLEDGE_GRAPHS: Dict[str, KnowledgeGraph] = _build_knowledge_graphs()
KnowledgeGraphType = Literal["prosail", "lue", "none"]


def get_knowledge_graph(kg_id: str) -> Optional[KnowledgeGraph]:
    global KNOWLEDGE_GRAPHS
    normalized = normalize_model_id(kg_id)
    hit = KNOWLEDGE_GRAPHS.get(normalized)
    if hit:
        return hit
    # 运行期允许 registry 或目录热更新，未命中时尝试刷新一次。
    KNOWLEDGE_GRAPHS = _build_knowledge_graphs()
    return KNOWLEDGE_GRAPHS.get(normalized)


def get_available_graphs() -> List[KnowledgeGraph]:
    global KNOWLEDGE_GRAPHS
    # 每次查询可用图谱时刷新，避免进程长驻导致注册信息/目录变更后仍使用旧缓存。
    KNOWLEDGE_GRAPHS = _build_knowledge_graphs()
    return [kg for kg in KNOWLEDGE_GRAPHS.values() if kg.enabled and kg.output_dir.exists()]


def get_default_graph() -> Optional[KnowledgeGraph]:
    for preferred in ("prosail", "lue"):
        kg = KNOWLEDGE_GRAPHS.get(preferred)
        if kg and kg.enabled and kg.output_dir.exists():
            return kg
    available = get_available_graphs()
    return available[0] if available else None


def list_available_graphs() -> List[str]:
    return [kg.id for kg in get_available_graphs()]


def match_knowledge_graph(query: str) -> Optional[str]:
    query_lower = (query or "").lower()
    compact_query = re_sub_spaces(query_lower)
    best_match = None
    best_score = 0
    for kg_id, kg in KNOWLEDGE_GRAPHS.items():
        if not kg.enabled or not kg.output_dir.exists():
            continue
        score = 0
        for kw in kg.keywords:
            kw_lower = kw.lower()
            if kw_lower in query_lower:
                score += 1
                continue
            # 对 "epsilon max" vs "epsilonmax" 这类写法做轻量归一化匹配
            if re_sub_spaces(kw_lower) and re_sub_spaces(kw_lower) in compact_query:
                score += 1
        if score > best_score:
            best_score = score
            best_match = kg_id
    return best_match if best_score > 0 else None


def re_sub_spaces(text: str) -> str:
    return "".join(text.split())


def detect_kg_type(query: str) -> KnowledgeGraphType:
    kg_id = match_knowledge_graph(query)
    if kg_id in ("prosail", "lue"):
        return kg_id
    return "none"
