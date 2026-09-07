import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { findRootBone, horizontalRootDistance } from '../rootMotion';

/** Model → Armature (plain Object3D) → Hips (bone) → Spine (bone), plus a sibling mesh. */
const rig = () => {
  const model = new THREE.Object3D();
  model.name = 'Model';
  const armature = new THREE.Object3D();
  armature.name = 'Armature';
  const hips = new THREE.Bone();
  hips.name = 'Hips';
  const spine = new THREE.Bone();
  spine.name = 'Spine';
  hips.add(spine);
  armature.add(hips);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  mesh.name = 'Body';
  model.add(mesh, armature);
  return { model, hips, spine, mesh };
};

describe('findRootBone', () => {
  it('finds the topmost bone through non-bone ancestors', () => {
    const { model, hips } = rig();
    expect(findRootBone(model)).toBe(hips);
  });

  // Breadth-first, not depth-first: a depth-first walk down a sibling subtree could reach a deeper
  // bone (a Spine, or a prop's bone) before the actual skeleton root.
  it('prefers the shallowest bone, not the first one a depth walk reaches', () => {
    const model = new THREE.Object3D();
    const deepBranch = new THREE.Object3D();
    const deepBone = new THREE.Bone();
    deepBone.name = 'PropBone';
    deepBranch.add(new THREE.Object3D().add(deepBone));
    const shallow = new THREE.Bone();
    shallow.name = 'Hips';
    model.add(deepBranch, shallow);
    expect(findRootBone(model)?.name).toBe('Hips');
  });

  it('returns null for a rig with no bones, so extraction self-disables', () => {
    const model = new THREE.Object3D();
    model.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    expect(findRootBone(model)).toBeNull();
  });

  it('handles the root itself being a bone', () => {
    const bone = new THREE.Bone();
    bone.name = 'root';
    expect(findRootBone(bone)).toBe(bone);
  });
});

describe('horizontalRootDistance', () => {
  it('measures travel on the ground plane', () => {
    expect(horizontalRootDistance(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0.05))).toBeCloseTo(0.05);
    expect(horizontalRootDistance(new THREE.Vector3(1, 0, 1), new THREE.Vector3(4, 0, 5))).toBeCloseTo(5);
  });

  // Gravity and jumping own the Y axis. A clip's vertical bob must not read as travel, or a jump
  // animation would drive the character forwards.
  it('ignores vertical displacement entirely', () => {
    expect(horizontalRootDistance(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 3, 0))).toBe(0);
    expect(horizontalRootDistance(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 9, 0.05))).toBeCloseTo(0.05);
  });

  it('is unsigned, so a direction reversal still reads as travel', () => {
    expect(horizontalRootDistance(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -0.05))).toBeCloseTo(0.05);
  });

  it('is zero for a standing-still frame', () => {
    const at = new THREE.Vector3(2, 1, 3);
    expect(horizontalRootDistance(at, at.clone())).toBe(0);
  });
});

/**
 * The extraction loop itself lives in a useFrame and needs a renderer to drive, which this repo's
 * suite deliberately does not do. What IS testable, and what the character depends on, is that the
 * measure-then-pin sequence over a real animated bone yields the authored per-frame travel and leaves
 * the bone back on its rest position. This reproduces that sequence against a real AnimationMixer.
 */
describe('measure-then-pin over a real mixer', () => {
  /** A 1-second clip walking the root 2 units forward along +Z. */
  const walkForward = () =>
    new THREE.AnimationClip('walk', 1, [
      new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, 0, 0, 0, 0, 2]),
    ]);

  it('reports the authored travel per frame and pins the bone back to rest', () => {
    const { model, hips } = rig();
    const mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(walkForward()).play();

    const rest = hips.position.clone();
    let previous = hips.position.clone();
    let primed = false;
    let total = 0;

    for (let frame = 0; frame < 10; frame += 1) {
      mixer.update(0.05);
      if (primed) total += horizontalRootDistance(previous, hips.position);
      previous.copy(hips.position);
      primed = true;
      // Pin horizontally, keep the clip's Y.
      hips.position.set(rest.x, hips.position.y, rest.z);
      previous = previous.clone();
    }

    // 10 frames x 0.05s = 0.5s of a 1s clip travelling 2 units, minus the first priming frame.
    expect(total).toBeCloseTo(2 * 0.45, 4);
    expect(hips.position.x).toBeCloseTo(rest.x);
    expect(hips.position.z).toBeCloseTo(rest.z);
  });

  it('leaves the pose alone on the vertical axis', () => {
    const { model, hips } = rig();
    const mixer = new THREE.AnimationMixer(model);
    mixer
      .clipAction(
        new THREE.AnimationClip('hop', 1, [
          new THREE.VectorKeyframeTrack('Hips.position', [0, 1], [0, 0, 0, 0, 1.5, 0]),
        ]),
      )
      .play();

    const rest = hips.position.clone();
    mixer.update(0.5);
    const y = hips.position.y;
    hips.position.set(rest.x, hips.position.y, rest.z);
    expect(y).toBeGreaterThan(0.5);
    expect(hips.position.y).toBeCloseTo(y);
  });
});
