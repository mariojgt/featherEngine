import * as THREE from 'three';

/**
 * Bone masking — the primitive behind animation layers.
 *
 * ## Why masking is required
 * three's AnimationMixer blends every action that targets the same property, weighted by their
 * effective weights, and normalizes by the total. Two actions both driving `Spine.quaternion` at
 * weight 1 therefore produce the AVERAGE of the two poses, not the second overriding the first. So an
 * "upper body aim" layer cannot simply be played on top of locomotion — the result is a half-aiming,
 * half-running spine.
 *
 * The fix is to make the track sets disjoint: the layer plays only the tracks for the bones it owns,
 * and the base plays everything EXCEPT those bones. Each property then has exactly one contributor at
 * full weight, and the two poses meet at the mask boundary. Partial layer weights still blend
 * smoothly: at weight w the layer contributes w, the base contributes nothing for those bones, and
 * three's normalization eases the bone from its rest/base value toward the layer pose as w rises.
 *
 * ## What lives here
 * Deriving the bone set from a live skeleton, and building the masked clips (cached, because the same
 * mask is applied to the same clip on every frame).
 */

/** A minimal Object3D shape, so bone collection is testable without building a real skeleton. */
export interface BoneNode {
  name: string;
  children?: BoneNode[];
}

/**
 * Resolves which bone a keyframe track drives.
 *
 * Track names are usually `BoneName.quaternion`, but skinned exports also emit
 * `SkinnedMesh.bones[BoneName].quaternion`, where the bone identity is the object index rather than
 * the node name. three's own parser handles both, so use it rather than splitting on '.' — bone names
 * are allowed to contain dots, which is exactly what a naive split gets wrong.
 *
 * Returns undefined for a track three cannot parse, so one malformed track cannot take down a whole
 * clip (parseTrackName throws).
 */
export function trackTargetBone(trackName: string): string | undefined {
  let parsed: ReturnType<typeof THREE.PropertyBinding.parseTrackName>;
  try {
    parsed = THREE.PropertyBinding.parseTrackName(trackName);
  } catch {
    return undefined;
  }
  if (parsed.objectName === 'bones' && parsed.objectIndex) return String(parsed.objectIndex);
  return parsed.nodeName || undefined;
}

/**
 * Every bone named in `rootBoneNames`, plus all of their descendants.
 *
 * Masks are authored as a handful of root bones ("Spine" for the upper body) rather than an explicit
 * list of every bone, because naming forty finger bones by hand is not a workflow. The subtree is
 * resolved against the live skeleton, so it follows whatever rig is actually bound.
 *
 * Unknown names are simply absent from the result — a mask authored against a different rig degrades
 * to a smaller mask (or an empty one, which the layer treats as driving nothing) rather than throwing.
 */
export function collectMaskedBones(root: BoneNode | undefined, rootBoneNames: string[]): Set<string> {
  const out = new Set<string>();
  if (!root || !rootBoneNames.length) return out;
  const wanted = new Set(rootBoneNames);

  const walk = (node: BoneNode, inside: boolean) => {
    const here = inside || wanted.has(node.name);
    if (here && node.name) out.add(node.name);
    for (const child of node.children ?? []) walk(child, here);
  };
  walk(root, false);

  return out;
}

/** Masking direction: keep the listed bones' tracks, or keep everything except them. */
export type BoneMaskMode = 'include' | 'exclude';

/**
 * Cache of derived clips. Keyed first by the source clip (weakly, so unloading a model releases its
 * derived clips too) then by mask identity, because the same mask is applied on many frames and
 * rebuilding would allocate a fresh track array every time.
 */
const maskedClipCache = new WeakMap<THREE.AnimationClip, Map<string, THREE.AnimationClip>>();

/** Stable key for a mask, independent of the order the bones were collected in. */
const maskKey = (bones: Set<string>, mode: BoneMaskMode): string => `${mode}:${[...bones].sort().join(' ')}`;

/**
 * A copy of `clip` containing only the tracks that target the masked bones (`include`) or only those
 * that do not (`exclude`).
 *
 * The derived clip keeps the ORIGINAL duration rather than letting the constructor infer one from the
 * surviving tracks. An inferred duration would shorten whenever the longest track happened to be
 * masked out, which would desynchronise the layer from the base and hitch on loop.
 *
 * Excluding an empty mask returns the clip unchanged, since that is the identity and a copy would be
 * pure waste. A clip whose every track is masked away comes back with zero tracks; callers should skip
 * playing those rather than feed the mixer an empty action.
 */
export function maskClip(clip: THREE.AnimationClip, bones: Set<string>, mode: BoneMaskMode): THREE.AnimationClip {
  // Excluding nothing is the identity. Including nothing is EMPTY, not identity — so it falls through.
  if (mode === 'exclude' && bones.size === 0) return clip;

  const key = maskKey(bones, mode);
  let perClip = maskedClipCache.get(clip);
  if (!perClip) {
    perClip = new Map();
    maskedClipCache.set(clip, perClip);
  }
  const cached = perClip.get(key);
  if (cached) return cached;

  const tracks = clip.tracks.filter((track) => {
    const bone = trackTargetBone(track.name);
    // A track whose target cannot be resolved stays with the BASE (it is excluded from layers): a
    // layer should only ever claim tracks it can positively identify as its own.
    const owned = bone !== undefined && bones.has(bone);
    return mode === 'include' ? owned : !owned;
  });

  const masked = new THREE.AnimationClip(`${clip.name}__${key}`, clip.duration, tracks, clip.blendMode);
  perClip.set(key, masked);
  return masked;
}

/** Drops a clip's derived masks. Exposed for tests; production relies on the WeakMap. */
export function clearMaskedClipCache(clip: THREE.AnimationClip): void {
  maskedClipCache.delete(clip);
}
