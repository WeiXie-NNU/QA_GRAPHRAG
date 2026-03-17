/**
 * 地理数据可视化组件
 * 
 * 展示地理坐标点在地图上的分布
 * 支持省/市/县三级行政区划图层切换
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useDrawer } from "../../contexts";
import { calculateMapBounds } from "../../lib/utils";
import { TIANDITU_API_KEY } from "../../lib/consts";
import { loadAllAdminGeoJson } from "../../services/resourceService";
import { getCaseFullDetails } from "../../services/threadService";
import "./GeoVisualization.css";

// ============================================================
// 类型定义
// ============================================================

import type { GeoPoint as GeoPointType } from "../../lib/types";
export type GeoPoint = GeoPointType;

interface GeoVisualizationProps {
  geoPoints: GeoPoint[];
}

// ============================================================
// 行政区划数据类型
// ============================================================

interface AdminGeoData {
  province: object;
  city: object;
  county: object;
}

// ============================================================
// CSV 案例数据类型 & 解析工具
// ============================================================

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

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { fields.push(field); field = ''; }
    else { field += ch; }
  }
  fields.push(field);
  return fields;
}

function parseCsvText(text: string): CsvCase[] {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const idx = (key: string) => headers.findIndex(h => h.includes(key));
  const titleIdx = idx('论文标题');
  const provIdx  = idx('省份');
  const siteIdx  = idx('地名');
  const latIdx   = idx('纬度');
  const lngIdx   = idx('经度');
  const timeIdx  = idx('实验时间');
  const vegIdx   = idx('植被类型');
  const laiIdx   = idx('叶面积指数');
  const cabIdx   = idx('叶绿素');
  return lines.slice(1).map((line, rowIdx) => {
    const v = parseCsvLine(line);
    const latStr = latIdx >= 0 ? (v[latIdx] || '').trim() : '';
    const lngStr = lngIdx >= 0 ? (v[lngIdx] || '').trim() : '';
    return {
      caseId:     `case_${rowIdx + 1}`,
      title:      titleIdx >= 0 ? (v[titleIdx] || '').trim() : '',
      province:   provIdx  >= 0 ? (v[provIdx]  || '').trim() : '',
      siteName:   siteIdx  >= 0 ? (v[siteIdx]  || '').trim() : '',
      lat:        latStr ? parseFloat(latStr) : null,
      lng:        lngStr ? parseFloat(lngStr) : null,
      time:       timeIdx >= 0 ? (v[timeIdx]  || '').trim() : '',
      vegetation: vegIdx  >= 0 ? (v[vegIdx]   || '').trim() : '',
      lai:        laiIdx  >= 0 ? (v[laiIdx]   || '').trim() : '',
      cab:        cabIdx  >= 0 ? (v[cabIdx]   || '').trim() : '',
    };
  });
}

let csvCasesCache: CsvCase[] | null = null;
let csvCasesPromise: Promise<CsvCase[]> | null = null;

function loadCsvCases(): Promise<CsvCase[]> {
  if (csvCasesCache) return Promise.resolve(csvCasesCache);
  if (csvCasesPromise) return csvCasesPromise;
  const candidates = ['/resources/repositories/PROSAIL/parameters.csv'];

  csvCasesPromise = (async () => {
    for (const path of candidates) {
      try {
        const r = await fetch(path);
        if (!r.ok) continue;
        const text = await r.text();
        const parsed = parseCsvText(text);
        csvCasesCache = parsed;
        return parsed;
      } catch {
        // try next path
      }
    }
    csvCasesCache = [];
    return [];
  })();
  return csvCasesPromise;
}

// ============================================================
// 生成 Leaflet 地图 HTML（行政区划图层切换）
// ============================================================

function generateMapHtml(
  geoPoints: GeoPoint[],
  centerLat: number,
  centerLng: number,
  zoom: number,
  adminGeoData: AdminGeoData,
  defaultAdminLevel: 'none' | 'province' | 'city' | 'county' = 'none'
): string {
  const adminDataJson = JSON.stringify({
    province: adminGeoData.province,
    city: adminGeoData.city,
    county: adminGeoData.county,
  });

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <style>
        html, body {
          margin: 0;
          padding: 0;
          width: 100%;
          height: 100%;
          position: relative;
        }
        #map { width: 100%; height: 100%; }

        /* ---- 行政区划图层切换控件 ---- */
        .admin-control {
          position: absolute;
          top: 12px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 1000;
          display: flex;
          gap: 0;
          background: rgba(255,255,255,0.95);
          border-radius: 20px;
          padding: 4px;
          box-shadow: 0 2px 12px rgba(0,0,0,0.18);
          backdrop-filter: blur(6px);
        }
        .admin-btn {
          padding: 5px 16px;
          border: none;
          background: transparent;
          color: #555;
          border-radius: 16px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
          font-family: system-ui, 'Microsoft YaHei', sans-serif;
        }
        .admin-btn:hover { background: #f0f4ff; color: #3b82f6; }
        .admin-btn.active {
          background: #3b82f6;
          color: #fff;
          box-shadow: 0 2px 6px rgba(59,130,246,0.4);
        }
        .admin-btn.none-btn.active {
          background: #6b7280;
          box-shadow: 0 2px 6px rgba(107,114,128,0.4);
        }
        
        /* 目标点样式 - 红色脉冲动画 */
        .target-marker {
          width: 20px; height: 20px;
          background: #ef4444;
          border: 3px solid #fff;
          border-radius: 50%;
          box-shadow: 0 0 0 rgba(239, 68, 68, 0.4);
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5); }
          70% { box-shadow: 0 0 0 12px rgba(239, 68, 68, 0); }
          100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
        }
        
        /* 案例点样式 - 普通状态 */
        .case-marker {
          width: 14px; height: 14px;
          background: #3b82f6;
          border: 2px solid #fff;
          border-radius: 50%;
          box-shadow: 0 2px 6px rgba(59, 130, 246, 0.4);
          cursor: pointer;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .case-marker:hover { transform: scale(1.4); }
        .case-marker.focused {
          background: #ef4444 !important;
          border-color: #fff;
          transform: scale(1.65);
          box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.26), 0 0 0 11px rgba(239, 68, 68, 0.12), 0 8px 20px rgba(239, 68, 68, 0.46);
          animation: caseFocusPulse 1s ease-in-out infinite;
        }
        @keyframes caseFocusPulse {
          0% { box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.26), 0 0 0 11px rgba(239, 68, 68, 0.12), 0 8px 20px rgba(239, 68, 68, 0.40); }
          50% { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0.35), 0 0 0 16px rgba(239, 68, 68, 0.20), 0 11px 26px rgba(239, 68, 68, 0.50); }
          100% { box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.26), 0 0 0 11px rgba(239, 68, 68, 0.12), 0 8px 20px rgba(239, 68, 68, 0.40); }
        }
        
        /* 高相似度案例 - 绿色 */
        .case-marker.high { background: #22c55e; box-shadow: 0 2px 6px rgba(34, 197, 94, 0.5); }
        
        /* 弹窗样式优化 */
        .leaflet-popup-content-wrapper { border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.15); }
        .leaflet-popup-content { margin: 14px 16px; font-family: system-ui, sans-serif; }
        .popup-title { font-weight: 700; font-size: 14px; margin-bottom: 6px; }
        .popup-coords { font-size: 11px; color: #666; margin-bottom: 10px; }
        .popup-sim { display: flex; align-items: center; gap: 10px; margin: 12px 0; }
        .popup-sim-bar { flex: 1; height: 6px; background: #e5e7eb; border-radius: 3px; overflow: hidden; }
        .popup-sim-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }
        .popup-btn { 
          width: 100%; margin-top: 12px; padding: 10px; 
          background: linear-gradient(135deg, #667eea, #764ba2); 
          color: #fff; border: none; border-radius: 8px; 
          font-weight: 600; font-size: 13px; cursor: pointer; 
        }
        .popup-btn:hover { filter: brightness(1.1); }
      </style>
    </head>
    <body>
      <!-- 行政区划层级切换控件 -->
      <div class="admin-control">
        <button class="admin-btn none-btn ${defaultAdminLevel === 'none' ? 'active' : ''}" id="btn-none" onclick="switchAdmin('none')">无边界</button>
        <button class="admin-btn ${defaultAdminLevel === 'province' ? 'active' : ''}" id="btn-province" onclick="switchAdmin('province')">省级</button>
        <button class="admin-btn ${defaultAdminLevel === 'city' ? 'active' : ''}" id="btn-city" onclick="switchAdmin('city')">市级</button>
        <button class="admin-btn ${defaultAdminLevel === 'county' ? 'active' : ''}" id="btn-county" onclick="switchAdmin('county')">县级</button>
      </div>
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
          maxZoom: 12
        }).setView([${centerLat}, ${centerLng}], ${zoom});
        
        // 天地图底图 + 注记
        L.tileLayer('https://t{s}.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILECOL={x}&TILEROW={y}&TILEMATRIX={z}&tk=${TIANDITU_API_KEY}', {
          subdomains: ['0','1','2','3','4','5','6','7'],
          maxZoom: 18
        }).addTo(map);
        L.tileLayer('https://t{s}.tianditu.gov.cn/cva_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cva&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILECOL={x}&TILEROW={y}&TILEMATRIX={z}&tk=${TIANDITU_API_KEY}', {
          subdomains: ['0','1','2','3','4','5','6','7'],
          maxZoom: 18
        }).addTo(map);

        // ---- 行政区划图层数据 ----
        const adminData = ${adminDataJson};

        // 行政区划图层样式
        const adminStyles = {
          province: { color: '#3b82f6', weight: 1.5, opacity: 0.9, fillOpacity: 0.06, fillColor: '#3b82f6' },
          city:     { color: '#8b5cf6', weight: 1,   opacity: 0.8, fillOpacity: 0.04, fillColor: '#8b5cf6' },
          county:   { color: '#64748b', weight: 0.6, opacity: 0.7, fillOpacity: 0.02, fillColor: '#64748b' },
        };

        let currentAdminLayer = null;
        let currentAdminLevel = 'none';

        function switchAdmin(level) {
          // 移除旧图层
          if (currentAdminLayer) { map.removeLayer(currentAdminLayer); currentAdminLayer = null; }

          // 更新按钮状态
          ['none', 'province', 'city', 'county'].forEach(l => {
            const btn = document.getElementById('btn-' + l);
            if (btn) btn.classList.toggle('active', l === level);
          });

          currentAdminLevel = level;
          if (level === 'none') return;

          // 添加新图层
          currentAdminLayer = L.geoJSON(adminData[level], {
            style: adminStyles[level],
            onEachFeature: function(feature, layer) {
              layer.on({
                mouseover: function(e) {
                  e.target.setStyle({ fillOpacity: adminStyles[level].fillOpacity * 4, weight: adminStyles[level].weight + 1 });
                },
                mouseout: function(e) {
                  currentAdminLayer.resetStyle(e.target);
                },
                click: function(e) {
                  const props = feature.properties || {};
                  const name = props.name || props.NAME || props.省 || props.市 || props.县 || Object.values(props)[0] || '';

                  // -- 匹配 CSV 案例 --
                  let matchedCases = [];
                  if (currentAdminLevel === 'province') {
                    const featNorm = normalizeName(name);
                    matchedCases = ALL_CASES.filter(function(c) {
                      const caseNorm = normalizeName(c.province);
                      return caseNorm && featNorm && caseNorm === featNorm;
                    });
                  } else {
                    matchedCases = ALL_CASES.filter(function(c) {
                      if (c.lat == null || c.lng == null || isNaN(c.lat) || isNaN(c.lng)) return false;
                      return isPointInGeometry(c.lat, c.lng, feature.geometry);
                    });
                  }

                  const popupHtml = '<strong>' + name + '</strong><br><small style="color:#555">匹配案例: ' + matchedCases.length + ' 条</small>';
                  L.popup({ autoPan: false }).setLatLng(e.latlng).setContent(popupHtml).openOn(map);

                  window.parent.postMessage({
                    type: 'regionClick',
                    name: name,
                    level: currentAdminLevel,
                    cases: matchedCases
                  }, '*');
                }
              });
            }
          }).addTo(map);
        }

        // ---- 案例点逻辑（原有） ----
        const points = ${JSON.stringify(geoPoints)};
        
        // ---- 案例匹配工具函数 ----
        let ALL_CASES = [];

        function normalizeName(name) {
          return (name || '').replace(/省|市|自治区|壮族|回族|维吾尔族|维吾尔|藏族|苗族|侗族|仡佬族|土家族|布依族|彝族|特别行政区|地区|盟|林区/g, '').trim();
        }
        function normalizeText(name) {
          return (name || '').replace(/\\s+/g, '').toLowerCase();
        }

        function isPointInRing(lat, lng, ring) {
          let inside = false;
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][0], yi = ring[i][1];
            const xj = ring[j][0], yj = ring[j][1];
            if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
              inside = !inside;
            }
          }
          return inside;
        }

        function isPointInGeometry(lat, lng, geometry) {
          if (!geometry || !geometry.coordinates) return false;
          if (geometry.type === 'Polygon') {
            return isPointInRing(lat, lng, geometry.coordinates[0]);
          } else if (geometry.type === 'MultiPolygon') {
            return geometry.coordinates.some(function(poly) {
              return poly.length > 0 && isPointInRing(lat, lng, poly[0]);
            });
          }
          return false;
        }

        const markerEntries = [];
        let currentFocused = null;

        function clearFocused() {
          if (!currentFocused) return;
          const prevEl = currentFocused.getElement ? currentFocused.getElement() : null;
          if (prevEl) prevEl.classList.remove('focused');
          if (currentFocused.__baseZ != null && currentFocused.setZIndexOffset) {
            currentFocused.setZIndexOffset(currentFocused.__baseZ);
          }
          currentFocused = null;
        }

        function focusCaseMarker(payload) {
          if (!payload) return;
          let match = null;

          if (payload.pointId) {
            match = markerEntries.find((m) => m.point && m.point.id === payload.pointId);
          }
          if (!match && payload.lat != null && payload.lng != null) {
            match = markerEntries.find(
              (m) =>
                Math.abs((m.point?.lat ?? 0) - payload.lat) < 1e-6 &&
                Math.abs((m.point?.lng ?? 0) - payload.lng) < 1e-6
            );
          }
          if (!match && payload.title) {
            const titleNorm = normalizeText(payload.title);
            match = markerEntries.find((m) => {
              const ptTitle = normalizeText(m.point?.case_details?.paper_title || m.point?.name || '');
              return !!ptTitle && (ptTitle.includes(titleNorm.slice(0, 14)) || titleNorm.includes(ptTitle.slice(0, 14)));
            });
          }
          if (!match) return;

          clearFocused();
          const marker = match.marker;
          const el = marker.getElement ? marker.getElement() : null;
          if (el) el.classList.add('focused');
          marker.__baseZ = match.baseZ;
          if (marker.setZIndexOffset) marker.setZIndexOffset(Math.max(match.baseZ || 0, 2500));
          currentFocused = marker;

          map.flyTo([match.point.lat, match.point.lng], Math.max(map.getZoom(), 8), { animate: true, duration: 0.6 });
          if (marker.openPopup) marker.openPopup();
        }

        // 监听来自父窗口的消息
        window.addEventListener('message', (e) => {
          if (e.data.type === 'setCases') ALL_CASES = e.data.cases || [];
          if (e.data.type === 'focusCase') focusCaseMarker(e.data.payload || {});
        });
        
        // 创建所有 marker
        points.forEach((pt, idx) => {
          const isTarget = pt.point_type === 'target' || pt.param_type === 'target';
          const isHigh = pt.similarity >= 0.85;
          const baseZ = isTarget ? 1000 : 0;
          
          const icon = L.divIcon({
            className: isTarget ? 'target-marker' : ('case-marker' + (isHigh ? ' high' : '')),
            iconSize: isTarget ? [20, 20] : [14, 14],
            iconAnchor: isTarget ? [10, 10] : [7, 7],
          });
          
          const marker = L.marker([pt.lat, pt.lng], { icon, zIndexOffset: baseZ }).addTo(map);
          
          // 弹窗内容
          const simPct = pt.similarity != null ? (pt.similarity * 100).toFixed(0) : null;
          const simColor = pt.similarity >= 0.85 ? '#22c55e' : (pt.similarity >= 0.7 ? '#3b82f6' : '#94a3b8');
          const isCase = pt.point_type === 'reference_case' || pt.param_type === 'reference_case';
          
          let html = '<div class="popup-title">' + (isTarget ? '📍 ' : '') + pt.name + '</div>';
          html += '<div class="popup-coords">' + pt.lat.toFixed(4) + '°, ' + pt.lng.toFixed(4) + '°</div>';
          if (simPct && !isTarget) {
            html += '<div class="popup-sim"><span style="color:' + simColor + ';font-weight:700;font-size:16px;">' + simPct + '%</span>';
            html += '<div class="popup-sim-bar"><div class="popup-sim-fill" style="width:' + simPct + '%;background:' + simColor + ';"></div></div></div>';
          }
          if (isCase) {
            html += '<button class="popup-btn" onclick="window.parent.postMessage({type:\\'showCaseDetail\\',index:' + idx + '},\\'*\\')">📊 查看案例详情</button>';
          }
          marker.bindPopup(html, { maxWidth: 260, autoPan: false });
          markerEntries.push({ marker, point: pt, index: idx, baseZ });
        });
        
        // 自适应边界
        map.fitBounds(chinaBounds, { padding: [18, 18], maxZoom: 6 });
        if (points.length > 0) {
          map.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lng])), { padding: [50, 50], maxZoom: 10 });
        }
        map.panInsideBounds(chinaBounds, { animate: false });
        // 容器尺寸变化或初次渲染时，强制刷新尺寸，避免灰色空白边
        setTimeout(() => map.invalidateSize({ animate: false }), 0);
        setTimeout(() => map.invalidateSize({ animate: false }), 160);
        window.addEventListener('resize', () => map.invalidateSize({ animate: false }));

        // 默认行政区划图层（地图辅助藏埋层带溢出，等地图渲染完成后再添加）
        const _defaultLevel = '${defaultAdminLevel}';
        if (_defaultLevel !== 'none') {
          // 等地图瓦片加载完成后再覆盖行政图层
          setTimeout(() => switchAdmin(_defaultLevel), 300);
        }
      </script>
    </body>
    </html>
  `;
}

// ============================================================
// 主组件
// ============================================================

export const GeoVisualization: React.FC<GeoVisualizationProps> = ({ geoPoints }) => {
  const { openDrawer, isOpen, content } = useDrawer();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const caseCacheRef = useRef<Map<string, GeoPoint>>(new Map());
  const pendingFocusRef = useRef<GeoPoint | null>(null);
  const [allCases, setAllCases] = useState<CsvCase[]>([]);
  const [adminGeoData, setAdminGeoData] = useState<AdminGeoData | null>(null);
  const [isAdminGeoLoading, setIsAdminGeoLoading] = useState(true);

  // 加载案例 CSV 数据
  useEffect(() => {
    loadCsvCases()
      .then(setAllCases)
      .catch(err => console.warn('案例 CSV 加载失败:', err));
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

  // 案例数据更新后同步推送给 iframe
  useEffect(() => {
    if (allCases.length > 0) {
      iframeRef.current?.contentWindow?.postMessage({ type: 'setCases', cases: allCases }, '*');
    }
  }, [allCases]);

  // 获取案例完整数据
  const fetchCaseDetails = useCallback(async (point: GeoPoint): Promise<GeoPoint | null> => {
    if (point.case_details && point.parameters) return point;
    const cacheKey = `${point.kg_id || "prosail"}::${point.id}`;
    const cached = caseCacheRef.current.get(cacheKey);
    if (cached) return cached;
    try {
      const fullData = await getCaseFullDetails(point.id, point.kg_id);
      if (fullData) {
        const merged = { ...point, ...fullData };
        caseCacheRef.current.set(cacheKey, merged);
        return merged;
      }
    } catch (e) {
      console.error("获取案例详情失败:", e);
    } 
    return null;
  }, []);

  if (!geoPoints || geoPoints.length === 0) return null;

  const { centerLat, centerLng, zoom } = calculateMapBounds(geoPoints);

  // 判断是否为纯案例库视图（无目标点）——这种情况下默认展示省级边界
  const hasTargetPoint = geoPoints.some(p => p.point_type === 'target' || p.param_type === 'target');
  const defaultAdminLevel = hasTargetPoint ? 'none' : 'province';
  const mapHtml = useMemo(
    () => adminGeoData
      ? generateMapHtml(geoPoints, centerLat, centerLng, zoom, adminGeoData, defaultAdminLevel)
      : "",
    [adminGeoData, geoPoints, centerLat, centerLng, zoom, defaultAdminLevel]
  );

  // 监听 iframe 消息：marker 点击 & 案例详情
  useEffect(() => {
    const handleMessage = async (e: MessageEvent) => {
      if (e.data.type === 'regionClick') {
        openDrawer({
          type: 'region-cases',
          title: `${e.data.name}的建模案例`,
          data: {
            name: e.data.name,
            level: e.data.level,
            cases: e.data.cases || [],
            geoPoints,
          },
        });
      } else if (e.data.type === 'showCaseDetail') {
        const pt = geoPoints[e.data.index];
        if (pt) {
          const full = await fetchCaseDetails(pt);
          if (full?.case_details && full?.parameters) {
            openDrawer({ type: 'case-detail', title: '案例详情', data: full });
          }
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [geoPoints, openDrawer, fetchCaseDetails]);

  const postFocusCase = useCallback((point: GeoPoint | null) => {
    if (!point) return;
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "focusCase",
        payload: {
          pointId: point.id,
          lat: point.lat,
          lng: point.lng,
          kg_id: point.kg_id,
          title: point.case_details?.paper_title || point.name || "",
        },
      },
      "*"
    );
  }, []);

  // 右侧面板打开案例详情时，让地图聚焦对应点并高亮
  useEffect(() => {
    if (!isOpen || !content || content.type !== "case-detail") return;
    const selected = content.data as GeoPoint | undefined;
    if (!selected) return;

    const norm = (s: string) => (s || "").replace(/\s+/g, "").toLowerCase();
    const selectedTitle = norm(selected.case_details?.paper_title || selected.name || "");

    const matched = geoPoints.find((p) => {
      const sameId = !!selected.id && p.id === selected.id;
      const sameKg = (p.kg_id || "prosail") === (selected.kg_id || "prosail");
      if (sameId && sameKg) return true;

      if (selected.lat != null && selected.lng != null) {
        const sameLatLng =
          Math.abs((p.lat ?? 0) - selected.lat) < 1e-4 &&
          Math.abs((p.lng ?? 0) - selected.lng) < 1e-4;
        if (sameLatLng) return true;
      }

      const pointTitle = norm(p.case_details?.paper_title || p.name || "");
      if (selectedTitle && pointTitle) {
        return pointTitle.includes(selectedTitle.slice(0, 14)) || selectedTitle.includes(pointTitle.slice(0, 14));
      }
      return false;
    });
    if (!matched) return;

    pendingFocusRef.current = matched;
    postFocusCase(matched);
  }, [isOpen, content, geoPoints, postFocusCase]);

  return (
    <div className="geo-visualization">
      {/* 标题栏 */}
      <div className="geo-header">
        <div className="geo-title">
          <span className="geo-icon">🗺️</span>
          <h4>地理坐标分布（{geoPoints.length} 个点）</h4>
        </div>
      </div>

      {/* 地图 */}
      <div className="map-container">
        {isAdminGeoLoading || !mapHtml ? (
          <div className="map-loading-state">地图边界数据加载中...</div>
        ) : (
          <iframe
            ref={iframeRef}
            srcDoc={mapHtml}
            width="100%"
            height="100%"
            title="地图"
            onLoad={() => {
              if (allCases.length > 0) {
                iframeRef.current?.contentWindow?.postMessage({ type: 'setCases', cases: allCases }, '*');
              }
              if (pendingFocusRef.current) {
                postFocusCase(pendingFocusRef.current);
              }
            }}
          />
        )}
      </div>
    </div>
  );
};

export default GeoVisualization;
