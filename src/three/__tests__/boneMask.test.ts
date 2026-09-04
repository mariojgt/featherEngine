import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { collectMaskedBones, maskClip, trackTargetBone, type BoneNode } from '../boneMask';

/** Hips -> Spine -> Chest -> {LeftArm -> LeftHand, RightArm}, and Hips -> LeftLeg. */
const rig = (): BoneNode => ({
  name: 'Hips',
  children: [
    {
      name: 'Spine',
      children: [
        {
          name: 'Chest',
          children: [
            { name: 'LeftArm', children: [{ name: 'LeftHand' }] },
            { name: 'RightArm' },
          ],
        },
      ],
    },
    { name: 'LeftLeg', children: [{ name: 'LeftFoot' }] },
  ],
});

const quatTrack = (bone: string) =>
  new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
const posTrack = (bone: string) => new THREE.VectorKeyframeTrack(`${bone}.position`, [0, 1], [0, 0, 0, 0, 1, 0]);

const clipOver = (bones: string[], duration = 2) =>
  new THREE.AnimationClip('walk', duration, bones.map(quatTrack));

const boneNamesOf = (clip: THREE.AnimationClip) => clip.tracks.map((track) => trackTargetBone(track.name));

describe('trackTargetBone', () => {
  it('reads the plain node form', () => {
    expect(trackTargetBone('Spine.quaternion')).toBe('Spine');
    expect(trackTargetBone('Hips.position')).toBe('Hips');
  });

  // Some skinned exports address bones through the mesh, putting the bone in the object index.
  it('reads the skinned bones[Name] form', () => {
    expect(trackTargetBone('Armature.bones[Spine].quaternion')).toBe('Spine');
  });

  // Bone names may legitimately contain dots, which a naive name.split('.')[0] gets wrong — this is
  // why three's own parser is used rather than string surgery.
  it('handles a bone name containing dots', () => {
    expect(trackTargetBone('Spine.01.quaternion')).toBe('Spine.01');
  });

  /**
   * three's track grammar treats a `prefix:` or `prefix/` segment as a directory and drops it, so a
   * raw Mixamo name would lose its `mixamorig:` and stop matching the bone in the hierarchy.
   *
   * That mismatch cannot actually happen, because GLTFLoader runs every node name through
   * PropertyBinding.sanitizeNodeName, which STRIPS the reserved characters `[].:/` — and it builds
   * the track names from those same sanitized names. So both sides of the comparison see
   * "mixamorigSpine" and agree. This test pins that reasoning: if a loader ever fed us unsanitized
   * names, masks would silently match nothing and layers would appear to do nothing at all.
   */
  it('drops a directory-style prefix, which is why sanitized names are what actually reach us', () => {
    expect(trackTargetBone('mixamorig:Spine.quaternion')).toBe('Spine');
    expect(THREE.PropertyBinding.sanitizeNodeName('mixamorig:Spine')).toBe('mixamorigSpine');
    // The realistic pairing: sanitized on both sides, so they match.
    expect(trackTargetBone('mixamorigSpine.quaternion')).toBe('mixamorigSpine');
  });

  it('returns undefined instead of throwing on an unparseable name', () => {
    expect(trackTargetBone('')).toBeUndefined();
  });
});

