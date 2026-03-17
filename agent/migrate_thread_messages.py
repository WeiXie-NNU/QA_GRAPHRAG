from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from typing import Any, Dict, List

import aiosqlite
from dotenv import load_dotenv
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver


CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, ".."))
DATA_DIR = os.path.join(PROJECT_ROOT, "data")

if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

load_dotenv(os.path.join(PROJECT_ROOT, ".env"))
DEFAULT_DB_PATH = os.getenv("DATABASE_PATH", os.path.join(DATA_DIR, "chat_history.db"))

from test_agent.agent import build_graph  # noqa: E402
from thread_maintenance import (  # noqa: E402
    backfill_thread_message_log,
    collect_thread_inventory,
    get_thread_backfill_stats,
)
from thread_routes import setup_checkpoint_indexes, setup_thread_metadata_table  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="离线迁移旧线程历史，将 LangGraph checkpoint 中的可见消息回填到 thread_messages 表。",
    )
    parser.add_argument("--db-path", default=DEFAULT_DB_PATH, help="SQLite 数据库路径")
    parser.add_argument("--agent", default=None, help="仅迁移指定 agent 的线程")
    parser.add_argument(
        "--thread-id",
        action="append",
        default=[],
        help="仅迁移指定 thread_id，可重复传入多次",
    )
    parser.add_argument("--limit", type=int, default=0, help="最多迁移多少个线程，0 表示不限制")
    parser.add_argument("--force", action="store_true", help="即使已有消息日志也重新回填")
    parser.add_argument("--stats-only", action="store_true", help="只输出统计信息，不执行迁移")
    parser.add_argument("--json", action="store_true", help="以 JSON 形式输出结果")
    return parser.parse_args()


def emit(payload: Dict[str, Any], *, as_json: bool) -> None:
    if as_json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return

    if "summary" in payload:
        summary = payload["summary"]
        print("迁移完成")
        print(f"- 扫描线程: {summary.get('scanned_threads', 0)}")
        print(f"- 执行迁移: {summary.get('migrated_threads', 0)}")
        print(f"- 跳过线程: {summary.get('skipped_threads', 0)}")
        print(f"- 空线程: {summary.get('empty_threads', 0)}")
        print(f"- 失败线程: {summary.get('failed_threads', 0)}")
        print(f"- 新增/更新消息行: {summary.get('inserted_messages', 0)}")
        if payload.get("failures"):
            print("- 失败详情:")
            for item in payload["failures"]:
                print(f"  - {item.get('thread_id')}: {item.get('error')}")
        return

    print("迁移统计")
    print(f"- 总线程数: {payload.get('total_threads', 0)}")
    print(f"- 已有消息日志: {payload.get('threads_with_message_log', 0)}")
    print(f"- 待迁移线程: {payload.get('threads_pending_backfill', 0)}")
    print(f"- 消息总行数: {payload.get('total_message_rows', 0)}")
    pending_preview = payload.get("pending_preview") or []
    if pending_preview:
        print("- 待迁移预览:")
        for item in pending_preview:
            print(
                "  - "
                f"{item.get('thread_id')} "
                f"(agent={item.get('agent')}, checkpoint={item.get('has_checkpoint')}, "
                f"agent_state={item.get('has_agent_state')})"
            )


async def run() -> int:
    args = parse_args()

    db_dir = os.path.dirname(args.db_path)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    async with aiosqlite.connect(args.db_path) as db_conn:
        await db_conn.execute("PRAGMA journal_mode=WAL")
        await db_conn.execute("PRAGMA synchronous=NORMAL")
        await db_conn.execute("PRAGMA foreign_keys=ON")
        await db_conn.execute("PRAGMA busy_timeout=5000")
        await db_conn.commit()

        checkpointer = AsyncSqliteSaver(db_conn)
        await checkpointer.setup()
        await setup_checkpoint_indexes(db_conn)
        await setup_thread_metadata_table(db_conn)

        stats = await get_thread_backfill_stats(
            db_conn,
            agent=args.agent,
            default_agent=args.agent or "test",
        )
        if args.stats_only:
            emit(stats, as_json=args.json)
            return 0

        inventory = await collect_thread_inventory(
            db_conn,
            agent=args.agent,
            default_agent=args.agent or "test",
        )
        requested_thread_ids = {str(item).strip() for item in args.thread_id if str(item).strip()}
        if requested_thread_ids:
            inventory = [item for item in inventory if str(item.get("thread_id")) in requested_thread_ids]
        elif not args.force:
            inventory = [item for item in inventory if not item.get("has_message_log")]

        if args.limit and args.limit > 0:
            inventory = inventory[: args.limit]

        graph = build_graph(checkpointer)
        summary = {
            "scanned_threads": len(inventory),
            "migrated_threads": 0,
            "skipped_threads": 0,
            "empty_threads": 0,
            "failed_threads": 0,
            "inserted_messages": 0,
        }
        failures: List[Dict[str, Any]] = []
        results: List[Dict[str, Any]] = []

        for item in inventory:
            thread_id = str(item.get("thread_id") or "").strip()
            if not thread_id:
                continue
            agent = str(item.get("agent") or args.agent or "test")
            try:
                result = await backfill_thread_message_log(
                    db_conn,
                    graph,
                    thread_id,
                    agent=agent,
                    force=bool(args.force),
                )
                status = str(result.get("status") or "")
                results.append(result)
                if status == "backfilled":
                    summary["migrated_threads"] += 1
                    summary["inserted_messages"] += int(result.get("inserted") or 0)
                elif status == "skipped":
                    summary["skipped_threads"] += 1
                elif status == "empty":
                    summary["empty_threads"] += 1
                else:
                    summary["failed_threads"] += 1
                    failures.append(
                        {
                            "thread_id": thread_id,
                            "error": f"unexpected status: {status or 'unknown'}",
                        }
                    )
            except Exception as exc:
                summary["failed_threads"] += 1
                failures.append(
                    {
                        "thread_id": thread_id,
                        "error": str(exc),
                    }
                )

        payload = {
            "summary": summary,
            "results": results,
            "failures": failures,
        }
        emit(payload, as_json=args.json)
        return 0 if summary["failed_threads"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))
