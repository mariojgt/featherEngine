import { afterEach, describe, expect, it } from 'vitest';
import {
  accumulateRootMotion,
  clearRootMotion,
  drainRootMotion,
  isPlausibleRootStep,
  MAX_ROOT_MOTION_SPEED,
  peekRootMotion,
  rootMotionSpeed,
} from '../rootMotion';

/**
 * The renderer accumulates and the tick drains, because the two loops run at unrelated rates. These
 * tests pin the properties the character controller depends on: every frame's displacement is counted
 * exactly once, the reported speed is the average over the whole interval whatever the frame ratio
 * was, and no input can produce a non-finite speed — a NaN reaching the controller's target velocity
 * puts the character transform beyond recovery.
 */
describe('root motion accumulator', () => {
  afterEach(() => clearRootMotion());

  it('reports nothing before anything is published', () => {
    expect(drainRootMotion('a')).toBeUndefined();
    expect(peekRootMotion('a')).toBeUndefined();
  });

  it('sums the frames that land between two ticks', () => {
    accumulateRootMotion('a', 0.05, 1 / 60);
    accumulateRootMotion('a', 0.05, 1 / 60);
    accumulateRootMotion('a', 0.05, 1 / 60);
    const drained = drainRootMotion('a');
    expect(drained?.distance).toBeCloseTo(0.15, 6);
    expect(drained?.elapsed).toBeCloseTo(3 / 60, 6);
  });

  // Each frame's displacement must be consumed exactly once, or the character double-steps.
  it('clears on drain', () => {
    accumulateRootMotion('a', 0.1, 1 / 60);
    expect(drainRootMotion('a')).toBeDefined();
    expect(drainRootMotion('a')).toBeUndefined();
  });

  it('peeks without consuming', () => {
    accumulateRootMotion('a', 0.1, 1 / 60);
    expect(peekRootMotion('a')?.distance).toBeCloseTo(0.1);
    expect(peekRootMotion('a')?.distance).toBeCloseTo(0.1);
    expect(drainRootMotion('a')?.distance).toBeCloseTo(0.1);
  });

  it('keeps objects independent', () => {
    accumulateRootMotion('a', 0.1, 1 / 60);
    accumulateRootMotion('b', 0.9, 1 / 60);
    expect(drainRootMotion('a')?.distance).toBeCloseTo(0.1);
    expect(drainRootMotion('b')?.distance).toBeCloseTo(0.9);
  });

  it('drops non-finite and non-positive intervals rather than poisoning the accumulator', () => {
    accumulateRootMotion('a', NaN, 1 / 60);
    accumulateRootMotion('a', 0.1, NaN);
    accumulateRootMotion('a', 0.1, 0);
    accumulateRootMotion('a', 0.1, -1);
    accumulateRootMotion('a', Infinity, 1 / 60);
    expect(drainRootMotion('a')).toBeUndefined();
  });

  it('clears everything when Play stops', () => {
    accumulateRootMotion('a', 0.1, 1 / 60);
    accumulateRootMotion('b', 0.1, 1 / 60);
    clearRootMotion();
    expect(drainRootMotion('a')).toBeUndefined();
    expect(drainRootMotion('b')).toBeUndefined();
  });
});

describe('rootMotionSpeed', () => {
  it('is distance over the animation time it covers', () => {
    expect(rootMotionSpeed({ distance: 0.15, elapsed: 3 / 60 })).toBeCloseTo(3);
  });

  // The whole reason for accumulating both numbers: the average must not depend on how many render
  // frames happened to land in the interval.
  it('gives the same speed however the interval was subdivided', () => {
    const oneFrame = rootMotionSpeed({ distance: 0.15, elapsed: 3 / 60 });
    const threeFrames = rootMotionSpeed({ distance: 0.05 * 3, elapsed: (1 / 60) * 3 });
    expect(oneFrame).toBeCloseTo(threeFrames);
  });

  it('is zero for a missing or degenerate sample', () => {
    expect(rootMotionSpeed(undefined)).toBe(0);
    expect(rootMotionSpeed({ distance: 1, elapsed: 0 })).toBe(0);
    expect(rootMotionSpeed({ distance: 1, elapsed: -1 })).toBe(0);
  });

  it('never returns a non-finite or negative speed', () => {
    for (const sample of [
      { distance: NaN, elapsed: 1 },
      { distance: Infinity, elapsed: 1 },
      { distance: -5, elapsed: 1 },
      { distance: 1, elapsed: Number.MIN_VALUE },
    ]) {
      const speed = rootMotionSpeed(sample);
      expect(Number.isFinite(speed)).toBe(true);
      expect(speed).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('isPlausibleRootStep', () => {
  it('accepts an ordinary frame of walking', () => {
    // ~3 units/sec at 60fps.
    expect(isPlausibleRootStep(0.05, 1 / 60)).toBe(true);
  });

  it('accepts a standing-still frame', () => {
    expect(isPlausibleRootStep(0, 1 / 60)).toBe(true);
  });

  // A looping clip wraps the root from the end of the cycle back to the start, which reads as one
  // enormous step. Feeding that to the controller would teleport the character.
  it('rejects a loop wrap', () => {
    // A 4-unit walk cycle wrapping in a single frame is ~240 units/sec.
    expect(isPlausibleRootStep(4, 1 / 60)).toBe(false);
    expect(isPlausibleRootStep(MAX_ROOT_MOTION_SPEED * 2 * (1 / 60), 1 / 60)).toBe(false);
  });

  it('rejects backwards travel, which only a wrap or a malformed track produces', () => {
    expect(isPlausibleRootStep(-0.05, 1 / 60)).toBe(false);
  });

  it('rejects a degenerate timestep', () => {
    expect(isPlausibleRootStep(0.05, 0)).toBe(false);
    expect(isPlausibleRootStep(0.05, NaN)).toBe(false);
    expect(isPlausibleRootStep(NaN, 1 / 60)).toBe(false);
  });

  // A sprint is well under the ceiling and a wrap is well over it, so the threshold is not delicate.
  it('leaves clear headroom between a sprint and a wrap', () => {
    expect(isPlausibleRootStep(10 * (1 / 60), 1 / 60)).toBe(true);
    expect(MAX_ROOT_MOTION_SPEED).toBeGreaterThan(10);
  });
});
