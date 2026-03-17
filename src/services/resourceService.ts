type AdminLevel = "province" | "city" | "county";

export interface RepositoryRegistry {
  knowledge_repositories?: Array<{
    id?: string;
    enabled?: boolean;
    model_dir_name?: string;
    name?: string;
  }>;
}

const resourceCache = new Map<string, unknown>();
const pendingResourceCache = new Map<string, Promise<unknown>>();

const ADMIN_GEO_PATHS: Record<AdminLevel, string> = {
  province: "/resources/administration/中国_省.geojson",
  city: "/resources/administration/中国_市.geojson",
  county: "/resources/administration/中国_县.geojson",
};

async function fetchJsonResource<T>(path: string): Promise<T> {
  if (resourceCache.has(path)) {
    return resourceCache.get(path) as T;
  }

  const pending = pendingResourceCache.get(path);
  if (pending) {
    return pending as Promise<T>;
  }

  const request = (async () => {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to load resource: ${path} (${response.status})`);
    }
    const payload = (await response.json()) as T;
    resourceCache.set(path, payload);
    pendingResourceCache.delete(path);
    return payload;
  })().catch((error) => {
    pendingResourceCache.delete(path);
    throw error;
  });

  pendingResourceCache.set(path, request);
  return request;
}

export function loadAdminGeoJson(level: AdminLevel): Promise<any> {
  return fetchJsonResource<any>(ADMIN_GEO_PATHS[level]);
}

export async function loadAllAdminGeoJson(): Promise<Record<AdminLevel, any>> {
  const [province, city, county] = await Promise.all([
    loadAdminGeoJson("province"),
    loadAdminGeoJson("city"),
    loadAdminGeoJson("county"),
  ]);

  return { province, city, county };
}

export function loadRepositoryRegistry(): Promise<RepositoryRegistry> {
  return fetchJsonResource<RepositoryRegistry>("/resources/repositories/registry.json");
}

