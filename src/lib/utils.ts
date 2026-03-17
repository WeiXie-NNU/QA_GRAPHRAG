export function parseMapAction(content: string): { address: string } | null {
  const match = content.match(/<!-- MAP_ACTION:\s*(\{[^}]+\})\s*-->/);
  if (match) {
    try {
      const data = JSON.parse(match[1]);
      if (data.action === "showMap" && data.address) return { address: data.address };
    } catch (e) { /* ignore */ }
  }
  return null;
}

export function removeMapMarker(content: string): string {
  return content.replace(/<!-- MAP_ACTION:\s*\{[^}]+\}\s*-->/g, "").trim();
}

export function parseAgentState(content: string): { steps: any[]; geo_points: any[] } | null {
  const match = content.match(/<!-- AGENT_STATE:\s*([\s\S]*?)\s*-->/);
  if (match?.[1]) {
    try {
      return JSON.parse(match[1]);
    } catch (e) { return null; }
  }
  return null;
}

export function removeAgentStateMarker(content: string): string {
  return content.replace(/<!-- AGENT_STATE:\s*[\s\S]*?\s*-->/g, "").trim();
}

export interface AgentDataIds {
  localResultId: string | null;
  globalResultId: string | null;
  geoDataId: string | null;
}

export function parseAgentDataIds(content: string): AgentDataIds | null {
  const match = content.match(/<!-- AGENT_DATA:([^:]*):([^:]*):([^>]*) -->/);
  if (match) {
    const localId = match[1]?.trim() || null;
    const globalId = match[2]?.trim() || null;
    const geoDataId = match[3]?.trim() || null;
    if (localId || globalId || geoDataId) {
      return { localResultId: localId, globalResultId: globalId, geoDataId };
    }
  }
  return null;
}

export function removeAgentDataMarker(content: string): string {
  return content.replace(/\n*<!-- AGENT_DATA:[^>]* -->/g, "").trim();
}

export function calculateMapBounds(points: Array<{ lat: number; lng: number }>) {
  if (!points.length) return { centerLat: 0, centerLng: 0, zoom: 2 };

  const lats = points.map(p => p.lat);
  const lngs = points.map(p => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const maxDiff = Math.max(maxLat - minLat, maxLng - minLng);
  const zoom = maxDiff > 10 ? 3 : maxDiff > 5 ? 5 : maxDiff > 1 ? 8 : 10;

  return { 
    centerLat: (maxLat + minLat) / 2, 
    centerLng: (maxLng + minLng) / 2, 
    zoom, minLat, maxLat, minLng, maxLng 
  };
}

export function calculateProgress(steps: Array<{ status: string }>) {
  const total = steps.length;
  const completed = steps.filter(s => s.status === "complete" || s.status === "completed").length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { completed, total, progress, isComplete: completed === total };
}
