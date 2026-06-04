import { createContext, useContext, useSyncExternalStore } from 'react';
import type { SceneObject } from '../types';

/**
 * GPU instancing for repeated static decoration models (towers, props, foliage, streetlights…). Each
 * such object normally renders as its own cloned glTF = its own draw calls; a scene with 200 identical
 * props is 200+ draws. Instancing collapses every instance of the same model into ONE InstancedMesh
 * per submesh — a big draw-call cut in dense decorative scenes.
 *
 * Scope (deliberately conservative — this is correctness-critical and only the safe subset is batched):
 *  - Active ONLY during Play. In the editor each object keeps its own mesh so click-select, the gizmo,
 *    and live material edits work unchanged; instancing turns on when you press Play.
 *  - Gated behind a runtime toggle (default OFF — see {@link setInstancingEnabled}; wired to the F8
 *    perf overlay). Off-by-default means it can never regress existing rendering until explicitly on.
 *  - Only objects that use the model's BAKED materials (no per-object override) and are otherwise
 *    static + non-interactive qualify, so every instance in a batch shares one material and never moves.
 */

/** Fewer instances than this isn't worth a batch — keep them as individual meshes. */
const INSTANCE_MIN_BATCH = 4;

let enabled = false;
const listeners = new Set<() => void>();

export const getInstancingEnabled = (): boolean => enabled;
export const setInstancingEnabled = (value: boolean): void => {
  if (value === enabled) return;
  enabled = value;
  listeners.forEach((l) => l());
};
export const toggleInstancing = (): void => setInstancingEnabled(!enabled);

/** Subscribe to the on/off toggle (for useSyncExternalStore). */
function subscribeInstancing(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** React hook: re-renders when the instancing toggle flips. */
export function useInstancingEnabled(): boolean {
  return useSyncExternalStore(subscribeInstancing, getInstancingEnabled, getInstancingEnabled);
}

/**
 * True if `o` is a static decoration model safe to batch into an InstancedMesh: an imported model that
 * uses its baked materials (no color/material/texture override → all instances share one material),
 * opaque, at the scene root, with no script / physics / animator / character / vehicle / attachment /
 * particles / light / terrain / projectile / effect / fracture / UI. Such an object never moves and is
 * never individually interactive during Play, so a shared instanced draw is indistinguishable from its
 * own mesh.
 */
export function isInstanceable(o: SceneObject): boolean {
  const r = o.renderer;
  if (!r?.enabled || !r.modelAssetId) return false;
  if (r.overrideMaterial || r.materialId || r.materialOverrides || r.textureAssetId || r.fragmentKey) return false;
  if (r.opacity !== undefined && r.opacity < 1) return false; // transparency needs per-instance sorting
  if (o.parentId) return false; // root only — a child of a moving parent would move
  if (o.script?.enabled || o.physics?.enabled || o.animator?.enabled) return false;
  if (o.character || o.vehicle || o.attachment || o.viewModel || o.ui) return false;
  if (o.terrain?.enabled || o.fracture?.enabled) return false;
  if (o.projectile || o.effect || o.particles || o.light) return false;
  if (o.kind === 'light' || o.kind === 'camera' || o.kind === 'empty' || o.kind === 'terrain') return false;
  return true;
}

/**
 * Group instanceable objects by model asset id, dropping groups below the batch threshold. Returns a
 * map of modelAssetId → the objects that should be drawn as that batch. Pure; cheap to call.
 */
export function computeInstanceBatches(objects: SceneObject[]): Map<string, SceneObject[]> {
  const byModel = new Map<string, SceneObject[]>();
  for (const o of objects) {
    if (!isInstanceable(o)) continue;
    const key = o.renderer!.modelAssetId!;
    const arr = byModel.get(key);
    if (arr) arr.push(o);
    else byModel.set(key, [o]);
  }
  for (const [key, arr] of byModel) if (arr.length < INSTANCE_MIN_BATCH) byModel.delete(key);
  return byModel;
}

/**
 * A stable structural signature of the current batches. The active-scene object array gets a NEW
 * identity every tick during Play (even when nothing structural changed), so we key batch rebuilds on
 * this string — it only changes when an instanceable object is added/removed/hidden, NOT when one moves.
 */
export function batchSignature(batches: Map<string, SceneObject[]>): string {
  if (batches.size === 0) return '';
  const parts: string[] = [];
  for (const [model, objs] of batches) {
    parts.push(`${model}:${objs.map((o) => o.id).join(',')}`);
  }
  return parts.sort().join('|');
}

/** Stable empty batch map reused when instancing is off — avoids allocating a Map every render. */
export const EMPTY_INSTANCE_BATCHES: Map<string, SceneObject[]> = new Map();

/** Object ids currently drawn by an instanced batch — their per-object Primitive must NOT also draw. */
export const InstancedIdsContext = createContext<ReadonlySet<string>>(new Set());

/** Hook for the per-object Primitive: is this object being drawn by an instanced batch right now? */
export function useIsInstanced(id: string): boolean {
  return useContext(InstancedIdsContext).has(id);
}
