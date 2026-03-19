import { AGENT_API_URL } from "../lib/consts";

export type CaseExtractorType = "prosail" | "lue";
export interface LLMModelOption {
  value: string;
  label: string;
}

const GPT_FALLBACK_MODELS: LLMModelOption[] = [
  { value: "gpt-5-mini", label: "GPT-5 Mini" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini" },
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
  { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
];

export interface CaseExtractionRequest {
  extractor_type: CaseExtractorType;
  paper_text: string;
  paper_title?: string;
  llm_model?: string;
}

export interface CaseExtractionResponse {
  extractor_type: CaseExtractorType;
  model: string;
  paper_title: string;
  raw_output: string;
  is_none: boolean;
  parsed_result: unknown | null;
  parse_status: "none" | "json" | "raw";
}

export interface CaseExtractionPromptResponse {
  extractor_type: CaseExtractorType;
  prompt_template: string;
}

export interface CaseExtractionLlmResponse {
  models: LLMModelOption[];
  current: string;
}

export async function extractCaseFromPaper(
  payload: CaseExtractionRequest
): Promise<CaseExtractionResponse> {
  const response = await fetch(`${AGENT_API_URL}/api/tools/case-extraction/extract`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let detail = "案例提取请求失败";
    try {
      const errorPayload = await response.json();
      detail = String(errorPayload?.detail || detail);
    } catch {}
    throw new Error(detail);
  }

  return response.json() as Promise<CaseExtractionResponse>;
}

export async function getCaseExtractionPrompt(
  extractorType: CaseExtractorType
): Promise<CaseExtractionPromptResponse> {
  const response = await fetch(`${AGENT_API_URL}/api/tools/case-extraction/prompts/${extractorType}`);

  if (!response.ok) {
    let detail = "提示词加载失败";
    try {
      const errorPayload = await response.json();
      detail = String(errorPayload?.detail || detail);
    } catch {}
    throw new Error(detail);
  }

  return response.json() as Promise<CaseExtractionPromptResponse>;
}

export async function getCaseExtractionLlmModels(): Promise<CaseExtractionLlmResponse> {
  try {
    const response = await fetch(`${AGENT_API_URL}/api/llm/models`);
    if (!response.ok) {
      throw new Error("模型列表加载失败");
    }

    const payload = (await response.json()) as {
      models?: LLMModelOption[];
      current?: string;
    };

    const gptModels = (payload.models || []).filter((model) => model.value.toLowerCase().startsWith("gpt-"));
    const mergedModels = [...GPT_FALLBACK_MODELS];

    for (const model of gptModels) {
      if (!mergedModels.some((item) => item.value === model.value)) {
        mergedModels.push(model);
      }
    }

    return {
      models: mergedModels,
      current:
        payload.current && payload.current.toLowerCase().startsWith("gpt-")
          ? payload.current
          : (mergedModels[0]?.value ?? "gpt-4o-mini"),
    };
  } catch {
    return {
      models: GPT_FALLBACK_MODELS,
      current: "gpt-5-mini",
    };
  }
}
