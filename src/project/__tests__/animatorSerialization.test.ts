import { describe, expect, it } from 'vitest';
import { blankProject, joinProject, migrateLoaded, splitProject } from '../serialize';
import type { AnimatorController, NodeForgeProject } from '../../types';

/**
 * Blend spaces, animator parameters and state machines are authored in the editor but live inside the
 * project manifest, so the only thing standing between "configured a blend space" and "lost the blend
 * space" is this round trip. These tests lock it down: save -> serialize -> reload must return the
 * controller byte-for-byte, including the optional blend-space fields that older projects lack.
 */

const CONTROLLER: AnimatorController = {
  id: 'ctrl-loco',
  name: 'Locomotion',
  skeletonId: 'skel-1',
  parameters: [
    { id: 'p-speed', name: 'Speed', type: 'float', defaultValue: 0, source: 'speed' },
    { id: 'p-mx', name: 'MoveX', type: 'float', defaultValue: 0, source: 'moveX' },
    { id: 'p-grounded', name: 'Grounded', type: 'bool', defaultValue: true, source: 'grounded' },
    { id: 'p-jump', name: 'Jump', type: 'trigger', defaultValue: false, source: 'manual' },
  ],
  states: [
    { id: 's-idle', name: 'Idle', animationId: 'a-idle', speed: 1, loop: true, position: { x: 10, y: 20 } },
    {
      id: 's-loco-1d',
      name: 'Locomotion1D',
      speed: 1,
      loop: true,
      blendParameterId: 'p-speed',
      blendSamples: [
        { animationId: 'a-idle', value: 0 },
        { animationId: 'a-walk', value: 2 },
        { animationId: 'a-jog', value: 5 },
        { animationId: 'a-run', value: 8 },
      ],
    },
    {
      id: 's-loco-2d',
      name: 'Strafe2D',
      speed: 1.2,
      loop: true,
      blendParameterId: 'p-mx',
      blendParameterIdY: 'p-speed',
      syncPhase: true,
      blendSamples: [
        { animationId: 'a-idle', value: 0, y: 0 },
        { animationId: 'a-walkF', value: 0, y: 1 },
        { animationId: 'a-walkR', value: 1, y: 0 },
        { animationId: 'a-runF', value: 0, y: 2 },
      ],
    },
  ],
  defaultStateId: 's-idle',
  transitions: [
    {
      id: 't-idle-loco',
      from: 's-idle',
      to: 's-loco-1d',
      conditions: [{ parameterId: 'p-speed', op: '>', value: 0.1 }],
      duration: 0.2,
    },
    {
      id: 't-any-jump',
      from: 'any',
      to: 's-loco-2d',
      conditions: [{ parameterId: 'p-grounded', op: '==', value: false }],
      duration: 0.15,
      hasExitTime: true,
      exitTime: 0.8,
    },
  ],
  layers: [
    {
      id: 'l-upper',
      name: 'Upper Body',
      maskRootBones: ['Spine', 'LeftShoulder'],
      weight: 0.8,
      weightParameterId: 'p-grounded',
      states: [
        { id: 'ls-rest', name: 'Rest', animationId: 'a-idle', speed: 1, loop: true, position: { x: 5, y: 6 } },
        {
          id: 'ls-aim',
          name: 'Aim',
          speed: 1,
          loop: true,
          blendParameterId: 'p-mx',
          blendSamples: [
            { animationId: 'a-aimL', value: -1 },
            { animationId: 'a-aimR', value: 1 },
          ],
        },
      ],
      defaultStateId: 'ls-rest',
      transitions: [
        {
          id: 'lt-1',
          from: 'ls-rest',
          to: 'ls-aim',
          conditions: [{ parameterId: 'p-grounded', op: '==', value: true }],
          duration: 0.25,
        },
      ],
    },
  ],
  createdAt: 1_700_000_000_000,
};

const withController = (): NodeForgeProject => {
  const project = blankProject('Animator Round Trip');
  return { ...project, animatorControllers: [CONTROLLER] };
};

/** Save to disk and load back, through JSON so we also catch anything non-serializable. */
const roundTrip = (project: NodeForgeProject): NodeForgeProject => {
  const { manifest, sceneFiles } = splitProject(project);
  const onDisk = JSON.parse(JSON.stringify({ manifest, scenes: sceneFiles.map((file) => file.scene) }));
  return joinProject(onDisk.manifest, onDisk.scenes);
};

