import { initHistory, clearHistory, undo, redo } from '../history';
import { describe, it, expect, beforeEach } from 'vitest';
import { selectActiveObjects, useEditorStore } from '../editorStore';
import { getStylizedPreset } from '../../tree/stylizedPresets';
import { treeSpecFromArchetype } from '../../tree/treeSpec';
import type { Scene, SceneObject } from '../../types';

/**
 * The store actions behind the Arbor Forge plugin and the AI's apply_tree_preset / plant_grove
 * tools. What matters: presets land as ordinary library assets, groves stay grouped + linked to
 * ONE asset, and a seeded grove replants identically (saves, replays and "undo then redo the same
 * grove" all lean on that).
 */
describe('tree preset + grove store actions', () => {
  beforeEach(() => {
    // Snapshot-free isolation: drop everything the previous test planted.
    const state = useEditorStore.getState();
    const planted = selectActiveObjects(state).filter((object) => object.tree || object.name.includes('Grove'));
    for (const object of planted) state.deleteObject(object.id);
  });

  it('createTreeSpecFromPreset lands a normalized library asset', () => {
    const before = useEditorStore.getState().treeSpecs.length;
    const specId = useEditorStore.getState().createTreeSpecFromPreset('sakura');
    expect(specId).toBeTruthy();
    const spec = useEditorStore.getState().treeSpecs.find((entry) => entry.id === specId)!;
    expect(spec.name).toBe(getStylizedPreset('sakura')!.name);
    // The preset's art direction must land verbatim — compare against the data, not a literal,
    // so tuning a colour doesn't break the test.
    expect(spec.look.foliageRamp[0]).toBe(getStylizedPreset('sakura')!.patch.look?.foliageRamp?.[0]);
    expect(useEditorStore.getState().treeSpecs).toHaveLength(before + 1);
    expect(useEditorStore.getState().activeTreeSpecId).toBe(specId);
    // Unknown presets refuse loudly-but-safely instead of adding a mystery asset.
    expect(useEditorStore.getState().createTreeSpecFromPreset('not-a-preset')).toBeNull();
  });

  it('createTreeFromSpec links the object to that exact library asset', () => {
    const specId = useEditorStore.getState().createTreeSpecFromPreset('autumn-maple')!;
    const objectId = useEditorStore.getState().createTreeFromSpec(specId, { position: [3, 0, -2], seed: 9 })!;
    const object = selectActiveObjects(useEditorStore.getState()).find((entry) => entry.id === objectId)!;
    expect(object.tree?.specId).toBe(specId);
    expect(object.tree?.seed).toBe(9);
    expect(object.transform.position[0]).toBe(3);
    expect(useEditorStore.getState().createTreeFromSpec('tree-missing', {})).toBeNull();
  });

  it('plantGrove groups N linked trees and reuses the preset library entry', () => {
    const specsBefore = useEditorStore.getState().treeSpecs.length;
    const first = useEditorStore.getState().plantGrove({ presetId: 'ghost-willow', count: 9, radius: 15 })!;
    expect(first.treeIds).toHaveLength(9);

    const objects = selectActiveObjects(useEditorStore.getState());
    const group = objects.find((entry) => entry.id === first.groupId)!;
    expect(group.name).toMatch(/Grove/);
    const children = objects.filter((entry) => entry.parentId === first.groupId);
    expect(children).toHaveLength(9);
    const linkedSpecIds = new Set(children.map((child) => child.tree?.specId));
    expect(linkedSpecIds.size).toBe(1);
    // Every tree sits inside the requested disc (its own jitter can only shrink the radius term).
    for (const child of children) {
      const [x, , z] = child.transform.position;
      expect(Math.hypot(x, z)).toBeLessThanOrEqual(15 * 1.1 + 0.001);
    }

    // A second grove from the same preset reuses the library entry: one asset drives both stands.
    const second = useEditorStore.getState().plantGrove({ presetId: 'ghost-willow', count: 4 })!;
    expect(useEditorStore.getState().treeSpecs).toHaveLength(specsBefore + 1);
    const secondChildren = selectActiveObjects(useEditorStore.getState()).filter(
      (entry) => entry.parentId === second.groupId,
    );
    expect(secondChildren[0].tree?.specId).toBe([...linkedSpecIds][0]);
  });

  it('the same layout seed replants the identical grove', () => {
    const layout = (groupId: string) =>
      selectActiveObjects(useEditorStore.getState())
        .filter((entry) => entry.parentId === groupId)
        .map((entry) => ({ position: entry.transform.position, seed: entry.tree?.seed }));

    const a = useEditorStore.getState().plantGrove({ archetype: 'conifer', count: 7, radius: 20, seed: 1234 })!;
    const b = useEditorStore.getState().plantGrove({ archetype: 'conifer', count: 7, radius: 20, seed: 1234 })!;
    const c = useEditorStore.getState().plantGrove({ archetype: 'conifer', count: 7, radius: 20, seed: 999 })!;

    expect(layout(a.groupId)).toEqual(layout(b.groupId));
    expect(layout(a.groupId)).not.toEqual(layout(c.groupId));
  });

  it('plantGrove refuses unknown inputs instead of planting something else', () => {
    expect(useEditorStore.getState().plantGrove({ presetId: 'nope' })).toBeNull();
    expect(useEditorStore.getState().plantGrove({ specId: 'tree-nope' })).toBeNull();
    expect(useEditorStore.getState().plantGrove({})).toBeNull();
  });

  it('deleting a shared spec detaches linked trees in every scene with the latest asset fallback', () => {
    const original = useEditorStore.getState();
    const shared = treeSpecFromArchetype('conifer', 'delete-shared', 'Latest Pine');
    const stale = treeSpecFromArchetype('broadleaf', 'stale-inline', 'Old Inline');
    const linked = (id: string): SceneObject => ({
      id,
      name: id,
      kind: 'empty',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      tree: { enabled: true, specId: shared.id, spec: stale, seed: 1 },
    } as SceneObject);
    try {
      useEditorStore.setState({
        treeSpecs: [...original.treeSpecs, shared],
        activeTreeSpecId: shared.id,
        scenes: [
          { id: 'scene-a', name: 'A', objects: [linked('a')] },
          { id: 'scene-b', name: 'B', objects: [linked('b')] },
        ] as Scene[],
        activeSceneId: 'scene-a',
      });
      useEditorStore.setState({ prefabs: [{ id: 'prefab', name: 'Prefab', objects: [linked('prefab-tree')], rootId: 'prefab-tree', createdAt: 0 }], isPlaying: false });
      initHistory(); clearHistory();
      useEditorStore.getState().deleteTreeSpec(shared.id);
      const next = useEditorStore.getState();
      expect(next.treeSpecs.some((entry) => entry.id === shared.id)).toBe(false);
      for (const scene of next.scenes) {
        expect(scene.objects[0].tree?.specId).toBeUndefined();
        expect(scene.objects[0].tree?.spec.name).toBe('Latest Pine');
      }
      expect(next.prefabs[0].objects[0].tree?.specId).toBeUndefined();
      undo();
      expect(useEditorStore.getState().prefabs[0].objects[0].tree?.specId).toBe(shared.id);
      redo();
      expect(useEditorStore.getState().prefabs[0].objects[0].tree?.specId).toBeUndefined();
      clearHistory();
    } finally {
      useEditorStore.setState(original, true);
    }
  });

  it('keeps a tree asset while terrain foliage still references it', () => {
    const original = useEditorStore.getState();
    const shared = treeSpecFromArchetype('conifer', 'terrain-shared');
    try {
      useEditorStore.setState({
        treeSpecs: [...original.treeSpecs, shared],
        activeTreeSpecId: shared.id,
        scenes: [{
          id: 'scene-terrain',
          name: 'Terrain',
          objects: [{
            id: 'terrain',
            name: 'Terrain',
            kind: 'empty',
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            terrain: { foliage: { treeSpecId: shared.id } } as SceneObject['terrain'],
          } as SceneObject],
        }] as Scene[],
        activeSceneId: 'scene-terrain',
      });
      useEditorStore.getState().deleteTreeSpec(shared.id);
      expect(useEditorStore.getState().treeSpecs.some((entry) => entry.id === shared.id)).toBe(true);
    } finally {
      useEditorStore.setState(original, true);
    }
  });
});
