import type { SteamPublishResult } from '../platform/types';
export interface ReleaseHistoryEntry {
  time: number; appId: number; branch: string; description: string; localBuildId?: string;
  status: 'failed' | SteamPublishResult['status']; buildId?: string; depotIds: number[]; error?: string;
}
export function readReleaseHistory(key: string): ReleaseHistoryEntry[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(`${key}.history`) ?? '[]'); return Array.isArray(value) ? value.filter((entry) => entry && typeof entry.time === 'number' && typeof entry.status === 'string').slice(0, 20) : []; } catch { return []; }
}
export function recordRelease(key: string, entry: ReleaseHistoryEntry): ReleaseHistoryEntry[] {
  const history = [entry, ...readReleaseHistory(key)].slice(0, 20);
  try { localStorage.setItem(`${key}.history`, JSON.stringify(history)); } catch { /* Publishing does not depend on local history storage. */ }
  return history;
}
