import { describe, expect, it } from 'vitest';
import { defaultTerrain, withTerrainDefaults, type TerrainChunkKey } from './terrain';
import { generateVegetationChunk } from './vegetation';
import { chunkWithinGrassRange, limitVegetation, VegetationChunkCache, vegetationBudget, vegetationChunkSignature, vegetationSignatures } from './vegetationCache';
import { chooseTreeSpecies, spacedTreeCandidates } from './vegetationRules';

const chunk = (x: number, z: number): TerrainChunkKey => ({ x, z, id: `${x}:${z}` });
const terrain = () => withTerrainDefaults({ ...defaultTerrain(), heightScale: 0, chunkSize: 8, foliage: { ...defaultTerrain().foliage, density: 0.3, treeDensity: 1, flowerDensity: 0.3 } });

describe('regional vegetation generation', () => {
  it('keeps placements identical regardless of generation order and a save/reload', () => {
    const t = terrain();
    const a = generateVegetationChunk(t, chunk(0, 0));
    generateVegetationChunk(t, chunk(-1, 0));
    const b = generateVegetationChunk(withTerrainDefaults(JSON.parse(JSON.stringify(t))), chunk(0, 0));
    expect(b).toEqual(a);
    expect(a.grass.length).toBeGreaterThan(0);
    expect(a.grassColors).toHaveLength(a.grass.length);
    expect(a.flowerColors).toHaveLength(a.flowers.length);
  });

  it('does not put foliage beyond the authored terrain at partial boundary chunks', () => {
    const t = withTerrainDefaults({ ...terrain(), size: 33, chunkSize: 16 });
    for (const key of [chunk(1, 0), chunk(-2, -1)]) {
      const data = generateVegetationChunk(t, key);
      for (const matrix of [...data.grass, ...data.flowers, ...data.treeModels]) {
        expect(Math.abs(matrix.elements[12])).toBeLessThanOrEqual(t.size / 2);
        expect(Math.abs(matrix.elements[14])).toBeLessThanOrEqual(t.size / 2);
      }
    }
  });

  it('honors painted exclusion and can generate only trees without grass work', () => {
    const t = withTerrainDefaults({ ...terrain(), foliage: { ...terrain().foliage, usePaintMask: true } });
    const blank = generateVegetationChunk(t, chunk(0, 0));
    expect(blank.grass).toHaveLength(0);
    expect(blank.flowers).toHaveLength(0);
    const treesOnly = generateVegetationChunk(terrain(), chunk(0, 0), { grass: false, flowers: false });
    expect(treesOnly.grass).toHaveLength(0);
    expect(treesOnly.flowers).toHaveLength(0);
  });

  it('keeps high density generation bounded even for large chunks', () => {
    const t = withTerrainDefaults({ ...terrain(), chunkSize: 512, size: 4096, foliage: { ...terrain().foliage, density: 1, treeDensity: 1, flowerDensity: 1 } });
    const data = generateVegetationChunk(t, chunk(0, 0));
    expect(data.grass.length).toBeLessThanOrEqual(8192);
    expect(data.treeModels.length).toBeLessThanOrEqual(256);
    expect(data.flowers.length).toBeLessThanOrEqual(2048);
  });

  it('respects elevation exclusions and assigns deterministic weighted species', () => {
    const base = withTerrainDefaults({ ...terrain(), chunkSize: 32 });
    const mixed = { ...base, foliage: { ...base.foliage, treeSpecies: [{ specId: 'oak', weight: 3 }, { specId: 'birch', weight: 1 }] } };
    const a = generateVegetationChunk(mixed, chunk(0, 0));
    expect(a.treeSpecies).toHaveLength(a.treeModels.length);
    expect(a.treeSpecies.every((id) => ['oak', 'birch'].includes(id))).toBe(true);
    expect(chooseTreeSpecies(mixed.foliage.treeSpecies, 0.74)).toBe('oak');
    expect(chooseTreeSpecies(mixed.foliage.treeSpecies, 0.76)).toBe('birch');
    const excluded = generateVegetationChunk({ ...mixed, foliage: { ...mixed.foliage, minElevation: 1 } }, chunk(0, 0));
    expect(excluded.grass.length + excluded.flowers.length + excluded.treeModels.length).toBe(0);
  });

  it('keeps tree spacing across neighboring chunk borders independent of generation order', () => {
    const base = withTerrainDefaults({ ...terrain(), size: 512, chunkSize: 32 });
    const t = { ...base, foliage: { ...base.foliage, treeSpacing: 10 } };
    const keys = [chunk(-1, 0), chunk(0, 0), chunk(1, 0), chunk(0, -1)];
    const points = keys.flatMap((key) => spacedTreeCandidates(t, key));
    expect(points.length).toBeGreaterThan(5);
    for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++) {
      expect(Math.hypot(points[a].x - points[b].x, points[a].z - points[b].z)).toBeGreaterThanOrEqual(10);
    }
    const sorted = (entries: typeof points) => entries.sort((a, b) => a.x - b.x || a.z - b.z);
    expect(sorted(keys.reverse().flatMap((key) => spacedTreeCandidates(t, key)))).toEqual(sorted(points));
  });
});

