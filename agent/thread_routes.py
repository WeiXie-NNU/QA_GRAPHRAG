from datetime import datetime
import json
from typing import Any, Callable, Dict, List, Optional

from fastapi import Header, HTTPException, Query
from pydantic import BaseModel

from thread_maintenance import (
    DEFAULT_USER_ID,
    backfill_thread_message_log,
    collect_thread_inventory,
    ensure_thread_metadata_row,
    get_thread_backfill_stats,
)
from thread_message_store import (
    fetch_all_thread_messages,
    fetch_thread_messages_page,
    get_thread_message_count,
    setup_thread_message_tables,
)


_thread_backfill_last_scan: Dict[str, datetime] = {}


class MessageItem(BaseModel):
    id: str
    role: str  # "user" | "assistant"
    content: str


class ThreadStateResponse(BaseModel):
    thread_id: str
    thread_exists: bool
    messages: List[MessageItem]
    agentState: Optional[Dict[str, Any]] = None


class ThreadMessagesPageResponse(BaseModel):
    thread_id: str
    messages: List[Dict[str, Any]]
    has_more: bool
    next_before_id: Optional[int] = None
    count: int = 0


class ThreadClientStateResponse(BaseModel):
    thread_id: str
    thread_exists: bool
    agentState: Optional[Dict[str, Any]] = None
    message_count: int = 0


class ThreadBackfillStatsResponse(BaseModel):
    total_threads: int
    threads_with_message_log: int
    threads_pending_backfill: int
    total_message_rows: int
    pending_preview: List[Dict[str, Any]]


class ThreadMetaUpsertRequest(BaseModel):
    id: str
    name: str
    createdAt: str
    agent: str
    userId: Optional[str] = None


class ThreadMetaBatchUpsertRequest(BaseModel):
    threads: List[ThreadMetaUpsertRequest]


