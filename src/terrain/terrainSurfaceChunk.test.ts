import { describe, expect, it } from 'vitest';
import {
  autoTerrainMaterialWeights,
  buildTerrainChunkTrimesh,
  defaultTerrain,
  normalizeTerrainLayerWeights,
  sampleTerrainLayerWeights,
  withTerrainDefaults,
} from './terrain';
import { buildTerrainChunkGeometryData } from './terrainGeometry';
import { terrainChunkLodSegments, terrainChunkSignatures } from './terrainChunks';

describe('terrain surface blending', () => {
  it('normalizes malformed weights and preserves safe legacy layer controls', () => {
    expect(normalizeTerrainLayerWeights([2, -3, Number.NaN, 2])).toEqual([0.5, 0, 0, 0.5]);
    expect(normalizeTerrainLayerWeights([0, 0, 0])).toEqual([1, 0, 0]);
    const terrain = withTerrainDefaults({
      materialLayers: Array.from({ length: 10 }, (_, index) => ({
        id: `layer-${index}`,
        name: `Layer ${index}`,
        color: '#ffffff',
        textureScale: index === 0 ? -4 : undefined,
        normalStrength: index === 1 ? 99 : undefined,
        roughness: index === 2 ? -2 : undefined,
      })),
    });
    expect(terrain.materialLayers).toHaveLength(8);
    expect(terrain.materialLayers[0].textureScale).toBe(0.25);
    expect(terrain.materialLayers[1].normalStrength).toBe(4);
    expect(terrain.materialLayers[2].roughness).toBe(0);
    expect(terrain.materialLayers[3]).toMatchObject({ textureScale: 8, normalStrength: 1, roughness: 0.92 });
  });

  it('smoothly blends painted cells across all eight layers and keeps every sample normalized', () => {
    const terrain = withTerrainDefaults({
      heightScale: 0,
      editSpacing: 2,
      materialLayers: Array.from({ length: 8 }, (_, index) => ({
        id: `layer-${index}`,
        name: `Layer ${index}`,
        color: '#ffffff',
      })),
      paintOverrides: { '0:0': 'layer-7' },
    });
    const center = sampleTerrainLayerWeights(terrain, 0, 0, 0, 1);
    expect(center[7]).toBe(1);
    expect(center.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1);
    const edge = sampleTerrainLayerWeights(terrain, 1, 0, 0, 1);
    expect(edge[7]).toBeGreaterThan(0);
    expect(edge[7]).toBeLessThan(1);
    expect(edge.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1);
  });

  it('uses a smooth slope-aware rock blend instead of a hard material threshold', () => {
    const terrain = defaultTerrain();
    const flat = autoTerrainMaterialWeights(terrain, 0, 0.9);
    const transition = autoTerrainMaterialWeights(terrain, 0, 0.62);
    const steep = autoTerrainMaterialWeights(terrain, 0, 0.3);
    expect(transition[2]).toBeGreaterThan(flat[2]);
    expect(transition[2]).toBeLessThan(steep[2]);
    expect(transition.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1);
  });

  it('creates deterministic world-space grass and soil patches with smooth normalized changes', () => {
    const terrain = withTerrainDefaults({ materialDistribution: 'ground', seed: 8741, heightScale: 20 });
    const samples = Array.from({ length: 17 }, (_, index) =>
      autoTerrainMaterialWeights(terrain, 0, 1, -128 + index * 16, 37));
    const repeated = Array.from({ length: 17 }, (_, index) =>
      autoTerrainMaterialWeights(terrain, 0, 1, -128 + index * 16, 37));

    expect(repeated).toEqual(samples);
    expect(Math.max(...samples.map((weights) => weights[1])) - Math.min(...samples.map((weights) => weights[1]))).toBeGreaterThan(0.25);
    for (const weights of samples) {
      expect(weights.every((weight) => Number.isFinite(weight) && weight >= 0 && weight <= 1)).toBe(true);
      expect(weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1);
    }

    const adjacent = Array.from({ length: 25 }, (_, index) =>
      autoTerrainMaterialWeights(terrain, 0, 1, index * 0.5, -19)[1]);
    expect(Math.max(...adjacent.slice(1).map((weight, index) => Math.abs(weight - adjacent[index])))).toBeLessThan(0.08);
  });

  it('keeps legacy height distribution independent of the new optional coordinates', () => {
    const terrain = withTerrainDefaults({ materialDistribution: 'height', heightScale: 20 });
    const legacyCall = autoTerrainMaterialWeights(terrain, 4, 0.77);
    expect(autoTerrainMaterialWeights(terrain, 4, 0.77, -900, 1200)).toEqual(legacyCall);
  });

  it('keeps ground weights identical on a chunk seam and transitions continuously into rock', () => {
    const terrain = withTerrainDefaults({ materialDistribution: 'ground', seed: 91, chunkSize: 32, heightScale: 20 });
    const left = buildTerrainChunkGeometryData(terrain, 0, 0, terrain.resolution);
    const right = buildTerrainChunkGeometryData(terrain, 1, 0, terrain.resolution);
    const side = terrain.resolution + 1;
    for (let z = 0; z < side; z += 1) {
      const leftOffset = (z * side + terrain.resolution) * 4;
      const rightOffset = z * side * 4;
      expect(Array.from(left.weightsA.slice(leftOffset, leftOffset + 4)))
        .toEqual(Array.from(right.weightsA.slice(rightOffset, rightOffset + 4)));
    }

    const rock = [1, 0.84, 0.76, 0.68, 0.6, 0.52].map((normalY) =>
      autoTerrainMaterialWeights(terrain, 0, normalY, 12, 18)[2]);
    expect(rock[0]).toBe(0);
    expect(rock[2]).toBeGreaterThan(0);
    expect(rock[2]).toBeLessThan(1);
    for (let index = 1; index < rock.length; index += 1) expect(rock[index]).toBeGreaterThanOrEqual(rock[index - 1]);
    expect(rock.at(-1)).toBeCloseTo(1);
  });
});

