import type {
  SceneObject,
  TerrainComponent,
  TerrainFoliageComponent,
  TerrainMaterialLayer,
  TerrainSculptOperation,
  Vector3Tuple,
} from '../types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clampInt = (value: number, min: number, max: number) => Math.trunc(clamp(Number.isFinite(value) ? value : min, min, max));
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const defaultTerrainFoliage = (): TerrainFoliageComponent => ({
  enabled: true,
  mode: 'mixed',
  density: 0.34,
  treeDensity: 0.12,
  minScale: 0.75,
  maxScale: 1.65,
  slopeLimit: 0.68,
  grassMesh: 'blade',
  treeMesh: 'cone',
  grassColor: '#4f9b48',
  trunkColor: '#6b4a2f',
  treeColor: '#2f7d45',
});

export const defaultTerrainMaterialLayers = (): TerrainMaterialLayer[] => [
  { id: 'terrain-grass', name: 'Grass', color: '#496f38' },
  { id: 'terrain-meadow', name: 'Meadow', color: '#6f8f4f' },
  { id: 'terrain-rock', name: 'Rock', color: '#b6b09a' },
];

export const defaultTerrain = (): TerrainComponent => ({
  enabled: true,
  size: 512,
  chunkSize: 32,
  resolution: 18,
  streamRadius: 4,
  physicsRadius: 2,
  seed: 1337,
  heightScale: 8,
  frequency: 0.018,
  octaves: 4,
  persistence: 0.5,
  lacunarity: 2,
  editSpacing: 2,
  lowColor: '#496f38',
  midColor: '#6f8f4f',
  highColor: '#b6b09a',
  materialLayers: defaultTerrainMaterialLayers(),
  heightOverrides: {},
  paintOverrides: {},
  foliage: defaultTerrainFoliage(),
});

// Normalizing a terrain config re-sanitizes its (potentially huge) height/paint override records, which is
// far too expensive to redo on every height sample during Play. Store objects are immutable — a terrain edit
// produces a new component reference — so memoize the normalized result by input reference: we normalize once
// per edit instead of once per sample (the runtime's terrain-following vehicle/character passes hammer this).
const terrainDefaultsCache = new WeakMap<object, TerrainComponent>();

export function withTerrainDefaults(terrain?: Partial<TerrainComponent>): TerrainComponent {
  if (terrain) {
    const cached = terrainDefaultsCache.get(terrain);
    if (cached) return cached;
  }
  const normalized = normalizeTerrainDefaults(terrain);
  if (terrain) terrainDefaultsCache.set(terrain, normalized);
  return normalized;
}

function normalizeTerrainDefaults(terrain?: Partial<TerrainComponent>): TerrainComponent {
  const base = defaultTerrain();
  const foliage = { ...base.foliage, ...(terrain?.foliage ?? {}) };
  const size = clamp(terrain?.size ?? base.size, 32, 8192);
  const chunkSize = clamp(terrain?.chunkSize ?? base.chunkSize, 8, Math.max(8, size));
  const lowColor = terrain?.lowColor ?? base.lowColor;
  const midColor = terrain?.midColor ?? base.midColor;
  const highColor = terrain?.highColor ?? base.highColor;
  const materialLayers = normalizeTerrainMaterialLayers(terrain?.materialLayers, [lowColor, midColor, highColor]);
  return {
    ...base,
    ...terrain,
    enabled: terrain?.enabled ?? base.enabled,
    size,
    chunkSize,
    resolution: clampInt(terrain?.resolution ?? base.resolution, 4, 64),
    streamRadius: clampInt(terrain?.streamRadius ?? base.streamRadius, 1, 10),
    physicsRadius: clampInt(terrain?.physicsRadius ?? base.physicsRadius, 1, 5),
    seed: Math.trunc(terrain?.seed ?? base.seed),
    heightScale: clamp(terrain?.heightScale ?? base.heightScale, 0, 256),
    frequency: clamp(terrain?.frequency ?? base.frequency, 0.001, 0.25),
    octaves: clampInt(terrain?.octaves ?? base.octaves, 1, 8),
    persistence: clamp(terrain?.persistence ?? base.persistence, 0.05, 0.95),
    lacunarity: clamp(terrain?.lacunarity ?? base.lacunarity, 1.1, 4),
    editSpacing: clamp(terrain?.editSpacing ?? base.editSpacing, 0.5, 16),
    lowColor,
    midColor,
    highColor,
    materialLayers,
    heightOverrides: sanitizeNumberRecord(terrain?.heightOverrides),
    paintOverrides: sanitizeStringRecord(terrain?.paintOverrides),
    foliage: {
      ...foliage,
      density: clamp(foliage.density, 0, 1),
      treeDensity: clamp(foliage.treeDensity, 0, 1),
      minScale: clamp(foliage.minScale, 0.1, 12),
      maxScale: clamp(Math.max(foliage.maxScale, foliage.minScale), 0.1, 16),
      slopeLimit: clamp(foliage.slopeLimit, 0, 1),
      grassMesh: foliage.grassMesh ?? base.foliage.grassMesh,
      treeMesh: foliage.treeMesh ?? base.foliage.treeMesh,
      grassModelAssetId: foliage.grassModelAssetId || undefined,
      treeModelAssetId: foliage.treeModelAssetId || undefined,
    },
  };
}

