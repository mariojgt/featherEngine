import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useEditorStore } from '../store/editorStore';

/**
 * Shared pool of flash lights for runtime VFX (impact sparks, muzzle flashes, explosions, projectile
 * tracers). Mounting/unmounting a real `<pointLight>` per effect changes the scene's LIGHT COUNT,
 * which forces three.js to switch (and on first occurrence compile) a different lighting program for
 * every material in view — the single biggest source of mid-action hitches after shader prewarm.
 *
 * Instead, a FIXED set of lights is mounted for the whole Play session (intensity 0 when idle), and
 * effects borrow one: `acquireEffectLight()` → position/animate it each frame via the handle →
 * `releaseEffectLight()`. Light count never changes, so the lighting program never churns. If every
 * slot is busy the effect simply renders without a light — invisible in the chaos that exhausts it.
 */
const POOL_SIZE = 8;

export interface EffectLightHandle {
  light: THREE.PointLight;
}

const freeLights: THREE.PointLight[] = [];
let poolLights: THREE.PointLight[] = [];

export function acquireEffectLight(color: string, distance: number): EffectLightHandle | null {
  const light = freeLights.pop();
  if (!light) return null;
  light.color.set(color);
  light.distance = distance;
  light.intensity = 0; // owner animates it from its useFrame
  return { light };
}

export function releaseEffectLight(handle: EffectLightHandle | null): void {
  if (!handle) return;
  handle.light.intensity = 0;
  // Only return lights that still belong to the mounted pool (a canvas swap mid-effect discards them).
  if (poolLights.includes(handle.light) && !freeLights.includes(handle.light)) freeLights.push(handle.light);
}

/**
 * Undo a release for a handle that turned out to still be in use — React StrictMode (dev) runs each
 * effect's cleanup once mid-mount, which would otherwise hand a live effect's light to the next caller.
 */
export function reclaimEffectLight(handle: EffectLightHandle | null): void {
  if (!handle) return;
  const idx = freeLights.indexOf(handle.light);
  if (idx >= 0) freeLights.splice(idx, 1);
}

/**
 * Mount inside a play-capable Canvas (next to ShaderPrewarm). Renders the pool while Play is active;
 * outside Play it renders nothing, so the editor's light count is untouched.
 */
export function EffectLightPool() {
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const lights = useMemo(
    () =>
      Array.from({ length: POOL_SIZE }, () => {
        const light = new THREE.PointLight('#ffffff', 0, 4, 2);
        light.castShadow = false;
        return light;
      }),
    [],
  );

  useEffect(() => {
    if (!isPlaying) return;
    poolLights = lights;
    freeLights.length = 0;
    freeLights.push(...lights);
    return () => {
      // Invalidate outstanding handles from this session; a later Play re-registers fresh.
      if (poolLights === lights) {
        poolLights = [];
        freeLights.length = 0;
      }
    };
  }, [isPlaying, lights]);

  if (!isPlaying) return null;
  return (
    <>
      {lights.map((light, i) => (
        <primitive key={i} object={light} />
      ))}
    </>
  );
}