async def setup_thread_metadata_table(db_conn: Any) -> None:
    """初始化线程元数据表。"""
    await db_conn.execute(
        """
        CREATE TABLE IF NOT EXISTS thread_metadata (
            thread_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            agent TEXT NOT NULL DEFAULT 'test',
            user_id TEXT NOT NULL DEFAULT 'demo',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    async with db_conn.execute("PRAGMA table_info(thread_metadata)") as cursor:
        columns = await cursor.fetchall()
    column_names = {str(column[1]) for column in columns}
    if "user_id" not in column_names:
        await db_conn.execute(
            "ALTER TABLE thread_metadata ADD COLUMN user_id TEXT NOT NULL DEFAULT 'demo'"
        )
    await db_conn.execute(
        "UPDATE thread_metadata SET user_id = ? WHERE user_id IS NULL OR user_id = ''",
        (DEFAULT_USER_ID,),
    )
    await db_conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_thread_metadata_agent ON thread_metadata(agent)"
    )
    await db_conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_thread_metadata_user_id ON thread_metadata(user_id)"
    )
    await db_conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_thread_metadata_user_agent ON thread_metadata(user_id, agent)"
    )
    await db_conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_thread_metadata_updated_at ON thread_metadata(updated_at DESC)"
    )
    await db_conn.execute(
        """
        CREATE TABLE IF NOT EXISTS thread_agent_state (
            thread_id TEXT PRIMARY KEY,
            agent_state_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(thread_id) REFERENCES thread_metadata(thread_id) ON DELETE CASCADE
        )
        """
    )
    await db_conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_thread_agent_state_updated_at ON thread_agent_state(updated_at DESC)"
    )
    await setup_thread_message_tables(db_conn)
    await db_conn.commit()


async def setup_checkpoint_indexes(db_conn: Any) -> None:
    """为 LangGraph checkpoints 表补充常用索引，提升线程查询/清理性能。"""
    await db_conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_checkpoints_thread_id ON checkpoints(thread_id)"
    )
    await db_conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_checkpoints_thread_checkpoint ON checkpoints(thread_id, checkpoint_id)"
    )
    await db_conn.commit()


def register_thread_routes(
    app: Any,
    get_db_conn: Callable[[], Any],
    get_graphrag_storage: Callable[[], Any],
    get_graph_by_agent: Callable[[str], Any],
) -> None:
    def _normalize_user_id(raw_user_id: Optional[str]) -> str:
        user_id = str(raw_user_id or DEFAULT_USER_ID).strip().lower()
        return user_id or DEFAULT_USER_ID

    async def _upsert_thread_metadata(
        thread_id: str,
        name: str,
        agent: str = "test",
        user_id: str = DEFAULT_USER_ID,
        created_at: Optional[str] = None,
        do_commit: bool = True,
    ) -> None:
        """插入或更新线程元数据。"""
        db_conn = get_db_conn()
        now = datetime.now().isoformat()
        created = created_at or now
        await db_conn.execute(
            """
            INSERT INTO thread_metadata (thread_id, name, agent, user_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(thread_id) DO UPDATE SET
                name = excluded.name,
                agent = excluded.agent,
                user_id = CASE
                    WHEN thread_metadata.user_id IS NULL
                        OR thread_metadata.user_id = ''
                        OR thread_metadata.user_id = ?
                        THEN excluded.user_id
                    ELSE thread_metadata.user_id
                END,
                created_at = COALESCE(thread_metadata.created_at, excluded.created_at),
                updated_at = excluded.updated_at
            """,
            (
                thread_id,
                name,
                agent,
                _normalize_user_id(user_id),
                created,
                now,
                DEFAULT_USER_ID,
            ),
        )
        if do_commit:
            await db_conn.commit()

    async def _get_thread_owner(thread_id: str) -> Optional[str]:
        db_conn = get_db_conn()
        async with db_conn.execute(
            "SELECT user_id FROM thread_metadata WHERE thread_id = ? LIMIT 1",
            (thread_id,),
        ) as cursor:
            row = await cursor.fetchone()
            if row and row[0]:
                return _normalize_user_id(row[0])
        return None

    async def _load_agent_state_payload(thread_id: str) -> Optional[Dict[str, Any]]:
        db_conn = get_db_conn()
        try:
            async with db_conn.execute(
                "SELECT agent_state_json FROM thread_agent_state WHERE thread_id = ?",
                (thread_id,),
            ) as cursor:
                row = await cursor.fetchone()
                if row and row[0]:
                    return json.loads(row[0])
        except Exception as e:
            print(f"[WARN] 获取线程 Agent 状态失败: {e}")
        return None

    async def _thread_exists(thread_id: str) -> bool:
        db_conn = get_db_conn()
        checks = (
            ("SELECT 1 FROM thread_messages WHERE thread_id = ? LIMIT 1", (thread_id,)),
            ("SELECT 1 FROM thread_metadata WHERE thread_id = ? LIMIT 1", (thread_id,)),
            ("SELECT 1 FROM thread_agent_state WHERE thread_id = ? LIMIT 1", (thread_id,)),
            ("SELECT 1 FROM checkpoints WHERE thread_id = ? LIMIT 1", (thread_id,)),
        )
        for query, params in checks:
            async with db_conn.execute(query, params) as cursor:
                if await cursor.fetchone():
                    return True
        return False

    async def _assert_thread_access(
        thread_id: str,
        current_user_id: str,
        *,
        agent: str = "test",
        allow_claim: bool = False,
    ) -> bool:
        owner = await _get_thread_owner(thread_id)
        if owner:
            return owner == current_user_id

        if not await _thread_exists(thread_id):
            return False

        if not allow_claim:
            return False

        db_conn = get_db_conn()
        await ensure_thread_metadata_row(
            db_conn,
            thread_id,
            agent=agent or "test",
            user_id=current_user_id,
        )
        await db_conn.commit()
        return True

    async def _ensure_thread_message_log(thread_id: str, agent: str) -> int:
        db_conn = get_db_conn()
        message_count = await get_thread_message_count(db_conn, thread_id)
        if message_count > 0:
            return message_count

        graph = get_graph_by_agent(agent or "test")
        try:
            await ensure_thread_metadata_row(db_conn, thread_id, agent=agent or "test")
            result = await backfill_thread_message_log(
                db_conn,
                graph,
                thread_id,
                agent=agent or "test",
            )
            if result.get("status") in {"backfilled", "skipped"}:
                return int(result.get("message_count") or 0)
        except Exception as e:
            print(f"[WARN] 回填线程消息日志失败: {e}")
        return 0

    async def _read_thread_state(
        thread_id: str,
        agent: str,
        current_user_id: str,
    ) -> ThreadStateResponse:
        can_access = await _assert_thread_access(
            thread_id,
            current_user_id,
            agent=agent,
            allow_claim=current_user_id == DEFAULT_USER_ID,
        )
        if not can_access:
            return ThreadStateResponse(
                thread_id=thread_id,
                thread_exists=False,
                messages=[],
                agentState=None,
            )

        await _ensure_thread_message_log(thread_id, agent)
        rows = await fetch_all_thread_messages(get_db_conn(), thread_id)
        agent_state_payload = await _load_agent_state_payload(thread_id)
        thread_exists = bool(rows) or bool(agent_state_payload) or await _thread_exists(thread_id)
        return ThreadStateResponse(
            thread_id=thread_id,
            thread_exists=thread_exists,
            messages=[MessageItem(**row) for row in rows],
            agentState=agent_state_payload,
        )

    @app.post("/threads/{thread_id}/state", response_model=ThreadStateResponse)
    async def get_thread_state(
        thread_id: str,
        agent: Optional[str] = Query(default="test"),
        x_user_id: Optional[str] = Header(default=DEFAULT_USER_ID, alias="X-User-Id"),
    ):
        """获取指定线程的对话历史。"""
        return await _read_thread_state(
            thread_id=thread_id,
            agent=agent or "test",
            current_user_id=_normalize_user_id(x_user_id),
        )

    @app.get("/threads/{thread_id}/state", response_model=ThreadStateResponse)
    async def get_thread_state_get(
        thread_id: str,
        agent: Optional[str] = Query(default="test"),
        x_user_id: Optional[str] = Header(default=DEFAULT_USER_ID, alias="X-User-Id"),
    ):
        """GET 方式读取线程状态（POST 的兼容别名）。"""
        return await get_thread_state(thread_id=thread_id, agent=agent, x_user_id=x_user_id)

    @app.get("/threads/{thread_id}/messages", response_model=ThreadMessagesPageResponse)
    async def get_thread_messages(
        thread_id: str,
        before_id: Optional[int] = Query(default=None),
        limit: int = Query(default=40, ge=1, le=100),
        agent: Optional[str] = Query(default="test"),
        x_user_id: Optional[str] = Header(default=DEFAULT_USER_ID, alias="X-User-Id"),
    ):
        """分页读取线程历史消息，优先从独立消息日志表读取。"""
        current_user_id = _normalize_user_id(x_user_id)
        can_access = await _assert_thread_access(
            thread_id,
            current_user_id,
            agent=agent or "test",
            allow_claim=current_user_id == DEFAULT_USER_ID,
        )
        if not can_access:
            return ThreadMessagesPageResponse(
                thread_id=thread_id,
                messages=[],
                has_more=False,
                next_before_id=None,
                count=0,
            )

        await _ensure_thread_message_log(thread_id, agent or "test")
        page = await fetch_thread_messages_page(
            get_db_conn(),
            thread_id=thread_id,
            before_id=before_id,
            limit=limit,
        )
        return ThreadMessagesPageResponse(thread_id=thread_id, **page)

    @app.get("/threads/{thread_id}/client-state", response_model=ThreadClientStateResponse)
    async def get_thread_client_state(
        thread_id: str,
        agent: Optional[str] = Query(default="test"),
        x_user_id: Optional[str] = Header(default=DEFAULT_USER_ID, alias="X-User-Id"),
    ):
        """为前端轻量恢复提供线程状态，不返回历史消息正文。"""
        current_user_id = _normalize_user_id(x_user_id)
        can_access = await _assert_thread_access(
            thread_id,
            current_user_id,
            agent=agent or "test",
            allow_claim=current_user_id == DEFAULT_USER_ID,
        )
        if not can_access:
            return ThreadClientStateResponse(
                thread_id=thread_id,
                thread_exists=False,
                agentState=None,
                message_count=0,
            )

        message_count = await get_thread_message_count(get_db_conn(), thread_id)
        agent_state_payload = await _load_agent_state_payload(thread_id)
        return ThreadClientStateResponse(
            thread_id=thread_id,
            thread_exists=True,
            agentState=agent_state_payload,
            message_count=message_count,
        )

    @app.get("/admin/thread-messages/stats", response_model=ThreadBackfillStatsResponse)
    async def get_admin_thread_message_stats(agent: Optional[str] = Query(default=None)):
        """查看历史消息迁移覆盖率，便于离线迁移前后核对。"""
        stats = await get_thread_backfill_stats(
            get_db_conn(),
            agent=agent,
            default_agent=agent or "test",
        )
        return ThreadBackfillStatsResponse(**stats)

    @app.delete("/threads/{thread_id}")
    async def delete_thread(
        thread_id: str,
        x_user_id: Optional[str] = Header(default=DEFAULT_USER_ID, alias="X-User-Id"),
    ):
        """删除指定线程及其关联数据。"""
        db_conn = get_db_conn()
        graphrag_storage = get_graphrag_storage()
        print(f"[INFO] 请求删除线程: {thread_id[:8]}...")
        current_user_id = _normalize_user_id(x_user_id)

        if not await _assert_thread_access(thread_id, current_user_id, allow_claim=False):
            return {"success": False, "message": "线程不存在或无权限"}

        try:
            await db_conn.execute(
                "DELETE FROM checkpoints WHERE thread_id = ?", (thread_id,)
            )

            deleted_rag_count = 0
            if graphrag_storage:
                deleted_rag_count = await graphrag_storage.delete_by_thread(
                    thread_id=thread_id,
                    conn=db_conn,
                )

            await db_conn.execute(
                "DELETE FROM thread_metadata WHERE thread_id = ?",
                (thread_id,),
            )
            await db_conn.execute(
                "DELETE FROM thread_agent_state WHERE thread_id = ?",
                (thread_id,),
            )
            await db_conn.commit()

            print(f"[INFO] 已删除线程 {thread_id[:8]}... (包含 {deleted_rag_count} 条 GraphRAG 记录)")
            return {
                "success": True,
                "message": f"线程 {thread_id[:8]}... 已删除",
                "deleted_graphrag_results": deleted_rag_count,
            }
        except Exception as e:
            print(f"[ERROR] 删除线程失败: {e}")
            return {"success": False, "message": str(e)}

    @app.get("/threads")
    async def list_threads(
        agent: Optional[str] = Query(default="test"),
        offset: int = Query(default=0, ge=0),
        limit: int = Query(default=30, ge=1, le=200),
        x_user_id: Optional[str] = Header(default=DEFAULT_USER_ID, alias="X-User-Id"),
    ):
        """列出所有线程元数据（跨来源共享）。"""
        db_conn = get_db_conn()
        current_user_id = _normalize_user_id(x_user_id)

        try:
            inventory = await collect_thread_inventory(
                db_conn,
                agent=agent,
                user_id=current_user_id,
                default_agent=agent or "test",
            )
            meta_map: Dict[str, Dict[str, Any]] = {
                str(item["thread_id"]): {
                    "id": str(item["thread_id"]),
                    "name": str(item.get("name") or f"历史对话 {str(item['thread_id'])[:8]}"),
                    "createdAt": str(item.get("created_at") or datetime.now().isoformat()),
                    "agent": str(item.get("agent") or agent or "test"),
                    "updatedAt": str(item.get("updated_at") or ""),
                    "userId": str(item.get("user_id") or current_user_id),
                }
                for item in inventory
            }

            threads = sorted(
                meta_map.values(),
                key=lambda item: item.get("updatedAt") or item.get("createdAt") or "",
                reverse=True,
            )
            total_count = len(threads)
            page = threads[offset: offset + limit]
            has_more = offset + len(page) < total_count
            return {
                "threads": page,
                "count": total_count,
                "offset": offset,
                "limit": limit,
                "has_more": has_more,
            }
        except Exception as e:
            print(f"[ERROR] 列出线程失败: {e}")
            return {"threads": [], "count": 0, "error": str(e)}

    @app.post("/threads")
    async def create_or_upsert_thread_meta(
        payload: ThreadMetaUpsertRequest,
        x_user_id: Optional[str] = Header(default=DEFAULT_USER_ID, alias="X-User-Id"),
    ):
        """创建或更新单个线程元数据。"""
        current_user_id = _normalize_user_id(payload.userId or x_user_id)
        owner = await _get_thread_owner(payload.id)
        if owner and owner not in {current_user_id, DEFAULT_USER_ID}:
            raise HTTPException(status_code=404, detail="线程不存在或无权限")
        try:
            await _upsert_thread_metadata(
                thread_id=payload.id,
                name=payload.name,
                agent=payload.agent or "test",
                user_id=current_user_id,
                created_at=payload.createdAt,
            )
            return {"success": True, "thread_id": payload.id}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"保存线程元数据失败: {e}")

    @app.post("/threads/batch")
    async def batch_upsert_thread_meta(
        payload: ThreadMetaBatchUpsertRequest,
        x_user_id: Optional[str] = Header(default=DEFAULT_USER_ID, alias="X-User-Id"),
    ):
        """批量导入/更新线程元数据（用于 localStorage 迁移）。"""
        db_conn = get_db_conn()
        current_user_id = _normalize_user_id(x_user_id)
        try:
            count = 0
            for item in payload.threads:
                owner = await _get_thread_owner(item.id)
                if owner and owner not in {current_user_id, DEFAULT_USER_ID}:
                    continue
                await _upsert_thread_metadata(
                    thread_id=item.id,
                    name=item.name,
                    agent=item.agent or "test",
                    user_id=current_user_id,
                    created_at=item.createdAt,
                    do_commit=False,
                )
                count += 1
            if count > 0:
                await db_conn.commit()
            return {"success": True, "upserted": count}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"批量保存线程元数据失败: {e}")

    @app.patch("/threads/{thread_id}")
    async def rename_thread_meta(
        thread_id: str,
        payload: Dict[str, Any],
        x_user_id: Optional[str] = Header(default=DEFAULT_USER_ID, alias="X-User-Id"),
    ):
        """重命名线程。"""
        db_conn = get_db_conn()
        new_name = str(payload.get("name", "") or "").strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="name 不能为空")
        current_user_id = _normalize_user_id(x_user_id)
        if not await _assert_thread_access(thread_id, current_user_id, allow_claim=False):
            raise HTTPException(status_code=404, detail="线程不存在或无权限")
        try:
            now = datetime.now().isoformat()
            await db_conn.execute(
                "UPDATE thread_metadata SET name = ?, updated_at = ? WHERE thread_id = ? AND user_id = ?",
                (new_name, now, thread_id, current_user_id),
            )
            await db_conn.commit()
            return {"success": True, "thread_id": thread_id, "name": new_name}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"重命名线程失败: {e}")

    @app.put("/threads/{thread_id}/agent-state")
    async def upsert_thread_agent_state(
        thread_id: str,
        payload: Dict[str, Any],
        x_user_id: Optional[str] = Header(default=DEFAULT_USER_ID, alias="X-User-Id"),
    ):
        """保存线程 Agent 状态快照（后端持久化，跨 origin 共享）。"""
        db_conn = get_db_conn()
        current_user_id = _normalize_user_id(x_user_id)
        owner = await _get_thread_owner(thread_id)
        if owner and owner not in {current_user_id, DEFAULT_USER_ID}:
            raise HTTPException(status_code=404, detail="线程不存在或无权限")
        try:
            import json as _json

            now = datetime.now().isoformat()
            await db_conn.execute(
                """
                INSERT INTO thread_metadata (thread_id, name, agent, user_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(thread_id) DO UPDATE SET
                    agent = COALESCE(thread_metadata.agent, excluded.agent),
                    user_id = CASE
                        WHEN thread_metadata.user_id IS NULL
                            OR thread_metadata.user_id = ''
                            OR thread_metadata.user_id = ?
                            THEN excluded.user_id
                        ELSE thread_metadata.user_id
                    END,
                    updated_at = excluded.updated_at
                """,
                (
                    thread_id,
                    f"历史对话 {thread_id[:8]}",
                    "test",
                    current_user_id,
                    now,
                    now,
                    DEFAULT_USER_ID,
                ),
            )

            await db_conn.execute(
                """
                INSERT INTO thread_agent_state (thread_id, agent_state_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(thread_id) DO UPDATE SET
                    agent_state_json = excluded.agent_state_json,
                    updated_at = excluded.updated_at
                """,
                (thread_id, _json.dumps(payload, ensure_ascii=False), now),
            )
            await db_conn.commit()
            return {"success": True, "thread_id": thread_id, "updatedAt": now}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"保存 Agent 状态失败: {e}")

    @app.get("/threads/{thread_id}/agent-state")
    async def get_thread_agent_state(
        thread_id: str,
        x_user_id: Optional[str] = Header(default=DEFAULT_USER_ID, alias="X-User-Id"),
    ):
        """读取线程 Agent 状态快照。"""
        db_conn = get_db_conn()
        current_user_id = _normalize_user_id(x_user_id)
        can_access = await _assert_thread_access(
            thread_id,
            current_user_id,
            allow_claim=current_user_id == DEFAULT_USER_ID,
        )
        if not can_access:
            return {"thread_id": thread_id, "agentState": None}
        try:
            async with db_conn.execute(
                "SELECT agent_state_json, updated_at FROM thread_agent_state WHERE thread_id = ?",
                (thread_id,),
            ) as cursor:
                row = await cursor.fetchone()
                if not row:
                    return {"thread_id": thread_id, "agentState": None}
                import json as _json
                return {
                    "thread_id": thread_id,
                    "agentState": _json.loads(row[0]),
                    "updatedAt": row[1],
                }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"读取 Agent 状态失败: {e}")
