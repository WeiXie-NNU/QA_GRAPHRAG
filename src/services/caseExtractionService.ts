import { AGENT_API_URL } from "../lib/consts";

export type CaseExtractorType = "prosail" | "lue";

export interface CaseExtractionRequest {
  extractor_type: CaseExtractorType;
  paper_text: string;
  paper_title?: string;
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
