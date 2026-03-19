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

from test_agent.repository_registry import get_repository, list_repository_statuses  # noqa: E402


def serialize_repo(repo):
    return {
        "id": repo.model_id,
        "layout": repo.layout_name,
        "model_dir": str(repo.model_dir),
        "graph_root": str(repo.graph_root),
        "output_dir": str(repo.kg_output_dir),
        "settings_file": str(repo.settings_file),
        "available": repo.available,
        "supports_global_search": repo.supports_global_search,
        "supports_local_search": repo.supports_local_search,
        "missing_required_files": repo.missing_required_files,
        "status_reason": repo.status_reason,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify GraphRAG repository artifacts.")
    parser.add_argument("--kg", help="Knowledge graph id, e.g. prosail or lue")
    parser.add_argument("--json", action="store_true", help="Emit JSON")
    args = parser.parse_args()

    if args.kg:
        repo = get_repository(args.kg)
        if repo is None:
            payload = {"error": f"repository not found: {args.kg}"}
            if args.json:
                print(json.dumps(payload, ensure_ascii=False, indent=2))
            else:
                print(payload["error"])
            return 1
        payload = serialize_repo(repo)
        if args.json:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
        else:
            print(f"id: {payload['id']}")
            print(f"layout: {payload['layout']}")
            print(f"available: {payload['available']}")
            print(f"supports_global_search: {payload['supports_global_search']}")
            print(f"supports_local_search: {payload['supports_local_search']}")
            print(f"output_dir: {payload['output_dir']}")
            print(f"settings_file: {payload['settings_file']}")
            print(f"status_reason: {payload['status_reason']}")
            if payload["missing_required_files"]:
                print("missing_required_files:")
                for item in payload["missing_required_files"]:
                    print(f"  - {item}")
        return 0 if repo.available else 2

    repos = [serialize_repo(repo) for repo in list_repository_statuses()]
    if args.json:
        print(json.dumps(repos, ensure_ascii=False, indent=2))
    else:
        for payload in repos:
            print(
                f"{payload['id']}: available={payload['available']}, "
                f"global={payload['supports_global_search']}, "
                f"local={payload['supports_local_search']}, "
                f"layout={payload['layout']}, reason={payload['status_reason']}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
