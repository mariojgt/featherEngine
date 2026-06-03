import type { UIDocument, UIComponent, UIElement, UIElementKind, UIPresetKind, UISurface } from '../../types';

import { makeId } from './ids';

// --- Game UI helpers -------------------------------------------------------
/** A blank element of a given kind, with sensible default styling per kind. */
export const makeUIElement = (kind: UIElementKind, name?: string): UIElement => {
  const base: UIElement = {
    id: makeId('uiel'),
    kind,
    name: name ?? kind.charAt(0).toUpperCase() + kind.slice(1),
    style: {},
    bindings: [],
    children: [],
  };
  if (kind === 'panel') base.style = { display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px' };
  if (kind === 'text' || kind === 'button') base.text = kind === 'button' ? 'Button' : 'Text';
  if (kind === 'bar') base.style = { width: '160px', height: '16px', background: '#23262F', borderRadius: '8px' };
  if (kind === 'button') base.style = { padding: '6px 12px', background: '#5B8CFF', color: '#fff', borderRadius: '8px' };
  return base;
};

const UI_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const quoteUIExpressionString = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export const uiVariableRef = (name: string) => (UI_IDENTIFIER_RE.test(name) ? name : `vars[${quoteUIExpressionString(name)}]`);

/** A fresh UI document with a root panel. Screen docs anchor top-left by default. */
export const makeUIDocument = (name: string, surface: UISurface, folderId?: string): UIDocument => {
  const root = makeUIElement('panel', 'Root');
  if (surface === 'screen') root.anchor = { h: 'left', v: 'top', offsetX: 16, offsetY: 16 };
  return {
    id: makeId('ui'),
    name,
    surface,
    root,
    css: '',
    visibleOnStart: true,
    folderId,
    createdAt: Date.now(),
  };
};

/** Depth-first search for an element by id within a tree. */
export const findUIElement = (root: UIElement, id: string): UIElement | undefined => {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findUIElement(child, id);
    if (found) return found;
  }
  return undefined;
};

/** Return a new tree with `fn` applied to the element matching `id` (immutable). */
export const mapUIElement = (root: UIElement, id: string, fn: (el: UIElement) => UIElement): UIElement => {
  if (root.id === id) return fn(root);
  return { ...root, children: root.children.map((child) => mapUIElement(child, id, fn)) };
};

/** Return a new tree with the element matching `id` removed (root is never removed). */
export const removeUIElementFromTree = (root: UIElement, id: string): UIElement => ({
  ...root,
  children: root.children.filter((child) => child.id !== id).map((child) => removeUIElementFromTree(child, id)),
});

/** Deep-clone an element subtree with fresh ids (for duplicate / preset insertion). */
export const cloneUIElementFresh = (element: UIElement): UIElement => ({
  ...element,
  id: makeId('uiel'),
  style: { ...element.style },
  bindings: element.bindings.map((b) => ({ ...b })),
  children: element.children.map(cloneUIElementFresh),
});

/** Find the parent element of `childId` (or undefined if it's the root / not found). */
export const findUIParent = (root: UIElement, childId: string): UIElement | undefined => {
  for (const child of root.children) {
    if (child.id === childId) return root;
    const found = findUIParent(child, childId);
    if (found) return found;
  }
  return undefined;
};

export const defaultUIComponent = (documentId: string): UIComponent => ({
  documentId,
  offset: [0, 1.5, 0],
  scale: 1,
  billboard: true,
});

/**
 * Build a preset widget subtree (returned root not yet inserted). Presets that show live data set a
 * binding referencing `variableName` BY NAME — the caller ensures that project variable exists.
 */
export const makeUIPreset = (preset: UIPresetKind, variableName: string): UIElement => {
  const variableExpression = uiVariableRef(variableName);
  switch (preset) {
    case 'healthBar': {
      const container = makeUIElement('panel', 'Health Bar');
      container.style = { display: 'flex', flexDirection: 'column', gap: '4px', width: '200px' };
      const label = makeUIElement('text', 'Label');
      label.text = 'Health';
      label.style = { color: '#ffffff', fontSize: '12px', fontWeight: '600' };
      const bar = makeUIElement('bar', 'Bar');
      bar.style = { width: '200px', height: '16px', background: '#23262F', borderRadius: '8px' };
      bar.bindings = [{ target: 'fill', expression: `${variableExpression} / 100` }];
      container.children = [label, bar];
      return container;
    }
    case 'counter': {
      const text = makeUIElement('text', 'Counter');
      text.text = '0';
      text.style = { color: '#ffffff', fontSize: '20px', fontWeight: '700' };
      text.bindings = [{ target: 'text', expression: variableExpression }];
      return text;
    }
    case 'label': {
      const text = makeUIElement('text', 'Label');
      text.text = 'Label';
      text.style = { color: '#ffffff', fontSize: '14px' };
      return text;
    }
    case 'button': {
      const button = makeUIElement('button', 'Button');
      button.text = 'Click';
      button.onClickEvent = 'buttonClick';
      button.style = { padding: '8px 16px', background: '#5B8CFF', color: '#fff', borderRadius: '8px', fontWeight: '600' };
      return button;
    }
    case 'image': {
      const image = makeUIElement('image', 'Image');
      image.style = { width: '64px', height: '64px' };
      return image;
    }
    case 'panel':
    default: {
      const panel = makeUIElement('panel', 'Panel');
      panel.style = { display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px', background: 'rgba(15,17,23,0.6)', borderRadius: '8px' };
      return panel;
    }
  }
};