describe('vegetation cache and budgets', () => {
  it('reuses regions after camera reorder and wind changes, but refreshes a locally sculpted region', () => {
    const t = terrain(), a = chunk(0, 0), b = chunk(8, 8), cache = new VegetationChunkCache();
    const sig = vegetationSignatures(t);
    const first = cache.generate(t, a, vegetationChunkSignature(sig, a, {}), {});
    const far = cache.generate(t, b, vegetationChunkSignature(sig, b, {}), {});
    const windy = withTerrainDefaults({ ...t, editVersion: 11, foliage: { ...t.foliage, windStrength: 3, interactStrength: 0 } });
    const windySig = vegetationSignatures(windy);
    expect(cache.generate(windy, b, vegetationChunkSignature(windySig, b, {}), {})).toBe(far);
    expect(cache.generate(windy, a, vegetationChunkSignature(windySig, a, {}), {})).toBe(first);
    expect(cache.generations).toBe(2);
    const sculpted = withTerrainDefaults({ ...windy, heightOverrides: { '1:1': 4 }, editVersion: 12 });
    const editSig = vegetationSignatures(sculpted);
    expect(cache.generate(sculpted, b, vegetationChunkSignature(editSig, b, {}), {})).toBe(far);
    expect(cache.generate(sculpted, a, vegetationChunkSignature(editSig, a, {}), {})).not.toBe(first);
    expect(cache.generations).toBe(3);
  });

  it('includes every affected region when sample spacing exceeds chunk width', () => {
    const t = withTerrainDefaults({ ...terrain(), editSpacing: 16, heightOverrides: { '0:0': 3 } });
    const signatures = vegetationSignatures(t);
    for (let z = -2; z <= 1; z++) for (let x = -2; x <= 1; x++) expect(signatures.chunks.has(`${x}:${z}`)).toBe(true);
  });

  it('evicts old regions and regenerates them deterministically within memory bounds', () => {
    const t = terrain(), cache = new VegetationChunkCache(2, 50000), sig = vegetationSignatures(t);
    const a = chunk(0, 0), b = chunk(1, 0), c = chunk(2, 0);
    const data = cache.generate(t, a, vegetationChunkSignature(sig, a, {}), {});
    cache.generate(t, b, vegetationChunkSignature(sig, b, {}), {});
    cache.generate(t, c, vegetationChunkSignature(sig, c, {}), {});
    expect(cache.stats.chunks).toBe(2);
    expect(cache.get(a.id, vegetationChunkSignature(sig, a, {}))).toBeUndefined();
    expect(cache.generate(t, a, vegetationChunkSignature(sig, a, {}), {})).toEqual(data);
    cache.clear();
    expect(cache.stats.instances).toBe(0);
  });

  it('applies one global budget and keeps instance colors/transforms aligned', () => {
    const t = terrain(), data = generateVegetationChunk(t, chunk(0, 0));
    const budget = { grass: 7, flowers: 2, trees: 0 };
    const a = limitVegetation(data, budget), b = limitVegetation(data, budget);
    expect(a.grass.length + b.grass.length).toBe(7);
    expect(a.grassColors).toHaveLength(a.grass.length);
    expect(a.flowerColors).toHaveLength(a.flowers.length);
    expect(a.treeModels).toHaveLength(0);
    expect(a.trunks).toHaveLength(0);
    expect(vegetationBudget('Low').grass).toBeLessThan(vegetationBudget('High').grass);
  });

  it('tests the whole cell against fade distance, keeping intersecting cells', () => {
    const t = terrain();
    expect(chunkWithinGrassRange(t, chunk(1, 0), 0, 0, 9)).toBe(true);
    expect(chunkWithinGrassRange(t, chunk(2, 0), 0, 0, 9)).toBe(false);
  });
});

