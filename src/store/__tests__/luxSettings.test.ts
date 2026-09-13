import { expect, it } from 'vitest';
import { selectActiveSceneEnvironment, useEditorStore } from '../editorStore';
import { initHistory, clearHistory, separateHistoryAction, undo } from '../history';
import { detectRuntimeFeatures } from '../../project/runtimeCompatibility';

it('authors partial Lux changes, undoes them, and retains settings and the runtime requirement on export/reload', () => {
  const store = useEditorStore.getState(); const id = store.activeSceneId;
  store.updateSceneEnvironment(id, { lux: { enabled: true, mode: 'fixed', position: [1, 2, 3], radius: 12 } });
  store.updateSceneEnvironment(id, { lux: { indirectIntensity: 1.2, radius: undefined } });
  expect(selectActiveSceneEnvironment(useEditorStore.getState())?.lux).toMatchObject({ enabled: true, radius: 12, indirectIntensity: 1.2, position: [1, 2, 3] });
  initHistory(); clearHistory(); separateHistoryAction();
  store.updateSceneEnvironment(id, { lux: { enabled: false } }); undo();
  expect(selectActiveSceneEnvironment(useEditorStore.getState())?.lux?.enabled).toBe(true);
  const project = useEditorStore.getState().exportProject();
  expect(detectRuntimeFeatures(project)).toContain('lux-lighting');
  useEditorStore.getState().loadProject(JSON.parse(JSON.stringify(project)));
  expect(selectActiveSceneEnvironment(useEditorStore.getState())?.lux).toMatchObject({ enabled: true, radius: 12, indirectIntensity: 1.2 });
});

it('retains bounded room settings through undo, save and runtime export', () => {
  const store = useEditorStore.getState(), id = store.activeSceneId;
  const rooms = [{ id: 'hall', name: 'Hall', center: [0, 2, 0] as [number, number, number], size: [10, 4, 8] as [number, number, number], blendDistance: 0.5 }];
  store.updateSceneEnvironment(id, { lux: { enabled: true, mode: 'rooms', rooms, roomOcclusion: true } });
  clearHistory(); separateHistoryAction(); store.updateSceneEnvironment(id, { lux: { rooms: [] } }); undo();
  expect(selectActiveSceneEnvironment(useEditorStore.getState())?.lux?.rooms).toEqual(rooms);
  const project = useEditorStore.getState().exportProject();
  expect(detectRuntimeFeatures(project)).toContain('lux-rooms');
  useEditorStore.getState().loadProject(JSON.parse(JSON.stringify(project)));
  expect(selectActiveSceneEnvironment(useEditorStore.getState())?.lux).toMatchObject({ mode: 'rooms', rooms, roomOcclusion: true });
});
