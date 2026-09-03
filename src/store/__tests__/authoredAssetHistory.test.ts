import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../editorStore';
import { clearHistory, initHistory, redo, undo } from '../history';

/**
 * Animator controllers are authored interactively — adding states, wiring transitions, dragging blend
 * samples on the blend space graph — so Ctrl+Z has to reach them. They were absent from the history
 * snapshot, which meant more than "undo does nothing": the capture subscription never fired for an
 * animator edit either, so the next undo silently reverted an OLDER scene edit while leaving the
 * animator change in place. The user lost work they had not touched and kept the change they wanted
 * back.
 *
 * COALESCE_MS groups edits made within 180ms into one undo step, so these tests do their work in
 * separate awaited turns where a distinct step matters.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 220));

describe('animator controller undo/redo', () => {
  beforeEach(() => {
    useEditorStore.getState().setPlaying(false);
    initHistory();
    clearHistory();
  });

  afterEach(() => {
    clearHistory();
  });

  const controllers = () => useEditorStore.getState().animatorControllers;

  it('undoes creating a controller', async () => {
    const before = controllers().length;
    useEditorStore.getState().createAnimatorController();
    expect(controllers().length).toBe(before + 1);

    await settle();
    undo();
    expect(controllers().length).toBe(before);
  });

  it('redoes it again', async () => {
    const before = controllers().length;
    useEditorStore.getState().createAnimatorController();
    await settle();

    undo();
    expect(controllers().length).toBe(before);
    redo();
    expect(controllers().length).toBe(before + 1);
  });

  it('undoes a rename', async () => {
    const id = useEditorStore.getState().createAnimatorController();
    await settle();
    const original = controllers().find((c) => c.id === id)?.name;

    useEditorStore.getState().updateAnimatorController(id!, { name: 'Renamed Locomotion' });
    expect(controllers().find((c) => c.id === id)?.name).toBe('Renamed Locomotion');

    await settle();
    undo();
    expect(controllers().find((c) => c.id === id)?.name).toBe(original);
  });

  // The blend space graph moves samples by drag, which is the most obvious thing a user expects to
  // be able to take back.
  it('undoes a blend sample move', async () => {
    const controllerId = useEditorStore.getState().createAnimatorController()!;
    const stateId = useEditorStore.getState().addAnimatorState(controllerId, { name: 'Locomotion' })!;
    await settle();

    useEditorStore.getState().updateAnimatorState(controllerId, stateId, {
      blendParameterId: 'p',
      blendSamples: [{ animationId: 'a', value: 0 }],
    });
    await settle();

    useEditorStore.getState().updateAnimatorState(controllerId, stateId, {
      blendSamples: [{ animationId: 'a', value: 5 }],
    });
    const moved = controllers().find((c) => c.id === controllerId);
    expect(moved?.states.find((s) => s.id === stateId)?.blendSamples?.[0].value).toBe(5);

    await settle();
    undo();
    const reverted = controllers().find((c) => c.id === controllerId);
    expect(reverted?.states.find((s) => s.id === stateId)?.blendSamples?.[0].value).toBe(0);
  });

  // The regression that made the old behaviour actively harmful rather than merely missing.
  it('does not revert an unrelated earlier scene edit when undoing an animator edit', async () => {
    const objectId = useEditorStore.getState().createObjectWithProps('cube');
    await settle();

    useEditorStore.getState().renameObject(objectId, 'Keep Me');
    await settle();

    const controllerId = useEditorStore.getState().createAnimatorController()!;
    await settle();

    undo();

    // The animator edit is the one that went away...
    expect(controllers().some((c) => c.id === controllerId)).toBe(false);
    // ...and the scene edit before it is untouched.
    const objects = useEditorStore.getState().scenes.flatMap((scene) => scene.objects);
    expect(objects.find((object) => object.id === objectId)?.name).toBe('Keep Me');
  });
});

/**
 * The same gap applied to every other project asset with its own editor panel. Each is authored
 * interactively and referenced by scene objects, so undo has to move them together with `scenes`.
 */
describe('authored project assets undo/redo', () => {
  beforeEach(() => {
    useEditorStore.getState().setPlaying(false);
    initHistory();
    clearHistory();
  });

  afterEach(() => {
    clearHistory();
  });

  it('undoes creating a material', async () => {
    const before = useEditorStore.getState().materials.length;
    useEditorStore.getState().createMaterial('Brass');
    expect(useEditorStore.getState().materials.length).toBe(before + 1);

    await settle();
    undo();
    expect(useEditorStore.getState().materials.length).toBe(before);
    redo();
    expect(useEditorStore.getState().materials.length).toBe(before + 1);
  });

  it('undoes a material edit', async () => {
    const id = useEditorStore.getState().createMaterial('Brass');
    await settle();
    const original = useEditorStore.getState().materials.find((m) => m.id === id)?.name;

    useEditorStore.getState().updateMaterial(id, { name: 'Polished Brass' });
    expect(useEditorStore.getState().materials.find((m) => m.id === id)?.name).toBe('Polished Brass');

    await settle();
    undo();
    expect(useEditorStore.getState().materials.find((m) => m.id === id)?.name).toBe(original);
  });

  it('undoes creating a particle system', async () => {
    const before = useEditorStore.getState().particleSystems.length;
    useEditorStore.getState().createParticleSystem('Sparks');
    await settle();
    undo();
    expect(useEditorStore.getState().particleSystems.length).toBe(before);
  });

  it('undoes creating a tree spec', async () => {
    const before = useEditorStore.getState().treeSpecs.length;
    useEditorStore.getState().createTreeSpec('broadleaf', 'Test Oak');
    expect(useEditorStore.getState().treeSpecs.length).toBe(before + 1);
    await settle();
    undo();
    expect(useEditorStore.getState().treeSpecs.length).toBe(before);
  });

  it('undoes creating a UI document', async () => {
    const before = useEditorStore.getState().uiDocuments.length;
    useEditorStore.getState().createUIDocument('HUD');
    await settle();
    undo();
    expect(useEditorStore.getState().uiDocuments.length).toBe(before);
  });

  it('leaves an earlier scene edit alone when undoing a material edit', async () => {
    const objectId = useEditorStore.getState().createObjectWithProps('cube');
    await settle();
    useEditorStore.getState().renameObject(objectId, 'Untouched');
    await settle();

    const materialId = useEditorStore.getState().createMaterial('Brass');
    await settle();

    undo();
    expect(useEditorStore.getState().materials.some((m) => m.id === materialId)).toBe(false);
    const objects = useEditorStore.getState().scenes.flatMap((scene) => scene.objects);
    expect(objects.find((object) => object.id === objectId)?.name).toBe('Untouched');
  });
});
