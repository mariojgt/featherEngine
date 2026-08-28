import type { StoreApi } from 'zustand';
import type { EditorState } from '../editorStore';
import type {
  GraphValue,
  UIComponent,
  UIDocument,
  UIElement,
  UIElementKind,
  UIPresetKind,
  UISurface,
} from '../../types';
import {
  applyUIThemeToElement,
  clearUIComponentRefs,
  cloneUIElementFresh,
  defaultUIComponent,
  findUIElement,
  findUIParent,
  makeUIDocument,
  makeUIElement,
  makeUIPreset,
  makeUITemplate,
  mapUIElement,
  removeUIElementFromTree,
  replaceUIElementInTree,
  wouldCreateUICycle,
  type UITemplateKind,
  type UIThemeKind,
} from './ui';
import { makeId } from './ids';
import { mapActiveSceneObjects, selectActiveObjects } from './storeHelpers';
import { coerceGraphValue } from './graph';

type SetState = StoreApi<EditorState>['setState'];
type GetState = StoreApi<EditorState>['getState'];

/** Replace or extend a raw-CSS field. Blank input clears it so a stray empty string never persists. */
const mergeCss = (existing: string | undefined, css: string, mode: 'replace' | 'append'): string | undefined => {
  if (mode === 'append' && existing?.trim()) return css.trim() ? `${existing.trimEnd()}\n${css.trim()}` : existing;
  return css.trim() ? css : undefined;
};

export const applyCreateUIDocument = (
  set: SetState,
  get: GetState,
  name: string | undefined,
  surface: UISurface | undefined,
  folderId: string | undefined,
): string => {
  const docName = name ?? `UI ${get().uiDocuments.length + 1}`;
  const doc = makeUIDocument(docName, surface ?? 'screen', folderId);
  set((state) => ({
    uiDocuments: [...state.uiDocuments, doc],
    activeUIDocumentId: doc.id,
    isDirty: true,
  }));
  return doc.id;
};

export const applyCreateUIFromTemplate = (
  set: SetState,
  get: GetState,
  template: UITemplateKind,
  folderId: string | undefined,
): string => {
  const { doc, vars } = makeUITemplate(template);
  if (folderId) doc.folderId = folderId;
  set((state) => {
    // Auto-provision (only) the variables this template binds to but the project doesn't have yet,
    // so the HUD shows live data immediately instead of zeros that look broken.
    const existing = new Set(state.variables.map((variable) => variable.name));
    const created = vars
      .filter((variable) => !existing.has(variable.name))
      .map((variable) => ({
        id: makeId('var'),
        name: variable.name,
        type: variable.type ?? ('number' as const),
        defaultValue: variable.defaultValue,
        persistent: true,
        createdAt: Date.now(),
      }));
    return {
      uiDocuments: [...state.uiDocuments, doc],
      activeUIDocumentId: doc.id,
      selectedUIElementId: doc.root.id,
      variables: [...state.variables, ...created],
      isDirty: true,
    };
  });
  // Login template: seed a ready-to-run Logic graph so Sign In / Guest actually dismiss the screen.
  if (template === 'login') {
    const blueprintId = get().openUILogic(doc.id);
    const isLoggedIn = get().variables.find((v) => v.name === 'isLoggedIn');
    const loginError = get().variables.find((v) => v.name === 'loginError');
    const wireLogin = (eventName: string, y: number) => {
      const evt = get().addGraphNodeToBlueprint(blueprintId, 'Custom Event', 'Events', { eventName }, { x: 40, y });
      const setLogged = isLoggedIn
        ? get().addGraphNodeToBlueprint(
            blueprintId,
            'Set Variable',
            'Variables',
            { variableId: isLoggedIn.id, valueType: 'boolean', booleanValue: true },
            { x: 280, y },
          )
        : '';
      const clearErr = loginError
        ? get().addGraphNodeToBlueprint(
            blueprintId,
            'Set Variable',
            'Variables',
            { variableId: loginError.id, valueType: 'string', stringValue: '' },
            { x: 520, y },
          )
        : '';
      const hide = get().addGraphNodeToBlueprint(blueprintId, 'Hide UI', 'UI', { documentId: doc.id }, { x: 760, y });
      if (setLogged) get().connectGraphNodes(blueprintId, evt, setLogged);
      if (setLogged && clearErr) get().connectGraphNodes(blueprintId, setLogged, clearErr);
      const beforeHide = clearErr || setLogged;
      if (beforeHide) get().connectGraphNodes(blueprintId, beforeHide, hide);
      else get().connectGraphNodes(blueprintId, evt, hide);
    };
    wireLogin('loginPressed', 40);
    wireLogin('loginAsGuest', 220);
  }
  return doc.id;
};

