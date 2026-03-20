from __future__ import annotations

import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Optional

from dotenv import dotenv_values


DEFAULT_QUERY_TIMEOUT_SECONDS = 45.0
DEFAULT_REQUEST_TIMEOUT_SECONDS = 30.0
DEFAULT_QUERY_CONCURRENT_REQUESTS = 4
DEFAULT_QUERY_MAX_RETRIES = 2
DEFAULT_RETRY_BASE_DELAY_SECONDS = 1.5
DEFAULT_RETRY_MAX_DELAY_SECONDS = 5.0

RUNTIME_ENV_KEYS = (
    "GRAPHRAG_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_API_BASE",
    "AZURE_OPENAI_API_KEY",
    "AZURE_OPENAI_ENDPOINT",
    "GRAPHRAG_QUERY_TIMEOUT_SECONDS",
    "GRAPHRAG_QUERY_REQUEST_TIMEOUT_SECONDS",
    "GRAPHRAG_QUERY_CONCURRENT_REQUESTS",
    "GRAPHRAG_QUERY_MAX_RETRIES",
    "GRAPHRAG_QUERY_RETRY_BASE_DELAY_SECONDS",
    "GRAPHRAG_QUERY_RETRY_MAX_DELAY_SECONDS",
    "GRAPHRAG_QUERY_WARMUP_ENABLED",
    "GRAPHRAG_QUERY_VERBOSE",
)


@dataclass(frozen=True)
class InteractiveQueryProfile:
    query_timeout_seconds: float = DEFAULT_QUERY_TIMEOUT_SECONDS
    request_timeout_seconds: float = DEFAULT_REQUEST_TIMEOUT_SECONDS
    concurrent_requests: int = DEFAULT_QUERY_CONCURRENT_REQUESTS
    max_retries: int = DEFAULT_QUERY_MAX_RETRIES
    retry_base_delay_seconds: float = DEFAULT_RETRY_BASE_DELAY_SECONDS
    retry_max_delay_seconds: float = DEFAULT_RETRY_MAX_DELAY_SECONDS
    warmup_enabled: bool = True
    verbose: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class RuntimeValidationResult:
    valid: bool
    errors: tuple[str, ...]
    warnings: tuple[str, ...]
    profile: InteractiveQueryProfile

    def to_dict(self) -> Dict[str, Any]:
        return {
            "valid": self.valid,
            "errors": list(self.errors),
            "warnings": list(self.warnings),
            "profile": self.profile.to_dict(),
        }


def _read_env_file(file_path: Path) -> Dict[str, str]:
    if not file_path.exists():
        return {}
    try:
        raw = dotenv_values(file_path)
    except Exception:
        return {}

    env: Dict[str, str] = {}
    for key, value in raw.items():
        if key and value is not None:
            env[str(key)] = str(value)
    return env


