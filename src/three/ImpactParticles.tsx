import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { EffectComponent } from '../types';
import { acquireEffectLight, reclaimEffectLight, releaseEffectLight, type EffectLightHandle } from './effectLights';

/**
 * A short-lived particle burst + flash light for bullet impacts and muzzle flashes. Particles fly out,
 * fade and shrink; a point light flashes bright then dies. The owning object's group positions it at
 * the impact/muzzle point; the runtime despawns the object when `life` runs out.
 *
 * POOLED: bursts spawn dozens of times per second under fire, so the GPU resources (geometry with a
 * fixed-capacity position buffer, material, velocity scratch) are acquired from a module free-list on
 * mount and released on unmount instead of created/disposed — after warmup a burst allocates nothing.
 * The flash light comes from the shared EffectLightPool (constant scene light count — see
 * effectLights.tsx for why that matters).
 */

/** Capacity of a pooled burst (largest spawner is the 70-particle explosion). */
const MAX_BURST = 96;

interface BurstSlot {
  geometry: THREE.BufferGeometry;
  material: THREE.PointsMaterial;
  positions: Float32Array;
  velocities: Float32Array;
}

const freeSlots: BurstSlot[] = [];

const acquireSlot = (): BurstSlot => {
  const pooled = freeSlots.pop();
  if (pooled) return pooled;
  const positions = new Float32Array(MAX_BURST * 3);
  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.BufferAttribute(positions, 3);
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', attribute);
  const material = new THREE.PointsMaterial({
    transparent: true,
    depthWrite: false,
    sizeAttenuation: true,
  });
  return { geometry, material, positions, velocities: new Float32Array(MAX_BURST * 3) };
};

export function ImpactParticles({ effect }: { effect: EffectComponent }) {
  const anchorRef = useRef<THREE.Group>(null);
  const elapsed = useRef(0);
  const muzzle = effect.kind === 'muzzle';
  const splash = effect.kind === 'splash';
  const dust = effect.kind === 'dust';

  const { slot, count } = useMemo(() => {
    const count = Math.min(MAX_BURST, Math.max(1, effect.count));
    const slot = acquireSlot();
    const { positions, velocities, geometry, material } = slot;
    positions.fill(0, 0, count * 3); // don't flash the previous burst's end pose for a frame
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
      if (dust) {
        // Dust/smoke: a lazy low hemisphere — billows drift outward and gently RISE (buoyant), never spray.
        const r = 0.3 + Math.random() * 0.9;
        velocities[i * 3] = Math.cos(theta) * r;
        velocities[i * 3 + 1] = 0.5 + Math.random() * 0.9;
        velocities[i * 3 + 2] = Math.sin(theta) * r;
        continue;
      }
      // Muzzle: tight forward cone of sparks; impact: omni-directional spray biased outward.
      const speed = (muzzle ? 1 + Math.random() * 2 : 1.6 + Math.random() * 3);
      velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed * (muzzle ? 0.4 : 1);
      velocities[i * 3 + 1] = (muzzle ? (Math.random() - 0.5) * speed * 0.6 : Math.abs(Math.cos(phi)) * speed * 0.9);
      velocities[i * 3 + 2] = muzzle ? -(0.5 + Math.random() * 2) : Math.sin(phi) * Math.sin(theta) * speed;
    }
    geometry.setDrawRange(0, count);
    // Only the first `count` slots are drawn — upload just those, not the whole MAX_BURST pool.
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    posAttr.clearUpdateRanges();
    posAttr.addUpdateRange(0, count * 3);
    posAttr.needsUpdate = true;
    material.color.set(effect.color);
    material.size = dust ? 0.34 : muzzle ? 0.14 : splash ? 0.16 : 0.1;
    material.opacity = dust ? 0.5 : 1;
    // Water droplets + dust read as solid alpha layers; sparks/muzzle glow additively.
    material.blending = splash || dust ? THREE.NormalBlending : THREE.AdditiveBlending;
    return { slot, count };
  }, [effect.count, effect.color, muzzle, splash, dust]);

  // Dust gets NO light (its flash was always 0); everything else borrows a pooled flash light.
  const lightHandle = useMemo<EffectLightHandle | null>(
    () => (dust ? null : acquireEffectLight(effect.color, muzzle ? 5 : 4)),
    [dust, muzzle, effect.color],
  );

  useEffect(() => {
    // StrictMode (dev) runs this cleanup once mid-mount while the burst stays alive — re-claim the
    // resources the cleanup just released so a concurrent burst can't grab them out from under us.
    const idx = freeSlots.indexOf(slot);
    if (idx >= 0) freeSlots.splice(idx, 1);
    reclaimEffectLight(lightHandle);
    return () => {
      releaseEffectLight(lightHandle);
      freeSlots.push(slot);
    };
  }, [slot, lightHandle]);

  useFrame((_, delta) => {
    elapsed.current += delta;
    const t = elapsed.current;
    const progress = Math.min(t / effect.maxLife, 1);
    const { geometry, material, positions, velocities } = slot;
    // Splash droplets fall faster (heavier) for a watery arc; impact sparks use a lighter gravity;
    // dust has none (it already carries a gentle buoyant rise in its velocity).
    const gravity = splash ? 7 : muzzle || dust ? 0 : 5;
    for (let i = 0; i < count; i++) {
      positions[i * 3] = velocities[i * 3] * t;
      positions[i * 3 + 1] = velocities[i * 3 + 1] * t - gravity * t * t;
      positions[i * 3 + 2] = velocities[i * 3 + 2] * t;
    }
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    posAttr.clearUpdateRanges();
    posAttr.addUpdateRange(0, count * 3);
    posAttr.needsUpdate = true;
    // Dust billows GROW as they fade (smoke expanding) instead of shrinking like sparks, and start
    // semi-transparent so they read soft, not glowing.
    material.opacity = dust ? 0.5 * (1 - progress) : 1 - progress;
    material.size = dust ? 0.34 + progress * 0.5 : (muzzle ? 0.14 : splash ? 0.16 : 0.1) * (1 - progress * 0.6);
    if (lightHandle && anchorRef.current) {
      // Pooled lights live at the scene root, so track this burst's world position (muzzle flashes move).
      anchorRef.current.getWorldPosition(lightHandle.light.position);
      // Bright flash that decays fast (front-loaded) for a punchy pop. Splash gets only a soft glint.
      lightHandle.light.intensity = (muzzle ? 9 : splash ? 1.5 : 5) * Math.max(0, 1 - progress) ** 2;
    }
  });

  return (
    <group ref={anchorRef}>
      {/* Particles spread past the (stale, pooled) bounding sphere immediately — skip culling. */}
      <points frustumCulled={false}>
        <primitive object={slot.geometry} attach="geometry" />
        <primitive object={slot.material} attach="material" />
      </points>
    </group>
  );
}
