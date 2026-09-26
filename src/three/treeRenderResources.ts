import * as THREE from 'three';
import type { GeneratedTree } from '../tree/generateTree';
import { generateTree } from '../tree/generateTree';
import type { TreeSpec } from '../types';

const MAX_UNUSED_TREE_GEOMETRIES = 48;
const MAX_TREE_INTERACTION_STRENGTH = 3;

interface CacheEntry {
  tree: GeneratedTree;
  refs: number;
  lastUsed: number;
}

export interface TreeGeometryLease {
  key: string;
  tree: GeneratedTree;
}

const cache = new Map<string, CacheEntry>();
let useCounter = 0;

const geometryKey = (spec: TreeSpec, seed: number, level: number) => {
  const { id: _id, name: _name, lod: _lod, look, ...shape } = spec;
  const { surface: _surface, translucency: _translucency, ...colors } = look;
  return `${seed | 0}:${level}:${JSON.stringify([shape, colors])}`;
};

/** Scale-aware distance selection with a dead band so a stationary tree cannot flicker between LODs. */
export function selectTreeLod(distance: number, spec: TreeSpec, previous = 0, scale = 1, qualityScale = 1): number {
  const levels = Math.min(spec.lod.levels, 3);
  const scaledDistance = Math.max(0, distance) / Math.max(0.001, scale * qualityScale);
  let next = Math.min(levels, Math.max(0, previous));
  const threshold = (index: number) => spec.lod.distances[index] ?? (spec.lod.distances.at(-1) ?? 60) * (index + 1);
  while (next < levels && scaledDistance > threshold(next) * 1.12) next++;
  while (next > 0 && scaledDistance < threshold(next - 1) * 0.88) next--;
  return next;
}

/** Wind and actor interaction happen in the vertex shader, so CPU bounds need explicit headroom. */
export function expandTreeGeometryBounds(tree: GeneratedTree, spec: TreeSpec): void {
  const amplitude = THREE.MathUtils.clamp(spec.trunk.height * 0.045, 0.05, 0.65);
  tree.bounds.makeEmpty();
  for (const geometry of [tree.bark, tree.foliage]) {
    if (!geometry) continue;
    let maxWind = 0, maxCard = 0;
    const wind = geometry.getAttribute('aWind'), card = geometry.getAttribute('aCardOffset');
    for (let i = 0; i < wind.count; i++) maxWind = Math.max(maxWind, Math.abs(wind.getX(i)));
    for (let i = 0; i < card.count; i++) maxCard = Math.max(maxCard, Math.hypot(card.getX(i), card.getY(i)) * 2);
    // Matches the capped wind magnitude, gust/cross/vertical terms and eight strongest interactors.
    const margin = maxWind * (amplitude * 2.05 * 1.57 + 8 * MAX_TREE_INTERACTION_STRENGTH * 0.35) + maxCard;
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    geometry.boundingBox?.expandByScalar(margin);
    if (geometry.boundingSphere) geometry.boundingSphere.radius += margin;
    if (geometry.boundingBox) tree.bounds.union(geometry.boundingBox);
  }
}

function disposeEntry(entry: CacheEntry): void {
  entry.tree.bark.dispose();
  entry.tree.foliage?.dispose();
}

function evictUnused(): void {
  const unused = [...cache.entries()]
    .filter(([, entry]) => entry.refs === 0)
    .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  while (unused.length > MAX_UNUSED_TREE_GEOMETRIES) {
    const [key, entry] = unused.shift()!;
    cache.delete(key);
    disposeEntry(entry);
  }
}

/** Acquire a shared generated tree. The matching release is required on component cleanup. */
export function acquireTreeGeometry(spec: TreeSpec, seed: number, lod = 0): TreeGeometryLease {
  const key = geometryKey(spec, seed, lod);
  let entry = cache.get(key);
  if (!entry) {
    const tree = generateTree(spec, seed, { lod });
    expandTreeGeometryBounds(tree, spec);
    entry = { tree, refs: 0, lastUsed: ++useCounter };
    cache.set(key, entry);
  }
  entry.refs += 1;
  entry.lastUsed = ++useCounter;
  return { key, tree: entry.tree };
}

export function releaseTreeGeometry(lease: TreeGeometryLease): void {
  const entry = cache.get(lease.key);
  if (!entry || entry.tree !== lease.tree) return;
  entry.refs = Math.max(0, entry.refs - 1);
  entry.lastUsed = ++useCounter;
  evictUnused();
}

/** Test/dev diagnostics; production callers should only acquire/release leases. */
export function treeGeometryCacheStats(): { entries: number; referenced: number; unused: number } {
  const values = [...cache.values()];
  return {
    entries: values.length,
    referenced: values.filter((entry) => entry.refs > 0).length,
    unused: values.filter((entry) => entry.refs === 0).length,
  };
}

/** Test/dev cleanup. Refuse to invalidate geometry that a mounted renderer still owns. */
export function clearUnusedTreeGeometryCache(): number {
  let disposed = 0;
  for (const [key, entry] of cache) {
    if (entry.refs > 0) continue;
    cache.delete(key);
    disposeEntry(entry);
    disposed += 1;
  }
  return disposed;
}

/** A placement's variant depends only on its transform, never its position in an input array. */
export function treePlacementVariant(matrix: THREE.Matrix4, variantCount: number): number {
  const count = Math.max(1, Math.trunc(variantCount));
  let hash = 2166136261;
  for (const value of matrix.elements) {
    const quantized = Math.round(value * 10_000);
    hash = Math.imul(hash ^ quantized, 16777619);
  }
  return (hash >>> 0) % count;
}

export interface TreePlacementBatch {
  key: string;
  variant: number;
  matrices: THREE.Matrix4[];
}

/** Spatial cells keep an off-screen part of a forest from pinning the whole stand inside the frustum. */
export function batchTreePlacements(
  matrices: THREE.Matrix4[],
  variantCount: number,
  cellSize = 32,
): TreePlacementBatch[] {
  const safeCell = Math.max(4, cellSize);
  const batches = new Map<string, TreePlacementBatch>();
  const position = new THREE.Vector3();
  for (const matrix of matrices) {
    position.setFromMatrixPosition(matrix);
    const x = Math.floor(position.x / safeCell);
    const z = Math.floor(position.z / safeCell);
    const variant = treePlacementVariant(matrix, variantCount);
    const key = `${x}:${z}:${variant}`;
    const batch = batches.get(key) ?? { key, variant, matrices: [] };
    batch.matrices.push(matrix);
    batches.set(key, batch);
  }
  return [...batches.values()].sort((a, b) => a.key.localeCompare(b.key));
}
