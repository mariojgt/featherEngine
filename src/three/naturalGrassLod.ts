import * as THREE from 'three';
import type { QualityLevel } from '../types';

export type NaturalGrassDetail = 0 | 1 | 2;

export interface NaturalGrassAssignment {
  key: string;
  matrix: THREE.Matrix4;
  detail: NaturalGrassDetail;
}

const DETAIL_DISTANCES: Record<QualityLevel, readonly [number, number]> = {
  Low: [8, 20],
  Medium: [13, 31],
  High: [18, 43],
  Epic: [24, 56],
};

const PLACEMENT_KEY_CACHE = new WeakMap<THREE.Matrix4, string>();

/** Stable key for hysteresis; placement ordering or streaming does not change an instance's identity. */
export function naturalGrassPlacementKey(matrix: THREE.Matrix4): string {
  const cached = PLACEMENT_KEY_CACHE.get(matrix);
  if (cached) return cached;
  const key = matrix.elements.map((value) => Math.round(value * 10_000)).join(',');
  PLACEMENT_KEY_CACHE.set(matrix, key);
  return key;
}

/** Three distance bands with a small dead band to prevent LOD chatter at the boundaries. */
export function selectNaturalGrassDetail(
  distance: number,
  quality: QualityLevel,
  previous: NaturalGrassDetail = 2,
): NaturalGrassDetail {
  const thresholds = DETAIL_DISTANCES[quality] ?? DETAIL_DISTANCES.High;
  let next = THREE.MathUtils.clamp(Math.trunc(previous), 0, 2) as NaturalGrassDetail;
  while (next < 2 && Math.max(0, distance) > thresholds[next as 0 | 1] * 1.1) next = (next + 1) as NaturalGrassDetail;
  while (next > 0 && Math.max(0, distance) < thresholds[(next - 1) as 0 | 1] * 0.9) next = (next - 1) as NaturalGrassDetail;
  return next;
}

/**
 * World-space per-placement culling and detail selection. `fadeEnd` and both padding values are metres;
 * placement scale only expands the source patch radius used by the frustum test.
 */
export function partitionNaturalGrassPlacements(
  matrices: readonly THREE.Matrix4[],
  cameraWorldPosition: THREE.Vector3,
  parentWorldMatrix: THREE.Matrix4,
  quality: QualityLevel,
  previousDetails: ReadonlyMap<string, NaturalGrassDetail> = new Map(),
  fadeEnd?: number,
  frustum?: THREE.Frustum,
  sourceRadius = 0,
  deformationPadding = 0,
): NaturalGrassAssignment[] {
  const world = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const sphere = new THREE.Sphere();
  const finiteFadeEnd = fadeEnd !== undefined && Number.isFinite(fadeEnd) && fadeEnd >= 0
    ? fadeEnd
    : undefined;
  const assignments: NaturalGrassAssignment[] = [];
  for (const matrix of matrices) {
    world.multiplyMatrices(parentWorldMatrix, matrix);
    position.setFromMatrixPosition(world);
    const distance = position.distanceTo(cameraWorldPosition);
    if (finiteFadeEnd !== undefined && distance > finiteFadeEnd + Math.max(0, deformationPadding)) continue;
    if (frustum) {
      sphere.center.copy(position);
      sphere.radius = Math.max(0, sourceRadius) * world.getMaxScaleOnAxis() + Math.max(0, deformationPadding);
      if (!frustum.intersectsSphere(sphere)) continue;
    }
    const key = naturalGrassPlacementKey(matrix);
    assignments.push({
      key,
      matrix,
      detail: selectNaturalGrassDetail(distance, quality, previousDetails.get(key) ?? 2),
    });
  }
  return assignments;
}

/**
 * Reindex a deterministic subset of the full patch. Lower detail tiers retain exact source blades, so
 * transitions remove coverage without moving or reseeding the surviving blades.
 */
export function createNaturalGrassBladeSubset(
  source: THREE.BufferGeometry,
  stride: number,
): THREE.BufferGeometry {
  const cost = source.userData.naturalGrass as { blades?: number; triangles?: number } | undefined;
  const bladeCount = cost?.blades;
  const triangleCount = cost?.triangles;
  const sourceIndex = source.getIndex();
  if (!sourceIndex || !bladeCount || !triangleCount || triangleCount % bladeCount !== 0) {
    throw new Error('Natural grass source geometry must provide indexed per-blade cost metadata');
  }
  const safeStride = Math.max(1, Math.trunc(stride));
  const indicesPerBlade = triangleCount / bladeCount * 3;
  const selected: number[] = [];
  for (let blade = 0; blade < bladeCount; blade += safeStride) {
    const first = blade * indicesPerBlade;
    for (let index = 0; index < indicesPerBlade; index += 1) selected.push(sourceIndex.getX(first + index));
  }
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
  geometry.morphAttributes = source.morphAttributes;
  geometry.morphTargetsRelative = source.morphTargetsRelative;
  geometry.setIndex(selected);
  geometry.boundingBox = source.boundingBox?.clone() ?? null;
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  geometry.userData.naturalGrass = Object.freeze({
    ...cost,
    blades: Math.ceil(bladeCount / safeStride),
    triangles: selected.length / 3,
  });
  return geometry;
}
