import type { TreeSpec } from './tree';
import type { ModelSpec } from './model';
import type { Edge } from '@xyflow/react';
import type { AssetType, GraphValue, GraphValueType } from './common';
import type { MaterialDefinition } from './geometry';
import type { AnimationAsset, AnimatorController, SkeletalMeshAsset, SkeletonAsset } from './animation';
import type { RenderSettings, SceneEnvironmentSettings } from './environment';
import type { CinematicSequence } from './cinematics';
import type { NodeForgeNode } from './graph';
import type { ParticleSystemDefinition, SceneObject } from './gameplay';
import type { ExportSettings } from './export';

/** World streaming for big scenes: objects beyond `radius` of the player fully deactivate
 *  (no render/scripts/physics) and wake as the player approaches. */
export interface SceneStreamingSettings {
  enabled: boolean;
  /** Deactivation distance in world units (re-activation uses ~85% for hysteresis). */
  radius: number;
}

/** A single scene within a project. Also the content of a `scenes/<id>.scene.json` file. */
export interface Scene {
  id: string;
  name: string;
  objects: SceneObject[];
  /** World sky/fog/base lighting for this scene. */
  environment?: SceneEnvironmentSettings;
  /** Distance-based activation streaming for open worlds (off when undefined). */
  streaming?: SceneStreamingSettings;
  /** Audio asset id looped quietly as the ambient bed (wind/room tone) while this scene plays. */
  ambientSoundId?: string;
  /** Audio asset id looped as background music while this scene plays. */
  musicSoundId?: string;
  /** Timeline-driven scene control: camera cuts, transforms, temporary spawns, sounds, fades, and events. */
  cinematics?: CinematicSequence[];
}

/**
 * The id of the transient scene used while editing a prefab. Opening a prefab swaps the active
 * scene to this one (populated with a clone of the prefab's objects) so the whole editor — viewport,
 * hierarchy, inspector, gizmos — can edit it like any scene. It is NEVER serialized or shown in the
 * scene switcher; see `editingPrefabId`/`closePrefabEditor` in the store.
 */
export const PREFAB_EDIT_SCENE_ID = '__prefab_edit__';

/**
 * A reusable object template ("prefab"): a captured object subtree — a root plus all its
 * descendants — with every component (transform, renderer, physics, script, animator, children…)
 * baked in. The captured hierarchy becomes the first linked instance, and every later instance keeps
 * a definition-object link so prefab edits propagate while intentional per-instance overrides survive.
 * Lives in the project browser alongside blueprints/materials and is editable in its own viewport.
 */
export interface Prefab {
  id: string;
  name: string;
  /** Containing folder id, or undefined for the project root. */
  folderId?: string;
  /** The captured tree. Ids are prefab-local; `instantiatePrefab` re-ids them on stamp. */
  objects: SceneObject[];
  /** Id (within `objects`) of the root object — the one with no parent inside the prefab. */
  rootId: string;
  /** Small PNG data-URL preview rendered from the prefab's contents, shown in the Project browser. */
  thumbnail?: string;
  createdAt: number;
}

/** A folder in the project browser. Folders can hold assets, blueprints and other folders. */
export interface ProjectFolder {
  id: string;
  name: string;
  parentId?: string;
}

/** An asset's bytes held remotely, fetched and hash-verified at install time. */
export interface AssetSource {
  url: string;
  /** Expected SHA-256, lowercase hex. Downloads that don't match are rejected. */
  sha256: string;
  /** Advertised byte length, for progress and for refusing oversized downloads. */
  bytes?: number;
}

