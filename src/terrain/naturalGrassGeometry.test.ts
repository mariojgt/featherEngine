import { afterEach, describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import {
  createNaturalGrassGeometry,
  NATURAL_GRASS_DEFAULTS,
  NATURAL_GRASS_GEOMETRY_COST,
} from './naturalGrassGeometry';

const owned: BufferGeometry[] = [];
const makeGeometry = (options?: Parameters<typeof createNaturalGrassGeometry>[0]) => {
  const geometry = createNaturalGrassGeometry(options);
  owned.push(geometry);
  return geometry;
};

afterEach(() => {
  owned.splice(0).forEach((geometry) => geometry.dispose());
});

describe('natural grass patch geometry', () => {
  it('keeps its default real-blade cost explicit and bounded', () => {
    const geometry = makeGeometry();
    expect(NATURAL_GRASS_GEOMETRY_COST).toMatchObject({ blades: 24, vertices: 168, triangles: 120 });
    expect(geometry.getAttribute('position').count).toBe(NATURAL_GRASS_GEOMETRY_COST.vertices);
    expect(geometry.getIndex()!.count / 3).toBe(NATURAL_GRASS_GEOMETRY_COST.triangles);
    expect(geometry.getAttribute('normal').count).toBe(NATURAL_GRASS_GEOMETRY_COST.vertices);
    expect(geometry.getAttribute('uv').count).toBe(NATURAL_GRASS_GEOMETRY_COST.vertices);
    expect(geometry.getAttribute('bladeRoot').itemSize).toBe(2);
    expect(geometry.getAttribute('bladeRandom').itemSize).toBe(1);
  });

  it('is deterministic for a seed and varies for another seed', () => {
    const first = makeGeometry({ seed: 42 });
    const repeat = makeGeometry({ seed: 42 });
    const changed = makeGeometry({ seed: 43 });
    expect(Array.from(first.getAttribute('position').array)).toEqual(Array.from(repeat.getAttribute('position').array));
    expect(Array.from(first.getAttribute('bladeRandom').array)).toEqual(Array.from(repeat.getAttribute('bladeRandom').array));
    expect(Array.from(changed.getAttribute('position').array)).not.toEqual(Array.from(first.getAttribute('position').array));
  });

  it('builds narrow rooted ribbons with curved, tapered tips inside conservative patch bounds', () => {
    const geometry = makeGeometry();
    const position = geometry.getAttribute('position');
    const root = geometry.getAttribute('bladeRoot');
    const verticesPerBlade = NATURAL_GRASS_DEFAULTS.segments * 2 + 1;
    let curvedBlades = 0;

    for (let blade = 0; blade < NATURAL_GRASS_DEFAULTS.bladeCount; blade += 1) {
      const first = blade * verticesPerBlade;
      const apex = first + verticesPerBlade - 1;
      expect(position.getY(first)).toBe(0);
      expect(position.getY(first + 1)).toBe(0);
      expect(position.getY(apex)).toBeGreaterThanOrEqual(NATURAL_GRASS_DEFAULTS.minHeight);
      expect(position.getY(apex)).toBeLessThanOrEqual(NATURAL_GRASS_DEFAULTS.maxHeight);
      const rootWidth = Math.hypot(position.getX(first + 1) - position.getX(first), position.getZ(first + 1) - position.getZ(first));
      expect(rootWidth).toBeGreaterThanOrEqual(NATURAL_GRASS_DEFAULTS.minBladeWidth - 1e-6);
      expect(rootWidth).toBeLessThanOrEqual(NATURAL_GRASS_DEFAULTS.maxBladeWidth + 1e-6);
      const tipOffset = Math.hypot(position.getX(apex) - root.getX(apex), position.getZ(apex) - root.getY(apex));
      if (tipOffset > 0.005) curvedBlades += 1;
    }

    expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
    expect(curvedBlades).toBeGreaterThan(NATURAL_GRASS_DEFAULTS.bladeCount / 2);
    expect(geometry.boundingBox).not.toBeNull();
    expect(geometry.boundingBox!.min.y).toBe(0);
    expect(geometry.boundingBox!.max.y).toBeLessThanOrEqual(NATURAL_GRASS_DEFAULTS.maxHeight);
    const halfPatch = NATURAL_GRASS_DEFAULTS.patchWidth / 2;
    expect(Math.max(Math.abs(geometry.boundingBox!.min.x), Math.abs(geometry.boundingBox!.max.x))).toBeLessThanOrEqual(halfPatch);
    expect(Math.max(Math.abs(geometry.boundingBox!.min.z), Math.abs(geometry.boundingBox!.max.z))).toBeLessThanOrEqual(halfPatch);
  });

  it('supports a lower-cost quality shape and rejects invalid ranges', () => {
    const geometry = makeGeometry({ bladeCount: 6, segments: 3, seed: 9 });
    expect(geometry.getAttribute('position').count).toBe(42);
    expect(geometry.getIndex()!.count / 3).toBe(30);
    expect(() => createNaturalGrassGeometry({ segments: 1 })).toThrow(/segments/);
    expect(() => createNaturalGrassGeometry({ minHeight: 1, maxHeight: 0.5 })).toThrow(/maxHeight/);
    expect(() => createNaturalGrassGeometry({ patchWidth: Number.NaN })).toThrow(/patchWidth/);
  });
});
