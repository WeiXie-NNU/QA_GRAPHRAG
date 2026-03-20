import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./IndexPage.css";
import { TIANDITU_API_KEY } from "../lib/consts";
import { loadAdminGeoJson } from "../services/resourceService";
import { createNewThreadId } from "../services/threadService";
import { useAuth } from "../contexts";
import { DEFAULT_LOGIN_SUGGESTIONS } from "../services/authService";

type AdminLevel = "province" | "city" | "county";

interface CsvCase {
  title: string;
  province: string;
  place: string;
  lat: number | null;
  lng: number | null;
}

interface RegionCount {
  name: string;
  count: number;
}

const coreModules = [
  {
    id: "workbench",
    title: "案例抽取工具台",
    summary: "基于案例 CSV、行政区 GeoJSON、地图点位与右侧详情抽屉，形成可直接演示的案例抽取工作台。",
    points: ["区域点选抽取", "案例参数回看", "论文 PDF 溯源"],
  },
  {
    id: "kg",
    title: "双知识仓 GraphRAG",
    summary: "当前代码已支持 PROSAIL 与 LUE 两类知识仓，能够按问题自动识别模型并调用 local/global 检索。",
    points: ["PROSAIL / LUE", "Local / Global Search", "结果按需回看"],
  },
  {
    id: "reasoning",
    title: "参数迁移推理工作流",
    summary: "LangGraph 将实体抽取、人工审核、地理补全、证据综合和质量检查串成可解释流程。",
    points: ["实体抽取 + HITL", "地理上下文补全", "参数建议质检"],
  },
  {
    id: "visual",
    title: "联动展示与会话管理",
    summary: "多用户登录、线程隔离、图谱浏览、地图聚焦与右侧详情面板已在当前版本形成一体化展示界面。",
    points: ["线程历史恢复", "地图/图谱联动", "案例详情抽屉"],
  },
];

const demoFlow = [
  "登录并创建独立线程",
  "输入区域 + 模型 + 参数问题",
  "人工审核抽取结果并补全上下文",
  "联动 GraphRAG 与案例抽取工具台",
  "回看参数范围、地图位置与 PDF 证据",
];

const featuredScenarios = [
  "苏州地区农作物 PROSAIL 参数迁移：推荐 Cab、LAI、Cw 区间，并说明证据来源。",
  "亚热带红树林场景参数迁移：结合相似案例与空间分布，分析 LAI、ALA 的可迁移范围。",
  "温带落叶林参数配置：对 Cab、Car、Cm、N 进行分项推荐，并回看本体关系与论文来源。",
  "干旱区稀疏植被反演：评估 hotspot、rsoil0 等参数的迁移适用性与证据充分性。",
  "LUE 知识仓应用：围绕 LUE_max、FPAR、PAR 等参数进行模型切换后的迁移推理。",
  "全国案例库预览：按省市县查看 PROSAIL 建模案例分布，并定位高价值区域案例。",
];

const stack = [
  "React + TypeScript",
  "Vite + React Router + React Query",
  "CopilotKit Runtime + Express",
  "FastAPI + LangGraph + OpenAI",
  "SQLite 线程/GraphRAG 存储",
  "Leaflet + 天地图 + 行政区 GeoJSON",
  "Force Graph + Three.js",
  "PROSAIL / LUE Repository Registry",
];

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }

  fields.push(field);
  return fields;
}

function parseCsvText(text: string): CsvCase[] {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const idx = (key: string) => headers.findIndex((h) => h.includes(key));

  const titleIdx = idx("论文标题");
  const provIdx = idx("省份");
  const placeIdx = idx("地名");
  const latIdx = idx("纬度");
  const lngIdx = idx("经度");

  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const latStr = latIdx >= 0 ? (cols[latIdx] || "").trim() : "";
    const lngStr = lngIdx >= 0 ? (cols[lngIdx] || "").trim() : "";

    return {
      title: titleIdx >= 0 ? (cols[titleIdx] || "").trim() : "",
      province: provIdx >= 0 ? (cols[provIdx] || "").trim() : "",
      place: placeIdx >= 0 ? (cols[placeIdx] || "").trim() : "",
      lat: latStr ? Number.parseFloat(latStr) : null,
      lng: lngStr ? Number.parseFloat(lngStr) : null,
    };
  });
}

function normalizeName(name: string): string {
  return name
    .replace(/省|市|自治区|壮族|回族|维吾尔自治区|维吾尔|特别行政区|地区|盟|自治州|自治县|县|区/g, "")
    .trim();
}

function isPointInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersect = (yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function isPointInGeometry(lat: number, lng: number, geometry: any): boolean {
  if (!geometry || !geometry.coordinates) return false;

  if (geometry.type === "Polygon") {
    return isPointInRing(lat, lng, geometry.coordinates[0]);
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon: number[][][]) => polygon.length > 0 && isPointInRing(lat, lng, polygon[0]));
  }

  return false;
}

function getFeatureName(feature: any): string {
  const props = feature?.properties || {};
  return props.name || props.NAME || props.省 || props.市 || props.县 || props.adcode_name || "未命名区域";
}

function countByLevel(cases: CsvCase[], level: AdminLevel, geoData: any | null): RegionCount[] {
  const features = geoData?.features || [];

  const validCases = cases.filter(
    (c) => c.lat != null && c.lng != null && Number.isFinite(c.lat) && Number.isFinite(c.lng)
  ) as Array<CsvCase & { lat: number; lng: number }>;

  if (level === "province") {
    const byName = new Map<string, number>();
    validCases.forEach((c) => {
      const key = normalizeName(c.province || c.place || "");
      if (!key) return;
      byName.set(key, (byName.get(key) || 0) + 1);
    });

    const rows: RegionCount[] = features.map((feature: any) => {
      const name = getFeatureName(feature);
      const key = normalizeName(name);
      return { name, count: byName.get(key) || 0 };
    });

    return rows.filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
  }

  const rows: RegionCount[] = features.map((feature: any) => {
    const name = getFeatureName(feature);
    const count = validCases.reduce((acc, c) => (isPointInGeometry(c.lat, c.lng, feature.geometry) ? acc + 1 : acc), 0);
    return { name, count };
  });

  return rows.filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
}

