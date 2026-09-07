import { afterEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../editorStore';
import type { AnimatorLayer } from '../../types';

/**
 * Animation layers driven through the REAL store and the real tickRuntime, not a stub. Unit tests
 * cover the transition rules and weight resolution; this asserts the wiring actually runs during
 * Play: that a layer's own state machine advances, transitions on shared parameters, and reports
 * itself in runtimeAnimators so the renderer can mask and pose it.
 */

const tick = (frames = 1, dt = 1 / 60) => {
  for (let i = 0; i < frames; i += 1) useEditorStore.getState().tickRuntime(dt);
};

/** An object with an animator bound to a controller that has one upper-body layer. */
const setup = (layer: Partial<AnimatorLayer> = {}) => {
  const store = useEditorStore.getState();
  const objectId = store.createObjectWithProps('cube');
  const controllerId = store.createAnimatorController()!;

  const baseId = store.addAnimatorState(controllerId, { name: 'Locomotion' })!;
  store.updateAnimatorController(controllerId, { defaultStateId: baseId });
  store.addAnimatorParameter(controllerId, { name: 'IsAiming', type: 'bool', defaultValue: false, source: 'manual' });

  const aimingParam = useEditorStore
    .getState()
    .animatorControllers.find((c) => c.id === controllerId)!
    .parameters.find((p) => p.name === 'IsAiming')!;

  // Authored through the real layer actions, including the layerId-aware state/transition mutators.
  const layerId = store.addAnimatorLayer(controllerId, { name: 'Upper Body', maskRootBones: ['Spine'] })!;
  const restId = store.addAnimatorState(controllerId, { name: 'Rest' }, layerId)!;
  const aimId = store.addAnimatorState(controllerId, { name: 'Aim' }, layerId)!;
  store.addAnimatorTransition(
    controllerId,
    { from: restId, to: aimId, conditions: [{ parameterId: aimingParam.id, op: '==', value: true }], duration: 0.2 },
    layerId,
  );
  store.addAnimatorTransition(
    controllerId,
    { from: aimId, to: restId, conditions: [{ parameterId: aimingParam.id, op: '==', value: false }], duration: 0.2 },
    layerId,
  );
  if (Object.keys(layer).length) store.updateAnimatorLayer(controllerId, layerId, layer);

  store.toggleAnimator(objectId);
  store.setObjectAnimatorController(objectId, controllerId);

  return { objectId, controllerId, baseId, layerId, restId, aimId, aimingParamId: aimingParam.id };
};

const liveLayers = (objectId: string) => useEditorStore.getState().runtimeAnimators[objectId]?.layers;

describe('animation layers during Play', () => {
  afterEach(() => {
    useEditorStore.getState().setPlaying(false);
  });

  it('starts the layer in its own entry state, independent of the base state', () => {
    const { objectId, baseId, layerId, restId } = setup();
    useEditorStore.getState().setPlaying(true);
    tick();

    const live = useEditorStore.getState().runtimeAnimators[objectId];
    expect(live?.stateId).toBe(baseId);
    expect(live?.layers?.[layerId]?.stateId).toBe(restId);
  });

  it('reports the layer weight alongside its state', () => {
    const { objectId, layerId } = setup({ weight: 0.4 });
    useEditorStore.getState().setPlaying(true);
    tick();
    expect(liveLayers(objectId)?.[layerId]?.weight).toBeCloseTo(0.4);
  });

  it('transitions the layer on a parameter shared with the base controller', () => {
    const { objectId, layerId, restId, aimId, aimingParamId } = setup();
    useEditorStore.getState().setPlaying(true);
    tick();
    expect(liveLayers(objectId)?.[layerId]?.stateId).toBe(restId);

    useEditorStore.getState().setRuntimeAnimatorParam(objectId, aimingParamId, true);
    tick();
    expect(liveLayers(objectId)?.[layerId]?.stateId).toBe(aimId);
    // fade carries the crossfade of the transition that JUST fired...
    expect(liveLayers(objectId)?.[layerId]?.fade).toBeCloseTo(0.2);
    // ...and clears once the layer is simply sitting in the state, so the renderer does not re-fade.
    tick();
    expect(liveLayers(objectId)?.[layerId]?.fade).toBe(0);

    useEditorStore.getState().setRuntimeAnimatorParam(objectId, aimingParamId, false);
    tick();
    expect(liveLayers(objectId)?.[layerId]?.stateId).toBe(restId);
  });

  it('accumulates time in the layer state and resets it on entry', () => {
    const { objectId, layerId, aimingParamId } = setup();
    useEditorStore.getState().setPlaying(true);
    tick(10);
    const held = liveLayers(objectId)?.[layerId]?.time ?? 0;
    expect(held).toBeGreaterThan(0);

    useEditorStore.getState().setRuntimeAnimatorParam(objectId, aimingParamId, true);
    tick(2);
    expect(liveLayers(objectId)?.[layerId]?.time).toBeLessThan(held);
  });

  it('drives the layer weight from a parameter when one is bound', () => {
    const { objectId, controllerId, layerId, aimingParamId } = setup();
    useEditorStore.getState().updateAnimatorLayer(controllerId, layerId, { weightParameterId: aimingParamId });
    useEditorStore.getState().setPlaying(true);
    tick();
    // IsAiming defaults false, so the layer starts fully faded out.
    expect(liveLayers(objectId)?.[layerId]?.weight).toBe(0);

    useEditorStore.getState().setRuntimeAnimatorParam(objectId, aimingParamId, true);
    tick(2);
    expect(liveLayers(objectId)?.[layerId]?.weight).toBe(1);
  });

  it('carries no layer state once the layer is removed', () => {
    const { objectId, controllerId, layerId } = setup();
    useEditorStore.getState().removeAnimatorLayer(controllerId, layerId);
    useEditorStore.getState().setPlaying(true);
    tick();
    expect(liveLayers(objectId)).toBeUndefined();
  });

  // A layer with no states must be skipped rather than reported with an empty state id, which the
  // renderer would then try to look up.
  it('skips a layer that has no states', () => {
    const { objectId, controllerId } = setup();
    const emptyLayerId = useEditorStore.getState().addAnimatorLayer(controllerId, { name: 'Empty' })!;
    useEditorStore.getState().setPlaying(true);
    tick();
    expect(liveLayers(objectId)?.[emptyLayerId]).toBeUndefined();
  });

  it('scopes state edits to the layer, leaving the base machine alone', () => {
    const { controllerId, baseId, layerId, restId } = setup();
    useEditorStore.getState().updateAnimatorState(controllerId, restId, { speed: 3 }, layerId);
    const controller = useEditorStore.getState().animatorControllers.find((c) => c.id === controllerId)!;
    expect(controller.layers![0].states.find((s) => s.id === restId)?.speed).toBe(3);
    // The base state of the same controller must be untouched.
    expect(controller.states.find((s) => s.id === baseId)?.speed).toBe(1);
  });

  it('ticks many frames with a layered controller without throwing', () => {
    const { objectId, aimingParamId } = setup();
    useEditorStore.getState().setPlaying(true);
    expect(() => {
      for (let frame = 0; frame < 120; frame += 1) {
        // Flip the gate constantly so the layer transitions repeatedly.
        if (frame % 10 === 0) {
          useEditorStore.getState().setRuntimeAnimatorParam(objectId, aimingParamId, frame % 20 === 0);
        }
        useEditorStore.getState().tickRuntime(1 / 60);
      }
    }).not.toThrow();
    expect(useEditorStore.getState().isPlaying).toBe(true);
  });
});