def _clean_optional_string(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    return text or None


def _clean_positive_int(value: Any) -> Optional[int]:
    try:
        parsed = int(value)
    except Exception:
        return None
    return parsed if parsed > 0 else None


def _clean_positive_float(value: Any) -> Optional[float]:
    try:
        parsed = float(value)
    except Exception:
        return None
    return parsed if parsed > 0 else None


def _clean_bool(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "y"}:
            return True
        if lowered in {"false", "0", "no", "n"}:
            return False
    return None


def _contains_unresolved_placeholder(value: str) -> bool:
    return "${" in value or "$%7B" in value or "{OPENAI_API_BASE}" in value


def load_runtime_env(
    root_env_file: Path,
    repo_env_file: Optional[Path] = None,
) -> Dict[str, str]:
    env: Dict[str, str] = {}
    env.update(_read_env_file(root_env_file))
    if repo_env_file and repo_env_file.exists():
        env.update(_read_env_file(repo_env_file))

    for key in RUNTIME_ENV_KEYS:
        value = os.getenv(key)
        if value:
            env[key] = value

    if not env.get("GRAPHRAG_API_KEY") and env.get("OPENAI_API_KEY"):
        env["GRAPHRAG_API_KEY"] = env["OPENAI_API_KEY"]
    if not env.get("OPENAI_API_BASE") and env.get("AZURE_OPENAI_ENDPOINT"):
        env["OPENAI_API_BASE"] = env["AZURE_OPENAI_ENDPOINT"]
    return env


def build_query_profile(env: Dict[str, str]) -> InteractiveQueryProfile:
    query_timeout_seconds = _clean_positive_float(env.get("GRAPHRAG_QUERY_TIMEOUT_SECONDS"))
    request_timeout_seconds = _clean_positive_float(env.get("GRAPHRAG_QUERY_REQUEST_TIMEOUT_SECONDS"))
    concurrent_requests = _clean_positive_int(env.get("GRAPHRAG_QUERY_CONCURRENT_REQUESTS"))
    max_retries = _clean_positive_int(env.get("GRAPHRAG_QUERY_MAX_RETRIES"))
    retry_base_delay_seconds = _clean_positive_float(env.get("GRAPHRAG_QUERY_RETRY_BASE_DELAY_SECONDS"))
    retry_max_delay_seconds = _clean_positive_float(env.get("GRAPHRAG_QUERY_RETRY_MAX_DELAY_SECONDS"))
    warmup_enabled = _clean_bool(env.get("GRAPHRAG_QUERY_WARMUP_ENABLED"))
    verbose = _clean_bool(env.get("GRAPHRAG_QUERY_VERBOSE"))

    return InteractiveQueryProfile(
        query_timeout_seconds=query_timeout_seconds or DEFAULT_QUERY_TIMEOUT_SECONDS,
        request_timeout_seconds=request_timeout_seconds or DEFAULT_REQUEST_TIMEOUT_SECONDS,
        concurrent_requests=concurrent_requests or DEFAULT_QUERY_CONCURRENT_REQUESTS,
        max_retries=max_retries if max_retries is not None else DEFAULT_QUERY_MAX_RETRIES,
        retry_base_delay_seconds=retry_base_delay_seconds or DEFAULT_RETRY_BASE_DELAY_SECONDS,
        retry_max_delay_seconds=retry_max_delay_seconds or DEFAULT_RETRY_MAX_DELAY_SECONDS,
        warmup_enabled=True if warmup_enabled is None else warmup_enabled,
        verbose=False if verbose is None else verbose,
    )


def validate_runtime_env(env: Dict[str, str]) -> RuntimeValidationResult:
    errors: list[str] = []
    warnings: list[str] = []
    profile = build_query_profile(env)

    api_key = _clean_optional_string(env.get("GRAPHRAG_API_KEY") or env.get("OPENAI_API_KEY"))
    api_base = _clean_optional_string(env.get("OPENAI_API_BASE") or env.get("AZURE_OPENAI_ENDPOINT"))

    if not api_key:
        errors.append("missing API key: set GRAPHRAG_API_KEY or OPENAI_API_KEY")
    elif _contains_unresolved_placeholder(api_key):
        errors.append("API key contains unresolved placeholder")

    if not api_base:
        warnings.append("OPENAI_API_BASE is empty; default provider endpoint will be used")
    elif _contains_unresolved_placeholder(api_base):
        errors.append("OPENAI_API_BASE contains unresolved placeholder")
    elif not str(api_base).startswith(("http://", "https://")):
        errors.append("OPENAI_API_BASE must start with http:// or https://")

    if profile.concurrent_requests > 8:
        warnings.append(
            "interactive query concurrent_requests is high; values above 8 often worsen latency"
        )
    if profile.max_retries > 3:
        warnings.append(
            "interactive query max_retries is high; values above 3 often amplify timeout latency"
        )
    if profile.request_timeout_seconds >= profile.query_timeout_seconds:
        warnings.append(
            "request timeout is not lower than total query timeout; cancellation may be delayed"
        )
    if profile.retry_base_delay_seconds <= 1.0:
        errors.append("GRAPHRAG_QUERY_RETRY_BASE_DELAY_SECONDS must be greater than 1.0")
    if profile.retry_max_delay_seconds < profile.retry_base_delay_seconds:
        errors.append("GRAPHRAG_QUERY_RETRY_MAX_DELAY_SECONDS must be >= retry base delay")

    return RuntimeValidationResult(
        valid=not errors,
        errors=tuple(errors),
        warnings=tuple(warnings),
        profile=profile,
    )
