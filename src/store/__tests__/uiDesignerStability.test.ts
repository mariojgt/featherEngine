import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../editorStore';
import { blankProject } from '../../project/serialize';
import { findUIElement } from '../editor/ui';
import { buildPackage, collectPackage, parsePackage, remapPackageForImport } from '../../project/package';

const state = () => useEditorStore.getState();
const doc = (id: string) => state().uiDocuments.find((item) => item.id === id)!;
beforeEach(() => state().loadProject(blankProject('Widget tests')));
afterEach(() => state().setPlaying(false));

describe('UI designer authoring', () => {
  it('reparents whole subtrees, preserves ids, and refuses descendant cycles and leaf parents', () => {
    const id = state().createUIDocument('UI', 'screen');
    const a = state().addUIElement(id, undefined, 'panel');
    const b = state().addUIElement(id, undefined, 'panel');
    const child = state().addUIElement(id, a, 'text');
    state().reparentUIElement(id, a, b);
    expect(findUIElement(doc(id).root, b)?.children[0].id).toBe(a);
    expect(findUIElement(doc(id).root, a)?.children[0].id).toBe(child);
    const before = doc(id);
    state().reparentUIElement(id, b, a);
    state().reparentUIElement(id, a, child);
    state().reparentUIElement(id, doc(id).root.id, b);
    expect(doc(id)).toBe(before);
  });

  it('keeps the extracted button event on its instance so new copies can choose their own action', () => {
    const id = state().createUIDocument('UI', 'screen');
    const button = state().addUIElement(id, undefined, 'button');
    state().updateUIElement(id, button, { onClickEvent: 'playPressed' });
    const component = state().extractUIComponent(id, button)!;
    expect(doc(id).root.children[0].onClickEvent).toBe('playPressed');
    expect(doc(component).root.onClickEvent).toBeUndefined();
  });

  it('guards component changes and invalid insertion destinations', () => {
    const a = state().createUIComponent('A'), b = state().createUIComponent('B');
    const first = state().insertUIComponent(a, undefined, b)!;
    const reverse = state().addUIElement(b, undefined, 'component');
    state().updateUIElement(b, reverse, { componentId: a });
    expect(findUIElement(doc(b).root, reverse)?.componentId).toBeUndefined();
    expect(state().insertUIComponent('missing', undefined, a)).toBeNull();
    expect(state().insertUIComponent(a, first, b)).toBeNull();
    state().setUIComponentParam(a, first, 'label', "''");
    expect(findUIElement(doc(a).root, first)?.componentParams?.label).toBe("''");
    expect(() => state().addUIElement(a, first, 'text')).toThrow(/container/);
  });

  it('extracts a positioned widget without doubling its layout or changing its runtime identity', () => {
    const id = state().createUIDocument('UI', 'screen');
    const panel = state().addUIElement(id, undefined, 'panel');
    const child = state().addUIElement(id, panel, 'text');
    state().updateUIElement(id, panel, { style: { position: 'absolute', left: '40px', top: '20px', padding: '12px', width: '180px' } });
    state().setUIDocumentCss(id, '.card { color: red; }');
    const component = state().extractUIComponent(id, panel)!;
    expect(doc(id).root.children[0].id).toBe(panel);
    expect(doc(component).root.children[0].id).toBe(child);
    expect(doc(component).root.style.position).toBeUndefined();
    expect(doc(component).root.style.padding).toBe('12px');
    expect(doc(component).css).toContain('.card');
  });
});

describe('UI Blueprint nodes and packaged behavior', () => {
  it('collects variables used only by component parameters, including named bracket lookups', () => {
    const id = state().createUIDocument('HUD', 'screen');
    const source = state().createUIComponent('Badge');
    const instance = state().insertUIComponent(id, undefined, source)!;
    state().createVariable('coins', 'number');
    state().createVariable('Player Name', 'string');
    state().createVariable('unrelated', 'number');
    state().setUIComponentParam(id, instance, 'label', "vars['Player Name'] + ': ' + coins");
    const collected = collectPackage(state(), { uiDocuments: [id] });
    expect(collected.content.variables.map((item) => item.name).sort()).toEqual(['Player Name', 'coins']);
  });

  it('runs selection, close, toggle, Set UI Text and Set UI Visible after packaging into a fresh project', () => {
    const id = state().createUIFromTemplate('inventory');
    const collected = collectPackage(state(), { uiDocuments: [id] });
    const pkg = parsePackage(buildPackage('asset', collected.content, [], { id: 'inventory-kit', name: 'Inventory', version: '1.0.0' }));
    expect(pkg.content.uiDocuments).toHaveLength(2);
    expect(pkg.content.variables.map((item) => item.name).sort()).toEqual(['inventoryFavorite', 'inventoryNote', 'inventorySelection']);
    expect(pkg.content.blueprints).toHaveLength(1);
    state().loadProject(blankProject('Consumer'));
    const imported = remapPackageForImport(pkg);
    state().mergePackage(imported.content, imported.assets);
    const hud = state().uiDocuments.find((item) => !item.isComponent)!;
    const grid = hud.root.children[2].children[0];
    const blueprint = hud.logicBlueprintId!;
    const evt = state().addGraphNodeToBlueprint(blueprint, 'Custom Event', 'Events', { eventName: 'testWidgetNodes' });
    const setText = state().addGraphNodeToBlueprint(blueprint, 'Set UI Text', 'UI', { documentId: hud.id, elementId: grid.children[0].id, stringValue: 'Changed by node' });
    const setVisible = state().addGraphNodeToBlueprint(blueprint, 'Set UI Visible', 'UI', { documentId: hud.id, elementId: grid.children[1].id, visible: false });
    state().connectGraphNodes(blueprint, evt, setText);
    state().connectGraphNodes(blueprint, setText, setVisible);
    state().setPlaying(true); state().tickRuntime(0);
    state().fireCustomEvent(grid.children[1].onClickEvent!); state().tickRuntime(1 / 60);
    const selection = state().variables.find((item) => item.name === 'inventorySelection')!;
    expect(state().runtimeVariableValues[selection.id]).toBe('Iron sword');
    state().fireCustomEvent('testWidgetNodes'); state().tickRuntime(1 / 60);
    expect(state().runtimeUITextOverrides[`${hud.id}:${grid.children[0].id}`]).toBe('Changed by node');
    expect(state().runtimeUIVisibleOverrides[`${hud.id}:${grid.children[1].id}`]).toBe(false);
    const detailChildren = hud.root.children[2].children[1].children;
    const close = detailChildren[detailChildren.length - 1];
    state().fireCustomEvent(close.onClickEvent!); state().tickRuntime(1 / 60);
    expect(state().runtimeVisibleUI[hud.id]).toBe(false);
    state().setRuntimeKey('KeyI', true); state().setRuntimeKey('KeyI', false); state().tickRuntime(1 / 60);
    expect(state().runtimeVisibleUI[hud.id]).toBe(true);
    state().tickRuntime(1 / 60);
    expect(state().runtimeVisibleUI[hud.id]).toBe(true);
  });
});
