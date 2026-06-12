import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SceneObject } from '../types';
import { acquireEffectLight, releaseEffectLight, type EffectLightHandle } from './effectLights';

/**
 * Glowy tracer look for a runtime projectile: an additive core sphere, a stretched tracer streak
 * oriented along the travel direction, and a point light so it casts real light on the level as it
 * flies. Rendered in place of the plain bullet so shots read clearly and feel "hot".
 *
 * Every projectile looks identical, so the geometries and materials are MODULE-LEVEL SINGLETONS
 * shared by all live projectiles (`dispose={null}` keeps r3f from destroying them on unmount) —
 * burst fire mounts/unmounts dozens of these per second and now allocates no GPU resources doing it.
 * The flying light comes from the shared EffectLightPool so the scene's light count stays constant
 * (mounting a real light per bullet forced a lighting-program switch on every shot).
 */
const TRACER_COLOR = '#ffd27a';
const coreGeometry = new THREE.SphereGeometry(0.07, 12, 10);
const haloGeometry = new THREE.SphereGeometry(0.16, 12, 10);
const streakGeometry = new THREE.CylinderGeometry(0.035, 0.005, 1.1, 8, 1, true);
const coreMaterial = new THREE.MeshBasicMaterial({ color: TRACER_COLOR, toneMapped: false });
const haloMaterial = new THREE.MeshBasicMaterial({
  color: TRACER_COLOR,
  transparent: true,
  opacity: 0.4,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
});
const streakMaterial = new THREE.MeshBasicMaterial({
  color: TRACER_COLOR,
  transparent: true,
  opacity: 0.5,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
  toneMapped: false,
});

export function ProjectileVisual({ object }: { object: SceneObject }) {
  const groupRef = useRef<THREE.Group>(null);
  const lightHandle = useRef<EffectLightHandle | null>(null);

  // Orient the tracer streak along the velocity direction (group is already at the bullet's position).
  const quaternion = useMemo(() => {
    const v = object.projectile?.velocity ?? [0, 0, 1];
    const dir = new THREE.Vector3(v[0], v[1], v[2]);
    if (dir.lengthSq() < 1e-6) return new THREE.Quaternion();
    dir.normalize();
    // Default cylinder axis is +Y; rotate it onto the travel direction.
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  }, [object.projectile?.velocity]);

  useEffect(() => {
    lightHandle.current = acquireEffectLight(TRACER_COLOR, 5);
    return () => {
      releaseEffectLight(lightHandle.current);
      lightHandle.current = null;
    };
  }, []);

  useFrame(() => {
    const handle = lightHandle.current;
    if (handle && groupRef.current) {
      // Pooled lights live at the scene root — chase the bullet's world position each frame.
      groupRef.current.getWorldPosition(handle.light.position);
      handle.light.intensity = 3;
    }
  });

  return (
    <group ref={groupRef} quaternion={quaternion}>
      {/* Hot core */}
      <mesh geometry={coreGeometry} material={coreMaterial} />
      {/* Glow halo */}
      <mesh geometry={haloGeometry} material={haloMaterial} />
      {/* Tracer streak trailing behind along -travel (the cylinder spans the local Y axis). */}
      <mesh position={[0, -0.5, 0]} geometry={streakGeometry} material={streakMaterial} />
    </group>
  );
}
