import type { QualityLevel } from '../types';

/** Pixel error is stable across mesh scales, camera zoom and output resolution. Hysteresis keeps
 * detail from flickering when the camera rests on a level boundary. */
export function selectPreparedLod(errors: readonly number[], projectedDiameter: number, quality: QualityLevel = 'High', previous = 0): number {
  if (!Number.isFinite(projectedDiameter) || projectedDiameter <= 0) return 0;
  const tolerance = { Low: 4, Medium: 2, High: 1, Epic: 0.5 }[quality];
  for (let level = Math.min(2, errors.length); level >= 1; level--) {
    const error = errors[level - 1];
    const threshold = tolerance * (level <= previous ? 1.15 : 0.85);
    if (Number.isFinite(error) && error >= 0 && error * projectedDiameter <= threshold) return level;
  }
  return 0;
}
