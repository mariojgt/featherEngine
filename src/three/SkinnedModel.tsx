import { useGLTF, useAnimations } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { useEditorStore } from '../store/editorStore';
import { registerSkinnedRoot, unregisterSkinnedRoot } from './boneRegistry';
import { useFootIK } from './footIK';
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
  blend,
  speed = 1,
  loop = true,
  fade = 0.2,
  registerId,
  tint,
}: {
  meshUrl: string;
  /** Distinct GLB urls whose clips should be available on the mixer (all the controller's states). */
  clipSourceUrls: string[];
  clipName?: string;
  /** Blend-space mode: clips to play simultaneously with per-clip weights (updated live each frame). */
  blend?: { name: string; weight: number }[];
  speed?: number;
  loop?: boolean;
  /** Crossfade seconds when the clip changes (state-machine transition duration). */
  fade?: number;
  /** Object id to register this clone under, so bone-socket attachments can follow its bones. */
  registerId?: string;
  /** Optional material override applied to every skinned mesh — recolors the rig (per-enemy tints) and
   *  drives the runtime hit-flash / interact-focus glow. Cleared values restore the model's baked look. */
  tint?: { color?: string; emissiveColor?: string; emissiveIntensity?: number };
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

  // SkeletonUtils.clone shares material references with the cached source scene, so we must own a private
  // copy of every material before recoloring — otherwise tinting one enemy would tint every instance of the
  // rig (including the player). Capture each material's baked color/emissive so a cleared tint restores it.
  const tintMats = useMemo(() => {
    const mats: { mat: THREE.MeshStandardMaterial; color?: THREE.Color; emissive?: THREE.Color; emissiveIntensity: number }[] = [];
    model.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const own = (m: THREE.Material) => {
        const c = m.clone() as THREE.MeshStandardMaterial;
        mats.push({ mat: c, color: c.color?.clone(), emissive: c.emissive?.clone(), emissiveIntensity: c.emissiveIntensity ?? 1 });
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
    });
    return mats;
  }, [model]);

  useEffect(() => {
    for (const t of tintMats) {
      if (tint?.color) t.mat.color?.set(tint.color);
      else if (t.color) t.mat.color?.copy(t.color);
      if (tint?.emissiveColor) {
        t.mat.emissive?.set(tint.emissiveColor);
        t.mat.emissiveIntensity = tint.emissiveIntensity ?? 1;
      } else if (t.emissive) {
        t.mat.emissive?.copy(t.emissive);
        t.mat.emissiveIntensity = t.emissiveIntensity;
      }
    }
  }, [tintMats, tint?.color, tint?.emissiveColor, tint?.emissiveIntensity]);

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

  // Latest blend weights, read live in useFrame (weights change every tick within a blend).
  const blendRef = useRef(blend);
  blendRef.current = blend;
  const resolveAction = (n: string) => {
    const key = Object.keys(actions).find((k) => k.toLowerCase() === n.toLowerCase()) ?? n;
    return actions[key];
  };

  // Which clips are active this state. For a blend space it's the bracketing samples; otherwise one clip.
  // Joined with "\n" (NOT "|") because exported clip names can contain "|" (e.g. "Armature|Armature|Idle").
  const activeNames = (blend && blend.length ? blend.map((b) => b.name) : clipName ? [clipName] : []).join('\n');

  useEffect(() => {
    // While ragdolling, the physics owns the bones — keep the mixer quiet.
    if (ragdoll) {
      mixer.stopAllAction();
      return;
    }
    const names = activeNames ? activeNames.split('\n') : [];
    const acts = names.map(resolveAction).filter(Boolean) as THREE.AnimationAction[];
    const blending = Boolean(blend && blend.length);
    acts.forEach((action) => {
      action.reset();
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      action.clampWhenFinished = !loop;
      action.timeScale = speed;
      // Blend clips: play at a weight driven each frame by useFrame; single clip: crossfade in.
      if (blending) action.play();
      else action.fadeIn(fade).play();
    });
    return () => {
      acts.forEach((action) => action.fadeOut(fade));
    };
    // Re-run only when the active clip SET changes (not on every weight tick).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, activeNames, loop, speed, fade, ragdoll, mixer]);

  // Drive blend-space weights live. Sum weights PER ACTION first — two samples can map to the same clip,
  // and calling setEffectiveWeight twice would otherwise let the last (often ~0) call win → the clip vanishes.
  useFrame(() => {
    const b = blendRef.current;
    if (ragdoll || !b) return;
    const byAction = new Map<THREE.AnimationAction, number>();
    for (const sample of b) {
      const action = resolveAction(sample.name);
      if (action) byAction.set(action, (byAction.get(action) ?? 0) + sample.weight);
    }
    for (const [action, weight] of byAction) action.setEffectiveWeight(weight);
  });

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

  // Terrain foot IK — plant feet on uneven ground. Called last so it post-processes the mixer's pose this
  // frame; fully guarded (Play + grounded + over terrain) so it's a no-op everywhere else.
  useFootIK(model, registerId);

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
/**
 * Weights for a 1D blend space at parameter value `v`. Returns a weight for EVERY sample (0 for those
 * outside the active bracket) so the set of playing clips stays constant for the whole state — only their
 * weights change. That avoids restarting clips when `v` crosses a sample boundary (which would otherwise
 * reset the animation and make walking/running stutter).
 */
function blend1D(samples: { animationId: string; value: number }[], v: number): { animationId: string; weight: number }[] {
  const sorted = [...samples].sort((a, b) => a.value - b.value);
  const weights = new Map<string, number>(samples.map((s) => [s.animationId, 0]));
  if (sorted.length) {
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (v <= first.value) {
      weights.set(first.animationId, 1);
    } else if (v >= last.value) {
      weights.set(last.animationId, 1);
    } else {
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];
        if (v >= a.value && v <= b.value) {
          const t = (v - a.value) / (b.value - a.value || 1);
          weights.set(a.animationId, (weights.get(a.animationId) ?? 0) + (1 - t));
          weights.set(b.animationId, (weights.get(b.animationId) ?? 0) + t);
          break;
        }
      }
    }
  }
  // Keep original sample order; one entry per sample (constant set).
  return samples.map((s) => ({ animationId: s.animationId, weight: weights.get(s.animationId) ?? 0 }));
}

