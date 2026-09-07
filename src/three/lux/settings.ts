import type { LuxSettings, QualityLevel } from '../../types';

export const LUX_VERSION = '1.0';
export const DEFAULT_LUX: Readonly<LuxSettings> = Object.freeze({
  enabled: false, quality: 'auto', mode: 'camera', position: [0, 2, 0] as LuxSettings['position'], radius: 24,
  indirectIntensity: 0.65, reflections: true, reflectionIntensity: 1, screenTraces: true,
  updateInterval: 0.5, smoothing: 0.3, refreshNonce: 0, debug: false,
});
const finite = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** Imported settings never get to allocate arbitrary GPU resources or introduce NaN uniforms. */
export function resolveLux(input?: Partial<LuxSettings>): LuxSettings {
  const s = input ?? {};
  return {
    enabled: s.enabled === true,
    quality: ['auto', 'performance', 'balanced', 'cinematic'].includes(s.quality ?? '') ? s.quality! : 'auto',
    mode: s.mode === 'fixed' ? 'fixed' : 'camera',
    position: [0, 1, 2].map((i) => finite(s.position?.[i], DEFAULT_LUX.position[i], -100000, 100000)) as LuxSettings['position'],
    radius: finite(s.radius, 24, 2, 200),
    indirectIntensity: finite(s.indirectIntensity, 0.65, 0, 3),
    reflectionIntensity: finite(s.reflectionIntensity, 1, 0, 3),
    reflections: s.reflections !== false, screenTraces: s.screenTraces !== false,
    updateInterval: finite(s.updateInterval, 0.5, 0.1, 10),
    smoothing: finite(s.smoothing, 0.3, 0, 2),
    refreshNonce: finite(s.refreshNonce, 0, 0, Number.MAX_SAFE_INTEGER), debug: s.debug === true,
  };
}

export interface LuxBudget { resolution: number; faceStride: number; interval: number; label: string }
/** Global scalability is a hard ceiling, including when auto-quality reduces it during Play. */
export function luxBudget(settings: LuxSettings, quality: QualityLevel = 'High'): LuxBudget | null {
  if (!settings.enabled || quality === 'Low') return null;
  const ceiling = quality === 'Epic' ? 2 : quality === 'Medium' ? 0 : 1;
  const requested = settings.quality === 'auto' ? ceiling : ['performance', 'balanced', 'cinematic'].indexOf(settings.quality);
  const level = Math.min(ceiling, Math.max(0, requested));
  return {
    resolution: [32, 64, 128][level], faceStride: level === 0 ? 2 : 1,
    interval: Math.max(settings.updateInterval, [1, 0.5, 0.25][level]),
    label: ['Performance', 'Balanced', 'Cinematic'][level],
  };
}

/** Smooth edge on each shaded fragment, including large/shared/instanced meshes. */
export function luxCoverage(distance: number, radius: number): number {
  const t = Math.min(1, Math.max(0, (distance / radius - 0.65) / 0.35));
  return 1 - t * t * (3 - 2 * t);
}
