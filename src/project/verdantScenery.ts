import * as THREE from 'three';
import treeClearance from '../terrain/models/verdant-tree-clearance.json';
import type { AssetItem, TerrainComponent, Vector3Tuple } from '../types';
import { sampleTerrainLocalHeight, terrainHash01 } from '../terrain/terrain';
import shelfUrl from '../terrain/models/verdant-rock-shelf.glb?url';
import cragUrl from '../terrain/models/verdant-rock-crag.glb?url';
import boulderUrl from '../terrain/models/verdant-rock-boulder.glb?url';
import shrubUrl from '../terrain/models/verdant-shrub.glb?url';
import fernUrl from '../terrain/models/verdant-fern-bank.glb?url';

export const VERDANT_SCENERY_ASSETS = [
  ['verdant-rock-shelf', shelfUrl], ['verdant-rock-crag', cragUrl],
  ['verdant-rock-boulder', boulderUrl], ['verdant-fern-bank', fernUrl], ['verdant-shrub', shrubUrl],
] as const;
export async function verdantSceneryAssets(): Promise<AssetItem[]> {
  return Promise.all(VERDANT_SCENERY_ASSETS.map(async ([id, url]) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Missing Verdant scenery: ${id}`);
    const bytes = await response.arrayBuffer();
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(new Blob([bytes], { type: 'model/gltf-binary' }));
    });
    return { id, name: `${id}.glb`, type: 'model', size: bytes.byteLength, data, createdAt: 0 };
  }));
}
export interface VerdantProp {
  assetId: string; position: Vector3Tuple; scale: Vector3Tuple; yaw: number;
  /** Conservative horizontal footprint and top of the embedded scan, for camera/exclusion checks. */
  radius: number; top: number;
}
const ROCK_FORMS = ['verdant-rock-shelf', 'verdant-rock-crag', 'verdant-rock-boulder'];
// Asymmetric outcrops: one tall anchor, offset ledges and smaller talus, with open space between groups.
const OUTCROPS = [[-5, 1, 1.25], [0, 8, .65], [-17, -13, 1.05], [18, -9, 1.2],
  [0, -27, .95], [29, 8, .8], [-25, 24, .8], [-32, -38, 1.1], [28, -37, 1]];
export function verdantRocks(terrain: TerrainComponent): VerdantProp[] {
  return OUTCROPS.flatMap(([x, z, size], group) => [
    [0, 0, 5.2, 5.4, 4.8, 1], [-3.2, 1.1, 4.8, 2.7, 3.2, 0],
    [2.9, 1.8, 2.9, 2.4, 3.4, 2], [1, -3, 2.3, 1.5, 2.6, group % 3],
  ].map(([dx, dz, sx, sy, sz, variant], i) => {
    const angle = group * 1.73, px = x + (dx * Math.cos(angle) - dz * Math.sin(angle)) * size;
    const pz = z + (dx * Math.sin(angle) + dz * Math.cos(angle)) * size;
    const scale: Vector3Tuple = [sx * size, sy * size, sz * size];
    const y = sampleTerrainLocalHeight(terrain, px, pz) - .08;
    return { assetId: ROCK_FORMS[variant], position: [px, y, pz] as Vector3Tuple, scale,
      yaw: angle + i * 2.13, radius: Math.hypot(.64 * scale[0], .86 * scale[2]), top: y + .56 * scale[1] };
  }));
}
/** Low fern thickets ring the outcrops, leaving the worn clearing open. No extra terrain or renderer. */
export function verdantFernBanks(terrain: TerrainComponent, rocks: VerdantProp[], paths: Vector3Tuple[]): VerdantProp[] {
  const banks: VerdantProp[] = [];
  for (let z = -42; z <= 32; z += 3.1) for (let x = -35; x <= 34; x += 3.1) {
    const seed = terrainHash01(941, Math.round(x * 10), Math.round(z * 10));
    const px = x + Math.sin(seed * 45), pz = z + Math.cos(seed * 67);
    const near = Math.min(...OUTCROPS.map(([rx, rz]) => Math.hypot(px - rx, pz - rz)));
    if (near < 3 || near > 11 || seed > .72 || rocks.some(r => Math.hypot(px - r.position[0], pz - r.position[2]) < r.radius * .65)) continue;
    if (paths.some(p => Math.hypot(px - p[0], pz - p[2]) < 2.2)) continue;
    const size = .8 + seed * 1.2;
    banks.push({ assetId: seed < .32 ? 'verdant-shrub' : 'verdant-fern-bank', position: [px, sampleTerrainLocalHeight(terrain, px, pz) - .03, pz],
      scale: [size * (seed < .32 ? 1.7 : 1), size * (.7 + seed * .35), size * (seed < .32 ? 1.7 : 1)], yaw: seed * Math.PI * 2, radius: size, top: 1 });
  }
  return banks;
}

/** Solid-wood envelopes include leaning trunks and branches, not just root positions. */
export function verdantTreeClearance(matrices: THREE.Matrix4[]): (position: Vector3Tuple) => number {
  const trees = matrices.map(matrix=>({inverse:matrix.clone().invert(),scale:matrix.getMaxScaleOnAxis()}));
  const boxes = treeClearance.slabs.map(slab=>new THREE.Box3(new THREE.Vector3(...slab.min),new THREE.Vector3(...slab.max)));
  const point = new THREE.Vector3();
  return position => {
    let clearance = Infinity;
    for (const tree of trees) {
      point.fromArray(position).applyMatrix4(tree.inverse);
      for (const box of boxes) clearance=Math.min(clearance,box.distanceToPoint(point)*tree.scale);
    }
    return clearance;
  };
}
