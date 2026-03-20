import importlib.util
import sys


def main() -> int:
    print(f"Python: {sys.executable}")
    spec = importlib.util.find_spec("graphrag")
    if spec is None:
        print("graphrag: NOT INSTALLED")
        return 1
    print(f"graphrag: {spec.origin}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
