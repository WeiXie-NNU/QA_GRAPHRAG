import React, { useEffect, useId, useMemo, useState } from "react";
import { loadAdminGeoJson, loadRepositoryRegistry, type RepositoryRegistry } from "../../services/resourceService";

type InterruptValue = {
  task?: string;
  required_fields?: string[];
  optional_fields?: string[];
  missing_required?: string[];
  entities?: Record<string, any>;
  geo_context?: Record<string, any>;
  raw?: string;
};

type AdminFeature = {
  properties?: {
    name?: string;
    gb?: string;
  };
};

type InterruptResources = {
  provinceFeatures: AdminFeature[];
  cityFeatures: AdminFeature[];
  countyFeatures: AdminFeature[];
  repositoryData: RepositoryRegistry | null;
};

type ReviewFormState = {
  feedback: string;
  fullName: string;
  province: string;
  city: string;
  county: string;
  provinceGb: string;
  cityGb: string;
  countyGb: string;
  model: string;
  parametersText: string;
  vegetationType: string;
  timeRange: string;
};

let interruptResourcesCache: InterruptResources | null = null;
let interruptResourcesPromise: Promise<InterruptResources> | null = null;

const normalizeCnName = (value: string) =>
  String(value || "")
    .trim()
    .replace(/省|市|自治区|壮族自治区|回族自治区|维吾尔自治区|特别行政区$/g, "");

const getAdminCode = (gb: string) => {
  const raw = String(gb || "").trim();
  if (raw.length >= 6) {
    return raw.slice(-6);
  }
  return raw;
};

function parseInterruptValue(raw: unknown): InterruptValue {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as InterruptValue) : { task: "请人工确认", raw };
    } catch {
      return { task: "请人工确认", raw };
    }
  }

  if (raw && typeof raw === "object") {
    return raw as InterruptValue;
  }

  return { task: "请人工确认" };
}

function createInitialFormState(value: InterruptValue): ReviewFormState {
  const entities = value.entities && typeof value.entities === "object" ? value.entities : {};
  const location = entities.location && typeof entities.location === "object" ? entities.location : {};

  return {
    feedback: "",
    fullName: String(location.full_name || ""),
    province: String(location.province || ""),
    city: String(location.city || ""),
    county: String(location.county || ""),
    provinceGb: "",
    cityGb: "",
    countyGb: "",
    model: String(entities.model || "PROSAIL"),
    parametersText: Array.isArray(entities.parameters) ? entities.parameters.join(", ") : "",
    vegetationType: String(entities.vegetation_type || ""),
    timeRange: String(entities.experiment_time_range || ""),
  };
}

async function loadInterruptResources(): Promise<InterruptResources> {
  if (interruptResourcesCache) {
    return interruptResourcesCache;
  }

  if (!interruptResourcesPromise) {
    interruptResourcesPromise = Promise.all([
      loadAdminGeoJson("province"),
      loadAdminGeoJson("city"),
      loadAdminGeoJson("county"),
      loadRepositoryRegistry(),
    ])
      .then(([provinceData, cityData, countyData, registryData]) => {
        const next: InterruptResources = {
          provinceFeatures: (((provinceData as any)?.features || []) as AdminFeature[]),
          cityFeatures: (((cityData as any)?.features || []) as AdminFeature[]),
          countyFeatures: (((countyData as any)?.features || []) as AdminFeature[]),
          repositoryData: (registryData || null) as RepositoryRegistry | null,
        };
        interruptResourcesCache = next;
        return next;
      })
      .finally(() => {
        interruptResourcesPromise = null;
      });
  }

  return interruptResourcesPromise;
}

function buildSummaryLines(value: InterruptValue, formState: ReviewFormState): string[] {
  const entities = value.entities && typeof value.entities === "object" ? value.entities : {};
  const lines: string[] = [];
  const locationLabel = [formState.province, formState.city, formState.county].filter(Boolean).join(" / ");

  if (locationLabel) {
    lines.push(`地点 ${locationLabel}`);
  } else if (formState.fullName.trim()) {
    lines.push(`地点 ${formState.fullName.trim()}`);
  }

  if (formState.model.trim()) {
    lines.push(`模型 ${formState.model.trim()}`);
  } else if (entities.model) {
    lines.push(`模型 ${String(entities.model).trim()}`);
  }

  const parameters = formState.parametersText.trim();
  if (parameters) {
    lines.push(`参数 ${parameters}`);
  }

  return lines.slice(0, 3);
}

