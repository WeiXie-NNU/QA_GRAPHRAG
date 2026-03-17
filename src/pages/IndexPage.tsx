import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./IndexPage.css";
import { CHAT_SUGGESTIONS, CHAT_TITLE, TIANDITU_API_KEY } from "../lib/consts";
import { loadAdminGeoJson } from "../services/resourceService";
import { createNewThreadId } from "../services/threadService";

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
    id: "retrieval",
    title: "混合检索层",
    summary: "向量召回与知识图谱关系检索并行执行，提升复杂问题命中率。",
    points: ["向量召回", "实体对齐", "证据聚合"],
  },
  {
    id: "reasoning",
    title: "Agent 推理编排",
    summary: "使用 LangGraph 工作流拆解任务，按步骤执行、追踪、回溯。",
    points: ["步骤编排", "状态管理", "可解释链路"],
  },
  {
    id: "visual",
    title: "可视化展示层",
    summary: "将答案、关系网络和地理线索放到同一界面，便于演示与复核。",
    points: ["图谱视图", "地图联动", "证据面板"],
  },
  {
    id: "spatial",
    title: "案例空间分布",
    summary: "聚合历史案例的地理点位与相似区域，支持按分层查看统计。",
    points: ["省市县分层", "位置点分布", "案例数量统计"],
  },
];

const demoFlow = [
  "输入问题并创建线程",
  "查看 Agent 步骤进度",
  "打开图谱关系视图",
  "联动地图查看空间证据",
  "导出结果用于汇报",
];

const stack = [
  "React + TypeScript",
  "Vite + CopilotKit",
  "Node Runtime + Express",
  "FastAPI + LangGraph",
  "Neo4j + SQLite",
  "Three.js + Force Graph",
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
  const spatialSectionRef = useRef<HTMLElement | null>(null);
  const [csvCases, setCsvCases] = useState<CsvCase[]>([]);
  const [adminLevel, setAdminLevel] = useState<AdminLevel>("province");
  const [adminGeoData, setAdminGeoData] = useState<any | null>(null);
  const [isAdminGeoLoading, setIsAdminGeoLoading] = useState(true);
  const [shouldLoadSpatial, setShouldLoadSpatial] = useState(false);

  const handleEnterSystem = () => {
    const newThreadId = createNewThreadId();
    navigate(`/chat/${newThreadId}`);
  };

  const handleJumpToGithub = () => {
    window.open("https://github.com/WeiXie-NNU/graph-rag-agent", "_blank");
  };

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
            <a href="#overview">产品能力</a>
            <a href="#demo">演示流程</a>
            <a href="#spatial">空间分布</a>
            <a href="#cases">演示问题</a>
            <a href="#stack">技术栈</a>
          </nav>
          <button className="enter-btn" onClick={handleEnterSystem}>
            进入系统
          </button>
        </div>
      </header>

      <main>
        <section id="intro" className="hero-section">
          <div className="hero-content">
            <p className="hero-kicker">PRODUCT DEMO READY</p>
            <h1 className="hero-title">GraphRAG 智能问答与推理演示平台</h1>
            <p className="hero-description">
              {CHAT_TITLE} 面向产品演示场景，支持从问题输入到证据复核的全流程展示。
              你可以在一个页面中演示问答、推理步骤、知识图谱和地图线索。
            </p>
            <div className="runtime-pill-row">
              <span>Frontend :3000</span>
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
                <h3>演示友好</h3>
                <p>单入口展示问答与推理全过程</p>
              </article>
              <article>
                <h3>可解释输出</h3>
                <p>结论 + 证据 + 关系链路同步可见</p>
              </article>
              <article>
                <h3>线程化会话</h3>
                <p>支持多轮追问与历史状态恢复</p>
              </article>
            </div>
          </div>
        </section>

        <section id="overview" className="content-section overview-section">
          <div className="section-head">
            <p>产品能力</p>
            <h2>增强参数推理的四层能力</h2>
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
            <p>演示流程</p>
            <h2>一条标准 Demo 路径</h2>
          </div>
          <div className="demo-panel">
            <div className="demo-chat-box">
              <h3>演示脚本片段</h3>
              <p className="chat-line user">用户: 请推荐苏州农作物 Cab 与 LAI 参数区间。</p>
              <p className="chat-line assistant">Agent: 已检索 12 条文献证据，正在进行多步骤参数推理...</p>
              <p className="chat-line assistant">Agent: 已生成参数建议并关联相似区域案例，点击右侧查看图谱与地图。</p>
            </div>
            <div className="demo-checklist">
              <h3>演示观察点</h3>
              <ul>
                <li>步骤进度是否实时更新</li>
                <li>结论是否携带证据来源</li>
                <li>图谱关系与地理分布是否一致</li>
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
            <p>空间分布</p>
            <h2>案例点位地图与省市县分层统计</h2>
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
              <p>使用项目中的省/市/县 GeoJSON 边界，叠加模型案例库参数点位。</p>
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
              <p>统计维度自动跟随当前地图分层切换。</p>
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
            <p>演示问题</p>
            <h2>可直接用于现场演示的话题</h2>
          </div>
          <div className="case-grid">
            {CHAT_SUGGESTIONS.test.slice(0, 4).map((item) => (
              <article key={item} className="case-card">
                <p>{item}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="stack" className="content-section stack-section">
          <div className="section-head">
            <p>技术栈</p>
            <h2>前后端协同，支持局域网演示部署</h2>
          </div>
          <div className="stack-list">
            {stack.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
          <div className="final-cta">
            <h3>现在开始你的产品演示</h3>
            <p>从首页进入系统即可创建新线程，快速完成一次端到端演示。</p>
            <div className="hero-actions">
              <button className="btn-primary" onClick={handleEnterSystem}>
                进入演示
              </button>
              <button className="btn-secondary" onClick={handleJumpToGithub}>
                阅读源码
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};
