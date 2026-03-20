import argparse
import json
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
AGENT_DIR = PROJECT_ROOT / "agent"

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

from test_agent.graphrag_query import GraphRAGQueryEngine  # noqa: E402
from test_agent.repository_registry import list_repository_statuses  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify GraphRAG runtime configuration.")
    parser.add_argument("--kg", help="Knowledge graph id, e.g. prosail or lue")
    parser.add_argument("--json", action="store_true", help="Emit JSON")
    args = parser.parse_args()

    repo_ids = [args.kg] if args.kg else [repo.model_id for repo in list_repository_statuses()]
    payload = []

    for kg_id in repo_ids:
        runtime = GraphRAGQueryEngine.describe_runtime(kg_id)
        payload.append(runtime)

    if args.json:
        print(json.dumps(payload if not args.kg else payload[0], ensure_ascii=False, indent=2))
    else:
        for item in payload:
            print(
                f"{item['kg_id']}: valid={item['runtime']['valid']}, "
                f"global={item['supports_global_search']}, "
                f"local={item['supports_local_search']}, "
                f"warmup_completed={item['warmup_completed']}"
            )
            print(f"  profile: {item['runtime']['profile']}")
            if item["runtime"]["warnings"]:
                print(f"  warnings: {item['runtime']['warnings']}")
            if item["runtime"]["errors"]:
                print(f"  errors: {item['runtime']['errors']}")

    if any(not item["runtime"]["valid"] for item in payload):
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
