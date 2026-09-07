import { describe, expect, it } from 'vitest';
import {
  animatorStateClipDuration,
  buildAnimatorControllerRuntime,
  localMoveVector,
  resolveLayerWeight,
  stepStateMachine,
  type StateMachineStep,
} from '../animatorRuntime';
import type { AnimatorController, AnimatorState, AnimatorTransition } from '../../../types';

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

/**
 * The transition rules were inline in tickRuntime, a ~6000-line function, so nothing could test them.
 * Extracting them so animation layers could reuse the same evaluator also made them testable for the
 * first time.
 */
describe('stepStateMachine', () => {
  const compare = (left: number | boolean, right: number | boolean, op: string): boolean => {
    switch (op) {
      case '==': return left === right;
      case '!=': return left !== right;
      case '>': return Number(left) > Number(right);
      case '>=': return Number(left) >= Number(right);
      case '<': return Number(left) < Number(right);
      case '<=': return Number(left) <= Number(right);
      default: return false;
    }
  };

  const IDLE = state({ id: 'idle', name: 'Idle', animationId: 'idle' });
  const RUN = state({ id: 'run', name: 'Run', animationId: 'walk' });
  const LAND = state({ id: 'land', name: 'Land', animationId: 'walk', loop: false });

  const speedParam = { id: 'p-speed', name: 'Speed', type: 'float' as const, defaultValue: 0, source: 'speed' as const };
  const paramsById = new Map([[speedParam.id, speedParam]]);

  const machine = (transitions: AnimatorTransition[], states = [IDLE, RUN, LAND]) => {
    const candidates = new Map<string, AnimatorTransition[]>();
    for (const s of states) {
      candidates.set(s.id, transitions.filter((t) => t.from === s.id || t.from === 'any'));
    }
    return { states, transitionCandidatesByState: candidates };
  };

  const run = (
    transitions: AnimatorTransition[],
    params: Record<string, number | boolean>,
    prev?: StateMachineStep,
    dt = 1 / 60,
    states?: typeof IDLE[],
  ) =>
    stepStateMachine({
      ...machine(transitions, states),
      defaultStateId: 'idle',
      prev,
      dt,
      params,
      paramsById,
      durationOf,
      compare,
    });

  const toRun: AnimatorTransition = {
    id: 't1',
    from: 'idle',
    to: 'run',
    conditions: [{ parameterId: 'p-speed', op: '>', value: 0.1 }],
    duration: 0.2,
  };

  it('starts in the entry state', () => {
    expect(run([], {}).stateId).toBe('idle');
  });

  it('stays put when no condition passes, and accumulates time', () => {
    const first = run([toRun], { 'p-speed': 0 });
    expect(first.stateId).toBe('idle');
    const second = run([toRun], { 'p-speed': 0 }, first);
    expect(second.time).toBeCloseTo(first.time * 2, 6);
    expect(second.fade).toBe(0);
  });

  it('takes a transition whose condition passes, carrying its crossfade', () => {
    const step = run([toRun], { 'p-speed': 4 });
    expect(step.stateId).toBe('run');
    expect(step.fade).toBe(0.2);
  });

  it('resets time on entering a new state', () => {
    const inIdle = { stateId: 'idle', fade: 0, time: 5 };
    expect(run([toRun], { 'p-speed': 4 }, inIdle).time).toBe(0);
  });

  it('ANDs every condition on a transition', () => {
    const both: AnimatorTransition = {
      ...toRun,
      conditions: [
        { parameterId: 'p-speed', op: '>', value: 0.1 },
        { parameterId: 'p-speed', op: '<', value: 1 },
      ],
    };
    expect(run([both], { 'p-speed': 0.5 }).stateId).toBe('run');
    expect(run([both], { 'p-speed': 4 }).stateId).toBe('idle');
  });

  it('takes the first matching transition, so authoring order is the priority', () => {
    const toLand: AnimatorTransition = { id: 't2', from: 'idle', to: 'land', conditions: [], duration: 0.5 };
    expect(run([toRun, toLand], { 'p-speed': 4 }).stateId).toBe('run');
    expect(run([toLand, toRun], { 'p-speed': 4 }).stateId).toBe('land');
  });

  it('fires an any-state transition from wherever it is', () => {
    const anyToLand: AnimatorTransition = {
      id: 't3',
      from: 'any',
      to: 'land',
      conditions: [{ parameterId: 'p-speed', op: '<', value: 0 }],
      duration: 0.1,
    };
    expect(run([anyToLand], { 'p-speed': -1 }, { stateId: 'run', fade: 0, time: 1 }).stateId).toBe('land');
  });

  it('never transitions a state to itself', () => {
    const selfLoop: AnimatorTransition = { id: 't4', from: 'idle', to: 'idle', conditions: [], duration: 0.3 };
    const step = run([selfLoop], {}, { stateId: 'idle', fade: 0, time: 2 });
    expect(step.stateId).toBe('idle');
    expect(step.fade).toBe(0); // not a re-entry, so no crossfade and time keeps running
    expect(step.time).toBeGreaterThan(2);
  });

  it('ignores a transition pointing at a deleted state', () => {
    const dangling: AnimatorTransition = { id: 't5', from: 'idle', to: 'gone', conditions: [], duration: 0.2 };
    expect(run([dangling], {}).stateId).toBe('idle');
  });

  it('fails a condition on a parameter that no longer exists', () => {
    const orphan: AnimatorTransition = {
      id: 't6',
      from: 'idle',
      to: 'run',
      conditions: [{ parameterId: 'gone', op: '>', value: 0 }],
      duration: 0.2,
    };
    expect(run([orphan], {}).stateId).toBe('idle');
  });

  describe('exit time', () => {
    // 'walk' is 1s long, so exitTime 0.5 means it may leave after 0.5s in state.
    const exitHalf: AnimatorTransition = {
      id: 'te',
      from: 'run',
      to: 'idle',
      conditions: [],
      duration: 0.1,
      hasExitTime: true,
      exitTime: 0.5,
    };

    it('holds the state until the clip has played far enough', () => {
      const early = run([exitHalf], {}, { stateId: 'run', fade: 0, time: 0.2 }, 0.01);
      expect(early.stateId).toBe('run');
    });

    it('leaves once the exit point is reached', () => {
      const late = run([exitHalf], {}, { stateId: 'run', fade: 0, time: 0.6 }, 0.01);
      expect(late.stateId).toBe('idle');
    });

    it('scales with the state speed, since a 2x state reaches its exit point sooner', () => {
      const fast = [IDLE, state({ id: 'run', name: 'Run', animationId: 'walk', speed: 2 }), LAND];
      // 1s clip at 2x = 0.5s of runtime, so exitTime 0.5 lands at 0.25s.
      expect(run([exitHalf], {}, { stateId: 'run', fade: 0, time: 0.3 }, 0.01, fast).stateId).toBe('idle');
      expect(run([exitHalf], {}, { stateId: 'run', fade: 0, time: 0.1 }, 0.01, fast).stateId).toBe('run');
    });
  });

  it('recovers to the entry state when the previous state was deleted', () => {
    expect(run([], {}, { stateId: 'deleted', fade: 0, time: 3 }).stateId).toBe('idle');
  });

  // A layer with no states must contribute nothing rather than crash or claim a state.
  it('returns an empty state id for a machine with no states', () => {
    expect(
      stepStateMachine({
        states: [],
        transitionCandidatesByState: new Map(),
        dt: 1 / 60,
        params: {},
        paramsById,
        durationOf,
        compare,
      }),
    ).toEqual({ stateId: '', fade: 0, time: 0 });
  });
});