export const applyUITheme = (set: SetState, docId: string, theme: UIThemeKind): void => {
  set((state) => ({
    uiDocuments: state.uiDocuments.map((doc) =>
      doc.id === docId ? { ...doc, root: applyUIThemeToElement(doc.root, theme) } : doc,
    ),
    isDirty: true,
  }));
};

export const applyRenameUIDocument = (set: SetState, id: string, name: string): void => {
  set((state) => ({
    uiDocuments: state.uiDocuments.map((doc) => (doc.id === id ? { ...doc, name } : doc)),
    isDirty: true,
  }));
};

export const applyUpdateUIDocument = (
  set: SetState,
  id: string,
  patch: Partial<Pick<UIDocument, 'name' | 'surface' | 'css' | 'visibleOnStart' | 'logicBlueprintId' | 'renderMode'>>,
): void => {
  set((state) => ({
    uiDocuments: state.uiDocuments.map((doc) => (doc.id === id ? { ...doc, ...patch } : doc)),
    isDirty: true,
  }));
};

export const applyDeleteUIDocument = (set: SetState, id: string): void => {
  set((state) => ({
    // Instances of a deleted component lose their reference rather than keeping a dead id: the
    // element then renders a visible "No component set" placeholder the author can act on.
    uiDocuments: state.uiDocuments
      .filter((doc) => doc.id !== id)
      .map((doc) => ({ ...doc, root: clearUIComponentRefs(doc.root, id) })),
    activeUIDocumentId:
      state.activeUIDocumentId === id ? state.uiDocuments.find((doc) => doc.id !== id)?.id ?? '' : state.activeUIDocumentId,
    // Clear dangling world-UI references so no object points at a removed document.
    scenes: state.scenes.map((scene) => ({
      ...scene,
      objects: scene.objects.map((object) =>
        object.ui?.documentId === id ? { ...object, ui: undefined } : object,
      ),
    })),
    isDirty: true,
  }));
};

export const applySetActiveUIDocument = (set: SetState, id: string): void => {
  set({ activeUIDocumentId: id, selectedUIElementId: '' });
};

export const applySelectUIElement = (set: SetState, id: string): void => {
  set({ selectedUIElementId: id });
};

export const applyOpenUILogic = (set: SetState, get: GetState, docId: string): string => {
  const state = get();
  const doc = state.uiDocuments.find((d) => d.id === docId);
  if (!doc) return '';
  // Reuse an existing logic blueprint if it's still around, else make one.
  let blueprintId = doc.logicBlueprintId && state.blueprints.some((b) => b.id === doc.logicBlueprintId) ? doc.logicBlueprintId : '';
  if (!blueprintId) {
    blueprintId = get().createBlueprintNamed(`${doc.name} Logic`, 'UI behaviour graph.').blueprintId;
    get().updateUIDocument(docId, { logicBlueprintId: blueprintId });
  }
  // Ensure something runs the graph: a tiny empty "UI Logic" object carrying this blueprint.
  const objects = selectActiveObjects(get());
  const hasController = objects.some((o) => o.script?.blueprintId === blueprintId);
  if (!hasController) {
    const objectId = get().createObjectWithProps('empty', { name: `${doc.name} UI Logic` });
    get().attachScript(objectId, blueprintId);
  }
  get().setActiveBlueprint(blueprintId);
  return blueprintId;
};