/**
 * Weights for a 2D blend space at point (x,y) via inverse-distance-squared weighting, normalized. Every
 * sample gets a weight (constant set), so directional locomotion (e.g. moveX × moveY → strafe) blends
 * smoothly without restarting clips.
 */
function blend2D(samples: { animationId: string; value: number; y?: number }[], x: number, y: number): { animationId: string; weight: number }[] {
  let total = 0;
  const raw = samples.map((s) => {
    const dx = s.value - x;
    const dy = (s.y ?? 0) - y;
    const d2 = dx * dx + dy * dy;
    const w = d2 < 1e-4 ? 1e4 : 1 / d2;
    total += w;
    return { animationId: s.animationId, w };
  });
  return raw.map((r) => ({ animationId: r.animationId, weight: total > 0 ? r.w / total : 0 }));
}

export function useResolvedAnimator(object: SceneObject): {
  meshUrl?: string;
  clipSourceUrls: string[];
  clipName?: string;
  /** When the active state is a blend space, the clips + weights to play simultaneously. */
  blend?: { name: string; weight: number }[];
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
    // Every clip the controller might play must be loaded so crossfades between states are seamless —
    // including every blend-space sample clip on any state.
    const clipSourceUrls = controller.states
      .flatMap((s) => [clipOf(s.animationId)?.url, ...(s.blendSamples ?? []).map((sample) => clipOf(sample.animationId)?.url)])
      .filter((url): url is string => Boolean(url));

    // Blend space: blend the samples by the live value(s) of the driving parameter(s) (defaults in the editor).
    let blend: { name: string; weight: number }[] | undefined;
    if (activeState?.blendSamples?.length && activeState.blendParameterId) {
      const liveParam = (id?: string) => {
        const p = controller.parameters.find((q) => q.id === id);
        const raw = (isPlaying && id && live?.params?.[id]) ?? p?.defaultValue ?? 0;
        return typeof raw === 'number' ? raw : Number(raw) || 0;
      };
      const x = liveParam(activeState.blendParameterId);
      const weighted = activeState.blendParameterIdY
        ? blend2D(activeState.blendSamples, x, liveParam(activeState.blendParameterIdY))
        : blend1D(activeState.blendSamples, x);
      blend = weighted
        .map((b) => ({ name: clipOf(b.animationId)?.name, weight: b.weight }))
        .filter((b): b is { name: string; weight: number } => Boolean(b.name));
    }

    // Montage override (Play Animation node): while a one-shot montage is active it replaces the state
    // machine's clip/blend until it finishes, then the controller resumes automatically.
    const montage = isPlaying && live?.montage && live.montage.remaining > 0 ? live.montage : undefined;
    if (montage) {
      const mClip = clipOf(montage.animationId);
      if (mClip?.name) {
        return {
          meshUrl,
          clipSourceUrls: mClip.url ? [...clipSourceUrls, mClip.url] : clipSourceUrls,
          clipName: mClip.name,
          blend: undefined,
          loop: false,
          speed: montage.speed,
          fade: 0.1,
        };
      }
    }

    return {
      meshUrl,
      clipSourceUrls,
      clipName: clip?.name ?? (blend?.[0]?.name),
      blend,
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
