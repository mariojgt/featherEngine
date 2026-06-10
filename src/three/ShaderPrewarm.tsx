import { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { useEditorStore } from '../store/editorStore';
import { ImpactParticles } from './ImpactParticles';

/**
 * Shader pre-warm: the single biggest source of mid-game HITCHES is three.js compiling a shader
 * program the first time a material becomes visible — the first explosion, dust puff or splash
 * lands as a 50–200ms stall. When Play starts (and again after an auto-quality step, which swaps
 * shader configurations) this:
 *  1. mounts ONE of each runtime effect far below the world, so their materials exist in the scene;
 *  2. calls `gl.compileAsync(scene, camera)` — WebGL parallel shader compilation off the hot path;
 *  3. unmounts the warm-up effects when compilation settles.
 * Net effect: programs are ready BEFORE gameplay needs them, instead of compiling on first impact.
 */
export function ShaderPrewarm() {
  const { gl, scene, camera } = useThree();
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const quality = useEditorStore((state) => state.renderSettings.quality);
  const [warming, setWarming] = useState(false);

  useEffect(() => {
    if (!isPlaying) return;
    let cancelled = false;
    setWarming(true);
    // Wait one frame so the warm-up effects below are mounted into the scene graph first.
    const raf = requestAnimationFrame(() => {
      Promise.resolve(gl.compileAsync(scene, camera))
        .catch(() => undefined) // compile failures fall back to lazy compilation — never break Play
        .finally(() => {
          if (!cancelled) setWarming(false);
        });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      setWarming(false);
    };
  }, [isPlaying, quality, gl, scene, camera]);

  if (!warming) return null;
  // One of each effect kind the runtime spawns (crash sparks, dust/smoke, splashes, muzzle flashes,
  // explosions reuse 'impact') — parked far underground, gone again as soon as compilation settles.
  return (
    <group position={[0, -10000, 0]}>
      <ImpactParticles effect={{ kind: 'impact', life: 30, maxLife: 30, color: '#ffd27f', count: 4 }} />
      <ImpactParticles effect={{ kind: 'dust', life: 30, maxLife: 30, color: '#b9a37e', count: 4 }} />
      <ImpactParticles effect={{ kind: 'splash', life: 30, maxLife: 30, color: '#9fd8ff', count: 4 }} />
      <ImpactParticles effect={{ kind: 'muzzle', life: 30, maxLife: 30, color: '#fff1c2', count: 4 }} />
    </group>
  );
}
