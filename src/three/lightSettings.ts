import type { LightComponent, QualityLevel } from '../types';
import { lightShadowMapSize, qualityProfile, SHADOW_NORMAL_BIAS } from './quality';

const finite = (value: number | undefined, fallback: number, min: number, max: number) => Number.isFinite(value) ? Math.min(max, Math.max(min, value!)) : fallback;
export function resolveLight(input?: Partial<LightComponent>, quality?: QualityLevel) {
  const type = ['point', 'spot', 'directional', 'rect'].includes(input?.type ?? '') ? input!.type! : 'directional';
  const profile = qualityProfile(quality);
  const near = finite(input?.shadowNear, 0.5, 0.01, 100);
  return {
    type, color: input?.color ?? '#ffffff', intensity: finite(input?.intensity, 2.4, 0, 100000),
    distance: finite(input?.distance, 0, 0, 100000), decay: finite(input?.decay, 2, 0, 4),
    angle: finite(input?.angle, Math.PI / 4, 0.01, Math.PI / 2), penumbra: finite(input?.penumbra, 0.45, 0, 1),
    width: finite(input?.width, 4, 0.01, 1000), height: finite(input?.height, 4, 0.01, 1000),
    useRotation: input?.useRotation === true,
    castShadow: type !== 'rect' && profile.shadows && input?.castShadow !== false,
    shadowSize: type === 'rect' ? 0 : lightShadowMapSize(profile, type),
    shadowBias: finite(input?.shadowBias, type === 'point' ? -0.0008 : type === 'spot' ? -0.0006 : -0.0004, -0.05, 0.05),
    shadowNormalBias: finite(input?.shadowNormalBias, SHADOW_NORMAL_BIAS, 0, 2),
    shadowNear: near, shadowFar: finite(input?.shadowFar, type === 'directional' ? 120 : 500, near + 0.01, 100000),
    shadowExtent: finite(input?.shadowExtent, 40, 0.1, 1000),
  };
}
