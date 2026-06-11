import type { ProfilerOnRenderCallback } from 'react';

/**
 * React render-time attribution by UI region (dev builds only — React's <Profiler> onRender does not
 * fire in production bundles). Same module-singleton pattern as perfStats: regions accumulate render
 * ms in place; the perf overlay polls a snapshot on its own timer. Used to pin down WHICH panel is
 * burning main-thread time during Play (the "react/other" slice of the frame budget).
 */

interface RegionTotal {
  ms: number;
  commits: number;
}

const totals = new Map<string, RegionTotal>();
let windowStart = performance.now();

/** Pass as <Profiler onRender>: accumulates actual render duration under the Profiler's id. */
export const profileRender: ProfilerOnRenderCallback = (id, _phase, actualDuration) => {
  const total = totals.get(id);
  if (total) {
    total.ms += actualDuration;
    total.commits += 1;
  } else {
    totals.set(id, { ms: actualDuration, commits: 1 });
  }
};

export interface ReactProfileRow {
  id: string;
  /** Average React render ms this region costs per second of wall clock. */
  msPerSec: number;
  commitsPerSec: number;
}

/** Regions sorted by cost. Empty in production builds (onRender never fires there). */
export const getReactProfile = (): ReactProfileRow[] => {
  const seconds = Math.max(0.001, (performance.now() - windowStart) / 1000);
  return [...totals]
    .map(([id, total]) => ({ id, msPerSec: total.ms / seconds, commitsPerSec: total.commits / seconds }))
    .sort((a, b) => b.msPerSec - a.msPerSec);
};

/** Restart the sampling window (called when Play starts so numbers describe the session). */
export const resetReactProfile = () => {
  totals.clear();
  windowStart = performance.now();
};
