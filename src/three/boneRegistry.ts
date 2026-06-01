import type { Object3D } from 'three';

/**
 * Live map of object id → the cloned skinned-model root currently rendered for it. `SkinnedModel`
 * registers its clone here so bone-socket attachments can look up a real `THREE.Bone` and follow it
 * each frame. A plain module singleton (like the drag/mouse-look holders) — not Zustand state — so
 * it never triggers re-renders.
 */
const roots = new Map<string, Object3D>();

export function registerSkinnedRoot(objectId: string, root: Object3D) {
  roots.set(objectId, root);
}

export function unregisterSkinnedRoot(objectId: string, root: Object3D) {
  // Only clear if the current entry is the one unmounting (guards against clone swaps).
  if (roots.get(objectId) === root) roots.delete(objectId);
}

/** The named bone within a registered character's skeleton, or null if not loaded/found. */
export function getBone(objectId: string, boneName: string): Object3D | null {
  return roots.get(objectId)?.getObjectByName(boneName) ?? null;
}
