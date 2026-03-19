import json
import os
from typing import Any, Dict, Literal, Optional

from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from test_agent.config import get_llm_model

from .prompts import EXTRACT_INFO_FROM_PAPER_PROMPT, EXTRACT_LUE_MODEL_PROMPT


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


class CaseExtractionPromptResponse(BaseModel):
    extractor_type: ExtractorType
    prompt_template: str


def get_prompt_template(extractor_type: ExtractorType) -> str:
    if extractor_type == "prosail":
        return EXTRACT_INFO_FROM_PAPER_PROMPT
    return EXTRACT_LUE_MODEL_PROMPT


def build_prompt(extractor_type: ExtractorType, paper_text: str, paper_title: str) -> str:
    template = get_prompt_template(extractor_type)
    paper_context = paper_text.strip()
    if paper_title.strip():
        paper_context = f"论文标题: {paper_title.strip()}\n\n{paper_context}"
    return template.format(paper_context=paper_context)


def normalize_llm_output(raw_output: str) -> Dict[str, Any]:
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


def invoke_case_extraction(extractor_type: ExtractorType, paper_text: str, paper_title: str) -> Dict[str, Any]:
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
    response = llm.invoke(build_prompt(extractor_type, paper_text, paper_title))
    content = response.content if isinstance(response.content, str) else str(response.content)
    normalized = normalize_llm_output(content)
    normalized["model"] = model
    return normalized
