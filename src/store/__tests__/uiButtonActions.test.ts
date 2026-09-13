import { beforeEach, afterEach, expect, it } from 'vitest';
import { selectActiveObjects, useEditorStore } from '../editorStore';
import { blankProject } from '../../project/serialize';
import { findUIElement } from '../editor/ui';
import { currentUIButtonAction, ownedButtonGraph } from '../../ui/buttonActions';
import { scanInteractionProblems } from '../../ui/interactionProblems';
import { detectRuntimeFeatures } from '../../project/runtimeCompatibility';
import { initHistory, clearHistory, undo, redo } from '../history';
import { collectPackage, remapPackageForImport, type NodeForgePackage } from '../../project/package';
import { buildGameBundle, readGameBundle } from '../../project/exportGame';
const state = () => useEditorStore.getState();
let docId: string, buttonId: string, screenId: string;
const doc = () => state().uiDocuments.find(d => d.id === docId)!;
const button = () => findUIElement(doc().root, buttonId)!;
const graph = () => state().graphs.find(g => g.id === state().blueprints.find(b => b.id === doc().logicBlueprintId)?.graphId)!;
const click = (id = buttonId, documentId = docId) => {
  const document = state().uiDocuments.find(d => d.id === documentId)!;
  state().fireCustomEvent(findUIElement(document.root, id)!.onClickEvent!);
  state().tickRuntime(1 / 60);
};
beforeEach(() => {
  state().setPlaying(false); state().loadProject(blankProject('Buttons'));
  docId = state().createUIDocument('Menu', 'screen'); buttonId = state().addUIElement(docId, undefined, 'button');
  screenId = state().createUIDocument('Settings', 'screen'); state().updateUIDocument(screenId, { visibleOnStart: false });
  initHistory(); clearHistory();
});
afterEach(() => { state().setPlaying(false); clearHistory(); });
it('configures, undoes and redoes the whole action without scene objects; survives project save/load', () => {
  const authored = state().scenes;
  state().setUIButtonAction(docId, buttonId, { kind: 'showUI', documentId: screenId, hideCurrent: true });
  expect(doc().logicScope).toBe('project'); expect(graph().nodes).toHaveLength(3); expect(state().scenes).toBe(authored);
  const event = button().onClickEvent;
  undo(); expect(button().onClickEvent).toBeUndefined(); expect(doc().logicBlueprintId).toBeUndefined();
  redo(); expect(button().onClickEvent).toBe(event);
  const project = JSON.parse(JSON.stringify(state().exportProject())); state().loadProject(project);
  expect(ownedButtonGraph(doc(), button(), state().blueprints, state().graphs)).toBeTruthy();
  expect(detectRuntimeFeatures(project)).toContain('ui-button-actions');
});
it('replaces only an unchanged branch and preserves moved nodes', () => {
  state().setUIButtonAction(docId, buttonId, { kind: 'showUI', documentId: screenId });
  const ids = graph().nodes.map(n => n.id);
  useEditorStore.setState({ graphs: state().graphs.map(g => g.id === graph().id ? { ...g, nodes: g.nodes.map(n => ({ ...n, position: { x: 800, y: 900 } })) } : g) });
  state().setUIButtonAction(docId, buttonId, { kind: 'hideUI', documentId: screenId });
  expect(graph().nodes.map(n => n.id)).toEqual(ids); expect(graph().nodes[0].position).toEqual({ x: 800, y: 900 });
  state().setUIButtonAction(docId, buttonId, { kind: 'none' }); expect(graph().nodes).toHaveLength(0);
});
it('preserves hand-edited wiring and gives only this button a fresh handler', () => {
  state().setUIButtonAction(docId, buttonId, { kind: 'showUI', documentId: screenId });
  const old = graph(), event = button().onClickEvent;
  const extra = state().addGraphNodeToBlueprint(doc().logicBlueprintId!, 'Print String', 'Runtime', { message: 'User logic' });
  state().connectGraphNodes(doc().logicBlueprintId!, old.nodes[1].id, extra);
  expect(currentUIButtonAction(doc(), button(), state().blueprints, state().graphs).kind).toBe('customEvent');
  const edited = graph(); state().setUIButtonAction(docId, buttonId, { kind: 'resumeGame' });
  expect(graph().nodes.slice(0, edited.nodes.length)).toEqual(edited.nodes); expect(graph().edges.slice(0, edited.edges.length)).toEqual(edited.edges);
  expect(button().onClickEvent).not.toBe(event);
});
it('does not delete shared handlers or a handler converted to a custom event', () => {
  state().setUIButtonAction(docId, buttonId, { kind: 'resumeGame' }); const original = graph();
  state().setUIButtonAction(docId, buttonId, { kind: 'customEvent', eventName: button().onClickEvent! });
  expect(graph()).toBe(original); expect(button().clickAction).toBeUndefined();
  state().setUIButtonAction(docId, buttonId, { kind: 'resumeGame' });
  const copy = state().duplicateUIElement(docId, buttonId), shared = button().onClickEvent;
  const previous = graph(); state().setUIButtonAction(docId, buttonId, { kind: 'hideUI', documentId: screenId });
  expect(findUIElement(doc().root, copy)!.onClickEvent).toBe(shared); expect(graph().nodes.slice(0, previous.nodes.length)).toEqual(previous.nodes);
});
it('rejects missing targets atomically and rejects edits during Play', () => {
  const before = state(); expect(() => state().setUIButtonAction(docId, buttonId, { kind: 'loadScene', sceneId: 'deleted' })).toThrow('Choose the level');
  expect(state()).toBe(before);
  state().setPlaying(true); expect(() => state().setUIButtonAction(docId, buttonId, { kind: 'resumeGame' })).toThrow('Stop Play');
});
it('executes open, toggle, pause and resume while restoring clean scenes on Stop', () => {
  const resume = state().addUIElement(screenId, undefined, 'button');
  state().setUIButtonAction(screenId, resume, { kind: 'resumeGame' });
  state().setUIButtonAction(docId, buttonId, { kind: 'pauseGame', documentId: screenId });
  const authored = structuredClone(state().scenes); useEditorStore.setState({ isDirty: false });
  state().setPlaying(true); click(); expect(state().runtimeTimeScale).toBe(0); expect(state().runtimeVisibleUI[screenId]).toBe(true);
  click(resume, screenId); expect(state().runtimeTimeScale).toBe(1); expect(state().runtimeVisibleUI[screenId]).toBeFalsy();
  state().setPlaying(false); expect(state().scenes).toEqual(authored); expect(state().isDirty).toBe(false);
  state().setUIButtonAction(docId, buttonId, { kind: 'toggleUI', documentId: screenId });
  state().setPlaying(true); click(); expect(state().runtimeVisibleUI[screenId]).toBe(true); click(); expect(state().runtimeVisibleUI[screenId]).toBeFalsy();
});
it('loads levels, closes the menu, and keeps buttons working after a transition', () => {
  const initial = state().activeSceneId, second = state().createScene('Level 2'); state().setActiveScene(initial);
  state().setUIButtonAction(docId, buttonId, { kind: 'loadScene', sceneId: second, hideCurrent: true });
  const resume = state().addUIElement(screenId, undefined, 'button'); state().setUIButtonAction(screenId, resume, { kind: 'resumeGame' });
  const authored = structuredClone(state().scenes); useEditorStore.setState({ isDirty: false });
  state().setPlaying(true); click(); expect(state().activeSceneId).toBe(second); expect(state().runtimeVisibleUI[docId]).toBeFalsy();
  useEditorStore.setState({ runtimeTimeScale: 0, runtimeVisibleUI: { [screenId]: true } });
  click(resume, screenId); expect(state().runtimeTimeScale).toBe(1); expect(state().runtimeVisibleUI[screenId]).toBeFalsy();
  state().setPlaying(false); expect(state().activeSceneId).toBe(initial); expect(state().scenes).toEqual(authored); expect(state().isDirty).toBe(false);
});
it('restarts the current level from its pristine objects and keeps project variables', () => {
  const cube = state().createObjectWithProps('cube', { name: 'Reset me' });
  state().setUIButtonAction(docId, buttonId, { kind: 'restartScene' });
  const authored = structuredClone(selectActiveObjects(state())); state().setPlaying(true);
  useEditorStore.setState(s => ({ scenes: s.scenes.map(scene => scene.id === s.activeSceneId ? { ...scene, objects: scene.objects.filter(o => o.id !== cube) } : scene), runtimeVariableValues: { score: 17 }, runtimeTimeScale: 0 }));
  click(); expect(selectActiveObjects(state()).filter(o => !o.id.startsWith('ui-controller:'))).toEqual(authored);
  expect(state().runtimeTimeScale).toBe(1); expect(state().runtimeVariableValues.score).toBe(17);
});
it('honours authored disabled controllers instead of injecting duplicate UI logic', () => {
  state().setUIButtonAction(docId, buttonId, { kind: 'showUI', documentId: screenId });
  const controller = state().createObjectWithProps('empty', { name: 'Disabled logic' }); state().attachScript(controller, doc().logicBlueprintId!);
  useEditorStore.setState(s => ({ scenes: s.scenes.map(scene => scene.id === s.activeSceneId ? { ...scene, objects: scene.objects.map(o => o.id === controller ? { ...o, script: { ...o.script!, enabled: false } } : o) } : scene) }));
  state().setPlaying(true); click(); expect(state().runtimeVisibleUI[screenId]).toBeFalsy(); expect(selectActiveObjects(state()).filter(o => o.script?.blueprintId === doc().logicBlueprintId)).toHaveLength(1);
});
it('guides missing handlers, disconnected events and deleted targets to a button or exact node', () => {
  const scan = () => scanInteractionProblems(selectActiveObjects(state()), state().graphs, state().blueprints, state().uiDocuments, state().scenes);
  expect(scan().some(p => p.uiElementId === buttonId && p.message.includes('no action'))).toBe(true);
  state().setUIButtonAction(docId, buttonId, { kind: 'customEvent', eventName: 'missing' }); expect(scan().some(p => p.message.includes('no Blueprint listens'))).toBe(true);
  state().setUIButtonAction(docId, buttonId, { kind: 'showUI', documentId: screenId }); const eventId = graph().nodes[0].id;
  useEditorStore.setState({ graphs: state().graphs.map(g => g.id === graph().id ? { ...g, edges: [] } : g) });
  expect(scan().some(p => p.nodeId === eventId && p.message.includes('stops here'))).toBe(true);
  state().deleteUIDocument(screenId); expect(scan().some(p => p.nodeId === graph().nodes[1].id && p.message.includes('screen is missing'))).toBe(true);
});
it('imports two copies with independent click events and editable action targets', () => {
  state().setUIButtonAction(docId, buttonId, { kind: 'showUI', documentId: screenId, hideCurrent: true });
  const content = collectPackage(state().exportProject(), { uiDocuments: [docId] }).content;
  const pkg = { content, assets: [], kind: 'asset', meta: { name: 'Menus' } } as unknown as NodeForgePackage;
  const first = remapPackageForImport(pkg).content, second = remapPackageForImport(pkg).content;
  const menu = first.uiDocuments.find(d => d.name === 'Menu')!, settings = first.uiDocuments.find(d => d.name === 'Settings')!;
  const importedButton = menu.root.children[0];
  expect(importedButton.onClickEvent).not.toBe(button().onClickEvent);
  expect(importedButton.onClickEvent).not.toBe(second.uiDocuments.find(d => d.name === 'Menu')!.root.children[0].onClickEvent);
  const action = currentUIButtonAction(menu, importedButton, first.blueprints, first.graphs);
  expect(action).toEqual({ kind: 'showUI', documentId: settings.id, hideCurrent: true });
  state().loadProject({ ...state().exportProject(), ...first });
  const loaded = state().uiDocuments.find(d => d.id === menu.id)!;
  expect(currentUIButtonAction(loaded, loaded.root.children[0], state().blueprints, state().graphs)).toEqual(action);
});
it('carries the new runtime contract and working restart through a game bundle', () => {
  state().setUIButtonAction(docId, buttonId, { kind: 'restartScene' });
  const bundle = buildGameBundle(state().exportProject());
  expect(bundle.runtimeContract.requiredFeatures).toContain('ui-button-actions');
  const parsed = readGameBundle(JSON.parse(JSON.stringify(bundle)));
  state().loadProject(parsed.project); state().setPlaying(true); state().tickRuntime(1 / 60); click();
  expect(state().runtimeTime).toBe(0); expect(state().runtimeLog.some(l => l.startsWith('⚠️'))).toBe(false);
});
