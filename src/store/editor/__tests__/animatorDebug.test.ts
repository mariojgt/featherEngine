import { describe, expect, it } from 'vitest';
import { buildAnimatorDebugSnapshot } from '../animatorDebug';
import type { RuntimeAnimator } from '../defaults';
import type { AnimationAsset, AnimatorController } from '../../../types';

const anim = (id: string, name: string): AnimationAsset => ({
  id,
  name,
  sourceAssetId: 'glb',
  clipName: `${name}_clip`,
  skeletonId: 'skel',
  duration: 1,
  loop: true,
  createdAt: 0,
});

const ANIMATIONS = [anim('a-idle', 'Idle'), anim('a-walk', 'Walk'), anim('a-run', 'Run'), anim('a-jump', 'Jump')];

/** Idle state plus a 1D Locomotion blend space driven by a "Speed" float. */
const controller = (): AnimatorController => ({
  id: 'ctrl',
  name: 'Locomotion',
  parameters: [
    { id: 'p-speed', name: 'Speed', type: 'float', defaultValue: 0, source: 'speed' },
    { id: 'p-grounded', name: 'Grounded', type: 'bool', defaultValue: true, source: 'grounded' },
  ],
  states: [
    { id: 's-idle', name: 'Idle', animationId: 'a-idle', speed: 1, loop: true },
    {
      id: 's-loco',
      name: 'Locomotion',
      speed: 1,
      loop: true,
      blendParameterId: 'p-speed',
      blendSamples: [
        { animationId: 'a-idle', value: 0 },
        { animationId: 'a-walk', value: 2 },
        { animationId: 'a-run', value: 6 },
      ],
    },
  ],
  defaultStateId: 's-idle',
  transitions: [],
  createdAt: 0,
});

const runtime = (over: Partial<RuntimeAnimator> = {}): RuntimeAnimator => ({
  stateId: 's-loco',
  params: {},
  fade: 0.2,
  time: 0,
  ...over,
});

