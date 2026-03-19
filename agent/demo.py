"""
Agent 统一入口

提供 FastAPI 服务，集成 CopilotKit AG-UI 协议
支持对话历史持久化和线程管理（使用 AsyncSqliteSaver）
支持并发访问 - 每个会话使用共享数据库但隔离的 thread_id

注册的智能体：
- test: 多步骤测试智能体

使用方法:
    python demo.py
"""

import os
import sys
import uuid
import asyncio
import threading
import re
from importlib.metadata import PackageNotFoundError, version
import uvicorn
import aiosqlite
import pandas as pd
from pathlib import Path
from datetime import datetime, timedelta
from contextlib import asynccontextmanager
from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from pydantic import BaseModel
from typing import List, Optional, Dict, Any

# 设置当前目录为模块搜索路径（确保能找到本地模块）
_current_dir = os.path.dirname(os.path.abspath(__file__))
if _current_dir not in sys.path:
    sys.path.insert(0, _current_dir)

# 使用 CopilotKit AG-UI 方式注册 agents
# copilotkit (0.1.72+) 要求使用 LangGraphAGUIAgent + add_langgraph_fastapi_endpoint
from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from copilotkit.langgraph_agui_agent import LangGraphAGUIAgent
from types import SimpleNamespace

# 加载环境变量（读取 copilotkit_frontend/.env）
from dotenv import load_dotenv
_copilotkit_dir = os.path.abspath(os.path.join(_current_dir, ".."))
load_dotenv(os.path.join(_copilotkit_dir, ".env"))

# 导入 workflow 构建函数
from test_agent.agent import build_workflow as build_test_workflow, build_graph

# 导入配置模块
from test_agent.config import get_llm_model, set_llm_model, get_supported_models

# 导入 GraphRAG 存储服务
from test_agent.graphrag_storage import get_graphrag_storage, GraphRAGStorage
from test_agent.repository_registry import get_repository

# 导入案例服务
from test_agent.prosail_cases import get_case_full_details
from thread_routes import (
    register_thread_routes,
    setup_checkpoint_indexes,
    setup_thread_metadata_table,
)
from thread_maintenance import get_thread_backfill_stats
from llm_routes import register_llm_routes
from graphrag_visual_routes import register_graphrag_visual_routes
from case_extraction import (
    CaseExtractionPromptResponse,
    CaseExtractionRequest,
    CaseExtractionResponse,
    ExtractorType,
    get_prompt_template,
    invoke_case_extraction,
)

# 数据库路径配置
# 优先使用环境变量，否则使用项目 data/ 目录
_project_root = os.path.abspath(os.path.join(_current_dir, ".."))
_data_dir = os.path.join(_project_root, "data")

# 确保 data 目录存在
os.makedirs(_data_dir, exist_ok=True)
os.makedirs(os.path.join(_data_dir, "backups"), exist_ok=True)

DB_PATH = os.getenv("DATABASE_PATH", os.path.join(_data_dir, "chat_history.db"))

print(f"[INFO] 数据库路径: {DB_PATH}")


class SafeLangGraphAGUIAgent(LangGraphAGUIAgent):
    """
    AG-UI/LangGraph 事件兼容层（内联版）。
    处理 on_tool_end 在部分版本中返回 str/dict 的场景，避免 runtime 崩溃。
    """

    async def _handle_single_event(self, event: Any, state: Dict[str, Any]):
        if isinstance(event, dict) and event.get("event") == "on_tool_end":
            data = event.get("data") or {}
            output = data.get("output")
            if isinstance(output, str):
                return
            if isinstance(output, dict) and "tool_call_id" in output:
                data["output"] = SimpleNamespace(**output)
                event["data"] = data

        async for event_str in super()._handle_single_event(event, state):
            yield event_str


def _pkg_version(name: str) -> str:
    try:
        return version(name)
    except PackageNotFoundError:
        return "not-installed"


