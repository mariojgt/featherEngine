import { describe, expect, it } from 'vitest';
import { defaultTerrain, sampleBaseTerrainLocalHeight, sampleTerrainLocalHeight, sampleTerrainMaterialLayerId, buildTerrainHeightfield, withTerrainDefaults } from './terrain';
import { withSceneEnvironmentDefaults, sunPositionFromEnvironment } from '../three/environmentSettings';

describe('cinematic landscape and lighting controls', () => {
  it('reuses normalized terrain without hiding subsequent immutable sculpt and paint edits', () => {
    const terrain = withTerrainDefaults({ heightScale: 0 });
    expect(withTerrainDefaults(terrain)).toBe(terrain);
    expect(sampleTerrainLocalHeight(terrain, 0, 0)).toBeCloseTo(0);
    const sculpted = withTerrainDefaults({ ...terrain, heightOverrides: { '0:0': 3 } });
    expect(sampleTerrainLocalHeight(sculpted, 0, 0)).toBe(3);
    expect(sampleTerrainLocalHeight(terrain, 0, 0)).toBeCloseTo(0);
    const painted = withTerrainDefaults({ ...sculpted, paintOverrides: { '0:0': terrain.materialLayers[1].id } });
    expect(sampleTerrainMaterialLayerId(painted, 0, 0)).toBe(terrain.materialLayers[1].id);
    expect(withTerrainDefaults(painted)).toBe(painted);
  });
  it('keeps legacy heightfields unchanged and makes deterministic, continuous ridges shared with colliders', () => {
    const base = defaultTerrain();
    for (const x of [-60, 0, 12.2, 51]) expect(sampleBaseTerrainLocalHeight(base, x, 9)).toBe(sampleBaseTerrainLocalHeight({ ...base, ridgeStrength: 0, domainWarp: 0 }, x, 9));
    const mountain = { ...base, ridgeStrength: 0.85, domainWarp: 42, heightScale: 60 };
    const h = sampleBaseTerrainLocalHeight(mountain, 12.2, 9);
    expect(h).toBe(sampleBaseTerrainLocalHeight(JSON.parse(JSON.stringify(mountain)), 12.2, 9));
    expect(h).not.toBe(sampleBaseTerrainLocalHeight(base, 12.2, 9));
    expect(Math.abs(sampleBaseTerrainLocalHeight(mountain, 32 - 0.00001, 7) - sampleBaseTerrainLocalHeight(mountain, 32 + 0.00001, 7))).toBeLessThan(0.01);
    const field = buildTerrainHeightfield(mountain, 0, 0);
    expect(field).toBeTruthy();
    expect(withTerrainDefaults({ ridgeStrength: NaN, domainWarp: Infinity }).ridgeStrength).toBe(0);
    expect(withTerrainDefaults({ ridgeStrength: 20, domainWarp: -5 }).domainWarp).toBe(0);
  });
  it('keeps old light defaults, accepts true darkness, and sanitizes imported controls', () => {
    expect(withSceneEnvironmentDefaults().ambientIntensity).toBeUndefined();
    expect(withSceneEnvironmentDefaults().sunShadowExtent).toBeUndefined();
    expect(withSceneEnvironmentDefaults({ ambientIntensity: 0 }).ambientIntensity).toBe(0);
    expect(withSceneEnvironmentDefaults({ ambientIntensity: NaN, sunShadowExtent: Infinity }).sunShadowExtent).toBeUndefined();
    expect(withSceneEnvironmentDefaults({ ambientIntensity: -1, sunShadowExtent: 1 })).toMatchObject({ ambientIntensity: 0, sunShadowExtent: 8 });
    expect(Math.hypot(...sunPositionFromEnvironment(withSceneEnvironmentDefaults(), 84))).toBeCloseTo(84);
  });
});
