from __future__ import annotations

import hashlib
import os
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence

import aiosqlite


_CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.abspath(os.path.join(_CURRENT_DIR, ".."))
_DATA_DIR = os.path.join(_PROJECT_ROOT, "data")
DEFAULT_DB_PATH = os.getenv("DATABASE_PATH", os.path.join(_DATA_DIR, "chat_history.db"))
DEFAULT_USER_ID = "demo"


def _now_iso() -> str:
    return datetime.now().isoformat()


def _make_stable_message_id(prefix: str, *parts: str) -> str:
    payload = "||".join(str(part or "") for part in parts)
    digest = hashlib.sha1(payload.encode("utf-8")).hexdigest()[:20]
    return f"{prefix}:{digest}"


def normalize_visible_messages(raw_messages: Sequence[Any]) -> List[Dict[str, str]]:
    normalized: List[Dict[str, str]] = []
    for index, msg in enumerate(raw_messages):
        msg_type = msg.__class__.__name__
        if msg_type not in ("HumanMessage", "AIMessage"):
            continue
        if msg_type == "AIMessage" and getattr(msg, "tool_calls", None):
            continue

        content = msg.content if isinstance(msg.content, str) else str(msg.content)
        if not content or not content.strip():
            continue

        role = "user" if msg_type == "HumanMessage" else "assistant"
        message_id = str(getattr(msg, "id", "") or "")
        if not message_id:
            message_id = _make_stable_message_id(role, str(index), content)

        normalized.append(
            {
                "id": message_id,
                "role": role,
                "content": content,
            }
        )
    return normalized


async def setup_thread_message_tables(db_conn: Any) -> None:
    await db_conn.execute(
        """
        CREATE TABLE IF NOT EXISTS thread_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            thread_id TEXT NOT NULL,
            turn_id TEXT NOT NULL,
            message_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            agent TEXT NOT NULL DEFAULT 'test',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(thread_id) REFERENCES thread_metadata(thread_id) ON DELETE CASCADE,
            UNIQUE(thread_id, message_id)
        )
        """
    )
    await db_conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_thread_messages_thread_id_id ON thread_messages(thread_id, id DESC)"
    )
    await db_conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_thread_messages_thread_id_turn_id ON thread_messages(thread_id, turn_id)"
    )
    await db_conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_thread_messages_thread_id_updated_at ON thread_messages(thread_id, updated_at DESC)"
    )
    await db_conn.commit()


async def get_thread_message_count(db_conn: Any, thread_id: str) -> int:
    async with db_conn.execute(
        "SELECT COUNT(1) FROM thread_messages WHERE thread_id = ?",
        (thread_id,),
    ) as cursor:
        row = await cursor.fetchone()
    return int(row[0] or 0) if row else 0


async def fetch_all_thread_messages(db_conn: Any, thread_id: str) -> List[Dict[str, str]]:
    rows: List[Any] = []
    async with db_conn.execute(
        """
        SELECT message_id, role, content
        FROM thread_messages
        WHERE thread_id = ?
        ORDER BY id ASC
        """,
        (thread_id,),
    ) as cursor:
        rows = await cursor.fetchall()

    return [
        {
            "id": str(message_id),
            "role": str(role),
            "content": str(content),
        }
        for message_id, role, content in rows
    ]


async def fetch_thread_messages_page(
    db_conn: Any,
    thread_id: str,
    before_id: Optional[int] = None,
    limit: int = 40,
) -> Dict[str, Any]:
    params: List[Any] = [thread_id]
    query = """
        SELECT id, message_id, role, content, created_at
        FROM thread_messages
        WHERE thread_id = ?
    """
    if before_id is not None:
        query += " AND id < ?"
        params.append(before_id)
    query += " ORDER BY id DESC LIMIT ?"
    params.append(limit)

    rows: List[Any] = []
    async with db_conn.execute(query, tuple(params)) as cursor:
        rows = await cursor.fetchall()

    messages = [
        {
            "id": str(message_id),
            "role": str(role),
            "content": str(content),
            "createdAt": str(created_at),
            "rowId": int(row_id),
        }
        for row_id, message_id, role, content, created_at in reversed(rows)
    ]

    next_before_id = int(rows[-1][0]) if rows else None
    has_more = False
    if next_before_id is not None:
        async with db_conn.execute(
            "SELECT 1 FROM thread_messages WHERE thread_id = ? AND id < ? LIMIT 1",
            (thread_id, next_before_id),
        ) as cursor:
            has_more = bool(await cursor.fetchone())

    total_count = await get_thread_message_count(db_conn, thread_id)

    return {
        "messages": messages,
        "has_more": has_more,
        "next_before_id": next_before_id,
        "count": total_count,
    }


