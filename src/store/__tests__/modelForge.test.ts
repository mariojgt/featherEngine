import { describe, it, expect, beforeEach } from 'vitest';
import { selectActiveObjects, useEditorStore } from '../editorStore';
import {
  BOX_EDGE_CORNERS,
  BOX_FACE_CORNERS,
  MODEL_FACE_GROUPS,
  MODEL_STARTERS,
  QUICK_MODEL_STARTER_IDS,
  boxComponentCorners,
  boxComponentCount,
} from '../../model/modelSpec';
import { clearHistory, initHistory, redo, undo } from '../history';

/**
 * The store actions behind the Model Forge panel and the AI's model tools. What matters: starters
 * land as normalized library assets, placed props stay LINKED to their asset (that link is what
 * makes "edit the asset, every placed copy restyles" work), and deleting an asset stamps an inline
 * copy into placed props so they never lose geometry.
 */
describe('Model Forge store actions', () => {
  beforeEach(() => {
    // Snapshot-free isolation: drop everything a previous test placed or created.
    const state = useEditorStore.getState();
    for (const object of selectActiveObjects(state).filter((entry) => entry.model)) state.deleteObject(object.id);
    for (const spec of useEditorStore.getState().modelSpecs.filter((entry) => entry.id !== 'model-starter-crate')) {
      useEditorStore.getState().deleteModelSpec(spec.id);
    }
    initHistory();
    clearHistory();
  });

  it('ships a broader, valid starter gallery and a complete box control cage', () => {
    const ids = MODEL_STARTERS.map((starter) => starter.id);
    expect(ids).toEqual(expect.arrayContaining(['table', 'chair', 'stairs', 'lamp', 'rock', 'robot']));
    expect(new Set(ids).size).toBe(ids.length);
    expect(MODEL_STARTERS.every((starter) => starter.build().length > 0)).toBe(true);
    expect(QUICK_MODEL_STARTER_IDS.every((id) => ids.includes(id))).toBe(true);

    expect(boxComponentCount('vertex')).toBe(8);
    expect(boxComponentCount('edge')).toBe(12);
    expect(boxComponentCount('face')).toBe(6);
    expect(BOX_EDGE_CORNERS).toHaveLength(12);
    expect(BOX_FACE_CORNERS).toHaveLength(6);
    expect(boxComponentCorners('face', 0)).toEqual([1, 3, 5, 7]);
    expect(new Set(BOX_EDGE_CORNERS.flat())).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
  });

  it('createModelSpec from a starter lands a normalized library asset', () => {
    const before = useEditorStore.getState().modelSpecs.length;
    const specId = useEditorStore.getState().createModelSpec('fence', 'Garden Fence');
    expect(specId).toBeTruthy();
    const spec = useEditorStore.getState().modelSpecs.find((entry) => entry.id === specId)!;
    expect(spec.name).toBe('Garden Fence');
    // Compare against the starter data, not a literal, so retuning the kit doesn't break the test.
    expect(spec.parts).toHaveLength(MODEL_STARTERS.find((starter) => starter.id === 'fence')!.build().length);
    expect(spec.palette.length).toBeGreaterThan(0);
    expect(useEditorStore.getState().modelSpecs).toHaveLength(before + 1);
    expect(useEditorStore.getState().activeModelSpecId).toBe(specId);
    // Unknown starters refuse loudly-but-safely instead of adding a mystery asset.
    expect(useEditorStore.getState().createModelSpec('not-a-starter')).toBeNull();
  });

  it('parts round-trip: add, update, duplicate, remove', () => {
    const specId = useEditorStore.getState().createModelSpec('blank')!;
    const partId = useEditorStore.getState().addModelPart(specId, 'cylinder', { name: 'Post', scale: [0.2, 2, 0.2] })!;
    expect(partId).toBeTruthy();

    const spec = () => useEditorStore.getState().modelSpecs.find((entry) => entry.id === specId)!;
    expect(spec().parts.map((part) => part.shape)).toEqual(['box', 'cylinder']);

    expect(useEditorStore.getState().updateModelPart(specId, partId, { position: [0, 1, 0], colorSlot: 3 })).toBe(true);
    const updated = spec().parts.find((part) => part.id === partId)!;
    expect(updated.position).toEqual([0, 1, 0]);
    expect(updated.colorSlot).toBe(3);
    expect(updated.scale).toEqual([0.2, 2, 0.2]);

    const copyId = useEditorStore.getState().duplicateModelPart(specId, partId)!;
    expect(copyId).toBeTruthy();
    expect(spec().parts).toHaveLength(3);

    expect(useEditorStore.getState().removeModelPart(specId, copyId)).toBe(true);
    expect(spec().parts).toHaveLength(2);
    expect(useEditorStore.getState().updateModelPart(specId, 'missing-part', { colorSlot: 1 })).toBe(false);
  });

  it('paintModelPart paints face groups; whole-part paint clears the overrides', () => {
    const specId = useEditorStore.getState().createModelSpec('blank')!;
    const partId = useEditorStore.getState().modelSpecs.find((entry) => entry.id === specId)!.parts[0].id;
    const part = () => useEditorStore.getState().modelSpecs.find((entry) => entry.id === specId)!.parts[0];

    // Paint the top face (box group 2 per MODEL_FACE_GROUPS).
    expect(MODEL_FACE_GROUPS.box[2]).toBe('Top');
    expect(useEditorStore.getState().paintModelPart(specId, partId, 5, 2)).toBe(true);
    expect(part().faceColors).toEqual({ 2: 5 });

    // Whole-part paint resets the per-face map.
    expect(useEditorStore.getState().paintModelPart(specId, partId, 7)).toBe(true);
    expect(part().colorSlot).toBe(7);
    expect(part().faceColors).toBeUndefined();

    // Slots clamp into the palette instead of pointing at nothing.
    const paletteSize = useEditorStore.getState().modelSpecs.find((entry) => entry.id === specId)!.palette.length;
    expect(useEditorStore.getState().paintModelPart(specId, partId, 999)).toBe(true);
    expect(part().colorSlot).toBe(paletteSize - 1);
  });

  it('placed props link to the asset, and deleting the asset stamps an inline keep-alive copy', () => {
    const specId = useEditorStore.getState().createModelSpec('barrel')!;
    const objectId = useEditorStore.getState().createModelFromSpec(specId, { position: [4, 0, -3] })!;
    const object = () => selectActiveObjects(useEditorStore.getState()).find((entry) => entry.id === objectId)!;

    expect(object().kind).toBe('empty');
    expect(object().model?.enabled).toBe(true);
    expect(object().model?.specId).toBe(specId);
    expect(object().model?.spec).toBeUndefined();
    expect(object().transform.position[0]).toBe(4);
    expect(useEditorStore.getState().createModelFromSpec('missing-spec')).toBeNull();

    const partCount = useEditorStore.getState().modelSpecs.find((entry) => entry.id === specId)!.parts.length;
    useEditorStore.getState().deleteModelSpec(specId);
    expect(useEditorStore.getState().modelSpecs.some((entry) => entry.id === specId)).toBe(false);
    // The placed prop keeps its geometry via the stamped inline spec.
    expect(object().model?.specId).toBeUndefined();
    expect(object().model?.spec?.parts).toHaveLength(partCount);
  });

  it('style: starters default to the smooth Spline finish; updates normalize and clamp', () => {
    const specId = useEditorStore.getState().createModelSpec('crate')!;
    const spec = () => useEditorStore.getState().modelSpecs.find((entry) => entry.id === specId)!;
    expect(spec().style?.finish).toBe('smooth');
    expect(spec().style?.bevel).toBeGreaterThan(0);

    // Switching to flat keeps the spec valid; garbage values clamp instead of leaking through.
    useEditorStore.getState().updateModelSpec(specId, { style: { finish: 'flat', bevel: 9, roughness: -3 } });
    expect(spec().style).toEqual({ finish: 'flat', bevel: 0.25, roughness: 0.05 });

    // Unknown finishes fall back to smooth rather than breaking rendering.
    useEditorStore.getState().updateModelSpec(specId, { style: { finish: 'chrome' } as never });
    expect(spec().style?.finish).toBe('smooth');
  });

  it('vertex corners: set, merge-replace, normalize-clamp, and clear', () => {
    const specId = useEditorStore.getState().createModelSpec('blank')!;
    const partId = useEditorStore.getState().modelSpecs.find((entry) => entry.id === specId)!.parts[0].id;
    const part = () => useEditorStore.getState().modelSpecs.find((entry) => entry.id === specId)!.parts[0];

    expect(useEditorStore.getState().setModelPartCorners(specId, partId, { 7: [0.2, 0.3, 0.1] })).toBe(true);
    expect(part().corners).toEqual({ 7: [0.2, 0.3, 0.1] });

    // Out-of-range keys and non-finite offsets are dropped; components clamp to ±2.
    useEditorStore.getState().setModelPartCorners(specId, partId, {
      2: [9, 0.1, 0],
      11: [1, 1, 1],
      3: [Number.NaN, 0, 0],
    } as never);
    expect(part().corners).toEqual({ 2: [2, 0.1, 0] });

    // Reshaping away from a box sheds the deformation; clearing works via null.
    useEditorStore.getState().updateModelPart(specId, partId, { shape: 'cylinder' });
    expect(part().corners).toBeUndefined();
    useEditorStore.getState().updateModelPart(specId, partId, { shape: 'box' });
    useEditorStore.getState().setModelPartCorners(specId, partId, { 0: [-0.1, 0, 0] });
    expect(part().corners).toBeDefined();
    expect(useEditorStore.getState().setModelPartCorners(specId, partId, null)).toBe(true);
    expect(part().corners).toBeUndefined();
  });

  it('setModelPalette recolors the family and exportProject carries the library', () => {
    const specId = useEditorStore.getState().createModelSpec('tile')!;
    expect(useEditorStore.getState().setModelPalette(specId, ['#ff0000', '#00ff00'])).toBe(true);
    const spec = useEditorStore.getState().modelSpecs.find((entry) => entry.id === specId)!;
    expect(spec.palette).toEqual(['#ff0000', '#00ff00']);
    // Slots beyond the shrunk palette clamp back into range.
    expect(spec.parts.every((part) => part.colorSlot < 2)).toBe(true);

    const exported = useEditorStore.getState().exportProject();
    expect(exported.modelSpecs?.some((entry) => entry.id === specId)).toBe(true);
  });

  it('includes Model Forge asset edits in local undo and redo', () => {
    const specId = useEditorStore.getState().createModelSpec('chair')!;
    const partId = useEditorStore.getState().modelSpecs.find((entry) => entry.id === specId)!.parts[0].id;
    clearHistory();

    useEditorStore.getState().updateModelPart(specId, partId, { position: [3, 2, 1] });
    expect(useEditorStore.getState().undoDepth).toBe(1);
    expect(useEditorStore.getState().modelSpecs.find((entry) => entry.id === specId)!.parts[0].position).toEqual([3, 2, 1]);

    undo();
    expect(useEditorStore.getState().modelSpecs.find((entry) => entry.id === specId)!.parts[0].position).toEqual([0, 0.62, 0]);
    redo();
    expect(useEditorStore.getState().modelSpecs.find((entry) => entry.id === specId)!.parts[0].position).toEqual([3, 2, 1]);
  });
});
