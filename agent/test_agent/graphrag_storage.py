"""
GraphRAG 结果和地图数据存储服务

将 GraphRAG 的查询结果和地图点数据持久化存储到 SQLite 数据库中，
而不是通过 CopilotKit 状态在前后端来回传递。

优点：
1. 减少状态同步的数据量（从 ~350KB 降到 ~5KB）
2. 结果可持久化，支持历史查询
3. 前端按需获取，减少带宽消耗
4. 多轮对话中，历史数据不会被覆盖
"""

import json
import uuid
import aiosqlite
from datetime import datetime
from typing import Optional, Dict, Any, List
from dataclasses import dataclass


@dataclass
class GraphRAGResultRecord:
    """GraphRAG 查询结果记录"""
    id: str                     # 结果唯一 ID
    thread_id: str              # 对话线程 ID
    search_type: str            # "local" | "global"
    query: str                  # 原始查询
    response: str               # LLM 生成的回答
    context_data: str           # JSON 序列化的上下文数据
    source_documents: str       # JSON 序列化的来源文档列表
    relevance_score: Optional[float]   # 相关性评分 (0-1)
    execution_time: Optional[float]    # 执行时间 (秒)
    token_usage: Optional[int]         # Token 消耗
    created_at: str             # 创建时间 ISO 格式


@dataclass
class GeoDataRecord:
    """地图数据记录"""
    id: str                     # 数据唯一 ID
    thread_id: str              # 对话线程 ID
    place_name: str             # 目标地名
    geo_points: str             # JSON 序列化的地图点数据
    target_params: str          # JSON 序列化的目标参数
    created_at: str             # 创建时间 ISO 格式


