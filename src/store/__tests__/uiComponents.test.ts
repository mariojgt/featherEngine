/**
 * Reusable UI components — the Unreal "user widget" model: a document instanced inside another by
 * reference, so one edit reaches every instance. These pin the parts that are easy to get subtly
 * wrong: extraction leaving the screen unchanged, cycles being refused, and instances surviving
 * the package round-trip that regenerates every id.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../editorStore';
import { wouldCreateUICycle } from '../editor/ui';
import { collectPackage, remapPackageForImport } from '../../project/package';
import type { NodeForgePackage, PackageSource } from '../../project/package';
import type { UIDocument, UIElement } from '../../types';

const store = () => useEditorStore.getState();
const docById = (id: string) => store().uiDocuments.find((d) => d.id === id)!;
const find = (root: UIElement, id: string): UIElement | undefined =>
  root.id === id ? root : root.children.reduce<UIElement | undefined>((hit, c) => hit ?? find(c, id), undefined);
const countKind = (root: UIElement, kind: string): number =>
  (root.kind === kind ? 1 : 0) + root.children.reduce((n, c) => n + countKind(c, kind), 0);

describe('extractUIComponent', () => {
  let docId = '';
  let slotId = '';

  beforeEach(() => {
    useEditorStore.setState({ uiDocuments: [] });
    docId = store().createUIDocument('HUD', 'screen');
    slotId = store().addUIElement(docId, undefined, 'panel');
    store().updateUIElement(docId, slotId, { name: 'Slot', className: 'slot', style: { width: '48px' } });
    store().addUIElement(docId, slotId, 'text');
  });

  it('moves the subtree into a new component and leaves an instance behind', () => {
    const componentId = store().extractUIComponent(docId, slotId, 'Hotbar Slot');
    expect(componentId).toBeTruthy();

    const component = docById(componentId!);
    expect(component.isComponent).toBe(true);
    // Never auto-shown: a component is a building block, not a HUD.
    expect(component.visibleOnStart).toBe(false);
    expect(countKind(component.root, 'text')).toBe(1);

    // The host now holds a single instance where the subtree used to be.
    const host = docById(docId);
    expect(countKind(host.root, 'component')).toBe(1);
    expect(countKind(host.root, 'text')).toBe(0);
    const instance = host.root.children[0];
    expect(instance.componentId).toBe(componentId);
    // Placement is preserved so extracting does not move anything on screen.
    expect(instance.style.width).toBe('48px');
    expect(instance.className).toBe('slot');
  });

  it('refuses to extract a document root — that would just alias the document', () => {
    expect(store().extractUIComponent(docId, docById(docId).root.id)).toBeNull();
  });

  it('lets one component back many instances', () => {
    const componentId = store().extractUIComponent(docId, slotId, 'Hotbar Slot')!;
    for (let i = 0; i < 9; i += 1) expect(store().insertUIComponent(docId, undefined, componentId)).toBeTruthy();
    expect(countKind(docById(docId).root, 'component')).toBe(10);

    // One edit to the component is the edit for all ten — there is nothing to propagate.
    const textId = docById(componentId).root.children[0].id;
    store().updateUIElement(componentId, textId, { text: 'Q' });
    expect(find(docById(componentId).root, textId)!.text).toBe('Q');
    expect(countKind(docById(docId).root, 'text')).toBe(0);
  });

  it('gives each instance its own params without touching the component', () => {
    const componentId = store().extractUIComponent(docId, slotId, 'Slot')!;
    const second = store().insertUIComponent(docId, undefined, componentId)!;
    const first = docById(docId).root.children[0].id;

    store().setUIComponentParam(docId, first, 'label', '1');
    store().setUIComponentParam(docId, second, 'label', '2');
    expect(find(docById(docId).root, first)!.componentParams).toEqual({ label: '1' });
    expect(find(docById(docId).root, second)!.componentParams).toEqual({ label: '2' });

    store().setUIComponentParam(docId, second, 'label', '');
    expect(find(docById(docId).root, second)!.componentParams).toBeUndefined();
  });
});

describe('cycle safety', () => {
  beforeEach(() => useEditorStore.setState({ uiDocuments: [] }));

  it('refuses to instance a component inside itself', () => {
    const a = store().createUIComponent('A');
    expect(store().insertUIComponent(a, undefined, a)).toBeNull();
  });

  it('refuses an indirect cycle', () => {
    const a = store().createUIComponent('A');
    const b = store().createUIComponent('B');
    expect(store().insertUIComponent(a, undefined, b)).toBeTruthy();
    // B now sits inside A, so putting A inside B would recurse forever.
    expect(wouldCreateUICycle(b, a, store().uiDocuments)).toBe(true);
    expect(store().insertUIComponent(b, undefined, a)).toBeNull();
  });

  it('allows the same component twice in one document', () => {
    const host = store().createUIDocument('HUD', 'screen');
    const slot = store().createUIComponent('Slot');
    expect(store().insertUIComponent(host, undefined, slot)).toBeTruthy();
    expect(store().insertUIComponent(host, undefined, slot)).toBeTruthy();
  });
});

describe('deleting a component', () => {
  it('clears instances rather than leaving a dead reference', () => {
    useEditorStore.setState({ uiDocuments: [] });
    const host = store().createUIDocument('HUD', 'screen');
    const slot = store().createUIComponent('Slot');
    const instance = store().insertUIComponent(host, undefined, slot)!;

    store().deleteUIDocument(slot);
    expect(find(docById(host).root, instance)!.componentId).toBeUndefined();
  });
});

describe('sharing a component-based UI', () => {
  it('pulls referenced components into the package and remaps instances on import', () => {
    const component: UIDocument = {
      id: 'ui-slot', name: 'Slot', surface: 'screen', visibleOnStart: false, createdAt: 0, isComponent: true, folderId: 'f1',
      root: { id: 'c1', kind: 'panel', name: 'root', style: {}, bindings: [], children: [] },
    };
    const hud: UIDocument = {
      id: 'ui-hud', name: 'HUD', surface: 'screen', visibleOnStart: true, createdAt: 0, folderId: 'f1',
      root: {
        id: 'h1', kind: 'panel', name: 'root', style: {}, bindings: [],
        children: [{ id: 'h2', kind: 'component', name: 'Slot', componentId: 'ui-slot', componentParams: { label: '1' }, style: {}, bindings: [], children: [] }],
      },
    };
    const src = {
      prefabs: [], blueprints: [], graphs: [], materials: [], particleSystems: [], skeletons: [],
      skeletalMeshes: [], animations: [], animatorControllers: [], dataAssets: [], variables: [],
      uiDocuments: [hud, component], folders: [{ id: 'f1', name: 'Kit' }], assets: [],
    } as unknown as PackageSource;

    // Seeded with the HUD ONLY — the closure has to discover the component behind the instance.
    const collected = collectPackage(src, { uiDocuments: ['ui-hud'] });
    expect(collected.content.uiDocuments.map((d) => d.id).sort()).toEqual(['ui-hud', 'ui-slot']);

    const pkg = { content: collected.content, assets: [] } as unknown as NodeForgePackage;
    const imported = remapPackageForImport(pkg).content.uiDocuments;
    const importedHud = imported.find((d) => d.name === 'HUD')!;
    const importedSlot = imported.find((d) => d.name === 'Slot')!;
    const instance = importedHud.root.children[0];

    expect(instance.componentId).not.toBe('ui-slot');
    // The instance must follow its component to the NEW id, or it renders as "Missing component".
    expect(instance.componentId).toBe(importedSlot.id);
    expect(instance.componentParams).toEqual({ label: '1' });
  });
});
