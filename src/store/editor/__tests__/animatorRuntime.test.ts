import { describe, expect, it } from 'vitest';
import { animatorStateClipDuration, buildAnimatorControllerRuntime, localMoveVector } from '../animatorRuntime';
import type { AnimatorController, AnimatorState } from '../../../types';

const DURATIONS: Record<string, number> = { idle: 4, walk: 1, run: 0.7, dodgeL: 0.9, dodgeR: 1.1 };
const durationOf = (id: string) => DURATIONS[id];

const state = (over: Partial<AnimatorState> = {}): AnimatorState => ({
  id: 's',
  name: 'S',
  speed: 1,
  loop: true,
  ...over,
});

describe('animatorStateClipDuration', () => {
  it('uses the state clip when it has one', () => {
    expect(animatorStateClipDuration(state({ animationId: 'walk' }), durationOf)).toBe(1);
  });

  it('scales by the state speed, because a 2x state reaches its exit point twice as fast', () => {
    expect(animatorStateClipDuration(state({ animationId: 'walk', speed: 2 }), durationOf)).toBe(0.5);
    expect(animatorStateClipDuration(state({ animationId: 'walk', speed: 0.5 }), durationOf)).toBe(2);
  });

  it('clamps an absurd speed rather than dividing by zero', () => {
    expect(Number.isFinite(animatorStateClipDuration(state({ animationId: 'walk', speed: 0 }), durationOf))).toBe(true);
  });

  // The bug. A blend space authored on a fresh state has no animationId, so this returned 0 — and the
  // exit-time gate (timeInState < duration * exitTime) then always passed, firing one-shot transitions
  // out of the blend space on their very first frame.
  it('falls back to the blend samples when the state has no clip of its own', () => {
    const blend = state({
      blendParameterId: 'p',
      blendSamples: [
        { animationId: 'dodgeL', value: -1 },
        { animationId: 'dodgeR', value: 1 },
      ],
    });
    expect(animatorStateClipDuration(blend, durationOf)).toBe(1.1);
    expect(animatorStateClipDuration(blend, durationOf)).toBeGreaterThan(0);
  });

  it('takes the longest sample so a one-shot blend is not cut to its shortest variant', () => {
    const blend = state({
      blendSamples: [
        { animationId: 'run', value: 0 },
        { animationId: 'idle', value: 1 },
      ],
    });
    expect(animatorStateClipDuration(blend, durationOf)).toBe(4);
  });

  it('prefers the state clip over the samples when both exist', () => {
    const blend = state({ animationId: 'walk', blendSamples: [{ animationId: 'idle', value: 0 }] });
    expect(animatorStateClipDuration(blend, durationOf)).toBe(1);
  });

  it('returns 0 for a state with no clip and no samples, leaving the exit gate a no-op', () => {
    expect(animatorStateClipDuration(state(), durationOf)).toBe(0);
    expect(animatorStateClipDuration(undefined, durationOf)).toBe(0);
  });

  it('ignores samples whose animation asset is missing', () => {
    const blend = state({ blendSamples: [{ animationId: 'gone', value: 0 }, { animationId: 'walk', value: 1 }] });
    expect(animatorStateClipDuration(blend, durationOf)).toBe(1);
    expect(animatorStateClipDuration(state({ blendSamples: [{ animationId: 'gone', value: 0 }] }), durationOf)).toBe(0);
  });
});