describe('terrain chunk invalidation and LOD', () => {
  it('ignores global editVersion and foliage in geometry signatures while bucketing wide edits through every chunk', () => {
    const base = withTerrainDefaults({ chunkSize: 8, editSpacing: 16, resolution: 8 });
    const cosmetic = withTerrainDefaults({
      ...base,
      editVersion: 400,
      foliage: { ...base.foliage, density: 0.99 },
    });
    expect(terrainChunkSignatures(cosmetic).geometryBase).toBe(terrainChunkSignatures(base).geometryBase);

    const edited = withTerrainDefaults({ ...base, heightOverrides: { '0:0': 5 }, paintOverrides: { '0:0': base.materialLayers[1].id } });
    const signatures = terrainChunkSignatures(edited);
    for (const x of [-2, -1, 0, 1, 2]) {
      expect(signatures.surfaceChunks.has(`${x}:0`)).toBe(true);
    }
    expect(signatures.geometryChunks.has('1:0')).toBe(true);
  });

  it('shares exact height-sampled normals at chunk borders across different LOD levels and adds skirts', () => {
    const terrain = withTerrainDefaults({ ...defaultTerrain(), resolution: 18, heightScale: 24 });
    const fine = buildTerrainChunkGeometryData(terrain, 0, 0, 18);
    const coarse = buildTerrainChunkGeometryData(terrain, 1, 0, 9);
    for (let z = 0; z <= 9; z += 1) {
      const fineIndex = (z * 2) * 19 + 18;
      const coarseIndex = z * 10;
      expect(fine.positions[fineIndex * 3 + 1]).toBe(coarse.positions[coarseIndex * 3 + 1]);
      expect(Array.from(fine.normals.slice(fineIndex * 3, fineIndex * 3 + 3)))
        .toEqual(Array.from(coarse.normals.slice(coarseIndex * 3, coarseIndex * 3 + 3)));
    }
    expect(fine.positions.length / 3).toBeGreaterThan(fine.surfaceVertexCount);
    expect(fine.indices.length).toBe(18 * 18 * 6 + 4 * 18 * 6);
    const physics = buildTerrainChunkTrimesh(terrain, 0, 0);
    expect(Array.from(fine.positions.slice(0, fine.surfaceVertexCount * 3))).toEqual(Array.from(physics.vertices));
    expect(Array.from(fine.indices.slice(0, physics.indices.length))).toEqual(Array.from(physics.indices));
  });

  it('retains authored resolution through the physics/editing range and reduces only distant rendering', () => {
    const terrain = withTerrainDefaults({ resolution: 18, physicsRadius: 2 });
    expect(terrainChunkLodSegments(terrain, 0)).toBe(18);
    expect(terrainChunkLodSegments(terrain, 2)).toBe(18);
    expect(terrainChunkLodSegments(terrain, 3)).toBe(9);
    expect(terrainChunkLodSegments(terrain, 6)).toBe(5);
    expect(terrainChunkLodSegments(terrain, 9, true)).toBe(18);
  });

  it('stitches every fine border point even when coarse resolution is not a divisor and sculpting is steep', () => {
    const terrain = withTerrainDefaults({ resolution: 18, heightScale: 0, heightOverrides: { '16:5': 120, '16:6': -40 } });
    const fine = buildTerrainChunkGeometryData(terrain, 0, 0, 18);
    const coarse = buildTerrainChunkGeometryData(terrain, 1, 0, 5);
    for (let z = 0; z <= 18; z++) {
      const offset = (z * 19 + 18) * 3;
      const matches: number[] = [];
      for (let i = 0; i < coarse.positions.length; i += 3) {
        if (coarse.positions[i] === fine.positions[offset] && coarse.positions[i + 2] === fine.positions[offset + 2]) matches.push(i);
      }
      expect(matches.length).toBeGreaterThan(0);
      expect(coarse.positions[matches[0] + 1]).toBe(fine.positions[offset + 1]);
    }
    expect(coarse.indices.length).toBeLessThan(fine.indices.length);
  });
});


