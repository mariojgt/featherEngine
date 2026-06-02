import { useGLTF, useAnimations } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { useEditorStore } from '../store/editorStore';
import { registerSkinnedRoot, unregisterSkinnedRoot } from './boneRegistry';
import { isRagdoll, toggleRagdoll } from '../runtime/ragdollState';
import { RagdollRig } from './RagdollRig';
import type { SceneObject } from '../types';

/**
 * Renders an imported skinned glTF/GLB model and plays one of its animation clips.
 *
 * A skinned rig is cloned with `SkeletonUtils.clone` so each instance gets its own bone hierarchy
 * (a plain `Object3D.clone()` shares bones and breaks skinning/animation).
 *
 * Clips may live in *different* GLBs than the mesh and than each other: we load every clip-source
 * GLB (`clipSourceUrls`) and bind ALL their clips to one mixer, so cross-fading between states works
 * even when the two clips came from different files — the tracks rebind to this mesh's bones by name.
 */
export function SkinnedModel({
  meshUrl,
  clipSourceUrls,
  clipName,
  speed = 1,
  loop = true,
  fade = 0.2,
  registerId,
}: {
  meshUrl: string;
  /** Distinct GLB urls whose clips should be available on the mixer (all the controller's states). */
  clipSourceUrls: string[];
  clipName?: string;
  speed?: number;
  loop?: boolean;
  /** Crossfade seconds when the clip changes (state-machine transition duration). */
  fade?: number;
  /** Object id to register this clone under, so bone-socket attachments can follow its bones. */
  registerId?: string;
}) {
  const { scene } = useGLTF(meshUrl);
  // Load every clip source. A stable, de-duped list keeps the loader from re-suspending each frame.
  const sources = useMemo(() => {
    const set = new Set(clipSourceUrls.filter(Boolean));
    if (!set.size) set.add(meshUrl);
    return [...set].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipSourceUrls.join('|'), meshUrl]);
  const gltfs = useGLTF(sources);
  const animations = useMemo(() => gltfs.flatMap((gltf) => gltf.animations), [gltfs]);

  // Independent skinned clone per instance. Memoized on the cached source scene.
  const model = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const { actions, mixer } = useAnimations(animations, model);

  // Ragdoll: mirror the shared ragdoll flag (set by key/node/death) into render state each frame.
  const [ragdoll, setRagdollLocal] = useState(false);
  const ragdollKeyCode = useEditorStore((state) =>
    registerId ? state.scenes.flatMap((s) => s.objects).find((o) => o.id === registerId)?.character?.keyRagdoll : undefined,
  );
  const ragdollKey = useEditorStore((state) => (ragdollKeyCode ? state.runtimeKeys[ragdollKeyCode] : undefined));
  // Resolve this object's skeleton → its ragdoll tuning (shared by everything on that skeleton).
  const ragdollSettings = useEditorStore((state) => {
    if (!registerId) return undefined;
    const object = state.scenes.flatMap((s) => s.objects).find((o) => o.id === registerId);
    const mesh = state.skeletalMeshes.find((m) => m.id === object?.animator?.skeletalMeshId);
    const skeletonId = mesh?.skeletonId;
    return skeletonId ? state.skeletons.find((sk) => sk.id === skeletonId)?.ragdoll : undefined;
  });
  const prevRagdollKey = useRef(false);
  useEffect(() => {
    // Test key (default R): toggles ragdoll on the object running this skinned model.
    if (registerId && ragdollKey && !prevRagdollKey.current) toggleRagdoll(registerId);
    prevRagdollKey.current = Boolean(ragdollKey);
  }, [ragdollKey, registerId]);
  useFrame(() => {
    const on = registerId ? isRagdoll(registerId) : false;
    if (on !== ragdoll) setRagdollLocal(on);
  });

  useEffect(() => {
    // While ragdolling, the physics owns the bones — keep the mixer quiet.
    if (ragdoll) {
      mixer.stopAllAction();
      return;
    }
    if (!clipName) return;
    // Clip names from DCC tools vary in case; match leniently, fall back to exact.
    const name = Object.keys(actions).find((key) => key.toLowerCase() === clipName.toLowerCase()) ?? clipName;
    const action = actions[name];
    if (!action) return;

    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    action.timeScale = speed;
    action.fadeIn(fade).play();

    return () => {
      action.fadeOut(fade);
    };
  }, [actions, clipName, loop, speed, fade, ragdoll, mixer]);

  // Keep playback speed live without restarting the clip.
  useEffect(() => {
    mixer.timeScale = speed;
  }, [mixer, speed]);

  // Publish this clone's bones so socket attachments (sword, etc.) can follow them.
  useEffect(() => {
    if (!registerId) return;
    registerSkinnedRoot(registerId, model);
    return () => unregisterSkinnedRoot(registerId, model);
  }, [registerId, model]);

  return (
    <>
      <primitive object={model} />
      {ragdoll && <RagdollRig root={model} active settings={ragdollSettings} objectId={registerId} />}
    </>
  );
}

