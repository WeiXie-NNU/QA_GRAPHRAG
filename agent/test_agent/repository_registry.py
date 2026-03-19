"""
模型知识仓库注册与 GraphRAG 标准产物发现。

本模块只负责发现和描述已经构建好的 GraphRAG 仓库，不负责建图。

支持两种常见目录布局：

1. resources/repositories/<MODEL>/
   - settings.yaml
   - output/

2. resources/repositories/<MODEL>/kg/
   - settings.yaml
   - output/
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

REQUIRED_OUTPUT_FILES = (
    "entities.parquet",
    "relationships.parquet",
    "communities.parquet",
    "text_units.parquet",
)

GLOBAL_SEARCH_REQUIRED_FILES = REQUIRED_OUTPUT_FILES
LOCAL_SEARCH_REQUIRED_FILES = GLOBAL_SEARCH_REQUIRED_FILES + ("lancedb",)


@dataclass(frozen=True)
class GraphArtifactLayout:
    name: str
    graph_root: Path
    output_dir: Path
    settings_file: Path
    env_file: Path


@dataclass(frozen=True)
class ModelRepository:
    model_id: str
    model_dir: Path
    graph_root: Path
    kg_dir: Path
    kg_output_dir: Path
    settings_file: Path
    env_file: Path
    cases_csv: Path
    papers_dir: Path
    layout_name: str
    available: bool
    supports_global_search: bool
    supports_local_search: bool
    missing_required_files: List[str]
    status_reason: str


@dataclass(frozen=True)
class KnowledgeGraph:
    id: str
    name: str
    description: str
    capability: str
    keywords: List[str]
    output_dir: Path
    settings_file: Path
    env_file: Optional[Path]
    enabled: bool = True
    priority: int = 0
    available: bool = False
    supports_global_search: bool = False
    supports_local_search: bool = False
    status_reason: str = ""


KnowledgeGraphType = Literal["prosail", "lue", "none"]


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


def _layout_candidates(model_dir: Path) -> List[GraphArtifactLayout]:
    return [
        GraphArtifactLayout(
            name="repo_root",
            graph_root=model_dir,
            output_dir=model_dir / "output",
            settings_file=model_dir / "settings.yaml",
            env_file=model_dir / ".env",
        ),
        GraphArtifactLayout(
            name="kg_subdir",
            graph_root=model_dir / "kg",
            output_dir=model_dir / "kg" / "output",
            settings_file=model_dir / "kg" / "settings.yaml",
            env_file=model_dir / "kg" / ".env",
        ),
    ]


def _score_layout(layout: GraphArtifactLayout) -> int:
    score = 0
    if layout.graph_root.exists():
        score += 1
    if layout.output_dir.exists():
        score += 2
    if layout.settings_file.exists():
        score += 4
    for name in REQUIRED_OUTPUT_FILES:
        if (layout.output_dir / name).exists():
            score += 2
    if (layout.output_dir / "community_reports.parquet").exists():
        score += 1
    if (layout.output_dir / "lancedb").exists():
        score += 1
    return score


def _pick_best_layout(model_dir: Path) -> GraphArtifactLayout:
    candidates = _layout_candidates(model_dir)
    return max(candidates, key=_score_layout)


def _missing_output_items(output_dir: Path, names: tuple[str, ...]) -> List[str]:
    missing: List[str] = []
    for name in names:
        path = output_dir / name
        if not path.exists():
            missing.append(name)
    return missing


def _build_status_reason(
    settings_file: Path,
    missing_required: List[str],
    supports_global_search: bool,
    supports_local_search: bool,
) -> str:
    issues: List[str] = []
    if not settings_file.exists():
        issues.append("missing settings.yaml")
    issues.extend(f"missing {name}" for name in missing_required)
    if supports_global_search and not supports_local_search:
        issues.append("local search disabled: missing lancedb")
    return ", ".join(issues) if issues else "ready"


def _build_repository(model_id: str) -> Optional[ModelRepository]:
    normalized = normalize_model_id(model_id)
    dir_name = MODEL_DIR_MAP.get(normalized, normalized.upper())
    model_dir = get_repository_root() / dir_name
    if not model_dir.exists():
        return None

    layout = _pick_best_layout(model_dir)
    missing_required = _missing_output_items(layout.output_dir, GLOBAL_SEARCH_REQUIRED_FILES)
    supports_global_search = layout.settings_file.exists() and not missing_required
    supports_local_search = supports_global_search and (layout.output_dir / "lancedb").exists()
    available = supports_global_search

    return ModelRepository(
        model_id=normalized,
        model_dir=model_dir,
        graph_root=layout.graph_root,
        kg_dir=layout.graph_root,
        kg_output_dir=layout.output_dir,
        settings_file=layout.settings_file,
        env_file=layout.env_file,
        cases_csv=model_dir / "parameters.csv",
        papers_dir=model_dir / "paper_pdf",
        layout_name=layout.name,
        available=available,
        supports_global_search=supports_global_search,
        supports_local_search=supports_local_search,
        missing_required_files=missing_required,
        status_reason=_build_status_reason(
            layout.settings_file,
            missing_required,
            supports_global_search,
            supports_local_search,
        ),
    )


def list_available_model_ids() -> List[str]:
    root = get_repository_root()
    if not root.exists():
        return []

    available: List[str] = []
    for model_id, dir_name in MODEL_DIR_MAP.items():
        if (root / dir_name).exists():
            available.append(model_id)
    return available


def list_repository_statuses() -> List[ModelRepository]:
    repos: List[ModelRepository] = []
    for model_id in list_available_model_ids():
        repo = _build_repository(model_id)
        if repo is not None:
            repos.append(repo)
    repos.sort(key=lambda item: item.model_id)
    return repos


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
        specs[kg_id] = {**base, **item}
    return specs or defaults


def _build_knowledge_graphs() -> Dict[str, KnowledgeGraph]:
    specs = _load_registry_specs()
    graphs: Dict[str, KnowledgeGraph] = {}

    for kg_id, spec in specs.items():
        model_id = normalize_model_id(kg_id) or kg_id
        repo = get_repository(model_id)

        if repo is None:
            dir_name = MODEL_DIR_MAP.get(model_id, model_id.upper())
            model_dir = get_repository_root() / dir_name
            output_dir = model_dir / "output"
            settings_file = model_dir / "settings.yaml"
            env_file = model_dir / ".env"
            available = False
            supports_global_search = False
            supports_local_search = False
            status_reason = "repository directory not found"
        else:
            output_dir = repo.kg_output_dir
            settings_file = repo.settings_file
            env_file = repo.env_file
            available = repo.available
            supports_global_search = repo.supports_global_search
            supports_local_search = repo.supports_local_search
            status_reason = repo.status_reason

        keywords = [str(k).strip() for k in spec.get("keywords", []) if str(k).strip()]

        graphs[model_id] = KnowledgeGraph(
            id=model_id,
            name=str(spec.get("name", model_id.upper())),
            description=str(spec.get("description", "")),
            capability=str(spec.get("capability", "")),
            keywords=keywords,
            output_dir=output_dir,
            settings_file=settings_file,
            env_file=env_file,
            enabled=bool(spec.get("enabled", True)),
            priority=int(spec.get("priority", 0)),
            available=available,
            supports_global_search=supports_global_search,
            supports_local_search=supports_local_search,
            status_reason=status_reason,
        )

    return graphs


KNOWLEDGE_GRAPHS: Dict[str, KnowledgeGraph] = _build_knowledge_graphs()


def get_knowledge_graph(kg_id: str) -> Optional[KnowledgeGraph]:
    global KNOWLEDGE_GRAPHS
    normalized = normalize_model_id(kg_id)
    hit = KNOWLEDGE_GRAPHS.get(normalized)
    if hit:
        return hit
    KNOWLEDGE_GRAPHS = _build_knowledge_graphs()
    return KNOWLEDGE_GRAPHS.get(normalized)


def get_available_graphs() -> List[KnowledgeGraph]:
    global KNOWLEDGE_GRAPHS
    KNOWLEDGE_GRAPHS = _build_knowledge_graphs()
    return [kg for kg in KNOWLEDGE_GRAPHS.values() if kg.enabled and kg.available]


def get_default_graph() -> Optional[KnowledgeGraph]:
    for preferred in ("prosail", "lue"):
        kg = get_knowledge_graph(preferred)
        if kg and kg.enabled and kg.available:
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
        if not kg.enabled:
            continue
        score = 0
        for kw in kg.keywords:
            kw_lower = kw.lower()
            if kw_lower in query_lower:
                score += 1
                continue
            compact_kw = re_sub_spaces(kw_lower)
            if compact_kw and compact_kw in compact_query:
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