export interface AssetItem {
  id: string;
  name: string;
  type: AssetType;
  size: number;
  /** Containing folder id, or undefined for the project root. */
  folderId?: string;
  /** Relative path inside the project folder, e.g. "assets/hero.glb". Serialized. */
  path?: string;
  /** Runtime-only URL for rendering (blob: on web, asset:// on desktop). NOT serialized. */
  url?: string;
  /** Embedded data URL of the asset's bytes. Present only in exported game bundles (self-contained). */
  data?: string;
  /** SHA-256 of the asset's bytes, lowercase hex. The asset's content address: identical bytes
   *  imported twice reuse one file on disk, and an install can skip assets the project already has. */
  hash?: string;
  /** Where to fetch the bytes from, for packages that reference assets instead of inlining them.
   *  Store packages use this so a `.nfpack` stays a small manifest and big models stream separately. */
  source?: AssetSource;
  /** True when the asset was loaded from a project that had no bytes on disk (e.g. migrated). */
  unresolved?: boolean;
  createdAt: number;
}

export interface ProjectVariable {
  id: string;
  name: string;
  type: GraphValueType;
  defaultValue: GraphValue;
  /** Saved by Save Game nodes and restored by Load Game nodes. */
  persistent: boolean;
  createdAt: number;
}

export interface DataAssetColumn {
  id: string;
  name: string;
  type: GraphValueType;
}

export interface DataAssetRow {
  id: string;
  key: string;
  values: Record<string, GraphValue>;
}

export interface DataAsset {
  id: string;
  name: string;
  /** Containing folder id, or undefined for the project root. */
  folderId?: string;
  columns: DataAssetColumn[];
  rows: DataAssetRow[];
  createdAt: number;
}

/**
 * A typed variable DECLARED on a blueprint (Unreal-style "class variable"). Every object instance that runs
 * the blueprint gets its OWN copy, seeded from `defaultValue` into the object's per-instance `variables` (keyed
 * by `name`). This is the per-instance scope — distinct from global/shared ProjectVariables. Read/write at
 * runtime with the Get/Set Object Var nodes (objectKey = the variable name), optionally on another actor via a
 * target / Cast.
 */
export interface BlueprintVariable {
  id: string;
  name: string;
  type: GraphValueType;
  defaultValue: GraphValue;
}

export interface ScriptBlueprint {
  id: string;
  name: string;
  description: string;
  graphId: string;
  color: string;
  /** Containing folder id, or undefined for the project root. */
  folderId?: string;
  /** Typed per-instance variables this blueprint declares (each object running it gets its own copy). */
  variables?: BlueprintVariable[];
  /** Editable FeatherScript source. Undefined means the Script tab mirrors the visual graph. */
  featherSource?: string;
  /** Last source successfully compiled into the graph. Used to preserve newer invalid drafts safely. */
  featherSourceLastSynced?: string;
  /** Project-relative path to a linked external FeatherScript file. */
  featherSourcePath?: string;
  /** Fingerprint of the normalized external source at the last confirmed two-way sync. */
  featherSourceLastSyncedHash?: string;
  /** Fingerprint of graph-to-script output at that checkpoint, so invalid drafts do not look like graph edits. */
  featherSourceLastSyncedVisualHash?: string;
  createdAt: number;
}

export interface ProjectGraph {
  id: string;
  name: string;
  nodes: NodeForgeNode[];
  edges: Edge[];
}

/**
 * Kinds of UI element a document can contain.
 * Static: panel, text, image, bar, scroll.
 * Interactive (read/write a project variable via `valueVariable` during Play): button, input,
 * toggle, slider, dropdown.
 */
export type UIElementKind =
  | 'panel'
  | 'text'
  | 'image'
  | 'bar'
  | 'button'
  | 'scroll'
  | 'input'
  | 'toggle'
  | 'slider'
  | 'dropdown'
  /**
   * An INSTANCE of another UI document (`componentId`) — the reusable-widget kind. Renders that
   * document's tree in place, by reference: edit the component once and every instance updates.
   * `componentParams` feed its bindings as `param.<key>`, so one component serves many uses.
   */
  | 'component';

/** Whether a UI document draws on the player's screen (HUD) or anchored in the 3D world. */
export type UISurface = 'screen' | 'world';

