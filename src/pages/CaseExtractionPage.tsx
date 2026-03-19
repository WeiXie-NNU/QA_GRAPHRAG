import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import "./CaseExtractionPage.css";
import {
  extractCaseFromPaper,
  getCaseExtractionLlmModels,
  getCaseExtractionPrompt,
  type CaseExtractionResponse,
  type CaseExtractorType,
  type LLMModelOption,
} from "../services/caseExtractionService";

const EXTRACTOR_OPTIONS: Array<{
  value: CaseExtractorType;
  label: string;
  description: string;
}> = [
  {
    value: "prosail",
    label: "PROSAIL 案例提取",
    description: "抽取 PROSAIL 及其变体实验案例、参数、实验区与遥感数据。",
  },
  {
    value: "lue",
    label: "LUE 案例提取",
    description: "抽取 LUE 模型、LUEmax、环境胁迫因子与验证指标。",
  },
];

const ACCEPTED_FILE_SUFFIXES = [".txt", ".md", ".json"];

function readFileAsText(file: File): Promise<string> {
  return file.text();
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function inferPaperTitle(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim();
}

function formatStructuredLabel(label: string): string {
  return label
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function formatLlmLabel(model: string): string {
  const normalized = model.trim();
  if (!normalized) {
    return "";
  }

  return normalized
    .split("-")
    .map((segment, index) => {
      if (index === 0 && segment.toLowerCase() === "gpt") {
        return "GPT";
      }
      if (segment.toLowerCase() === "mini") {
        return "Mini";
      }
      if (segment.toLowerCase() === "turbo") {
        return "Turbo";
      }
      return segment;
    })
    .join(" ");
}

function renderStructuredValue(value: unknown, path = "root"): ReactNode {
  if (value === null || value === undefined || value === "") {
    return <span className="case-tool-structured-empty">未提取</span>;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <span className="case-tool-structured-text">{String(value)}</span>;
  }

  if (Array.isArray(value)) {
    if (!value.length) {
      return <span className="case-tool-structured-empty">空数组</span>;
    }

    return (
      <div className="case-tool-structured-array">
        {value.map((item, index) => (
          <div key={`${path}-${index}`} className="case-tool-structured-array-item">
            <div className="case-tool-structured-array-index">#{index + 1}</div>
            <div className="case-tool-structured-array-content">{renderStructuredValue(item, `${path}-${index}`)}</div>
          </div>
        ))}
      </div>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) {
      return <span className="case-tool-structured-empty">空对象</span>;
    }

    return (
      <div className="case-tool-structured-table">
        {entries.map(([key, entryValue], index) => (
          <Fragment key={`${path}-${key}`}>
            <div className="case-tool-structured-key">{formatStructuredLabel(key)}</div>
            <div className="case-tool-structured-value">{renderStructuredValue(entryValue, `${path}-${key}`)}</div>
            {index < entries.length - 1 ? <div className="case-tool-structured-divider" /> : null}
          </Fragment>
        ))}
      </div>
    );
  }

  return <span className="case-tool-structured-text">{String(value)}</span>;
}

export function CaseExtractionPage() {
  const [extractorType, setExtractorType] = useState<CaseExtractorType>("prosail");
  const [extractorQuery, setExtractorQuery] = useState(EXTRACTOR_OPTIONS[0].label);
  const [isExtractorMenuOpen, setIsExtractorMenuOpen] = useState(false);
  const [structuredView, setStructuredView] = useState<"table" | "json">("table");
  const [availableLlmModels, setAvailableLlmModels] = useState<LLMModelOption[]>([]);
  const [selectedLlmModel, setSelectedLlmModel] = useState("gpt-5-mini");
  const [paperText, setPaperText] = useState("");
  const [importedFileName, setImportedFileName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CaseExtractionResponse | null>(null);
  const [promptTemplate, setPromptTemplate] = useState("");
  const [promptError, setPromptError] = useState("");
  const [isPromptLoading, setIsPromptLoading] = useState(false);
  const extractorSelectorRef = useRef<HTMLDivElement | null>(null);

  const currentExtractor = useMemo(
    () => EXTRACTOR_OPTIONS.find((item) => item.value === extractorType) ?? EXTRACTOR_OPTIONS[0],
    [extractorType]
  );

  const filteredExtractorOptions = useMemo(() => {
    const query = extractorQuery.trim().toLowerCase();
    if (!query) {
      return EXTRACTOR_OPTIONS;
    }

    return EXTRACTOR_OPTIONS.filter((option) =>
      `${option.label} ${option.description} ${option.value}`.toLowerCase().includes(query)
    );
  }, [extractorQuery]);

  const currentLlmOption = useMemo(
    () => availableLlmModels.find((item) => item.value === selectedLlmModel) ?? availableLlmModels[0] ?? null,
    [availableLlmModels, selectedLlmModel]
  );

  const displayedResultModel = useMemo(() => {
    const modelValue = result?.model?.trim();
    if (!modelValue) {
      return currentLlmOption?.label ?? "";
    }

    return availableLlmModels.find((item) => item.value === modelValue)?.label ?? formatLlmLabel(modelValue);
  }, [availableLlmModels, currentLlmOption?.label, result?.model]);

  useEffect(() => {
    let cancelled = false;

    async function loadLlmModels() {
      const response = await getCaseExtractionLlmModels();
      if (!cancelled) {
        setAvailableLlmModels(response.models);
        setSelectedLlmModel((current) => {
          if (response.models.some((item) => item.value === current)) {
            return current;
          }
          if (response.current && response.models.some((item) => item.value === response.current)) {
            return response.current;
          }
          return response.models[0]?.value || current || "gpt-5-mini";
        });
      }
    }

    void loadLlmModels();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadPrompt() {
      setIsPromptLoading(true);
      setPromptError("");

      try {
        const response = await getCaseExtractionPrompt(extractorType);
        if (!cancelled) {
          setPromptTemplate(response.prompt_template);
        }
      } catch (promptRequestError) {
        if (!cancelled) {
          setPromptTemplate("");
          setPromptError(
            promptRequestError instanceof Error ? promptRequestError.message : "提示词加载失败，请稍后重试。"
          );
        }
      } finally {
        if (!cancelled) {
          setIsPromptLoading(false);
        }
      }
    }

    void loadPrompt();

    return () => {
      cancelled = true;
    };
  }, [extractorType]);

  useEffect(() => {
    setExtractorQuery(currentExtractor.label);
  }, [currentExtractor.label]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!extractorSelectorRef.current?.contains(event.target as Node)) {
        setIsExtractorMenuOpen(false);
        setExtractorQuery(currentExtractor.label);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [currentExtractor.label]);

  const paperStats = useMemo(() => {
    const chars = paperText.trim().length;
    const lines = paperText ? paperText.split(/\r?\n/).length : 0;
    return { chars, lines };
  }, [paperText]);

  const handleFileChange = async (file: File | null) => {
    if (!file) {
      return;
    }

    const lowerName = file.name.toLowerCase();
    if (!ACCEPTED_FILE_SUFFIXES.some((suffix) => lowerName.endsWith(suffix))) {
      setError(`当前仅支持 ${ACCEPTED_FILE_SUFFIXES.join(" / ")} 文件，请先转换为文本后导入。`);
      return;
    }

    try {
      const text = await readFileAsText(file);
      setPaperText(text);
      setImportedFileName(file.name);
      setError("");
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : "文件读取失败，请重试。");
    }
  };

  const handleSubmit = async () => {
    const nextText = paperText.trim();
    if (nextText.length < 20) {
      setError("请先粘贴足够的论文正文内容，再开始提取。");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const response = await extractCaseFromPaper({
        extractor_type: extractorType,
        paper_text: nextText,
        paper_title: importedFileName ? inferPaperTitle(importedFileName) : "",
        llm_model: selectedLlmModel,
      });
      setAvailableLlmModels((current) => {
        if (!response.model || current.some((item) => item.value === response.model)) {
          return current;
        }
        return [...current, { value: response.model, label: formatLlmLabel(response.model) }];
      });
      if (response.model) {
        setSelectedLlmModel(response.model);
      }
      setStructuredView("table");
      setResult(response);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "案例提取失败，请稍后再试。");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="case-tool-page">
      <header className="case-tool-header">
        <div className="case-tool-header-copy">
          <div className="case-tool-title-layout">
            <h1>案例提取工具</h1>
            <div className="case-tool-title-meta">
              <span className="case-tool-eyebrow">Case Extraction Lab</span>
              <p>
                <span>把文本送入结构化提取器，</span>
                <span>快速判断是否包含模型实验案例，</span>
                <span>并产出可直接复核的 JSON。</span>
              </p>
            </div>
          </div>
        </div>
        <div className="case-tool-header-actions">
          <Link to="/chat" className="case-tool-header-link">
            返回对话
          </Link>
          <Link to="/graph" className="case-tool-header-link secondary">
            打开知识图谱
          </Link>
        </div>
      </header>

      <main className="case-tool-workbench">
        <section className="case-tool-pane case-tool-input-pane">
          <div className="case-tool-pane-head">
            <div>
              <h2>输入工作台</h2>
              <p>{currentExtractor.description}</p>
            </div>
            <div className="case-tool-stats">
              <span>{paperStats.chars} 字符</span>
              <span>{paperStats.lines} 行</span>
            </div>
          </div>

          <div className="case-tool-topbar">
            <div className="case-tool-upload">
              <div>
                <strong>导入文本文件</strong>
                <span>支持 .txt / .md / .json，PDF 建议先转成纯文本后再导入。</span>
              </div>
              <label className="case-tool-upload-btn">
                选择文件
                <input
                  type="file"
                  accept=".txt,.md,.json,text/plain,application/json"
                  onChange={(event) => {
                    void handleFileChange(event.target.files?.[0] ?? null);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>

            <div className="case-tool-control-stack">
              <div className="case-tool-field">
                <label htmlFor="llm-model">提取 LLM</label>
                <div className="case-tool-select-wrap">
                  <select
                    id="llm-model"
                    className="case-tool-select"
                    value={selectedLlmModel}
                    onChange={(event) => {
                      setSelectedLlmModel(event.target.value);
                      setResult(null);
                      setStructuredView("table");
                    }}
                  >
                    {availableLlmModels.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="case-tool-field">
                <label htmlFor="extractor-search">提取模型</label>
                <div className="case-tool-selector" ref={extractorSelectorRef}>
                  <input
                    id="extractor-search"
                    className="case-tool-input case-tool-selector-input"
                    value={extractorQuery}
                    onChange={(event) => {
                      setExtractorQuery(event.target.value);
                      setIsExtractorMenuOpen(true);
                    }}
                    onFocus={() => setIsExtractorMenuOpen(true)}
                    placeholder="搜索模型名称或类型"
                  />
                  <button
                    type="button"
                    className="case-tool-selector-toggle"
                    aria-label="展开模型列表"
                    onClick={() => setIsExtractorMenuOpen((open) => !open)}
                  >
                    ▾
                  </button>
                  {isExtractorMenuOpen ? (
                    <div className="case-tool-selector-menu">
                      {filteredExtractorOptions.length ? (
                        filteredExtractorOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={`case-tool-selector-option ${extractorType === option.value ? "active" : ""}`}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              setExtractorType(option.value);
                              setStructuredView("table");
                              setResult(null);
                              setExtractorQuery(option.label);
                              setIsExtractorMenuOpen(false);
                            }}
                          >
                            <strong>{option.label}</strong>
                            <span>{option.description}</span>
                          </button>
                        ))
                      ) : (
                        <div className="case-tool-selector-empty">没有匹配的模型</div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {importedFileName ? <div className="case-tool-upload-note">已导入：{importedFileName}</div> : null}

          <div className="case-tool-content-grid">
            <div className="case-tool-field grow">
              <div className="case-tool-prompt-head">
                <label htmlFor="paper-text">论文正文</label>
                <span>{importedFileName ? "已自动载入文本" : "可直接粘贴正文"}</span>
              </div>
              <textarea
                id="paper-text"
                className="case-tool-textarea"
                value={paperText}
                onChange={(event) => setPaperText(event.target.value)}
                placeholder="把论文摘要、方法、实验与结果等正文内容粘贴到这里。"
              />
            </div>

            <div className="case-tool-field">
              <div className="case-tool-prompt-head">
                <label htmlFor="extractor-prompt">当前提取提示词</label>
                <span>{isPromptLoading ? "加载中..." : currentExtractor.label}</span>
              </div>
              <textarea
                id="extractor-prompt"
                className="case-tool-prompt"
                value={promptTemplate}
                readOnly
                placeholder="这里会显示当前提取器使用的提示词。"
              />
              {promptError ? <div className="case-tool-error">{promptError}</div> : null}
            </div>
          </div>

          {error ? <div className="case-tool-error">{error}</div> : null}

          <div className="case-tool-actions">
            <button
              type="button"
              className="case-tool-primary-btn"
              onClick={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? "提取中..." : "开始案例提取"}
            </button>
            <button
              type="button"
              className="case-tool-secondary-btn"
              onClick={() => {
                setPaperText("");
                setImportedFileName("");
                setResult(null);
                setError("");
              }}
              disabled={isSubmitting}
            >
              清空工作台
            </button>
          </div>
        </section>

        <section className="case-tool-pane case-tool-output-pane">
          <div className="case-tool-pane-head">
            <div>
              <h2>提取结果</h2>
              <p>优先查看结构化 JSON，再决定是否需要人工修订 prompt 或文本范围。</p>
            </div>
            {displayedResultModel ? (
              <span className="case-tool-model-pill">{displayedResultModel}</span>
            ) : null}
          </div>

          {!result ? (
            <div className="case-tool-empty">
              <h3>结果区待激活</h3>
              <p>提交论文正文后，这里会显示解析概览，以及可切换的表格 / JSON 结构化结果。</p>
            </div>
          ) : (
            <div className="case-tool-results">
              <div className="case-tool-result-card accent">
                <div className="case-tool-result-head">
                  <h3>解析概览</h3>
                  <span className={`case-tool-status ${result.parse_status}`}>{result.parse_status}</span>
                </div>
                <div className="case-tool-summary-grid">
                  <div className="case-tool-summary-item">
                    <span>提取器</span>
                    <strong>{currentExtractor.label}</strong>
                  </div>
                  <div className="case-tool-summary-item">
                    <span>提取 LLM</span>
                    <strong>{displayedResultModel || result.model}</strong>
                  </div>
                  <div className="case-tool-summary-item case-tool-summary-source">
                    <span>文本来源</span>
                    <strong title={importedFileName || result.paper_title || "手动粘贴文本"}>
                      {importedFileName || result.paper_title || "手动粘贴文本"}
                    </strong>
                  </div>
                  <div className="case-tool-summary-item case-tool-summary-status-item">
                    <span>是否无案例</span>
                    <strong>{result.is_none ? "是，返回 None" : "否，进入结构化输出"}</strong>
                  </div>
                </div>
              </div>

              <div className="case-tool-result-card">
                <div className="case-tool-result-head">
                  <h3>结构化结果</h3>
                  <div className="case-tool-view-toggle" role="tablist" aria-label="结构化结果视图切换">
                    <button
                      type="button"
                      className={`case-tool-view-btn ${structuredView === "table" ? "active" : ""}`}
                      onClick={() => setStructuredView("table")}
                    >
                      表格
                    </button>
                    <button
                      type="button"
                      className={`case-tool-view-btn ${structuredView === "json" ? "active" : ""}`}
                      onClick={() => setStructuredView("json")}
                    >
                      JSON
                    </button>
                  </div>
                </div>
                <div className="case-tool-structured-panel">
                  <div className="case-tool-structured-panel-head">
                    {structuredView === "table" ? "表格化预览" : "结构化 JSON"}
                  </div>
                  {structuredView === "json" ? (
                    <pre className="case-tool-code">
                      {result.is_none
                        ? "None"
                        : result.parsed_result
                          ? prettyJson(result.parsed_result)
                          : "模型输出未能解析为 JSON，请查看下方原始输出。"}
                    </pre>
                  ) : (
                    <div className="case-tool-structured-preview">
                      {result.is_none
                        ? "None"
                        : result.parsed_result
                          ? renderStructuredValue(result.parsed_result)
                          : "模型输出未能解析为 JSON，暂时无法渲染表格视图。"}
                    </div>
                  )}

                  {!result.is_none && result.parse_status === "raw" ? (
                    <div className="case-tool-inline-raw">
                      <div className="case-tool-inline-raw-head">原始输出回退</div>
                      <pre className="case-tool-code">{result.raw_output || "无原始输出"}</pre>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default CaseExtractionPage;