describe('natural blade coverage', () => {
  it('keeps painted rock clear in ground mode and retains grass on painted turf', () => {
    const base = withTerrainDefaults({ ...terrain(), materialDistribution: 'ground', foliage: {
      ...terrain().foliage, grassMesh: 'natural', density: 1,
    } });
    const painted = (layer: string) => {
      const paintOverrides: Record<string, string> = {};
      for (let z = -2; z <= 12; z++) for (let x = -2; x <= 12; x++) paintOverrides[`${x}:${z}`] = layer;
      return withTerrainDefaults({ ...base, paintOverrides });
    };
    expect(generateVegetationChunk(painted(base.materialLayers[0].id), chunk(0, 0)).grass.length).toBeGreaterThan(50);
    expect(generateVegetationChunk(painted(base.materialLayers[2].id), chunk(0, 0)).grass).toHaveLength(0);
  });

  it('keeps a deterministic subset when density changes and respects masks', () => {
    const make = (density: number) => withTerrainDefaults({ ...terrain(), foliage: {
      ...terrain().foliage, grassMesh: 'natural', density, minScale: 1, maxScale: 1,
    } });
    const dense = generateVegetationChunk(make(1), chunk(0, 0));
    const thin = generateVegetationChunk(make(0.3), chunk(0, 0));
    const key = (m: typeof dense.grass[number]) => `${m.elements[12]}:${m.elements[14]}`;
    const locations = new Set(dense.grass.map(key));
    expect(thin.grass.length).toBeGreaterThan(0);
    expect(dense.grass.length).toBeGreaterThan(thin.grass.length * 2);
    expect(thin.grass.every((m) => locations.has(key(m)))).toBe(true);
    expect(generateVegetationChunk(make(1), chunk(0, 0))).toEqual(dense);
    const masked = make(1); masked.foliage.usePaintMask = true;
    expect(generateVegetationChunk(masked, chunk(0, 0)).grass).toHaveLength(0);
  });

  it('covers chunk borders without duplicate candidates and obeys the large-chunk cap', () => {
    const t = withTerrainDefaults({ ...terrain(), foliage: { ...terrain().foliage, grassMesh: 'natural', density: 1 } });
    const a = generateVegetationChunk(t, chunk(0, 0));
    const b = generateVegetationChunk(t, chunk(1, 0));
    const points = [...a.grass, ...b.grass].map((m) => `${m.elements[12]}:${m.elements[14]}`);
    expect(new Set(points).size).toBe(points.length);
    expect(a.grass.some((m) => m.elements[12] > 7.4)).toBe(true);
    expect(b.grass.some((m) => m.elements[12] < 8.6)).toBe(true);
    const huge = withTerrainDefaults({ ...t, chunkSize: 512, size: 2048 });
    expect(generateVegetationChunk(huge, chunk(0, 0)).grass.length).toBeLessThanOrEqual(8192);
  });
});