/** CSS-like style, flat and serializable. The inspector edits these; `custom` is the raw escape hatch. */
export interface UIStyle {
  width?: string;
  height?: string;
  /** Size constraints (first-class so the WebGL backend honours them too). */
  minWidth?: string;
  maxWidth?: string;
  minHeight?: string;
  maxHeight?: string;
  padding?: string;
  margin?: string;
  /** `'grid'` lays children out in `gridColumns` equal columns (DOM CSS grid; WebGL falls back to wrapped flex). */
  display?: 'flex' | 'block' | 'none' | 'grid';
  /** Number of equal-width columns when `display: 'grid'` (default 2). */
  gridColumns?: number;
  flexDirection?: 'row' | 'column';
  /** Allow flex children to wrap onto multiple lines (DOM only; required for grid-like flex). */
  flexWrap?: 'nowrap' | 'wrap';
  alignItems?: string;
  justifyContent?: string;
  gap?: string;
  background?: string;
  color?: string;
  opacity?: number;
  border?: string;
  borderRadius?: string;
  /** CSS box-shadow (also drives elevation in themes). DOM only. */
  boxShadow?: string;
  fontSize?: string;
  fontWeight?: string;
  fontFamily?: string;
  textAlign?: 'left' | 'center' | 'right';
  /** Text-shadow / outline-glow string, e.g. "0 0 8px #5adcff". DOM only. */
  textShadow?: string;
  /** How overflowing text is handled. 'ellipsis' truncates with "…" (needs nowrap). */
  textOverflow?: 'clip' | 'ellipsis';
  /** Whitespace handling for text wrapping. */
  whiteSpace?: 'normal' | 'nowrap' | 'pre';
  /** Free placement within the parent — set when an element is dragged on the design canvas. */
  position?: 'absolute' | 'relative';
  left?: string;
  top?: string;
  /** Arbitrary CSS properties the inspector doesn't surface (camelCase keys). */
  custom?: Record<string, string>;
}

/** Pointer-state style overlays, merged over the base style on hover/press/disabled (button + interactive kinds). */
export interface UIInteractionStates {
  hover?: UIStyle;
  active?: UIStyle;
  disabled?: UIStyle;
}

/** Entrance/looping animation played by an element when it appears (DOM backend). */
export interface UIAnimation {
  type: 'fade' | 'scale' | 'pop' | 'slideUp' | 'slideDown' | 'slideLeft' | 'slideRight' | 'pulse' | 'spin';
  /** Seconds (default 0.3). */
  duration?: number;
  /** Delay before it starts, seconds (default 0). */
  delay?: number;
  /** CSS easing (default 'ease-out'). */
  easing?: string;
  /** Repeat forever (pulse/spin); otherwise plays once on appear. */
  loop?: boolean;
}

/** One-click widget templates inserted by the UI editor / AI (addUIPreset). */
export type UIPresetKind = 'panel' | 'label' | 'healthBar' | 'button' | 'counter' | 'image';

/** Screen-space placement (Unity-style 9-slice anchor + pixel offset). */
export interface UIAnchor {
  h: 'left' | 'center' | 'right' | 'stretch';
  v: 'top' | 'middle' | 'bottom' | 'stretch';
  offsetX: number;
  offsetY: number;
}

/** Drives one element property from a runtime expression (e.g. `health / maxHealth`). */
export interface UIBinding {
  target: 'text' | 'fill' | 'visible' | 'color' | 'background' | 'width' | 'disabled';
  expression: string;
}

