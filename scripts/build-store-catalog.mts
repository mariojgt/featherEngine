#!/usr/bin/env node
/**
 * Builds the bundled asset-store catalog: a set of `.nfpack` packages plus the `catalog.json`
 * index that the Asset Store panel reads.
 *
 * The packages here are authored the same way an outside publisher would author them — plain data,
 * so this script doubles as the reference for what an upload must look like.
 * Output is byte-stable (fixed ids and timestamps) so rebuilding doesn't churn git.
 *
 * Run: npm run build:store  (vite-node, so it can share the container code in src/)
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Run through vite-node so the container format has ONE implementation. A hand-rolled copy of the
// zip layout here would drift from the engine's reader the first time either changed.
import { readPackageFile, writePackageArchive } from '../src/project/packageArchive';
// UI captured from the shipped builds of rpgMania and MomentumCup by scripts/uikit/capture.mjs.
// Kept as data so this catalog stays byte-stable — re-running the capture is a deliberate act, not
// a side effect of building the store.
import uiKits from '../src/store-assets/uiKits.json';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'store');
const PACKAGES_DIR = join(OUT_DIR, 'packages');

/** Subfolder per package kind — see PackageKind in src/project/package.ts. */
const KIND_DIRS = { project: 'projects', asset: 'assets', plugin: 'plugins' } as const;

const PACKAGE_FORMAT = 'nodeforge-package';
const PACKAGE_VERSION = '1.0.0';
const ENGINE_VERSION = '0.8.0'; // PROJECT_VERSION in src/types/project.ts
const CATALOG_FORMAT = 'feather-store-catalog';
/** Fixed so regenerating the catalog produces identical bytes. */
const EPOCH = Date.parse('2026-01-01T00:00:00.000Z');
const ISO = new Date(EPOCH).toISOString();

// ------------------------------------------------------------------------------------------------
// Authoring helpers — the minimum valid shape of each entity (see src/types/).
// ------------------------------------------------------------------------------------------------

const transform = (position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) => ({
  position,
  rotation,
  scale,
});

const renderer = (mesh, { color = '#5B8CFF', materialId, metalness = 0.1, roughness = 0.65 } = {}) => ({
  enabled: true,
  mesh,
  color,
  metalness,
  roughness,
  ...(materialId ? { materialId } : {}),
});

/** A scene object inside a prefab. Ids are prefab-local; every install re-ids them. */
const object = (id, name, kind, opts = {}) => ({
  id,
  name,
  kind,
  transform: transform(opts.position, opts.rotation, opts.scale),
  ...(kind === 'empty' ? {} : { renderer: renderer(kind, opts) }),
  ...(opts.parentId ? { parentId: opts.parentId } : {}),
  ...(opts.physics ? { physics: physics(opts.physics) } : {}),
});

const physics = ({ bodyType = 'dynamic', collider = 'box', mass = 1 } = {}) => ({
  enabled: true,
  bodyType,
  collider,
  materialPreset: 'default',
  isTrigger: false,
  collisionLayer: 0,
  collisionMask: 0xffff,
  mass,
  gravityScale: 1,
  friction: 0.6,
  restitution: 0.05,
  linearDamping: 0,
  angularDamping: 0.05,
  windInfluence: 0,
});

const material = (id, name, props) => ({
  id,
  name,
  description: 'Reusable material asset.',
  color: '#5B8CFF',
  metalness: 0.1,
  roughness: 0.65,
  emissiveColor: '#000000',
  emissiveIntensity: 0,
  createdAt: EPOCH,
  ...props,
});

const prefab = (id, name, objects) => ({
  id,
  name,
  objects,
  rootId: objects[0].id,
  createdAt: EPOCH,
});

