import type { TerrainComponent, QualityLevel } from '../types';
import { GROUND_COVER_KINDS, WOODLAND_CANOPY_RADIUS, type GroundCoverMatrices } from './woodland';
import { terrainChunkBounds, type TerrainChunkKey } from './terrain';
import { generateVegetationChunk, type VegetationGenerationOptions } from './vegetation';

export type VegetationChunkData = ReturnType<typeof generateVegetationChunk>;
export interface VegetationBudget { grass: number; trees: number; flowers: number; groundCover?: number }

/** Hard instance budgets, independent of world size. High retains the previous global limits. */
export function vegetationBudget(quality: QualityLevel = 'High'): VegetationBudget {
  switch (quality) {
    case 'Low': return { grass: 14000, trees: 500, flowers: 2000, groundCover: 400 };
    case 'Medium': return { grass: 32000, trees: 1000, flowers: 6000, groundCover: 800 };
    case 'Epic': return { grass: 80000, trees: 3000, flowers: 18000, groundCover: 1400 };
    default: return { grass: 60000, trees: 2000, flowers: 16000, groundCover: 1100 };
  }
}

export interface VegetationSignatures { base: string; chunks: Map<string, string> }
const signatures = new WeakMap<TerrainComponent, VegetationSignatures>();

/** Wind, lighting, shader settings and texture changes never change the scatter layout. */
export function vegetationSignatures(terrain: TerrainComponent): VegetationSignatures {
  const cached = signatures.get(terrain);
  if (cached) return cached;
  const {
    windStrength: _wind, interactStrength: _interaction, stylizedGrass: _look,
    trunkColor: _trunk, treeColor: _crown, ...placement
  } = terrain.foliage;
  const base = JSON.stringify([
    terrain.size, terrain.chunkSize, terrain.resolution, terrain.seed, terrain.heightScale,
    terrain.ridgeStrength, terrain.domainWarp, terrain.materialDistribution, terrain.frequency, terrain.octaves,
    terrain.persistence, terrain.lacunarity, terrain.editSpacing, placement,
    terrain.materialLayers.map(({ id, color }) => [id, color]),
  ]);
  const parts = new Map<string, string[]>();
  // A normal sample extends beyond the bilinear height footprint. The tuft jitter adds 0.3 units.
  const margin = terrain.editSpacing + Math.max(terrain.chunkSize / terrain.resolution, 0.5) + 0.3 + (terrain.foliage.distribution === 'woodland' ? WOODLAND_CANOPY_RADIUS : 0);
  const bucket = (record: Record<string, unknown> | undefined, tag: string) => {
    for (const key of Object.keys(record ?? {}).sort()) {
      const [ix, iz] = key.split(':').map(Number);
      if (!Number.isFinite(ix) || !Number.isFinite(iz)) continue;
      const x = ix * terrain.editSpacing, z = iz * terrain.editSpacing;
      // Enumerate the entire affected rectangle; endpoints alone miss interior chunks at wide spacing.
      for (let cz = Math.floor((z - margin) / terrain.chunkSize); cz <= Math.floor((z + margin) / terrain.chunkSize); cz++) {
        for (let cx = Math.floor((x - margin) / terrain.chunkSize); cx <= Math.floor((x + margin) / terrain.chunkSize); cx++) {
          const id = `${cx}:${cz}`;
          const entries = parts.get(id) ?? [];
          entries.push(`${tag}${key}=${record![key]}`);
          parts.set(id, entries);
        }
      }
    }
  };
  bucket(terrain.heightOverrides, 'h');
  bucket(terrain.paintOverrides, 'p');
  if (terrain.foliage.usePaintMask) bucket(terrain.foliageOverrides, 'f');
  const result = { base, chunks: new Map([...parts].map(([id, entries]) => [id, entries.join(';')])) };
  signatures.set(terrain, result);
  return result;
}

export function vegetationChunkSignature(signatures: VegetationSignatures, chunk: TerrainChunkKey, options: VegetationGenerationOptions): string {
  return `${signatures.base}|${signatures.chunks.get(chunk.id) ?? ''}|g${options.grass !== false}|t${options.trees !== false}|f${options.flowers !== false}|u${options.groundCover !== false}`;
}