describe('buildAnimatorControllerRuntime', () => {
  const controller: AnimatorController = {
    id: 'c',
    name: 'C',
    parameters: [{ id: 'p1', name: 'Speed', type: 'float', defaultValue: 0, source: 'speed' }],
    states: [state({ id: 'a', name: 'A' }), state({ id: 'b', name: 'B' })],
    transitions: [
      { id: 't1', from: 'a', to: 'b', conditions: [], duration: 0.2 },
      { id: 't2', from: 'any', to: 'a', conditions: [], duration: 0.1 },
    ],
    createdAt: 0,
  };

  it('indexes states and parameters by id and name', () => {
    const runtime = buildAnimatorControllerRuntime(controller);
    expect(runtime.statesById.get('a')?.name).toBe('A');
    expect(runtime.paramsById.get('p1')?.name).toBe('Speed');
    expect(runtime.paramsByName.get('Speed')?.id).toBe('p1');
  });

  // "any" transitions must be reachable from every state, or a global rule (fall, death) silently
  // stops firing depending on where the character happens to be.
  it('includes any-state transitions in every state candidate list', () => {
    const runtime = buildAnimatorControllerRuntime(controller);
    expect(runtime.transitionCandidatesByState.get('a')?.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(runtime.transitionCandidatesByState.get('b')?.map((t) => t.id)).toEqual(['t2']);
  });
});

describe('localMoveVector', () => {
  const JOG = 4; // reference (character move) speed

  it('is zero when the object has not meaningfully moved', () => {
    expect(localMoveVector(0, 0, 0, 0, JOG)).toEqual({ moveX: 0, moveY: 0 });
    expect(localMoveVector(1e-9, 1e-9, 0, 0, JOG)).toEqual({ moveX: 0, moveY: 0 });
  });

  it('maps movement along the facing direction to forward', () => {
    // Facing 0 means +Z is forward.
    const move = localMoveVector(0, 1, 0, JOG, JOG);
    expect(move.moveY).toBeCloseTo(1, 6);
    expect(move.moveX).toBeCloseTo(0, 6);
  });

  it('maps movement opposite the facing to backward', () => {
    const move = localMoveVector(0, -1, 0, JOG, JOG);
    expect(move.moveY).toBeCloseTo(-1, 6);
  });

  it('maps sideways movement to the strafe axis', () => {
    expect(localMoveVector(1, 0, 0, JOG, JOG).moveX).toBeCloseTo(1, 6);
    expect(localMoveVector(-1, 0, 0, JOG, JOG).moveX).toBeCloseTo(-1, 6);
  });

  it('rotates with the facing, so the same world motion reads differently', () => {
    // Facing +90 degrees: world +Z is now to the character's left.
    const move = localMoveVector(0, 1, Math.PI / 2, JOG, JOG);
    expect(move.moveY).toBeCloseTo(0, 6);
    expect(move.moveX).toBeCloseTo(-1, 6);
  });

  // The bug this fixes: a normalized direction sat at radius 1 the instant the object moved, so the
  // blend point jumped from idle straight to the rim and never visited the walk range between.
  it('scales the magnitude with speed, so the blend point leaves the origin gradually', () => {
    const crawl = localMoveVector(0, 1, 0, JOG * 0.25, JOG);
    const half = localMoveVector(0, 1, 0, JOG * 0.5, JOG);
    const full = localMoveVector(0, 1, 0, JOG, JOG);
    expect(crawl.moveY).toBeCloseTo(0.25, 6);
    expect(half.moveY).toBeCloseTo(0.5, 6);
    expect(full.moveY).toBeCloseTo(1, 6);
  });

  it('clamps sprinting to the rim rather than running off the sample hull', () => {
    expect(localMoveVector(0, 1, 0, JOG * 3, JOG).moveY).toBeCloseTo(1, 6);
  });

  it('never exceeds unit length, whatever the direction', () => {
    for (let angle = 0; angle < Math.PI * 2; angle += 0.2) {
      const move = localMoveVector(Math.sin(angle), Math.cos(angle), 0.7, JOG * 2, JOG);
      expect(Math.hypot(move.moveX, move.moveY)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  // An animated prop with no character controller has no move speed to scale against; it keeps the
  // original plain-direction behaviour rather than collapsing to zero.
  it('falls back to the plain direction when there is no reference speed', () => {
    const move = localMoveVector(0, 1, 0, 0.01, 0);
    expect(move.moveY).toBeCloseTo(1, 6);
  });

  it('produces finite values for degenerate input', () => {
    for (const move of [
      localMoveVector(0, 1, 0, NaN, JOG),
      localMoveVector(0, 1, 0, JOG, -1),
      localMoveVector(1e12, 1e12, 0, JOG, JOG),
    ]) {
      expect(Number.isFinite(move.moveX)).toBe(true);
      expect(Number.isFinite(move.moveY)).toBe(true);
    }
  });
});