/** A flat-gradient SVG card used as the store thumbnail — keeps the catalog binary-free. */
const thumbnail = (from, to, glyph) => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
    `</linearGradient></defs>` +
    `<rect width="128" height="128" rx="16" fill="url(#g)"/>` +
    `<text x="64" y="82" font-family="system-ui,sans-serif" font-size="56" font-weight="700" ` +
    `text-anchor="middle" fill="#ffffff" fill-opacity="0.92">${glyph}</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
};

/**
 * Read a file from public/ into the package. Its bytes go INTO the archive, and a `source` URL is
 * kept as a fallback for manifest-only packages. Hash-verified on install either way.
 */
async function externalAsset(id, publicPath, type) {
  const absolute = join(ROOT, 'public', publicPath);
  const bytes = await readFile(absolute);
  const { size } = await stat(absolute);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return {
    asset: {
      id,
      name: publicPath.split('/').pop(),
      type,
      size,
      hash: sha256,
      createdAt: EPOCH,
      // Kept alongside the archived bytes as a fallback: if a future package ships manifest-only,
      // the installer can still fetch from here.
      source: { url: publicPath, sha256, bytes: size },
    },
    bytes: new Uint8Array(bytes),
  };
}

/** Wrap authored content in the NodeForgePackage envelope (mirrors buildPackage in package.ts). */
const buildPackage = (meta, content, assets = [], kind = 'asset') => ({
  format: PACKAGE_FORMAT,
  formatVersion: PACKAGE_VERSION,
  kind,
  meta: { ...meta, createdAt: ISO, engineVersion: ENGINE_VERSION },
  content: {
    prefabs: [],
    blueprints: [],
    graphs: [],
    materials: [],
    particleSystems: [],
    skeletons: [],
    skeletalMeshes: [],
    animations: [],
    animatorControllers: [],
    dataAssets: [],
    uiDocuments: [],
    variables: [],
    ...content,
  },
  assets,
});

// ------------------------------------------------------------------------------------------------
// The seed catalogue. Primitives only — every pack is a few KB and works fully offline.
// ------------------------------------------------------------------------------------------------

const woodMat = material('mat-store-wood', 'Crate Wood', { color: '#A9743B', roughness: 0.85, metalness: 0 });
const metalMat = material('mat-store-metal', 'Banded Metal', { color: '#8C8F96', roughness: 0.35, metalness: 0.9 });
const stoneMat = material('mat-store-stone', 'Quarry Stone', { color: '#8A8A85', roughness: 0.95, metalness: 0 });

const neonPink = material('mat-store-neon-pink', 'Neon Pink', {
  color: '#FF3D8B',
  emissiveColor: '#FF3D8B',
  emissiveIntensity: 3.4,
  roughness: 0.3,
});
const neonCyan = material('mat-store-neon-cyan', 'Neon Cyan', {
  color: '#3DE8FF',
  emissiveColor: '#3DE8FF',
  emissiveIntensity: 3.4,
  roughness: 0.3,
});
const darkMetal = material('mat-store-dark-metal', 'Gantry Steel', {
  color: '#23262E',
  roughness: 0.45,
  metalness: 0.8,
});

/**
 * A captured UI kit as a UIDocument. `renderMode: 'dom'` plus the per-document `css` is exactly how
 * the engine already renders game UI, so an imported kit looks identical to its source game.
 * `visibleOnStart: false` so installing a kit never hijacks someone's running scene — they show it
 * from a blueprint (or flip the flag) when they want it.
 */
const uiKitDoc = (id: string, kit: { name: string; root: unknown; css: string }) => ({
  id,
  name: kit.name,
  surface: 'screen' as const,
  renderMode: 'dom' as const,
  root: kit.root,
  css: kit.css,
  visibleOnStart: false,
  createdAt: EPOCH,
});

interface KitElement {
  id: string;
  kind: string;
  name: string;
  className?: string;
  style: Record<string, unknown>;
  bindings: unknown[];
  children: KitElement[];
  componentId?: string;
  [key: string]: unknown;
}

/**
 * Ship captured kits as REUSABLE COMPONENTS rather than one giant hardcoded tree.
 *
 * A capture is flat by nature: a 10-slot hotbar arrives as ten identical subtrees, so changing the
 * slot means editing it ten times. Here every subtree that repeats often enough is lifted into its
 * own component document, and each copy becomes an instance of it — the same thing
 * `extractUIComponent` does in the editor, applied at build time. The rendered result is identical
 * (instances render their component in place); what changes is that the kit is now editable in one
 * place, and a user can drop the same widget into their own UI.
 *
 * Deliberately conservative: only subtrees with a class, at least MIN_COPIES copies, and more than
 * one node qualify, and the outermost match wins so nested repeats are not double-extracted.
 */
const MIN_COPIES = 4;

function decomposeUIKit(docId: string, doc: ReturnType<typeof uiKitDoc>) {
  const root = structuredClone(doc.root) as KitElement;
  /**
   * Structural signature: same kinds, classes, styles and images in the same shape. `text` is
   * deliberately EXCLUDED — ten hotbar slots labelled 1..0 are the same widget with different data,
   * and merging them is the whole point. The differing text becomes a parameter below; anything
   * else that differs keeps the copies apart instead of silently taking the first one's value.
   */
  const signature = (el: KitElement): string =>
    `${el.kind}.${el.className ?? ''}.${el.assetId ?? ''}.${JSON.stringify(el.style ?? {})}(${el.children.map(signature).join(',')})`;
  const size = (el: KitElement): number => 1 + el.children.reduce((n, c) => n + size(c), 0);

  // A widget is worth extracting when it has a class to be styled by and is more than one node.
  // No structural caveats: an instance renders its component's root in the same slot, so `>`,
  // `:nth-child` and flex/grid item promotion all behave exactly as they did before extraction.
  const extractable = (el: KitElement) => Boolean(el.className);

  const counts = new Map<string, number>();
  const tally = (el: KitElement) => {
    if (extractable(el) && size(el) > 1) counts.set(signature(el), (counts.get(signature(el)) ?? 0) + 1);
    el.children.forEach(tally);
  };
  tally(root);

  // Which node positions inside each repeated widget carry text that varies between copies. Those
  // become `param.<key>` on the component, supplied per instance.
  const copiesBySignature = new Map<string, KitElement[]>();
  const collect = (el: KitElement) => {
    const sig = signature(el);
    if (extractable(el) && size(el) > 1 && (counts.get(sig) ?? 0) >= MIN_COPIES) {
      copiesBySignature.set(sig, [...(copiesBySignature.get(sig) ?? []), el]);
      return; // outermost match wins — do not descend into a widget we are about to extract
    }
    el.children.forEach(collect);
  };
  collect(root);

  /** Paths (as `0.2.1` child-index strings) where text differs across the copies of one widget. */
  const varyingPaths = new Map<string, Set<string>>();
  for (const [sig, copies] of copiesBySignature) {
    const paths = new Set<string>();
    const compare = (nodes: KitElement[], path: string) => {
      const texts = new Set(nodes.map((n) => n.text ?? ''));
      if (texts.size > 1) paths.add(path);
      for (let i = 0; i < nodes[0].children.length; i += 1) {
        compare(nodes.map((n) => n.children[i]), path ? `${path}.${i}` : String(i));
      }
    };
    if (copies.length > 1) compare(copies, '');
    varyingPaths.set(sig, paths);
  }

  /** Stable parameter name for a node path. */
  const paramName = (path: string) => (path ? `text_${path.replace(/\./g, '_')}` : 'text');

  const components: Array<ReturnType<typeof uiKitDoc> & { isComponent: true }> = [];
  const bySignature = new Map<string, string>();
  let serial = 0;

  const rewrite = (el: KitElement): KitElement => {
    const sig = signature(el);
    if (extractable(el) && size(el) > 1 && (counts.get(sig) ?? 0) >= MIN_COPIES) {
      const paths = varyingPaths.get(sig) ?? new Set<string>();
      let componentId = bySignature.get(sig);
      if (!componentId) {
        serial += 1;
        componentId = `${docId}-component-${serial}`;
        bySignature.set(sig, componentId);
        // Two structurally different widgets can share a class name; number the duplicates so the
        // component list never shows the same label twice.
        const base = `${doc.name} · ${el.name}`;
        const taken = components.filter((c) => c.name === base || c.name.startsWith(`${base} `)).length;
        // Inside the component, every varying text is replaced by a binding to its parameter.
        const parameterize = (node: KitElement, path: string): KitElement => ({
          ...node,
          text: paths.has(path) ? '' : node.text,
          bindings: paths.has(path) ? [{ target: 'text', expression: `param.${paramName(path)}` }] : node.bindings,
          children: node.children.map((child, i) => parameterize(child, path ? `${path}.${i}` : String(i))),
        });
        components.push({
          ...uiKitDoc(componentId, { name: taken ? `${base} ${taken + 1}` : base, root: {}, css: '' }),
          // The component owns the subtree; its CSS already lives in the kit's document sheet,
          // which the host injects — so the component itself carries none.
          // The component keeps the widget EXACTLY as captured — same tag, same class, same box.
          // The instance is the side that dissolves (below), so the rendered DOM is unchanged.
          root: { ...parameterize(structuredClone(el), ''), id: `${componentId}-root` } as unknown as KitElement,
          css: '',
          isComponent: true as const,
        });
      }
      // Each instance supplies its own copy of whatever varied — as a quoted literal, since a
      // param is an expression evaluated in the host document.
      const params: Record<string, string> = {};
      const gather = (node: KitElement, path: string) => {
        if (paths.has(path)) params[paramName(path)] = JSON.stringify(node.text ?? '');
        node.children.forEach((child, i) => gather(child, path ? `${path}.${i}` : String(i)));
      };
      gather(el, '');
      // The instance emits NO element of its own — the engine renders the component's root in this
      // exact slot — so the DOM, and therefore every CSS rule written against it, is unchanged.
      return {
        id: `${el.id}-instance`,
        kind: 'component',
        name: el.name,
        componentId,
        ...(Object.keys(params).length ? { componentParams: params } : {}),
        style: {},
        bindings: [],
        children: [],
      };
    }
    return { ...el, children: el.children.map(rewrite) };
  };

  const decomposed = { ...doc, root: rewrite(root) as unknown as typeof doc.root };
  return [decomposed, ...components];
}

// ------------------------------------------------------------------------------------------------
// Party Royale UI — a HAND-AUTHORED kit, unlike the two captured ones. It exists to show the shape
// a good kit has: every repeated widget is a reusable component with its own stylesheet, screens are
// assembled from instances, and each instance differs only by its params. Nothing here is captured,
// so it doubles as the reference for an outside publisher authoring a kit from scratch.
// ------------------------------------------------------------------------------------------------

/** A UI element. `kind` drives the tag; `style` stays empty because the look lives in CSS. */
const uiEl = (id: string, kind: string, props: Record<string, unknown> = {}) => ({
  id,
  kind,
  name: (props.name as string) ?? id,
  style: {},
  bindings: [],
  children: [],
  ...props,
});

/** Bind one element property to an expression (`param.label`, a variable name, …). */
const bind = (target: string, expression: string) => ({ target, expression });

/** An instance of a component: no children of its own, just the data it supplies. */
const uiInstance = (id: string, componentId: string, params: Record<string, string> = {}, extra: Record<string, unknown> = {}) =>
  uiEl(id, 'component', {
    componentId,
    ...(Object.keys(params).length ? { componentParams: params } : {}),
    ...extra,
  });

const uiDoc = (
  id: string,
  name: string,
  root: unknown,
  { css = '', isComponent = false, visibleOnStart = false }: { css?: string; isComponent?: boolean; visibleOnStart?: boolean } = {},
) => ({
  id,
  name,
  surface: 'screen' as const,
  renderMode: 'dom' as const,
  ...(isComponent ? { isComponent: true } : {}),
  root,
  css,
  visibleOnStart,
  createdAt: EPOCH,
});

const projectVar = (id: string, name: string, type: string, defaultValue: unknown) => ({
  id,
  name,
  type,
  defaultValue,
  persistent: false,
  createdAt: EPOCH,
});

/** Shared palette + the chunky rounded type the whole look rests on. */
const PR_TOKENS = `
:root {
  --pr-pink: #ff5fa2; --pr-pink-deep: #c62d73;
  --pr-mint: #45e0b8; --pr-mint-deep: #1c9c7d;
  --pr-violet: #8b5cf6; --pr-violet-deep: #5b32c4;
  --pr-yellow: #ffd34d; --pr-yellow-deep: #d69b16;
  --pr-ink: #2b1b4d;
  --pr-face: rgba(255,255,255,.92);
  --pr-font: "Nunito", "Baloo 2", system-ui, -apple-system, "Segoe UI", sans-serif;
}
`;

/**
 * The signature chunky pill button: a flat face over a darker "sole" (box-shadow, not a border) so
 * it reads as a physical object, then presses INTO the sole on click. A tone class picked per
 * instance recolours it — that is why the component takes no colour parameter.
 */
const prButton = uiDoc(
  'uidoc-pr-button',
  'Party Royale · Jelly Button',
  uiEl('pr-button-root', 'button', {
    name: 'Jelly Button',
    className: 'pr-btn',
    text: 'PLAY',
    bindings: [bind('text', 'param.label')],
  }),
  {
    isComponent: true,
    css: `${PR_TOKENS}
