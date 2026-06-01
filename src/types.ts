import type { Edge, Node } from '@xyflow/react';

export type Vector3Tuple = [number, number, number];

export type SceneObjectKind = 'empty' | 'cube' | 'sphere' | 'capsule' | 'plane' | 'light' | 'camera';

export type RigidBodyType = 'dynamic' | 'fixed' | 'kinematic';

export type ColliderType = 'box' | 'sphere' | 'capsule';

export type AssetType = 'model' | 'image' | 'audio' | 'unknown';

export type GraphNodeCategory = 'Events' | 'Logic' | 'Math' | 'Runtime' | 'Physics' | 'Audio' | 'Values';

export type GraphNodeTone = 'event' | 'logic' | 'math' | 'runtime' | 'physics' | 'audio' | 'value';

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
  | 'value.vector3'
  | 'action.translate'
  | 'action.rotate'
  | 'action.applyForce'
  | 'action.fireEvent'
  | 'action.spawnObject'
  | 'action.playSound';

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
}

/** A single scene within a project. Also the content of a `scenes/<id>.scene.json` file. */
export interface Scene {
  id: string;
  name: string;
  objects: SceneObject[];
}

export interface AssetItem {
  id: string;
  name: string;
  type: AssetType;
  size: number;
  /** Relative path inside the project folder, e.g. "assets/hero.glb". Serialized. */
  path?: string;
  /** Runtime-only URL for rendering (blob: on web, asset:// on desktop). NOT serialized. */
  url?: string;
  /** True when the asset was loaded from a project that had no bytes on disk (e.g. migrated). */
  unresolved?: boolean;
  createdAt: number;
}

export interface ScriptBlueprint {
  id: string;
  name: string;
  description: string;
  graphId: string;
  color: string;
  createdAt: number;
}

export interface ProjectGraph {
  id: string;
  name: string;
  nodes: NodeForgeNode[];
  edges: Edge[];
}

/** Current project file format version. */
export const PROJECT_VERSION = '0.2.0';

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