export interface UIElement {
  id: string;
  kind: UIElementKind;
  name: string;
  /** Class for raw-CSS targeting. Captured kits keep an element's original id here as `id-<name>`. */
  className?: string;
  /**
   * Raw CSS attached to THIS element, scoped to it automatically (DOM renderer only).
   * Either a bare declaration list (`color: gold; border-radius: 8px`) which styles the element
   * itself, or full rules where `&` is the element and any other selector matches its descendants:
   * `& { background: linear-gradient(…) } &:hover { filter: brightness(1.2) } .row { gap: 6px }`.
   * Inline `style` fields still win on conflicts — clear the inspector field (or use `!important`)
   * to hand a property over to CSS.
   */
  css?: string;
  /** Static label for text/button elements. */
  text?: string;
  /** Image source asset id. */
  assetId?: string;
  /**
   * Image scaling (image kind). 'stretch' fills exactly, 'contain'/'cover' preserve aspect ratio,
   * 'nineSlice' keeps the corners fixed and stretches the middle (scalable panels/borders — uses
   * `sliceInset` px from each edge as the unstretched border). Defaults to 'stretch'.
   */
  imageFit?: 'stretch' | 'contain' | 'cover' | 'nineSlice';
  /** Border inset in px for `imageFit: 'nineSlice'` (default 12). */
  sliceInset?: number;
  style: UIStyle;
  /** Pointer-state style overlays (button + interactive kinds): hover/press/disabled. */
  states?: UIInteractionStates;
  /** Entrance/looping animation played when the element appears. */
  animation?: UIAnimation;
  /** Screen surface only — placement of this element's subtree. */
  anchor?: UIAnchor;
  bindings: UIBinding[];
  /** Button only — fires this custom runtime event on click (consumed by event.custom nodes). */
  onClickEvent?: string;
  /**
   * Interactive kinds (input/toggle/slider/dropdown) read AND write this project variable BY NAME
   * during Play (two-way binding): the control shows the variable's live value and edits push back
   * into it via the runtime. Empty = the control is display-only.
   */
  valueVariable?: string;
  /** Placeholder text for an `input` element. */
  placeholder?: string;
  /** Slider numeric range / step (defaults 0..100 step 1). */
  min?: number;
  max?: number;
  step?: number;
  /** Dropdown choices. The selected option string is written to `valueVariable`. */
  options?: string[];
  /** `component` kind — id of the UI document instanced here. */
  componentId?: string;
  /**
   * `component` kind — per-instance values the component's own bindings read as `param.<key>`
   * (e.g. `param.label`, `param.variable`). This is what lets one Health Bar component serve the
   * player and every enemy. Values are expressions evaluated in the PARENT's context, so
   * `param.slot` can be a literal ("3") or forwarded data (`self.health`).
   */
  componentParams?: Record<string, string>;
  /**
   * WebGL-backend visual effect (only honoured when the document's `renderMode` is `'webgl'`).
   * `'glow'` adds emissive bloom (pairs with the HUD bloom pass), `'holographic'` an animated
   * flicker/tint, `'scanline'` a CRT line overlay. Ignored by the DOM backend.
   */
  fx?: 'glow' | 'holographic' | 'scanline';
  children: UIElement[];
}

/** A reusable UI tree — a project asset like a material. Edited in the UI panel. */
export interface UIDocument {
  id: string;
  name: string;
  surface: UISurface;
  /**
   * Rendering backend. `'dom'` (default) draws HTML/CSS as a screen overlay or drei `<Html>`.
   * `'webgl'` renders the same element tree inside the 3D canvas via @react-three/uikit, so it
   * picks up post-processing (bloom/glitch), is depth-correct in world space, and can be mapped
   * onto in-world surfaces (diegetic UI). Bindings, text overrides and click events are identical.
   */
  renderMode?: 'dom' | 'webgl';
  /**
   * Marks this document as a REUSABLE COMPONENT rather than a screen/world UI of its own: it is
   * meant to be instanced inside other documents (`component` elements), so it is never auto-shown
   * on Play and is listed separately in the pickers. The tree is otherwise identical — any document
   * can be instanced, this only says what it is FOR.
   */
  isComponent?: boolean;
  /** Always a 'panel' element. */
  root: UIElement;
  /**
   * Raw CSS escape hatch for the whole document (DOM renderer only). Rewritten by `scopeUICss` on
   * injection so it can only match inside this widget: `:root`/`html`/`body` fold onto the
   * document frame, `#name` matches the `id-<name>` class convention, and `@keyframes` are
   * namespaced. Applies identically in the design canvas and in Play.
   */
  css?: string;
  /** Screen docs shown automatically when Play starts. */
  visibleOnStart: boolean;
  /** Blueprint holding this UI's behaviour nodes (run by an auto-created "UI Logic" object). */
  logicBlueprintId?: string;
  folderId?: string;
  createdAt: number;
}