export const applyAddUIElement = (
  set: SetState,
  docId: string,
  parentId: string | undefined,
  kind: UIElementKind,
): string => {
  const element = makeUIElement(kind);
  set((state) => ({
    uiDocuments: state.uiDocuments.map((doc) => {
      if (doc.id !== docId) return doc;
      const targetId = parentId ?? doc.root.id;
      return { ...doc, root: mapUIElement(doc.root, targetId, (el) => ({ ...el, children: [...el.children, element] })) };
    }),
    isDirty: true,
  }));
  return element.id;
};

export const applyUpdateUIElement = (
  set: SetState,
  docId: string,
  elementId: string,
  patch: Partial<Omit<UIElement, 'id' | 'children'>>,
): void => {
  set((state) => ({
    uiDocuments: state.uiDocuments.map((doc) =>
      doc.id === docId ? { ...doc, root: mapUIElement(doc.root, elementId, (el) => ({ ...el, ...patch })) } : doc,
    ),
    isDirty: true,
  }));
};

export const applyRemoveUIElement = (set: SetState, docId: string, elementId: string): void => {
  set((state) => ({
    uiDocuments: state.uiDocuments.map((doc) =>
      // Never remove the root element.
      doc.id === docId && doc.root.id !== elementId ? { ...doc, root: removeUIElementFromTree(doc.root, elementId) } : doc,
    ),
    isDirty: true,
  }));
};

export const applySetUIDocumentCss = (set: SetState, docId: string, css: string, mode: 'replace' | 'append' = 'replace'): void => {
  set((state) => ({
    uiDocuments: state.uiDocuments.map((doc) => (doc.id === docId ? { ...doc, css: mergeCss(doc.css, css, mode) } : doc)),
    isDirty: true,
  }));
};

export const applySetUIElementCss = (
  set: SetState,
  docId: string,
  elementId: string,
  css: string,
  mode: 'replace' | 'append' = 'replace',
): void => {
  set((state) => ({
    uiDocuments: state.uiDocuments.map((doc) =>
      doc.id === docId ? { ...doc, root: mapUIElement(doc.root, elementId, (el) => ({ ...el, css: mergeCss(el.css, css, mode) })) } : doc,
    ),
    isDirty: true,
  }));
};

export const applyCreateUIComponent = (set: SetState, name: string | undefined, folderId: string | undefined): string => {
  const doc = makeUIDocument(name ?? 'Component', 'screen', folderId);
  // A component is composed into other documents, never shown on its own.
  const component: UIDocument = { ...doc, isComponent: true, visibleOnStart: false };
  set((state) => ({ uiDocuments: [...state.uiDocuments, component], isDirty: true }));
  return component.id;
};

export const applyExtractUIComponent = (
  set: SetState,
  get: GetState,
  docId: string,
  elementId: string,
  name: string | undefined,
): string | null => {
  const state = get();
  const doc = state.uiDocuments.find((d) => d.id === docId);
  if (!doc) return null;
  const subtree = findUIElement(doc.root, elementId);
  // The root IS the document — extracting it would just alias the whole thing.
  if (!subtree || subtree.id === doc.root.id) return null;

  // The component's own root wraps the subtree, so the component can grow siblings later
  // without every instance having to change shape.
  const componentRoot: UIElement = {
    ...makeUIElement('panel', name ?? subtree.name),
    style: { display: 'flex', flexDirection: 'column' },
    children: [cloneUIElementFresh(subtree)],
  };
  const component: UIDocument = {
    ...makeUIDocument(name ?? subtree.name, doc.surface, doc.folderId),
    isComponent: true,
    visibleOnStart: false,
    root: componentRoot,
  };
  // The instance keeps the original's placement (anchor/position) so nothing moves on screen.
  const instance: UIElement = {
    ...makeUIElement('component', name ?? subtree.name),
    componentId: component.id,
    className: subtree.className,
    style: subtree.anchor ? {} : { ...subtree.style },
    anchor: subtree.anchor,
  };
  set((s) => ({
    uiDocuments: [
      ...s.uiDocuments.map((d) => (d.id === docId ? { ...d, root: replaceUIElementInTree(d.root, elementId, instance) } : d)),
      component,
    ],
    selectedUIElementId: instance.id,
    isDirty: true,
  }));
  return component.id;
};