def _check_hitl_runtime_requirements() -> None:
    """
    LangGraph 官方建议：在 async/streaming 场景使用 Python 3.11+，
    否则可能出现 context 丢失（interrupt/get_config outside runnable context）。
    """
    py = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    lg = _pkg_version("langgraph")
    lc = _pkg_version("langchain-core")
    cpk = _pkg_version("copilotkit")
    agui = _pkg_version("ag-ui-langgraph")
    print(f"[INFO] Runtime versions -> python={py}, langgraph={lg}, langchain-core={lc}, copilotkit={cpk}, ag-ui-langgraph={agui}")

    if sys.version_info < (3, 11):
        raise RuntimeError(
            "当前 Python < 3.11，不满足 LangGraph interrupt 在 async/streaming 下的官方建议。"
            "请升级到 Python 3.11+ 后再启用 HITL。"
        )

# 全局检查点和数据库连接
checkpointer = None
db_conn = None
graphrag_storage: Optional[GraphRAGStorage] = None


# ============ 会话图管理器 ============

class SessionGraphManager:
    """
    会话图管理器 - 支持并发访问
    
    核心设计：
    1. 所有会话共享同一个 SQLite 数据库（chat_history.db）
    2. 通过 thread_id 隔离不同会话的状态
    3. 为每个活跃会话创建独立的图实例，避免状态冲突
    4. 自动清理过期的会话实例，防止内存泄漏
    """
    
    def __init__(self, max_sessions: int = 100, session_ttl_hours: int = 2):
        self._sessions: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.RLock()
        self._async_lock = asyncio.Lock()
        self.max_sessions = max_sessions
        self.session_ttl_hours = session_ttl_hours
        self._global_checkpointer = None
        self._global_graph = None
        
    async def initialize(self, checkpointer: AsyncSqliteSaver):
        """
        初始化会话管理器
        
        Args:
            checkpointer: 共享的 AsyncSqliteSaver 实例
        """
        async with self._async_lock:
            self._global_checkpointer = checkpointer
            
            # 创建全局图实例（用于历史记录查询）
            workflow = build_test_workflow()
            self._global_graph = workflow.compile(checkpointer=checkpointer)
            
            print(f"[SessionManager] 初始化完成，最大会话数: {self.max_sessions}")
    
    def get_global_graph(self):
        """获取全局图实例（用于历史记录查询）"""
        return self._global_graph
    
    async def get_graph_for_session(self, session_id: str) -> Any:
        """
        获取或创建会话特定的图实例
        
        Args:
            session_id: 会话ID（通常是 thread_id）
            
        Returns:
            编译后的 LangGraph 工作流实例
        """
        if not session_id:
            session_id = str(uuid.uuid4())
            print(f"[SessionManager] 生成新会话ID: {session_id[:8]}...")
        
        async with self._async_lock:
            # 清理过期会话
            self._cleanup_expired_sessions()
            
            if session_id not in self._sessions:
                # 为新会话创建独立的图实例，但共享同一个 checkpointer
                workflow = build_test_workflow()
                graph_instance = workflow.compile(checkpointer=self._global_checkpointer)
                
                self._sessions[session_id] = {
                    "graph": graph_instance,
                    "created_at": datetime.now(),
                    "last_access": datetime.now(),
                }
                
                print(f"[SessionManager] 创建会话图实例: {session_id[:8]}... (当前会话数: {len(self._sessions)})")
            else:
                # 更新最后访问时间
                self._sessions[session_id]["last_access"] = datetime.now()
            
            return self._sessions[session_id]["graph"]
    
    def _cleanup_expired_sessions(self):
        """清理过期的会话实例"""
        now = datetime.now()
        cutoff_time = now - timedelta(hours=self.session_ttl_hours)
        
        expired_keys = [
            key for key, session in self._sessions.items()
            if session["last_access"] < cutoff_time
        ]
        
        for key in expired_keys:
            del self._sessions[key]
            print(f"[SessionManager] 清理过期会话: {key[:8]}...")
        
        # 如果会话数量超过限制，清理最旧的会话
        while len(self._sessions) > self.max_sessions:
            oldest_key = min(
                self._sessions.keys(),
                key=lambda k: self._sessions[k]["last_access"]
            )
            del self._sessions[oldest_key]
            print(f"[SessionManager] 清理最旧会话: {oldest_key[:8]}...")
    
    def get_session_stats(self) -> Dict[str, Any]:
        """获取会话统计信息"""
        with self._lock:
            return {
                "total_sessions": len(self._sessions),
                "max_sessions": self.max_sessions,
                "session_ttl_hours": self.session_ttl_hours,
                "sessions": [
                    {
                        "id": key[:8] + "...",
                        "created_at": info["created_at"].isoformat(),
                        "last_access": info["last_access"].isoformat(),
                    }
                    for key, info in self._sessions.items()
                ]
            }


