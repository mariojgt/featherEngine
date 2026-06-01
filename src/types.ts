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
  | 'action.getMaterialColor'
  | 'action.getMaterialProperty'
  | 'animator.setFloat'
  | 'animator.setBool'
  | 'animator.setTrigger'
  | 'input.move'
  | 'query.grounded'
  | 'action.move'
  | 'action.jump'
  | 'action.setCamera'
  | 'material.output'
  | 'material.color'
  | 'material.scalar'
  | 'material.texture'
  | 'material.mix'
  | 'material.multiply'
  | 'material.add'
  | 'material.clamp'
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
  /** action.setMaterialColor: which color channel to write (base color vs emissive). Defaults to base. */
  materialColorTarget?: 'base' | 'emissive';
  /** action.set/getMaterialProperty: which numeric material property to read/write. */
  materialProperty?: 'metalness' | 'roughness' | 'emissiveIntensity';
  /** action.playSound: id of the audio asset to play. */
  assetId?: string;
  /** action.spawnObject: kind of object to spawn at runtime. */
  spawnKind?: SceneObjectKind;
  /** action.print: message to log to the runtime console. */
  message?: string;
  /** animator.setFloat/setBool/setTrigger: name of the animator parameter to write. */
  paramName?: string;
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
  /**
   * Animator Controller (state machine) that decides which clip plays based on parameters. When set
   * it takes priority over `animationId`/`clip` — those remain the "play one clip" fallback.
   */
  controllerId?: string;
  /**
   * Animation asset (in `project.animations`) to play. It may live in a different GLB than the
   * rendered mesh — the clip is rebound to the mesh's bones by name, which is how a skeleton's
   * clips are reused across compatible meshes.
   */
  animationId?: string;
  /** Skeletal Mesh asset to render. Falls back to the renderer's `modelAssetId` GLB when unset. */
  skeletalMeshId?: string;
  /** Legacy/fallback: raw clip name played from the renderer's GLB when no Animation asset is set. */
  clip?: string;
  /** Playback speed multiplier (1 = authored speed). */
  speed: number;
  /** Loop the clip, or play once and hold the final frame. */
  loop: boolean;
}

/**
 * A reusable skeleton identity (Unreal-style). Two rigs whose bone hierarchy matches share the same
 * `signature`, so the importer reuses one Skeleton asset for both — and every Animation targeting that
 * skeleton becomes playable on every Skeletal Mesh bound to it.
 */
export interface SkeletonAsset {
  id: string;
  name: string;
  /** GLB asset id the skeleton was first derived from. */
  sourceAssetId: string;
  /** Bone node names in hierarchy order. */
  boneNames: string[];
  /** Stable hash of the bone hierarchy — the compatibility key. */
  signature: string;
  rootBone: string;
  /** Containing folder id, or undefined for the project root. */
  folderId?: string;
  createdAt: number;
}

/** A skinned mesh bound to a Skeleton. The geometry lives in `sourceAssetId`'s GLB. */
export interface SkeletalMeshAsset {
  id: string;
  name: string;
  sourceAssetId: string;
  skeletonId: string;
  folderId?: string;
  createdAt: number;
}

/** A single animation clip targeting a Skeleton (Unreal "Animation Sequence"). */
export interface AnimationAsset {
  id: string;
  name: string;
  /** GLB asset id the clip lives in. */
  sourceAssetId: string;
  /** Clip name within that GLB. */
  clipName: string;
  skeletonId: string;
  duration: number;
  /** Default loop hint (true for clips authored to loop, e.g. names ending in "_Loop"). */
  loop: boolean;
  folderId?: string;
  createdAt: number;
}

export type AnimatorParamType = 'float' | 'bool' | 'trigger';

/**
 * Where a parameter's value comes from each frame:
 * - `manual`: set by scripts (animator.setX nodes) or the AI — the engine never touches it.
 * - `speed`: the object's horizontal movement speed (units/sec) this frame.
 * - `verticalSpeed`: the object's vertical velocity (units/sec) — use for jump/fall states.
 * - `moving`: boolean, true when horizontal speed exceeds a small threshold.
 * - `variable`: mirrors a project variable (`variableId`), so existing scripts drive animation for free.
 */
export type AnimatorParamSource = 'manual' | 'speed' | 'verticalSpeed' | 'moving' | 'crouching' | 'variable';