describe('animator controller serialization', () => {
  it('survives save -> reload unchanged', () => {
    const reloaded = roundTrip(withController());
    expect(reloaded.animatorControllers).toEqual([CONTROLLER]);
  });

  it('keeps 1D blend-space samples and their driving parameter', () => {
    const state = roundTrip(withController()).animatorControllers[0].states.find((s) => s.id === 's-loco-1d');
    expect(state?.blendParameterId).toBe('p-speed');
    expect(state?.blendParameterIdY).toBeUndefined();
    expect(state?.blendSamples).toEqual([
      { animationId: 'a-idle', value: 0 },
      { animationId: 'a-walk', value: 2 },
      { animationId: 'a-jog', value: 5 },
      { animationId: 'a-run', value: 8 },
    ]);
  });

  it('keeps the second axis and per-sample y of a 2D blend space', () => {
    const state = roundTrip(withController()).animatorControllers[0].states.find((s) => s.id === 's-loco-2d');
    expect(state?.blendParameterId).toBe('p-mx');
    expect(state?.blendParameterIdY).toBe('p-speed');
    expect(state?.blendSamples?.map((sample) => sample.y)).toEqual([0, 1, 0, 2]);
  });

  describe('animation layers', () => {
    it('survives save -> reload with its mask, weight and weight parameter', () => {
      const layer = roundTrip(withController()).animatorControllers[0].layers![0];
      expect(layer.name).toBe('Upper Body');
      expect(layer.maskRootBones).toEqual(['Spine', 'LeftShoulder']);
      expect(layer.weight).toBe(0.8);
      expect(layer.weightParameterId).toBe('p-grounded');
    });

    it('keeps the layer own states, entry state and node positions', () => {
      const layer = roundTrip(withController()).animatorControllers[0].layers![0];
      expect(layer.states.map((s) => s.id)).toEqual(['ls-rest', 'ls-aim']);
      expect(layer.defaultStateId).toBe('ls-rest');
      expect(layer.states[0].position).toEqual({ x: 5, y: 6 });
    });

    it('keeps a blend space authored on a layer state', () => {
      const aim = roundTrip(withController()).animatorControllers[0].layers![0].states[1];
      expect(aim.blendParameterId).toBe('p-mx');
      expect(aim.blendSamples).toEqual([
        { animationId: 'a-aimL', value: -1 },
        { animationId: 'a-aimR', value: 1 },
      ]);
    });

    it('keeps the layer own transitions and their conditions', () => {
      const layer = roundTrip(withController()).animatorControllers[0].layers![0];
      expect(layer.transitions[0]).toMatchObject({ from: 'ls-rest', to: 'ls-aim', duration: 0.25 });
      expect(layer.transitions[0].conditions).toEqual([{ parameterId: 'p-grounded', op: '==', value: true }]);
    });

    // Layers are optional, so a project authored before they existed must not gain an empty array.
    it('stays absent for a controller that has none', () => {
      const legacy = blankProject('Legacy');
      const plain: AnimatorController = {
        id: 'ctrl-old',
        name: 'Old',
        parameters: [],
        states: [{ id: 's', name: 'Idle', animationId: 'a-idle', speed: 1, loop: true }],
        transitions: [],
        createdAt: 0,
      };
      expect(roundTrip({ ...legacy, animatorControllers: [plain] }).animatorControllers[0].layers).toBeUndefined();
    });
  });

  it('keeps the phase-sync flag', () => {
    const state = roundTrip(withController()).animatorControllers[0].states.find((s) => s.id === 's-loco-2d');
    expect(state?.syncPhase).toBe(true);
    // Off is represented by the field being absent, so it must not come back as an explicit false.
    const plain = roundTrip(withController()).animatorControllers[0].states.find((s) => s.id === 's-loco-1d');
    expect(plain?.syncPhase).toBeUndefined();
  });

  it('keeps every parameter type, including trigger and bool defaults', () => {
    const parameters = roundTrip(withController()).animatorControllers[0].parameters;
    expect(parameters.map((p) => [p.name, p.type, p.defaultValue])).toEqual([
      ['Speed', 'float', 0],
      ['MoveX', 'float', 0],
      ['Grounded', 'bool', true],
      ['Jump', 'trigger', false],
    ]);
  });

  it('keeps transition conditions, durations and exit-time settings', () => {
    const transitions = roundTrip(withController()).animatorControllers[0].transitions;
    expect(transitions[0].conditions).toEqual([{ parameterId: 'p-speed', op: '>', value: 0.1 }]);
    expect(transitions[1]).toMatchObject({ from: 'any', hasExitTime: true, exitTime: 0.8, duration: 0.15 });
  });

  it('keeps graph-editor node positions so the state machine layout is not lost', () => {
    const state = roundTrip(withController()).animatorControllers[0].states.find((s) => s.id === 's-idle');
    expect(state?.position).toEqual({ x: 10, y: 20 });
  });

  // A project saved before blend spaces existed simply has no blend fields. Loading it must not
  // invent them, and must not throw.
  it('loads a controller with no blend-space fields as a plain clip state', () => {
    const legacy = blankProject('Legacy');
    const plain: AnimatorController = {
      id: 'ctrl-old',
      name: 'Old',
      parameters: [],
      states: [{ id: 's', name: 'Idle', animationId: 'a-idle', speed: 1, loop: true }],
      transitions: [],
      createdAt: 0,
    };
    const reloaded = roundTrip({ ...legacy, animatorControllers: [plain] });
    const state = reloaded.animatorControllers[0].states[0];
    expect(state.blendSamples).toBeUndefined();
    expect(state.blendParameterId).toBeUndefined();
    expect(state.animationId).toBe('a-idle');
  });

  it('defaults to no controllers when the field is absent entirely', () => {
    const { manifest, sceneFiles } = splitProject(blankProject('No Animators'));
    const stripped = JSON.parse(JSON.stringify(manifest));
    delete stripped.animatorControllers;
    expect(joinProject(stripped, sceneFiles.map((file) => file.scene)).animatorControllers).toEqual([]);
  });

  it('migrates a legacy single-file project without dropping blend spaces', () => {
    const project = withController();
    // Legacy saves were one flat JSON blob with the scenes inline rather than a manifest + files.
    const flat = JSON.parse(JSON.stringify({ ...project, savedAt: new Date().toISOString() }));
    const migrated = migrateLoaded(flat);
    const state = migrated.animatorControllers[0].states.find((s) => s.id === 's-loco-2d');
    expect(state?.blendSamples).toHaveLength(4);
    expect(state?.blendParameterIdY).toBe('p-speed');
  });
});