export const HITLInterruptCard: React.FC<{
  eventValue: unknown;
  resolve: (value: any) => void;
}> = ({ eventValue, resolve }) => {
  const value = useMemo(() => parseInterruptValue(eventValue), [eventValue]);
  const interruptKey = useMemo(() => JSON.stringify(value), [value]);
  const task = String(value.task || "请人工确认");
  const isEntityReview = task.includes("实体抽取") || !!value.entities;
  const requiredFields = Array.isArray(value.required_fields) ? value.required_fields : [];
  const missingFields = Array.isArray(value.missing_required) ? value.missing_required : [];
  const originalEntities = value.entities && typeof value.entities === "object" ? value.entities : {};
  const originalLocation =
    originalEntities.location && typeof originalEntities.location === "object"
      ? originalEntities.location
      : {};

  const [formState, setFormState] = useState<ReviewFormState>(() => createInitialFormState(value));
  const [resources, setResources] = useState<InterruptResources | null>(interruptResourcesCache);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [resourcesError, setResourcesError] = useState("");
  const [validationError, setValidationError] = useState("");
  const [submittingAction, setSubmittingAction] = useState<"approve" | "reject" | "terminate" | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [showEntityJson, setShowEntityJson] = useState(false);
  const [showContextJson, setShowContextJson] = useState(false);
  const dialogTitleId = useId();

  useEffect(() => {
    setFormState(createInitialFormState(value));
    setResources(interruptResourcesCache);
    setResourcesLoading(false);
    setResourcesError("");
    setValidationError("");
    setSubmittingAction(null);
    setShowEntityJson(false);
    setShowContextJson(false);
    setIsDrawerOpen(true);
  }, [interruptKey, value]);

  useEffect(() => {
    if (!isEntityReview) {
      return;
    }

    if (interruptResourcesCache) {
      setResources(interruptResourcesCache);
      return;
    }

    let cancelled = false;
    setResourcesLoading(true);
    setResourcesError("");

    void loadInterruptResources()
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        setResources(loaded);
      })
      .catch(() => {
        if (!cancelled) {
          setResourcesError("资源加载失败，已切换为手动输入模式。");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setResourcesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [interruptKey, isEntityReview]);

  useEffect(() => {
    if (!isDrawerOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submittingAction) {
        setIsDrawerOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDrawerOpen, submittingAction]);

  function updateFormField<K extends keyof ReviewFormState>(key: K, nextValue: ReviewFormState[K]) {
    setFormState((prev) => {
      if (prev[key] === nextValue) {
        return prev;
      }
      return { ...prev, [key]: nextValue };
    });
  }

  const provinceOptions = useMemo(() => {
    return (resources?.provinceFeatures || [])
      .map((feature) => ({
        name: String(feature.properties?.name || "").trim(),
        gb: String(feature.properties?.gb || "").trim(),
      }))
      .filter((item) => item.name && item.gb)
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [resources]);

  const cityOptions = useMemo(() => {
    if (!formState.provinceGb) {
      return [];
    }

    const provCode = getAdminCode(formState.provinceGb);
    const provPrefix = provCode.slice(0, 2);

    return (resources?.cityFeatures || [])
      .map((feature) => ({
        name: String(feature.properties?.name || "").trim(),
        gb: String(feature.properties?.gb || "").trim(),
      }))
      .filter((item) => {
        if (!item.name || !item.gb) {
          return false;
        }
        return getAdminCode(item.gb).slice(0, 2) === provPrefix;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [formState.provinceGb, resources]);

  const countyOptions = useMemo(() => {
    if (!formState.provinceGb) {
      return [];
    }

    const provCode = getAdminCode(formState.provinceGb);
    const provPrefix = provCode.slice(0, 2);
    const cityPrefix = formState.cityGb ? getAdminCode(formState.cityGb).slice(0, 4) : "";

    return (resources?.countyFeatures || [])
      .map((feature) => ({
        name: String(feature.properties?.name || "").trim(),
        gb: String(feature.properties?.gb || "").trim(),
      }))
      .filter((item) => {
        if (!item.name || !item.gb) {
          return false;
        }

        const code = getAdminCode(item.gb);
        if (cityPrefix) {
          return code.slice(0, 4) === cityPrefix;
        }
        return code.slice(0, 2) === provPrefix;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [formState.cityGb, formState.provinceGb, resources]);

  const modelOptions = useMemo(() => {
    const repos = (resources?.repositoryData?.knowledge_repositories || [])
      .filter((repo) => repo.enabled !== false)
      .map((repo) => {
        const modelValue = String(repo.model_dir_name || repo.id || "").trim().toUpperCase();
        const label = String(repo.name || modelValue).trim();
        return { value: modelValue, label };
      })
      .filter((item) => item.value);

    const unique = new Map<string, { value: string; label: string }>();
    repos.forEach((item) => unique.set(item.value, item));
    return Array.from(unique.values());
  }, [resources]);

  useEffect(() => {
    if (formState.provinceGb || !provinceOptions.length) {
      return;
    }

    const hit = provinceOptions.find((option) => normalizeCnName(option.name) === normalizeCnName(formState.province));
    if (hit?.gb) {
      updateFormField("provinceGb", hit.gb);
    }
  }, [formState.province, formState.provinceGb, provinceOptions]);

  useEffect(() => {
    if (formState.cityGb || !cityOptions.length) {
      return;
    }

    const hit = cityOptions.find((option) => normalizeCnName(option.name) === normalizeCnName(formState.city));
    if (hit?.gb) {
      updateFormField("cityGb", hit.gb);
    }
  }, [cityOptions, formState.city, formState.cityGb]);

  useEffect(() => {
    if (!modelOptions.length) {
      return;
    }

    const normalized = String(formState.model || "").trim().toUpperCase();
    if (!normalized) {
      updateFormField("model", modelOptions[0].value);
      return;
    }

    if (!modelOptions.some((item) => item.value === normalized)) {
      updateFormField("model", modelOptions[0].value);
      return;
    }

    if (normalized !== formState.model) {
      updateFormField("model", normalized);
    }
  }, [formState.model, modelOptions]);

  useEffect(() => {
    if (!formState.provinceGb) {
      if (formState.cityGb || formState.countyGb || formState.city || formState.county) {
        setFormState((prev) => ({
          ...prev,
          cityGb: "",
          countyGb: "",
          city: "",
          county: "",
        }));
      }
      return;
    }

    const cityValid = !formState.cityGb || cityOptions.some((item) => item.gb === formState.cityGb);
    const countyValid = !formState.countyGb || countyOptions.some((item) => item.gb === formState.countyGb);

    if (cityValid && countyValid) {
      return;
    }

    setFormState((prev) => ({
      ...prev,
      cityGb: cityValid ? prev.cityGb : "",
      city: cityValid ? prev.city : "",
      countyGb: countyValid ? prev.countyGb : "",
      county: countyValid ? prev.county : "",
    }));
  }, [
    cityOptions,
    countyOptions,
    formState.city,
    formState.cityGb,
    formState.county,
    formState.countyGb,
    formState.provinceGb,
  ]);

  const entitySummary = originalEntities && Object.keys(originalEntities).length
    ? JSON.stringify(originalEntities, null, 2)
    : "";
  const geoContextSummary = value.geo_context && Object.keys(value.geo_context).length
    ? JSON.stringify(value.geo_context, null, 2)
    : "";
  const summaryLines = buildSummaryLines(value, formState);

  const buildEntitiesPatch = (): Record<string, any> => {
    const patch: Record<string, any> = {};
    const locationPatch: Record<string, string> = {};

    if (formState.fullName !== String(originalLocation.full_name || "")) {
      locationPatch.full_name = formState.fullName;
    }
    if (formState.province !== String(originalLocation.province || "")) {
      locationPatch.province = formState.province;
    }
    if (formState.city !== String(originalLocation.city || "")) {
      locationPatch.city = formState.city;
    }
    if (formState.county !== String(originalLocation.county || "")) {
      locationPatch.county = formState.county;
    }
    if (Object.keys(locationPatch).length) {
      patch.location = locationPatch;
    }

    if (formState.model !== String(originalEntities.model || "")) {
      patch.model = formState.model;
    }

    const parsedParameters = formState.parametersText
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const originalParameters = Array.isArray(originalEntities.parameters) ? originalEntities.parameters : [];
    if (JSON.stringify(parsedParameters) !== JSON.stringify(originalParameters)) {
      patch.parameters = parsedParameters;
    }

    if (formState.vegetationType !== String(originalEntities.vegetation_type || "")) {
      patch.vegetation_type = formState.vegetationType;
    }

    if (formState.timeRange !== String(originalEntities.experiment_time_range || "")) {
      patch.experiment_time_range = formState.timeRange;
    }

    return patch;
  };

  const handleResolve = (action: "approve" | "reject" | "terminate") => {
    const provinceValue = formState.province.trim();
    if (isEntityReview && !provinceValue) {
      setValidationError("省份为必填项，请先补全后再提交。");
      setIsDrawerOpen(true);
      return;
    }

    setValidationError("");
    setSubmittingAction(action);

    const payload =
      action === "terminate"
        ? {
            action: "terminate",
            terminate: true,
            approved: false,
            feedback: formState.feedback || "用户主动结束本次推理",
            ...(isEntityReview ? { entities_patch: buildEntitiesPatch() } : {}),
          }
        : {
            approved: action === "approve",
            feedback:
              formState.feedback ||
              (action === "approve" ? "人工审核通过" : "人工审核未通过，请按建议补充"),
            ...(isEntityReview ? { entities_patch: buildEntitiesPatch() } : {}),
          };

    void Promise.resolve(resolve(payload)).finally(() => {
      setSubmittingAction(null);
    });
  };

  const resourceHint = resourcesLoading
    ? "正在准备行政区与模型资源..."
    : resourcesError
      ? resourcesError
      : isEntityReview
        ? "已进入人工审核，请打开面板完成复核。"
        : "流程等待人工确认。";

  return (
    <>
      <div className="hitl-card">
        <div className="hitl-card-header">
          <div className="hitl-card-heading">
            <span className="hitl-card-badge">HITL</span>
            <span className="hitl-card-title">人工审核</span>
          </div>
          <span className="hitl-status-pill">待处理</span>
        </div>

        <div className="hitl-card-task">{task}</div>
        <div className="hitl-card-summary">{resourceHint}</div>

        {summaryLines.length ? (
          <div className="hitl-card-meta">
            {summaryLines.map((line) => (
              <span key={line} className="hitl-meta-chip">
                {line}
              </span>
            ))}
          </div>
        ) : null}

        {!!(requiredFields.length || missingFields.length) && (
          <div className="hitl-card-tags">
            {requiredFields.map((field) => (
              <span key={field} className="hitl-tag">
                {field}
              </span>
            ))}
            {missingFields.map((field) => (
              <span key={`missing-${field}`} className="hitl-tag missing">
                缺失 {field}
              </span>
            ))}
          </div>
        )}

        <div className="hitl-card-inline-actions">
          <button type="button" className="hitl-btn primary" onClick={() => setIsDrawerOpen(true)}>
            打开审核面板
          </button>
          <span className="hitl-inline-note">处理中断前，聊天输入会暂时锁定。</span>
        </div>
      </div>

      {isDrawerOpen ? (
        <>
          <button
            type="button"
            className="hitl-drawer-backdrop"
            aria-label="关闭人工审核面板"
            onClick={() => setIsDrawerOpen(false)}
          />
          <aside
            className="hitl-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            aria-label="人工审核面板"
          >
            <div className="hitl-drawer-header">
              <div>
                <div className="hitl-card-heading">
                  <span className="hitl-card-badge">HITL</span>
                  <span className="hitl-card-title" id={dialogTitleId}>人工审核</span>
                </div>
                <div className="hitl-drawer-task">{task}</div>
                <div className="hitl-drawer-subtitle">
                  {missingFields.length
                    ? `当前仍有 ${missingFields.length} 个关键字段待确认。`
                    : "请确认信息后继续推理流程。"}
                </div>
              </div>
              <button
                type="button"
                className="hitl-drawer-close"
                onClick={() => setIsDrawerOpen(false)}
                disabled={Boolean(submittingAction)}
              >
                关闭
              </button>
            </div>

            <div className="hitl-drawer-body">
              {!!(requiredFields.length || missingFields.length) && (
                <section className="hitl-section-card">
                  <div className="hitl-card-label">需优先关注</div>
                  <div className="hitl-card-tags">
                    {requiredFields.map((field) => (
                      <span key={field} className="hitl-tag">
                        {field}
                      </span>
                    ))}
                    {missingFields.map((field) => (
                      <span key={`drawer-missing-${field}`} className="hitl-tag missing">
                        缺失 {field}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {resourcesError ? (
                <section className="hitl-section-card hitl-section-warning">
                  <div className="hitl-card-label">资源提示</div>
                  <div className="hitl-inline-note">{resourcesError}</div>
                </section>
              ) : null}

              {isEntityReview ? (
                <section className="hitl-section-card">
                  <div className="hitl-card-label">修正并提交</div>
                  <div className="hitl-form-grid">
                    <div className="hitl-field hitl-field-span-2">
                      <label className="hitl-field-label">完整地点（full_name）</label>
                      <input
                        className="hitl-input"
                        placeholder="请输入完整地点"
                        value={formState.fullName}
                        onChange={(event) => updateFormField("fullName", event.target.value)}
                      />
                    </div>

                    <div className="hitl-field">
                      <label className="hitl-field-label">
                        <span className="hitl-required-mark">*</span>
                        省
                      </label>
                      {resourcesError ? (
                        <input
                          className="hitl-input"
                          placeholder="请输入省份"
                          value={formState.province}
                          onChange={(event) => updateFormField("province", event.target.value)}
                        />
                      ) : (
                        <select
                          className="hitl-input"
                          value={formState.provinceGb}
                          onChange={(event) => {
                            const gb = event.target.value;
                            const hit = provinceOptions.find((option) => option.gb === gb);
                            setFormState((prev) => ({
                              ...prev,
                              provinceGb: gb,
                              province: hit?.name || "",
                              cityGb: "",
                              city: "",
                              countyGb: "",
                              county: "",
                            }));
                          }}
                          disabled={resourcesLoading}
                        >
                          <option value="">{resourcesLoading ? "加载省份中..." : "请选择省"}</option>
                          {provinceOptions.map((option) => (
                            <option key={option.gb} value={option.gb}>
                              {option.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    <div className="hitl-field">
                      <label className="hitl-field-label">模型</label>
                      {resourcesError ? (
                        <input
                          className="hitl-input"
                          placeholder="请输入模型名称"
                          value={formState.model}
                          onChange={(event) => updateFormField("model", event.target.value)}
                        />
                      ) : (
                        <select
                          className="hitl-input"
                          value={formState.model}
                          onChange={(event) => updateFormField("model", event.target.value)}
                          disabled={resourcesLoading}
                        >
                          {!modelOptions.length ? <option value="">暂无可用模型</option> : null}
                          {modelOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    <div className="hitl-field">
                      <label className="hitl-field-label">市（可选）</label>
                      {resourcesError ? (
                        <input
                          className="hitl-input"
                          placeholder="请输入城市"
                          value={formState.city}
                          onChange={(event) => updateFormField("city", event.target.value)}
                        />
                      ) : (
                        <select
                          className="hitl-input"
                          value={formState.cityGb}
                          onChange={(event) => {
                            const gb = event.target.value;
                            const hit = cityOptions.find((option) => option.gb === gb);
                            setFormState((prev) => ({
                              ...prev,
                              cityGb: gb,
                              city: hit?.name || "",
                              countyGb: "",
                              county: "",
                            }));
                          }}
                          disabled={!formState.provinceGb || resourcesLoading}
                        >
                          <option value="">
                            {!formState.provinceGb ? "请先选择省" : resourcesLoading ? "加载城市中..." : "请选择市（可选）"}
                          </option>
                          {cityOptions.map((option) => (
                            <option key={option.gb} value={option.gb}>
                              {option.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    <div className="hitl-field">
                      <label className="hitl-field-label">县（可选）</label>
                      {resourcesError ? (
                        <input
                          className="hitl-input"
                          placeholder="请输入区县"
                          value={formState.county}
                          onChange={(event) => updateFormField("county", event.target.value)}
                        />
                      ) : (
                        <select
                          className="hitl-input"
                          value={formState.countyGb}
                          onChange={(event) => {
                            const gb = event.target.value;
                            const hit = countyOptions.find((option) => option.gb === gb);
                            setFormState((prev) => ({
                              ...prev,
                              countyGb: gb,
                              county: hit?.name || "",
                            }));
                          }}
                          disabled={!formState.provinceGb || resourcesLoading}
                        >
                          <option value="">
                            {!formState.provinceGb ? "请先选择省" : resourcesLoading ? "加载区县中..." : "请选择县（可选）"}
                          </option>
                          {countyOptions.map((option) => (
                            <option key={option.gb} value={option.gb}>
                              {option.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    <div className="hitl-field">
                      <label className="hitl-field-label">参数（逗号分隔）</label>
                      <input
                        className="hitl-input"
                        placeholder="如 Cab, LAI, Cw"
                        value={formState.parametersText}
                        onChange={(event) => updateFormField("parametersText", event.target.value)}
                      />
                    </div>

                    <div className="hitl-field">
                      <label className="hitl-field-label">植被类型（可选）</label>
                      <input
                        className="hitl-input"
                        placeholder="如 农作物"
                        value={formState.vegetationType}
                        onChange={(event) => updateFormField("vegetationType", event.target.value)}
                      />
                    </div>

                    <div className="hitl-field">
                      <label className="hitl-field-label">实验时间范围（可选）</label>
                      <input
                        className="hitl-input"
                        placeholder="如 2020-2021"
                        value={formState.timeRange}
                        onChange={(event) => updateFormField("timeRange", event.target.value)}
                      />
                    </div>
                  </div>
                </section>
              ) : null}

              <section className="hitl-section-card">
                <div className="hitl-card-label">审核意见</div>
                <textarea
                  className="hitl-textarea"
                  placeholder="可填写修改建议、审批意见或终止原因"
                  value={formState.feedback}
                  rows={4}
                  onChange={(event) => updateFormField("feedback", event.target.value)}
                />
              </section>

              {!!entitySummary && (
                <section className="hitl-section-card">
                  <button
                    type="button"
                    className="hitl-toggle"
                    onClick={() => setShowEntityJson((prev) => !prev)}
                  >
                    {showEntityJson ? "收起当前抽取" : "查看当前抽取"}
                  </button>
                  {showEntityJson ? <pre className="hitl-card-json">{entitySummary}</pre> : null}
                </section>
              )}

              {!!geoContextSummary && (
                <section className="hitl-section-card">
                  <button
                    type="button"
                    className="hitl-toggle"
                    onClick={() => setShowContextJson((prev) => !prev)}
                  >
                    {showContextJson ? "收起上下文" : "查看待审批上下文"}
                  </button>
                  {showContextJson ? <pre className="hitl-card-json">{geoContextSummary}</pre> : null}
                </section>
              )}
            </div>

            <div className="hitl-drawer-footer">
              {validationError ? <div className="hitl-validation">{validationError}</div> : null}
              <div className="hitl-footer-actions">
                <button
                  type="button"
                  className="hitl-btn ghost"
                  onClick={() => setIsDrawerOpen(false)}
                  disabled={Boolean(submittingAction)}
                >
                  稍后处理
                </button>
                <button
                  type="button"
                  className="hitl-btn terminate"
                  onClick={() => handleResolve("terminate")}
                  disabled={Boolean(submittingAction)}
                >
                  {submittingAction === "terminate" ? "提交中..." : "结束本次推理"}
                </button>
                <button
                  type="button"
                  className="hitl-btn reject"
                  onClick={() => handleResolve("reject")}
                  disabled={Boolean(submittingAction)}
                >
                  {submittingAction === "reject" ? "提交中..." : "驳回并提交"}
                </button>
                <button
                  type="button"
                  className="hitl-btn approve"
                  onClick={() => handleResolve("approve")}
                  disabled={Boolean(submittingAction)}
                >
                  {submittingAction === "approve" ? "提交中..." : "通过并继续"}
                </button>
              </div>
            </div>
          </aside>
        </>
      ) : null}
    </>
  );
};

export default HITLInterruptCard;
