export interface SurfaceWaterState { time?: number; water: number; }
/** Exact exponential integration is independent of frame rate for a constant rainfall segment. */
export function advanceSurfaceWater(state: SurfaceWaterState, time: number, rain: number, enabled: boolean): number {
  if (!Number.isFinite(time)) return state.water;
  if (state.time === undefined || time < state.time || !enabled) { state.time = time; state.water = 0; return 0; }
  const delta = Math.max(0, time - state.time); state.time = time;
  const target = Math.max(0, Math.min(1, rain));
  const rate = target > state.water ? 0.18 : 0.025;
  state.water += (target - state.water) * (1 - Math.exp(-rate * delta));
  return state.water;
}
