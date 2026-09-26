import type { TerrainComponent, TerrainTreeSpecies } from '../types';
import { terrainHash01, terrainChunkBounds, sampleTerrainNormal, sampleFoliageMask, sampleTerrainLocalHeight, type TerrainChunkKey } from './terrain';

export function chooseTreeSpecies(species: TerrainTreeSpecies[] | undefined, value: number): string | undefined {
  if (!species?.length) return undefined;
  const total = species.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  if (total <= 0) return undefined;
  let target = Math.min(1 - Number.EPSILON, Math.max(0, value)) * total;
  for (const entry of species) {
    target -= Math.max(0, entry.weight);
    if (target < 0) return entry.specId;
  }
  return species[species.length - 1].specId;
}

export function vegetationElevationAllowed(terrain: TerrainComponent, height: number): boolean {
  const { minElevation, maxElevation } = terrain.foliage;
  return (minElevation === undefined || height >= minElevation) && (maxElevation === undefined || height <= maxElevation);
}

/** Smooth, seeded habitat patches in terrain-local coordinates; independent of streaming order. */
export function sampleWoodlandHabitat(seed: number, x: number, z: number): number {
  const noise = (size: number, offset: number) => {
    const gx = x / size, gz = z / size, ix = Math.floor(gx), iz = Math.floor(gz);
    const smooth = (t: number) => t*t*(3-2*t), u = smooth(gx-ix), v = smooth(gz-iz);
    const a = terrainHash01(seed+offset,ix,iz), b = terrainHash01(seed+offset,ix+1,iz);
    const c = terrainHash01(seed+offset,ix,iz+1), d = terrainHash01(seed+offset,ix+1,iz+1);
    return (a+(b-a)*u)*(1-v)+(c+(d-c)*u)*v;
  };
  const value = noise(30, 8201)*.7 + noise(83, 8202)*.3;
  const t = Math.max(0, Math.min(1, (value-.22)/.52));
  return t*t*(3-2*t);
}

/** Shared acceptance ensures grass and understorey react to the trees that can actually grow here. */
export function treeCandidateAllowed(terrain: TerrainComponent, candidate: { x: number; z: number; key: number }, chunk: TerrainChunkKey): boolean {
  const { x, z, key } = candidate, f = terrain.foliage;
  if (Math.abs(x) > terrain.size/2 || Math.abs(z) > terrain.size/2) return false;
  if (sampleTerrainNormal(terrain,x,z)[1] < Math.max(f.slopeLimit,.74)) return false;
  if (f.usePaintMask) {
    const mask = sampleFoliageMask(terrain,x,z);
    if (mask <= 0 || terrainHash01(terrain.seed+7005,chunk.x,chunk.z,key) > mask) return false;
  }
  return vegetationElevationAllowed(terrain,sampleTerrainLocalHeight(terrain,x,z));
}

/** A globally anchored, priority-thinned jittered grid. Neighbor tests keep spacing across chunk seams. */
export function spacedTreeCandidates(terrain: TerrainComponent, chunk: TerrainChunkKey): Array<{ x: number; z: number; key: number }> {
  const spacing = Math.max(terrain.foliage.treeSpacing ?? 0, 2, terrain.chunkSize / 48);
  const probability = Math.min(1, 0.006 * (terrain.foliage.usePaintMask ? 1 : terrain.foliage.treeDensity) * spacing * spacing);
  if (!probability) return [];
  const bounds = terrainChunkBounds(terrain, chunk.x, chunk.z);
  const cell = (x: number, z: number) => {
    const px = (x + 0.5 + (terrainHash01(terrain.seed + 8001, x, z) - 0.5) * 0.36) * spacing;
    const pz = (z + 0.5 + (terrainHash01(terrain.seed + 8002, x, z) - 0.5) * 0.36) * spacing;
    const habitat = terrain.foliage.distribution === 'woodland' ? .08 + 1.9 * sampleWoodlandHabitat(terrain.seed, px, pz) : 1;
    return { x: px, z: pz, priority: terrainHash01(terrain.seed + 8003, x, z),
      occupied: terrainHash01(terrain.seed + 8004, x, z) < Math.min(1, probability * habitat),
      key: Math.floor(terrainHash01(terrain.seed + 8005, x, z) * 2147483647) };
  };
  const result: Array<{ x: number; z: number; key: number }> = [];
  for (let z = Math.floor(bounds.minZ / spacing) - 1; z <= Math.floor(bounds.maxZ / spacing) + 1; z++) {
    for (let x = Math.floor(bounds.minX / spacing) - 1; x <= Math.floor(bounds.maxX / spacing) + 1; x++) {
      const current = cell(x, z);
      if (!current.occupied || current.x < bounds.minX || current.x >= bounds.maxX || current.z < bounds.minZ || current.z >= bounds.maxZ) continue;
      let survives = true;
      for (let dz = -1; dz <= 1 && survives; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const neighbor = cell(x + dx, z + dz);
        const earlier = neighbor.priority < current.priority || (neighbor.priority === current.priority && (dz < 0 || (!dz && dx < 0)));
        if (neighbor.occupied && earlier && Math.hypot(neighbor.x - current.x, neighbor.z - current.z) < spacing) {
          survives = false;
          break;
        }
      }
      if (survives) result.push({ x: current.x, z: current.z, key: current.key });
    }
  }
  return result;
}