describe('buildAnimatorDebugSnapshot', () => {
  it('previews the entry state outside Play, and says the values are not live', () => {
    const snapshot = buildAnimatorDebugSnapshot(controller(), undefined, ANIMATIONS);
    expect(snapshot.stateName).toBe('Idle');
    expect(snapshot.live).toBe(false);
    expect(snapshot.clips).toEqual([{ animationId: 'a-idle', label: 'Idle', weight: 1 }]);
  });

  it('reports the live state during Play', () => {
    const snapshot = buildAnimatorDebugSnapshot(controller(), runtime({ time: 1.25 }), ANIMATIONS);
    expect(snapshot.stateName).toBe('Locomotion');
    expect(snapshot.live).toBe(true);
    expect(snapshot.timeInState).toBe(1.25);
  });

  it('lists parameters with live values, falling back to authored defaults', () => {
    const snapshot = buildAnimatorDebugSnapshot(controller(), runtime({ params: { 'p-speed': 4 } }), ANIMATIONS);
    const speed = snapshot.parameters.find((p) => p.name === 'Speed');
    const grounded = snapshot.parameters.find((p) => p.name === 'Grounded');
    expect(speed).toMatchObject({ value: 4, live: true });
    // Untouched by the runtime this frame, so it shows the default and is flagged as not live.
    expect(grounded).toMatchObject({ value: true, live: false });
  });

  // The whole point of the readout: the weights shown must be the weights posing the skeleton,
  // so it derives them with the same blend functions the renderer feeds the mixer.
  it('reports blend-space weights that match the blend maths', () => {
    const snapshot = buildAnimatorDebugSnapshot(controller(), runtime({ params: { 'p-speed': 4 } }), ANIMATIONS);
    expect(snapshot.blend).toMatchObject({ xName: 'Speed', x: 4 });
    // 4 sits halfway between walk (2) and run (6).
    expect(snapshot.clips).toEqual([
      { animationId: 'a-walk', label: 'Walk', weight: 0.5 },
      { animationId: 'a-run', label: 'Run', weight: 0.5 },
    ]);
  });

  it('omits zero-weight samples and sorts the pose heaviest-first', () => {
    const snapshot = buildAnimatorDebugSnapshot(controller(), runtime({ params: { 'p-speed': 5 } }), ANIMATIONS);
    expect(snapshot.clips.map((c) => c.label)).toEqual(['Run', 'Walk']);
    expect(snapshot.clips.every((c) => c.weight > 0)).toBe(true);
    expect(snapshot.clips.map((c) => c.label)).not.toContain('Idle');
  });

  it('reports both axes for a 2D blend space', () => {
    const ctrl = controller();
    ctrl.parameters.push({ id: 'p-mx', name: 'MoveX', type: 'float', defaultValue: 0, source: 'moveX' });
    const loco = ctrl.states.find((s) => s.id === 's-loco')!;
    loco.blendParameterId = 'p-mx';
    loco.blendParameterIdY = 'p-speed';
    loco.blendSamples = [
      { animationId: 'a-idle', value: 0, y: 0 },
      { animationId: 'a-walk', value: 0, y: 2 },
      { animationId: 'a-run', value: 1, y: 0 },
    ];
    const snapshot = buildAnimatorDebugSnapshot(ctrl, runtime({ params: { 'p-mx': 0, 'p-speed': 1 } }), ANIMATIONS);
    expect(snapshot.blend).toMatchObject({ xName: 'MoveX', x: 0, yName: 'Speed', y: 1 });
    expect(snapshot.clips.reduce((acc, c) => acc + c.weight, 0)).toBeCloseTo(1);
  });

  it('shows a montage overriding the state machine', () => {
    const snapshot = buildAnimatorDebugSnapshot(
      controller(),
      runtime({ montage: { animationId: 'a-jump', remaining: 0.4, speed: 1 } }),
      ANIMATIONS,
    );
    expect(snapshot.montage).toEqual({ label: 'Jump', remaining: 0.4 });
    expect(snapshot.clips).toEqual([{ animationId: 'a-jump', label: 'Jump', weight: 1 }]);
  });

  it('ignores a montage that has already finished', () => {
    const snapshot = buildAnimatorDebugSnapshot(
      controller(),
      runtime({ montage: { animationId: 'a-jump', remaining: 0, speed: 1 } }),
      ANIMATIONS,
    );
    expect(snapshot.montage).toBeUndefined();
  });

  it('coerces boolean parameters when they drive a blend axis', () => {
    const ctrl = controller();
    const loco = ctrl.states.find((s) => s.id === 's-loco')!;
    loco.blendParameterId = 'p-grounded';
    const snapshot = buildAnimatorDebugSnapshot(ctrl, runtime({ params: { 'p-grounded': true } }), ANIMATIONS);
    expect(snapshot.blend?.x).toBe(1);
    expect(snapshot.clips.reduce((acc, c) => acc + c.weight, 0)).toBeCloseTo(1);
  });

  it('falls back to the raw clip name when an animation asset has no name', () => {
    const nameless = [{ ...anim('a-idle', ''), name: '' }];
    const snapshot = buildAnimatorDebugSnapshot(controller(), undefined, nameless);
    expect(snapshot.clips[0].label).toBe('_clip');
  });

  it('survives a state with neither a clip nor blend samples', () => {
    const ctrl = controller();
    ctrl.states = [{ id: 's-empty', name: 'Empty', speed: 1, loop: true }];
    ctrl.defaultStateId = 's-empty';
    const snapshot = buildAnimatorDebugSnapshot(ctrl, undefined, ANIMATIONS);
    expect(snapshot.stateName).toBe('Empty');
    expect(snapshot.clips).toEqual([]);
  });

  it('survives a controller with no states at all', () => {
    const ctrl = controller();
    ctrl.states = [];
    ctrl.defaultStateId = undefined;
    const snapshot = buildAnimatorDebugSnapshot(ctrl, undefined, ANIMATIONS);
    expect(snapshot.stateName).toBe('—');
    expect(snapshot.clips).toEqual([]);
  });

  it('handles a runtime pointing at a state that no longer exists', () => {
    const snapshot = buildAnimatorDebugSnapshot(controller(), runtime({ stateId: 'deleted' }), ANIMATIONS);
    expect(snapshot.stateName).toBe('—');
    expect(snapshot.clips).toEqual([]);
  });
});
