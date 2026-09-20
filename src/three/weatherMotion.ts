export interface WeatherDrift { time?: number; x: number; z: number; }
/** Integrate advection so changing wind changes velocity without teleporting the whole cloud/rain field. */
export function advanceWeatherDrift(drift: WeatherDrift, time: number, xSpeed: number, zSpeed: number): void {
  if (!Number.isFinite(time)) return;
  if (time < (drift.time ?? 0)) { drift.x = 0; drift.z = 0; drift.time = time; return; }
  const delta = time - (drift.time ?? 0);
  drift.x += xSpeed * delta; drift.z += zSpeed * delta; drift.time = time;
}
