import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import "./CaseExtractionPage.css";
import {
  extractCaseFromPaper,
  getCaseExtractionPrompt,
  type CaseExtractionResponse,
  type CaseExtractorType,
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

export function CaseExtractionPage() {
  const [extractorType, setExtractorType] = useState<CaseExtractorType>("prosail");
  const [paperTitle, setPaperTitle] = useState("");
  const [paperText, setPaperText] = useState("");
  const [importedFileName, setImportedFileName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CaseExtractionResponse | null>(null);
  const [promptTemplate, setPromptTemplate] = useState("");
  const [promptError, setPromptError] = useState("");
  const [isPromptLoading, setIsPromptLoading] = useState(false);

  const currentExtractor = useMemo(
    () => EXTRACTOR_OPTIONS.find((item) => item.value === extractorType) ?? EXTRACTOR_OPTIONS[0],
    [extractorType]
  );

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
      if (!paperTitle.trim()) {
        setPaperTitle(file.name.replace(/\.[^.]+$/, ""));
      }
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
        paper_title: paperTitle.trim(),
      });
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
          <span className="case-tool-eyebrow">Case Extraction Lab</span>
          <h1>案例提取工具</h1>
          <p>把论文正文送入结构化提取器，快速判断是否包含模型实验案例，并产出可直接复核的 JSON。</p>
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

          <div className="case-tool-extractors">
            {EXTRACTOR_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`case-tool-extractor ${extractorType === option.value ? "active" : ""}`}
                onClick={() => {
                  setExtractorType(option.value);
                  setResult(null);
                }}
              >
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </button>
            ))}
          </div>

          <div className="case-tool-field">
            <label htmlFor="paper-title">论文标题</label>
            <input
              id="paper-title"
              className="case-tool-input"
              value={paperTitle}
              onChange={(event) => setPaperTitle(event.target.value)}
              placeholder="可选，便于你后续识别结果来源"
            />
          </div>

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

          {importedFileName ? <div className="case-tool-upload-note">已导入：{importedFileName}</div> : null}

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

          <div className="case-tool-field grow">
            <label htmlFor="paper-text">论文正文</label>
            <textarea
              id="paper-text"
              className="case-tool-textarea"
              value={paperText}
              onChange={(event) => setPaperText(event.target.value)}
              placeholder="把论文摘要、方法、实验与结果等正文内容粘贴到这里。"
            />
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
                setPaperTitle("");
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
            {result ? <span className="case-tool-model-pill">{result.model}</span> : null}
          </div>

          {!result ? (
            <div className="case-tool-empty">
              <h3>结果区待激活</h3>
              <p>提交一段论文文本后，这里会显示 None / JSON 结果、解析状态和原始模型输出。</p>
            </div>
          ) : (
            <div className="case-tool-results">
              <div className="case-tool-result-card accent">
                <div className="case-tool-result-head">
                  <h3>解析状态</h3>
                  <span className={`case-tool-status ${result.parse_status}`}>{result.parse_status}</span>
                </div>
                <div className="case-tool-summary-grid">
                  <div>
                    <span>提取器</span>
                    <strong>{currentExtractor.label}</strong>
                  </div>
                  <div>
                    <span>论文标题</span>
                    <strong>{result.paper_title || "未提供"}</strong>
                  </div>
                  <div>
                    <span>是否无案例</span>
                    <strong>{result.is_none ? "是，返回 None" : "否，进入结构化输出"}</strong>
                  </div>
                </div>
              </div>

              <div className="case-tool-result-card">
                <div className="case-tool-result-head">
                  <h3>结构化结果</h3>
                  <span>{result.parsed_result ? "JSON" : result.is_none ? "None" : "待人工复核"}</span>
                </div>
                <pre className="case-tool-code">
                  {result.is_none
                    ? "None"
                    : result.parsed_result
                      ? prettyJson(result.parsed_result)
                      : "模型输出未能解析为 JSON，请查看右侧原始输出。"}
                </pre>
              </div>

              <div className="case-tool-result-card">
                <div className="case-tool-result-head">
                  <h3>原始输出</h3>
                  <span>Raw</span>
                </div>
                <pre className="case-tool-code">{result.raw_output || "无原始输出"}</pre>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default CaseExtractionPage;