export const applyInsertUIComponent = (
  set: SetState,
  get: GetState,
  docId: string,
  parentId: string | undefined,
  componentId: string,
): string | null => {
  const state = get();
  if (docId === componentId || wouldCreateUICycle(docId, componentId, state.uiDocuments)) return null;
  const source = state.uiDocuments.find((d) => d.id === componentId);
  if (!source) return null;
  const instance: UIElement = { ...makeUIElement('component', source.name), componentId };
  set((s) => ({
    uiDocuments: s.uiDocuments.map((doc) => {
      if (doc.id !== docId) return doc;
      const targetId = parentId ?? doc.root.id;
      return { ...doc, root: mapUIElement(doc.root, targetId, (el) => ({ ...el, children: [...el.children, instance] })) };
    }),
    isDirty: true,
  }));
  return instance.id;
};

export const applySetUIComponentParam = (set: SetState, docId: string, elementId: string, key: string, value: string): void => {
  set((state) => ({
    uiDocuments: state.uiDocuments.map((doc) =>
      doc.id === docId
        ? {
            ...doc,
            root: mapUIElement(doc.root, elementId, (el) => {
              const params = { ...(el.componentParams ?? {}) };
              if (value.trim()) params[key] = value;
              else delete params[key];
              return { ...el, componentParams: Object.keys(params).length ? params : undefined };
            }),
          }
        : doc,
    ),
    isDirty: true,
  }));
};

export const applySetUIBinding = (
  set: SetState,
  docId: string,
  elementId: string,
  target: UIElement['bindings'][number]['target'],
  expression: string,
): void => {
  set((state) => ({
    uiDocuments: state.uiDocuments.map((doc) => {
      if (doc.id !== docId) return doc;
      return {
        ...doc,
        root: mapUIElement(doc.root, elementId, (el) => {
          const rest = el.bindings.filter((b) => b.target !== target);
          const bindings = expression.trim() ? [...rest, { target, expression }] : rest;
          return { ...el, bindings };
        }),
      };
    }),
    isDirty: true,
  }));
};

export const applyAddUIPreset = (
  set: SetState,
  get: GetState,
  docId: string,
  parentId: string | undefined,
  preset: UIPresetKind,
  options: { variableName?: string } | undefined,
): string => {
  // Data-bound presets reference a variable BY NAME; make sure it exists (create a number var if not).
  let variableName = options?.variableName ?? (preset === 'healthBar' ? 'health' : preset === 'counter' ? 'score' : '');
  if ((preset === 'healthBar' || preset === 'counter') && variableName) {
    const existing = get().variables.find((v) => v.name === variableName);
    if (!existing) {
      const id = get().createVariable(variableName, 'number', false);
      // Health defaults to 100 so the preview bar starts full.
      get().updateVariable(id, { defaultValue: preset === 'healthBar' ? 100 : 0 });
      variableName = get().variables.find((v) => v.id === id)?.name ?? variableName;
    }
  }
  const subtree = makeUIPreset(preset, variableName);
  set((state) => ({
    uiDocuments: state.uiDocuments.map((doc) => {
      if (doc.id !== docId) return doc;
      const targetId = parentId ?? doc.root.id;
      return { ...doc, root: mapUIElement(doc.root, targetId, (el) => ({ ...el, children: [...el.children, subtree] })) };
    }),
    isDirty: true,
  }));
  return subtree.id;
};

