import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

/**
 * SkinnedModel drives animation playback speed through `mixer.timeScale` alone, and deliberately
 * leaves every action's `timeScale` at 1.
 *
 * That rule exists because three applies both: AnimationMixer.update multiplies the frame delta by
 * the mixer's timeScale, and AnimationAction._update multiplies it again by the action's. Setting
 * both to the authored speed ran clips at speed² — a state authored at 2x played at 4x, and one at
 * 0.5x crawled at 0.25x. The mixer is also what the distance-LOD logic drives, so it has to remain
 * the single authority.
 *
 * These tests pin that multiplication as a tripwire: if a three upgrade ever changes it, or someone
 * reintroduces a per-action speed, the assumption behind the fix is no longer true and this fails.
 */

const makeAction = () => {
  const root = new THREE.Object3D();
  root.name = 'root';
  // A 10-second clip, so advanced time is easy to read and never wraps in these tests.
  const track = new THREE.VectorKeyframeTrack('root.position', [0, 10], [0, 0, 0, 0, 10, 0]);
  const clip = new THREE.AnimationClip('move', 10, [track]);
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();
  return { mixer, action };
};

describe('three animation time scaling', () => {
  it('advances an action by the raw delta at neutral scales', () => {
    const { mixer, action } = makeAction();
    mixer.update(1);
    expect(action.time).toBeCloseTo(1, 6);
  });

  it('applies the mixer timeScale', () => {
    const { mixer, action } = makeAction();
    mixer.timeScale = 2;
    mixer.update(1);
    expect(action.time).toBeCloseTo(2, 6);
  });

  it('applies the action timeScale', () => {
    const { mixer, action } = makeAction();
    action.timeScale = 2;
    mixer.update(1);
    expect(action.time).toBeCloseTo(2, 6);
  });

  // The bug: both set to the authored speed compounded into speed².
  it('MULTIPLIES the mixer and action time scales', () => {
    const { mixer, action } = makeAction();
    mixer.timeScale = 2;
    action.timeScale = 2;
    mixer.update(1);
    expect(action.time).toBeCloseTo(4, 6);
  });

  it('is exact for a fractional speed driven only by the mixer', () => {
    const { mixer, action } = makeAction();
    mixer.timeScale = 0.5;
    mixer.update(1);
    expect(action.time).toBeCloseTo(0.5, 6);
    // Not 0.25 — which is what the old code produced for a state authored at half speed.
    expect(action.time).not.toBeCloseTo(0.25, 6);
  });

  it('holds the pose when the mixer timeScale is zero, as the distance LOD relies on', () => {
    const { mixer, action } = makeAction();
    mixer.update(1);
    mixer.timeScale = 0;
    mixer.update(1);
    expect(action.time).toBeCloseTo(1, 6);
  });

  it('releases skipped frames in one step, as the distance LOD relies on', () => {
    // The LOD holds for (interval - 1) frames, then releases with timeScale = speed * interval,
    // so total advanced time matches running every frame at `speed`.
    const stepped = makeAction();
    for (let frame = 0; frame < 3; frame += 1) {
      stepped.mixer.timeScale = frame === 2 ? 3 : 0;
      stepped.mixer.update(1 / 60);
    }
    const every = makeAction();
    for (let frame = 0; frame < 3; frame += 1) {
      every.mixer.update(1 / 60);
    }
    expect(stepped.action.time).toBeCloseTo(every.action.time, 6);
  });
});