function normalizeTerrainMaterialLayers(
  layers: TerrainMaterialLayer[] | undefined,
  fallbackColors: [string, string, string],
): TerrainMaterialLayer[] {
  const defaults = defaultTerrainMaterialLayers();
  const source = layers?.length
    ? layers
    : defaults.map((layer, index) => ({ ...layer, color: fallbackColors[index] ?? layer.color }));
  const seen = new Set<string>();
  return source.slice(0, 8).map((layer, index) => {
    const fallback = defaults[index] ?? { id: `terrain-layer-${index + 1}`, name: `Layer ${index + 1}`, color: fallbackColors[index] ?? '#ffffff' };
    const rawId = String(layer.id || fallback.id || `terrain-layer-${index + 1}`).trim();
    const id = seen.has(rawId) ? `${rawId}-${index + 1}` : rawId;
    seen.add(id);
    return {
      id,
      name: String(layer.name || fallback.name || `Layer ${index + 1}`),
      color: layer.color || fallback.color || '#ffffff',
      textureAssetId: layer.textureAssetId || undefined,
      normalMapAssetId: layer.normalMapAssetId || undefined,
    };
  });
}

function sanitizeNumberRecord(record?: Record<string, number>): Record<string, number> {
  if (!record) return {};
  return Object.fromEntries(Object.entries(record).filter(([, value]) => Number.isFinite(value)));
}

function sanitizeStringRecord(record?: Record<string, string>): Record<string, string> {
  if (!record) return {};
  return Object.fromEntries(Object.entries(record).filter(([, value]) => typeof value === 'string' && value.length > 0));
}

