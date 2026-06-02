// Bridges rendered model geometry to the headless physics runtime.
//
// The Rapier world ([physicsWorld.ts]) only ever sees plain `SceneObject` data —
// it has no access to the loaded glTF meshes living in the render tree. But a
// "use the mesh itself" collider (trimesh / convex hull) needs the actual vertices.
// So when [../three/ModelAsset.tsx] loads a model it registers the merged geometry
// here, keyed by the model asset id, and the physics runtime + collider gizmo read
// it back out. Geometry is stored in the model's LOCAL space (the object's own
// transform.scale is applied later by whoever builds the collider).

import * as THREE from 'three';

export interface ModelGeometry {
  /** Flat [x,y,z, x,y,z, ...] vertex positions in the model's local space. */
  vertices: Float32Array;
  /** Triangle indices into `vertices` (every 3 = one triangle). */
  indices: Uint32Array;
}

const cache = new Map<string, ModelGeometry>();

// Bumped whenever a new model's geometry arrives. Consumers (physics signatures,
// the gizmo) watch this so a collider built before the mesh loaded gets rebuilt
// once the real geometry is available.
let version = 0;

export function meshGeometryVersion(): number {
  return version;
}

export function getModelGeometry(key: string | undefined): ModelGeometry | undefined {
  return key ? cache.get(key) : undefined;
}

const reuse = new THREE.Matrix4();
const identity = new THREE.Matrix4();

/**
 * Merge every mesh under `root` into one triangle soup, expressed in the frame of
 * `root`'s PARENT, and cache it. `root` is the exact node ModelAsset hands to
 * `<primitive>`; by the time this runs it's mounted under the object's transform
 * group, so we strip that group (parent) back out — leaving geometry in the same
 * local frame the object group renders, which folds in ModelAsset's normalization
 * wrapper but NOT the object's transform.scale. Whoever builds a collider then
 * applies the object's scale on top (exactly once). No-op if `key` is empty.
 */
export function registerModelGeometry(key: string | undefined, root: THREE.Object3D): void {
  if (!key || cache.has(key)) return;

  root.updateWorldMatrix(true, true);
  // Bring world-space vertices back into root's parent-local frame (identity if unparented).
  const parentInverse = root.parent ? root.parent.matrixWorld.clone().invert() : identity;

  const positions: number[] = [];
  const indices: number[] = [];

  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geom = mesh.geometry as THREE.BufferGeometry;
    const pos = geom.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!pos) return;

    reuse.multiplyMatrices(parentInverse, mesh.matrixWorld);
    const base = positions.length / 3;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(reuse);
      positions.push(v.x, v.y, v.z);
    }

    const idx = geom.getIndex();
    if (idx) {
      for (let i = 0; i < idx.count; i++) indices.push(base + idx.getX(i));
    } else {
      // Non-indexed geometry: vertices are already laid out as sequential triangles.
      for (let i = 0; i < pos.count; i++) indices.push(base + i);
    }
  });

  if (positions.length === 0) return;
  cache.set(key, {
    vertices: new Float32Array(positions),
    indices: new Uint32Array(indices),
  });
  version++;
}
