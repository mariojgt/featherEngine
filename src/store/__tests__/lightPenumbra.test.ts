import { describe, expect, it } from 'vitest';
import { useEditorStore, selectActiveObjects } from '../editorStore';
import { defaultLight } from '../editor/defaults';

/**
 * Spot penumbra used to be a hardcoded 0.45 in the renderer with no way to change it. Exposing it as
 * an optional component field has two requirements: existing scenes must keep looking the same, and
 * a value the user sets must not be wiped by an unrelated light edit.
 */
describe('spot light penumbra', () => {
  // Migration safety: the default has to be the exact value the renderer previously hardcoded,
  // otherwise every existing spot light changes its cone softness on load.
  it('defaults to the value the renderer previously hardcoded', () => {
    expect(defaultLight().penumbra).toBe(0.45);
  });

  const createLight = (): string => {
    const id = useEditorStore.getState().createObjectWithProps('light');
    return id;
  };

  const lightOf = (id: string) => selectActiveObjects(useEditorStore.getState()).find((o) => o.id === id)?.light;

  it('stores a penumbra set through setObjectLight', () => {
    const id = createLight();
    useEditorStore.getState().setObjectLight(id, { type: 'spot', penumbra: 0.1 });
    expect(lightOf(id)?.penumbra).toBe(0.1);
  });

  it('accepts the hard-edged and fully-soft extremes', () => {
    const id = createLight();
    useEditorStore.getState().setObjectLight(id, { penumbra: 0 });
    expect(lightOf(id)?.penumbra).toBe(0);
    useEditorStore.getState().setObjectLight(id, { penumbra: 1 });
    expect(lightOf(id)?.penumbra).toBe(1);
  });

  // The AI tool passes every field, undefined for the ones the caller omitted. Without
  // stripUndefined in the store action, setting intensity alone would blank the penumbra.
  it('is preserved when an unrelated light property is patched', () => {
    const id = createLight();
    useEditorStore.getState().setObjectLight(id, { type: 'spot', penumbra: 0.9 });
    useEditorStore.getState().setObjectLight(id, {
      intensity: 12,
      penumbra: undefined,
      color: undefined,
      castShadow: undefined,
    });
    expect(lightOf(id)?.penumbra).toBe(0.9);
    expect(lightOf(id)?.intensity).toBe(12);
  });

  it('survives a scene serialization round trip', () => {
    const id = createLight();
    useEditorStore.getState().setObjectLight(id, { type: 'spot', penumbra: 0.22 });
    const scenes = useEditorStore.getState().scenes;
    const reloaded = JSON.parse(JSON.stringify(scenes));
    const light = reloaded
      .flatMap((scene: { objects: { id: string; light?: { penumbra?: number } }[] }) => scene.objects)
      .find((object: { id: string }) => object.id === id)?.light;
    expect(light?.penumbra).toBe(0.22);
  });
});
