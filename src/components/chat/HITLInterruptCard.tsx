import React, { useEffect, useMemo, useState } from "react";
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

const normalizeCnName = (value: string) =>
  String(value || "")
    .trim()
    .replace(/省|市|自治区|壮族自治区|回族自治区|维吾尔自治区|特别行政区$/g, "");

const getAdminCode = (gb: string) => {
  const raw = String(gb || "").trim();
  // geojson 中 gb 常见格式为 156 + 6位行政区码（如 156440000）
  if (raw.length >= 6) return raw.slice(-6);
  return raw;
};

function parseInterruptValue(raw: unknown): InterruptValue {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === "object") ? (parsed as InterruptValue) : { task: "请人工确认", raw };
    } catch {
      return { task: "请人工确认", raw };
    }
  }
  if (raw && typeof raw === "object") {
    return raw as InterruptValue;
  }
  return { task: "请人工确认" };
}

export const HITLInterruptCard: React.FC<{
  eventValue: unknown;
  resolve: (value: any) => void;
}> = ({ eventValue, resolve }) => {
  const value = useMemo(() => parseInterruptValue(eventValue), [eventValue]);
  const task = (value.task as string) || "请人工确认";
  const isEntityReview = task.includes("实体抽取") || !!value.entities;
  const requiredFields = Array.isArray(value.required_fields) ? value.required_fields : [];
  const missingFields = Array.isArray(value.missing_required) ? value.missing_required : [];
  const originalEntities = (value.entities && typeof value.entities === "object") ? value.entities : {};
  const originalLocation = (originalEntities.location && typeof originalEntities.location === "object")
    ? originalEntities.location
    : {};

  const [feedback, setFeedback] = useState("");
  const [fullName, setFullName] = useState(String(originalLocation.full_name || ""));
  const [province, setProvince] = useState(String(originalLocation.province || ""));
  const [city, setCity] = useState(String(originalLocation.city || ""));
  const [county, setCounty] = useState(String(originalLocation.county || ""));
  const [provinceGb, setProvinceGb] = useState("");
  const [cityGb, setCityGb] = useState("");
  const [countyGb, setCountyGb] = useState("");
  const [model, setModel] = useState(String(originalEntities.model || "PROSAIL"));
  const [parametersText, setParametersText] = useState(
    Array.isArray(originalEntities.parameters) ? originalEntities.parameters.join(", ") : ""
  );
  const [vegetationType, setVegetationType] = useState(String(originalEntities.vegetation_type || ""));
  const [timeRange, setTimeRange] = useState(String(originalEntities.experiment_time_range || ""));
  const [provinceFeatures, setProvinceFeatures] = useState<AdminFeature[]>([]);
  const [cityFeatures, setCityFeatures] = useState<AdminFeature[]>([]);
  const [countyFeatures, setCountyFeatures] = useState<AdminFeature[]>([]);
  const [repositoryData, setRepositoryData] = useState<RepositoryRegistry | null>(null);
  const [resourcesLoading, setResourcesLoading] = useState(false);

  useEffect(() => {
    if (!isEntityReview) return;
    if (provinceFeatures.length && cityFeatures.length && countyFeatures.length && repositoryData) return;
    let cancelled = false;
    setResourcesLoading(true);
    void Promise.all([
      loadAdminGeoJson("province"),
      loadAdminGeoJson("city"),
      loadAdminGeoJson("county"),
      loadRepositoryRegistry(),
    ])
      .then(([provinceData, cityData, countyData, registryData]) => {
        if (cancelled) return;
        setProvinceFeatures(((provinceData as any)?.features || []) as AdminFeature[]);
        setCityFeatures(((cityData as any)?.features || []) as AdminFeature[]);
        setCountyFeatures(((countyData as any)?.features || []) as AdminFeature[]);
        setRepositoryData((registryData || null) as RepositoryRegistry | null);
      })
      .finally(() => {
        if (!cancelled) setResourcesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isEntityReview, provinceFeatures.length, cityFeatures.length, countyFeatures.length, repositoryData]);

  const modelOptions = useMemo(() => {
    const repos = (repositoryData?.knowledge_repositories || [])
      .filter((repo) => repo.enabled !== false)
      .map((repo) => {
        const value = String(repo.model_dir_name || repo.id || "").trim().toUpperCase();
        const label = String(repo.name || value).trim();
        return { value, label };
      })
      .filter((x) => x.value);
    const unique = new Map<string, { value: string; label: string }>();
    repos.forEach((x) => unique.set(x.value, x));
    return Array.from(unique.values());
  }, [repositoryData]);

  useEffect(() => {
    if (!modelOptions.length) return;
    const normalized = String(model || "").trim().toUpperCase();
    if (!normalized) {
      setModel(modelOptions[0].value);
      return;
    }
    const matched = modelOptions.some((x) => x.value === normalized);
    if (!matched) setModel(modelOptions[0].value);
    else if (normalized !== model) setModel(normalized);
  }, [model, modelOptions]);

  const provinceOptions = useMemo(() => {
    return provinceFeatures
      .map((f) => ({
        name: String(f.properties?.name || "").trim(),
        gb: String(f.properties?.gb || "").trim(),
      }))
      .filter((x) => x.name && x.gb)
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [provinceFeatures]);

  useEffect(() => {
    if (provinceGb) return;
    const hit = provinceOptions.find((p) => normalizeCnName(p.name) === normalizeCnName(province));
    if (hit?.gb) setProvinceGb(hit.gb);
  }, [province, provinceGb, provinceOptions]);

  const cityOptions = useMemo(() => {
    if (!provinceGb) return [];
    const provCode = getAdminCode(provinceGb);
    const provPrefix = provCode.slice(0, 2);
    return cityFeatures
      .map((f) => ({
        name: String(f.properties?.name || "").trim(),
        gb: String(f.properties?.gb || "").trim(),
      }))
      .filter((x) => {
        if (!x.name || !x.gb) return false;
        const code = getAdminCode(x.gb);
        return code.slice(0, 2) === provPrefix;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [cityFeatures, provinceGb]);

  useEffect(() => {
    if (cityGb) return;
    const hit = cityOptions.find((c) => normalizeCnName(c.name) === normalizeCnName(city));
    if (hit?.gb) setCityGb(hit.gb);
  }, [city, cityGb, cityOptions]);

  const countyOptions = useMemo(() => {
    if (!provinceGb) return [];
    const provCode = getAdminCode(provinceGb);
    const provPrefix = provCode.slice(0, 2);
    const cityPrefix = cityGb ? getAdminCode(cityGb).slice(0, 4) : "";
    return countyFeatures
      .map((f) => ({
        name: String(f.properties?.name || "").trim(),
        gb: String(f.properties?.gb || "").trim(),
      }))
      .filter((x) => {
        if (!x.name || !x.gb) return false;
        const code = getAdminCode(x.gb);
        if (cityPrefix) return code.slice(0, 4) === cityPrefix;
        return code.slice(0, 2) === provPrefix;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [countyFeatures, provinceGb, cityGb]);

  useEffect(() => {
    if (!provinceGb) {
      if (cityGb) setCityGb("");
      if (countyGb) setCountyGb("");
      if (city) setCity("");
      if (county) setCounty("");
      return;
    }
    const cityValid = !cityGb || cityOptions.some((c) => c.gb === cityGb);
    if (!cityValid) {
      setCityGb("");
      setCity("");
    }

    const countyValid = !countyGb || countyOptions.some((c) => c.gb === countyGb);
    if (!countyValid) {
      setCountyGb("");
      setCounty("");
    }
  }, [provinceGb, cityGb, countyGb, city, county, cityOptions, countyOptions]);

  const details = missingFields.length ? `缺失字段: ${missingFields.join(", ")}` : "";
  const entitySummary = originalEntities && Object.keys(originalEntities).length
    ? JSON.stringify(originalEntities, null, 2)
    : "";
  const geoContextSummary = value.geo_context && Object.keys(value.geo_context).length
    ? JSON.stringify(value.geo_context, null, 2)
    : "";

  const buildEntitiesPatch = (): Record<string, any> => {
    const patch: Record<string, any> = {};
    const locationPatch: Record<string, string> = {};

    const oldFullName = String(originalLocation.full_name || "");
    const oldProvince = String(originalLocation.province || "");
    const oldCity = String(originalLocation.city || "");
    const oldCounty = String(originalLocation.county || "");
    if (fullName !== oldFullName) locationPatch.full_name = fullName;
    if (province !== oldProvince) locationPatch.province = province;
    if (city !== oldCity) locationPatch.city = city;
    if (county !== oldCounty) locationPatch.county = county;
    if (Object.keys(locationPatch).length) patch.location = locationPatch;

    const oldModel = String(originalEntities.model || "");
    if (model !== oldModel) patch.model = model;

    const parsedParams = parametersText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const oldParams = Array.isArray(originalEntities.parameters) ? originalEntities.parameters : [];
    if (JSON.stringify(parsedParams) !== JSON.stringify(oldParams)) patch.parameters = parsedParams;

    const oldVegetation = String(originalEntities.vegetation_type || "");
    if (vegetationType !== oldVegetation) patch.vegetation_type = vegetationType;

    const oldTimeRange = String(originalEntities.experiment_time_range || "");
    if (timeRange !== oldTimeRange) patch.experiment_time_range = timeRange;

    return patch;
  };

  const onApprove = () => {
    if (isEntityReview && !provinceGb.trim()) {
      window.alert("省份为必填项，请先选择省。");
      return;
    }
    if (isEntityReview) {
      resolve({
        approved: true,
        feedback: feedback || "人工审核通过",
        entities_patch: buildEntitiesPatch(),
      });
      return;
    }
    resolve({ approved: true, feedback: feedback || "人工审批通过" });
  };

  const onReject = () => {
    if (isEntityReview) {
      resolve({
        approved: false,
        feedback: feedback || "人工审核未通过，请按建议补充",
        entities_patch: buildEntitiesPatch(),
      });
      return;
    }
    resolve({ approved: false, feedback: feedback || "人工审批驳回，请补充信息" });
  };

  const onTerminate = () => {
    if (isEntityReview) {
      resolve({
        action: "terminate",
        terminate: true,
        approved: false,
        feedback: feedback || "用户主动结束本次推理",
        entities_patch: buildEntitiesPatch(),
      });
      return;
    }
    resolve({
      action: "terminate",
      terminate: true,
      approved: false,
      feedback: feedback || "用户主动结束本次推理",
    });
  };

  return (
    <div className="hitl-card">
      <div className="hitl-card-header">
        <span className="hitl-card-badge">HITL</span>
        <span className="hitl-card-title">人工审核</span>
      </div>
      <div className="hitl-card-task">{task}</div>
      {details ? <div className="hitl-card-details">{details}</div> : null}

      {!!requiredFields.length && (
        <div className="hitl-card-section">
          <div className="hitl-card-label">必填字段</div>
          <div className="hitl-card-tags">
            {requiredFields.map((f) => (
              <span key={f} className="hitl-tag">{f}</span>
            ))}
          </div>
        </div>
      )}

      {!!missingFields.length && (
        <div className="hitl-card-section">
          <div className="hitl-card-label">缺失字段</div>
          <div className="hitl-card-tags">
            {missingFields.map((f) => (
              <span key={f} className="hitl-tag missing">{f}</span>
            ))}
          </div>
        </div>
      )}

      {isEntityReview && (
        <div className="hitl-card-section">
          <div className="hitl-card-label">可修改后提交</div>
          <div className="hitl-form-grid">
            <div className="hitl-field">
              <label className="hitl-field-label">完整地点（full_name）</label>
              <input
                className="hitl-input"
                placeholder="请输入完整地点"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            <div className="hitl-field">
              <label className="hitl-field-label">
                <span className="hitl-required-mark">*</span>
                省
              </label>
              <select
                className="hitl-input"
                value={provinceGb}
                onChange={(e) => {
                  const gb = e.target.value;
                  const hit = provinceOptions.find((p) => p.gb === gb);
                  setProvinceGb(gb);
                  setProvince(hit?.name || "");
                  setCityGb("");
                  setCity("");
                  setCountyGb("");
                  setCounty("");
                }}
                disabled={resourcesLoading}
              >
                <option value="">请选择省</option>
                {provinceOptions.map((p) => (
                  <option key={p.gb} value={p.gb}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="hitl-field">
              <label className="hitl-field-label">市（可选）</label>
              <select
                className="hitl-input"
                value={cityGb}
                onChange={(e) => {
                  const gb = e.target.value;
                  const hit = cityOptions.find((c) => c.gb === gb);
                  setCityGb(gb);
                  setCity(hit?.name || "");
                  setCountyGb("");
                  setCounty("");
                }}
                disabled={!provinceGb || resourcesLoading}
              >
                <option value="">{provinceGb ? "请选择市（可选）" : "请先选择省"}</option>
                {cityOptions.map((c) => (
                  <option key={c.gb} value={c.gb}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="hitl-field">
              <label className="hitl-field-label">县（可选）</label>
              <select
                className="hitl-input"
                value={countyGb}
                onChange={(e) => {
                  const gb = e.target.value;
                  const hit = countyOptions.find((c) => c.gb === gb);
                  setCountyGb(gb);
                  setCounty(hit?.name || "");
                }}
                disabled={!provinceGb || resourcesLoading}
              >
                <option value="">{provinceGb ? "请选择县（可选）" : "请先选择省"}</option>
                {countyOptions.map((c) => (
                  <option key={c.gb} value={c.gb}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="hitl-field">
              <label className="hitl-field-label">模型</label>
              <select
                className="hitl-input"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={resourcesLoading}
              >
                {!modelOptions.length && <option value="">暂无可用模型</option>}
                {modelOptions.map((m) => (
                  <option key={m.value} value={m.value}>{m.value}</option>
                ))}
              </select>
            </div>
            <div className="hitl-field">
              <label className="hitl-field-label">参数（逗号分隔）</label>
              <input
                className="hitl-input"
                placeholder="如 Cab, LAI, Cw"
                value={parametersText}
                onChange={(e) => setParametersText(e.target.value)}
              />
            </div>
            <div className="hitl-field">
              <label className="hitl-field-label">植被类型（可选）</label>
              <input
                className="hitl-input"
                placeholder="如 草原"
                value={vegetationType}
                onChange={(e) => setVegetationType(e.target.value)}
              />
            </div>
            <div className="hitl-field">
              <label className="hitl-field-label">实验时间范围（可选）</label>
              <input
                className="hitl-input"
                placeholder="如 2020-2021"
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {!!entitySummary && (
        <div className="hitl-card-section">
          <div className="hitl-card-label">当前抽取</div>
          <pre className="hitl-card-json">{entitySummary}</pre>
        </div>
      )}

      {!isEntityReview && !!geoContextSummary && (
        <div className="hitl-card-section">
          <div className="hitl-card-label">待审批内容</div>
          <pre className="hitl-card-json">{geoContextSummary}</pre>
        </div>
      )}

      <div className="hitl-card-section">
        <div className="hitl-card-label">审核意见</div>
        <textarea
          className="hitl-textarea"
          placeholder="可填写修改建议或审批意见"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          rows={3}
        />
      </div>

      <div className="hitl-card-actions">
        <button className="hitl-btn approve" onClick={onApprove}>通过并提交</button>
        <button className="hitl-btn reject" onClick={onReject}>驳回并提交</button>
        <button className="hitl-btn terminate" onClick={onTerminate}>结束本次推理</button>
      </div>
    </div>
  );
};

export default HITLInterruptCard;
