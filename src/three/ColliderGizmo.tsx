import { useFrame } from '@react-three/fiber';
import { useMemo, useState } from 'react';
import * as THREE from 'three';
import type { SceneObject } from '../types';
import {
  boxExtents,
  capsuleParams,
  colliderKindFor,
  planeExtents,
  sphereRadius,
} from '../runtime/colliderShape';
import { getModelGeometry, type ModelGeometry } from '../runtime/meshGeometryCache';

// Cyan, distinct from the gold (#F7B955) selection edges, so the collider preview
// reads as "physics shape" and never gets confused with the visual mesh outline.
const COLLIDER_COLOR = '#19E3D6';

// A debug overlay must never catch clicks — otherwise its (often oversized, x-ray)
// wireframe steals picks meant for the objects it wraps or sits in front of.
const ignoreRaycast = () => null;

/** Shared x-ray wireframe so the collider shows through the mesh it wraps. */
function wireMaterial() {
  return (
    <meshBasicMaterial
      color={COLLIDER_COLOR}
      wireframe
      transparent
      opacity={0.8}
      depthTest={false}
      toneMapped={false}
    />
  );
}

/**
 * A wireframe preview of an object's TRUE physics collider — the exact shape & size
 * Rapier uses, which often differs from the visual mesh (e.g. a sphere collider is
 * 0.55× the box bounds, a capsule is narrower). Shown for the selected object in the
 * editor and during Play. Reads its dimensions from the same [colliderShape] helpers
 * the runtime uses, so the wireframe and the simulation can never drift apart.
 */
export function ColliderGizmo({ object }: { object: SceneObject }) {
  if (object.terrain?.enabled) return null;
  const kind = colliderKindFor(object);
  const [px, py, pz] = object.transform.position;
  const [rx, ry, rz] = object.transform.rotation;
  const position: [number, number, number] = [px, py, pz];
  const rotation: [number, number, number] = [rx, ry, rz];

  // The analytic shapes (box/sphere/capsule/plane) already bake the object's scale
  // into their dimensions, so they render at unit scale anchored at the transform.
  if (kind === 'box') {
    const [w, h, d] = boxExtents(object);
    return (
      <mesh position={position} rotation={rotation} renderOrder={999} raycast={ignoreRaycast}>
        <boxGeometry args={[w, h, d]} />
        {wireMaterial()}
      </mesh>
    );
  }
  if (kind === 'plane') {
    const [w, h, d] = planeExtents(object);
    return (
      <mesh position={position} rotation={rotation} renderOrder={999} raycast={ignoreRaycast}>
        <boxGeometry args={[w, h, d]} />
        {wireMaterial()}
      </mesh>
    );
  }
  if (kind === 'sphere') {
    return (
      <mesh position={position} rotation={rotation} renderOrder={999} raycast={ignoreRaycast}>
        <sphereGeometry args={[sphereRadius(object), 16, 12]} />
        {wireMaterial()}
      </mesh>
    );
  }
  if (kind === 'capsule') {
    const { halfHeight, radius } = capsuleParams(object);
    return (
      <mesh position={position} rotation={rotation} renderOrder={999} raycast={ignoreRaycast}>
        <capsuleGeometry args={[radius, halfHeight * 2, 6, 14]} />
        {wireMaterial()}
      </mesh>
    );
  }
  // Mesh / convex: render the model's actual geometry. It's cached in local space, so
  // a group carrying the object's full transform (incl. scale) places it correctly.
  return <MeshColliderGizmo object={object} convex={kind === 'convex'} />;
}

function MeshColliderGizmo({ object, convex }: { object: SceneObject; convex: boolean }) {
  const key = object.renderer?.modelAssetId;
  const [geo, setGeo] = useState<ModelGeometry | undefined>(() => getModelGeometry(key));

  // The model may still be loading when the object is first selected; poll the cache
  // until its geometry registers, then stop.
  useFrame(() => {
    if (!geo) {
      const found = getModelGeometry(key);
      if (found) setGeo(found);
    }
  });

  const geometry = useMemo(() => {
    if (!geo) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(geo.vertices, 3));
    g.setIndex(new THREE.BufferAttribute(geo.indices, 1));
    return g;
  }, [geo]);

  if (!geometry) return null;
  return (
    <group
      position={object.transform.position}
      rotation={object.transform.rotation}
      scale={object.transform.scale}
    >
      {/* convex hull is approximated by the model's own triangles here — close enough
          to gauge the volume; the exact hull is what the simulation uses. */}
      <mesh geometry={geometry} renderOrder={999} raycast={ignoreRaycast}>
        {wireMaterial()}
      </mesh>
    </group>
  );
}
