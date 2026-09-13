import type { SceneObject } from '../types';
import { removeRawGeometry } from './meshGeometryCache';

// Stick Hero's fixed loose-piece budget adapted to Feather's shared SceneObject runtime.
// Only generated fracture pieces consume these slots; authored props are never evicted.
export const MAX_FRACTURE_DEBRIS = 256;
export const DEFAULT_DEBRIS_LIFETIME = 12;
const debris = new Map<string, { remaining: number; geometryKey?: string }>();

export function registerFractureDebris(object: SceneObject, lifetime = DEFAULT_DEBRIS_LIFETIME): void {
  debris.set(object.id, {
    remaining: Number.isFinite(lifetime) ? Math.max(0.1, Math.min(120, lifetime)) : DEFAULT_DEBRIS_LIFETIME,
    geometryKey: object.renderer?.fragmentKey,
  });
}

function release(id: string): void {
  const piece = debris.get(id);
  if (piece?.geometryKey) removeRawGeometry(piece.geometryKey);
  debris.delete(id);
}

/** Recycle oldest pieces first, release their raw meshes, and leave authored objects untouched. */
export function updateFractureDebris(objects: SceneObject[], delta: number): SceneObject[] {
  if (!debris.size) return objects;
  const liveIds = new Set(objects.map((object) => object.id));
  const removed = new Set<string>();
  const dt = Number.isFinite(delta) ? Math.max(0, delta) : 0;
  for (const [id, piece] of debris) {
    piece.remaining -= dt;
    if (!liveIds.has(id) || piece.remaining <= 0) {
      removed.add(id);
      release(id);
    }
  }
  for (const id of debris.keys()) {
    if (debris.size <= MAX_FRACTURE_DEBRIS) break;
    removed.add(id);
    release(id);
  }
  return removed.size ? objects.filter((object) => !removed.has(object.id)) : objects;
}

export function clearFractureDebris(): void {
  for (const id of debris.keys()) release(id);
}
