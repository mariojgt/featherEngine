import { describe, it, expect } from 'vitest';
import { useEditorStore } from '../editorStore';
import { nonVfxObjectsSignature, vfxObjectsSignature } from '../stableSelectors';
import { makeImpactObject } from '../editor/objectFactory';

/**
 * Proves the VFX render-layer split. The Play-mode bottleneck was that transient VFX share the one
 * scene-objects array, so every spawn changed the structural signature the viewport subscribes to and
 * re-reconciled the whole authored scene. After the split the viewport subscribes to an authored-only
 * signature; this test confirms a spawned effect leaves that signature byte-identical (no scene
 * re-render) while the separate VFX signature changes (only the small VFX list re-renders).
 */
describe('VFX render-layer split — signature isolation', () => {
  it('a spawned VFX changes the VFX signature but NOT the authored-object signature', () => {
    const state = () => useEditorStore.getState();

    const authoredBefore = nonVfxObjectsSignature(state());
    const vfxBefore = vfxObjectsSignature(state());

    // Simulate what tickRuntime does on a hit: append a transient impact effect to the active scene.
    const impact = makeImpactObject([0, 0, 0]);
    useEditorStore.setState((s) => ({
      scenes: s.scenes.map((scene) =>
        scene.id === s.activeSceneId ? { ...scene, objects: [...scene.objects, impact] } : scene,
      ),
    }));

    const authoredAfter = nonVfxObjectsSignature(state());
    const vfxAfter = vfxObjectsSignature(state());

    // Same string instance back → consumers subscribed to it do not re-render on the VFX spawn.
    expect(authoredAfter).toBe(authoredBefore);
    // The VFX list genuinely changed.
    expect(vfxAfter).not.toBe(vfxBefore);
  });
});
