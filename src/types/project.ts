import type { Edge } from '@xyflow/react';
import type { AssetType, GraphValue, GraphValueType } from './common';
import type { MaterialDefinition } from './geometry';
import type { AnimationAsset, AnimatorController, SkeletalMeshAsset, SkeletonAsset } from './animation';
import type { RenderSettings, SceneEnvironmentSettings } from './environment';
import type { CinematicSequence } from './cinematics';
import type { NodeForgeNode } from './graph';
import type { ParticleSystemDefinition, SceneObject } from './gameplay';

/** A single scene within a project. Also the content of a `scenes/<id>.scene.json` file. */
export interface Scene {
  id: string;
  name: string;
  objects: SceneObject[];
  /** World sky/fog/base lighting for this scene. */
  environment?: SceneEnvironmentSettings;
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
 * baked in. Instantiating one stamps an independent copy into a scene; it is a one-time stamp, not
 * a live link, so later edits to the prefab don't touch already-placed instances. Lives in the
 * project browser alongside blueprints/materials and is editable in its own viewport.
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
export type UIElementKind = 'panel' | 'text' | 'image' | 'bar' | 'button' | 'scroll' | 'input' | 'toggle' | 'slider' | 'dropdown';

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
  /** Class for raw-CSS targeting. */
  className?: string;
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
  /** Always a 'panel' element. */
  root: UIElement;
  /** Raw CSS escape hatch, scoped to this document. */
  css?: string;
  /** Screen docs shown automatically when Play starts. */
  visibleOnStart: boolean;
  /** Blueprint holding this UI's behaviour nodes (run by an auto-created "UI Logic" object). */
  logicBlueprintId?: string;
  folderId?: string;
  createdAt: number;
}

/** Current project file format version. */
export const PROJECT_VERSION = '0.7.0';

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
