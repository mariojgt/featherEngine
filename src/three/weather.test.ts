import { expect, it } from 'vitest';
import { withSceneEnvironmentDefaults } from './environmentSettings';
import { consumeClothSteps, type ClothClock } from './clothClock';
import { createRainGeometry } from './SceneWeather';
import { advanceWeatherDrift } from './weatherMotion';

it('changes wind without jumping the weather field and resets drift on replay', () => {
  const drift = { x: 0, z: 0 };
  advanceWeatherDrift(drift, 5, 2, 1);
  expect(drift).toMatchObject({ x: 10, z: 5 });
  advanceWeatherDrift(drift, 5, 20, -5);
  expect(drift).toMatchObject({ x: 10, z: 5 });
  advanceWeatherDrift(drift, 6, 20, -5);
  expect(drift).toMatchObject({ x: 30, z: 0 });
  advanceWeatherDrift(drift, 0, 20, -5);
  expect(drift).toMatchObject({ x: 0, z: 0 });
});

it('keeps legacy scenes dry and bounds malformed weather values', () => {
  const legacy = withSceneEnvironmentDefaults();
  expect(legacy.cloudCoverage).toBe(0); expect(legacy.rainIntensity).toBe(0); expect(legacy.lightningFlash).toBe(0);
  const bad = withSceneEnvironmentDefaults({ cloudCoverage: 4, rainIntensity: -1, lightningFlash: NaN, cloudSpeed: Infinity });
  expect(bad.cloudCoverage).toBe(1); expect(bad.rainIntensity).toBe(0); expect(bad.lightningFlash).toBe(0); expect(bad.cloudSpeed).toBe(0.35);
});

it('advances cloth by simulation time, independent of render frequency and repeated paused renders', () => {
  for (const fps of [24, 30, 60, 120]) {
    const clock: ClothClock = { remainder: 0 }; let steps = 0;
    consumeClothSteps(clock, 0);
    for (let i = 1; i <= fps * 70; i++) {
      steps += consumeClothSteps(clock, i / fps);
      expect(consumeClothSteps(clock, i / fps)).toBe(0);
    }
    expect(steps).toBe(4200);
    expect(consumeClothSteps(clock, 0)).toBe(0);
    expect(consumeClothSteps(clock, 100)).toBe(12);
  }
});

it('creates bounded repeatable rain seeds without per-frame geometry allocation', () => {
  const a = createRainGeometry(100), b = createRainGeometry(100);
  expect(a.attributes.position.count).toBe(200);
  expect([...a.attributes.dropSeed.array]).toEqual([...b.attributes.dropSeed.array]);
  expect([...a.attributes.dropSeed.array].every(n => n >= 0 && n < 1)).toBe(true);
  for (let i = 0; i < 100; i++) {
    expect(a.attributes.position.getY(i * 2)).toBe(0); expect(a.attributes.position.getY(i * 2 + 1)).toBe(1);
    expect(a.attributes.dropSeed.getX(i * 2)).toBe(a.attributes.dropSeed.getX(i * 2 + 1));
  }
  a.dispose(); b.dispose();
});
