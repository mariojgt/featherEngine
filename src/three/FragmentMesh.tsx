import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';

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
  onPointerDown,
}: {
  geometryKey: string;
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void;
  resolved: { color: string; metalness: number; roughness: number; emissiveColor: string; emissiveIntensity: number;
    transmission?: number; ior?: number; thickness?: number; clearcoat?: number; clearcoatRoughness?: number;
    sheen?: number; sheenColor?: string; iridescence?: number; opacity?: number };
}) {
  const geometry = useMemo(() => {
    const cached = getModelGeometry(geometryKey);
    const geom = new THREE.BufferGeometry();
    if (cached) {
      geom.setAttribute('position', new THREE.BufferAttribute(cached.vertices, 3));
      geom.setIndex(new THREE.BufferAttribute(cached.indices, 1));
      if (cached.normals) geom.setAttribute('normal', new THREE.BufferAttribute(cached.normals, 3));
      else geom.computeVertexNormals();
    }
    return geom;
  }, [geometryKey]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} castShadow receiveShadow onPointerDown={onPointerDown}>
      <meshPhysicalMaterial
        color={resolved.color}
        metalness={resolved.metalness}
        roughness={resolved.roughness}
        emissive={resolved.emissiveColor}
        emissiveIntensity={resolved.emissiveIntensity}
        side={THREE.DoubleSide}
        transmission={resolved.transmission ?? 0}
        ior={resolved.ior ?? 1.5}
        thickness={resolved.thickness ?? 0}
        clearcoat={resolved.clearcoat ?? 0}
        clearcoatRoughness={resolved.clearcoatRoughness ?? 0}
        sheen={resolved.sheen ?? 0}
        sheenColor={resolved.sheenColor}
        iridescence={resolved.iridescence ?? 0}
        opacity={resolved.opacity ?? 1}
        transparent={(resolved.opacity ?? 1) < 1}
        depthWrite={(resolved.opacity ?? 1) >= 1}
        flatShading={!getModelGeometry(geometryKey)?.normals}
      />
    </mesh>
  );
}