/**
 * Resolves an object's animator into concrete URLs + the active clip. Prefers the Skeletal Mesh /
 * Animation / Controller assets, falling back to the renderer's `modelAssetId` GLB and the legacy
 * raw `clip`. `clipSourceUrls` lists every GLB whose clips must be loaded for smooth crossfades.
 */
export function useResolvedAnimator(object: SceneObject): {
  meshUrl?: string;
  clipSourceUrls: string[];
  clipName?: string;
  loop: boolean;
  speed: number;
  fade: number;
} {
  const assets = useEditorStore((state) => state.assets);
  const skeletalMeshes = useEditorStore((state) => state.skeletalMeshes);
  const animations = useEditorStore((state) => state.animations);
  const controllers = useEditorStore((state) => state.animatorControllers);
  const runtimeAnimators = useEditorStore((state) => state.runtimeAnimators);
  const isPlaying = useEditorStore((state) => state.isPlaying);
  const animator = object.animator;

  const urlOf = (assetId?: string) => assets.find((asset) => asset.id === assetId)?.url;
  const clipOf = (animationId?: string) => {
    const anim = animations.find((item) => item.id === animationId);
    return anim ? { url: urlOf(anim.sourceAssetId), name: anim.clipName } : undefined;
  };

  const meshAsset = skeletalMeshes.find((mesh) => mesh.id === animator?.skeletalMeshId);
  const meshUrl = urlOf(meshAsset?.sourceAssetId ?? object.renderer?.modelAssetId);

  // Controller mode: the state machine picks the clip. In Play we read the live state; in the
  // editor we preview the default (entry) state so the controller is visible before pressing Play.
  const controller = controllers.find((item) => item.id === animator?.controllerId);
  if (controller) {
    const live = runtimeAnimators[object.id];
    const stateId = (isPlaying && live?.stateId) || controller.defaultStateId || controller.states[0]?.id;
    const activeState = controller.states.find((s) => s.id === stateId);
    const clip = clipOf(activeState?.animationId);
    // Every clip the controller might play must be loaded so crossfades between states are seamless.
    const clipSourceUrls = controller.states
      .map((s) => clipOf(s.animationId)?.url)
      .filter((url): url is string => Boolean(url));
    return {
      meshUrl,
      clipSourceUrls,
      clipName: clip?.name,
      loop: activeState?.loop ?? true,
      speed: activeState?.speed ?? 1,
      fade: (isPlaying && live?.fade) || 0.2,
    };
  }

  // Manual mode: a single Animation asset (or legacy raw clip from the mesh GLB).
  const clip = clipOf(animator?.animationId);
  const clipSourceUrls = (clip?.url ?? meshUrl) ? [clip?.url ?? (meshUrl as string)] : [];
  return {
    meshUrl,
    clipSourceUrls,
    clipName: clip?.name ?? animator?.clip,
    loop: animator?.loop ?? true,
    speed: animator?.speed ?? 1,
    fade: 0.2,
  };
}