export function terrainHash01(seed: number, a: number, b: number, c = 0): number {
  let n = Math.imul(Math.trunc(a), 374761393) ^ Math.imul(Math.trunc(b), 668265263) ^ Math.imul(Math.trunc(c), 2246822519) ^ Math.trunc(seed);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function valueNoise2(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smoothstep(x - ix);
  const fz = smoothstep(z - iz);
  const a = terrainHash01(seed, ix, iz);
  const b = terrainHash01(seed, ix + 1, iz);
  const c = terrainHash01(seed, ix, iz + 1);
  const d = terrainHash01(seed, ix + 1, iz + 1);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
}

export function terrainEditKey(ix: number, iz: number): string {
  return `${ix}:${iz}`;
}

export function terrainEditIndex(input: TerrainComponent | Partial<TerrainComponent>, localX: number, localZ: number) {
  const terrain = withTerrainDefaults(input);
  return {
    x: Math.round(localX / terrain.editSpacing),
    z: Math.round(localZ / terrain.editSpacing),
  };
}

function overrideAt(record: Record<string, number>, ix: number, iz: number): number | undefined {
  const value = record[terrainEditKey(ix, iz)];
  return Number.isFinite(value) ? value : undefined;
}

// True if the record has no own keys. `Object.keys(record).length === 0` allocated a full
// key array on EVERY height sample — for a terrain with many sculpt overrides that array build
// dominated chunk generation (the "multi-minute load freeze"). `for…in` with an early return
// is O(1) and allocates nothing.
function isRecordEmpty(record: Record<string, number>): boolean {
  for (const _key in record) return false;
  return true;
}

export function sampleBaseTerrainLocalHeight(input: TerrainComponent | Partial<TerrainComponent>, localX: number, localZ: number): number {
  const terrain = withTerrainDefaults(input);
  let frequency = terrain.frequency;
  let amplitude = 1;
  let total = 0;
  let sum = 0;
  for (let octave = 0; octave < terrain.octaves; octave += 1) {
    const n = valueNoise2(localX * frequency, localZ * frequency, terrain.seed + octave * 1013) * 2 - 1;
    sum += n * amplitude;
    total += amplitude;
    amplitude *= terrain.persistence;
    frequency *= terrain.lacunarity;
  }
  const edge = terrain.size * 0.5;
  const fade = clamp((edge - Math.max(Math.abs(localX), Math.abs(localZ))) / Math.max(terrain.chunkSize, 1), 0, 1);
  return (sum / Math.max(total, 0.0001)) * terrain.heightScale * smoothstep(fade);
}

export function sampleTerrainLocalHeight(input: TerrainComponent | Partial<TerrainComponent>, localX: number, localZ: number): number {
  const terrain = withTerrainDefaults(input);
  if (isRecordEmpty(terrain.heightOverrides)) return sampleBaseTerrainLocalHeight(terrain, localX, localZ);

  const gx = localX / terrain.editSpacing;
  const gz = localZ / terrain.editSpacing;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const tx = smoothstep(gx - ix);
  const tz = smoothstep(gz - iz);
  const samples = [
    overrideAt(terrain.heightOverrides, ix, iz),
    overrideAt(terrain.heightOverrides, ix + 1, iz),
    overrideAt(terrain.heightOverrides, ix, iz + 1),
    overrideAt(terrain.heightOverrides, ix + 1, iz + 1),
  ];
  if (samples.every((value) => value === undefined)) return sampleBaseTerrainLocalHeight(terrain, localX, localZ);
  const h00 = samples[0] ?? sampleBaseTerrainLocalHeight(terrain, ix * terrain.editSpacing, iz * terrain.editSpacing);
  const h10 = samples[1] ?? sampleBaseTerrainLocalHeight(terrain, (ix + 1) * terrain.editSpacing, iz * terrain.editSpacing);
  const h01 = samples[2] ?? sampleBaseTerrainLocalHeight(terrain, ix * terrain.editSpacing, (iz + 1) * terrain.editSpacing);
  const h11 = samples[3] ?? sampleBaseTerrainLocalHeight(terrain, (ix + 1) * terrain.editSpacing, (iz + 1) * terrain.editSpacing);
  return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
}

export function autoTerrainMaterialLayerId(
  input: TerrainComponent | Partial<TerrainComponent>,
  height: number,
  normalY: number,
): string {
  const terrain = withTerrainDefaults(input);
  const layers = terrain.materialLayers.length ? terrain.materialLayers : defaultTerrainMaterialLayers();
  const low = layers[0]?.id ?? 'terrain-grass';
  const mid = layers[Math.min(1, layers.length - 1)]?.id ?? low;
  const high = layers[Math.min(2, layers.length - 1)]?.id ?? mid;
  if (normalY < 0.62) return high;
  const t = clamp((height / Math.max(terrain.heightScale, 0.001) + 1) * 0.5, 0, 1);
  if (t < 0.48) return low;
  if (t < 0.72) return mid;
  return high;
}

export function sampleTerrainMaterialLayerId(
  input: TerrainComponent | Partial<TerrainComponent>,
  localX: number,
  localZ: number,
  height = sampleTerrainLocalHeight(input, localX, localZ),
  normalY = sampleTerrainNormal(input, localX, localZ)[1],
): string {
  const terrain = withTerrainDefaults(input);
  const { x, z } = terrainEditIndex(terrain, localX, localZ);
  const painted = terrain.paintOverrides[terrainEditKey(x, z)];
  if (painted && terrain.materialLayers.some((layer) => layer.id === painted)) return painted;
  return autoTerrainMaterialLayerId(terrain, height, normalY);
}

export function sampleTerrainMaterialLayer(
  input: TerrainComponent | Partial<TerrainComponent>,
  localX: number,
  localZ: number,
  height?: number,
  normalY?: number,
): TerrainMaterialLayer {
  const terrain = withTerrainDefaults(input);
  const id = sampleTerrainMaterialLayerId(terrain, localX, localZ, height, normalY);
  return terrain.materialLayers.find((layer) => layer.id === id) ?? terrain.materialLayers[0] ?? defaultTerrainMaterialLayers()[0];
}

export function sampleTerrainNormal(input: TerrainComponent | Partial<TerrainComponent>, localX: number, localZ: number): Vector3Tuple {
  const terrain = withTerrainDefaults(input);
  const e = Math.max(terrain.chunkSize / Math.max(terrain.resolution, 1), 0.5);
  const left = sampleTerrainLocalHeight(terrain, localX - e, localZ);
  const right = sampleTerrainLocalHeight(terrain, localX + e, localZ);
  const down = sampleTerrainLocalHeight(terrain, localX, localZ - e);
  const up = sampleTerrainLocalHeight(terrain, localX, localZ + e);
  const nx = left - right;
  const ny = 2 * e;
  const nz = down - up;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

export interface TerrainSculptOptions {
  operation: TerrainSculptOperation;
  radius: number;
  strength: number;
  flattenHeight?: number;
}

export interface TerrainPaintOptions {
  radius: number;
  layerId: string;
}

function localPointInsideTerrain(terrain: TerrainComponent, localX: number, localZ: number): boolean {
  const half = terrain.size * 0.5;
  return localX >= -half && localX <= half && localZ >= -half && localZ <= half;
}

function brushFalloff(distance: number, radius: number): number {
  return 1 - smoothstep(clamp(distance / Math.max(radius, 0.001), 0, 1));
}

function averageNeighborHeight(terrain: TerrainComponent, localX: number, localZ: number): number {
  const spacing = terrain.editSpacing;
  let total = 0;
  let count = 0;
  for (let z = -1; z <= 1; z += 1) {
    for (let x = -1; x <= 1; x += 1) {
      if (x === 0 && z === 0) continue;
      total += sampleTerrainLocalHeight(terrain, localX + x * spacing, localZ + z * spacing);
      count += 1;
    }
  }
  return count ? total / count : sampleTerrainLocalHeight(terrain, localX, localZ);
}

export function applyTerrainSculpt(
  input: TerrainComponent | Partial<TerrainComponent>,
  localX: number,
  localZ: number,
  options: TerrainSculptOptions,
): TerrainComponent {
  const terrain = withTerrainDefaults(input);
  if (!localPointInsideTerrain(terrain, localX, localZ)) return terrain;
  const radius = clamp(options.radius, terrain.editSpacing, 256);
  const strength = clamp(options.strength, 0, 64);
  const minX = Math.floor((localX - radius) / terrain.editSpacing);
  const maxX = Math.ceil((localX + radius) / terrain.editSpacing);
  const minZ = Math.floor((localZ - radius) / terrain.editSpacing);
  const maxZ = Math.ceil((localZ + radius) / terrain.editSpacing);
  const nextOverrides = { ...terrain.heightOverrides };

  for (let iz = minZ; iz <= maxZ; iz += 1) {
    for (let ix = minX; ix <= maxX; ix += 1) {
      const sampleX = ix * terrain.editSpacing;
      const sampleZ = iz * terrain.editSpacing;
      if (!localPointInsideTerrain(terrain, sampleX, sampleZ)) continue;
      const distance = Math.hypot(sampleX - localX, sampleZ - localZ);
      if (distance > radius) continue;
      const falloff = brushFalloff(distance, radius);
      const current = sampleTerrainLocalHeight(terrain, sampleX, sampleZ);
      let nextHeight = current;
      switch (options.operation) {
        case 'lower':
          nextHeight = current - strength * falloff;
          break;
        case 'flatten':
          nextHeight = lerp(current, options.flattenHeight ?? sampleTerrainLocalHeight(terrain, localX, localZ), clamp(strength * 0.18 * falloff, 0, 1));
          break;
        case 'smooth':
          nextHeight = lerp(current, averageNeighborHeight(terrain, sampleX, sampleZ), clamp(strength * 0.16 * falloff, 0, 1));
          break;
        case 'raise':
        default:
          nextHeight = current + strength * falloff;
          break;
      }
      nextOverrides[terrainEditKey(ix, iz)] = Number(nextHeight.toFixed(4));
    }
  }

  return withTerrainDefaults({ ...terrain, heightOverrides: nextOverrides });
}

export function applyTerrainPaint(
  input: TerrainComponent | Partial<TerrainComponent>,
  localX: number,
  localZ: number,
  options: TerrainPaintOptions,
): TerrainComponent {
  const terrain = withTerrainDefaults(input);
  const layer = terrain.materialLayers.find((item) => item.id === options.layerId);
  if (!layer || !localPointInsideTerrain(terrain, localX, localZ)) return terrain;
  const radius = clamp(options.radius, terrain.editSpacing, 256);
  const minX = Math.floor((localX - radius) / terrain.editSpacing);
  const maxX = Math.ceil((localX + radius) / terrain.editSpacing);
  const minZ = Math.floor((localZ - radius) / terrain.editSpacing);
  const maxZ = Math.ceil((localZ + radius) / terrain.editSpacing);
  const nextPaint = { ...terrain.paintOverrides };

  for (let iz = minZ; iz <= maxZ; iz += 1) {
    for (let ix = minX; ix <= maxX; ix += 1) {
      const sampleX = ix * terrain.editSpacing;
      const sampleZ = iz * terrain.editSpacing;
      if (!localPointInsideTerrain(terrain, sampleX, sampleZ)) continue;
      if (Math.hypot(sampleX - localX, sampleZ - localZ) > radius) continue;
      nextPaint[terrainEditKey(ix, iz)] = layer.id;
    }
  }

  return withTerrainDefaults({ ...terrain, paintOverrides: nextPaint });
}

export function terrainLocalPointFromWorld(object: SceneObject, world: Vector3Tuple): Vector3Tuple {
  const sx = object.transform.scale[0] || 1;
  const sy = object.transform.scale[1] || 1;
  const sz = object.transform.scale[2] || 1;
  return [
    (world[0] - object.transform.position[0]) / sx,
    (world[1] - object.transform.position[1]) / sy,
    (world[2] - object.transform.position[2]) / sz,
  ];
}

export function terrainWorldHeightAt(object: SceneObject, worldX: number, worldZ: number): number | undefined {
  if (!object.terrain?.enabled) return undefined;
  const terrain = withTerrainDefaults(object.terrain);
  const sy = object.transform.scale[1] || 1;
  const [localX, , localZ] = terrainLocalPointFromWorld(object, [worldX, object.transform.position[1], worldZ]);
  const half = terrain.size * 0.5;
  if (localX < -half || localX > half || localZ < -half || localZ > half) return undefined;
  return object.transform.position[1] + sampleTerrainLocalHeight(terrain, localX, localZ) * sy;
}

export function highestTerrainWorldHeight(objects: SceneObject[], worldX: number, worldZ: number): number | undefined {
  let best: number | undefined;
  for (const object of objects) {
    const height = terrainWorldHeightAt(object, worldX, worldZ);
    if (height !== undefined && (best === undefined || height > best)) best = height;
  }
  return best;
}

export type TerrainHeightSampler = (worldX: number, worldZ: number) => number | undefined;

/**
 * Build a per-tick terrain height sampler. It filters the terrain objects ONCE (a scene
 * usually has 0–1) instead of re-scanning every object on each query, and memoizes results
 * on a ~1cm grid so repeated lookups at the same spot within a frame (e.g. a character's
 * floor checked in several passes, or every wheel of a car) don't re-run octave noise.
 * Create a fresh sampler each tick so the cache never goes stale across frames.
 */
export function createTerrainHeightSampler(objects: SceneObject[]): TerrainHeightSampler {
  const terrainObjects: SceneObject[] = [];
  for (const object of objects) if (object.terrain?.enabled) terrainObjects.push(object);
  if (terrainObjects.length === 0) return () => undefined;
  const cache = new Map<number, number | undefined>();
  return (worldX, worldZ) => {
    // Pack the quantized (x,z) into one numeric key — cheaper than building a string per call.
    const qx = Math.round(worldX * 100);
    const qz = Math.round(worldZ * 100);
    const key = qx * 4194304 + qz; // 2^22 stride; ample for any realistic terrain extent
    const hit = cache.get(key);
    if (hit !== undefined || cache.has(key)) return hit;
    let best: number | undefined;
    for (const object of terrainObjects) {
      const height = terrainWorldHeightAt(object, worldX, worldZ);
      if (height !== undefined && (best === undefined || height > best)) best = height;
    }
    cache.set(key, best);
    return best;
  };
}

export interface TerrainChunkKey {
  x: number;
  z: number;
  id: string;
}

export function terrainChunkKey(x: number, z: number): string {
  return `${x}:${z}`;
}

export function terrainChunkBounds(input: TerrainComponent | Partial<TerrainComponent>, x: number, z: number) {
  const terrain = withTerrainDefaults(input);
  const minX = x * terrain.chunkSize;
  const minZ = z * terrain.chunkSize;
  return {
    minX,
    minZ,
    maxX: minX + terrain.chunkSize,
    maxZ: minZ + terrain.chunkSize,
    centerX: minX + terrain.chunkSize * 0.5,
    centerZ: minZ + terrain.chunkSize * 0.5,
  };
}

function chunkIntersectsTerrain(input: TerrainComponent, x: number, z: number): boolean {
  const b = terrainChunkBounds(input, x, z);
  const half = input.size * 0.5;
  return b.maxX >= -half && b.minX <= half && b.maxZ >= -half && b.minZ <= half;
}

export function terrainChunkKeysAroundLocal(
  input: TerrainComponent | Partial<TerrainComponent>,
  localX: number,
  localZ: number,
  radius: number,
): TerrainChunkKey[] {
  const terrain = withTerrainDefaults(input);
  const cx = Math.floor(localX / terrain.chunkSize);
  const cz = Math.floor(localZ / terrain.chunkSize);
  const keys: TerrainChunkKey[] = [];
  for (let z = cz - radius; z <= cz + radius; z += 1) {
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      if (chunkIntersectsTerrain(terrain, x, z)) keys.push({ x, z, id: terrainChunkKey(x, z) });
    }
  }
  return keys;
}

export function terrainChunkKeysAroundWorld(object: SceneObject, worldPosition: Vector3Tuple, radius: number): TerrainChunkKey[] {
  if (!object.terrain?.enabled) return [];
  const sx = object.transform.scale[0] || 1;
  const sz = object.transform.scale[2] || 1;
  return terrainChunkKeysAroundLocal(
    object.terrain,
    (worldPosition[0] - object.transform.position[0]) / sx,
    (worldPosition[2] - object.transform.position[2]) / sz,
    radius,
  );
}

export function buildTerrainHeightfield(input: TerrainComponent | Partial<TerrainComponent>, chunkX: number, chunkZ: number) {
  const terrain = withTerrainDefaults(input);
  const segments = terrain.resolution;
  const samples = segments + 1;
  const heights = new Float32Array(samples * samples);
  const bounds = terrainChunkBounds(terrain, chunkX, chunkZ);
  let i = 0;
  for (let z = 0; z <= segments; z += 1) {
    const localZ = bounds.minZ + (z / segments) * terrain.chunkSize;
    for (let x = 0; x <= segments; x += 1) {
      const localX = bounds.minX + (x / segments) * terrain.chunkSize;
      heights[i] = sampleTerrainLocalHeight(terrain, localX, localZ);
      i += 1;
    }
  }
  return {
    nrows: samples,
    ncols: samples,
    heights,
    center: [bounds.centerX, 0, bounds.centerZ] as Vector3Tuple,
    scale: { x: terrain.chunkSize, y: 1, z: terrain.chunkSize },
  };
}