class GraphRAGStorage:
    """
    GraphRAG 结果和地图数据存储服务
    
    使用 SQLite 存储 GraphRAG 查询结果和地图点数据，提供：
    - 按 thread_id 存储和检索
    - 按 search_type 过滤
    - 自动清理过期数据
    """
    
    TABLE_NAME = "graphrag_results"
    GEO_TABLE_NAME = "geo_data"
    
    def __init__(self, db_path: str = "sessions.db"):
        """
        初始化存储服务
        
        Args:
            db_path: SQLite 数据库路径（与 checkpointer 共用同一个数据库）
        """
        self.db_path = db_path
        self._initialized = False
    
    async def setup(self, conn: Optional[aiosqlite.Connection] = None) -> None:
        """
        初始化数据库表
        
        Args:
            conn: 可选的数据库连接，如果不提供则创建新连接
        """
        if self._initialized:
            return
        
        close_conn = False
        if conn is None:
            conn = await aiosqlite.connect(self.db_path)
            close_conn = True
        
        try:
            # GraphRAG 结果表
            await conn.execute(f"""
                CREATE TABLE IF NOT EXISTS {self.TABLE_NAME} (
                    id TEXT PRIMARY KEY,
                    thread_id TEXT NOT NULL,
                    search_type TEXT NOT NULL,
                    query TEXT NOT NULL,
                    response TEXT NOT NULL,
                    context_data TEXT,
                    source_documents TEXT,
                    relevance_score REAL,
                    execution_time REAL,
                    token_usage INTEGER,
                    created_at TEXT NOT NULL
                )
            """)
            
            # 地图数据表
            await conn.execute(f"""
                CREATE TABLE IF NOT EXISTS {self.GEO_TABLE_NAME} (
                    id TEXT PRIMARY KEY,
                    thread_id TEXT NOT NULL,
                    place_name TEXT,
                    geo_points TEXT NOT NULL,
                    target_params TEXT,
                    created_at TEXT NOT NULL
                )
            """)
            
            # 创建索引加速查询
            await conn.execute(f"""
                CREATE INDEX IF NOT EXISTS idx_graphrag_thread 
                ON {self.TABLE_NAME} (thread_id)
            """)
            await conn.execute(f"""
                CREATE INDEX IF NOT EXISTS idx_graphrag_type 
                ON {self.TABLE_NAME} (thread_id, search_type)
            """)
            await conn.execute(f"""
                CREATE INDEX IF NOT EXISTS idx_geo_thread 
                ON {self.GEO_TABLE_NAME} (thread_id)
            """)
            
            await conn.commit()
            self._initialized = True
            print(f"[GraphRAGStorage] 数据库表已初始化: {self.TABLE_NAME}")
            
        finally:
            if close_conn:
                await conn.close()
    
    async def save_result(
        self,
        thread_id: str,
        search_type: str,
        query: str,
        response: str,
        context_data: Optional[Dict[str, Any]] = None,
        source_documents: Optional[List[str]] = None,
        relevance_score: Optional[float] = None,
        execution_time: Optional[float] = None,
        token_usage: Optional[int] = None,
        conn: Optional[aiosqlite.Connection] = None,
    ) -> str:
        """
        保存 GraphRAG 查询结果
        
        Args:
            thread_id: 对话线程 ID
            search_type: 搜索类型 ("local" | "global")
            query: 原始查询
            response: LLM 生成的回答
            context_data: 上下文数据（实体、关系等）
            source_documents: 来源文档列表
            relevance_score: 相关性评分
            execution_time: 执行时间
            token_usage: Token 消耗
            conn: 可选的数据库连接
        
        Returns:
            结果记录的 ID
        """
        result_id = str(uuid.uuid4())
        created_at = datetime.now().isoformat()
        
        close_conn = False
        if conn is None:
            conn = await aiosqlite.connect(self.db_path)
            close_conn = True
        
        try:
            await conn.execute(
                f"""
                INSERT INTO {self.TABLE_NAME} 
                (id, thread_id, search_type, query, response, context_data, 
                 source_documents, relevance_score, execution_time, token_usage, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    result_id,
                    thread_id,
                    search_type,
                    query,
                    response,
                    json.dumps(context_data or {}, ensure_ascii=False),
                    json.dumps(source_documents or [], ensure_ascii=False),
                    relevance_score,
                    execution_time,
                    token_usage,
                    created_at,
                )
            )
            await conn.commit()
            
            print(f"[GraphRAGStorage] 保存结果: {result_id} (thread={thread_id}, type={search_type})")
            return result_id
            
        finally:
            if close_conn:
                await conn.close()
    
    async def get_result_by_id(
        self,
        result_id: str,
        conn: Optional[aiosqlite.Connection] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        根据 ID 获取单个结果
        
        Args:
            result_id: 结果 ID
            conn: 可选的数据库连接
        
        Returns:
            结果字典或 None
        """
        close_conn = False
        if conn is None:
            conn = await aiosqlite.connect(self.db_path)
            close_conn = True
        
        try:
            async with conn.execute(
                f"SELECT * FROM {self.TABLE_NAME} WHERE id = ?",
                (result_id,)
            ) as cursor:
                row = await cursor.fetchone()
                if row:
                    return self._row_to_dict(row, cursor.description)
                return None
        finally:
            if close_conn:
                await conn.close()
    
    async def get_results_by_thread(
        self,
        thread_id: str,
        search_type: Optional[str] = None,
        conn: Optional[aiosqlite.Connection] = None,
    ) -> List[Dict[str, Any]]:
        """
        获取指定线程的所有 GraphRAG 结果
        
        Args:
            thread_id: 对话线程 ID
            search_type: 可选的搜索类型过滤
            conn: 可选的数据库连接
        
        Returns:
            结果列表
        """
        close_conn = False
        if conn is None:
            conn = await aiosqlite.connect(self.db_path)
            close_conn = True
        
        try:
            if search_type:
                query = f"SELECT * FROM {self.TABLE_NAME} WHERE thread_id = ? AND search_type = ? ORDER BY created_at DESC"
                params = (thread_id, search_type)
            else:
                query = f"SELECT * FROM {self.TABLE_NAME} WHERE thread_id = ? ORDER BY created_at DESC"
                params = (thread_id,)
            
            async with conn.execute(query, params) as cursor:
                rows = await cursor.fetchall()
                return [self._row_to_dict(row, cursor.description) for row in rows]
        finally:
            if close_conn:
                await conn.close()
    
    async def get_latest_results(
        self,
        thread_id: str,
        conn: Optional[aiosqlite.Connection] = None,
    ) -> Dict[str, Optional[Dict[str, Any]]]:
        """
        获取指定线程的最新 Local 和 Global 结果
        
        Args:
            thread_id: 对话线程 ID
            conn: 可选的数据库连接
        
        Returns:
            {"local": {...}, "global": {...}} 或对应为 None
        """
        results = {"local": None, "global": None}
        
        close_conn = False
        if conn is None:
            conn = await aiosqlite.connect(self.db_path)
            close_conn = True
        
        try:
            for search_type in ["local", "global"]:
                async with conn.execute(
                    f"""
                    SELECT * FROM {self.TABLE_NAME} 
                    WHERE thread_id = ? AND search_type = ? 
                    ORDER BY created_at DESC LIMIT 1
                    """,
                    (thread_id, search_type)
                ) as cursor:
                    row = await cursor.fetchone()
                    if row:
                        results[search_type] = self._row_to_dict(row, cursor.description)
            
            return results
        finally:
            if close_conn:
                await conn.close()
    
    async def delete_by_thread(
        self,
        thread_id: str,
        conn: Optional[aiosqlite.Connection] = None,
    ) -> int:
        """
        删除指定线程的所有结果
        
        Args:
            thread_id: 对话线程 ID
            conn: 可选的数据库连接
        
        Returns:
            删除的记录数
        """
        close_conn = False
        if conn is None:
            conn = await aiosqlite.connect(self.db_path)
            close_conn = True
        
        try:
            cursor = await conn.execute(
                f"DELETE FROM {self.TABLE_NAME} WHERE thread_id = ?",
                (thread_id,)
            )
            # 同时删除地图数据
            await conn.execute(
                f"DELETE FROM {self.GEO_TABLE_NAME} WHERE thread_id = ?",
                (thread_id,)
            )
            await conn.commit()
            deleted = cursor.rowcount
            print(f"[GraphRAGStorage] 删除线程 {thread_id} 的 {deleted} 条记录")
            return deleted
        finally:
            if close_conn:
                await conn.close()
    
    # ============================================================
    # 地图数据存储方法
    # ============================================================
    
    async def save_geo_data(
        self,
        thread_id: str,
        place_name: str,
        geo_points: List[Dict[str, Any]],
        target_params: Optional[List[Dict[str, Any]]] = None,
        conn: Optional[aiosqlite.Connection] = None,
    ) -> str:
        """
        保存地图数据
        
        Args:
            thread_id: 对话线程 ID
            place_name: 目标地名
            geo_points: 地图点数据列表
            target_params: 目标参数列表
            conn: 可选的数据库连接
        
        Returns:
            数据记录的 ID
        """
        data_id = str(uuid.uuid4())
        created_at = datetime.now().isoformat()
        
        close_conn = False
        if conn is None:
            conn = await aiosqlite.connect(self.db_path)
            close_conn = True
        
        try:
            await conn.execute(
                f"""
                INSERT INTO {self.GEO_TABLE_NAME} 
                (id, thread_id, place_name, geo_points, target_params, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    data_id,
                    thread_id,
                    place_name or "",
                    json.dumps(geo_points, ensure_ascii=False),
                    json.dumps(target_params or [], ensure_ascii=False),
                    created_at,
                )
            )
            await conn.commit()
            
            print(f"[GraphRAGStorage] 保存地图数据: {data_id} (thread={thread_id}, points={len(geo_points)})")
            return data_id
            
        finally:
            if close_conn:
                await conn.close()
    
    async def get_geo_data_by_id(
        self,
        data_id: str,
        conn: Optional[aiosqlite.Connection] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        根据 ID 获取地图数据
        
        Args:
            data_id: 数据 ID
            conn: 可选的数据库连接
        
        Returns:
            地图数据字典或 None
        """
        close_conn = False
        if conn is None:
            conn = await aiosqlite.connect(self.db_path)
            close_conn = True
        
        try:
            async with conn.execute(
                f"SELECT * FROM {self.GEO_TABLE_NAME} WHERE id = ?",
                (data_id,)
            ) as cursor:
                row = await cursor.fetchone()
                if row:
                    return self._geo_row_to_dict(row, cursor.description)
                return None
        finally:
            if close_conn:
                await conn.close()
    
    async def get_geo_data_by_thread(
        self,
        thread_id: str,
        conn: Optional[aiosqlite.Connection] = None,
    ) -> List[Dict[str, Any]]:
        """
        获取指定线程的所有地图数据
        
        Args:
            thread_id: 对话线程 ID
            conn: 可选的数据库连接
        
        Returns:
            地图数据列表
        """
        close_conn = False
        if conn is None:
            conn = await aiosqlite.connect(self.db_path)
            close_conn = True
        
        try:
            results = []
            async with conn.execute(
                f"SELECT * FROM {self.GEO_TABLE_NAME} WHERE thread_id = ? ORDER BY created_at DESC",
                (thread_id,)
            ) as cursor:
                async for row in cursor:
                    results.append(self._geo_row_to_dict(row, cursor.description))
            return results
        finally:
            if close_conn:
                await conn.close()
    
    def _geo_row_to_dict(self, row: tuple, description: Any) -> Dict[str, Any]:
        """将地图数据行转换为字典"""
        columns = [col[0] for col in description]
        result = dict(zip(columns, row))
        
        # 解析 JSON 字段
        if result.get("geo_points"):
            try:
                result["geo_points"] = json.loads(result["geo_points"])
            except json.JSONDecodeError:
                result["geo_points"] = []
        
        if result.get("target_params"):
            try:
                result["target_params"] = json.loads(result["target_params"])
            except json.JSONDecodeError:
                result["target_params"] = []
        
        return result
    
    def _row_to_dict(self, row: tuple, description: Any) -> Dict[str, Any]:
        """将数据库行转换为字典"""
        columns = [col[0] for col in description]
        result = dict(zip(columns, row))
        
        # 解析 JSON 字段
        if result.get("context_data"):
            try:
                result["context_data"] = json.loads(result["context_data"])
            except json.JSONDecodeError:
                result["context_data"] = {}
        
        if result.get("source_documents"):
            try:
                result["source_documents"] = json.loads(result["source_documents"])
            except json.JSONDecodeError:
                result["source_documents"] = []
        
        return result


# 全局存储实例
_storage_instance: Optional[GraphRAGStorage] = None


def get_graphrag_storage(db_path: str = "sessions.db") -> GraphRAGStorage:
    """获取全局 GraphRAG 存储实例"""
    global _storage_instance
    if _storage_instance is None:
        _storage_instance = GraphRAGStorage(db_path)
    return _storage_instance
