import type { QualityLevel } from '../types';

/**
 * Resolved rendering budget for a quality preset. These are the concrete GPU levers an Unreal-style
 * "scalability" setting maps to in this engine:
 *  - `dpr`              render resolution cap (devicePixelRatio) — the single biggest fragment-cost lever
 *  - `shadows`          whether the renderer casts shadows at all (off ≈ free on low-end GPUs)
 *  - `shadowMapSize`    per-light shadow map resolution (sharper but heavier)
 *  - `maxShadowCasters` how many shadow-casting lights stay lit during Play (forward rendering = a depth
 *                       pass each), the rest are budgeted off
 *  - `msaa`             multisampling on the post-FX HDR composer (0 = off)
 *  - `bloomMipmap`      mipmap-blur bloom (smoother, wider glow) vs the cheaper single-pass bloom
 */
export interface QualityProfile {
  dpr: number;
  shadows: boolean;
  shadowMapSize: number;
  maxShadowCasters: number;
  msaa: number;
  bloomMipmap: boolean;
}

/** Ordered Low → Epic, for building selector UIs. */
export const QUALITY_LEVELS: QualityLevel[] = ['Low', 'Medium', 'High', 'Epic'];

export const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  Low: { dpr: 0.75, shadows: false, shadowMapSize: 512, maxShadowCasters: 0, msaa: 0, bloomMipmap: false },
  Medium: { dpr: 1, shadows: true, shadowMapSize: 1024, maxShadowCasters: 3, msaa: 0, bloomMipmap: false },
  High: { dpr: 1.5, shadows: true, shadowMapSize: 2048, maxShadowCasters: 8, msaa: 2, bloomMipmap: true },
  Epic: { dpr: 2, shadows: true, shadowMapSize: 4096, maxShadowCasters: 16, msaa: 4, bloomMipmap: true },
};

export const DEFAULT_QUALITY: QualityLevel = 'High';

/** Resolve a profile, falling back to High for an unset/unknown level. */
export const qualityProfile = (level: QualityLevel | undefined): QualityProfile =>
  QUALITY_PROFILES[level ?? DEFAULT_QUALITY] ?? QUALITY_PROFILES[DEFAULT_QUALITY];
