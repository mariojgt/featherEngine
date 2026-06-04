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
 *  - `maxAnisotropy`    anisotropic texture filtering (1 = off); keeps tiled/ground textures sharp at
 *                       grazing angles. Cheap relative to resolution, so it scales modestly. The GPU
 *                       clamps this to its hardware max at upload, so over-asking is safe.
 *  - `ssao`             screen-space ambient occlusion in the post pass (contact shadows in crevices)
 *  - `smaa`             post-process edge anti-aliasing. Cheap and catches shader/specular aliasing
 *                       that MSAA misses; crucially it's the ONLY AA on the lower presets (msaa: 0),
 *                       so without it Low/Medium have jagged edges. Off on Low for maximum throughput.
 *  - `envResolution`    cubemap resolution of the procedural IBL environment. Higher = sharper
 *                       reflections on metallic/low-roughness surfaces. A one-time PMREM cost, so it
 *                       scales generously without hurting per-frame perf.
 *  - `ssr`              screen-space reflections (glossy floors / wet streets reflect the scene).
 *                       The single most expensive post effect here — Epic only.
 *  - `shadowDistance`   distance-LOD for shadow CASTING: meshes farther than this from the camera stop
 *                       rendering into shadow maps (their shadow is imperceptible at range). Shrinks the
 *                       shadow pass in big scenes without ever hiding the object itself. 0 = no culling.
 */
export interface QualityProfile {
  dpr: number;
  shadows: boolean;
  shadowMapSize: number;
  maxShadowCasters: number;
  msaa: number;
  bloomMipmap: boolean;
  maxAnisotropy: number;
  ssao: boolean;
  smaa: boolean;
  envResolution: number;
  ssr: boolean;
  shadowDistance: number;
}

/** Ordered Low → Epic, for building selector UIs. */
export const QUALITY_LEVELS: QualityLevel[] = ['Low', 'Medium', 'High', 'Epic'];

export const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  Low: { dpr: 0.75, shadows: false, shadowMapSize: 512, maxShadowCasters: 0, msaa: 0, bloomMipmap: false, maxAnisotropy: 1, ssao: false, smaa: false, envResolution: 128, ssr: false, shadowDistance: 0 },
  Medium: { dpr: 1, shadows: true, shadowMapSize: 1024, maxShadowCasters: 3, msaa: 0, bloomMipmap: false, maxAnisotropy: 4, ssao: false, smaa: true, envResolution: 256, ssr: false, shadowDistance: 45 },
  High: { dpr: 1.5, shadows: true, shadowMapSize: 2048, maxShadowCasters: 8, msaa: 2, bloomMipmap: true, maxAnisotropy: 8, ssao: true, smaa: true, envResolution: 512, ssr: false, shadowDistance: 90 },
  Epic: { dpr: 2, shadows: true, shadowMapSize: 4096, maxShadowCasters: 16, msaa: 4, bloomMipmap: true, maxAnisotropy: 16, ssao: true, smaa: true, envResolution: 512, ssr: true, shadowDistance: 160 },
};

export const DEFAULT_QUALITY: QualityLevel = 'High';

/** Resolve a profile, falling back to High for an unset/unknown level. */
export const qualityProfile = (level: QualityLevel | undefined): QualityProfile =>
  QUALITY_PROFILES[level ?? DEFAULT_QUALITY] ?? QUALITY_PROFILES[DEFAULT_QUALITY];
