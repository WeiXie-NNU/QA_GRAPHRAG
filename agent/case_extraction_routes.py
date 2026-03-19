import asyncio
import importlib.util
import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Literal, Optional

from fastapi import HTTPException
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from test_agent.config import get_llm_model


ExtractorType = Literal["prosail", "lue"]


class CaseExtractionRequest(BaseModel):
    extractor_type: ExtractorType = Field(description="案例提取器类型")
    paper_text: str = Field(min_length=20, description="论文正文文本")
    paper_title: str = Field(default="", description="论文标题，可选")


class CaseExtractionResponse(BaseModel):
    extractor_type: ExtractorType
    model: str
    paper_title: str
    raw_output: str
    is_none: bool
    parsed_result: Optional[Any] = None
    parse_status: Literal["none", "json", "raw"]


def _project_root() -> Path:
    return Path(__file__).resolve().parents[1]


@lru_cache(maxsize=1)
def _load_prompt_module():
    prompt_path = _project_root() / "backend_test" / "case" / "prompt.py"
    if not prompt_path.exists():
        raise FileNotFoundError(f"案例提取 prompt 文件不存在: {prompt_path}")

    spec = importlib.util.spec_from_file_location("case_extraction_prompts", prompt_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"无法加载 prompt 模块: {prompt_path}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _get_prompt_template(extractor_type: ExtractorType) -> str:
    module = _load_prompt_module()
    if extractor_type == "prosail":
        return str(getattr(module, "EXTRACT_INFO_FROM_PAPER_PROMPT"))
    return str(getattr(module, "EXTRACT_LUE_MODEL_PROMPT"))


def _build_prompt(extractor_type: ExtractorType, paper_text: str, paper_title: str) -> str:
    template = _get_prompt_template(extractor_type)
    paper_context = paper_text.strip()
    if paper_title.strip():
        paper_context = f"论文标题: {paper_title.strip()}\n\n{paper_context}"
    return template.format(paper_context=paper_context)


def _normalize_llm_output(raw_output: str) -> Dict[str, Any]:
    cleaned = raw_output.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.removeprefix("```json").removeprefix("```JSON").removeprefix("```").strip()
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3].strip()

    if cleaned.lower() == "none":
        return {
            "raw_output": raw_output,
            "is_none": True,
            "parsed_result": None,
            "parse_status": "none",
        }

    try:
        parsed = json.loads(cleaned)
        return {
            "raw_output": raw_output,
            "is_none": False,
            "parsed_result": parsed,
            "parse_status": "json",
        }
    except Exception:
        return {
            "raw_output": raw_output,
            "is_none": False,
            "parsed_result": None,
            "parse_status": "raw",
        }


def _invoke_case_extraction(extractor_type: ExtractorType, paper_text: str, paper_title: str) -> Dict[str, Any]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("缺少 OPENAI_API_KEY，无法执行案例提取。")

    model = get_llm_model()
    llm = ChatOpenAI(
        model=model,
        temperature=0,
        api_key=api_key,
        base_url=os.getenv("OPENAI_API_BASE") or None,
    )
    response = llm.invoke(_build_prompt(extractor_type, paper_text, paper_title))
    content = response.content if isinstance(response.content, str) else str(response.content)
    normalized = _normalize_llm_output(content)
    normalized["model"] = model
    return normalized


def register_case_extraction_routes(app) -> None:
    @app.post("/api/tools/case-extraction/extract", response_model=CaseExtractionResponse)
    async def extract_case_from_paper(payload: CaseExtractionRequest):
        paper_text = payload.paper_text.strip()
        if len(paper_text) > 120_000:
            raise HTTPException(status_code=413, detail="论文文本过长，请先裁剪后再提取。")

        try:
            result = await asyncio.to_thread(
                _invoke_case_extraction,
                payload.extractor_type,
                paper_text,
                payload.paper_title.strip(),
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
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
