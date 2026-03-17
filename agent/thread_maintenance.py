from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from thread_message_store import (
    backfill_thread_messages,
    get_thread_message_count,
    normalize_visible_messages,
)

DEFAULT_USER_ID = "demo"


def _now_iso() -> str:
    return datetime.now().isoformat()


async def ensure_thread_metadata_row(
    db_conn: Any,
    thread_id: str,
    agent: str = "test",
    user_id: str = DEFAULT_USER_ID,
    *,
    name: Optional[str] = None,
    created_at: Optional[str] = None,
    updated_at: Optional[str] = None,
) -> None:
    now = _now_iso()
    created = created_at or now
    updated = updated_at or now
    await db_conn.execute(
        """
        INSERT INTO thread_metadata (thread_id, name, agent, user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET
            user_id = CASE
                WHEN thread_metadata.user_id IS NULL
                    OR thread_metadata.user_id = ''
                    OR thread_metadata.user_id = ?
                    THEN excluded.user_id
                ELSE thread_metadata.user_id
            END,
            agent = COALESCE(thread_metadata.agent, excluded.agent),
            name = COALESCE(NULLIF(thread_metadata.name, ''), excluded.name),
            created_at = COALESCE(thread_metadata.created_at, excluded.created_at),
            updated_at = CASE
                WHEN thread_metadata.updated_at IS NULL OR thread_metadata.updated_at = ''
                    THEN excluded.updated_at
                ELSE thread_metadata.updated_at
            END
        """,
        (
            thread_id,
            name or f"历史对话 {thread_id[:8]}",
            agent or "test",
            user_id or DEFAULT_USER_ID,
            created,
            updated,
            DEFAULT_USER_ID,
        ),
    )


async def collect_thread_inventory(
    db_conn: Any,
    *,
    agent: Optional[str] = None,
    user_id: Optional[str] = None,
    default_agent: str = "test",
) -> List[Dict[str, Any]]:
    inventory: Dict[str, Dict[str, Any]] = {}

    async with db_conn.execute(
        """
        SELECT thread_id, name, agent, user_id, created_at, updated_at
        FROM thread_metadata
        """
    ) as cursor:
        rows = await cursor.fetchall()
    for thread_id, name, row_agent, row_user_id, created_at, updated_at in rows:
        if not thread_id:
            continue
        inventory[str(thread_id)] = {
            "thread_id": str(thread_id),
            "name": str(name or f"历史对话 {str(thread_id)[:8]}"),
            "agent": str(row_agent or default_agent),
            "user_id": str(row_user_id or DEFAULT_USER_ID),
            "created_at": str(created_at or ""),
            "updated_at": str(updated_at or ""),
            "message_count": 0,
            "has_message_log": False,
            "has_agent_state": False,
            "has_checkpoint": False,
        }

    async with db_conn.execute(
        """
        SELECT thread_id, COUNT(1) AS message_count, MAX(updated_at) AS latest_updated_at
        FROM thread_messages
        GROUP BY thread_id
        """
    ) as cursor:
        rows = await cursor.fetchall()
    for thread_id, message_count, latest_updated_at in rows:
        if not thread_id:
            continue
        item = inventory.setdefault(
            str(thread_id),
            {
                "thread_id": str(thread_id),
                "name": f"历史对话 {str(thread_id)[:8]}",
                "agent": default_agent,
                "user_id": DEFAULT_USER_ID,
                "created_at": "",
                "updated_at": "",
                "message_count": 0,
                "has_message_log": False,
                "has_agent_state": False,
                "has_checkpoint": False,
            },
        )
        item["message_count"] = int(message_count or 0)
        item["has_message_log"] = bool(message_count)
        if latest_updated_at and not item.get("updated_at"):
            item["updated_at"] = str(latest_updated_at)

    async with db_conn.execute(
        """
        SELECT thread_id, updated_at
        FROM thread_agent_state
        """
    ) as cursor:
        rows = await cursor.fetchall()
    for thread_id, updated_at in rows:
        if not thread_id:
            continue
        item = inventory.setdefault(
            str(thread_id),
            {
                "thread_id": str(thread_id),
                "name": f"历史对话 {str(thread_id)[:8]}",
                "agent": default_agent,
                "user_id": DEFAULT_USER_ID,
                "created_at": "",
                "updated_at": "",
                "message_count": 0,
                "has_message_log": False,
                "has_agent_state": False,
                "has_checkpoint": False,
            },
        )
        item["has_agent_state"] = True
        if updated_at and not item.get("updated_at"):
            item["updated_at"] = str(updated_at)

    async with db_conn.execute(
        """
        SELECT thread_id, MAX(checkpoint_id) AS latest_checkpoint
        FROM checkpoints
        WHERE thread_id IS NOT NULL AND thread_id != ''
        GROUP BY thread_id
        """
    ) as cursor:
        rows = await cursor.fetchall()
    for thread_id, latest_checkpoint in rows:
        if not thread_id:
            continue
        item = inventory.setdefault(
            str(thread_id),
            {
                "thread_id": str(thread_id),
                "name": f"历史对话 {str(thread_id)[:8]}",
                "agent": default_agent,
                "user_id": DEFAULT_USER_ID,
                "created_at": "",
                "updated_at": "",
                "message_count": 0,
                "has_message_log": False,
                "has_agent_state": False,
                "has_checkpoint": False,
            },
        )
        item["has_checkpoint"] = True
        if latest_checkpoint and not item.get("updated_at"):
            item["updated_at"] = str(latest_checkpoint)

    rows = list(inventory.values())
    if agent:
        rows = [item for item in rows if str(item.get("agent") or default_agent) == agent]
    if user_id:
        rows = [item for item in rows if str(item.get("user_id") or DEFAULT_USER_ID) == user_id]

    rows.sort(
        key=lambda item: item.get("updated_at") or item.get("created_at") or "",
        reverse=True,
    )
    return rows


