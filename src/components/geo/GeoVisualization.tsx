/**
 * 地理数据可视化组件
 *
 * 保持为简单的 React 单实例 Leaflet 方案：
 * - 浏览器直连天地图 WMTS
 * - 一个 Leaflet map 实例
 * - 一个行政区 GeoJSON 图层
 * - 一个案例点图层
 * - 区域点击和案例点击都直接在当前组件内完成
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { geoContains } from "d3-geo";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useDrawer } from "../../contexts/DrawerContext";
import { TIANDITU_API_KEY } from "../../lib/consts";
import { calculateMapBounds } from "../../lib/utils";
import { loadAllAdminGeoJson } from "../../services/resourceService";
import { getCaseFullDetails } from "../../services/threadService";
import "./GeoVisualization.css";

import type { GeoPoint as GeoPointType } from "../../lib/types";

export type GeoPoint = GeoPointType;

interface GeoVisualizationProps {
  geoPoints: GeoPoint[];
  geoDataId?: string;
}

type AdminLevel = "none" | "province" | "city" | "county";

interface AdminGeoData {
  province: any;
  city: any;
  county: any;
}

interface CsvCase {
  caseId: string;
  title: string;
  province: string;
  siteName: string;
  time: string;
  vegetation: string;
  lat: number | null;
  lng: number | null;
  lai: string;
  cab: string;
}

const CHINA_BOUNDS = L.latLngBounds(
  [3.5, 73.0],
  [54.5, 136.0],
);

const ADMIN_STYLE_MAP: Record<Exclude<AdminLevel, "none">, L.PathOptions> = {
  province: { color: "#3b82f6", weight: 1.5, opacity: 0.9, fillOpacity: 0.06, fillColor: "#3b82f6" },
  city: { color: "#8b5cf6", weight: 1, opacity: 0.8, fillOpacity: 0.04, fillColor: "#8b5cf6" },
  county: { color: "#64748b", weight: 0.6, opacity: 0.7, fillOpacity: 0.02, fillColor: "#64748b" },
};

const VECTOR_TILE_URL =
  `https://t{s}.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILECOL={x}&TILEROW={y}&TILEMATRIX={z}&tk=${TIANDITU_API_KEY}`;

const LABEL_TILE_URL =
  `https://t{s}.tianditu.gov.cn/cva_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cva&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILECOL={x}&TILEROW={y}&TILEMATRIX={z}&tk=${TIANDITU_API_KEY}`;

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "\"") {
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
  const lines = text.replace(/\r/g, "").split("\n").filter((line) => line.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const idx = (key: string) => headers.findIndex((header) => header.includes(key));

  const titleIdx = idx("论文标题");
  const provIdx = idx("省份");
  const siteIdx = idx("地名");
  const latIdx = idx("纬度");
  const lngIdx = idx("经度");
  const timeIdx = idx("实验时间");
  const vegIdx = idx("植被类型");
  const laiIdx = idx("叶面积指数");
  const cabIdx = idx("叶绿素");

  return lines.slice(1).map((line, rowIdx) => {
    const values = parseCsvLine(line);
    const latStr = latIdx >= 0 ? (values[latIdx] || "").trim() : "";
    const lngStr = lngIdx >= 0 ? (values[lngIdx] || "").trim() : "";

    return {
      caseId: `case_${rowIdx + 1}`,
      title: titleIdx >= 0 ? (values[titleIdx] || "").trim() : "",
      province: provIdx >= 0 ? (values[provIdx] || "").trim() : "",
      siteName: siteIdx >= 0 ? (values[siteIdx] || "").trim() : "",
      lat: latStr ? Number.parseFloat(latStr) : null,
      lng: lngStr ? Number.parseFloat(lngStr) : null,
      time: timeIdx >= 0 ? (values[timeIdx] || "").trim() : "",
      vegetation: vegIdx >= 0 ? (values[vegIdx] || "").trim() : "",
      lai: laiIdx >= 0 ? (values[laiIdx] || "").trim() : "",
      cab: cabIdx >= 0 ? (values[cabIdx] || "").trim() : "",
    };
  });
}

let csvCasesCache: CsvCase[] | null = null;
let csvCasesPromise: Promise<CsvCase[]> | null = null;

function loadCsvCases(): Promise<CsvCase[]> {
  if (csvCasesCache) return Promise.resolve(csvCasesCache);
  if (csvCasesPromise) return csvCasesPromise;

  csvCasesPromise = (async () => {
    const response = await fetch("/resources/repositories/PROSAIL/parameters.csv");
    if (!response.ok) {
      csvCasesCache = [];
      return [];
    }
    const parsed = parseCsvText(await response.text());
    csvCasesCache = parsed;
    return parsed;
  })().finally(() => {
    csvCasesPromise = null;
  });

  return csvCasesPromise;
}

function normalizeName(name: string): string {
  return (name || "")
    .replace(/省|市|自治区|壮族|回族|维吾尔族|维吾尔|藏族|苗族|侗族|仡佬族|土家族|布依族|彝族|特别行政区|地区|盟|林区/g, "")
    .trim();
}

function normalizeText(name: string): string {
  return (name || "").replace(/\s+/g, "").toLowerCase();
}

function getRegionName(feature: any): string {
  const props = feature?.properties || {};
  return String(props.name || props.NAME || props.省 || props.市 || props.县 || Object.values(props)[0] || "");
}

function matchCasesForRegion(feature: any, level: Exclude<AdminLevel, "none">, allCases: CsvCase[]): CsvCase[] {
  const regionName = getRegionName(feature);
  if (!regionName) return [];

  if (level === "province") {
    const normalizedRegionName = normalizeName(regionName);
    return allCases.filter((item) => normalizeName(item.province) === normalizedRegionName);
  }

  return allCases.filter((item) => {
    if (item.lat == null || item.lng == null || Number.isNaN(item.lat) || Number.isNaN(item.lng)) {
      return false;
    }
    try {
      return geoContains(feature as any, [item.lng, item.lat]);
    } catch {
      return false;
    }
  });
}

function getPointKey(point: GeoPoint): string {
  return `${point.kg_id || "prosail"}::${point.id}`;
}

function createPointIcon(point: GeoPoint): L.DivIcon {
  const isTarget = point.point_type === "target" || point.param_type === "target";
  const isHigh = !isTarget && (point.similarity ?? 0) >= 0.85;

  return L.divIcon({
    className: isTarget ? "target-marker" : `case-marker${isHigh ? " high" : ""}`,
    iconSize: isTarget ? [20, 20] : [14, 14],
    iconAnchor: isTarget ? [10, 10] : [7, 7],
  });
}

function buildPopupContent(point: GeoPoint, onOpenCaseDetail: (point: GeoPoint) => void): HTMLDivElement {
  const root = document.createElement("div");
  root.className = "geo-popup";

  const title = document.createElement("div");
  title.className = "geo-popup-title";
  title.textContent = `${point.point_type === "target" || point.param_type === "target" ? "📍 " : ""}${point.name}`;
  root.appendChild(title);

  const coords = document.createElement("div");
  coords.className = "geo-popup-coords";
  coords.textContent = `${point.lat.toFixed(4)}°, ${point.lng.toFixed(4)}°`;
  root.appendChild(coords);

  if (typeof point.similarity === "number" && point.point_type !== "target" && point.param_type !== "target") {
    const similarity = document.createElement("div");
    similarity.className = "geo-popup-similarity";
    similarity.textContent = `相似度 ${(point.similarity * 100).toFixed(0)}%`;
    root.appendChild(similarity);
  }

  if (point.point_type === "reference_case" || point.param_type === "reference_case") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "geo-popup-button";
    button.textContent = "查看案例详情";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onOpenCaseDetail(point);
    });
    root.appendChild(button);
  }

  return root;
}

interface SimpleLeafletMapProps {
  adminGeoData: AdminGeoData | null;
  adminLevel: AdminLevel;
  allCases: CsvCase[];
  focusedPointKey: string | null;
  geoPoints: GeoPoint[];
  onOpenCaseDetail: (point: GeoPoint) => void;
  onRegionClick: (name: string, level: Exclude<AdminLevel, "none">, cases: CsvCase[]) => void;
  onSelectPointKey: (pointKey: string) => void;
}

const SimpleLeafletMap: React.FC<SimpleLeafletMapProps> = ({
  adminGeoData,
  adminLevel,
  allCases,
  focusedPointKey,
  geoPoints,
  onOpenCaseDetail,
  onRegionClick,
  onSelectPointKey,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const adminLayerRef = useRef<L.GeoJSON | null>(null);
  const pointsLayerRef = useRef<L.LayerGroup | null>(null);
  const markerMapRef = useRef<Map<string, L.Marker>>(new Map());
  const previousDataSignatureRef = useRef("");
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const pointsDataSignature = useMemo(
    () => geoPoints.map((point) => `${getPointKey(point)}:${point.lat}:${point.lng}`).join("|"),
    [geoPoints],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host || mapRef.current) return;

    const map = L.map(host, {
      attributionControl: false,
      zoomControl: true,
      scrollWheelZoom: true,
      maxBounds: CHINA_BOUNDS,
      maxBoundsViscosity: 1.0,
      minZoom: 3,
      maxZoom: 12,
    });

    map.zoomControl.setPosition("topleft");
    map.setView([35.8617, 104.1954], 4);

    L.tileLayer(VECTOR_TILE_URL, {
      subdomains: ["0", "1", "2", "3", "4", "5", "6", "7"],
      maxZoom: 18,
    }).addTo(map);

    L.tileLayer(LABEL_TILE_URL, {
      subdomains: ["0", "1", "2", "3", "4", "5", "6", "7"],
      maxZoom: 18,
    }).addTo(map);

    const invalidate = () => {
      map.invalidateSize({ pan: false, debounceMoveend: true });
    };

    invalidate();
    const timer = window.setTimeout(invalidate, 120);

    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(() => {
        invalidate();
      });
      observer.observe(host);
      resizeObserverRef.current = observer;
    }

    mapRef.current = map;

    return () => {
      window.clearTimeout(timer);
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      markerMapRef.current.clear();
      pointsLayerRef.current?.remove();
      pointsLayerRef.current = null;
      adminLayerRef.current?.remove();
      adminLayerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || pointsDataSignature === previousDataSignatureRef.current) return;

    previousDataSignatureRef.current = pointsDataSignature;

    if (geoPoints.length === 0) {
      map.fitBounds(CHINA_BOUNDS, { padding: [18, 18], maxZoom: 6, animate: false });
      return;
    }

    const { centerLat, centerLng, zoom } = calculateMapBounds(geoPoints);
    map.setView([centerLat, centerLng], Math.max(zoom, 4), { animate: false });

    const latLngs = geoPoints.map((point) => [point.lat, point.lng] as L.LatLngTuple);
    const bounds = L.latLngBounds(latLngs);
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 10, animate: false });
    map.panInsideBounds(CHINA_BOUNDS, { animate: false });
  }, [geoPoints, pointsDataSignature]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    pointsLayerRef.current?.remove();
    markerMapRef.current.clear();

    const layerGroup = L.layerGroup();

    geoPoints.forEach((point) => {
      const pointKey = getPointKey(point);
      const isTarget = point.point_type === "target" || point.param_type === "target";
      const marker = L.marker([point.lat, point.lng], {
        icon: createPointIcon(point),
        zIndexOffset: isTarget ? 1000 : 0,
      });

      marker.bindPopup(buildPopupContent(point, onOpenCaseDetail), {
        autoPan: false,
        closeButton: true,
      });

      marker.on("click", () => {
        onSelectPointKey(pointKey);
        marker.openPopup();
      });

      marker.addTo(layerGroup);
      markerMapRef.current.set(pointKey, marker);
    });

    layerGroup.addTo(map);
    pointsLayerRef.current = layerGroup;

    return () => {
      layerGroup.remove();
      if (pointsLayerRef.current === layerGroup) {
        pointsLayerRef.current = null;
      }
      markerMapRef.current.clear();
    };
  }, [geoPoints, onOpenCaseDetail, onSelectPointKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    adminLayerRef.current?.remove();
    adminLayerRef.current = null;

    if (adminLevel === "none" || !adminGeoData) return;

    const geoJson = adminGeoData[adminLevel];
    const baseStyle = ADMIN_STYLE_MAP[adminLevel];

    const adminLayer = L.geoJSON(geoJson, {
      style: () => baseStyle,
      onEachFeature: (feature, layer) => {
        const pathLayer = layer as L.Path;
        pathLayer.on({
          mouseover: (event) => {
            (event.target as L.Path).setStyle({
              fillOpacity: Math.min((baseStyle.fillOpacity || 0) * 4 + 0.02, 0.24),
              weight: (baseStyle.weight || 1) + 1,
            });
          },
          mouseout: () => {
            adminLayer.resetStyle(pathLayer);
          },
          click: (event) => {
            const matchedCases = matchCasesForRegion(feature, adminLevel, allCases);
            const regionName = getRegionName(feature);
            L.popup({ autoPan: false })
              .setLatLng(event.latlng)
              .setContent(`<strong>${regionName}</strong><br><small style="color:#555">匹配案例: ${matchedCases.length} 条</small>`)
              .openOn(map);
            onRegionClick(regionName, adminLevel, matchedCases);
          },
        });
      },
    });

    adminLayer.addTo(map);
    adminLayerRef.current = adminLayer;

    return () => {
      adminLayer.remove();
      if (adminLayerRef.current === adminLayer) {
        adminLayerRef.current = null;
      }
    };
  }, [adminGeoData, adminLevel, allCases, onRegionClick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusedPointKey) return;

    markerMapRef.current.forEach((marker) => {
      const markerEl = marker.getElement();
      if (markerEl) {
        markerEl.classList.remove("focused");
      }
    });

    const marker = markerMapRef.current.get(focusedPointKey);
    if (!marker) return;

    const markerEl = marker.getElement();
    if (markerEl) {
      markerEl.classList.add("focused");
    }

    const latLng = marker.getLatLng();
    map.flyTo([latLng.lat, latLng.lng], Math.max(map.getZoom(), 8), {
      animate: true,
      duration: 0.6,
    });
    marker.openPopup();
  }, [focusedPointKey]);

  return <div ref={hostRef} className="geo-leaflet-host" />;
};

const GeoVisualizationBase: React.FC<GeoVisualizationProps> = ({ geoPoints }) => {
  const { openDrawer, isOpen, content } = useDrawer();
  const caseCacheRef = useRef<Map<string, GeoPoint>>(new Map());
  const validGeoPoints = useMemo(
    () => geoPoints.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng)),
    [geoPoints],
  );
  const [allCases, setAllCases] = useState<CsvCase[]>([]);
  const [adminGeoData, setAdminGeoData] = useState<AdminGeoData | null>(null);
  const [isAdminGeoLoading, setIsAdminGeoLoading] = useState(true);
  const [focusedPointKey, setFocusedPointKey] = useState<string | null>(null);
  const [adminLevel, setAdminLevel] = useState<AdminLevel>("none");

  useEffect(() => {
    const hasTarget = validGeoPoints.some((point) => point.point_type === "target" || point.param_type === "target");
    setAdminLevel(hasTarget ? "none" : "province");
    setFocusedPointKey(null);
  }, [validGeoPoints]);

  useEffect(() => {
    loadCsvCases()
      .then(setAllCases)
      .catch((error) => {
        console.warn("案例 CSV 加载失败:", error);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsAdminGeoLoading(true);

    void loadAllAdminGeoJson()
      .then((payload) => {
        if (!cancelled) {
          setAdminGeoData(payload);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("地图行政区划资源加载失败:", error);
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
  }, []);

  const fetchCaseDetails = useCallback(async (point: GeoPoint): Promise<GeoPoint | null> => {
    if (point.case_details && point.parameters) return point;

    const cacheKey = getPointKey(point);
    const cached = caseCacheRef.current.get(cacheKey);
    if (cached) return cached;

    try {
      const fullData = await getCaseFullDetails(point.id, point.kg_id);
      if (fullData) {
        const merged = { ...point, ...fullData };
        caseCacheRef.current.set(cacheKey, merged);
        return merged;
      }
    } catch (error) {
      console.error("获取案例详情失败:", error);
    }

    return null;
  }, []);

  const openCaseDetail = useCallback(async (point: GeoPoint) => {
    setFocusedPointKey(getPointKey(point));
    const full = await fetchCaseDetails(point);
    if (full?.case_details && full?.parameters) {
      openDrawer({ type: "case-detail", title: "案例详情", data: full });
    }
  }, [fetchCaseDetails, openDrawer]);

  const openRegionCases = useCallback((name: string, level: Exclude<AdminLevel, "none">, cases: CsvCase[]) => {
    openDrawer({
      type: "region-cases",
      title: `${name}的建模案例`,
      data: {
        name,
        level,
        cases,
        geoPoints: validGeoPoints,
      },
    });
  }, [openDrawer, validGeoPoints]);

  useEffect(() => {
    if (!isOpen || !content || content.type !== "case-detail") return;
    const selected = content.data as GeoPoint | undefined;
    if (!selected) return;

    const selectedTitle = normalizeText(selected.case_details?.paper_title || selected.name || "");
    const matched = validGeoPoints.find((point) => {
      if (point.id === selected.id && (point.kg_id || "prosail") === (selected.kg_id || "prosail")) {
        return true;
      }

      if (selected.lat != null && selected.lng != null) {
        const sameLatLng =
          Math.abs((point.lat ?? 0) - selected.lat) < 1e-4 &&
          Math.abs((point.lng ?? 0) - selected.lng) < 1e-4;
        if (sameLatLng) {
          return true;
        }
      }

      const pointTitle = normalizeText(point.case_details?.paper_title || point.name || "");
      return !!selectedTitle && !!pointTitle &&
        (pointTitle.includes(selectedTitle.slice(0, 14)) || selectedTitle.includes(pointTitle.slice(0, 14)));
    });

    if (matched) {
      setFocusedPointKey(getPointKey(matched));
    }
  }, [content, isOpen, validGeoPoints]);

  if (validGeoPoints.length === 0) {
    return null;
  }

  return (
    <div className="geo-visualization">
      <div className="geo-header">
        <div className="geo-title">
          <span className="geo-icon">🗺️</span>
          <h4>地理坐标分布（{validGeoPoints.length} 个点）</h4>
        </div>
      </div>

      <div className="geo-map-container">
        <div className="geo-admin-switch" role="group" aria-label="行政区划层级">
          <button
            type="button"
            className={`geo-admin-button${adminLevel === "none" ? " active geo-admin-button-muted" : ""}`}
            onClick={() => setAdminLevel("none")}
          >
            无边界
          </button>
          <button
            type="button"
            className={`geo-admin-button${adminLevel === "province" ? " active" : ""}`}
            onClick={() => setAdminLevel("province")}
          >
            省级
          </button>
          <button
            type="button"
            className={`geo-admin-button${adminLevel === "city" ? " active" : ""}`}
            onClick={() => setAdminLevel("city")}
          >
            市级
          </button>
          <button
            type="button"
            className={`geo-admin-button${adminLevel === "county" ? " active" : ""}`}
            onClick={() => setAdminLevel("county")}
          >
            县级
          </button>
        </div>

        <div className="geo-leaflet-map">
          <SimpleLeafletMap
            adminGeoData={adminGeoData}
            adminLevel={adminLevel}
            allCases={allCases}
            focusedPointKey={focusedPointKey}
            geoPoints={validGeoPoints}
            onOpenCaseDetail={(point) => {
              void openCaseDetail(point);
            }}
            onRegionClick={openRegionCases}
            onSelectPointKey={setFocusedPointKey}
          />
        </div>

        {isAdminGeoLoading ? (
          <div className="map-loading-state map-loading-inline">地图边界数据加载中...</div>
        ) : null}
      </div>
    </div>
  );
};

export const GeoVisualization = memo(
  GeoVisualizationBase,
  (prevProps, nextProps) =>
    prevProps.geoPoints === nextProps.geoPoints &&
    prevProps.geoDataId === nextProps.geoDataId,
);

export default GeoVisualization;
