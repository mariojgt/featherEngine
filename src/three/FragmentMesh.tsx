import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

import { getModelGeometry } from '../runtime/meshGeometryCache';

/**
 * Renders a spawned fracture shard's raw geometry. The vertices/indices live in the shared geometry
 * cache (keyed by `geometryKey`) — the same cache the convex-hull collider reads — so the visible
 * shard and its physics shape match. Used by both the standalone player ([../player/GameView.tsx])
 * and the editor's Play viewport ([../components/Viewport.tsx]). DoubleSide so a shard face is never
 * invisible regardless of winding.
 */
export function FragmentMesh({
  geometryKey,
  resolved,
}: {
  geometryKey: string;
  resolved: { color: string; metalness: number; roughness: number; emissiveColor: string; emissiveIntensity: number };
}) {
  const geometry = useMemo(() => {
    const cached = getModelGeometry(geometryKey);
    const geom = new THREE.BufferGeometry();
    if (cached) {
      geom.setAttribute('position', new THREE.BufferAttribute(cached.vertices, 3));
      geom.setIndex(new THREE.BufferAttribute(cached.indices, 1));
      geom.computeVertexNormals();
    }
    return geom;
  }, [geometryKey]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color={resolved.color}
        metalness={resolved.metalness}
        roughness={resolved.roughness}
        emissive={resolved.emissiveColor}
        emissiveIntensity={resolved.emissiveIntensity}
        side={THREE.DoubleSide}
        flatShading
      />
    </mesh>
  );
}