it('interpolates lighting and material attributes continuously at non-divisor LOD borders', () => {
  const terrain = withTerrainDefaults({ resolution: 18, chunkSize: 32, heightScale: 18, editSpacing: 2, heightOverrides: { '16:2': 26 }, paintOverrides: { '16:3': 'rock' } });
  const fine = buildTerrainChunkGeometryData(terrain, 0, 0, 18);
  const coarse = buildTerrainChunkGeometryData(terrain, 1, 0, 5);
  for (let z = 1; z < 5; z++) {
    const fraction = z / 5 * 18, low = Math.floor(fraction), t = fraction - low;
    for (const [attribute, size] of [['normals', 3], ['weightsA', 4], ['weightsB', 4]] as const) {
      for (let c = 0; c < size; c++) {
        const a = fine[attribute][(low * 19 + 18) * size + c], b = fine[attribute][((low + 1) * 19 + 18) * size + c];
        expect(coarse[attribute][z * 6 * size + c]).toBeCloseTo(a + (b - a) * t, 5);
      }
    }
  }
});

it('keeps grassy ground on mild slopes, exposes cliffs, and retains explicit paint', () => {
  const terrain = withTerrainDefaults({ materialDistribution: 'ground', heightScale: 20, paintOverrides: { '0:0': 'terrain-meadow' } });
  const flat = autoTerrainMaterialWeights(terrain, 0, 1);
  expect(flat[0]).toBeGreaterThan(0);
  expect(flat[1]).toBeGreaterThan(0);
  expect(flat[2]).toBe(0);
  expect(flat.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1);
  expect(autoTerrainMaterialWeights(terrain, 0, 0.5)).toEqual([0, 0, 1]);
  expect(sampleTerrainLayerWeights(terrain, 0, 0, 0, 1)).toEqual([0, 1, 0]);
  const legacy = withTerrainDefaults({ ...terrain, materialDistribution: 'height' });
  expect(terrainChunkSignatures(legacy).surfaceBase).not.toBe(terrainChunkSignatures(terrain).surfaceBase);
  expect(terrainChunkSignatures(legacy).geometryBase).toBe(terrainChunkSignatures(terrain).geometryBase);
});
