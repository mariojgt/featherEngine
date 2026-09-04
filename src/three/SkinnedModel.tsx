import { useGLTF, useAnimations } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { registerSkinnedRoot, unregisterSkinnedRoot } from './boneRegistry';
import { accumulateWeight, blend1D, blend2D, phaseSyncTimeScale } from './blendSpace';
import { collectMaskedBones, maskClip, type BoneMaskMode } from './boneMask';
import { useFootIK } from './footIK';
import { useAimIK } from './aimIK';
import { isRagdoll, toggleRagdoll } from '../runtime/ragdollState';
import { RagdollRig } from './RagdollRig';
import { DRACO_DECODER_PATH, extendGLTFLoader } from './gltfDecoders';
import { resolveLayerWeight } from '../store/editor/animatorRuntime';
import type { AnimatorState, SceneObject } from '../types';

/** Scratch for the mixer distance-LOD check (synchronous per-frame use; never retained). */
const MIXER_LOD_SCRATCH = new THREE.Vector3();

/** Scratch for blend-weight summing (cleared and consumed within one useFrame callback; never retained). */
const BLEND_WEIGHT_SCRATCH = new Map<THREE.AnimationAction, number>();

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
  syncPhase,
  layers,
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
  syncPhase?: boolean;
  /** Animation layers posed on top of the base, each masked to its own bones. */
  layers?: ResolvedAnimatorLayer[];
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
  const { scene } = useGLTF(meshUrl, DRACO_DECODER_PATH, true, extendGLTFLoader);
  // Load every clip source. A stable, de-duped list keeps the loader from re-suspending each frame.
  const sources = useMemo(() => {
    const set = new Set(clipSourceUrls.filter(Boolean));
    if (!set.size) set.add(meshUrl);
    return [...set].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipSourceUrls.join('|'), meshUrl]);
  const gltfs = useGLTF(sources, DRACO_DECODER_PATH, true, extendGLTFLoader);
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
      // Match static imports and built-in primitives: characters cast onto the scene and receive the
      // studio/sun shadows that visually ground them. ShadowLOD budgets distant casts during Play.
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const own = (m: THREE.Material) => {
        const c = m.clone() as THREE.MeshStandardMaterial;
        mats.push({ mat: c, color: c.color?.clone(), emissive: c.emissive?.clone(), emissiveIntensity: c.emissiveIntensity ?? 1 });
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
    });
    return mats;
  }, [model]);

  // Dispose this instance's private material clones when the model is swapped or the component
  // unmounts — otherwise each spawned/despawned skinned character leaks its materials' GPU programs.
  // dispose() frees the program only, leaving the shared source textures intact.
  useEffect(
    () => () => {
      for (const t of tintMats) t.mat.dispose();
    },
    [tintMats],
  );

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
  // These all read STATIC config (a key code, a skeleton's ragdoll tuning) and return a primitive
  // or a stable object reference, so they don't trigger re-renders during Play. The fix vs the old
  // code: scan only the active scene's existing objects array (selectActiveObjects) instead of
  // `scenes.flatMap(...)`, which allocated a fresh all-scenes array on every store tick (60fps).
  const ragdollKeyCode = useEditorStore((state) =>
    registerId ? selectActiveObjects(state).find((o) => o.id === registerId)?.character?.keyRagdoll : undefined,
  );
  const ragdollKey = useEditorStore((state) => (ragdollKeyCode ? state.runtimeKeys[ragdollKeyCode] : undefined));
  // Resolve this object's skeleton → its ragdoll tuning (shared by everything on that skeleton).
  const ragdollSettings = useEditorStore((state) => {
    if (!registerId) return undefined;
    const object = selectActiveObjects(state).find((o) => o.id === registerId);
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

  // Distance LOD for the animation mixer: skinning a far-away character at 60Hz is wasted CPU (drei's
  // useAnimations updates the mixer every frame). Past 25m the pose advances every 2nd frame, past 50m
  // every 3rd — the skipped frames' time is released in one update via timeScale, so playback SPEED is
  // exact; only the pose sample rate drops (30/20Hz — imperceptible at those sizes on screen). Play-only:
  // editor preview keeps full rate. The camera-follow pawn is always well inside 25m, so it's never touched.
  const mixerLod = useRef(0);
  useFrame((rtState) => {
    if (ragdoll) return; // mixer is stopped; leave timeScale alone
    if (!useEditorStore.getState().isPlaying) {
      mixer.timeScale = speed;
      return;
    }
    const d = MIXER_LOD_SCRATCH.setFromMatrixPosition(model.matrixWorld).distanceTo(rtState.camera.position);
    const interval = d > 50 ? 3 : d > 25 ? 2 : 1;
    if (interval === 1) {
      mixer.timeScale = speed;
      mixerLod.current = 0;
      return;
    }
    mixerLod.current += 1;
    if (mixerLod.current >= interval) {
      mixer.timeScale = speed * interval; // release the skipped frames' time in one step
      mixerLod.current = 0;
    } else {
      mixer.timeScale = 0; // hold the pose this frame
    }
  });

  // Latest blend weights, read live in useFrame (weights change every tick within a blend).
  const blendRef = useRef(blend);
  blendRef.current = blend;
  const syncPhaseRef = useRef(syncPhase);
  syncPhaseRef.current = syncPhase;
  const resolveAction = (n: string) => {
    const key = Object.keys(actions).find((k) => k.toLowerCase() === n.toLowerCase()) ?? n;
    return actions[key];
  };

  const layersRef = useRef(layers);
  layersRef.current = layers;

  /** Every bone name in this rig, for a layer authored with an empty mask (= whole skeleton). */
  const allBones = useMemo(() => {
    const out = new Set<string>();
    model.traverse((node) => {
      if (node.name) out.add(node.name);
    });
    return out;
  }, [model]);

  // Resolving a mask walks the skeleton, so key it on the masks themselves rather than the `layers`
  // array, which the resolver rebuilds every render.
  const layerMaskKey = (layers ?? []).map((layer) => `${layer.id}:${layer.maskRootBones.join(',')}`).join('|');
  const layerBones = useMemo(() => {
    const out = new Map<string, Set<string>>();
    for (const layer of layersRef.current ?? []) {
      out.set(layer.id, layer.maskRootBones.length ? collectMaskedBones(model, layer.maskRootBones) : allBones);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerMaskKey, model, allBones]);

  /** Union of every layer's bones — exactly what the base must give up. */
  const baseExcluded = useMemo(() => {
    const out = new Set<string>();
    for (const bones of layerBones.values()) for (const bone of bones) out.add(bone);
    return out;
  }, [layerBones]);

  /**
   * An action for `clipName` restricted to (or excluded from) a bone set.
   *
   * `mixer.clipAction` caches per clip+root, so calling this every frame returns the same action
   * rather than piling up new ones. When the mask cannot change the clip we hand back drei's own
   * action instead of a derived duplicate; when it masks everything away there is nothing to play.
   */
  const maskedAction = (name: string, bones: Set<string>, mode: BoneMaskMode): THREE.AnimationAction | null => {
    const source = resolveAction(name);
    if (!source) return null;
    const clip = source.getClip();
    const masked = maskClip(clip, bones, mode);
    if (masked === clip) return source;
    if (!masked.tracks.length) return null;
    return mixer.clipAction(masked, model);
  };

  /**
   * Everything that should be posing the skeleton this frame, as (action, weight) pairs.
   *
   * The base is split in two when a layer is only partly faded in. Its `exclude` variant drives the
   * bones no layer owns, at full weight. Its `include` variant drives the layer's bones at
   * (1 - layer weight), so those bones land on a clean linear blend between the base and layer poses.
   * Without that second variant a half-weight layer would blend against whatever the bone happened to
   * hold last frame — a lag filter rather than a blend. It is skipped entirely once the layer reaches
   * full weight, which is the common case for a binary aim layer, so a fully-on layer costs nothing
   * extra.
   *
   * Overlapping masks are approximate: a bone claimed by two partly-faded layers receives a base
   * contribution from each. Keep layer masks disjoint (upper body vs legs) and it is exact.
   */
  const collectVoices = (out: Map<THREE.AnimationAction, number>): Map<THREE.AnimationAction, number> => {
    out.clear();
    const add = (action: THREE.AnimationAction | null, weight: number) => accumulateWeight(out, action, weight);

    const activeLayers = layersRef.current ?? [];
    const baseClips = blendRef.current?.length
      ? blendRef.current
      : clipName
        ? [{ name: clipName, weight: 1 }]
        : [];

    for (const clip of baseClips) {
      add(maskedAction(clip.name, baseExcluded, 'exclude'), clip.weight);
      for (const layer of activeLayers) {
        if (layer.weight >= 1 - 1e-4) continue;
        const bones = layerBones.get(layer.id);
        if (!bones?.size) continue;
        add(maskedAction(clip.name, bones, 'include'), clip.weight * (1 - layer.weight));
      }
    }

    for (const layer of activeLayers) {
      const bones = layerBones.get(layer.id);
      if (!bones?.size) continue;
      for (const clip of layer.clips) add(maskedAction(clip.name, bones, 'include'), clip.weight * layer.weight);
    }

    return out;
  };

  /**
   * Writes this frame's weights onto the mixer. Called both from useFrame and immediately after the
   * active clip set changes — drei's useAnimations subscribes its `mixer.update` before this
   * component's useFrame, so a state entered without seeding weights here would render one frame with
   * every action still at the weight `reset()` gave it (1). With a nine-sample directional blend space
   * that frame is the average of all nine clips: a visible pose pop on every entry.
   */
  const applyBlendWeights = () => {
    if (ragdoll) return;
    const byAction = collectVoices(BLEND_WEIGHT_SCRATCH);
    for (const [action, weight] of byAction) action.setEffectiveWeight(weight);
    if (!syncPhaseRef.current) return;
    // Phase sync: retime every voice to the weighted mean cycle length so footfalls stay aligned.
    // Two passes over the scratch map rather than building an array — this runs every frame.
    let totalWeight = 0;
    let weightedDuration = 0;
    for (const [action, weight] of byAction) {
      totalWeight += weight;
      weightedDuration += weight * action.getClip().duration;
    }
    const meanDuration = totalWeight > 0 ? weightedDuration / totalWeight : 0;
    for (const [action] of byAction) {
      action.timeScale = phaseSyncTimeScale(action.getClip().duration, meanDuration);
    }
  };

  /**
   * Identity of the active action SET, so the effect below re-runs when the set changes but not when
   * only weights move. Includes the layer masks and clips, since either changes which actions exist.
   * Joined with "\n" (NOT "|") because exported clip names can contain "|" (e.g. "Armature|Armature|Idle").
   */
  const activeNames = [
    ...(blend?.length ? blend.map((b) => b.name) : clipName ? [clipName] : []),
    ...(layers ?? []).flatMap((layer) => [
      `@${layer.id}:${layer.maskRootBones.join(',')}:${layer.weight >= 1 - 1e-4 ? 'full' : 'partial'}`,
      ...layer.clips.map((clip) => clip.name),
    ]),
  ].join('\n');

  // useLayoutEffect, not useEffect: this is what starts the actions, and until one has been applied the
  // skinned mesh renders in its bind pose — the T-pose flash. A passive effect is flushed after paint,
  // so r3f's render loop can get a frame in first; layout effects run synchronously with the commit,
  // before any rAF callback, which closes that window on mount and on every state change.
  useLayoutEffect(() => {
    // While ragdolling, the physics owns the bones — keep the mixer quiet.
    if (ragdoll) {
      mixer.stopAllAction();
      return;
    }
    // Build the voice set once here; weights are then driven per frame by applyBlendWeights.
    const acts = [...collectVoices(new Map()).keys()];
    // Always weight-driven now: a layer means several actions share the skeleton, so fadeIn's
    // implicit full weight would fight the per-frame weights.
    const blending = acts.length > 1 || Boolean(blend?.length) || Boolean(layers?.length);
    acts.forEach((action) => {
      action.reset();
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      action.clampWhenFinished = !loop;
      // Playback speed lives on the MIXER, never here: three multiplies mixer.timeScale into the
      // delta and then multiplies the action's timeScale in again, so setting both to `speed` ran
      // the clip at speed² (a state authored at 2x played 4x). The mixer is also what the distance
      // LOD above drives, so it has to stay the single authority. Per-action timeScale is reset to
      // neutral because actions are pooled and reused across states.
      action.timeScale = 1;
      // Blend clips: play at a weight driven each frame by useFrame; single clip: crossfade in.
      if (blending) action.play();
      else action.fadeIn(fade).play();
    });
    // Seed the weights now so the mixer's first update after this change already has the real pose.
    if (blending) applyBlendWeights();
    return () => {
      acts.forEach((action) => action.fadeOut(fade));
    };
    // Re-run only when the active clip SET changes (not on every weight tick).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions, activeNames, loop, speed, fade, ragdoll, mixer]);

  // Drive blend-space weights live.
  useFrame(applyBlendWeights);

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

  // Foot IK — plant feet on the ground (terrain or level geometry). Called after the mixer so it
  // post-processes this frame's pose; fully guarded (Play + grounded) so it's a no-op everywhere else.
  useFootIK(model, registerId);
  // Aim / look-at IK — rotate the head to track a target. Opt-in (animator.aimEnabled), additive, clamped.
  useAimIK(model, registerId);

  return (
    <>
      <primitive object={model} />
      {ragdoll && <RagdollRig root={model} active settings={ragdollSettings} objectId={registerId} />}
    </>
  );
}

/** One animation layer resolved to concrete clips, ready to mask and pose. */
export interface ResolvedAnimatorLayer {
  id: string;
  /** Bones this layer owns; each named bone plus its subtree. Empty means the whole skeleton. */
  maskRootBones: string[];
  /** Blend weight of the layer as a whole, 0..1. */
  weight: number;
  /** The layer state's clips and their in-state weights (one entry for a plain clip). */
  clips: { name: string; weight: number }[];
  syncPhase?: boolean;
  loop: boolean;
  speed: number;
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
  /** When the active state is a blend space, the clips + weights to play simultaneously. */
  blend?: { name: string; weight: number }[];
  /** Retime blend samples to a shared cycle length so their footfalls stay aligned. */
  syncPhase?: boolean;
  /** Animation layers to pose on top of the base, each masked to its own bones. */
  layers?: ResolvedAnimatorLayer[];
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
    const urlsOfStates = (states: AnimatorState[]) =>
      states.flatMap((s) => [
        clipOf(s.animationId)?.url,
        ...(s.blendSamples ?? []).map((sample) => clipOf(sample.animationId)?.url),
      ]);
    const clipSourceUrls = [
      ...urlsOfStates(controller.states),
      // Layer clips too, or a layer would have nothing to play the first time it activates.
      ...(controller.layers ?? []).flatMap((layer) => urlsOfStates(layer.states)),
    ].filter((url): url is string => Boolean(url));

    // Parameter defaults, for previewing layer weights in the editor where there is no runtime.
    const previewParams: Record<string, number | boolean> = {};
    for (const parameter of controller.parameters) previewParams[parameter.id] = parameter.defaultValue;

    const liveParam = (id?: string) => {
      const p = controller.parameters.find((q) => q.id === id);
      const raw = (isPlaying && id && live?.params?.[id]) ?? p?.defaultValue ?? 0;
      return typeof raw === 'number' ? raw : Number(raw) || 0;
    };

    /**
     * A state's clips and their weights: the blended samples for a blend space, otherwise nothing
     * (the caller falls back to the state's single clip). Shared by the base machine and every layer
     * so a layer state blends exactly like a base one.
     */
    const blendOfState = (state?: AnimatorState): { name: string; weight: number }[] | undefined => {
      if (!state?.blendSamples?.length || !state.blendParameterId) return undefined;
      const x = liveParam(state.blendParameterId);
      const weighted = state.blendParameterIdY
        ? blend2D(state.blendSamples, x, liveParam(state.blendParameterIdY))
        : blend1D(state.blendSamples, x);
      return weighted
        .map((b) => ({ name: clipOf(b.animationId)?.name, weight: b.weight }))
        .filter((b): b is { name: string; weight: number } => Boolean(b.name));
    };

    // Blend space: blend the samples by the live value(s) of the driving parameter(s) (defaults in the editor).
    const blend = blendOfState(activeState);

    // Animation layers. Outside Play the layer previews its entry state at its authored weight, so a
    // masked aim pose is visible in the editor without pressing Play.
    const resolvedLayers: ResolvedAnimatorLayer[] = [];
    for (const layer of controller.layers ?? []) {
      if (!layer.states.length) continue;
      const liveLayer = isPlaying ? live?.layers?.[layer.id] : undefined;
      const layerStateId = liveLayer?.stateId || layer.defaultStateId || layer.states[0]?.id;
      const layerState = layer.states.find((item) => item.id === layerStateId);
      if (!layerState) continue;
      const weight = liveLayer ? liveLayer.weight : resolveLayerWeight(layer, previewParams);
      // A layer at zero weight contributes nothing, so keep it out of the mixer entirely.
      if (weight <= 1e-4) continue;
      const layerBlend = blendOfState(layerState);
      const single = clipOf(layerState.animationId)?.name;
      const clips = layerBlend ?? (single ? [{ name: single, weight: 1 }] : []);
      if (!clips.length) continue;
      resolvedLayers.push({
        id: layer.id,
        maskRootBones: layer.maskRootBones,
        weight,
        clips,
        syncPhase: layerState.syncPhase,
        loop: layerState.loop ?? true,
        speed: layerState.speed ?? 1,
      });
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
      syncPhase: activeState?.syncPhase,
      layers: resolvedLayers.length ? resolvedLayers : undefined,
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