& {
  padding: 14px 34px 16px;
  border: none;
  border-radius: 999px;
  background: var(--pr-pink);
  box-shadow: 0 7px 0 var(--pr-pink-deep), 0 12px 18px rgba(43,27,77,.35);
  color: #fff;
  font-family: var(--pr-font);
  font-size: 22px;
  font-weight: 900;
  letter-spacing: .06em;
  text-shadow: 0 2px 0 rgba(0,0,0,.18);
  cursor: pointer;
  transition: transform .12s ease, box-shadow .12s ease, filter .12s ease;
}
&:hover { transform: translateY(-2px); box-shadow: 0 9px 0 var(--pr-pink-deep), 0 16px 22px rgba(43,27,77,.4); filter: brightness(1.05); }
&:active { transform: translateY(5px); box-shadow: 0 2px 0 var(--pr-pink-deep), 0 4px 8px rgba(43,27,77,.35); }

/* Tones are chosen per instance by adding a class to the instance. */
&.tone-mint   { background: var(--pr-mint);   box-shadow: 0 7px 0 var(--pr-mint-deep),   0 12px 18px rgba(43,27,77,.35); }
&.tone-mint:hover   { box-shadow: 0 9px 0 var(--pr-mint-deep),   0 16px 22px rgba(43,27,77,.4); }
&.tone-mint:active  { box-shadow: 0 2px 0 var(--pr-mint-deep),   0 4px 8px rgba(43,27,77,.35); }
&.tone-violet { background: var(--pr-violet); box-shadow: 0 7px 0 var(--pr-violet-deep), 0 12px 18px rgba(43,27,77,.35); }
&.tone-violet:hover { box-shadow: 0 9px 0 var(--pr-violet-deep), 0 16px 22px rgba(43,27,77,.4); }
&.tone-violet:active{ box-shadow: 0 2px 0 var(--pr-violet-deep), 0 4px 8px rgba(43,27,77,.35); }
&.tone-yellow { background: var(--pr-yellow); box-shadow: 0 7px 0 var(--pr-yellow-deep), 0 12px 18px rgba(43,27,77,.35); color: var(--pr-ink); text-shadow: none; }
&.tone-yellow:hover { box-shadow: 0 9px 0 var(--pr-yellow-deep), 0 16px 22px rgba(43,27,77,.4); }
&.tone-yellow:active{ box-shadow: 0 2px 0 var(--pr-yellow-deep), 0 4px 8px rgba(43,27,77,.35); }
&.size-lg { padding: 20px 62px 23px; font-size: 30px; }
`,
  },
);

/** Icon + value chip — crowns, kudos, players remaining. */
const prPill = uiDoc(
  'uidoc-pr-pill',
  'Party Royale · Stat Pill',
  uiEl('pr-pill-root', 'panel', {
    name: 'Stat Pill',
    className: 'pr-pill',
    children: [
      uiEl('pr-pill-icon', 'text', { name: 'Icon', className: 'pr-pill-icon', text: '\u{1F451}', bindings: [bind('text', 'param.icon')] }),
      uiEl('pr-pill-value', 'text', { name: 'Value', className: 'pr-pill-value', text: '0', bindings: [bind('text', 'param.value')] }),
    ],
  }),
  {
    isComponent: true,
    css: `${PR_TOKENS}
