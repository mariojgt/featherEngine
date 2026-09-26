import type { TerrainComponent } from '../types';
import { terrainChunkKey, withTerrainDefaults } from './terrain';

export interface TerrainChunkSignatures {
  /** Height/noise settings shared by every chunk. Deliberately excludes editVersion and foliage. */
  geometryBase: string;
  /** Layer topology shared by every chunk. Texture/color controls live on the material and do not rebuild geometry. */
  surfaceBase: string;
  geometryChunks: Map<string, string>;
  surfaceChunks: Map<string, string>;
}

const signatureCache = new WeakMap<TerrainComponent, TerrainChunkSignatures>();

function addToAffectedChunks(
  target: Map<string, string[]>,
  terrain: TerrainComponent,
  key: string,
  entry: string,
  margin: number,
) {
  const separator = key.indexOf(':');
  const ix = Number(key.slice(0, separator));
  const iz = Number(key.slice(separator + 1));
  if (!Number.isFinite(ix) || !Number.isFinite(iz)) return;
  const px = ix * terrain.editSpacing;
  const pz = iz * terrain.editSpacing;
  const minX = Math.floor((px - margin) / terrain.chunkSize);
  const maxX = Math.floor((px + margin) / terrain.chunkSize);
  const minZ = Math.floor((pz - margin) / terrain.chunkSize);
  const maxZ = Math.floor((pz + margin) / terrain.chunkSize);
  // Iterate the complete range. Taking only the two endpoints misses every intervening chunk when
  // editSpacing (and therefore the interpolation footprint) is larger than chunkSize.
  for (let z = minZ; z <= maxZ; z += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const chunk = terrainChunkKey(x, z);
      const values = target.get(chunk);
      if (values) values.push(entry);
      else target.set(chunk, [entry]);
    }
  }
}

const finalize = (parts: Map<string, string[]>) => {
  const result = new Map<string, string>();
  for (const [key, entries] of parts) result.set(key, entries.join(';'));
  return result;
};

/** Deterministic split signatures used to keep sculpt and paint invalidation local. */
export function terrainChunkSignatures(input: TerrainComponent): TerrainChunkSignatures {
  const cached = signatureCache.get(input);
  if (cached) return cached;
  const terrain = withTerrainDefaults(input);
  const geometryParts = new Map<string, string[]>();
  const surfaceParts = new Map<string, string[]>();
  const normalStep = Math.max(terrain.chunkSize / Math.max(terrain.resolution, 1), 0.5);
  const geometryMargin = terrain.editSpacing + normalStep;
  const surfaceMargin = terrain.editSpacing;
  for (const key of Object.keys(terrain.heightOverrides).sort()) {
    addToAffectedChunks(geometryParts, terrain, key, `${key}=${terrain.heightOverrides[key]}`, geometryMargin);
  }
  for (const key of Object.keys(terrain.paintOverrides).sort()) {
    addToAffectedChunks(surfaceParts, terrain, key, `${key}=${terrain.paintOverrides[key]}`, surfaceMargin);
  }

  const result: TerrainChunkSignatures = {
    geometryBase: JSON.stringify({
      size: terrain.size,
      chunkSize: terrain.chunkSize,
      resolution: terrain.resolution,
      seed: terrain.seed,
      heightScale: terrain.heightScale,
      ridgeStrength: terrain.ridgeStrength,
      domainWarp: terrain.domainWarp,
      frequency: terrain.frequency,
      octaves: terrain.octaves,
      persistence: terrain.persistence,
      lacunarity: terrain.lacunarity,
      editSpacing: terrain.editSpacing,
    }),
    surfaceBase: JSON.stringify({
      materialDistribution: terrain.materialDistribution,
      editSpacing: terrain.editSpacing,
      layerIds: terrain.materialLayers.map((layer) => layer.id),
    }),
    geometryChunks: finalize(geometryParts),
    surfaceChunks: finalize(surfaceParts),
  };
  signatureCache.set(input, result);
  return result;
}

/**
 * Ring-based render LOD. Chunks inside the physics radius always retain authored resolution. Farther
 * rings reduce by powers of two while full-resolution border stitching joins finer neighbors.
 */
export function terrainChunkLodSegments(
  input: TerrainComponent,
  ringDistance: number,
  forceFullDetail = false,
): number {
  const terrain = withTerrainDefaults(input);
  if (forceFullDetail || ringDistance <= terrain.physicsRadius) return terrain.resolution;
  const level = Math.min(2, Math.max(1, Math.floor(ringDistance - terrain.physicsRadius)));
  return Math.max(4, Math.ceil(terrain.resolution / 2 ** level));
}

