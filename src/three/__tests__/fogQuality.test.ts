import { describe, expect, it } from 'vitest';
import { isVolumetricFogActive, withSceneEnvironmentDefaults } from '../environmentSettings';
import { qualityProfile } from '../quality';
import { resolveVolumetric } from '../VolumetricFog';

describe('fog quality fallback', () => {
  const env = withSceneEnvironmentDefaults({ fogEnabled: true, volumetricFogEnabled: true });

  it('keeps distance fog available when Low quality skips the volumetric pass', () => {
    expect(isVolumetricFogActive(env, qualityProfile('Low'))).toBe(false);
    expect(resolveVolumetric(env, qualityProfile('Low'))).toBeNull();
    expect(env.fogEnabled).toBe(true);
  });

  it.each(['Medium', 'High', 'Epic'] as const)('uses one volumetric fog model at %s', (quality) => {
    const profile = qualityProfile(quality);
    expect(isVolumetricFogActive(env, profile)).toBe(true);
    expect(resolveVolumetric(env, profile)?.density).toBe(env.volumetricFogDensity);
  });

  it.each([0, -1, 0.0001, NaN, Infinity])('does not suppress the fallback for inactive density %s', (density) => {
    const disabled = { ...env, volumetricFogDensity: density };
    expect(isVolumetricFogActive(disabled, qualityProfile('High'))).toBe(false);
    expect(resolveVolumetric(disabled, qualityProfile('High'))).toBeNull();
  });

  it('keeps volumetric fog independently controlled by its authored toggle', () => {
    expect(resolveVolumetric({ ...env, volumetricFogEnabled: false }, qualityProfile('High'))).toBeNull();
    expect(resolveVolumetric({ ...env, fogEnabled: false }, qualityProfile('High'))).not.toBeNull();
  });
});