/** Current project file format version. */
export const PROJECT_VERSION = '0.8.0';

/** Scene entry in the project manifest (project.json), pointing at its scene file. */
export interface SceneRef {
  id: string;
  name: string;
  file: string;
}

/**
 * The canonical, fully-loaded project bundle.
 * - Web export writes this as a single JSON file.
 * - Desktop writes it split into `project.json` (manifest) + `scenes/<id>.scene.json`.
 * Both read back into this shape.
 */
export interface NodeForgeProject {
  version: string;
  name: string;
  savedAt?: string;
  activeSceneId: string;
  /** Versioned, reusable production build profiles. */
  exportSettings: ExportSettings;
  scenes: Scene[];
  assets: AssetItem[];
  folders: ProjectFolder[];
  variables: ProjectVariable[];
  dataAssets: DataAsset[];
  materials: MaterialDefinition[];
  /** Reusable particle-system assets (Unreal-style). Referenced by objects via `systemId`. */
  particleSystems: ParticleSystemDefinition[];
  skeletons: SkeletonAsset[];
  skeletalMeshes: SkeletalMeshAsset[];
  animations: AnimationAsset[];
  animatorControllers: AnimatorController[];
  blueprints: ScriptBlueprint[];
  graphs: ProjectGraph[];
  uiDocuments: UIDocument[];
  /** Reusable parametric tree assets. Objects reference one by `tree.specId`; editing it restyles them all. */
  treeSpecs: TreeSpec[];
  /** Reusable prototype-model assets (Model Forge). Objects reference one by `model.specId`. Optional so
   *  projects written before the Model Forge existed keep loading (loaders backfill the default library). */
  modelSpecs?: ModelSpec[];
  /** Reusable object templates. See `Prefab`. */
  prefabs: Prefab[];
  /** Project-wide render / post-processing settings (bloom, vignette). */
  renderSettings?: RenderSettings;
}

/** Contents of `project.json` — everything except scene objects (which live in scene files). */
export interface ProjectManifest {
  version: string;
  name: string;
  savedAt?: string;
  activeSceneId: string;
  /** Versioned, reusable production build profiles. */
  exportSettings: ExportSettings;
  scenes: SceneRef[];
  assets: AssetItem[];
  folders: ProjectFolder[];
  variables: ProjectVariable[];
  dataAssets: DataAsset[];
  materials: MaterialDefinition[];
  /** Reusable particle-system assets (Unreal-style). Referenced by objects via `systemId`. */
  particleSystems: ParticleSystemDefinition[];
  skeletons: SkeletonAsset[];
  skeletalMeshes: SkeletalMeshAsset[];
  animations: AnimationAsset[];
  animatorControllers: AnimatorController[];
  blueprints: ScriptBlueprint[];
  graphs: ProjectGraph[];
  uiDocuments: UIDocument[];
  /** Reusable parametric tree assets. Objects reference one by `tree.specId`; editing it restyles them all. */
  treeSpecs: TreeSpec[];
  /** Reusable prototype-model assets (Model Forge). Objects reference one by `model.specId`. Optional so
   *  projects written before the Model Forge existed keep loading (loaders backfill the default library). */
  modelSpecs?: ModelSpec[];
  /** Reusable object templates. See `Prefab`. */
  prefabs: Prefab[];
  /** Project-wide render / post-processing settings (bloom, vignette). */
  renderSettings?: RenderSettings;
}

/** The legacy single-scene format (v0.1.0) — migrated on load. */
export interface LegacyNodeForgeProject {
  version: string;
  savedAt?: string;
  scene: { objects: SceneObject[] };
  assets: AssetItem[];
  blueprints: ScriptBlueprint[];
  graphs: ProjectGraph[];
}