function instanceWeight(data: VegetationChunkData): number {
  return data.grass.length + data.flowers.length + data.treeModels.length * 3 + GROUND_COVER_KINDS.reduce((n, kind) => n + data.groundCover[kind].length, 0);
}

/** Per-terrain bounded LRU. Published render batches own references independently of eviction. */
export class VegetationChunkCache {
  private entries = new Map<string, { signature: string; data: VegetationChunkData; weight: number }>();
  private weight = 0;
  generations = 0;
  constructor(readonly maxEntries = 128, readonly maxInstances = 160000) {}

  get(id: string, signature: string): VegetationChunkData | undefined {
    const entry = this.entries.get(id);
    if (!entry || entry.signature !== signature) return undefined;
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry.data;
  }

  generate(terrain: TerrainComponent, chunk: TerrainChunkKey, signature: string, options: VegetationGenerationOptions): VegetationChunkData {
    const hit = this.get(chunk.id, signature);
    if (hit) return hit;
    const data = generateVegetationChunk(terrain, chunk, options);
    this.generations++;
    const previous = this.entries.get(chunk.id);
    if (previous) { this.weight -= previous.weight; this.entries.delete(chunk.id); }
    const weight = instanceWeight(data);
    this.entries.set(chunk.id, { signature, data, weight });
    this.weight += weight;
    while (this.entries.size > Math.max(1, this.maxEntries) || this.weight > Math.max(0, this.maxInstances)) {
      const first = this.entries.keys().next().value;
      if (first === undefined) break;
      this.weight -= this.entries.get(first)!.weight;
      this.entries.delete(first);
    }
    return data;
  }

  clear(): void { this.entries.clear(); this.weight = 0; }
  get stats() { return { chunks: this.entries.size, instances: this.weight, generations: this.generations }; }
}

/** Conservative local-space region test for the grass shader's world-space fade. */
export function chunkWithinGrassRange(terrain: TerrainComponent, chunk: TerrainChunkKey, x: number, z: number, distance: number): boolean {
  const b = terrainChunkBounds(terrain, chunk.x, chunk.z);
  const dx = Math.max(b.minX - x, 0, x - b.maxX);
  const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
  return dx * dx + dz * dz <= distance * distance;
}

/** Budgets are applied in nearest-first order without changing a region's stable candidate identities. */
export function limitVegetation(data: VegetationChunkData, remaining: VegetationBudget): VegetationChunkData {
  const grass = Math.min(data.grass.length, remaining.grass);
  const trees = Math.min(data.treeModels.length, remaining.trees);
  const flowers = Math.min(data.flowers.length, remaining.flowers);
  let coverRemaining = remaining.groundCover ?? 0;
  const groundCover = {} as GroundCoverMatrices;
  for (const kind of GROUND_COVER_KINDS) {
    const count = Math.min(data.groundCover[kind].length, coverRemaining);
    groundCover[kind] = count === data.groundCover[kind].length ? data.groundCover[kind] : data.groundCover[kind].slice(0, count);
    coverRemaining -= count;
  }
  remaining.groundCover = coverRemaining;
  remaining.grass -= grass; remaining.trees -= trees; remaining.flowers -= flowers;
  if (grass === data.grass.length && trees === data.treeModels.length && flowers === data.flowers.length && GROUND_COVER_KINDS.every(kind => groundCover[kind] === data.groundCover[kind])) return data;
  return {
    groundCover,
    grass: data.grass.slice(0, grass), grassColors: data.grassColors.slice(0, grass),
    flowers: data.flowers.slice(0, flowers), flowerColors: data.flowerColors.slice(0, flowers),
    treeSpecies: data.treeSpecies.slice(0, trees),
    trunks: data.trunks.slice(0, trees), crowns: data.crowns.slice(0, trees), treeModels: data.treeModels.slice(0, trees),
  };
}

/** Explicit cell budget also bounds per-cell materials, draw batches, and cache working set. */
export function vegetationRegionLimit(quality?: string): number {
  return quality === 'Low' ? 25 : quality === 'Medium' ? 49 : quality === 'Epic' ? 121 : 81;
}