async def get_thread_backfill_stats(
    db_conn: Any,
    *,
    agent: Optional[str] = None,
    user_id: Optional[str] = None,
    default_agent: str = "test",
    preview_limit: int = 20,
) -> Dict[str, Any]:
    inventory = await collect_thread_inventory(
        db_conn,
        agent=agent,
        user_id=user_id,
        default_agent=default_agent,
    )
    pending = [item for item in inventory if not item.get("has_message_log")]
    return {
        "total_threads": len(inventory),
        "threads_with_message_log": sum(1 for item in inventory if item.get("has_message_log")),
        "threads_pending_backfill": len(pending),
        "total_message_rows": sum(int(item.get("message_count") or 0) for item in inventory),
        "pending_preview": [
            {
                "thread_id": item.get("thread_id"),
                "agent": item.get("agent"),
                "updated_at": item.get("updated_at"),
                "has_checkpoint": item.get("has_checkpoint"),
                "has_agent_state": item.get("has_agent_state"),
            }
            for item in pending[: max(0, preview_limit)]
        ],
    }


async def backfill_thread_message_log(
    db_conn: Any,
    graph: Any,
    thread_id: str,
    *,
    agent: str = "test",
    force: bool = False,
) -> Dict[str, Any]:
    existing_count = await get_thread_message_count(db_conn, thread_id)
    if existing_count > 0 and not force:
        return {
            "thread_id": thread_id,
            "agent": agent,
            "status": "skipped",
            "message_count": existing_count,
            "inserted": 0,
        }

    config = {"configurable": {"thread_id": thread_id}}
    state = await graph.aget_state(config)
    raw_messages = state.values.get("messages", []) if state and state.values else []
    normalized = normalize_visible_messages(raw_messages)
    if not normalized:
        return {
            "thread_id": thread_id,
            "agent": agent,
            "status": "empty",
            "message_count": 0,
            "inserted": 0,
        }

    await ensure_thread_metadata_row(db_conn, thread_id, agent=agent)
    inserted = await backfill_thread_messages(db_conn, thread_id, agent or "test", normalized)
    current_count = await get_thread_message_count(db_conn, thread_id)
    return {
        "thread_id": thread_id,
        "agent": agent,
        "status": "backfilled",
        "message_count": current_count,
        "inserted": inserted,
    }
