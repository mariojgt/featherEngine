import { useGLTF, useAnimations } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';

/**
 * Renders an imported skinned glTF/GLB model and plays one of its animation clips.
 *
 * Unlike `ModelAsset` (static meshes), a skinned rig must be cloned with `SkeletonUtils.clone`
 * so each instance gets its own independent bone hierarchy — a plain `Object3D.clone()` shares
 * bones across instances and breaks skinning/animation. We bind a per-instance `AnimationMixer`
 * (via drei's `useAnimations`) to that clone and cross-fade to the requested clip.
 *
 * Phase 0: plays a single clip by name. Material overrides aren't applied yet (the rig renders
 * with its baked materials); that unifies with `ModelAsset`'s override path in a later phase.
 */
export function SkinnedModel({
  url,
  clip,
  speed = 1,
  loop = true,
}: {
  url: string;
  clip?: string;
  speed?: number;
  loop?: boolean;
}) {
  const { scene, animations } = useGLTF(url);
  // Independent skinned clone per instance. Memoized on the cached source scene.
  const model = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { actions, mixer } = useAnimations(animations, model);

  useEffect(() => {
    if (!clip) return;
    // Clip names from DCC tools vary in case; match leniently, fall back to exact.
    const name = Object.keys(actions).find((key) => key.toLowerCase() === clip.toLowerCase()) ?? clip;
    const action = actions[name];
    if (!action) return;

    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    action.timeScale = speed;
    action.fadeIn(0.2).play();

    return () => {
      action.fadeOut(0.2);
    };
  }, [actions, clip, loop, speed]);

  // Keep playback speed live without restarting the clip.
  useEffect(() => {
    mixer.timeScale = speed;
  }, [mixer, speed]);

  return <primitive object={model} />;
}
