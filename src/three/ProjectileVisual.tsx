import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { SceneObject } from '../types';

/**
 * Glowy tracer look for a runtime projectile: an additive core sphere, a stretched tracer streak
 * oriented along the travel direction, and a point light so it casts real light on the level as it
 * flies. Rendered in place of the plain bullet so shots read clearly and feel "hot".
 */
export function ProjectileVisual({ object }: { object: SceneObject }) {
  const groupRef = useRef<THREE.Group>(null);
  const color = '#ffd27a';

  // Orient the tracer streak along the velocity direction (group is already at the bullet's position).
  const quaternion = useMemo(() => {
    const v = object.projectile?.velocity ?? [0, 0, 1];
    const dir = new THREE.Vector3(v[0], v[1], v[2]);
    if (dir.lengthSq() < 1e-6) return new THREE.Quaternion();
    dir.normalize();
    // Default cylinder axis is +Y; rotate it onto the travel direction.
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  }, [object.projectile?.velocity]);

  return (
    <group ref={groupRef} quaternion={quaternion}>
      {/* Hot core */}
      <mesh>
        <sphereGeometry args={[0.07, 12, 10]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {/* Glow halo */}
      <mesh>
        <sphereGeometry args={[0.16, 12, 10]} />
        <meshBasicMaterial color={color} transparent opacity={0.4} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* Tracer streak trailing behind along -travel (the cylinder spans the local Y axis). */}
      <mesh position={[0, -0.5, 0]}>
        <cylinderGeometry args={[0.035, 0.005, 1.1, 8, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {/* Real light cast on the scene as it flies past. */}
      <pointLight color={color} intensity={3} distance={5} decay={2} />
    </group>
  );
}