async def backfill_thread_messages(
    db_conn: Any,
    thread_id: str,
    agent: str,
    messages: Sequence[Dict[str, str]],
) -> int:
    if not messages:
        return 0

    now = _now_iso()
    last_user_turn_id = ""
    inserted = 0

    for index, message in enumerate(messages):
        role = str(message.get("role", "") or "")
        content = str(message.get("content", "") or "")
        if role not in ("user", "assistant") or not content.strip():
            continue

        message_id = str(message.get("id", "") or "")
        if not message_id:
            message_id = _make_stable_message_id(role, thread_id, str(index), content)

        if role == "user":
            last_user_turn_id = message_id

        turn_id = last_user_turn_id or _make_stable_message_id("turn", thread_id, str(index), role)

        await db_conn.execute(
            """
            INSERT INTO thread_messages (
                thread_id, turn_id, message_id, role, content, agent, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(thread_id, message_id) DO UPDATE SET
                turn_id = excluded.turn_id,
                role = excluded.role,
                content = excluded.content,
                agent = excluded.agent,
                updated_at = excluded.updated_at
            """,
            (thread_id, turn_id, message_id, role, content, agent, now, now),
        )
        inserted += 1

    if inserted > 0:
        await db_conn.commit()
    return inserted


async def append_thread_turn(
    thread_id: str,
    agent: str,
    turn_id: str,
    user_message_id: str,
    user_content: str,
    assistant_message_id: str,
    assistant_content: str,
    user_id: str = DEFAULT_USER_ID,
    db_path: Optional[str] = None,
) -> None:
    path = db_path or DEFAULT_DB_PATH
    now = _now_iso()
    os.makedirs(os.path.dirname(path), exist_ok=True)

    async with aiosqlite.connect(path) as db_conn:
        await db_conn.execute("PRAGMA journal_mode=WAL")
        await db_conn.execute("PRAGMA synchronous=NORMAL")
        await db_conn.execute("PRAGMA foreign_keys=ON")
        await db_conn.execute("PRAGMA busy_timeout=5000")
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
        await setup_thread_message_tables(db_conn)

        await db_conn.execute(
            """
            INSERT INTO thread_metadata (thread_id, name, agent, user_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(thread_id) DO UPDATE SET
                agent = excluded.agent,
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
                agent or "test",
                user_id or DEFAULT_USER_ID,
                now,
                now,
                DEFAULT_USER_ID,
            ),
        )

        await db_conn.execute(
            """
            INSERT INTO thread_messages (
                thread_id, turn_id, message_id, role, content, agent, created_at, updated_at
            )
            VALUES (?, ?, ?, 'user', ?, ?, ?, ?)
            ON CONFLICT(thread_id, message_id) DO UPDATE SET
                turn_id = excluded.turn_id,
                content = excluded.content,
                agent = excluded.agent,
                updated_at = excluded.updated_at
            """,
            (thread_id, turn_id, user_message_id, user_content, agent or "test", now, now),
        )

        await db_conn.execute(
            """
            INSERT INTO thread_messages (
                thread_id, turn_id, message_id, role, content, agent, created_at, updated_at
            )
            VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?)
            ON CONFLICT(thread_id, message_id) DO UPDATE SET
                turn_id = excluded.turn_id,
                content = excluded.content,
                agent = excluded.agent,
                updated_at = excluded.updated_at
            """,
            (thread_id, turn_id, assistant_message_id, assistant_content, agent or "test", now, now),
        )

        await db_conn.execute(
            "UPDATE thread_metadata SET updated_at = ? WHERE thread_id = ?",
            (now, thread_id),
        )
        await db_conn.commit()
