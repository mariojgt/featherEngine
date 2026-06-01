import type { Edge, Node } from '@xyflow/react';

export type Vector3Tuple = [number, number, number];

export type SceneObjectKind = 'empty' | 'cube' | 'sphere' | 'capsule' | 'plane' | 'light' | 'camera';

export type RigidBodyType = 'dynamic' | 'fixed' | 'kinematic';

export type ColliderType = 'box' | 'sphere' | 'capsule';

export type AssetType = 'model' | 'image' | 'audio' | 'unknown';

export type GraphValueType = 'number' | 'string' | 'boolean' | 'vector3';

export type GraphValue = number | string | boolean | Vector3Tuple;

export type CompareOperator = '==' | '!=' | '>' | '>=' | '<' | '<=';

export type GraphNodeCategory =
  | 'Events'
  | 'Logic'
  | 'Math'
  | 'Runtime'
  | 'Physics'
  | 'Audio'
  | 'Values'
  | 'Variables'
  | 'Data'
  | 'Persistence'
  | 'Material';

export type GraphNodeTone =
  | 'event'
  | 'logic'
  | 'math'
  | 'runtime'
  | 'physics'
  | 'audio'
  | 'value'
  | 'variable'
  | 'data'
  | 'persistence'
  | 'material';

export type GraphNodeKind =
  | 'event.start'
  | 'event.update'
  | 'event.keyDown'
  | 'event.keyUp'
  | 'event.custom'
  | 'event.collisionEnter'
  | 'logic.branch'
  | 'logic.compare'
  | 'logic.and'
  | 'logic.or'
  | 'math.add'
  | 'math.clamp'
  | 'math.lerp'
  | 'value.number'
  | 'value.string'
  | 'value.boolean'
  | 'value.vector3'
  | 'variable.get'
  | 'variable.set'
  | 'data.tableGet'
  | 'action.translate'
  | 'action.rotate'
  | 'action.applyForce'
  | 'action.fireEvent'
  | 'action.spawnObject'
  | 'action.playSound'
  | 'action.setMaterialColor'
  | 'action.setMaterialProperty'
  | 'material.output'
  | 'material.color'
  | 'material.scalar'
  | 'material.texture'
  | 'material.mix'
  | 'save.write'
  | 'save.load'
  | 'save.clear'
  | 'action.print';

export interface NodeForgeNodeData extends Record<string, unknown> {
  label: string;
  nodeKind: GraphNodeKind;
  category: GraphNodeCategory;
  description: string;
  tone: GraphNodeTone;
  eventName?: string;
  keyCode?: string;
  axis?: 'x' | 'y' | 'z';
  amount?: number;
  valueType?: GraphValueType;
  numberValue?: number;
  stringValue?: string;
  booleanValue?: boolean;
  vectorValue?: Vector3Tuple;
  variableId?: string;
  tableId?: string;
  rowKey?: string;
  columnId?: string;
  compareOp?: CompareOperator;
  saveSlot?: string;
  /** action.setMaterialColor: hex color to apply to the owner's material at runtime. */
  materialColor?: string;
  /** action.setMaterialProperty: which numeric material property to set (uses numberValue). */
  materialProperty?: 'metalness' | 'roughness' | 'emissiveIntensity';
  /** action.playSound: id of the audio asset to play. */
  assetId?: string;
  /** action.spawnObject: kind of object to spawn at runtime. */
  spawnKind?: SceneObjectKind;
  /** action.print: message to log to the runtime console. */
  message?: string;
  hasInput?: boolean;
  hasOutput?: boolean;
}

export type NodeForgeNode = Node<NodeForgeNodeData, 'nodeforge'>;

export interface TransformComponent {
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: Vector3Tuple;
}

export interface MeshRendererComponent {
  enabled: boolean;
  mesh: Exclude<SceneObjectKind, 'empty' | 'light' | 'camera'>;
  color: string;
  metalness: number;
  roughness: number;
  /** When set, render this imported glTF/GLB model asset instead of the built-in `mesh`. */
  modelAssetId?: string;
  /** Image asset used as the base-color (albedo) map — applies to built-in meshes and models. */
  textureAssetId?: string;
  /** For model assets: when true, the color/metalness/roughness below override the model's baked materials. */
  overrideMaterial?: boolean;
  /** When set, a reusable MaterialDefinition supplies this object's surface (overrides the inline props above and a model's baked materials). */
  materialId?: string;
  /** Per-object tweaks applied on top of the assigned material — written by runtime "Set Material" nodes, never mutating the shared definition. */
  materialOverrides?: MaterialOverrides;
}

/** Per-object overrides layered over an assigned MaterialDefinition (Unreal "dynamic material instance" style). */
export interface MaterialOverrides {
  color?: string;
  metalness?: number;
  roughness?: number;
  emissiveColor?: string;
  emissiveIntensity?: number;
}

/** A reusable material asset authored once and assigned to many objects. */
export interface MaterialDefinition {
  id: string;
  name: string;
  description: string;
  color: string;
  metalness: number;
  roughness: number;
  emissiveColor: string;
  emissiveIntensity: number;
  /** Base-color (albedo) map — an "image"-type asset id. */
  textureAssetId?: string;
  /** Normal map — an "image"-type asset id. */
  normalMapAssetId?: string;
  /** Optional node graph (in `graphs`) whose Material Output pins override the flat fields above. */
  graphId?: string;
  /** Containing folder id, or undefined for the project root. */
  folderId?: string;
  createdAt: number;
}

/**
 * Plays skeletal animation on an object that renders an imported skinned glTF/GLB model.
 *
 * Phase 0 (spike): plays a single named clip from the model assigned in the object's
 * `renderer.modelAssetId`. Later phases replace `clip` with a `controllerId` (a reusable
 * Animator Controller state machine) and a `skeletalMeshId` decoupled from the renderer.
 */
export interface AnimatorComponent {
  enabled: boolean;
  /** Name of the animation clip to play (must exist in the model's GLB). */
  clip?: string;
  /** Playback speed multiplier (1 = authored speed). */
  speed: number;
  /** Loop the clip, or play once and hold the final frame. */
  loop: boolean;
}

export interface PhysicsComponent {
  enabled: boolean;
  bodyType: RigidBodyType;
  collider: ColliderType;
  mass: number;
  gravityScale: number;
  friction: number;
  linearDamping: number;
  angularDamping: number;
}

export interface ScriptGraphComponent {
  blueprintId: string;
  graphId: string;
  enabled: boolean;
}

export interface SceneObject {
  id: string;
  name: string;
  kind: SceneObjectKind;
  parentId?: string;
  transform: TransformComponent;
  renderer?: MeshRendererComponent;
  physics?: PhysicsComponent;
  script?: ScriptGraphComponent;
  animator?: AnimatorComponent;
}

/** A single scene within a project. Also the content of a `scenes/<id>.scene.json` file. */
export interface Scene {
  id: string;
  name: string;
  objects: SceneObject[];
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

export interface ScriptBlueprint {
  id: string;
  name: string;
  description: string;
  graphId: string;
  color: string;
  /** Containing folder id, or undefined for the project root. */
  folderId?: string;
  createdAt: number;
}

export interface ProjectGraph {
  id: string;
  name: string;
  nodes: NodeForgeNode[];
  edges: Edge[];
}

/** Current project file format version. */
export const PROJECT_VERSION = '0.4.0';

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
  blueprints: ScriptBlueprint[];
  graphs: ProjectGraph[];
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
  blueprints: ScriptBlueprint[];
  graphs: ProjectGraph[];
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