function buildSpatialMapHtml(cases: CsvCase[], level: AdminLevel, geoData: any | null): string {
  const points = cases
    .filter((c) => c.lat != null && c.lng != null && Number.isFinite(c.lat) && Number.isFinite(c.lng))
    .map((c) => ({
      title: c.title,
      province: c.province,
      place: c.place,
      lat: c.lat as number,
      lng: c.lng as number,
    }));

  if (!geoData) return "";
  const style =
    level === "province"
      ? { color: "#3b82f6", weight: 1.6, fillOpacity: 0.06 }
      : level === "city"
        ? { color: "#8b5cf6", weight: 1.0, fillOpacity: 0.04 }
        : { color: "#64748b", weight: 0.7, fillOpacity: 0.03 };

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <style>
      html, body, #map { margin: 0; width: 100%; height: 100%; }
      .case-dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: #ef4444;
        border: 2px solid #fff;
        box-shadow: 0 2px 6px rgba(239, 68, 68, 0.55);
      }
      .leaflet-popup-content { margin: 10px 12px; font-family: Arial, sans-serif; }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script>
      const chinaBounds = L.latLngBounds([
        [3.5, 73.0],
        [54.5, 136.0]
      ]);

      const map = L.map('map', {
        attributionControl: false,
        maxBounds: chinaBounds,
        maxBoundsViscosity: 1.0,
        minZoom: 3,
        maxZoom: 12,
      }).setView([35.8, 104.1], 3.6);

      L.tileLayer('https://t{s}.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILECOL={x}&TILEROW={y}&TILEMATRIX={z}&tk=${TIANDITU_API_KEY}', {
        subdomains: ['0','1','2','3','4','5','6','7'],
        maxZoom: 18
      }).addTo(map);

      L.tileLayer('https://t{s}.tianditu.gov.cn/cva_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cva&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILECOL={x}&TILEROW={y}&TILEMATRIX={z}&tk=${TIANDITU_API_KEY}', {
        subdomains: ['0','1','2','3','4','5','6','7'],
        maxZoom: 18
      }).addTo(map);

      const geoLayer = L.geoJSON(${JSON.stringify(geoData)}, {
        style: {
          color: '${style.color}',
          weight: ${style.weight},
          fillOpacity: ${style.fillOpacity}
        }
      }).addTo(map);

      const points = ${JSON.stringify(points)};
      const bounds = [];

      points.forEach(function(p) {
        const marker = L.marker([p.lat, p.lng], {
          icon: L.divIcon({ className: 'case-dot', iconSize: [10,10], iconAnchor: [5,5] })
        }).addTo(map);

        marker.bindPopup(
          '<strong>' + (p.place || '案例点') + '</strong><br/>' +
          '<small>' + (p.province || '') + '</small><br/>' +
          '<small>' + (p.title || '') + '</small>'
        );

        bounds.push([p.lat, p.lng]);
      });

      // 默认先完整显示中国范围，保证全国边界可见
      map.fitBounds(chinaBounds, { padding: [18, 18], maxZoom: 6 });

      map.panInsideBounds(chinaBounds, { animate: false });
    </script>
  </body>
  </html>
  `;
}

export const IndexPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser, users, login } = useAuth();
  const spatialSectionRef = useRef<HTMLElement | null>(null);
  const [csvCases, setCsvCases] = useState<CsvCase[]>([]);
  const [adminLevel, setAdminLevel] = useState<AdminLevel>("province");
  const [adminGeoData, setAdminGeoData] = useState<any | null>(null);
  const [isAdminGeoLoading, setIsAdminGeoLoading] = useState(true);
  const [shouldLoadSpatial, setShouldLoadSpatial] = useState(false);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [loginName, setLoginName] = useState("");
  const [loginError, setLoginError] = useState("");

  const handleEnterSystem = () => {
    if (!currentUser) {
      setIsLoginOpen(true);
      setLoginError("请先登录后再进入系统");
      return;
    }
    const newThreadId = createNewThreadId();
    navigate(`/chat/${newThreadId}`, { state: { isNewThread: true } });
  };

  const handleJumpToGithub = () => {
    window.open("https://github.com/WeiXie-NNU/graph-rag-agent", "_blank");
  };

  const loginSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const names = [...users.map((user) => user.name), ...DEFAULT_LOGIN_SUGGESTIONS];
    return names.filter((item) => {
      const key = item.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [users]);

  const handleLogin = (value: string) => {
    const nextName = value.trim();
    if (!nextName) {
      setLoginError("请输入用户名");
      return;
    }

    try {
      login(nextName);
      setLoginName("");
      setLoginError("");
      setIsLoginOpen(false);
      navigate("/", { replace: true });
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "登录失败");
    }
  };

  useEffect(() => {
    const state = location.state as { showLogin?: boolean } | null;
    if (state?.showLogin) {
      setIsLoginOpen(true);
      setLoginError((prev) => prev || "请先登录后再进入对话页面");
      navigate(location.pathname, { replace: true });
    }
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    if (shouldLoadSpatial) return;
    const target = spatialSectionRef.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      setShouldLoadSpatial(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoadSpatial(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px 0px" },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [shouldLoadSpatial]);

  useEffect(() => {
    if (!shouldLoadSpatial) return;
    const candidates = ["/resources/repositories/PROSAIL/parameters.csv"];
    (async () => {
      for (const path of candidates) {
        try {
          const res = await fetch(path);
          if (!res.ok) continue;
          const text = await res.text();
          setCsvCases(parseCsvText(text));
          return;
        } catch {
          // try next path
        }
      }
      setCsvCases([]);
    })();
  }, [shouldLoadSpatial]);

  useEffect(() => {
    if (!shouldLoadSpatial) return;
    let cancelled = false;
    setIsAdminGeoLoading(true);
    void loadAdminGeoJson(adminLevel)
      .then((payload) => {
        if (!cancelled) {
          setAdminGeoData(payload);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("行政区划资源加载失败:", error);
          setAdminGeoData(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsAdminGeoLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [adminLevel, shouldLoadSpatial]);

  const regionRows = useMemo(
    () => countByLevel(csvCases, adminLevel, adminGeoData),
    [adminGeoData, adminLevel, csvCases],
  );

  const validCaseCount = useMemo(
    () => csvCases.filter((c) => c.lat != null && c.lng != null && Number.isFinite(c.lat) && Number.isFinite(c.lng)).length,
    [csvCases]
  );

  const totalRows = regionRows.length;

  const spatialMapHtml = useMemo(
    () => buildSpatialMapHtml(csvCases, adminLevel, adminGeoData),
    [adminGeoData, adminLevel, csvCases],
  );

  return (
    <div className="index-page">
      <header className="index-header">
        <div className="header-content">
          <a className="logo" href="#intro">GraphRAG Agent</a>
          <nav className="nav-links">
            <a href="#overview">系统功能</a>
            <a href="#demo">亮点功能</a>
            <a href="#spatial">空间案例</a>
            <a href="#cases">案例问题</a>
            <a href="#stack">技术架构</a>
          </nav>
          <div className="header-actions">
            <button
              type="button"
              className={`login-trigger ${currentUser ? "logged-in" : ""}`}
              onClick={() => {
                setLoginError("");
                setIsLoginOpen(true);
              }}
            >
              {currentUser ? `已登录 · ${currentUser.name}` : "用户登录"}
            </button>
            <button className="enter-btn" onClick={handleEnterSystem}>
              进入系统
            </button>
          </div>
        </div>
      </header>

      <main>
        <section id="intro" className="hero-section">
          <div className="hero-content">
            <p className="hero-kicker">REMOTE SENSING PARAMETER TRANSFER</p>
            <h1 className="hero-title">遥感模型参数迁移推理与案例抽取平台</h1>
            <p className="hero-description">
              当前版本系统已形成“多用户线程问答 + LangGraph 推理编排 + GraphRAG 双检索 +
              案例抽取工具台 + 地图/图谱联动”的完整链路，重点服务于 PROSAIL、LUE
              等遥感模型的参数迁移推理、案例回看和证据复核。
            </p>
            <div className="runtime-pill-row">
              <span>Frontend :5173</span>
              <span>Runtime :4000</span>
              <span>Agent :8090</span>
            </div>
            <div className="hero-actions">
              <button className="btn-primary" onClick={handleEnterSystem}>
                立即演示
              </button>
              <button className="btn-secondary" onClick={handleJumpToGithub}>
                查看源码
              </button>
            </div>
            <div className="hero-metrics">
              <article>
                <h3>案例抽取工具台</h3>
                <p>按区域抽取案例、回看参数表并追溯论文 PDF</p>
              </article>
              <article>
                <h3>双知识仓推理</h3>
                <p>当前版本支持 PROSAIL 与 LUE 知识仓切换与识别</p>
              </article>
              <article>
                <h3>线程化审核</h3>
                <p>支持多轮追问、人工审核和历史状态恢复</p>
              </article>
            </div>
          </div>
        </section>

        <section id="overview" className="content-section overview-section">
          <div className="section-head">
            <p>系统功能</p>
            <h2>当前版本面向参数迁移推理的四个核心能力</h2>
          </div>
          <div className="module-grid">
            {coreModules.map((module) => (
              <article className="module-card" key={module.id}>
                <h3>{module.title}</h3>
                <p>{module.summary}</p>
                <ul>
                  {module.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section id="demo" className="content-section workflow-section">
          <div className="section-head">
            <p>亮点功能</p>
            <h2>案例抽取工具台是当前版本最适合演示的亮点能力</h2>
          </div>
          <div className="demo-panel">
            <div className="demo-chat-box">
              <h3>工具台如何工作</h3>
              <p className="chat-line user">用户: 请推荐苏州稻田 PROSAIL 的 Cab、LAI 参数区间，并说明迁移依据。</p>
              <p className="chat-line assistant">系统: 自动识别地点、模型和参数，必要时进入 HITL 审核面板补全信息。</p>
              <p className="chat-line assistant">系统: 执行 Local / Global GraphRAG 检索，并在案例抽取工具台中匹配区域案例。</p>
              <p className="chat-line assistant">系统: 可继续查看案例参数范围、地图位置、相似区域和论文 PDF，支撑迁移推理结论。</p>
            </div>
            <div className="demo-checklist">
              <h3>为什么它能支持迁移推理</h3>
              <ul>
                <li>先把“区域、模型、参数”拆出来，减少问题表达不规范带来的误判</li>
                <li>自动选用 PROSAIL 或 LUE 知识仓，把参数推荐建立在对应模型语义上</li>
                <li>用区域案例抽取和空间邻近案例为参数迁移提供参照而不是仅靠大模型直答</li>
                <li>最终可回看 GraphRAG 结果、案例详情、参数表与 PDF 证据，方便专家复核</li>
              </ul>
            </div>
          </div>
          <div className="workflow-track">
            {demoFlow.map((step, index) => (
              <div className="workflow-step" key={step}>
                <div className="step-index">{String(index + 1).padStart(2, "0")}</div>
                <p>{step}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="spatial" className="content-section spatial-section" ref={spatialSectionRef}>
          <div className="section-head">
            <p>空间案例</p>
            <h2>首页当前展示的是 PROSAIL 案例库的全国分布与区域统计预览</h2>
          </div>

          <div className="spatial-summary-row">
            <div className="summary-pill">CSV 总案例: {csvCases.length}</div>
            <div className="summary-pill">含坐标案例: {validCaseCount}</div>
            <div className="summary-pill">当前分层统计项: {totalRows}</div>
          </div>

          <div className="spatial-level-switch">
            <button
              className={adminLevel === "province" ? "active" : ""}
              onClick={() => setAdminLevel("province")}
            >
              省级
            </button>
            <button
              className={adminLevel === "city" ? "active" : ""}
              onClick={() => setAdminLevel("city")}
            >
              市级
            </button>
            <button
              className={adminLevel === "county" ? "active" : ""}
              onClick={() => setAdminLevel("county")}
            >
              县级
            </button>
          </div>

          <div className="spatial-grid">
            <article className="spatial-card map-preview-card">
              <h3>案例位置点分布地图</h3>
              <p>基于 `resources/repositories/PROSAIL/parameters.csv` 与省市县 GeoJSON 生成，可用于展示案例库覆盖范围与区域热点。</p>
              <div className="spatial-map-wrap">
                {!shouldLoadSpatial || isAdminGeoLoading || !spatialMapHtml ? (
                  <div className="empty-cell">地图边界数据加载中...</div>
                ) : (
                  <iframe title="案例空间分布地图" srcDoc={spatialMapHtml} className="spatial-map-iframe" />
                )}
              </div>
            </article>

            <article className="spatial-card spatial-feature-card">
              <h3>{adminLevel === "province" ? "省级" : adminLevel === "city" ? "市级" : "县级"}案例数量统计</h3>
              <p>统计维度自动跟随分层切换，可快速识别案例集中区域，为参数迁移筛选相似研究区。</p>
              <div className="spatial-table-wrap">
                <table className="spatial-table">
                  <thead>
                    <tr>
                      <th>区域名称</th>
                      <th>案例个数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regionRows.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="empty-cell">暂无可统计数据</td>
                      </tr>
                    ) : (
                      regionRows.map((row) => (
                        <tr key={row.name}>
                          <td>{row.name}</td>
                          <td>{row.count}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        </section>

        <section id="cases" className="content-section case-section">
          <div className="section-head">
            <p>案例问题</p>
            <h2>当前代码可直接支撑的典型问题与案例方向</h2>
          </div>
          <div className="case-grid">
            {featuredScenarios.map((item) => (
              <article key={item} className="case-card">
                <p>{item}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="stack" className="content-section stack-section">
          <div className="section-head">
            <p>技术架构</p>
            <h2>当前版本采用前端、Runtime、Agent 与资源仓分层协同</h2>
          </div>
          <div className="stack-list">
            {stack.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <div className="final-cta">
            <h3>系统现状总结</h3>
            <p>当前版本已经具备案例抽取、参数迁移推理、GraphRAG 结果回看、空间分布预览、知识图谱浏览和多用户线程管理能力，适合直接用于遥感模型问答与汇报演示。</p>
            <div className="hero-actions">
              <button className="btn-primary" onClick={handleEnterSystem}>
                进入系统
              </button>
              <button className="btn-secondary" onClick={handleJumpToGithub}>
                查看源码
              </button>
            </div>
          </div>
        </section>
      </main>

      {isLoginOpen && (
        <div className="index-login-overlay" onClick={() => setIsLoginOpen(false)}>
          <div className="index-login-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="index-login-copy">
              <p className="index-login-eyebrow">USER ACCESS</p>
              <h2>登录后进入对话系统</h2>
              <p>输入用户名即可登录，同一用户名会自动匹配自己的历史记录。</p>
            </div>

            <div className="index-login-form">
              <label htmlFor="index-login-name">用户名</label>
              <input
                id="index-login-name"
                value={loginName}
                onChange={(event) => {
                  setLoginName(event.target.value);
                  if (loginError) setLoginError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    handleLogin(loginName);
                  }
                }}
                placeholder="例如：Demo / Researcher / Alice"
                autoFocus
              />
              {loginError ? <p className="index-login-error">{loginError}</p> : null}
              <div className="index-login-actions">
                <button
                  type="button"
                  className="index-login-cancel"
                  onClick={() => setIsLoginOpen(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="index-login-submit"
                  onClick={() => handleLogin(loginName)}
                >
                  登录
                </button>
              </div>
            </div>

            <div className="index-login-section">
              <p>快捷登录</p>
              <div className="index-login-chip-list">
                {loginSuggestions.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="index-login-chip"
                    onClick={() => handleLogin(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            {users.length > 0 && (
              <div className="index-login-section">
                <p>最近账号</p>
                <div className="index-login-user-list">
                  {users.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      className="index-login-user"
                      onClick={() => handleLogin(user.name)}
                    >
                      <span
                        className="index-login-user-avatar"
                        style={{ backgroundColor: user.avatarColor }}
                      >
                        {user.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="index-login-user-meta">
                        <strong>{user.name}</strong>
                        <small>{user.id}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