describe('resolveLayerWeight', () => {
  it('uses the static weight when no parameter is bound', () => {
    expect(resolveLayerWeight({ weight: 0.5 }, {})).toBe(0.5);
  });

  it('lets a bool parameter gate the layer outright', () => {
    expect(resolveLayerWeight({ weight: 1, weightParameterId: 'aim' }, { aim: true })).toBe(1);
    expect(resolveLayerWeight({ weight: 1, weightParameterId: 'aim' }, { aim: false })).toBe(0);
  });

  it('lets a float parameter fade the layer', () => {
    expect(resolveLayerWeight({ weight: 1, weightParameterId: 'w' }, { w: 0.35 })).toBeCloseTo(0.35);
  });

  it('clamps out-of-range values', () => {
    expect(resolveLayerWeight({ weight: 1, weightParameterId: 'w' }, { w: 4 })).toBe(1);
    expect(resolveLayerWeight({ weight: 1, weightParameterId: 'w' }, { w: -2 })).toBe(0);
    expect(resolveLayerWeight({ weight: 9 }, {})).toBe(1);
  });

  // A NaN weight would reach setEffectiveWeight and destroy the pose, not merely look wrong.
  it('falls back to off for a missing or non-finite value', () => {
    expect(resolveLayerWeight({ weight: 1, weightParameterId: 'gone' }, {})).toBe(0);
    expect(resolveLayerWeight({ weight: NaN }, {})).toBe(0);
    expect(resolveLayerWeight({ weight: 1, weightParameterId: 'w' }, { w: NaN })).toBe(0);
  });
});

describe('layer transition indexing', () => {
  it('indexes each layer separately, including its any-state transitions', () => {
    const controller: AnimatorController = {
      id: 'c',
      name: 'C',
      parameters: [],
      states: [state({ id: 'base', name: 'Base' })],
      transitions: [],
      layers: [
        {
          id: 'upper',
          name: 'Upper Body',
          maskRootBones: ['Spine'],
          weight: 1,
          states: [state({ id: 'idle', name: 'Idle' }), state({ id: 'aim', name: 'Aim' })],
          defaultStateId: 'idle',
          transitions: [
            { id: 'l1', from: 'idle', to: 'aim', conditions: [], duration: 0.2 },
            { id: 'l2', from: 'any', to: 'idle', conditions: [], duration: 0.1 },
          ],
        },
      ],
      createdAt: 0,
    };
    const runtime = buildAnimatorControllerRuntime(controller);
    const perState = runtime.layerTransitionCandidates.get('upper');
    expect(perState?.get('idle')?.map((t) => t.id)).toEqual(['l1', 'l2']);
    expect(perState?.get('aim')?.map((t) => t.id)).toEqual(['l2']);
    // The base machine's index must not have picked up the layer's transitions.
    expect(runtime.transitionCandidatesByState.get('base')).toEqual([]);
  });

  it('has no layer index for a controller without layers', () => {
    const controller: AnimatorController = {
      id: 'c',
      name: 'C',
      parameters: [],
      states: [state({ id: 'base', name: 'Base' })],
      transitions: [],
      createdAt: 0,
    };
    expect(buildAnimatorControllerRuntime(controller).layerTransitionCandidates.size).toBe(0);
  });
});
