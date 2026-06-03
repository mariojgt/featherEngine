import type { SceneObject, Vector3Tuple } from '../types';

/**
 * Runtime transform buffer — the "simulation writes here, the renderer reads here" channel that
 * decouples Play-mode motion from React.
 *
 * During Play, `tickRuntime` publishes every object's final transform into this mutable Map each
 * frame, and each `SceneObjectView` reads its own entry in a `useFrame` and applies it imperatively
 * to its group. Because the transform no longer flows through React props, a moving object's React
 * subtree (mesh + material) does NOT reconcile every frame — only genuine structural/material
 * changes do. tickRuntime still writes transforms into the Zustand store as well, so the Inspector,
 * gizmos, and save continue to work; this buffer is purely the high-frequency render path.
 *
 * Entries hold references to the transform tuples tickRuntime produces. Moved objects get fresh
 * tuples each frame (`{ ...object, transform: {...} }`), so holding the reference is safe.
 */
export interface BufferedTransform {
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: Vector3Tuple;
}

const buffer = new Map<string, BufferedTransform>();

/** Called once per tick with the frame's final object array. O(n) map writes, zero allocation. */
export const publishTransforms = (objects: SceneObject[]) => {
  for (const object of objects) buffer.set(object.id, object.transform);
};

export const readTransform = (id: string): BufferedTransform | undefined => buffer.get(id);

/** Cleared on Stop so a fresh Play session doesn't read stale positions. */
export const clearTransformBuffer = () => buffer.clear();
