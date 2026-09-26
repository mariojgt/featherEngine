import * as THREE from 'three';
import type { TerrainComponent } from '../types';
import { sampleFoliageMask, sampleTerrainLayerWeights, sampleTerrainLocalHeight, sampleTerrainNormal, terrainChunkBounds, terrainHash01, type TerrainChunkKey } from './terrain';
import { sampleWoodlandHabitat, spacedTreeCandidates, treeCandidateAllowed, vegetationElevationAllowed } from './vegetationRules';

export const WOODLAND_CANOPY_RADIUS = 6;
export const GROUND_COVER_KINDS = ['fern', 'rock', 'wood'] as const;
export type GroundCoverKind = typeof GROUND_COVER_KINDS[number];
export type GroundCoverMatrices = Record<GroundCoverKind, THREE.Matrix4[]>;
export const emptyGroundCover = (): GroundCoverMatrices => ({ fern: [], rock: [], wood: [] });

/** Include adjacent cells so a canopy never stops at a streaming boundary. Computed once per region. */
export function woodlandCanopies(terrain: TerrainComponent, chunk: TerrainChunkKey): Array<{ x: number; z: number }> {
  if (terrain.foliage.distribution !== 'woodland' || !terrain.foliage.treeSpacing || terrain.foliage.mode === 'grass') return [];
  const bounds = terrainChunkBounds(terrain, chunk.x, chunk.z), r = WOODLAND_CANOPY_RADIUS;
  const result: Array<{ x: number; z: number }> = [];
  for (let z = Math.floor((bounds.minZ - r) / terrain.chunkSize); z <= Math.floor((bounds.maxZ + r) / terrain.chunkSize); z++) {
    for (let x = Math.floor((bounds.minX - r) / terrain.chunkSize); x <= Math.floor((bounds.maxX + r) / terrain.chunkSize); x++) {
      const owner = { x, z, id: `${x}:${z}` };
      result.push(...spacedTreeCandidates(terrain, owner).filter(p => treeCandidateAllowed(terrain, p, owner)).slice(0, 256)
        .filter(p => p.x >= bounds.minX-r && p.x <= bounds.maxX+r && p.z >= bounds.minZ-r && p.z <= bounds.maxZ+r));
    }
  }
  return result;
}

export function canopyCover(canopies: readonly { x: number; z: number }[], x: number, z: number): number {
  let cover = 0;
  for (const p of canopies) {
    const d = Math.hypot(p.x - x, p.z - z) / WOODLAND_CANOPY_RADIUS;
    if (d < 1) { const t = 1 - d; cover = Math.max(cover, t * t * (3 - 2 * t)); }
  }
  return cover;
}

/** Stable world grid with small ecological clusters; all authored exclusions remain authoritative. */
export function generateGroundCover(terrain: TerrainComponent, chunk: TerrainChunkKey, canopies: ReturnType<typeof woodlandCanopies>): GroundCoverMatrices {
  const result = emptyGroundCover(), f = terrain.foliage, density = f.understoryDensity ?? 0;
  if (!f.enabled || !f.understoryAssetId || density <= 0 || f.mode === 'trees') return result;
  const bounds = terrainChunkBounds(terrain, chunk.x, chunk.z), spacing = Math.max(1.8, terrain.chunkSize / 64);
  const object = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0), normal = new THREE.Vector3(), alignment = new THREE.Quaternion(), spin = new THREE.Quaternion();
  let count = 0;
  for (let iz = Math.floor(bounds.minZ / spacing); iz < Math.ceil(bounds.maxZ / spacing); iz++) {
    for (let ix = Math.floor(bounds.minX / spacing); ix < Math.ceil(bounds.maxX / spacing) && count < 768; ix++) {
      const x = (ix + .5 + (terrainHash01(terrain.seed+9101,ix,iz)-.5)*.85)*spacing;
      const z = (iz + .5 + (terrainHash01(terrain.seed+9102,ix,iz)-.5)*.85)*spacing;
      if (x < bounds.minX || x >= bounds.maxX || z < bounds.minZ || z >= bounds.maxZ || Math.abs(x) > terrain.size/2 || Math.abs(z) > terrain.size/2) continue;
      const mask = f.usePaintMask ? sampleFoliageMask(terrain,x,z) : 1;
      if (mask <= 0) continue;
      const habitat = sampleWoodlandHabitat(terrain.seed,x,z), canopy = canopyCover(canopies,x,z);
      const roll = terrainHash01(terrain.seed+9103,ix,iz), odds = density * mask;
      const fern = (.025 + .22 * habitat + .4 * canopy) * odds;
      const rock = .035 * odds, wood = (.002 + .009 * canopy) * odds;
      const kind: GroundCoverKind | undefined = roll < wood ? 'wood' : roll < wood+rock ? 'rock' : roll < wood+rock+fern ? 'fern' : undefined;
      if (!kind) continue;
      const h = sampleTerrainLocalHeight(terrain,x,z);
      if (!vegetationElevationAllowed(terrain,h)) continue;
      normal.fromArray(sampleTerrainNormal(terrain,x,z));
      if (normal.y < Math.max(f.slopeLimit,kind==='rock'?.68:.82)) continue;
      const weights = sampleTerrainLayerWeights(terrain,x,z);
      // Explicitly painted cliff/rock excludes plants and wood. Natural soil still supports ferns.
      if (kind !== 'rock' && (weights[2] ?? 0) > .55) continue;
      const scale = THREE.MathUtils.lerp(kind==='fern'?.65:.55,kind==='fern'?1.45:1.35,terrainHash01(terrain.seed+9104,ix,iz));
      alignment.setFromUnitVectors(up,normal);spin.setFromAxisAngle(up,terrainHash01(terrain.seed+9105,ix,iz)*Math.PI*2);
      object.quaternion.copy(alignment).multiply(spin);
      // Scanned stones/roots have uneven lower edges. Sink their footprint into the slope slightly.
      object.position.set(x,h-.025-(kind==='rock'?.12*scale:kind==='wood'?.03*scale:0),z);
      object.scale.setScalar(scale);object.updateMatrix();result[kind].push(object.matrix.clone());count++;
    }
  }
  return result;
}
