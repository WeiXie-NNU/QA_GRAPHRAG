/**
 * 地图组件 - 使用天地图底图
 * 
 * 根据地址显示地图位置
 */

import { useState, useEffect } from "react";
import { TIANDITU_API_KEY } from "../lib/consts";
import "./MapView.css";

interface MapViewProps {
  address: string;
  latitude?: number;
  longitude?: number;
  zoom?: number;
}

// 使用 Nominatim API 进行地理编码（免费、无需 API Key）
async function geocodeAddress(address: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const encodedAddress = encodeURIComponent(address);
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}&limit=1`,
      {
        headers: {
          "User-Agent": "GraphRAG-Chat/1.0",
        },
      }
    );
    const data = await response.json();
    
    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon),
      };
    }
    return null;
  } catch (error) {
    console.error("Geocoding error:", error);
    return null;
  }
}

export function MapView({ address, latitude, longitude, zoom = 15 }: MapViewProps) {
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(
    latitude && longitude ? { lat: latitude, lon: longitude } : null
  );
  const [loading, setLoading] = useState(!coords);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 如果已有坐标，不需要地理编码
    if (latitude && longitude) {
      setCoords({ lat: latitude, lon: longitude });
      setLoading(false);
      return;
    }

    // 地理编码
    const fetchCoords = async () => {
      setLoading(true);
      setError(null);
      
      const result = await geocodeAddress(address);
      if (result) {
        setCoords(result);
      } else {
        setError("无法找到该地址的位置");
      }
      setLoading(false);
    };

    fetchCoords();
  }, [address, latitude, longitude]);

  if (loading) {
    return (
      <div className="map-container map-loading">
        <div className="map-spinner"></div>
        <p>正在加载地图...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="map-container map-error">
        <span>🗺️</span>
        <p>{error}</p>
        <p className="map-address">{address}</p>
      </div>
    );
  }

  if (!coords) {
    return null;
  }

  // 生成天地图 HTML
  const generateMapHtml = () => `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <style>
        body { margin: 0; padding: 0; }
        #map { width: 100%; height: 100%; }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        const map = L.map('map', { attributionControl: false }).setView([${coords.lat}, ${coords.lon}], ${zoom});
        
        // 天地图矢量底图
        L.tileLayer('https://t{s}.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILECOL={x}&TILEROW={y}&TILEMATRIX={z}&tk=${TIANDITU_API_KEY}', {
          subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
          attribution: '© 天地图'
        }).addTo(map);
        
        // 天地图矢量注记
        L.tileLayer('https://t{s}.tianditu.gov.cn/cva_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cva&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILECOL={x}&TILEROW={y}&TILEMATRIX={z}&tk=${TIANDITU_API_KEY}', {
          subdomains: ['0', '1', '2', '3', '4', '5', '6', '7']
        }).addTo(map);
        
        // 添加标记
        L.marker([${coords.lat}, ${coords.lon}]).addTo(map)
          .bindPopup('<b>${address.replace(/'/g, "\\'")}</b>').openPopup();
      </script>
    </body>
    </html>
  `;

  // 外部链接 - 使用天地图
  const externalUrl = `https://map.tianditu.gov.cn/?center=${coords.lon},${coords.lat}&zoom=${zoom}&type=vec`;

  return (
    <div className="map-container">
      <div className="map-header">
        <span className="map-icon">📍</span>
        <span className="map-title">{address}</span>
        <a 
          href={externalUrl} 
          target="_blank" 
          rel="noopener noreferrer"
          className="map-external-link"
        >
          在天地图中打开 ↗
        </a>
      </div>
      <iframe
        className="map-iframe"
        srcDoc={generateMapHtml()}
        title={`Map of ${address}`}
        loading="lazy"
      />
      <div className="map-coords">
        坐标: {coords.lat != null ? coords.lat.toFixed(6) : 'N/A'}, {coords.lon != null ? coords.lon.toFixed(6) : 'N/A'}
      </div>
    </div>
  );
}

export default MapView;