describe('collectMaskedBones', () => {
  it('includes the named bone and its whole subtree', () => {
    expect(collectMaskedBones(rig(), ['Spine'])).toEqual(
      new Set(['Spine', 'Chest', 'LeftArm', 'LeftHand', 'RightArm']),
    );
  });

  it('leaves the rest of the skeleton out', () => {
    const mask = collectMaskedBones(rig(), ['Spine']);
    expect(mask.has('Hips')).toBe(false);
    expect(mask.has('LeftLeg')).toBe(false);
    expect(mask.has('LeftFoot')).toBe(false);
  });

  it('unions several roots', () => {
    expect(collectMaskedBones(rig(), ['LeftArm', 'RightArm'])).toEqual(
      new Set(['LeftArm', 'LeftHand', 'RightArm']),
    );
  });

  it('takes the whole rig when the root bone is the root', () => {
    expect(collectMaskedBones(rig(), ['Hips']).size).toBe(8);
  });

  it('is empty for no roots or no rig', () => {
    expect(collectMaskedBones(rig(), [])).toEqual(new Set());
    expect(collectMaskedBones(undefined, ['Spine'])).toEqual(new Set());
  });

  // A mask authored against one rig and used on another should shrink, not explode.
  it('ignores names the rig does not have', () => {
    expect(collectMaskedBones(rig(), ['NotABone'])).toEqual(new Set());
    expect(collectMaskedBones(rig(), ['NotABone', 'RightArm'])).toEqual(new Set(['RightArm']));
  });

  it('reads a real three bone hierarchy', () => {
    const hips = new THREE.Bone();
    hips.name = 'Hips';
    const spine = new THREE.Bone();
    spine.name = 'Spine';
    const chest = new THREE.Bone();
    chest.name = 'Chest';
    const leg = new THREE.Bone();
    leg.name = 'LeftLeg';
    spine.add(chest);
    hips.add(spine, leg);
    expect(collectMaskedBones(hips, ['Spine'])).toEqual(new Set(['Spine', 'Chest']));
  });
});

describe('maskClip', () => {
  const ALL = ['Hips', 'Spine', 'Chest', 'LeftArm', 'LeftLeg'];
  const upper = () => collectMaskedBones(rig(), ['Spine']);

  it('include keeps only the masked bones tracks', () => {
    const masked = maskClip(clipOver(ALL), upper(), 'include');
    expect(boneNamesOf(masked).sort()).toEqual(['Chest', 'LeftArm', 'Spine']);
  });

  it('exclude keeps everything else', () => {
    const masked = maskClip(clipOver(ALL), upper(), 'exclude');
    expect(boneNamesOf(masked).sort()).toEqual(['Hips', 'LeftLeg']);
  });

  // The whole point: include and exclude must partition the clip, or a bone ends up with two
  // contributors (averaged, so neither pose wins) or none (frozen at rest).
  it('include and exclude partition the tracks exactly', () => {
    const clip = clipOver(ALL);
    const mask = upper();
    const inc = maskClip(clip, mask, 'include');
    const exc = maskClip(clip, mask, 'exclude');
    expect(inc.tracks.length + exc.tracks.length).toBe(clip.tracks.length);
    const overlap = boneNamesOf(inc).filter((bone) => boneNamesOf(exc).includes(bone));
    expect(overlap).toEqual([]);
  });

  it('keeps every track for a bone, not just the first', () => {
    const clip = new THREE.AnimationClip('walk', 2, [quatTrack('Spine'), posTrack('Spine'), quatTrack('Hips')]);
    expect(maskClip(clip, upper(), 'include').tracks).toHaveLength(2);
  });

  // A shortened clip would drift out of sync with the base layer and hitch when it loops.
  it('preserves the original duration even when the longest track is masked away', () => {
    const clip = new THREE.AnimationClip('walk', 5, [quatTrack('Hips'), quatTrack('Spine')]);
    expect(maskClip(clip, upper(), 'include').duration).toBe(5);
    expect(maskClip(clip, upper(), 'exclude').duration).toBe(5);
  });

  it('preserves the blend mode', () => {
    const clip = new THREE.AnimationClip('add', 2, [quatTrack('Spine')], THREE.AdditiveAnimationBlendMode);
    expect(maskClip(clip, upper(), 'include').blendMode).toBe(THREE.AdditiveAnimationBlendMode);
  });

  it('returns the clip itself when excluding an empty mask, avoiding a pointless copy', () => {
    const clip = clipOver(ALL);
    expect(maskClip(clip, new Set(), 'exclude')).toBe(clip);
  });

  it('returns an empty clip when including an empty mask', () => {
    expect(maskClip(clipOver(ALL), new Set(), 'include').tracks).toHaveLength(0);
  });

  it('caches, so masking the same clip every frame does not reallocate', () => {
    const clip = clipOver(ALL);
    const mask = upper();
    expect(maskClip(clip, mask, 'include')).toBe(maskClip(clip, mask, 'include'));
    // Bone insertion order must not produce a second cache entry.
    expect(maskClip(clip, new Set(['Spine', 'Chest']), 'include')).toBe(
      maskClip(clip, new Set(['Chest', 'Spine']), 'include'),
    );
  });

  it('keeps include and exclude as separate cache entries', () => {
    const clip = clipOver(ALL);
    const mask = upper();
    expect(maskClip(clip, mask, 'include')).not.toBe(maskClip(clip, mask, 'exclude'));
  });

  it('leaves an unresolvable track with the base rather than letting a layer claim it', () => {
    const clip = clipOver(ALL);
    // A track three cannot parse: the layer must not take it, and the base must keep it.
    clip.tracks.push(new THREE.VectorKeyframeTrack('.position', [0, 1], [0, 0, 0, 0, 1, 0]));
    const mask = collectMaskedBones(rig(), ['Hips']); // whole rig, so only the odd track is in question
    expect(maskClip(clip, mask, 'include').tracks.some((t) => t.name === '.position')).toBe(false);
    expect(maskClip(clip, mask, 'exclude').tracks.some((t) => t.name === '.position')).toBe(true);
  });
});

