import React, { useMemo, useState } from "react";
import "./ProgressDisplay.css";

export interface Step {
  description: string;
  status: string;
  updates?: string[];
}

export interface ProgressData {
  steps: Step[];
}

interface ProgressDisplayProps {
  progressData: ProgressData;
}

type NormalizedStepState = "running" | "completed" | "failed" | "idle";

interface NormalizedStep {
  index: number;
  description: string;
  updates: string[];
  state: NormalizedStepState;
}

function normalizeStepState(status: string | undefined): NormalizedStepState {
  const raw = String(status || "").trim().toLowerCase();
  if (raw === "running" || raw === "executing") return "running";
  if (raw === "complete" || raw === "completed") return "completed";
  if (raw === "failed" || raw === "error") return "failed";
  return "idle";
}

function cleanUpdateText(text: string): string {
  return text.replace(/^[✓√✔\s]+/, "").trim();
}

function getVisibleSteps(steps: Step[]): NormalizedStep[] {
  return steps
    .map((step, index) => ({
      index,
      description: String(step.description || "").trim(),
      updates: (step.updates || []).map(cleanUpdateText).filter(Boolean),
      state: normalizeStepState(step.status),
    }))
    .filter((step) => {
      if (!step.description) return false;
      return step.state !== "idle";
    });
}

function getSummaryStep(steps: NormalizedStep[]): NormalizedStep | null {
  if (!steps.length) return null;

  const activeStep = steps.find((step) => step.state === "running");
  if (activeStep) return activeStep;

  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (step.state === "failed" || step.state === "completed") {
      return step;
    }
  }

  return steps[steps.length - 1];
}

function getSummaryLabel(step: NormalizedStep, hasMultipleSteps: boolean): string {
  if (step.state === "running") {
    return hasMultipleSteps ? "正在处理" : "处理中";
  }
  if (step.state === "failed") {
    return "执行异常";
  }
  return "流程完成";
}

function getSummaryDetail(step: NormalizedStep): string {
  if (step.updates.length > 0) {
    return step.updates[step.updates.length - 1];
  }

  if (step.state === "running") {
    return "智能体正在继续处理当前节点";
  }
  if (step.state === "failed") {
    return "该节点执行失败，请展开查看上下文";
  }
  return "点击可查看完整处理链路";
}

function StatusGlyph({ state }: { state: NormalizedStepState }) {
  if (state === "running") {
    return (
      <span className="progress-summary-icon progress-summary-icon-running" aria-hidden="true">
        <span className="progress-spinner-ring" />
      </span>
    );
  }

  if (state === "failed") {
    return (
      <span className="progress-summary-icon progress-summary-icon-failed" aria-hidden="true">
        !
      </span>
    );
  }

  return (
    <span className="progress-summary-icon progress-summary-icon-completed" aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M3.5 8.5 6.5 11.2 12.5 4.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export const ProgressDisplay: React.FC<ProgressDisplayProps> = ({ progressData }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const visibleSteps = useMemo(
    () => getVisibleSteps(progressData?.steps || []),
    [progressData?.steps],
  );

  const summaryStep = useMemo(
    () => getSummaryStep(visibleSteps),
    [visibleSteps],
  );

  if (!summaryStep) {
    return null;
  }

  const hasMultipleSteps = visibleSteps.length > 1;
  const summaryLabel = getSummaryLabel(summaryStep, hasMultipleSteps);
  const summaryDetail = getSummaryDetail(summaryStep);
  const canExpand = hasMultipleSteps || visibleSteps.some((step) => step.updates.length > 0);

  return (
    <section className="progress-card" data-test-id="progress-steps">
      <button
        type="button"
        className={`progress-summary ${isExpanded ? "expanded" : ""}`}
        onClick={() => canExpand && setIsExpanded((prev) => !prev)}
        aria-expanded={canExpand ? isExpanded : undefined}
        disabled={!canExpand}
      >
        <div className="progress-summary-main">
          <StatusGlyph state={summaryStep.state} />
          <div className="progress-summary-copy">
            <div className="progress-summary-topline">
              <span className={`progress-summary-status is-${summaryStep.state}`}>{summaryLabel}</span>
              <span className="progress-summary-divider" aria-hidden="true" />
              <span className="progress-summary-step">{summaryStep.description}</span>
            </div>
            <div className="progress-summary-detail">{summaryDetail}</div>
          </div>
        </div>
        {canExpand ? (
          <span className={`progress-summary-toggle ${isExpanded ? "expanded" : ""}`} aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        ) : null}
      </button>

      {canExpand && isExpanded ? (
        <div className="progress-detail-list">
          {visibleSteps.map((step, index) => (
            <div key={`${step.index}-${step.description}`} className={`progress-detail-item is-${step.state}`}>
              <div className="progress-detail-rail" aria-hidden="true">
                <span className={`progress-detail-dot is-${step.state}`} />
                {index < visibleSteps.length - 1 ? <span className="progress-detail-line" /> : null}
              </div>
              <div className="progress-detail-body">
                <div className="progress-detail-head">
                  <span className="progress-detail-title">{step.description}</span>
                  <span className={`progress-detail-badge is-${step.state}`}>
                    {step.state === "running"
                      ? "处理中"
                      : step.state === "failed"
                        ? "异常"
                        : "完成"}
                  </span>
                </div>
                {step.updates.length > 0 ? (
                  <div className="progress-detail-updates">
                    {step.updates.map((update, updateIndex) => (
                      <div key={`${step.index}-${updateIndex}`} className="progress-detail-update">
                        {update}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
};

export default ProgressDisplay;
