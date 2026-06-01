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

export interface AssetItem {
  id: string;
  name: string;
  type: AssetType;
  size: number;
  url?: string;
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

export interface NodeForgeProject {
  version: string;
  savedAt: string;
  scene: {
    objects: SceneObject[];
  };
  assets: AssetItem[];
  blueprints: ScriptBlueprint[];
  graphs: ProjectGraph[];
}