/**
 * The behaviour that forces masking to exist. If a future three release made overlapping actions
 * override rather than average, layers could be built far more simply — so pin the assumption.
 */
describe('three mixer blending of overlapping tracks', () => {
  it('AVERAGES two actions driving the same property at equal weight', () => {
    const node = new THREE.Object3D();
    node.name = 'Spine';
    const root = new THREE.Object3D();
    root.add(node);

    const toZero = new THREE.AnimationClip('a', 1, [
      new THREE.VectorKeyframeTrack('Spine.position', [0, 1], [0, 0, 0, 0, 0, 0]),
    ]);
    const toTen = new THREE.AnimationClip('b', 1, [
      new THREE.VectorKeyframeTrack('Spine.position', [0, 1], [0, 10, 0, 0, 10, 0]),
    ]);

    const mixer = new THREE.AnimationMixer(root);
    const a = mixer.clipAction(toZero);
    const b = mixer.clipAction(toTen);
    a.play();
    b.play();
    a.setEffectiveWeight(1);
    b.setEffectiveWeight(1);
    mixer.update(0.1);

    // Not 10 (b overriding) — the midpoint. This is the half-aiming, half-running spine.
    expect(node.position.y).toBeCloseTo(5, 4);
  });

  it('gives one contributor the full pose once the track sets are disjoint', () => {
    const spine = new THREE.Object3D();
    spine.name = 'Spine';
    const hips = new THREE.Object3D();
    hips.name = 'Hips';
    const root = new THREE.Object3D();
    root.add(spine, hips);

    const full = new THREE.AnimationClip('full', 1, [
      new THREE.VectorKeyframeTrack('Spine.position', [0, 1], [0, 0, 0, 0, 0, 0]),
      new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, 3, 0, 0, 3, 0]),
    ]);
    const layer = new THREE.AnimationClip('layer', 1, [
      new THREE.VectorKeyframeTrack('Spine.position', [0, 1], [0, 10, 0, 0, 10, 0]),
    ]);

    const mask = new Set(['Spine']);
    const mixer = new THREE.AnimationMixer(root);
    const base = mixer.clipAction(maskClip(full, mask, 'exclude'));
    const upper = mixer.clipAction(maskClip(layer, mask, 'include'));
    base.play();
    upper.play();
    base.setEffectiveWeight(1);
    upper.setEffectiveWeight(1);
    mixer.update(0.1);

    expect(spine.position.y).toBeCloseTo(10, 4); // layer owns the spine outright
    expect(hips.position.y).toBeCloseTo(3, 4); // base still owns the hips
  });
});