# 全局会话管理器
session_manager = SessionGraphManager(max_sessions=100, session_ttl_hours=2)

# ============ FastAPI 生命周期管理 ============

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI 生命周期管理
    
    启动时初始化 AsyncSqliteSaver 和会话管理器，关闭时清理资源
    """
    global checkpointer, db_conn, graphrag_storage
    _check_hitl_runtime_requirements()
    
    print(f"[INFO] 初始化 SQLite 持久化存储: {DB_PATH}")
    
    # 创建异步 SQLite 连接
    db_conn = await aiosqlite.connect(DB_PATH)
    # 并发与稳定性优化：启用 WAL、合理同步级别和忙等待时间
    await db_conn.execute("PRAGMA journal_mode=WAL")
    await db_conn.execute("PRAGMA synchronous=NORMAL")
    await db_conn.execute("PRAGMA foreign_keys=ON")
    await db_conn.execute("PRAGMA busy_timeout=5000")
    await db_conn.commit()
    checkpointer = AsyncSqliteSaver(db_conn)
    
    # 初始化数据库表
    await checkpointer.setup()
    await setup_checkpoint_indexes(db_conn)
    
    # 初始化 GraphRAG 存储服务
    graphrag_storage = get_graphrag_storage(DB_PATH)
    await graphrag_storage.setup(db_conn)
    print("[INFO] GraphRAG 存储服务已初始化")

    # 初始化线程元数据表（跨来源共享）
    await setup_thread_metadata_table(db_conn)
    print("[INFO] 线程元数据表已初始化")
    backfill_stats = await get_thread_backfill_stats(db_conn, default_agent="test")
    print(
        "[INFO] 历史消息日志覆盖率: "
        f"{backfill_stats['threads_with_message_log']}/{backfill_stats['total_threads']} "
        f"(待迁移 {backfill_stats['threads_pending_backfill']})"
    )
    
    # 初始化会话管理器
    await session_manager.initialize(checkpointer)
    
    # 获取全局图实例（用于注册端点）
    global_graph = session_manager.get_global_graph()
    
    # ========== 使用 AG-UI 方式注册 agent ==========
    # 注册 test agent（使用全局图，但通过 thread_id 隔离会话）
    add_langgraph_fastapi_endpoint(
        app=app,
        agent=SafeLangGraphAGUIAgent(
            name="test",
            description="多步骤测试智能体，用于验证进度显示功能",
            graph=global_graph,
        ),
        path="/copilotkit/agents/test"
    )
    
    print("[INFO] Test Agent 已注册: /copilotkit/agents/test")

    print("=" * 50)
    print("[INFO] 所有智能体已就绪 (AG-UI 模式 + 会话隔离)!")
    print("  - test: /copilotkit/agents/test")
    print(f"  - 数据库: {DB_PATH}")
    print(f"  - 最大并发会话: {session_manager.max_sessions}")
    print("=" * 50)
    
    yield
    
    # 关闭连接
    await db_conn.close()
    print("[INFO] SQLite 连接已关闭")


# 创建 FastAPI 应用
app = FastAPI(
    title="Multi-Agent API",
    description="多智能体服务，支持 RAG 检索和生态参数推理，集成 CopilotKit AG-UI 协议",
    version="2.0.0",
    lifespan=lifespan,
)


def _normalize_pdf_stem(name: str) -> str:
    stem = Path(str(name or "")).stem
    stem = stem.strip().lower()
    # 保留中英文与数字，去除空格和常见标点，便于标题->文件名模糊匹配
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", stem)


def _resolve_case_pdf_path(case_id: str, kg_id: str, requested_filename: Optional[str] = None) -> Optional[Path]:
    repo = get_repository(kg_id)
    if repo is None:
        return None

    papers_dir = repo.papers_dir
    if not papers_dir.exists() or not papers_dir.is_dir():
        return None

    # 构造候选文件名（优先精确匹配）
    candidates: List[str] = []
    if requested_filename:
        candidates.append(Path(requested_filename).name)

    case_detail = get_case_full_details(case_id, kg_id=kg_id)
    if isinstance(case_detail, dict):
        case_meta = case_detail.get("case_details") if isinstance(case_detail.get("case_details"), dict) else {}
        for key in ("pdf_filename", "source_file", "paper_title"):
            val = str(case_meta.get(key, "") or "").strip()
            if not val:
                continue
            if not val.lower().endswith(".pdf"):
                val = f"{val}.pdf"
            candidates.append(Path(val).name)

    # 去重并保持顺序
    seen = set()
    dedup_candidates: List[str] = []
    for x in candidates:
        if not x:
            continue
        if x in seen:
            continue
        seen.add(x)
        dedup_candidates.append(x)

    # 1) 精确文件名匹配
    for filename in dedup_candidates:
        p = (papers_dir / filename).resolve()
        if p.exists() and p.is_file() and p.parent == papers_dir.resolve():
            return p

    # 2) 归一化标题/文件名匹配
    normalized_to_path: Dict[str, Path] = {}
    for p in papers_dir.glob("*.pdf"):
        normalized_to_path[_normalize_pdf_stem(p.name)] = p

    for filename in dedup_candidates:
        key = _normalize_pdf_stem(filename)
        if key and key in normalized_to_path:
            return normalized_to_path[key]

    return None

# 添加 CORS 中间件（允许前端跨域访问）
# 注意：必须在所有路由注册之前添加
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 允许所有来源（生产环境应该限制具体域名）
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],  # 明确列出所有方法
    allow_headers=["*"],  # 允许所有请求头
    expose_headers=["*"],  # 暴露所有响应头
    max_age=3600,  # 预检请求缓存时间（秒）
)


# ============ 健康检查 ============
@app.get("/health")
def health():
    """Health check."""
    return {
        "status": "ok", 
        "persistence": "sqlite", 
        "db_path": DB_PATH,
        "agents": ["test"],
        "concurrent_mode": True,
    }


# ============ GraphRAG 结果 API ============

class GraphRAGResultResponse(BaseModel):
    """GraphRAG 查询结果响应"""
    id: str
    thread_id: str
    search_type: str
    query: str
    response: str
    context_data: Optional[Dict[str, Any]] = None
    source_documents: Optional[List[str]] = None
    relevance_score: float
    execution_time: float
    token_usage: int
    created_at: str


@app.get("/api/graphrag/results/{thread_id}")
async def get_graphrag_results(thread_id: str, search_type: Optional[str] = None):
    """
    获取指定线程的 GraphRAG 查询结果
    
    Args:
        thread_id: 对话线程 ID
        search_type: 可选，过滤搜索类型 ("local" | "global")
    
    Returns:
        GraphRAG 结果列表
    """
    if graphrag_storage is None:
        raise HTTPException(status_code=500, detail="GraphRAG 存储服务未初始化")
    
    results = await graphrag_storage.get_results_by_thread(
        thread_id=thread_id,
        search_type=search_type,
        conn=db_conn,
    )
    
    return {"thread_id": thread_id, "results": results}


@app.get("/api/graphrag/latest/{thread_id}")
async def get_latest_graphrag_results(thread_id: str):
    """
    获取指定线程的最新 Local 和 Global GraphRAG 结果
    
    Args:
        thread_id: 对话线程 ID
    
    Returns:
        {"local": {...}, "global": {...}} 或对应为 null
    """
    if graphrag_storage is None:
        raise HTTPException(status_code=500, detail="GraphRAG 存储服务未初始化")
    
    results = await graphrag_storage.get_latest_results(
        thread_id=thread_id,
        conn=db_conn,
    )
    
    return {"thread_id": thread_id, **results}


@app.get("/api/graphrag/result/{result_id}")
async def get_graphrag_result_by_id(result_id: str):
    """
    根据 ID 获取单个 GraphRAG 查询结果
    
    Args:
        result_id: 结果记录 ID
    
    Returns:
        GraphRAG 结果详情
    """
    if graphrag_storage is None:
        raise HTTPException(status_code=500, detail="GraphRAG 存储服务未初始化")
    
    result = await graphrag_storage.get_result_by_id(
        result_id=result_id,
        conn=db_conn,
    )
    
    if result is None:
        raise HTTPException(status_code=404, detail=f"未找到结果: {result_id}")
    
    return result


@app.delete("/api/graphrag/results/{thread_id}")
async def delete_graphrag_results(thread_id: str):
    """
    删除指定线程的所有 GraphRAG 结果
    
    Args:
        thread_id: 对话线程 ID
    
    Returns:
        删除的记录数
    """
    if graphrag_storage is None:
        raise HTTPException(status_code=500, detail="GraphRAG 存储服务未初始化")
    
    deleted = await graphrag_storage.delete_by_thread(
        thread_id=thread_id,
        conn=db_conn,
    )
    
    return {"thread_id": thread_id, "deleted_count": deleted}


# ============ 地图数据 API ============

@app.get("/api/geo/{data_id}")
async def get_geo_data(data_id: str):
    """
    获取地图数据
    
    Args:
        data_id: 地图数据 ID
    
    Returns:
        地图数据（包含 geo_points 和 target_params）
    """
    if graphrag_storage is None:
        raise HTTPException(status_code=500, detail="存储服务未初始化")
    
    result = await graphrag_storage.get_geo_data_by_id(
        data_id=data_id,
        conn=db_conn,
    )
    
    if result is None:
        raise HTTPException(status_code=404, detail=f"未找到地图数据: {data_id}")
    
    return result


@app.get("/api/geo/thread/{thread_id}")
async def get_geo_data_by_thread(thread_id: str):
    """
    获取指定线程的所有地图数据
    
    Args:
        thread_id: 对话线程 ID
    
    Returns:
        地图数据列表
    """
    if graphrag_storage is None:
        raise HTTPException(status_code=500, detail="存储服务未初始化")
    
    results = await graphrag_storage.get_geo_data_by_thread(
        thread_id=thread_id,
        conn=db_conn,
    )
    
    return {"thread_id": thread_id, "data": results}


# ============ 案例详情 API ============

@app.get("/api/case/{case_id}")
async def get_case_details(case_id: str, kg_id: Optional[str] = Query(None, description="知识仓库ID，如 prosail/lue")):
    """
    获取 PROSAIL 案例的完整详情
    
    Args:
        case_id: 案例 ID
    
    Returns:
        完整的案例详情（包含 case_details 和 parameters）
    """
    result = get_case_full_details(case_id, kg_id=kg_id or "prosail")
    
    if result is None:
        raise HTTPException(status_code=404, detail=f"未找到案例: {case_id}")
    
    return result


@app.get("/api/case/{case_id}/pdf")
async def download_case_pdf(
    case_id: str,
    kg_id: Optional[str] = Query(None, description="知识仓库ID，如 prosail/lue"),
    filename: Optional[str] = Query(None, description="可选：前端传入的文件名提示"),
):
    """
    下载案例对应论文 PDF。
    文件统一从 resources/repositories/<MODEL>/paper_pdf/ 目录解析。
    """
    resolved_kg = (kg_id or "prosail").strip().lower()
    pdf_path = _resolve_case_pdf_path(case_id=case_id, kg_id=resolved_kg, requested_filename=filename)
    if pdf_path is None:
        raise HTTPException(status_code=404, detail=f"未找到 PDF 文件: case_id={case_id}, kg_id={resolved_kg}")

    return FileResponse(
        path=str(pdf_path),
        media_type="application/pdf",
        filename=pdf_path.name,
    )


# ============ 会话管理 API ============

@app.get("/api/sessions/stats")
async def get_session_stats():
    """获取会话统计信息（用于监控并发状态）"""
    return session_manager.get_session_stats()


@app.post("/api/sessions/cleanup")
async def cleanup_sessions():
    """手动触发会话清理"""
    session_manager._cleanup_expired_sessions()
    stats = session_manager.get_session_stats()
    return {
        "success": True,
        "message": "会话清理完成",
        "remaining_sessions": stats["total_sessions"]
    }


# ============ 案例提取工具 API ============

@app.get("/api/tools/case-extraction/prompts/{extractor_type}", response_model=CaseExtractionPromptResponse)
async def get_case_extraction_prompt(extractor_type: ExtractorType):
    return CaseExtractionPromptResponse(
        extractor_type=extractor_type,
        prompt_template=get_prompt_template(extractor_type),
    )


@app.post("/api/tools/case-extraction/extract", response_model=CaseExtractionResponse)
async def extract_case_from_paper(payload: CaseExtractionRequest):
    paper_text = payload.paper_text.strip()
    if len(paper_text) > 120_000:
        raise HTTPException(status_code=413, detail="论文文本过长，请先裁剪后再提取。")

    try:
        result = await asyncio.to_thread(
            invoke_case_extraction,
            payload.extractor_type,
            paper_text,
            payload.paper_title.strip(),
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"案例提取失败: {exc}") from exc

    return CaseExtractionResponse(
        extractor_type=payload.extractor_type,
        model=str(result["model"]),
        paper_title=payload.paper_title.strip(),
        raw_output=str(result["raw_output"]),
        is_none=bool(result["is_none"]),
        parsed_result=result["parsed_result"],
        parse_status=result["parse_status"],
    )


# ============ 线程历史 API ============

register_thread_routes(
    app=app,
    get_db_conn=lambda: db_conn,
    get_graphrag_storage=lambda: graphrag_storage,
    get_graph_by_agent=lambda _agent: session_manager.get_global_graph(),
)


# ============ LLM 模型管理 API ============

register_llm_routes(
    app=app,
    get_supported_models=get_supported_models,
    get_llm_model=get_llm_model,
    set_llm_model=set_llm_model,
)


# ============ GraphRAG 可视化 API ============

register_graphrag_visual_routes(
    app=app,
    get_repository=get_repository,
)

# ============ 主入口 ============

if __name__ == "__main__":

    print("启动服务器（支持局域网访问）:")
    print("  - 本地访问: http://127.0.0.1:8089")
    print("  - 局域网访问: http://<你的IP>:8089")
    print("=" * 50)
    
    uvicorn_reload = os.getenv("UVICORN_RELOAD", "0").strip() == "1"
    uvicorn_port = int(os.getenv("AGENT_PORT", "8090"))
    uvicorn.run(
        app,
        host="0.0.0.0",  # 监听所有网络接口，支持局域网访问
        port=uvicorn_port,
        reload=uvicorn_reload,
    )