& {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 18px 10px 12px;
  border-radius: 999px;
  background: var(--pr-face);
  box-shadow: 0 5px 0 rgba(43,27,77,.22), 0 8px 14px rgba(43,27,77,.22);
  font-family: var(--pr-font);
  color: var(--pr-ink);
}
.pr-pill-icon  { font-size: 20px; line-height: 1; }
.pr-pill-value { font-size: 19px; font-weight: 900; letter-spacing: .02em; }
&.tone-dark { background: rgba(43,27,77,.82); color: #fff; }
`,
  },
);

/** A qualifier row: place badge, name, and a "QUALIFIED" tick. */
const prSlot = uiDoc(
  'uidoc-pr-slot',
  'Party Royale · Qualifier Row',
  uiEl('pr-slot-root', 'panel', {
    name: 'Qualifier Row',
    className: 'pr-slot',
    children: [
      uiEl('pr-slot-place', 'text', { name: 'Place', className: 'pr-slot-place', text: '1', bindings: [bind('text', 'param.place')] }),
      uiEl('pr-slot-name', 'text', { name: 'Name', className: 'pr-slot-name', text: 'Player', bindings: [bind('text', 'param.name')] }),
      uiEl('pr-slot-tick', 'text', { name: 'Status', className: 'pr-slot-tick', text: 'QUALIFIED', bindings: [bind('text', 'param.status')] }),
    ],
  }),
  {
    isComponent: true,
    css: `${PR_TOKENS}
& {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 420px;
  padding: 10px 18px 12px;
  border-radius: 22px;
  background: var(--pr-face);
  box-shadow: 0 5px 0 rgba(43,27,77,.2);
  font-family: var(--pr-font);
  color: var(--pr-ink);
}
.pr-slot-place {
  display: flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; flex: 0 0 auto;
  border-radius: 50%;
  background: var(--pr-violet);
  box-shadow: 0 3px 0 var(--pr-violet-deep);
  color: #fff; font-size: 17px; font-weight: 900;
}
.pr-slot-name { flex: 1 1 auto; font-size: 19px; font-weight: 800; }
.pr-slot-tick { font-size: 13px; font-weight: 900; letter-spacing: .1em; color: var(--pr-mint-deep); }
&.is-out .pr-slot-place { background: #9aa3b2; box-shadow: 0 3px 0 #6b7384; }
&.is-out .pr-slot-tick  { color: #e0574f; }
&.is-you { background: #fff6cf; box-shadow: 0 5px 0 var(--pr-yellow-deep); }
`,
  },
);

/** Main menu: logo, a stack of jelly buttons, and the player's currencies. */
const prMenu = uiDoc(
  'uidoc-pr-menu',
  'Party Royale · Main Menu',
  uiEl('pr-menu-root', 'panel', {
    name: 'Menu',
    className: 'pr-menu',
    children: [
      uiEl('pr-menu-logo', 'panel', {
        name: 'Logo',
        className: 'pr-logo',
        children: [
          uiEl('pr-menu-logo-a', 'text', { name: 'Title', className: 'pr-logo-a', text: 'PARTY' }),
          uiEl('pr-menu-logo-b', 'text', { name: 'Subtitle', className: 'pr-logo-b', text: 'ROYALE' }),
        ],
      }),
      uiEl('pr-menu-actions', 'panel', {
        name: 'Actions',
        className: 'pr-menu-actions',
        children: [
          uiInstance('pr-menu-play', 'uidoc-pr-button', { label: '"PLAY"' }, { name: 'Play', className: 'size-lg', onClickEvent: 'startMatch' }),
          uiInstance('pr-menu-party', 'uidoc-pr-button', { label: '"PARTY"' }, { name: 'Party', className: 'tone-mint', onClickEvent: 'openParty' }),
          uiInstance('pr-menu-shop', 'uidoc-pr-button', { label: '"SHOP"' }, { name: 'Shop', className: 'tone-violet', onClickEvent: 'openShop' }),
        ],
      }),
      uiEl('pr-menu-wallet', 'panel', {
        name: 'Wallet',
        className: 'pr-menu-wallet',
        children: [
          uiInstance('pr-menu-crowns', 'uidoc-pr-pill', { icon: '"\u{1F451}"', value: 'Crowns' }, { name: 'Crowns' }),
          uiInstance('pr-menu-kudos', 'uidoc-pr-pill', { icon: '"⭐"', value: 'Kudos' }, { name: 'Kudos' }),
        ],
      }),
    ],
  }),
  {
    visibleOnStart: true,
    css: `${PR_TOKENS}
& { font-family: var(--pr-font); }
.pr-menu {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 34px;
  background: radial-gradient(120% 90% at 50% 0%, #7de3ff 0%, #6aa9ff 42%, #8b5cf6 100%);
}
/* Confetti: two soft dot layers drifting behind the menu. */
.pr-menu::before {
  content: ""; position: absolute; inset: -20%;
  background-image:
    radial-gradient(circle, rgba(255,255,255,.55) 3px, transparent 4px),
    radial-gradient(circle, rgba(255,211,77,.5) 4px, transparent 5px);
  background-size: 140px 140px, 210px 210px;
  background-position: 0 0, 70px 90px;
  animation: pr-drift 26s linear infinite;
  pointer-events: none;
}
@keyframes pr-drift { to { transform: translate3d(0, 140px, 0); } }

.pr-logo { display: flex; flex-direction: column; align-items: center; line-height: .86; }
.pr-logo-a {
  font-size: 84px; font-weight: 900; letter-spacing: .04em; color: #fff;
  text-shadow: 0 7px 0 var(--pr-pink-deep), 0 14px 26px rgba(43,27,77,.45);
  transform: rotate(-3deg);
}
.pr-logo-b {
  font-size: 46px; font-weight: 900; letter-spacing: .34em; color: var(--pr-yellow);
  text-shadow: 0 5px 0 var(--pr-yellow-deep), 0 10px 18px rgba(43,27,77,.4);
  transform: rotate(2deg);
}
.pr-menu-actions { display: flex; flex-direction: column; align-items: center; gap: 18px; }
.pr-menu-wallet { display: flex; gap: 14px; }
`,
  },
);

/** In-match HUD: round banner, timer, survivors, currencies — every readout bound to a variable. */
const prHud = uiDoc(
  'uidoc-pr-hud',
  'Party Royale · Match HUD',
  uiEl('pr-hud-root', 'panel', {
    name: 'HUD',
    className: 'pr-hud',
    children: [
      uiEl('pr-hud-top', 'panel', {
        name: 'Round Banner',
        className: 'pr-hud-top',
        children: [
          uiEl('pr-hud-round', 'text', { name: 'Round', className: 'pr-hud-round', text: 'HEX-A-GONE', bindings: [bind('text', 'RoundName')] }),
          uiEl('pr-hud-timer', 'text', { name: 'Timer', className: 'pr-hud-timer', text: '1:28', bindings: [bind('text', 'TimeLeft')] }),
        ],
      }),
      uiEl('pr-hud-survivors', 'panel', {
        name: 'Survivors',
        className: 'pr-hud-survivors',
        children: [
          uiEl('pr-hud-survivors-label', 'text', { name: 'Label', className: 'pr-hud-survivors-label', text: 'QUALIFYING' }),
          uiEl('pr-hud-survivors-value', 'text', { name: 'Value', className: 'pr-hud-survivors-value', text: '18', bindings: [bind('text', 'PlayersLeft')] }),
          uiEl('pr-hud-survivors-bar', 'bar', {
            name: 'Survivor Bar',
            className: 'pr-hud-bar',
            bindings: [bind('fill', 'PlayersLeft / 60')],
          }),
        ],
      }),
      uiEl('pr-hud-wallet', 'panel', {
        name: 'Wallet',
        className: 'pr-hud-wallet',
        children: [
          uiInstance('pr-hud-crowns', 'uidoc-pr-pill', { icon: '"\u{1F451}"', value: 'Crowns' }, { name: 'Crowns', className: 'tone-dark' }),
          uiInstance('pr-hud-kudos', 'uidoc-pr-pill', { icon: '"⭐"', value: 'Kudos' }, { name: 'Kudos', className: 'tone-dark' }),
        ],
      }),
      uiEl('pr-hud-stamp', 'text', {
        name: 'Qualified Stamp',
        className: 'pr-hud-stamp',
        text: 'QUALIFIED!',
        // Only shows once the match marks you through — flip Qualified to see it.
        bindings: [bind('visible', 'Qualified')],
      }),
    ],
  }),
  {
    css: `${PR_TOKENS}
& { font-family: var(--pr-font); }
.pr-hud { position: absolute; inset: 0; pointer-events: none; }

.pr-hud-top {
  position: absolute; top: 18px; left: 50%; translate: -50%;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 10px 42px 14px;
  border-radius: 0 0 26px 26px;
  background: var(--pr-face);
  box-shadow: 0 6px 0 rgba(43,27,77,.22), 0 12px 20px rgba(43,27,77,.28);
  color: var(--pr-ink);
}
.pr-hud-round { font-size: 20px; font-weight: 900; letter-spacing: .16em; }
.pr-hud-timer { font-size: 34px; font-weight: 900; color: var(--pr-pink-deep); line-height: 1; }

.pr-hud-survivors {
  position: absolute; top: 20px; right: 22px;
  display: flex; flex-direction: column; align-items: flex-end; gap: 4px;
  padding: 10px 18px 12px;
  border-radius: 22px;
  background: rgba(43,27,77,.82);
  box-shadow: 0 5px 0 rgba(21,12,40,.55);
  color: #fff;
}
.pr-hud-survivors-label { font-size: 12px; font-weight: 900; letter-spacing: .18em; opacity: .75; }
.pr-hud-survivors-value { font-size: 30px; font-weight: 900; line-height: 1; color: var(--pr-yellow); }
.pr-hud-bar { width: 132px; height: 9px; border-radius: 999px; background: rgba(255,255,255,.22); overflow: hidden; }
/* The bar's fill is drawn by the engine with an inline background, and inline always beats a
   stylesheet — so recolouring it to a gradient is one of the few places !important is the right
   answer rather than a smell. */
.pr-hud-bar .ui-bar-fill { background: linear-gradient(90deg, var(--pr-mint), var(--pr-yellow)) !important; }

.pr-hud-wallet { position: absolute; left: 22px; bottom: 22px; display: flex; gap: 12px; }

.pr-hud-stamp {
  position: absolute; top: 40%; left: 50%; translate: -50% -50%;
  padding: 16px 46px 20px;
  border-radius: 26px;
  background: var(--pr-mint);
  box-shadow: 0 9px 0 var(--pr-mint-deep), 0 18px 30px rgba(43,27,77,.4);
  color: #fff; font-size: 52px; font-weight: 900; letter-spacing: .06em;
  text-shadow: 0 4px 0 rgba(0,0,0,.16);
  rotate: -4deg;
  animation: pr-stamp .45s cubic-bezier(.2,1.5,.4,1) both;
}
@keyframes pr-stamp { from { transform: scale(2.2); opacity: 0; } to { transform: scale(1); opacity: 1; } }
`,
  },
);

/** Results board — the clearest demo of one component doing many jobs via params. */
const prResults = uiDoc(
  'uidoc-pr-results',
  'Party Royale · Results',
  uiEl('pr-results-root', 'panel', {
    name: 'Results',
    className: 'pr-results',
    children: [
      uiEl('pr-results-card', 'panel', {
        name: 'Card',
        className: 'pr-results-card',
        children: [
          uiEl('pr-results-title', 'text', { name: 'Title', className: 'pr-results-title', text: 'QUALIFIED' }),
          uiInstance('pr-results-1', 'uidoc-pr-slot', { place: '"1"', name: '"BeanBandit"', status: '"QUALIFIED"' }, { name: 'Row 1' }),
          uiInstance('pr-results-2', 'uidoc-pr-slot', { place: '"2"', name: '"You"', status: '"QUALIFIED"' }, { name: 'Row 2', className: 'is-you' }),
          uiInstance('pr-results-3', 'uidoc-pr-slot', { place: '"3"', name: '"WobbleTron"', status: '"QUALIFIED"' }, { name: 'Row 3' }),
          uiInstance('pr-results-4', 'uidoc-pr-slot', { place: '"4"', name: '"JellyLegs"', status: '"ELIMINATED"' }, { name: 'Row 4', className: 'is-out' }),
          uiInstance('pr-results-next', 'uidoc-pr-button', { label: '"NEXT ROUND"' }, { name: 'Next', className: 'tone-yellow', onClickEvent: 'nextRound' }),
        ],
      }),
    ],
  }),
  {
    css: `${PR_TOKENS}
& { font-family: var(--pr-font); }
.pr-results {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(43,27,77,.55);
}
.pr-results-card {
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  padding: 30px 34px 34px;
  border-radius: 34px;
  background: linear-gradient(180deg, #7de3ff, #8b5cf6);
  box-shadow: 0 12px 0 rgba(43,27,77,.4), 0 22px 40px rgba(43,27,77,.45);
}
.pr-results-title {
  margin-bottom: 6px;
  color: #fff; font-size: 40px; font-weight: 900; letter-spacing: .12em;
  text-shadow: 0 5px 0 var(--pr-violet-deep);
}
`,
  },
);

const PARTY_ROYALE_VARS = [
  projectVar('var-pr-crowns', 'Crowns', 'number', 12),
  projectVar('var-pr-kudos', 'Kudos', 'number', 4820),
  projectVar('var-pr-players', 'PlayersLeft', 'number', 18),
  projectVar('var-pr-round', 'RoundName', 'string', 'HEX-A-GONE'),
  projectVar('var-pr-time', 'TimeLeft', 'string', '1:28'),
  projectVar('var-pr-qualified', 'Qualified', 'boolean', false),
];

const PACKS = [
  {
    slug: 'ui-kit-party-royale',
    meta: {
      id: 'pkg-feather-ui-party-royale',
      name: 'Party Royale UI Kit',
      description:
        'A chunky, candy-coloured party-platformer interface — main menu, in-match HUD and a results board. Built entirely from reusable components: one Jelly Button, one Stat Pill and one Qualifier Row are instanced across all three screens, so restyling the button restyles every screen at once. Each instance differs only by its parameters and a tone class. Installs six live variables (Crowns, Kudos, PlayersLeft, RoundName, TimeLeft, Qualified) already bound to the HUD.',
      author: 'Feather',
      version: '1.0.0',
      tags: ['ui', 'hud', 'menu', 'party', 'components'],
      thumbnail: thumbnail('#FF5FA2', '#8B5CF6', '\u{1F451}'),
    },
    content: {
      uiDocuments: [prMenu, prHud, prResults, prButton, prPill, prSlot],
      variables: PARTY_ROYALE_VARS,
    },
  },

  {
    slug: 'ui-kit-rpg-hud',
    meta: {
      id: 'pkg-feather-ui-rpg-hud',
      name: 'RPG Combat HUD',
      description:
        'A full action-RPG HUD lifted from a shipped game: player and target frames, cast bar, boss bar, action bar, build palette, minimap, toasts and pickup popups. Its repeated widgets (build tiles, action buttons, key chips) ship as reusable components — edit one and every copy updates, or drop them into your own UI. Screen UI, hidden until you show it.',
      author: 'TheDevRealm',
      version: '1.0.0',
      tags: ['ui', 'hud', 'rpg'],
      thumbnail: thumbnail('#6C3BFF', '#FF9B3D', '\u{1F5E1}'),
    },
    content: { uiDocuments: decomposeUIKit('uidoc-store-rpg-hud', uiKitDoc('uidoc-store-rpg-hud', uiKits['rpg-hud'])) },
  },
  {
    slug: 'ui-kit-arcade-hud',
    meta: {
      id: 'pkg-feather-ui-arcade-hud',
      name: 'Arcade Racer HUD',
      description:
        'Arcade racing overlay from a shipped game — lap and timing readouts, boost and speed panels, menu chrome. Screen UI, hidden until you show it.',
      author: 'TheDevRealm',
      version: '1.0.0',
      tags: ['ui', 'hud', 'racing'],
      thumbnail: thumbnail('#00E5FF', '#FFE23D', '\u{1F3C1}'),
    },
    content: { uiDocuments: decomposeUIKit('uidoc-store-arcade-hud', uiKitDoc('uidoc-store-arcade-hud', uiKits['arcade-hud'])) },
  },

  {
    slug: 'starter-props',
    meta: {
      id: 'pkg-feather-starter-props',
      name: 'Starter Props',
      description:
        'Crates, a barrel and a stone block to dress a level with. Physics is switched on, so they tumble the moment you press Play.',
      author: 'Feather',
      version: '1.0.0',
      tags: ['props', 'environment', 'physics'],
      thumbnail: thumbnail('#B4762F', '#6E4318', '\u{1F4E6}'),
    },
    content: {
      materials: [woodMat, metalMat, stoneMat],
      prefabs: [
        prefab('prefab-store-crate', 'Wooden Crate', [
          object('obj-crate', 'Wooden Crate', 'cube', {
            materialId: woodMat.id,
            color: woodMat.color,
            physics: { collider: 'box', mass: 12 },
          }),
        ]),
        prefab('prefab-store-barrel', 'Metal Barrel', [
          object('obj-barrel', 'Metal Barrel', 'capsule', {
            materialId: metalMat.id,
            color: metalMat.color,
            scale: [0.8, 0.7, 0.8],
            physics: { collider: 'capsule', mass: 22 },
          }),
        ]),
        prefab('prefab-store-crate-stack', 'Crate Stack', [
          object('obj-stack-root', 'Crate Stack', 'empty'),
          object('obj-stack-a', 'Crate A', 'cube', {
            parentId: 'obj-stack-root',
            materialId: woodMat.id,
            color: woodMat.color,
            physics: { collider: 'box', mass: 12 },
          }),
          object('obj-stack-b', 'Crate B', 'cube', {
            parentId: 'obj-stack-root',
            position: [0.12, 1.02, -0.08],
            rotation: [0, 0.35, 0],
            materialId: woodMat.id,
            color: woodMat.color,
            physics: { collider: 'box', mass: 12 },
          }),
          object('obj-stack-c', 'Capstone', 'cube', {
            parentId: 'obj-stack-root',
            position: [-0.05, 2.04, 0.05],
            rotation: [0, -0.2, 0],
            scale: [0.85, 0.85, 0.85],
            materialId: stoneMat.id,
            color: stoneMat.color,
            physics: { collider: 'box', mass: 30 },
          }),
        ]),
      ],
    },
  },
  {
    slug: 'neon-signage',
    meta: {
      id: 'pkg-feather-neon-signage',
      name: 'Neon Signage Kit',
      description:
        'Emissive pillars and a hanging sign for night-time city scenes. Drops straight into a scene with bloom enabled.',
      author: 'Feather',
      version: '1.0.0',
      tags: ['props', 'lighting', 'cyberpunk'],
      thumbnail: thumbnail('#FF3D8B', '#3DE8FF', '\u{1F3AE}'),
    },
    content: {
      materials: [neonPink, neonCyan, darkMetal],
      prefabs: [
        prefab('prefab-store-neon-pillar', 'Neon Pillar', [
          object('obj-pillar-root', 'Neon Pillar', 'empty'),
          object('obj-pillar-post', 'Post', 'cube', {
            parentId: 'obj-pillar-root',
            position: [0, 1.6, 0],
            scale: [0.18, 3.2, 0.18],
            materialId: darkMetal.id,
            color: darkMetal.color,
          }),
          object('obj-pillar-tube', 'Neon Tube', 'cube', {
            parentId: 'obj-pillar-root',
            position: [0, 1.8, 0.12],
            scale: [0.06, 2.4, 0.06],
            materialId: neonPink.id,
            color: neonPink.color,
          }),
        ]),
        prefab('prefab-store-neon-sign', 'Hanging Sign', [
          object('obj-sign-root', 'Hanging Sign', 'empty'),
          object('obj-sign-bracket', 'Bracket', 'cube', {
            parentId: 'obj-sign-root',
            position: [0, 2.6, 0],
            scale: [1.4, 0.08, 0.08],
            materialId: darkMetal.id,
            color: darkMetal.color,
          }),
          object('obj-sign-panel', 'Panel', 'plane', {
            parentId: 'obj-sign-root',
            position: [0.5, 1.9, 0],
            rotation: [0, 0, 0],
            scale: [1.6, 1, 1],
            materialId: neonCyan.id,
            color: neonCyan.color,
          }),
        ]),
      ],
    },
  },
  {
    slug: 'physics-playground',
    meta: {
      id: 'pkg-feather-physics-playground',
      name: 'Physics Playground',
      description:
        'A ramp, a launch platform and a heavy ball — a ready-made rig for testing collisions, mass and restitution.',
      author: 'Feather',
      version: '1.0.0',
      tags: ['physics', 'prototyping', 'kit'],
      thumbnail: thumbnail('#3D7BFF', '#153A8A', '\u{26BD}'),
    },
    content: {
      materials: [stoneMat],
      prefabs: [
        prefab('prefab-store-ramp', 'Test Ramp', [
          object('obj-ramp', 'Test Ramp', 'cube', {
            rotation: [0, 0, -0.32],
            scale: [6, 0.25, 2.4],
            materialId: stoneMat.id,
            color: stoneMat.color,
            physics: { bodyType: 'fixed', collider: 'box' },
          }),
        ]),
        prefab('prefab-store-platform', 'Launch Platform', [
          object('obj-platform', 'Launch Platform', 'cube', {
            scale: [3, 0.4, 3],
            materialId: stoneMat.id,
            color: stoneMat.color,
            physics: { bodyType: 'fixed', collider: 'box' },
          }),
        ]),
        prefab('prefab-store-ball', 'Heavy Ball', [
          object('obj-ball', 'Heavy Ball', 'sphere', {
            color: '#D8452F',
            physics: { collider: 'sphere', mass: 40 },
          }),
        ]),
      ],
    },
  },
];

/**
 * A pack whose model bytes live OUTSIDE the package. Built async because it hashes the real file.
 * The prefab references the asset by id exactly as an inlined one would — the only difference is
 * where the bytes come from at install time.
 */
async function buildWeaponPack() {
  const { asset: sword, bytes } = await externalAsset('asset-store-sword', 'templates/Sword.glb', 'model');
  return {
    assetBytes: new Map([[sword.id, bytes]]),
    slug: 'blade-prop',
    meta: {
      id: 'pkg-feather-blade-prop',
      name: 'Blade Prop',
      description:
        'A sword model you can place, parent to a character, or attach to a weapon socket. The mesh downloads separately, so the package itself stays tiny.',
      author: 'Feather',
      version: '1.0.0',
      tags: ['props', 'weapons', 'model'],
      thumbnail: thumbnail('#6E7A8F', '#2B3140', '\u{1F5E1}'),
    },
    assets: [sword],
    content: {
      prefabs: [
        prefab('prefab-store-sword', 'Sword', [
          {
            id: 'obj-sword',
            name: 'Sword',
            kind: 'cube',
            transform: transform(),
            renderer: { ...renderer('cube'), modelAssetId: sword.id },
          },
        ]),
      ],
    },
  };
}

/**
 * A `kind: 'project'` package — a whole world, not a component. Installing one creates a NEW project
 * and its scenes replace the blank starter, which is how templates ship through the store.
 */
const SANDBOX_TEMPLATE = {
  slug: 'sandbox-world',
  kind: 'project',
  meta: {
    id: 'pkg-feather-sandbox-world',
    name: 'Sandbox World',
    description:
      'A ready-to-play starter world: a ground plane, a stack of physics crates and a lit sky. Creates a new project you can build on.',
    author: 'Feather',
    version: '1.0.0',
    tags: ['template', 'world', 'physics'],
    thumbnail: thumbnail('#4C9F5A', '#1E5230', '\u{1F3DE}'),
  },
  content: {
    materials: [woodMat, stoneMat],
    scenes: [
      {
        id: 'scene-sandbox',
        name: 'Sandbox',
        objects: [
          object('obj-ground', 'Ground', 'plane', {
            scale: [40, 1, 40],
            materialId: stoneMat.id,
            color: '#6F7A6A',
            physics: { bodyType: 'fixed', collider: 'box' },
          }),
          object('obj-sun', 'Sun', 'empty', { position: [8, 12, 6] }),
          object('obj-crate-1', 'Crate', 'cube', {
            position: [0, 1, 0],
            materialId: woodMat.id,
            color: woodMat.color,
            physics: { collider: 'box', mass: 12 },
          }),
          object('obj-crate-2', 'Crate', 'cube', {
            position: [0.2, 2.05, -0.1],
            rotation: [0, 0.3, 0],
            materialId: woodMat.id,
            color: woodMat.color,
            physics: { collider: 'box', mass: 12 },
          }),
          object('obj-crate-3', 'Crate', 'cube', {
            position: [1.6, 1, 0.8],
            rotation: [0, -0.4, 0],
            materialId: woodMat.id,
            color: woodMat.color,
            physics: { collider: 'box', mass: 12 },
          }),
        ],
      },
    ],
  },
};

/**
 * A `kind: 'plugin'` package — it ships NO code. The archive is only a manifest whose
 * `meta.pluginId` names a plugin module compiled into the engine
 * (src/extensions/availablePlugins.ts); installing it activates that module and persists the
 * choice. This is also the reference for publishing any future gallery plugin.
 */
const ARBOR_FORGE_PLUGIN = {
  slug: 'arbor-forge',
  kind: 'plugin',
  meta: {
    id: 'pkg-feather-plugin-arbor-forge',
    pluginId: 'feather.arbor-forge',
    name: 'Arbor Forge — Stylized Tree Studio',
    description:
      'Turn the parametric tree system into an art department: twelve hand-tuned stylized presets — Sakura, Autumn Maple, Ghost Willow, Ancient Oak, Baobab, Savanna Acacia, Frost Spruce and more — with a live 3D preview, a seed explorer, one-click planting and natural grove scattering. Everything it plants is an ordinary tree asset: terrain-snapped, wind-animated, choppable, and still editable in the Tree Builder afterwards.',
    author: 'Feather',
    version: '1.0.0',
    tags: ['plugin', 'trees', 'nature', 'stylized', 'environment'],
    thumbnail: thumbnail('#2FAE6B', '#0C3B24', '\u{1F333}'),
  },
  content: {},
};

/**
 * Model Forge, the second gallery plugin — same manifest-only shape as Arbor Forge above. The model
 * DATA layer (specs, rendering, serialization, AI tools) is engine code and always on; this package
 * activates the visual studio panel.
 */
const MODEL_FORGE_PLUGIN = {
  slug: 'model-forge',
  kind: 'plugin',
  meta: {
    id: 'pkg-feather-plugin-model-forge',
    pluginId: 'feather.model-forge',
    name: 'Model Forge — Prototype Modeler',
    description:
      'Prototype props without leaving the engine in a Blender-inspired Object, Edit and Paint workspace. Kit-bash five primitives, shape box control cages by vertex, edge or face, search twelve starter models, paint from a stylized palette, and choose smooth rounded or crisp flat finishes. Placed copies stay live-linked; finished props bake into real GLB assets for projects and exports.',
    author: 'Feather',
    version: '1.1.0',
    tags: ['plugin', 'modeling', 'props', 'stylized', 'prototyping'],
    thumbnail: thumbnail('#E9A13B', '#4A2508', '\u{1F528}'),
  },
  content: {},
};

/**
 * Pixel Art Trees adapts the deterministic painted-canopy work from RPG Mania to Feather's native
 * tree recipes. No bitmap assets ship in the package: the leaf atlas is generated by the engine and
 * the plugin only authors compact specs that remain editable, collaborative and export-safe.
 */
const PIXEL_ART_TREES_PLUGIN = {
  slug: 'pixel-art-trees',
  kind: 'plugin',
  meta: {
    id: 'pkg-feather-plugin-pixel-art-trees',
    pluginId: 'feather.pixel-art-trees',
    name: 'Pixel Art Trees — Procedural Vegetation Studio',
    description:
      'Create game-ready pixel vegetation without importing sprites: nine procedural leaf languages, five growth habits, live 3D seed previews, custom palettes and one-click terrain-snapped groves. Every result is a tiny deterministic Feather tree recipe, so forests stay editable, wind-animated, choppable, collaboration-safe and ready for export.',
    author: 'Feather',
    version: '1.0.0',
    tags: ['plugin', 'pixel-art', 'trees', 'vegetation', 'forest', 'rpg', 'environment'],
    thumbnail: thumbnail('#83D66B', '#183A2A', '\u{1F332}'),
  },
  content: {},
};

/** Card art for the browser-exported starter templates, which carry no thumbnail of their own. */
const TEMPLATE_THUMBNAILS = {
  'template-third-person': ['#5B8CFF', '#1B2C63', '\u{1F3C3}'],
  'template-first-person': ['#FF3D6E', '#3A0C22', '\u{1F52B}'],
  'template-driving': ['#FF9F3D', '#5A2E08', '\u{1F697}'],
  'template-sim-racing': ['#E84B3C', '#4A120C', '\u{1F3C1}'],
  'template-cinematic': ['#8C7BFF', '#241C52', '\u{1F3AC}'],
  'template-meadows': ['#63C46A', '#1E4B2C', '\u{1F33F}'],
  'template-cube-realm': ['#3DD6C0', '#0E4A45', '\u{1F9CA}'],
  'template-physics-lab': ['#7A8CFF', '#232C5C', '\u{1F9EA}'],
  'template-timeline-mechanics': ['#40DFFF', '#10283A', '\u{23F1}'],
  'template-spline-studio': ['#9B7BFF', '#241A38', '\u{2728}'],
};

/**
 * Install footprint = the archive, because the archive IS the download: manifest and every asset in
 * one compressed file. Identical bytes referenced under two ids are stored once by the container,
 * so this needs no deduplication of its own.
 */
const installFootprint = (archiveBytes) => archiveBytes;

/**
 * Refuse to list a package built from a doubled project.
 *
 * Template packages come out of a browser run, and a re-entrant export once merged two builds into
 * one file: every object duplicated at an identical transform, every model imported twice. It
 * installed fine and looked plausible. Identical name + parent + FULL transform is the fingerprint
 * (a name can legitimately repeat at one position with a different scale, so the whole transform
 * has to be in the key). Returns a list of problems; empty means clean.
 */
function detectDoubling(pkg) {
  const problems = [];
  for (const scene of pkg.content.scenes ?? []) {
    const seen = new Map();
    for (const object of scene.objects) {
      const key = `${object.name}|${object.parentId ?? '-'}|${JSON.stringify(object.transform)}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const dupes = [...seen.values()].filter((count) => count > 1).length;
    if (dupes) problems.push(`scene "${scene.name}" has ${dupes} duplicated object(s)`);
  }
  const byHash = new Map();
  for (const asset of pkg.assets) {
    if (asset.hash) byHash.set(asset.hash, (byHash.get(asset.hash) ?? 0) + 1);
  }
  const repeated = [...byHash.values()].filter((count) => count > 1).length;
  if (repeated) problems.push(`${repeated} asset(s) shipped under more than one id`);
  return problems;
}

/** The catalog row for a package, whether authored here or exported from the running editor. */
function catalogEntry({ pkg, slug, file, archiveBytes, thumbnail }) {
  return {
    id: pkg.meta.id,
    slug,
    title: pkg.meta.name,
    description: pkg.meta.description ?? '',
    author: pkg.meta.author ?? 'Feather',
    version: pkg.meta.version,
    kind: pkg.kind,
    tags: pkg.meta.tags ?? [],
    license: 'CC0-1.0',
    priceCents: 0,
    thumbnail: thumbnail ?? pkg.meta.thumbnail,
    sizeBytes: installFootprint(archiveBytes),
    downloadUrl: `packages/${file}`,
    engineVersion: ENGINE_VERSION,
    // The store card needs the module id up front (installed/removable state, build-support check)
    // without downloading the archive first.
    ...(pkg.meta.pluginId ? { pluginId: pkg.meta.pluginId } : {}),
    contents: {
      prefabs: pkg.content.prefabs.length,
      materials: pkg.content.materials.length,
      blueprints: pkg.content.blueprints.length,
      assets: pkg.assets.length,
      scenes: pkg.content.scenes?.length ?? 0,
      uiDocuments: pkg.content.uiDocuments?.length ?? 0,
    },
  };
}

// ------------------------------------------------------------------------------------------------

async function main() {
  // One folder per kind, so what a package IS is obvious from where it lives — both here and in
  // whatever bucket this is eventually mirrored into.
  for (const dir of Object.values(KIND_DIRS)) await mkdir(join(PACKAGES_DIR, dir), { recursive: true });

  const packs = [
    ...PACKS,
    await buildWeaponPack(),
    SANDBOX_TEMPLATE,
    ARBOR_FORGE_PLUGIN,
    MODEL_FORGE_PLUGIN,
    PIXEL_ART_TREES_PLUGIN,
  ];
  const entries = [];
  for (const pack of packs) {
    const kind = pack.kind ?? 'asset';
    const pkg = buildPackage(pack.meta, pack.content, pack.assets ?? [], kind);
    // One file: manifest plus every asset's bytes, compressed.
    const archive = writePackageArchive(pkg, pack.assetBytes ?? new Map(), { mtime: new Date(EPOCH) });
    const file = `${KIND_DIRS[kind]}/${pack.slug}.nfpack`;
    await writeFile(join(PACKAGES_DIR, file), archive);
    entries.push(catalogEntry({ pkg, slug: pack.slug, file, archiveBytes: archive.byteLength }));
    console.log(`  ${file} — ${(archive.byteLength / 1024).toFixed(1)} KB`);
  }

  // Starter templates are produced by the running editor (`?exportTemplate=<key>`, written by the
  // dev-server sink in vite.config.ts) because they're imperative builders, not data. Pick up
  // whatever has been exported so far and list it.
  const projectsDir = join(PACKAGES_DIR, KIND_DIRS.project);
  const exported = (await readdir(projectsDir))
    .filter((file) => file.startsWith('template-') && file.endsWith('.nfpack'))
    .sort();
  const doubled = [];
  for (const name of exported) {
    const file = `${KIND_DIRS.project}/${name}`;
    const raw = new Uint8Array(await readFile(join(PACKAGES_DIR, file)));
    const { pkg } = readPackageFile(raw);
    const problems = detectDoubling(pkg);
    if (problems.length) doubled.push(`  ${file}: ${problems.join('; ')}`);
    const slug = name.replace(/\.nfpack$/, '');
    const [from, to, glyph] = TEMPLATE_THUMBNAILS[slug] ?? ['#5B8CFF', '#1B2C63', '\u{1F5FA}'];
    entries.push(catalogEntry({ pkg, slug, file, archiveBytes: raw.byteLength, thumbnail: thumbnail(from, to, glyph) }));
    console.log(`  ${file} — ${(raw.byteLength / 1048576).toFixed(1)} MB single file (exported from the editor)`);
  }

  if (doubled.length) {
    console.error('\nRefusing to write the catalog — these exports look doubled:');
    console.error(doubled.join('\n'));
    console.error('\nRe-export them (`?exportTemplate=<key>`) and run this again.');
    process.exit(1);
  }

  const catalog = {
    format: CATALOG_FORMAT,
    formatVersion: '1.0.0',
    updatedAt: ISO,
    packages: entries,
  };
  await writeFile(join(OUT_DIR, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log(`\nWrote ${entries.length} packages + catalog.json to public/store/`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
