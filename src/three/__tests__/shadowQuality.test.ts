import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUALITY,
  lightShadowMapSize,
  QUALITY_LEVELS,
  QUALITY_PROFILES,
  qualityProfile,
  SHADOW_NORMAL_BIAS,
} from '../quality';

describe('lightShadowMapSize', () => {
  // Migration safety. Scene lights previously hardcoded these three numbers, and the default tier is
  // High — so every existing project must keep the exact shadow resolution it renders with today.
  // If this fails, a change to the High profile or the divisors is silently restyling users' scenes.
  it('reproduces the previously hardcoded sizes at the default quality tier', () => {
    expect(DEFAULT_QUALITY).toBe('High');
    const high = qualityProfile('High');
    expect(lightShadowMapSize(high, 'directional')).toBe(2048);
    expect(lightShadowMapSize(high, 'spot')).toBe(1024);
    expect(lightShadowMapSize(high, 'point')).toBe(512);
  });

  // The bug this fixes: the tier's shadowMapSize only ever reached the environment sun, so Medium
  // still paid for 2048 maps and Epic never got its 4096.
  it('scales with the quality tier', () => {
    expect(lightShadowMapSize(qualityProfile('Medium'), 'directional')).toBe(1024);
    expect(lightShadowMapSize(qualityProfile('Epic'), 'directional')).toBe(4096);
    expect(lightShadowMapSize(qualityProfile('Epic'), 'point')).toBe(1024);
  });

  it('keeps a point light cheaper than a spot, and a spot cheaper than a directional', () => {
    for (const level of QUALITY_LEVELS) {
      const profile = qualityProfile(level);
      const directional = lightShadowMapSize(profile, 'directional');
      const spot = lightShadowMapSize(profile, 'spot');
      const point = lightShadowMapSize(profile, 'point');
      expect(directional).toBeGreaterThanOrEqual(spot);
      expect(spot).toBeGreaterThanOrEqual(point);
    }
  });

  it('never returns a uselessly small map', () => {
    // Low's 512 would quarter to 128 for a point light, which is pure aliasing.
    expect(lightShadowMapSize(qualityProfile('Low'), 'point')).toBe(256);
    expect(lightShadowMapSize({ ...QUALITY_PROFILES.Low, shadowMapSize: 8 }, 'point')).toBe(256);
  });

  it('returns a power of two for every tier and light kind, as GPUs prefer', () => {
    const isPowerOfTwo = (value: number) => value > 0 && (value & (value - 1)) === 0;
    for (const level of QUALITY_LEVELS) {
      for (const kind of ['directional', 'spot', 'point'] as const) {
        expect(isPowerOfTwo(lightShadowMapSize(qualityProfile(level), kind))).toBe(true);
      }
    }
  });

  it('falls back to the default tier for an unknown level', () => {
    expect(lightShadowMapSize(qualityProfile(undefined), 'directional')).toBe(2048);
  });
});

describe('SHADOW_NORMAL_BIAS', () => {
  // Too small and acne returns on curved geometry; too large and contact shadows detach from their
  // caster. This pins the value so it cannot drift without someone looking at a render.
  it('is a small positive offset', () => {
    expect(SHADOW_NORMAL_BIAS).toBeGreaterThan(0);
    expect(SHADOW_NORMAL_BIAS).toBeLessThan(0.1);
  });
});
