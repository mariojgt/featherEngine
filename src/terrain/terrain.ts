import type {
  SceneObject,
  StylizedGrassSettings,
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

/**
 * The stylized grass look: warm yellow-green tips falling to a dark, cool root, broken up by broad
 * world-space colour patches. Tuned by rendering the field and measuring it against a painted-clump
 * reference rather than picked by eye.
 */
export const defaultStylizedGrass = (): StylizedGrassSettings => ({
  // These multiply the grass tint, and multiplying two low-blue greens squares the blue deficiency — which
  // is what turns stylized grass into acid-green plastic. Both ends deliberately carry blue so the rendered
  // result keeps the reference's softer, slightly desaturated foliage hue.
  gradientTop: '#f0f2d4',
  gradientBottom: '#4a4f3e',
  gradientOffset: 0.05,
  gradientContrast: 0.45,
  colorNoiseScale: 0.045,
  colorNoiseStrength: 0.35,
  colorNoiseLow: '#eef1c8',
  colorNoiseHigh: '#8fb257',
  windSpeed: 0.35,
  windNoiseScale: 0.06,
  bendPivot: 0.25,
  perspectiveCorrection: 0.55,
  perspectiveHeightStart: 0.3,
  interactionStrength: 0.55,
  pushDownAmount: 0.35,
  trailTint: '#c9d98f',
  normalLift: 0.75,
  fadeMode: 'dither',
  fadeStart: 45,
  fadeEnd: 70,
});

/**
 * One-click grass looks. Each is a grass tint plus the gradient/variation overrides that carry the mood —
 * everything else falls back to {@link defaultStylizedGrass}. Kept small and hand-tuned rather than
 * generated, because these are art direction, not math.
 */
export const GRASS_PRESETS = {
  lush: { label: 'Lush Green', grassColor: '#9ed070', settings: {} },
  meadow: {
    label: 'Sunny Meadow',
    grassColor: '#a8cc4e',
    settings: { gradientTop: '#f4ecA0', colorNoiseHigh: '#b6c469', colorNoiseStrength: 0.45, gradientContrast: 0.45 },
  },
  dry: {
    label: 'Dry Savanna',
    grassColor: '#c9ab5a',
    settings: { gradientTop: '#f0dc95', gradientBottom: '#4a3b2a', colorNoiseLow: '#f2e6bd', colorNoiseHigh: '#a98f4e', colorNoiseStrength: 0.5 },
  },
  forest: {
    label: 'Forest Floor',
    grassColor: '#5d8f3f',
    settings: { gradientTop: '#b9cf72', gradientBottom: '#232a33', gradientContrast: 0.68, colorNoiseHigh: '#4c7a3a' },
  },
  arcade: {
    label: 'Vibrant Arcade',
    grassColor: '#7add2f',
    settings: { gradientTop: '#d5d85b', gradientBottom: '#1f1124', gradientContrast: 0.72, colorNoiseStrength: 0.28 },
  },
  frost: {
    label: 'Frosted',
    grassColor: '#93b89a',
    settings: { gradientTop: '#dff0e4', gradientBottom: '#2b3444', colorNoiseLow: '#eef6f4', colorNoiseHigh: '#7fa39b' },
  },
} as const satisfies Record<string, { label: string; grassColor: string; settings: Partial<StylizedGrassSettings> }>;

export type GrassPresetId = keyof typeof GRASS_PRESETS;

export const defaultTerrainFoliage = (): TerrainFoliageComponent => ({
  enabled: true,
  mode: 'mixed',
  density: 0.34,
  treeDensity: 0.12,
  minScale: 0.75,
  maxScale: 1.65,
  slopeLimit: 0.68,
  grassMesh: 'clump',
  treeMesh: 'cone',
  grassSource: 'builtin',
  treeSource: 'builtin',
  grassColor: '#9ed070',
  trunkColor: '#6b4a2f',
  treeColor: '#2f7d45',
  windStrength: 1,
  interactStrength: 1,
  flowerDensity: 0,
  usePaintMask: false,
  stylizedGrass: defaultStylizedGrass(),
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
  foliageOverrides: {},
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
  // Sampling helpers pass normalized inputs to each other. Treat that immutable result as canonical
  // instead of repeatedly cloning/sanitizing its potentially large paint and foliage records.
  terrainDefaultsCache.set(normalized, normalized);
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
    // Carry the edit counter through normalization so the viewport's live-update signature keeps seeing it.
    editVersion: terrain?.editVersion ?? 0,
    size,
    chunkSize,
    resolution: clampInt(terrain?.resolution ?? base.resolution, 4, 64),
    streamRadius: clampInt(terrain?.streamRadius ?? base.streamRadius, 1, 10),
    physicsRadius: clampInt(terrain?.physicsRadius ?? base.physicsRadius, 1, 5),
    seed: Math.trunc(terrain?.seed ?? base.seed),
    materialDistribution: terrain?.materialDistribution === 'ground' ? 'ground' : 'height',
    heightScale: clamp(terrain?.heightScale ?? base.heightScale, 0, 256),
    ridgeStrength: Number.isFinite(terrain?.ridgeStrength) ? clamp(terrain!.ridgeStrength!, 0, 1) : 0,
    domainWarp: Number.isFinite(terrain?.domainWarp) ? clamp(terrain!.domainWarp!, 0, 256) : 0,
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
    foliageOverrides: sanitizeNumberRecord(terrain?.foliageOverrides),
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
      grassImageAssetId: foliage.grassImageAssetId || undefined,
      treeImageAssetId: foliage.treeImageAssetId || undefined,
      // Back-compat: a project saved with only a model asset (before the source field) keeps using it.
      grassSource: terrain?.foliage?.grassSource ?? (foliage.grassModelAssetId ? 'model' : foliage.grassImageAssetId ? 'image' : 'builtin'),
      treeSource: terrain?.foliage?.treeSource ?? (foliage.treeModelAssetId ? 'model' : foliage.treeImageAssetId ? 'image' : 'builtin'),
      distribution: foliage.distribution === 'woodland' ? 'woodland' : 'uniform',
      understoryAssetId: foliage.understoryAssetId || undefined,
      understoryDensity: Number.isFinite(foliage.understoryDensity) ? clamp(foliage.understoryDensity!, 0, 1) : 0,
      treeSpecId: foliage.treeSpecId || undefined,
      treeSpecies: foliage.treeSpecies?.filter((entry, index, entries) => entry.specId && Number.isFinite(entry.weight) && entry.weight > 0 && entries.findIndex((other) => other.specId === entry.specId) === index)
        .slice(0, 4).map((entry) => ({ specId: entry.specId, weight: clamp(entry.weight, 0.01, 100) })),
      treeSpacing: Number.isFinite(foliage.treeSpacing) ? clamp(foliage.treeSpacing!, 0, 64) : 0,
      minElevation: Number.isFinite(foliage.minElevation) ? clamp(foliage.minElevation!, -512, 512) : undefined,
      maxElevation: Number.isFinite(foliage.maxElevation)
        ? clamp(foliage.maxElevation!, Number.isFinite(foliage.minElevation) ? clamp(foliage.minElevation!, -512, 512) : -512, 512) : undefined,
      windStrength: clamp(foliage.windStrength ?? 1, 0, 4),
      usePaintMask: foliage.usePaintMask ?? false,
      stylizedGrass: normalizeStylizedGrass(foliage.stylizedGrass),
    },
  };
}

