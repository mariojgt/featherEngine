// Single source of truth for collider geometry.
//
// Both the headless Rapier runtime ([physicsWorld.ts]) and the editor's collider
// preview gizmo ([../three/ColliderGizmo.tsx]) must agree on the EXACT shape and
// size of every object's collider — otherwise the wireframe would lie about what
// the simulation actually uses. So the shape resolution and dimension math live
// here (pure, no Rapier/three imports) and are consumed by both.

import type { SceneObject } from '../types';

export type ColliderKind = 'box' | 'sphere' | 'capsule' | 'plane' | 'trimesh' | 'convex' | 'model';

/** Resolve which collider shape an object uses, honoring its configured collider and mesh. */
export function colliderKindFor(object: SceneObject): ColliderKind {
  // A plane is always a thin slab oriented by the object's rotation (matches the
  // flat ground / wall the mesh draws), regardless of the configured collider.
  if (object.renderer?.mesh === 'plane') return 'plane';
  const configured = object.physics?.collider;
  // "Use the mesh itself": trimesh = exact triangles (best for static geometry),
  // convex = the convex hull (cheaper, works for dynamic bodies).
  if (configured === 'mesh') return 'trimesh';
  if (configured === 'convex') return 'convex';
  if (configured === 'sphere' || configured === 'capsule') return configured;
  if (object.renderer?.mesh === 'sphere') return 'sphere';
  if (object.renderer?.mesh === 'capsule') return 'capsule';
  // A Model Forge prop (kit-bashed parts, no renderer/mesh component) is NOT a lone box: its collider
  // is derived from the model spec's parts (see forgeModelGeometry). The default 'box' collider on such
  // a prop reads as "auto" — pick the real parts shape. (Explicit mesh/convex/sphere/capsule still win
  // above; a plain primitive box on a forge prop isn't selectable, mesh-accurate is the point.)
  if ((configured === undefined || configured === 'box') && object.model?.enabled && object.model.spec?.parts?.length) {
    return 'model';
  }
  // Live-linked library props: the spec lives in the store (resolved at runtime), so check specId too.
  if ((configured === undefined || configured === 'box') && object.model?.enabled && object.model.specId) return 'model';
  return 'box';
}

/** Per-axis object scale, clamped away from zero so colliders never collapse. */
export function halfScale(object: SceneObject): [number, number, number] {
  const s = object.transform.scale;
  return [
    Math.max(Math.abs(s[0]), 0.01),
    Math.max(Math.abs(s[1]), 0.01),
    Math.max(Math.abs(s[2]), 0.01),
  ];
}

/** Full box extents (width/height/depth) — equals the object scale on each axis. */
export function boxExtents(object: SceneObject): [number, number, number] {
  return halfScale(object);
}

/** Sphere collider radius: 0.55 × the largest axis (matches the built-in sphere mesh). */
export function sphereRadius(object: SceneObject): number {
  const [sx, sy, sz] = halfScale(object);
  return 0.55 * Math.max(sx, sy, sz);
}

/** Capsule collider params (matches capsuleGeometry(0.34, 0.82) scaled by the object). */
export function capsuleParams(object: SceneObject): { halfHeight: number; radius: number } {
  const [sx, sy, sz] = halfScale(object);
  return { halfHeight: 0.41 * sy, radius: 0.34 * Math.max(sx, sz) };
}

/** Plane collider extents: a thin slab in the object's local XY plane. */
export function planeExtents(object: SceneObject): [number, number, number] {
  const [sx, sy] = halfScale(object);
  return [sx, sy, 0.04];
}