export const applyMoveUIElement = (set: SetState, docId: string, elementId: string, dir: 'up' | 'down'): void => {
  set((state) => ({
    uiDocuments: state.uiDocuments.map((doc) => {
      if (doc.id !== docId) return doc;
      const parent = findUIParent(doc.root, elementId);
      if (!parent) return doc; // root can't move
      const index = parent.children.findIndex((c) => c.id === elementId);
      const swap = dir === 'up' ? index - 1 : index + 1;
      if (swap < 0 || swap >= parent.children.length) return doc;
      const reordered = [...parent.children];
      [reordered[index], reordered[swap]] = [reordered[swap], reordered[index]];
      return { ...doc, root: mapUIElement(doc.root, parent.id, (el) => ({ ...el, children: reordered })) };
    }),
    isDirty: true,
  }));
};

export const applyDuplicateUIElement = (set: SetState, get: GetState, docId: string, elementId: string): string => {
  const doc = get().uiDocuments.find((d) => d.id === docId);
  const original = doc ? findUIElement(doc.root, elementId) : undefined;
  if (!doc || !original || doc.root.id === elementId) return elementId; // never duplicate the root
  const clone = cloneUIElementFresh(original);
  set((state) => ({
    uiDocuments: state.uiDocuments.map((d) => {
      if (d.id !== docId) return d;
      const parent = findUIParent(d.root, elementId);
      if (!parent) return d;
      const index = parent.children.findIndex((c) => c.id === elementId);
      const next = [...parent.children];
      next.splice(index + 1, 0, clone);
      return { ...d, root: mapUIElement(d.root, parent.id, (el) => ({ ...el, children: next })) };
    }),
    isDirty: true,
  }));
  return clone.id;
};

export const applyAttachUI = (set: SetState, objectId: string, documentId: string): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) =>
        object.id === objectId ? { ...object, ui: { ...defaultUIComponent(documentId), ...object.ui, documentId } } : object,
      ),
    ),
  );
};

export const applyDetachUI = (set: SetState, objectId: string): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) => (object.id === objectId ? { ...object, ui: undefined } : object)),
    ),
  );
};

export const applyUpdateUIComponent = (set: SetState, objectId: string, patch: Partial<UIComponent>): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) =>
        object.id === objectId && object.ui ? { ...object, ui: { ...object.ui, ...patch } } : object,
      ),
    ),
  );
};

export const applySetObjectVariable = (set: SetState, objectId: string, key: string, value: GraphValue): void => {
  set((state) =>
    mapActiveSceneObjects(state, (objects) =>
      objects.map((object) =>
        object.id === objectId ? { ...object, variables: { ...(object.variables ?? {}), [key]: value } } : object,
      ),
    ),
  );
};

export const applyShowUI = (set: SetState, docId: string): void => {
  set((state) => ({ runtimeVisibleUI: { ...state.runtimeVisibleUI, [docId]: true } }));
};

export const applyHideUI = (set: SetState, docId: string): void => {
  set((state) => ({ runtimeVisibleUI: { ...state.runtimeVisibleUI, [docId]: false } }));
};

export const applySetUIText = (set: SetState, docId: string, elementId: string, text: string): void => {
  set((state) => ({ runtimeUITextOverrides: { ...state.runtimeUITextOverrides, [`${docId}:${elementId}`]: text } }));
};

export const applySetUIElementVisible = (set: SetState, docId: string, elementId: string, visible: boolean): void => {
  set((state) => ({
    runtimeUIVisibleOverrides: { ...state.runtimeUIVisibleOverrides, [`${docId}:${elementId}`]: visible },
  }));
};

export const applySetRuntimeVariableByName = (set: SetState, name: string, value: GraphValue): void => {
  set((state) => {
    if (!state.isPlaying) return {};
    const variable = state.variables.find((v) => v.name === name);
    if (!variable) return {};
    return {
      runtimeVariableValues: {
        ...state.runtimeVariableValues,
        [variable.id]: coerceGraphValue(value, variable.type),
      },
    };
  });
};
