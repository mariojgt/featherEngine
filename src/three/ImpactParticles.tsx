import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { EffectComponent } from '../types';

/**
 * A short-lived particle burst + flash light for bullet impacts and muzzle flashes. Particles fly out,
 * fade and shrink; a point light flashes bright then dies. The owning object's group positions it at
 * the impact/muzzle point; the runtime despawns the object when `life` runs out.
 */
export function ImpactParticles({ effect }: { effect: EffectComponent }) {
  const geomRef = useRef<THREE.BufferGeometry>(null);
  const matRef = useRef<THREE.PointsMaterial>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const elapsed = useRef(0);
  const muzzle = effect.kind === 'muzzle';
  const splash = effect.kind === 'splash';

  const { positions, velocities, count } = useMemo(() => {
    const count = Math.max(1, effect.count);
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      if (splash) {
        // Water fountain: droplets shoot UP in a narrow crown ring, then arc back down under gravity.
        const r = 0.4 + Math.random() * 1.1;
        velocities[i * 3] = Math.cos(theta) * r;
        velocities[i * 3 + 1] = 3 + Math.random() * 3.5;
        velocities[i * 3 + 2] = Math.sin(theta) * r;
        continue;
      }
      // Muzzle: tight forward cone of sparks; impact: omni-directional spray biased outward.
      const speed = (muzzle ? 1 + Math.random() * 2 : 1.6 + Math.random() * 3);
      velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed * (muzzle ? 0.4 : 1);
      velocities[i * 3 + 1] = (muzzle ? (Math.random() - 0.5) * speed * 0.6 : Math.abs(Math.cos(phi)) * speed * 0.9);
      velocities[i * 3 + 2] = muzzle ? -(0.5 + Math.random() * 2) : Math.sin(phi) * Math.sin(theta) * speed;
    }
    return { positions, velocities, count };
  }, [effect.count, muzzle, splash]);

  useFrame((_, delta) => {
    elapsed.current += delta;
    const t = elapsed.current;
    const progress = Math.min(t / effect.maxLife, 1);
    const geom = geomRef.current;
    if (geom) {
      const arr = (geom.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
      // Splash droplets fall faster (heavier) for a watery arc; impact sparks use a lighter gravity.
      const gravity = splash ? 7 : muzzle ? 0 : 5;
      for (let i = 0; i < count; i++) {
        arr[i * 3] = velocities[i * 3] * t;
        arr[i * 3 + 1] = velocities[i * 3 + 1] * t - gravity * t * t;
        arr[i * 3 + 2] = velocities[i * 3 + 2] * t;
      }
      geom.getAttribute('position').needsUpdate = true;
    }
    if (matRef.current) {
      matRef.current.opacity = 1 - progress;
      matRef.current.size = (muzzle ? 0.14 : splash ? 0.16 : 0.1) * (1 - progress * 0.6);
    }
    // Bright flash that decays fast (front-loaded) for a punchy pop. Splash gets only a soft glint.
    if (lightRef.current) lightRef.current.intensity = (muzzle ? 9 : splash ? 1.5 : 5) * Math.max(0, 1 - progress) ** 2;
  });

  return (
    <>
      <pointLight ref={lightRef} color={effect.color} intensity={muzzle ? 9 : splash ? 1.5 : 5} distance={muzzle ? 5 : 4} decay={2} />
      <points>
        <bufferGeometry ref={geomRef}>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} count={count} />
        </bufferGeometry>
        <pointsMaterial
          ref={matRef}
          color={effect.color}
          size={muzzle ? 0.14 : splash ? 0.16 : 0.1}
          transparent
          opacity={1}
          depthWrite={false}
          sizeAttenuation
          // Water droplets read as solid alpha; sparks/muzzle glow additively.
          blending={splash ? THREE.NormalBlending : THREE.AdditiveBlending}
        />
      </points>
    </>
  );
}
