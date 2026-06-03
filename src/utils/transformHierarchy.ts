import * as THREE from 'three';
import type { SceneObject, TransformComponent } from '../types';

/**
 * Parent/child transforms in this engine are a proper scene graph: an object's `transform` is
 * stored in LOCAL space (relative to its parent). For a root object (no `parentId`) local == world.
 * These helpers convert between the two so systems that need world coordinates (gizmos, reparenting,
 * physics spawn) — and the editor UI that edits local values — stay consistent.
 */

/** Compose a local transform (position / Euler rotation / scale) into a matrix. */
export function composeMatrix(t: TransformComponent): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(t.position[0], t.position[1], t.position[2]),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(t.rotation[0], t.rotation[1], t.rotation[2])),
    new THREE.Vector3(t.scale[0], t.scale[1], t.scale[2]),
  );
}

/** Decompose a matrix back into a transform (Euler rotation). */
export function decomposeToTransform(m: THREE.Matrix4): TransformComponent {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  m.decompose(p, q, s);
  const e = new THREE.Euler().setFromQuaternion(q);
  return {
    position: [p.x, p.y, p.z],
    rotation: [e.x, e.y, e.z],
    scale: [s.x, s.y, s.z],
  };
}

/**
 * World matrix of `id` by walking up the `parentId` chain and multiplying local matrices.
 * `depth` guards against accidental cycles (the store rejects them, but be defensive).
 */
export function worldMatrixOf(byId: Map<string, SceneObject>, id: string, depth = 0): THREE.Matrix4 {
  const obj = byId.get(id);
  if (!obj) return new THREE.Matrix4();
  const local = composeMatrix(obj.transform);
  if (!obj.parentId || obj.parentId === id || depth > 256) return local;
  return worldMatrixOf(byId, obj.parentId, depth + 1).multiply(local);
}

/** The world-space transform of an object, accounting for every ancestor. */
export function worldTransformOf(objects: SceneObject[], id: string): TransformComponent {
  const byId = new Map(objects.map((o) => [o.id, o]));
  return decomposeToTransform(worldMatrixOf(byId, id));
}

/**
 * Given a desired WORLD transform and a (new) parent, return the LOCAL transform that places the
 * object there. With no parent the world transform IS the local transform.
 */
export function worldToLocalUnderParent(
  objects: SceneObject[],
  world: TransformComponent,
  parentId?: string,
): TransformComponent {
  if (!parentId) return world;
  const byId = new Map(objects.map((o) => [o.id, o]));
  const parentWorld = worldMatrixOf(byId, parentId);
  const local = parentWorld.clone().invert().multiply(composeMatrix(world));
  return decomposeToTransform(local);
}