function normalizeStylizedGrass(settings?: Partial<StylizedGrassSettings>): StylizedGrassSettings {
  const base = defaultStylizedGrass();
  if (!settings) return base;
  const merged = { ...base, ...settings };
  const fadeStart = clamp(merged.fadeStart, 1, 4000);
  return {
    ...merged,
    gradientOffset: clamp(merged.gradientOffset, 0, 0.95),
    gradientContrast: clamp(merged.gradientContrast, 0, 1),
    colorNoiseScale: clamp(merged.colorNoiseScale, 0.001, 2),
    colorNoiseStrength: clamp(merged.colorNoiseStrength, 0, 1),
    windSpeed: clamp(merged.windSpeed, 0, 8),
    windNoiseScale: clamp(merged.windNoiseScale, 0.001, 2),
    bendPivot: clamp(merged.bendPivot, 0, 0.95),
    perspectiveCorrection: clamp(merged.perspectiveCorrection, 0, 2),
    perspectiveHeightStart: clamp(merged.perspectiveHeightStart, 0, 0.95),
    interactionStrength: clamp(merged.interactionStrength, 0, 4),
    pushDownAmount: clamp(merged.pushDownAmount, 0, 2),
    normalLift: clamp(merged.normalLift, 0, 1),
    fadeMode: merged.fadeMode === 'off' || merged.fadeMode === 'smooth' ? merged.fadeMode : 'dither',
    fadeStart,
    // Keep the fade a real range — an end at or below the start would divide by zero in the shader.
    fadeEnd: clamp(merged.fadeEnd, fadeStart + 1, 5000),
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
      textureScale: clamp(Number.isFinite(layer.textureScale) ? layer.textureScale! : 8, 0.25, 256),
      textureVariation: clamp(Number.isFinite(layer.textureVariation) ? layer.textureVariation! : 0, 0, 1),
      normalStrength: clamp(Number.isFinite(layer.normalStrength) ? layer.normalStrength! : 1, 0, 4),
      roughness: clamp(Number.isFinite(layer.roughness) ? layer.roughness! : 0.92, 0, 1),
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

// Overrides are immutable. Even an early-return for…in can enumerate a dictionary's keys internally
// in V8, so cache emptiness once per record instead of repeating it for every vertex/normal sample.
const emptyRecordCache = new WeakMap<Record<string, number>, boolean>();
function isRecordEmpty(record: Record<string, number>): boolean {
  const cached = emptyRecordCache.get(record);
  if (cached !== undefined) return cached;
  const empty = Object.keys(record).length === 0;
  emptyRecordCache.set(record, empty);
  return empty;
}

const emptyStringRecordCache = new WeakMap<Record<string, string>, boolean>();
function isStringRecordEmpty(record: Record<string, string>): boolean {
  const cached = emptyStringRecordCache.get(record);
  if (cached !== undefined) return cached;
  const empty = Object.keys(record).length === 0;
  emptyStringRecordCache.set(record, empty);
  return empty;
}

const terrainLayerIndexCache = new WeakMap<TerrainComponent, Map<string, number>>();
function terrainLayerIndex(terrain: TerrainComponent): Map<string, number> {
  const cached = terrainLayerIndexCache.get(terrain);
  if (cached) return cached;
  const index = new Map(terrain.materialLayers.map((layer, layerIndex) => [layer.id, layerIndex]));
  terrainLayerIndexCache.set(terrain, index);
  return index;
}

export function sampleBaseTerrainLocalHeight(input: TerrainComponent | Partial<TerrainComponent>, localX: number, localZ: number): number {
  const terrain = withTerrainDefaults(input);
  let frequency = terrain.frequency;
  let amplitude = 1;
  let total = 0;
  let sum = 0;
  const warp = terrain.domainWarp ?? 0;
  const ridge = terrain.ridgeStrength ?? 0;
  const wx = localX + (warp ? (valueNoise2(localX * frequency * 0.45, localZ * frequency * 0.45, terrain.seed + 7919) * 2 - 1) * warp : 0);
  const wz = localZ + (warp ? (valueNoise2(localX * frequency * 0.45, localZ * frequency * 0.45, terrain.seed + 15401) * 2 - 1) * warp : 0);
  for (let octave = 0; octave < terrain.octaves; octave += 1) {
    const n = valueNoise2(wx * frequency, wz * frequency, terrain.seed + octave * 1013) * 2 - 1;
    const ridged = Math.pow(1 - Math.abs(n), 3) * 2 - 1;
    sum += lerp(n, ridged, ridge) * amplitude;
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
  localX = 0,
  localZ = 0,
): string {
  const terrain = withTerrainDefaults(input);
  const weights = autoTerrainMaterialWeights(terrain, height, normalY, localX, localZ);
  let best = 0;
  for (let i = 1; i < weights.length; i += 1) if (weights[i] > weights[best]) best = i;
  return terrain.materialLayers[best]?.id ?? 'terrain-grass';
}

const smoothRange = (min: number, max: number, value: number) =>
  smoothstep(clamp((value - min) / Math.max(max - min, 0.0001), 0, 1));

/**
 * Smooth, normalized automatic weights for the legacy low/mid/high terrain bands. Extra layers are
 * available to painting but remain at zero until authored. Steep ground blends toward the third (rock)
 * layer instead of crossing a hard slope threshold.
 */
export function autoTerrainMaterialWeights(
  input: TerrainComponent | Partial<TerrainComponent>,
  height: number,
  normalY: number,
  localX = 0,
  localZ = 0,
): number[] {
  const terrain = withTerrainDefaults(input);
  const count = Math.max(1, terrain.materialLayers.length);
  const weights = Array<number>(count).fill(0);
  if (count === 1) {
    weights[0] = 1;
    return weights;
  }
  const t = clamp((height / Math.max(terrain.heightScale, 0.001) + 1) * 0.5, 0, 1);
  const lowToMid = smoothRange(0.42, 0.54, t);
  const midToHigh = count > 2 ? smoothRange(0.66, 0.78, t) : 0;
  if (terrain.materialDistribution === 'ground') {
    // Broad, world-space value noise makes coherent clearings rather than changing the mix at every
    // vertex. Because it depends only on terrain-local coordinates and the authored seed, neighboring
    // chunks evaluate their shared edge identically. A quieter second octave keeps the patch boundaries
    // organic without turning the layer weights into speckle.
    const broad = valueNoise2(localX * 0.026, localZ * 0.026, terrain.seed + 3253);
    const breakup = valueNoise2(localX * 0.071, localZ * 0.071, terrain.seed + 8191);
    const patch = broad * 0.76 + breakup * 0.24;
    let soilShare = lerp(0.05, 0.72, smoothRange(0.43, 0.7, patch));

    // Thin turf naturally gives way to exposed earth before the cliff face becomes predominantly rock.
    // Keep this ramp broad and subordinate to the rock ramp so all three materials cross-fade smoothly.
    const up = clamp(Number.isFinite(normalY) ? normalY : 1, 0, 1);
    const weatheredSlope = 1 - smoothRange(0.7, 0.93, up);
    soilShare = lerp(soilShare, Math.max(soilShare, 0.58), weatheredSlope * 0.45);

    const slopeRock = count > 2 ? 1 - smoothRange(0.52, 0.86, up) : 0;
    const summitRock = count > 2 ? smoothRange(0.8, 0.97, t) : 0;
    // Probabilistic union avoids the hard ridge produced by max() when elevation and slope ramps cross.
    const rock = 1 - (1 - slopeRock) * (1 - summitRock);
    weights[0] = (1 - rock) * (1 - soilShare);
    weights[1] = (1 - rock) * soilShare;
    if (count > 2) weights[2] = rock;
    return normalizeTerrainLayerWeights(weights);
  }
  weights[0] = 1 - lowToMid;
  weights[1] = lowToMid * (1 - midToHigh);
  if (count > 2) weights[2] = midToHigh;

  if (count > 2) {
    const rock = 1 - smoothRange(0.52, 0.72, normalY);
    for (let i = 0; i < count; i += 1) weights[i] *= 1 - rock;
    weights[2] += rock;
  }
  return normalizeTerrainLayerWeights(weights);
}

/** Normalize arbitrary layer weights, falling back safely to the first layer for an empty sum. */
export function normalizeTerrainLayerWeights(weights: readonly number[]): number[] {
  const clean = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0));
  const sum = clean.reduce((total, weight) => total + weight, 0);
  if (sum <= 0) return clean.map((_, index) => (index === 0 ? 1 : 0));
  return clean.map((weight) => weight / sum);
}

/**
 * Bilinearly blend painted layer ids across edit cells. Missing cells retain the automatic landscape
 * weights, producing a soft edge around a painted region instead of a nearest-cell material step.
 */
export function sampleTerrainLayerWeights(
  input: TerrainComponent | Partial<TerrainComponent>,
  localX: number,
  localZ: number,
  height?: number,
  normalY?: number,
): number[] {
  const terrain = withTerrainDefaults(input);
  const h = height ?? sampleTerrainLocalHeight(terrain, localX, localZ);
  const ny = normalY ?? sampleTerrainNormal(terrain, localX, localZ)[1];
  const automatic = autoTerrainMaterialWeights(terrain, h, ny, localX, localZ);
  if (isStringRecordEmpty(terrain.paintOverrides)) return automatic;

  const gx = localX / terrain.editSpacing;
  const gz = localZ / terrain.editSpacing;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const tx = smoothstep(gx - ix);
  const tz = smoothstep(gz - iz);
  const layerIndex = terrainLayerIndex(terrain);
  const at = (x: number, z: number) => {
    const painted = terrain.paintOverrides[terrainEditKey(x, z)];
    const index = painted ? layerIndex.get(painted) : undefined;
    if (index === undefined) return automatic;
    const result = Array<number>(terrain.materialLayers.length).fill(0);
    result[index] = 1;
    return result;
  };
  const corners = [at(ix, iz), at(ix + 1, iz), at(ix, iz + 1), at(ix + 1, iz + 1)];
  const weights = automatic.map((_, index) => lerp(
    lerp(corners[0][index] ?? 0, corners[1][index] ?? 0, tx),
    lerp(corners[2][index] ?? 0, corners[3][index] ?? 0, tx),
    tz,
  ));
  return normalizeTerrainLayerWeights(weights);
}

export function sampleTerrainMaterialLayerId(
  input: TerrainComponent | Partial<TerrainComponent>,
  localX: number,
  localZ: number,
  height?: number,
  normalY?: number,
): string {
  const terrain = withTerrainDefaults(input);
  const weights = sampleTerrainLayerWeights(terrain, localX, localZ, height, normalY);
  let best = 0;
  for (let i = 1; i < weights.length; i += 1) if (weights[i] > weights[best]) best = i;
  return terrain.materialLayers[best]?.id ?? autoTerrainMaterialLayerId(
    terrain,
    height ?? sampleTerrainLocalHeight(terrain, localX, localZ),
    normalY ?? sampleTerrainNormal(terrain, localX, localZ)[1],
    localX,
    localZ,
  );
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

export interface TerrainFoliagePaintOptions {
  radius: number;
  /** Target density 0..1 to paint into the brushed cells (ignored when erasing). */
  density: number;
  /** Erase painted foliage (clear the cells) instead of adding. */
  erase?: boolean;
}

/**
 * Hand-paint the foliage density mask (Unreal-style). Writes 0..1 values into `foliageOverrides` for the
 * grid cells inside the brush (feathered toward the edge), and flips `foliage.usePaintMask` on so the
 * scatter switches from uniform density to "only where painted". Erasing clears the cells.
 */
export function applyTerrainFoliagePaint(
  input: TerrainComponent | Partial<TerrainComponent>,
  localX: number,
  localZ: number,
  options: TerrainFoliagePaintOptions,
): TerrainComponent {
  const terrain = withTerrainDefaults(input);
  if (!localPointInsideTerrain(terrain, localX, localZ)) return terrain;
  const radius = clamp(options.radius, terrain.editSpacing, 256);
  const minX = Math.floor((localX - radius) / terrain.editSpacing);
  const maxX = Math.ceil((localX + radius) / terrain.editSpacing);
  const minZ = Math.floor((localZ - radius) / terrain.editSpacing);
  const maxZ = Math.ceil((localZ + radius) / terrain.editSpacing);
  const next = { ...(terrain.foliageOverrides ?? {}) };
  const target = clamp(options.density, 0, 1);

  for (let iz = minZ; iz <= maxZ; iz += 1) {
    for (let ix = minX; ix <= maxX; ix += 1) {
      const sampleX = ix * terrain.editSpacing;
      const sampleZ = iz * terrain.editSpacing;
      if (!localPointInsideTerrain(terrain, sampleX, sampleZ)) continue;
      const dist = Math.hypot(sampleX - localX, sampleZ - localZ);
      if (dist > radius) continue;
      const key = terrainEditKey(ix, iz);
      if (options.erase) {
        delete next[key];
        continue;
      }
      // Feather toward the brush edge so repeated strokes build up softly (like a falloff brush).
      const falloff = 1 - (dist / radius) ** 2;
      const prev = next[key] ?? 0;
      next[key] = clamp(Math.max(prev, target * falloff), 0, 1);
    }
  }

  return withTerrainDefaults({
    ...terrain,
    foliageOverrides: next,
    foliage: { ...terrain.foliage, usePaintMask: true },
  });
}

/** Sample the painted foliage density (0..1) at a local point — nearest grid cell. 0 where unpainted. */
export function sampleFoliageMask(terrain: TerrainComponent, localX: number, localZ: number): number {
  const overrides = terrain.foliageOverrides;
  if (!overrides) return 0;
  const ix = Math.round(localX / terrain.editSpacing);
  const iz = Math.round(localZ / terrain.editSpacing);
  return overrides[terrainEditKey(ix, iz)] ?? 0;
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

/**
 * Build a TRIMESH (vertices + indices) for a terrain chunk in terrain-LOCAL space, identical to the
 * visual chunk mesh (createChunkGeometry). Used for the physics collider so the collision surface matches
 * exactly what's rendered — including sculpted hills — with no heightfield row/col/scale ambiguity. The
 * caller bakes the object's scale into the vertices and places the body at the object's world transform.
 */
export function buildTerrainChunkTrimesh(input: TerrainComponent | Partial<TerrainComponent>, chunkX: number, chunkZ: number) {
  const terrain = withTerrainDefaults(input);
  const segments = terrain.resolution;
  const perSide = segments + 1;
  const vertices = new Float32Array(perSide * perSide * 3);
  const indices = new Uint32Array(segments * segments * 6);
  const bounds = terrainChunkBounds(terrain, chunkX, chunkZ);
  let v = 0;
  for (let z = 0; z <= segments; z += 1) {
    const localZ = bounds.minZ + (z / segments) * terrain.chunkSize;
    for (let x = 0; x <= segments; x += 1) {
      const localX = bounds.minX + (x / segments) * terrain.chunkSize;
      vertices[v++] = localX;
      vertices[v++] = sampleTerrainLocalHeight(terrain, localX, localZ);
      vertices[v++] = localZ;
    }
  }
  let t = 0;
  for (let z = 0; z < segments; z += 1) {
    for (let x = 0; x < segments; x += 1) {
      const a = z * perSide + x;
      const b = a + 1;
      const d = (z + 1) * perSide + x;
      const e = d + 1;
      indices[t++] = a; indices[t++] = d; indices[t++] = b;
      indices[t++] = b; indices[t++] = d; indices[t++] = e;
    }
  }
  return { vertices, indices };
}
