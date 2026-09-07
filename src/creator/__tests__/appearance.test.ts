import { beforeEach, expect, it } from 'vitest';
import { useEditorStore, selectActiveObjects } from '../../store/editorStore';
import { blankProject } from '../../project/serialize';
import { initHistory, clearHistory, undo } from '../../store/history';
import { buildPackage, remapPackageForImport } from '../../project/package';
import { cloneObjectTreeWithIdMap } from '../../store/editor/storeHelpers';

beforeEach(() => { useEditorStore.getState().loadProject(blankProject('Appearance')); initHistory(); clearHistory(); });
it('changes the visible mesh while retaining the collision, script and transform root; supports restore and undo', () => {
  const store = useEditorStore.getState();
  const id = store.createObjectWithProps('cube', { name: 'Door', physics: { enabled: true, bodyType: 'fixed' } });
  store.makeObjectRole(id, 'door');
  store.addAssetItems([{ id: 'new-model', name: 'replacement.glb', type: 'model', size: 0, createdAt: 0 }]);
  const before = selectActiveObjects(useEditorStore.getState()).find((item) => item.id === id)!;
  clearHistory();
  const result = store.replaceObjectAppearance(id, 'new-model');
  expect(result.ok).toBe(true);
  const after = selectActiveObjects(useEditorStore.getState()).find((item) => item.id === id)!;
  expect(after.physics).toBe(before.physics);
  expect(after.transform).toBe(before.transform);
  expect(after.script).toBe(before.script);
  expect(after.renderer?.enabled).toBe(false);
  const visual = selectActiveObjects(useEditorStore.getState()).find((item) => item.id === result.objectId)!;
  expect(visual.parentId).toBe(id);
  expect(visual.physics).toBeUndefined();
  expect(visual.renderer?.modelAssetId).toBe('new-model');
  undo();
  expect(selectActiveObjects(useEditorStore.getState()).find((item) => item.id === id)).toEqual(before);
  expect(store.replaceObjectAppearance(id, 'new-model').ok).toBe(true);
  expect(store.replaceObjectAppearance(id, null).ok).toBe(true);
  expect(selectActiveObjects(useEditorStore.getState()).find((item) => item.id === id)?.renderer).toEqual(before.renderer);
  expect(selectActiveObjects(useEditorStore.getState()).some((item) => item.creatorAppearanceFor === id)).toBe(false);
});
it('leaves the scene intact on missing assets', () => {
  const store = useEditorStore.getState();
  const id = store.createObjectWithProps('cube');
  const before = useEditorStore.getState().scenes;
  expect(store.replaceObjectAppearance(id, 'missing').ok).toBe(false);
  expect(useEditorStore.getState().scenes).toBe(before);
});

it('keeps appearance ownership and editable rules when cloned or packaged with fresh ids', () => {
  const store = useEditorStore.getState();
  const root = store.createObjectWithProps('cube', { name: 'Packaged prop' });
  store.addAssetItems([{ id: 'mesh', name: 'prop.glb', type: 'model', size: 4, createdAt: 0 }, { id: 'sound', name: 'chime.wav', type: 'audio', size: 4, createdAt: 0 }]);
  const replacement = store.replaceObjectAppearance(root, 'mesh');
  expect(store.addSimpleInteraction(root, { trigger: { type: 'start' }, action: { type: 'play-sound', assetId: 'sound' } }).ok).toBe(true);
  const tree = selectActiveObjects(useEditorStore.getState()).filter((item) => item.id === root || item.id === replacement.objectId);
  const clone = cloneObjectTreeWithIdMap(tree, root, new Map([[root, 'clone-root'], [replacement.objectId!, 'clone-appearance']]));
  expect(clone.objects.find((item) => item.id === 'clone-appearance')?.creatorAppearanceFor).toBe('clone-root');
  const collected = useEditorStore.getState().buildProjectPackage();
  const pkg = buildPackage('project', collected.content, useEditorStore.getState().assets.filter((asset) => collected.assetIds.includes(asset.id)), { id: 'test-prop', version: '1.0.0', name: 'Test prop', description: '', author: 'Test', tags: [] });
  const imported = remapPackageForImport(pkg);
  const project = useEditorStore.getState().exportProject();
  store.loadProject({ ...project, ...imported.content, assets: imported.assets, scenes: imported.content.scenes!, activeSceneId: imported.content.scenes![0].id });
  const objects = selectActiveObjects(useEditorStore.getState());
  const owner = objects.find((item) => item.name === 'Packaged prop')!;
  const visual = objects.find((item) => item.creatorAppearanceFor === owner.id)!;
  expect(visual.parentId).toBe(owner.id);
  const rule = owner.creatorInteractions![0];
  expect(rule.action.assetId).not.toBe('sound');
  expect(store.updateSimpleInteraction(owner.id, rule.id, rule).ok).toBe(true);
  expect(store.replaceObjectAppearance(owner.id, null).ok).toBe(true);
});

it('protects children added beneath the replacement mesh during restore', () => {
  const store = useEditorStore.getState();
  const root = store.createObjectWithProps('cube');
  store.addAssetItems([{ id: 'mesh', name: 'prop.glb', type: 'model', size: 4, createdAt: 0 }]);
  const visual = store.replaceObjectAppearance(root, 'mesh');
  store.createObjectWithProps('empty', { parentId: visual.objectId });
  const before = useEditorStore.getState().scenes;
  expect(store.replaceObjectAppearance(root, null).ok).toBe(false);
  expect(useEditorStore.getState().scenes).toBe(before);
});
