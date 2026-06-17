import type { UIAnchor, UIDocument, UIComponent, UIElement, UIElementKind, UIPresetKind, UIStyle, UISurface } from '../../types';

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
  if (kind === 'scroll')
    base.style = {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      padding: '8px',
      width: '220px',
      height: '200px',
      background: 'rgba(15,17,23,0.5)',
      borderRadius: '8px',
    };
  if (kind === 'text' || kind === 'button') base.text = kind === 'button' ? 'Button' : 'Text';
  if (kind === 'bar') base.style = { width: '160px', height: '16px', background: '#23262F', borderRadius: '8px' };
  if (kind === 'button') {
    base.style = { padding: '6px 12px', background: '#5B8CFF', color: '#fff', borderRadius: '8px' };
    // A subtle default hover/press feel so new buttons react out of the box.
    base.states = { hover: { background: '#6f9bff' }, active: { background: '#4a78e6' }, disabled: { opacity: 0.45 } };
  }
  if (kind === 'input') {
    base.placeholder = 'Type here…';
    base.style = { width: '200px', padding: '8px 10px', background: 'rgba(15,17,23,0.9)', color: '#fff', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '8px', fontSize: '14px' };
  }
  if (kind === 'toggle') {
    base.text = 'Toggle';
    base.style = { padding: '8px 12px', background: 'rgba(15,17,23,0.9)', color: '#fff', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '8px', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' };
  }
  if (kind === 'slider') {
    base.min = 0;
    base.max = 100;
    base.step = 1;
    base.style = { width: '200px', height: '20px' };
  }
  if (kind === 'dropdown') {
    base.options = ['Option A', 'Option B', 'Option C'];
    base.style = { width: '200px', padding: '8px 10px', background: 'rgba(15,17,23,0.9)', color: '#fff', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '8px', fontSize: '14px' };
  }
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

// --- Full HUD / menu templates --------------------------------------------
// One click drops in a complete, good-looking, data-bound screen — instead of assembling widgets
// element by element. Each returns a whole document plus the project variables it binds to (created
// by the store if missing) so it works out of the box.
export type UITemplateKind = 'shooter' | 'platformer' | 'racing' | 'pauseMenu' | 'gameOver' | 'settings';

export const UI_TEMPLATES: Array<{ kind: UITemplateKind; label: string; blurb: string }> = [
  { kind: 'shooter', label: 'Shooter HUD', blurb: 'Health · ammo · score · crosshair' },
  { kind: 'platformer', label: 'Platformer HUD', blurb: 'Lives · score · coins' },
  { kind: 'racing', label: 'Racing HUD', blurb: 'Speed · lap · position' },
  { kind: 'pauseMenu', label: 'Pause Menu', blurb: 'Resume · Restart · Quit' },
  { kind: 'gameOver', label: 'Game Over', blurb: 'Score readout · Retry' },
  { kind: 'settings', label: 'Settings Menu', blurb: 'Volume · difficulty · toggle · name' },
];

export type UITemplateVar = { name: string; defaultValue: number | string | boolean; type?: 'number' | 'string' | 'boolean' };
export type UITemplateResult = { doc: UIDocument; vars: UITemplateVar[] };

const anchor = (el: UIElement, h: UIAnchor['h'], v: UIAnchor['v'], offsetX = 24, offsetY = 22): UIElement => {
  el.anchor = { h, v, offsetX, offsetY };
  return el;
};

const text = (name: string, content: string, style: UIElement['style'], expression?: string): UIElement => {
  const el = makeUIElement('text', name);
  el.text = content;
  el.style = style;
  if (expression) el.bindings = [{ target: 'text', expression }];
  return el;
};

const menuButton = (label: string, event: string): UIElement => {
  const button = makeUIElement('button', label);
  button.text = label;
  button.onClickEvent = event;
  button.style = { padding: '12px 18px', background: '#5B8CFF', color: '#fff', borderRadius: '10px', fontWeight: '700', fontSize: '15px', textAlign: 'center' };
  return button;
};

/** Build a complete UI document from a template, plus the variables it expects to exist. */
export const makeUITemplate = (kind: UITemplateKind): UITemplateResult => {
  switch (kind) {
    case 'shooter': {
      const doc = makeUIDocument('Shooter HUD', 'screen');
      doc.root.style = {};
      const health = makeUIElement('panel', 'Health');
      health.style = { display: 'flex', flexDirection: 'column', gap: '4px', width: '220px' };
      const hLabel = text('Label', 'HEALTH', { color: '#fff', fontSize: '11px', fontWeight: '700', custom: { letterSpacing: '0.08em' } });
      const hBar = makeUIElement('bar', 'Bar');
      hBar.style = { width: '220px', height: '18px', background: 'rgba(0,0,0,0.45)', borderRadius: '9px' };
      hBar.bindings = [{ target: 'fill', expression: 'health / 100' }];
      health.children = [hLabel, hBar];
      const ammo = text('Ammo', '30', { color: '#fff', fontSize: '34px', fontWeight: '800' }, 'ammo');
      const score = text('Score', 'Score: 0', { color: '#fff', fontSize: '18px', fontWeight: '700' }, "'Score: ' + score");
      const crosshair = makeUIElement('panel', 'Crosshair');
      crosshair.style = { width: '8px', height: '8px', background: 'rgba(255,255,255,0.85)', borderRadius: '50%' };
      doc.root.children = [anchor(health, 'left', 'bottom'), anchor(ammo, 'right', 'bottom', 30, 20), anchor(score, 'right', 'top'), anchor(crosshair, 'center', 'middle', 0, 0)];
      return { doc, vars: [{ name: 'health', defaultValue: 100 }, { name: 'ammo', defaultValue: 30 }, { name: 'score', defaultValue: 0 }] };
    }
    case 'platformer': {
      const doc = makeUIDocument('Platformer HUD', 'screen');
      doc.root.style = {};
      const lives = text('Lives', 'Lives: 3', { color: '#fff', fontSize: '18px', fontWeight: '700' }, "'Lives: ' + lives");
      const score = text('Score', 'Score: 0', { color: '#fff', fontSize: '20px', fontWeight: '800' }, "'Score: ' + score");
      const coins = text('Coins', 'Coins: 0', { color: '#ffd34d', fontSize: '18px', fontWeight: '700' }, "'Coins: ' + coins");
      doc.root.children = [anchor(lives, 'left', 'top'), anchor(score, 'center', 'top'), anchor(coins, 'right', 'top')];
      return { doc, vars: [{ name: 'lives', defaultValue: 3 }, { name: 'score', defaultValue: 0 }, { name: 'coins', defaultValue: 0 }] };
    }
    case 'racing': {
      const doc = makeUIDocument('Racing HUD', 'screen');
      doc.root.style = {};
      const speed = text('Speed', '0 km/h', { color: '#fff', fontSize: '36px', fontWeight: '900' }, "speed + ' km/h'");
      const lap = text('Lap', 'Lap 1', { color: '#fff', fontSize: '18px', fontWeight: '700' }, "'Lap ' + lap");
      const position = text('Position', 'P1', { color: '#fff', fontSize: '22px', fontWeight: '800' }, "'P' + position");
      doc.root.children = [anchor(speed, 'right', 'bottom', 30, 24), anchor(lap, 'left', 'top'), anchor(position, 'right', 'top')];
      return { doc, vars: [{ name: 'speed', defaultValue: 0 }, { name: 'lap', defaultValue: 1 }, { name: 'position', defaultValue: 1 }] };
    }
    case 'pauseMenu': {
      const doc = makeUIDocument('Pause Menu', 'screen');
      doc.visibleOnStart = false;
      doc.root.style = { background: 'rgba(5,7,11,0.6)' };
      const menu = makeUIElement('panel', 'Menu');
      menu.style = { display: 'flex', flexDirection: 'column', gap: '12px', padding: '28px 32px', background: 'rgba(17,20,28,0.96)', borderRadius: '16px', custom: { minWidth: '260px' } };
      const title = text('Title', 'Paused', { color: '#fff', fontSize: '26px', fontWeight: '800', textAlign: 'center' });
      menu.children = [title, menuButton('Resume', 'resumeGame'), menuButton('Restart', 'restartGame'), menuButton('Quit', 'quitGame')];
      doc.root.children = [anchor(menu, 'center', 'middle', 0, 0)];
      return { doc, vars: [] };
    }
    case 'settings': {
      const doc = makeUIDocument('Settings Menu', 'screen');
      doc.visibleOnStart = false;
      doc.root.style = { background: 'rgba(5,7,11,0.6)' };
      const card = makeUIElement('panel', 'Card');
      card.style = { display: 'flex', flexDirection: 'column', gap: '14px', padding: '28px 32px', background: 'rgba(17,20,28,0.96)', borderRadius: '16px', custom: { minWidth: '320px', boxShadow: '0 18px 52px rgba(0,0,0,0.45)' } };
      card.animation = { type: 'pop', duration: 0.3 };
      const title = text('Title', 'Settings', { color: '#fff', fontSize: '24px', fontWeight: '800', textAlign: 'center' });

      // A labelled control row (label on the left, control on the right).
      const row = (name: string, label: string, control: UIElement): UIElement => {
        const r = makeUIElement('panel', name);
        r.style = { display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: '16px' };
        const l = text('Label', label, { color: '#cdd5e3', fontSize: '14px', fontWeight: '600' });
        r.children = [l, control];
        return r;
      };

      const volume = makeUIElement('slider', 'Volume');
      volume.valueVariable = 'volume';
      volume.min = 0;
      volume.max = 100;
      volume.style = { width: '180px', height: '20px', color: '#5B8CFF' };

      const difficulty = makeUIElement('dropdown', 'Difficulty');
      difficulty.valueVariable = 'difficulty';
      difficulty.options = ['Easy', 'Normal', 'Hard'];
      difficulty.style = { width: '180px', padding: '8px 10px', background: 'rgba(10,12,18,0.9)', color: '#fff', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '8px' };

      const fullscreen = makeUIElement('toggle', 'Fullscreen');
      fullscreen.valueVariable = 'fullscreen';
      fullscreen.text = '';
      fullscreen.style = { color: '#5B8CFF' };

      const name = makeUIElement('input', 'Player Name');
      name.valueVariable = 'playerName';
      name.placeholder = 'Player 1';
      name.style = { width: '180px', padding: '8px 10px', background: 'rgba(10,12,18,0.9)', color: '#fff', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '8px' };

      const back = menuButton('Back', 'closeSettings');
      card.children = [title, row('VolumeRow', 'Volume', volume), row('DifficultyRow', 'Difficulty', difficulty), row('FullscreenRow', 'Fullscreen', fullscreen), row('NameRow', 'Name', name), back];
      doc.root.children = [anchor(card, 'center', 'middle', 0, 0)];
      return {
        doc,
        vars: [
          { name: 'volume', defaultValue: 80, type: 'number' },
          { name: 'difficulty', defaultValue: 'Normal', type: 'string' },
          { name: 'fullscreen', defaultValue: true, type: 'boolean' },
          { name: 'playerName', defaultValue: 'Player 1', type: 'string' },
        ],
      };
    }
    case 'gameOver':
    default: {
      const doc = makeUIDocument('Game Over', 'screen');
      doc.visibleOnStart = false;
      doc.root.style = { background: 'rgba(5,7,11,0.72)' };
      const card = makeUIElement('panel', 'Card');
      card.style = { display: 'flex', flexDirection: 'column', gap: '14px', padding: '30px 36px', background: 'rgba(17,20,28,0.96)', borderRadius: '16px', alignItems: 'center', custom: { minWidth: '280px' } };
      const title = text('Title', 'Game Over', { color: '#ff6b6b', fontSize: '30px', fontWeight: '900' });
      const score = text('Score', 'Score: 0', { color: '#fff', fontSize: '18px' }, "'Score: ' + score");
      card.children = [title, score, menuButton('Retry', 'restartGame')];
      doc.root.children = [anchor(card, 'center', 'middle', 0, 0)];
      return { doc, vars: [{ name: 'score', defaultValue: 0 }] };
    }
  }
};

// --- One-click visual themes (skins) --------------------------------------
// Restyle a whole UI document's LOOK (colours, borders, glow, fonts) in one click while preserving
// LAYOUT (size/position/anchor/flex/padding/fontSize). Pairs with the HUD templates: template = shape
// + data, theme = style. Patches are merged per element KIND so any tree restyles consistently.
export type UIThemeKind = 'sciFi' | 'minimal' | 'arcade';

export const UI_THEMES: Array<{ kind: UIThemeKind; label: string; blurb: string }> = [
  { kind: 'sciFi', label: 'Sci-Fi', blurb: 'Neon cyan glow, mono type' },
  { kind: 'minimal', label: 'Minimal', blurb: 'Clean glass, soft edges' },
  { kind: 'arcade', label: 'Arcade', blurb: 'Bold, chunky, high-contrast' },
];

/** Visual-only style patch for an element kind under a theme (merged over its existing style). */
export const uiThemeStyleFor = (theme: UIThemeKind, kind: UIElementKind): Partial<UIStyle> => {
  const themes: Record<UIThemeKind, Partial<Record<UIElementKind | 'default', Partial<UIStyle>>>> = {
    sciFi: {
      panel: { background: 'rgba(10,20,30,0.72)', border: '1px solid rgba(90,220,255,0.35)', borderRadius: '6px', custom: { boxShadow: '0 0 18px rgba(90,220,255,0.18)', backdropFilter: 'blur(6px)' } },
      scroll: { background: 'rgba(10,20,30,0.72)', border: '1px solid rgba(90,220,255,0.35)', borderRadius: '6px' },
      text: { color: '#dff7ff', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', custom: { textShadow: '0 0 8px rgba(90,220,255,0.45)' } },
      button: { background: 'rgba(90,220,255,0.16)', color: '#dff7ff', border: '1px solid rgba(90,220,255,0.55)', borderRadius: '6px' },
      bar: { background: 'rgba(5,12,20,0.75)', border: '1px solid rgba(90,220,255,0.4)', borderRadius: '6px' },
    },
    minimal: {
      panel: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', custom: { boxShadow: 'none', backdropFilter: 'blur(10px)' } },
      scroll: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' },
      text: { color: '#f3f4f6', fontFamily: 'Inter, system-ui, sans-serif', custom: { textShadow: 'none' } },
      button: { background: 'rgba(255,255,255,0.12)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.18)', borderRadius: '10px' },
      bar: { background: 'rgba(255,255,255,0.14)', border: 'none', borderRadius: '999px' },
    },
    arcade: {
      panel: { background: '#1b0f2e', border: '3px solid #ff3d8b', borderRadius: '14px', custom: { boxShadow: '0 6px 0 rgba(0,0,0,0.4)', backdropFilter: 'none' } },
      scroll: { background: '#1b0f2e', border: '3px solid #ff3d8b', borderRadius: '14px' },
      text: { color: '#ffe14d', fontWeight: '800', custom: { textShadow: '2px 2px 0 rgba(0,0,0,0.5)' } },
      button: { background: '#ff8a3d', color: '#1b0f2e', border: '3px solid #ffe14d', borderRadius: '10px', fontWeight: '800' },
      bar: { background: '#2a1840', border: '2px solid #ffe14d', borderRadius: '8px' },
    },
  };
  return themes[theme][kind] ?? themes[theme].default ?? {};
};

/** Merge a theme's style over an element's existing style (custom keys merged, layout preserved). */
export const applyUIThemeToElement = (element: UIElement, theme: UIThemeKind): UIElement => {
  const patch = uiThemeStyleFor(theme, element.kind);
  const merged: UIStyle = { ...element.style, ...patch };
  if (patch.custom) merged.custom = { ...element.style.custom, ...patch.custom };
  return { ...element, style: merged, children: element.children.map((child) => applyUIThemeToElement(child, theme)) };
};