export interface AnimatorParameter {
  id: string;
  name: string;
  type: AnimatorParamType;
  defaultValue: number | boolean;
  source: AnimatorParamSource;
  /** For `source: 'variable'` — the project variable whose value this parameter tracks. */
  variableId?: string;
}

/** One condition guarding a transition: a parameter compared against a constant. */
export interface AnimatorCondition {
  parameterId: string;
  op: CompareOperator;
  value: number | boolean;
}

/** A node in the state machine — plays one animation while active. */
export interface AnimatorState {
  id: string;
  name: string;
  /** Animation asset to play (AnimationAsset id). */
  animationId?: string;
  speed: number;
  loop: boolean;
}

/** A directed edge between states; taken when all conditions pass. */
export interface AnimatorTransition {
  id: string;
  /** Source state id, or 'any' to allow leaving from any state. */
  from: string | 'any';
  to: string;
  conditions: AnimatorCondition[];
  /** Crossfade duration in seconds. */
  duration: number;
}

/** A reusable animation state machine (Unreal Animation Blueprint / Unity Animator Controller). */
export interface AnimatorController {
  id: string;
  name: string;
  /** Skeleton this controller is authored against; its states' animations should target it. */
  skeletonId?: string;
  parameters: AnimatorParameter[];
  states: AnimatorState[];
  defaultStateId?: string;
  transitions: AnimatorTransition[];
  folderId?: string;
  createdAt: number;
}

/**
 * A built-in third-person character controller. During Play it reads WASD/arrows (Shift = sprint,
 * Space = jump), moves the object on the ground plane, applies gravity/jump, and yaws the mesh toward
 * its movement. The motion it produces is what feeds an Animator's `speed`/`verticalSpeed`/`moving`
 * parameters — so a locomotion controller animates with no extra wiring. An optional follow camera
 * trails the character in the game view / exported game.
 */
export interface CharacterControllerComponent {
  enabled: boolean;
  /** Ground move speed (units/sec). */
  moveSpeed: number;
  /** Speed multiplier while the sprint key (Shift) is held. */
  sprintMultiplier: number;
  /** Speed multiplier while the crouch key is held (also drives a "crouching" animator parameter). */
  crouchMultiplier: number;
  /** Initial upward velocity of a jump (units/sec). */
  jumpStrength: number;
  /** Downward acceleration (units/sec²). */
  gravity: number;
  /** How fast (radians/sec) the mesh turns to face its movement direction. */
  turnSpeed: number;
  /**
   * Extra yaw (radians) added when facing movement, to match the model's authored forward axis.
   * 0 for models whose forward is +Z (e.g. Quaternius); Math.PI for -Z-forward models.
   */
  modelYawOffset: number;
  /** Y the character's origin rests at when grounded. */
  groundLevel: number;
  // --- Input bindings (KeyboardEvent.code). Used by auto-mode and the Get Move Input node. ---
  keyForward: string;
  keyBackward: string;
  keyLeft: string;
  keyRight: string;
  keyJump: string;
  keySprint: string;
  keyCrouch: string;
  // --- Camera ---
  /** Trail a third-person camera behind the character (game view / export). */
  cameraFollow: boolean;
  /**
   * Resting camera position relative to the character, as a local offset [side, up, back].
   * Negative Z sits behind a +Z-forward model. Positioned with the on-screen camera gizmo.
   */
  cameraOffset: Vector3Tuple;
  /** Orbit the follow camera with the mouse (click the view to capture the pointer). */
  mouseLook: boolean;
  /** Radians of camera rotation per pixel of mouse movement. */
  mouseSensitivity: number;
  /** Base camera elevation (radians) before mouse pitch is added. */
  cameraPitch: number;
  /** Pitch clamps (radians). */
  cameraMinPitch: number;
  cameraMaxPitch: number;
  /** Move relative to where the camera faces (third-person feel) vs. fixed world axes. */
  cameraRelativeMovement: boolean;
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
  character?: CharacterControllerComponent;
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
export const PROJECT_VERSION = '0.6.0';

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
  skeletons: SkeletonAsset[];
  skeletalMeshes: SkeletalMeshAsset[];
  animations: AnimationAsset[];
  animatorControllers: AnimatorController[];
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
  skeletons: SkeletonAsset[];
  skeletalMeshes: SkeletalMeshAsset[];
  animations: AnimationAsset[];
  animatorControllers: AnimatorController[];
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
