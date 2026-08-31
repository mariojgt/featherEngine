export const FEATHER_LOCAL_AI_CACHE = 'feather-local-ai-v1';

const CACHE_MARKER_KEY = 'nodeforge.local-ai.cached-models';

function readCachedModelIds(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const value = JSON.parse(localStorage.getItem(CACHE_MARKER_KEY) ?? '[]');
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeCachedModelIds(ids: Set<string>) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(CACHE_MARKER_KEY, JSON.stringify([...ids]));
}

export function markLocalModelCached(modelId: string) {
  const ids = readCachedModelIds();
  ids.add(modelId);
  writeCachedModelIds(ids);
}

export async function listCachedLocalModelIds(): Promise<string[]> {
  const ids = [...readCachedModelIds()];
  if (ids.length === 0 || typeof caches === 'undefined') return ids;

  try {
    if (!(await caches.has(FEATHER_LOCAL_AI_CACHE))) return [];
    const cache = await caches.open(FEATHER_LOCAL_AI_CACHE);
    const keys = await cache.keys();
    return ids.filter((modelId) =>
      keys.some((request) => {
        try {
          return decodeURIComponent(new URL(request.url).pathname).includes(`/${modelId}/`);
        } catch {
          return request.url.includes(modelId);
        }
      }),
    );
  } catch {
    // Embedded/private contexts can expose localStorage while denying Cache Storage inspection.
    return ids;
  }
}

export async function isLocalModelCached(modelId: string): Promise<boolean> {
  return (await listCachedLocalModelIds()).includes(modelId);
}

export async function clearLocalModelCache(): Promise<void> {
  if (typeof caches !== 'undefined') await caches.delete(FEATHER_LOCAL_AI_CACHE);
  if (typeof localStorage !== 'undefined') localStorage.removeItem(CACHE_MARKER_KEY);
}
