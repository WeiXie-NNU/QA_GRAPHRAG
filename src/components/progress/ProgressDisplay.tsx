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
  isActive?: boolean;
}

type NormalizedStepState = "running" | "completed" | "failed" | "idle";

interface NormalizedStep {
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

function cleanStepDescription(text: string): string {
  return String(text || "")
    .replace(/^[^A-Za-z0-9\u4e00-\u9fa5]+/u, "")
    .trim();
}

function getVisibleSteps(steps: Step[]): NormalizedStep[] {
  return steps
    .map((step) => ({
      description: cleanStepDescription(step.description || ""),
      updates: (step.updates || []).map(cleanUpdateText).filter(Boolean),
      state: normalizeStepState(step.status),
    }))
    .filter((step) => step.description && step.state !== "idle");
}

function getSummaryStep(steps: NormalizedStep[]): NormalizedStep | null {
  if (!steps.length) {
    return null;
  }

  const runningStep = steps.find((step) => step.state === "running");
  if (runningStep) {
    return runningStep;
  }

  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.state === "failed" || step.state === "completed") {
      return step;
    }
  }

  return steps[steps.length - 1];
}

function getSummaryDetail(step: NormalizedStep): string {
  if (step.updates.length > 0) {
    return step.updates[step.updates.length - 1];
  }

  if (step.state === "failed") {
    return "节点执行异常";
  }

  return step.description;
}

function StatusGlyph({ state, isActive }: { state: NormalizedStepState; isActive: boolean }) {
  if (state === "running" && isActive) {
    return (
      <span className="progress-glyph progress-glyph-running" aria-hidden="true">
        <span className="progress-glyph-spinner" />
      </span>
    );
  }

  if (state === "failed") {
    return (
      <span className="progress-glyph progress-glyph-failed" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M5 5 11 11M11 5 5 11" strokeLinecap="round" />
        </svg>
      </span>
    );
  }

  return (
    <span className="progress-glyph progress-glyph-completed" aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M3.5 8.5 6.5 11.2 12.5 4.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export const ProgressDisplay: React.FC<ProgressDisplayProps> = ({
  progressData,
  isActive = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const visibleSteps = useMemo(() => getVisibleSteps(progressData?.steps || []), [progressData?.steps]);
  const summaryStep = useMemo(() => getSummaryStep(visibleSteps), [visibleSteps]);

  if (!summaryStep) {
    return null;
  }

  const effectiveState =
    summaryStep.state === "running" && !isActive ? "completed" : summaryStep.state;
  const summaryDetail = getSummaryDetail(summaryStep);
  const canExpand = visibleSteps.length > 1 || visibleSteps.some((step) => step.updates.length > 0);

  return (
    <section
      className={`progress-summary-card is-${effectiveState}`}
      data-test-id="progress-steps"
    >
      <button
        type="button"
        className={`progress-summary-card-shell ${isExpanded ? "expanded" : ""}`}
        onClick={() => canExpand && setIsExpanded((prev) => !prev)}
        aria-expanded={canExpand ? isExpanded : undefined}
        disabled={!canExpand}
      >
        <StatusGlyph state={effectiveState} isActive={isActive} />
        <div className="progress-summary-card-copy">
          <div className="progress-summary-card-title">{summaryStep.description}</div>
          <div className="progress-summary-card-detail" title={summaryDetail}>
            {summaryDetail}
          </div>
        </div>
        {canExpand ? (
          <span className={`progress-summary-card-toggle ${isExpanded ? "expanded" : ""}`} aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        ) : null}
      </button>
      {canExpand && isExpanded ? (
        <div className="progress-detail-list">
          {visibleSteps.map((step, index) => {
            const detail = getSummaryDetail(step);

            return (
              <div key={`${step.description}-${index}`} className={`progress-detail-item is-${step.state}`}>
                <div className="progress-detail-title">{step.description}</div>
                {detail && detail !== step.description ? (
                  <div className="progress-detail-note" title={detail}>
                    {detail}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
};

export default ProgressDisplay;
