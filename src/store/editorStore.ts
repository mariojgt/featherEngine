import type { Edge, OnConnect, OnEdgesChange, OnNodesChange } from '@xyflow/react';
import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react';
import { create } from 'zustand';
import {
  PROJECT_VERSION,
  type AssetItem,
  type AssetType,
  type ColliderType,
  type GraphNodeCategory,
  type GraphNodeKind,
  type GraphNodeTone,
  type MeshRendererComponent,
  type NodeForgeProject,
  type NodeForgeNode,
  type NodeForgeNodeData,
  type PhysicsComponent,
  type ProjectGraph,
  type RigidBodyType,
  type Scene,
  type SceneObject,
  type SceneObjectKind,
  type ScriptBlueprint,
  type TransformComponent,
  type Vector3Tuple,
} from '../types';

const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export interface CreateObjectOptions {
  name?: string;
  position?: Vector3Tuple;
  color?: string;
  physics?: Partial<PhysicsComponent>;
}

const titleCase = (value: string) => `${value[0].toUpperCase()}${value.slice(1)}`;

const defaultTransform = (position: Vector3Tuple = [0, 0, 0]): TransformComponent => ({
  position,
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});

const defaultRenderer = (
  mesh: MeshRendererComponent['mesh'],
  color = '#5B8CFF',
): MeshRendererComponent => ({
  enabled: true,
  mesh,
  color,
  metalness: 0.1,
  roughness: 0.65,
});

const defaultPhysics = (bodyType: RigidBodyType = 'dynamic', collider: ColliderType = 'box'): PhysicsComponent => ({
  enabled: false,
  bodyType,
  collider,
  mass: 1,
  gravityScale: 1,
  friction: 0.6,
  linearDamping: 0,
  angularDamping: 0.05,
});

const blueprintId = 'blueprint-player-controller';
const graphId = 'graph-player-controller';

const starterObjects: SceneObject[] = [
  {
    id: 'obj-player',
    name: 'Player',
    kind: 'cube',
    transform: defaultTransform([0, 1, 0]),
    renderer: defaultRenderer('cube', '#5B8CFF'),
    physics: defaultPhysics('dynamic', 'box'),
    script: { blueprintId, graphId, enabled: true },
  },
  {
    id: 'obj-ground',
    name: 'Ground',
    kind: 'plane',
    transform: { position: [0, 0, 0], rotation: [-Math.PI / 2, 0, 0], scale: [8, 8, 1] },
    renderer: defaultRenderer('plane', '#2B3345'),
    physics: defaultPhysics('fixed', 'box'),
  },
  {
    id: 'obj-enemy',
    name: 'Enemy',
    kind: 'sphere',
    transform: defaultTransform([2.6, 0.75, -1.2]),
    renderer: defaultRenderer('sphere', '#FF6B6B'),
    physics: defaultPhysics('dynamic', 'sphere'),
  },
  {
    id: 'obj-light',
    name: 'Directional Light',
    kind: 'light',
    transform: defaultTransform([4, 6, 3]),
  },
  {
    id: 'obj-camera',
    name: 'Main Camera',
    kind: 'camera',
    transform: defaultTransform([4, 3, 6]),
  },
];

const starterSceneId = 'scene-main';

const starterScenes: Scene[] = [{ id: starterSceneId, name: 'Main', objects: starterObjects }];

const nodeToneByCategory: Record<GraphNodeCategory, GraphNodeTone> = {
  Events: 'event',
  Logic: 'logic',
  Math: 'math',
  Runtime: 'runtime',
  Physics: 'physics',
  Audio: 'audio',
  Values: 'value',
};

const nodeDescriptions: Record<string, string> = {
  Start: 'Runs once when the Blueprint starts.',
  Update: 'Runs every preview frame while Play is active.',
  'Key Down: W': 'Checks for a forward input event.',
  'Translate Z -1': 'Moves the attached object forward.',
  'Key Down': 'Fires when a key is pressed.',
  'Key Up': 'Fires when a key is released.',
  'Custom Event': 'A reusable entry point that can be fired by name.',
  'Fire Event': 'Triggers a custom event by name.',
  'Collision Enter': 'Fires when this object starts touching another collider.',
  Branch: 'Chooses a path from a boolean value.',
  Compare: 'Compares two values.',
  AND: 'Requires both inputs to be true.',
  OR: 'Requires either input to be true.',
  Add: 'Adds two numeric values.',
  Clamp: 'Keeps a value within a range.',
  Lerp: 'Interpolates between two values.',
  Vector3: 'Stores an X, Y, Z vector.',
  Translate: 'Moves the attached object.',
  Rotate: 'Rotates the attached object.',
  'Apply Force': 'Adds force to a rigid body.',
  'Spawn Object': 'Creates an object instance.',
  'Play Sound': 'Plays an audio source.',
};

const keyLabels: Record<string, string> = {
  KeyW: 'W',
  KeyA: 'A',
  KeyS: 'S',
  KeyD: 'D',
  Space: 'Space',
  ArrowUp: 'Arrow Up',
  ArrowDown: 'Arrow Down',
  ArrowLeft: 'Arrow Left',
  ArrowRight: 'Arrow Right',
};

const nodeKindByLabel: Record<string, GraphNodeKind> = {
  Start: 'event.start',
  Update: 'event.update',
  'Key Down': 'event.keyDown',
  'Key Down: W': 'event.keyDown',
  'Key Up': 'event.keyUp',
  'Custom Event': 'event.custom',
  'Collision Enter': 'event.collisionEnter',
  Branch: 'logic.branch',
  Compare: 'logic.compare',
  AND: 'logic.and',
  OR: 'logic.or',
  Add: 'math.add',
  Clamp: 'math.clamp',
  Lerp: 'math.lerp',
  Vector3: 'value.vector3',
  Translate: 'action.translate',
  'Translate Z -1': 'action.translate',
  Rotate: 'action.rotate',
  'Apply Force': 'action.applyForce',
  'Fire Event': 'action.fireEvent',
  'Spawn Object': 'action.spawnObject',
  'Play Sound': 'action.playSound',
};

const categoryByKind = (nodeKind: GraphNodeKind): GraphNodeCategory => {
  if (nodeKind.startsWith('event.')) return 'Events';
  if (nodeKind.startsWith('logic.')) return 'Logic';
  if (nodeKind.startsWith('math.')) return 'Math';
  if (nodeKind.startsWith('value.')) return 'Values';
  if (nodeKind === 'action.applyForce') return 'Physics';
  if (nodeKind === 'action.playSound') return 'Audio';
  return 'Runtime';
};

const describeNode = (data: Partial<NodeForgeNodeData>): Pick<NodeForgeNodeData, 'label' | 'description'> => {
  const eventName = data.eventName || 'CustomEvent';
  const keyCode = data.keyCode || 'KeyW';
  const keyLabel = keyLabels[keyCode] ?? keyCode;
  const axis = (data.axis || 'z').toUpperCase();
  const amount = Number(data.amount ?? -3.6);

  switch (data.nodeKind) {
    case 'event.start':
      return { label: 'Start', description: 'Runs once when the Blueprint starts.' };
    case 'event.update':
      return { label: 'Update', description: 'Runs every preview frame while Play is active.' };
    case 'event.keyDown':
      return { label: `Key Down: ${keyLabel}`, description: `Fires while ${keyLabel} is pressed during preview.` };
    case 'event.keyUp':
      return { label: `Key Up: ${keyLabel}`, description: `Fires once when ${keyLabel} is released.` };
    case 'event.custom':
      return { label: `Event: ${eventName}`, description: 'Custom event entry point fired by name.' };
    case 'action.fireEvent':
      return { label: `Fire: ${eventName}`, description: 'Triggers matching custom event entry nodes.' };
    case 'action.translate':
      return { label: `Translate ${axis} ${amount}`, description: 'Moves the attached object when execution reaches this node.' };
    case 'action.rotate':
      return { label: `Rotate ${axis} ${amount}`, description: 'Rotates the attached object when execution reaches this node.' };
    default: {
      const label = data.label ?? 'Node';
      return { label, description: nodeDescriptions[label] ?? `${data.category ?? 'Graph'} node` };
    }
  }
};

const normalizeNodeData = (data: Partial<NodeForgeNodeData>): NodeForgeNodeData => {
  const nodeKind = data.nodeKind ?? nodeKindByLabel[data.label ?? 'Update'] ?? 'event.update';
  const category = data.category ?? categoryByKind(nodeKind);
  const normalized: NodeForgeNodeData = {
    ...data,
    label: data.label ?? 'Node',
    nodeKind,
    category,
    description: data.description ?? `${category} node`,
    tone: nodeToneByCategory[category],
    hasInput: data.hasInput ?? !nodeKind.startsWith('event.'),
    hasOutput: data.hasOutput ?? true,
  };

  if ((nodeKind === 'event.keyDown' || nodeKind === 'event.keyUp') && !normalized.keyCode) {
    normalized.keyCode = 'KeyW';
  }

  if ((nodeKind === 'event.custom' || nodeKind === 'action.fireEvent') && !normalized.eventName) {
    normalized.eventName = 'CustomEvent';
  }

  if ((nodeKind === 'action.translate' || nodeKind === 'action.rotate') && !normalized.axis) {
    normalized.axis = nodeKind === 'action.translate' ? 'z' : 'y';
  }

  if (nodeKind === 'action.translate' && typeof normalized.amount !== 'number') {
    normalized.amount = -3.6;
  }

  if (nodeKind === 'action.rotate' && typeof normalized.amount !== 'number') {
    normalized.amount = 90;
  }

  return { ...normalized, ...describeNode(normalized) };
};

const makeNodeData = (
  label: string,
  category: GraphNodeCategory,
  options: Partial<NodeForgeNodeData> = {},
): NodeForgeNodeData => normalizeNodeData({ label, category, nodeKind: options.nodeKind ?? nodeKindByLabel[label], ...options });

const starterBlueprints: ScriptBlueprint[] = [
  {
    id: blueprintId,
    name: 'Player Controller',
    description: 'Reusable movement Blueprint that can be attached to any scene object.',
    graphId,
    color: '#5B8CFF',
    createdAt: Date.now(),
  },
];

const starterNodes: NodeForgeNode[] = [
  {
    id: 'node-start',
    type: 'nodeforge',
    position: { x: 32, y: 72 },
    data: makeNodeData('Start', 'Events', { hasInput: false }),
  },
  {
    id: 'node-update',
    type: 'nodeforge',
    position: { x: 232, y: 72 },
    data: makeNodeData('Update', 'Events', { hasInput: false }),
  },
  {
    id: 'node-key',
    type: 'nodeforge',
    position: { x: 432, y: 24 },
    data: makeNodeData('Key Down', 'Events', { keyCode: 'KeyW', hasInput: false }),
  },
  {
    id: 'node-move',
    type: 'nodeforge',
    position: { x: 632, y: 72 },
    data: makeNodeData('Translate', 'Runtime', { axis: 'z', amount: -3.6, hasOutput: false }),
  },
];

const starterEdges: Edge[] = [
  { id: 'edge-key-move', source: 'node-key', target: 'node-move', animated: true, type: 'smoothstep' },
];

const getAssetType = (fileName: string): AssetType => {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'glb' || ext === 'gltf') return 'model';
  if (['png', 'jpg', 'jpeg'].includes(ext ?? '')) return 'image';
  if (['mp3', 'wav'].includes(ext ?? '')) return 'audio';
  return 'unknown';
};

const objectDefaults: Record<SceneObjectKind, Partial<SceneObject>> = {
  empty: { kind: 'empty' },
  cube: { kind: 'cube', renderer: defaultRenderer('cube') },
  sphere: { kind: 'sphere', renderer: defaultRenderer('sphere', '#3DDC97') },
  capsule: { kind: 'capsule', renderer: defaultRenderer('capsule', '#F7B955') },
  plane: { kind: 'plane', renderer: defaultRenderer('plane', '#2B3345'), physics: defaultPhysics('fixed', 'box') },
  light: { kind: 'light' },
  camera: { kind: 'camera' },
};

const getColliderHalfHeight = (object: SceneObject) => {
  const scaleY = Math.max(object.transform.scale[1], 0.01);
  if (object.physics?.collider === 'sphere') return 0.55 * scaleY;
  if (object.physics?.collider === 'capsule') return 0.75 * scaleY;
  if (object.renderer?.mesh === 'sphere') return 0.55 * scaleY;
  if (object.renderer?.mesh === 'capsule') return 0.75 * scaleY;
  return 0.5 * scaleY;
};

const getGroundHeight = (objects: SceneObject[]) => {
  const ground = objects.find(
    (object) => object.physics?.enabled && object.physics.bodyType === 'fixed' && object.renderer?.mesh === 'plane',
  );
  return ground?.transform.position[1] ?? 0;
};

const makeRuntimeVelocityMap = (objects: SceneObject[]) =>
  Object.fromEntries(
    objects
      .filter((object) => object.physics?.enabled && object.physics.bodyType === 'dynamic')
      .map((object) => [object.id, [0, 0, 0] as Vector3Tuple]),
  );

const axisIndex = (axis: NodeForgeNodeData['axis']) => {
  if (axis === 'x') return 0;
  if (axis === 'y') return 1;
  return 2;
};

const LAYOUT_COL = 264;
const LAYOUT_ROW = 152;
const LAYOUT_X0 = 48;
const LAYOUT_Y0 = 48;
const LAYOUT_GRID = 24;

/** Layered left-to-right layout that follows execution flow and snaps to a grid. */
const layoutGraphNodes = (nodes: NodeForgeNode[], edges: Edge[]): NodeForgeNode[] => {
  if (nodes.length === 0) return nodes;
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const adjacency = new Map(nodes.map((node) => [node.id, [] as string[]]));
  edges.forEach((edge) => {
    if (adjacency.has(edge.source) && indegree.has(edge.target)) {
      adjacency.get(edge.source)!.push(edge.target);
      indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    }
  });

  // Longest-path layering (Kahn's algorithm); nodes left in a cycle stay in column 0.
  const layer = new Map(nodes.map((node) => [node.id, 0]));
  const remaining = new Map(indegree);
  const queue = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    const current = layer.get(id) ?? 0;
    (adjacency.get(id) ?? []).forEach((target) => {
      layer.set(target, Math.max(layer.get(target) ?? 0, current + 1));
      const next = (remaining.get(target) ?? 0) - 1;
      remaining.set(target, next);
      if (next === 0) queue.push(target);
    });
  }

  const byLayer = new Map<number, string[]>();
  nodes.forEach((node) => {
    const column = layer.get(node.id) ?? 0;
    byLayer.set(column, [...(byLayer.get(column) ?? []), node.id]);
  });

  const snap = (value: number) => Math.round(value / LAYOUT_GRID) * LAYOUT_GRID;
  const orderY = new Map(nodes.map((node) => [node.id, node.position.y]));
  const positions = new Map<string, { x: number; y: number }>();
  [...byLayer.keys()]
    .sort((a, b) => a - b)
    .forEach((column) => {
      const ids = byLayer.get(column)!.sort((a, b) => (orderY.get(a) ?? 0) - (orderY.get(b) ?? 0));
      ids.forEach((id, index) => {
        positions.set(id, { x: snap(LAYOUT_X0 + column * LAYOUT_COL), y: snap(LAYOUT_Y0 + index * LAYOUT_ROW) });
      });
    });

  return nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));
};

const buildGraphRuntime = (graph: ProjectGraph) => {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  graph.edges.forEach((edge) => {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  });

  return { nodesById, outgoing };
};

interface EditorState {
  scenes: Scene[];
  activeSceneId: string;
  selectedObjectId: string;
  isDirty: boolean;
  assets: AssetItem[];
  blueprints: ScriptBlueprint[];
  graphs: ProjectGraph[];
  activeBlueprintId: string;
  isPlaying: boolean;
  playSnapshot?: { sceneId: string; transforms: Record<string, TransformComponent> };
  runtimeVelocities: Record<string, Vector3Tuple>;
  runtimeKeys: Record<string, boolean>;
  runtimePreviousKeys: Record<string, boolean>;
  runtimeEventQueue: string[];
  runtimeStarted: boolean;
  runtimeTime: number;
  assetSearch: string;
  selectedGraphNodeId?: string;
  activeScene: () => Scene | undefined;
  selectedObject: () => SceneObject | undefined;
  createScene: (name?: string) => string;
  renameScene: (id: string, name: string) => void;
  deleteScene: (id: string) => void;
  setActiveScene: (id: string) => void;
  duplicateScene: (id: string) => void;
  activeBlueprint: () => ScriptBlueprint | undefined;
  activeGraph: () => ProjectGraph | undefined;
  selectedGraphNode: () => NodeForgeNode | undefined;
  selectObject: (id: string) => void;
  createObject: (kind: SceneObjectKind) => void;
  createObjectWithProps: (kind: SceneObjectKind, options?: CreateObjectOptions) => string;
  deleteObject: (id: string) => void;
  deleteSelectedObject: () => void;
  duplicateSelectedObject: () => void;
  renameObject: (id: string, name: string) => void;
  updateTransform: (id: string, field: keyof TransformComponent, value: Vector3Tuple) => void;
  updateRenderer: (id: string, patch: Partial<MeshRendererComponent>) => void;
  updatePhysics: (id: string, patch: Partial<PhysicsComponent>) => void;
  togglePhysics: (id: string) => void;
  attachScript: (id: string, nextBlueprintId?: string) => void;
  detachScript: (id: string) => void;
  setActiveBlueprint: (id: string) => void;
  createBlueprint: () => void;
  createBlueprintNamed: (name?: string, description?: string) => { blueprintId: string; graphId: string };
  addGraphNodeToBlueprint: (
    blueprintId: string,
    label: string,
    category: GraphNodeCategory,
    data?: Partial<NodeForgeNodeData>,
    position?: { x: number; y: number },
  ) => string;
  connectGraphNodes: (blueprintId: string, sourceId: string, targetId: string) => void;
  autoLayoutActiveGraph: () => void;
  selectGraphNode: (id?: string) => void;
  updateGraphNodeData: (id: string, patch: Partial<NodeForgeNodeData>) => void;
  fireCustomEvent: (eventName: string) => void;
  addAssets: (files: FileList | File[]) => void;
  addAssetItems: (items: AssetItem[]) => void;
  setAssetSearch: (value: string) => void;
  removeAsset: (id: string) => void;
  setPlaying: (value: boolean) => void;
  setRuntimeKey: (code: string, pressed: boolean) => void;
  tickRuntime: (delta: number) => void;
  onNodesChange: OnNodesChange<NodeForgeNode>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  addGraphNode: (label: string, category: GraphNodeCategory) => void;
  exportProject: () => NodeForgeProject;
  loadProject: (project: NodeForgeProject) => void;
  markClean: () => void;
}

const deleteWithChildren = (objects: SceneObject[], id: string) => {
  const ids = new Set<string>([id]);
  let changed = true;

  while (changed) {
    changed = false;
    objects.forEach((object) => {
      if (object.parentId && ids.has(object.parentId) && !ids.has(object.id)) {
        ids.add(object.id);
        changed = true;
      }
    });
  }

  return objects.filter((object) => !ids.has(object.id));
};

/** Stable selector for the active scene's objects. Use this in components, not an inline arrow. */
export const selectActiveObjects = (state: EditorState): SceneObject[] =>
  state.scenes.find((scene) => scene.id === state.activeSceneId)?.objects ?? [];

/**
 * Apply `fn` to the active scene's objects and mark the project dirty.
 * Non-active scenes keep their identity so scene-list consumers don't thrash.
 * NOTE: do NOT use this in tickRuntime/setPlaying — those must not set isDirty.
 */
const mapActiveSceneObjects = (
  state: EditorState,
  fn: (objects: SceneObject[]) => SceneObject[],
): Partial<EditorState> => ({
  scenes: state.scenes.map((scene) =>
    scene.id === state.activeSceneId ? { ...scene, objects: fn(scene.objects) } : scene,
  ),
  isDirty: true,
});

export const useEditorStore = create<EditorState>((set, get) => ({
  scenes: starterScenes,
  activeSceneId: starterSceneId,
  selectedObjectId: 'obj-player',
  isDirty: false,
  assets: [],
  blueprints: starterBlueprints,
  graphs: [{ id: graphId, name: 'Player Controller', nodes: starterNodes, edges: starterEdges }],
  activeBlueprintId: blueprintId,
  isPlaying: false,
  runtimeVelocities: {},
  runtimeKeys: {},
  runtimePreviousKeys: {},
  runtimeEventQueue: [],
  runtimeStarted: false,
  runtimeTime: 0,
  assetSearch: '',
  activeScene: () => get().scenes.find((scene) => scene.id === get().activeSceneId),
  selectedObject: () => selectActiveObjects(get()).find((object) => object.id === get().selectedObjectId),
  createScene: (name) => {
    const id = makeId('scene');
    set((state) => ({
      scenes: [...state.scenes, { id, name: name ?? `Scene ${state.scenes.length + 1}`, objects: [] }],
      isDirty: true,
    }));
    return id;
  },
  renameScene: (id, name) =>
    set((state) => ({
      scenes: state.scenes.map((scene) => (scene.id === id ? { ...scene, name } : scene)),
      isDirty: true,
    })),
  deleteScene: (id) =>
    set((state) => {
      if (state.isPlaying || state.scenes.length <= 1) return state;
      const remaining = state.scenes.filter((scene) => scene.id !== id);
      const activeSceneId = state.activeSceneId === id ? remaining[0].id : state.activeSceneId;
      const selectedObjectId =
        state.activeSceneId === id ? remaining[0].objects[0]?.id ?? '' : state.selectedObjectId;
      return { scenes: remaining, activeSceneId, selectedObjectId, isDirty: true };
    }),
  setActiveScene: (id) =>
    set((state) => {
      if (state.isPlaying || id === state.activeSceneId) return state;
      const scene = state.scenes.find((item) => item.id === id);
      if (!scene) return state;
      return { activeSceneId: id, selectedObjectId: scene.objects[0]?.id ?? '' };
    }),
  duplicateScene: (id) => {
    const newId = makeId('scene');
    set((state) => {
      const source = state.scenes.find((scene) => scene.id === id);
      if (!source) return state;
      // Keep object ids: they only need to be unique within a scene, and preserving them
      // keeps parentId links intact. Scenes run independently, so cross-scene id reuse is fine.
      const copy: Scene = { id: newId, name: `${source.name} Copy`, objects: structuredClone(source.objects) };
      return { scenes: [...state.scenes, copy], isDirty: true };
    });
    return newId;
  },
  activeBlueprint: () => get().blueprints.find((blueprint) => blueprint.id === get().activeBlueprintId),
  activeGraph: () => {
    const activeBlueprint = get().activeBlueprint();
    return get().graphs.find((graph) => graph.id === activeBlueprint?.graphId);
  },
  selectedGraphNode: () => get().activeGraph()?.nodes.find((node) => node.id === get().selectedGraphNodeId),
  selectObject: (id) => set({ selectedObjectId: id }),
  createObject: (kind) =>
    set((state) => {
      const defaults = objectDefaults[kind];
      const id = makeId('obj');
      const next: SceneObject = {
        id,
        name: kind === 'empty' ? 'Empty Object' : `${kind[0].toUpperCase()}${kind.slice(1)}`,
        kind,
        transform: defaultTransform([0, kind === 'plane' ? 0 : 2, 0]),
        ...defaults,
      } as SceneObject;

      return { ...mapActiveSceneObjects(state, (objects) => [...objects, next]), selectedObjectId: id };
    }),
  createObjectWithProps: (kind, options = {}) => {
    const id = makeId('obj');
    set((state) => {
      const defaults = objectDefaults[kind];
      const next: SceneObject = {
        id,
        name: options.name ?? (kind === 'empty' ? 'Empty Object' : titleCase(kind)),
        kind,
        transform: defaultTransform(options.position ?? [0, kind === 'plane' ? 0 : 2, 0]),
        ...defaults,
      } as SceneObject;

      if (options.color && next.renderer) {
        next.renderer = { ...next.renderer, color: options.color };
      }
      if (options.physics) {
        next.physics = { ...(next.physics ?? defaultPhysics()), ...options.physics };
      }

      return { ...mapActiveSceneObjects(state, (objects) => [...objects, next]), selectedObjectId: id };
    });
    return id;
  },
  deleteObject: (id) =>
    set((state) => {
      const objects = selectActiveObjects(state);
      const remaining = deleteWithChildren(objects, id);
      const selectedObjectId = remaining.some((object) => object.id === state.selectedObjectId)
        ? state.selectedObjectId
        : remaining[0]?.id ?? '';
      return { ...mapActiveSceneObjects(state, () => remaining), selectedObjectId };
    }),
  deleteSelectedObject: () =>
    set((state) => {
      const objects = selectActiveObjects(state);
      const remaining = deleteWithChildren(objects, state.selectedObjectId);
      return { ...mapActiveSceneObjects(state, () => remaining), selectedObjectId: remaining[0]?.id ?? '' };
    }),
  duplicateSelectedObject: () =>
    set((state) => {
      const selected = selectActiveObjects(state).find((object) => object.id === state.selectedObjectId);
      if (!selected) return state;
      const id = makeId('obj');
      const copy: SceneObject = {
        ...structuredClone(selected),
        id,
        name: `${selected.name} Copy`,
        transform: {
          ...selected.transform,
          position: [
            selected.transform.position[0] + 0.8,
            selected.transform.position[1],
            selected.transform.position[2] + 0.8,
          ],
        },
      };
      return { ...mapActiveSceneObjects(state, (objects) => [...objects, copy]), selectedObjectId: id };
    }),
  renameObject: (id, name) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => (object.id === id ? { ...object, name } : object)),
      ),
    ),
  updateTransform: (id, field, value) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) =>
          object.id === id ? { ...object, transform: { ...object.transform, [field]: value } } : object,
        ),
      ),
    ),
  updateRenderer: (id, patch) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) =>
          object.id === id && object.renderer ? { ...object, renderer: { ...object.renderer, ...patch } } : object,
        ),
      ),
    ),
  updatePhysics: (id, patch) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) =>
          object.id === id && object.physics ? { ...object, physics: { ...object.physics, ...patch } } : object,
        ),
      ),
    ),
  togglePhysics: (id) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== id) return object;
          const current = object.physics ?? defaultPhysics();
          return { ...object, physics: { ...current, enabled: !current.enabled } };
        }),
      ),
    ),
  attachScript: (id, nextBlueprintId) =>
    set((state) => {
      const blueprint = state.blueprints.find((item) => item.id === (nextBlueprintId ?? state.activeBlueprintId));
      if (!blueprint) return state;
      return {
        ...mapActiveSceneObjects(state, (objects) =>
          objects.map((object) =>
            object.id === id
              ? { ...object, script: { blueprintId: blueprint.id, graphId: blueprint.graphId, enabled: true } }
              : object,
          ),
        ),
        activeBlueprintId: blueprint.id,
      };
    }),
  detachScript: (id) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => (object.id === id ? { ...object, script: undefined } : object)),
      ),
    ),
  setActiveBlueprint: (activeBlueprintId) => set({ activeBlueprintId, selectedGraphNodeId: undefined }),
  createBlueprint: () =>
    set((state) => {
      const nextIndex = state.blueprints.length + 1;
      const newGraphId = makeId('graph');
      const newBlueprintId = makeId('blueprint');
      const blueprint: ScriptBlueprint = {
        id: newBlueprintId,
        name: `Blueprint ${nextIndex}`,
        description: 'Reusable Blueprint asset.',
        graphId: newGraphId,
        color: '#3DDC97',
        createdAt: Date.now(),
      };
      const graph: ProjectGraph = {
        id: newGraphId,
        name: blueprint.name,
        nodes: [
          {
            id: makeId('node'),
            type: 'nodeforge',
            position: { x: 80, y: 80 },
            data: makeNodeData('Start', 'Events', { hasInput: false }),
          },
          {
            id: makeId('node'),
            type: 'nodeforge',
            position: { x: 280, y: 80 },
            data: makeNodeData('Update', 'Events'),
          },
        ],
        edges: [],
      };

      return {
        blueprints: [...state.blueprints, blueprint],
        graphs: [...state.graphs, graph],
        activeBlueprintId: newBlueprintId,
        selectedGraphNodeId: graph.nodes[0]?.id,
        isDirty: true,
      };
    }),
  createBlueprintNamed: (name, description) => {
    const newGraphId = makeId('graph');
    const newBlueprintId = makeId('blueprint');
    set((state) => {
      const blueprint: ScriptBlueprint = {
        id: newBlueprintId,
        name: name ?? `Blueprint ${state.blueprints.length + 1}`,
        description: description ?? 'Reusable Blueprint asset.',
        graphId: newGraphId,
        color: '#3DDC97',
        createdAt: Date.now(),
      };
      const graph: ProjectGraph = {
        id: newGraphId,
        name: blueprint.name,
        nodes: [
          {
            id: makeId('node'),
            type: 'nodeforge',
            position: { x: 80, y: 80 },
            data: makeNodeData('Start', 'Events', { hasInput: false }),
          },
          {
            id: makeId('node'),
            type: 'nodeforge',
            position: { x: 280, y: 80 },
            data: makeNodeData('Update', 'Events'),
          },
        ],
        edges: [],
      };

      return {
        blueprints: [...state.blueprints, blueprint],
        graphs: [...state.graphs, graph],
        activeBlueprintId: newBlueprintId,
        selectedGraphNodeId: undefined,
        isDirty: true,
      };
    });
    return { blueprintId: newBlueprintId, graphId: newGraphId };
  },
  addGraphNodeToBlueprint: (blueprintId, label, category, data, position) => {
    const nodeId = makeId('node');
    set((state) => {
      const blueprint = state.blueprints.find((item) => item.id === blueprintId);
      if (!blueprint) return state;
      return {
        graphs: state.graphs.map((graph) => {
          if (graph.id !== blueprint.graphId) return graph;
          const offset = graph.nodes.length * 38;
          const node: NodeForgeNode = {
            id: nodeId,
            type: 'nodeforge',
            position: position ?? { x: 80 + (offset % 560), y: 220 + Math.floor(offset / 560) * 112 },
            data: makeNodeData(label, category, data),
          };
          return { ...graph, nodes: [...graph.nodes, node] };
        }),
        isDirty: true,
      };
    });
    return nodeId;
  },
  connectGraphNodes: (blueprintId, sourceId, targetId) =>
    set((state) => {
      const blueprint = state.blueprints.find((item) => item.id === blueprintId);
      if (!blueprint) return state;
      return {
        graphs: state.graphs.map((graph) =>
          graph.id === blueprint.graphId
            ? {
                ...graph,
                edges: addEdge(
                  { id: makeId('edge'), source: sourceId, target: targetId, animated: true, type: 'smoothstep' },
                  graph.edges,
                ),
              }
            : graph,
        ),
        isDirty: true,
      };
    }),
  autoLayoutActiveGraph: () =>
    set((state) => {
      const blueprint = state.blueprints.find((item) => item.id === state.activeBlueprintId);
      if (!blueprint) return state;
      return {
        graphs: state.graphs.map((graph) =>
          graph.id === blueprint.graphId
            ? { ...graph, nodes: layoutGraphNodes(graph.nodes, graph.edges) }
            : graph,
        ),
        isDirty: true,
      };
    }),
  selectGraphNode: (selectedGraphNodeId) => set({ selectedGraphNodeId }),
  updateGraphNodeData: (id, patch) =>
    set((state) => {
      const activeBlueprint = state.blueprints.find((item) => item.id === state.activeBlueprintId);
      if (!activeBlueprint) return state;

      return {
        graphs: state.graphs.map((graph) =>
          graph.id === activeBlueprint.graphId
            ? {
                ...graph,
                nodes: graph.nodes.map((node) =>
                  node.id === id ? { ...node, data: normalizeNodeData({ ...node.data, ...patch }) } : node,
                ),
              }
            : graph,
        ),
        isDirty: true,
      };
    }),
  fireCustomEvent: (eventName) =>
    set((state) => ({
      runtimeEventQueue: [...state.runtimeEventQueue, eventName.trim() || 'CustomEvent'],
    })),
  addAssets: (files) =>
    set((state) => ({
      assets: [
        ...state.assets,
        ...Array.from(files).map((file) => ({
          id: makeId('asset'),
          name: file.name,
          type: getAssetType(file.name),
          size: file.size,
          url: URL.createObjectURL(file),
          createdAt: Date.now(),
        })),
      ],
      isDirty: true,
    })),
  addAssetItems: (items) =>
    set((state) => ({ assets: [...state.assets, ...items], isDirty: true })),
  setAssetSearch: (assetSearch) => set({ assetSearch }),
  removeAsset: (id) =>
    set((state) => {
      const asset = state.assets.find((item) => item.id === id);
      if (asset?.url) URL.revokeObjectURL(asset.url);
      return { assets: state.assets.filter((item) => item.id !== id), isDirty: true };
    }),
  setPlaying: (isPlaying) =>
    set((state) => {
      if (isPlaying === state.isPlaying) return state;
      if (isPlaying) {
        const objects = selectActiveObjects(state);
        return {
          isPlaying,
          runtimeTime: 0,
          runtimeVelocities: makeRuntimeVelocityMap(objects),
          runtimeKeys: {},
          runtimePreviousKeys: {},
          runtimeEventQueue: [],
          runtimeStarted: false,
          playSnapshot: {
            sceneId: state.activeSceneId,
            transforms: Object.fromEntries(objects.map((object) => [object.id, structuredClone(object.transform)])),
          },
        };
      }

      // Restore the snapshot into the scene it was taken from (does NOT mark dirty).
      const snapshot = state.playSnapshot;
      const scenes = snapshot
        ? state.scenes.map((scene) =>
            scene.id === snapshot.sceneId
              ? {
                  ...scene,
                  objects: scene.objects.map((object) => ({
                    ...object,
                    transform: snapshot.transforms[object.id] ?? object.transform,
                  })),
                }
              : scene,
          )
        : state.scenes;

      return {
        isPlaying,
        runtimeTime: 0,
        runtimeVelocities: {},
        runtimeKeys: {},
        runtimePreviousKeys: {},
        runtimeEventQueue: [],
        runtimeStarted: false,
        scenes,
        playSnapshot: undefined,
      };
    }),
  setRuntimeKey: (code, pressed) =>
    set((state) => {
      if (state.runtimeKeys[code] === pressed) return state;
      return { runtimeKeys: { ...state.runtimeKeys, [code]: pressed } };
    }),
  tickRuntime: (delta) =>
    set((state) => {
      if (!state.isPlaying) return state;
      const activeObjects = selectActiveObjects(state);
      const graphRuntimes = new Map(
        state.graphs.map((graph) => [graph.id, { graph, ...buildGraphRuntime(graph) }]),
      );
      const runtimeTime = state.runtimeTime + delta;
      const groundHeight = getGroundHeight(activeObjects);
      const nextVelocities = { ...state.runtimeVelocities };
      const firedEvents = new Set(state.runtimeEventQueue.map((eventName) => eventName.toLowerCase()));
      const currentKeys = state.runtimeKeys;
      const previousKeys = state.runtimePreviousKeys;

      return {
        runtimeTime,
        runtimeVelocities: nextVelocities,
        runtimePreviousKeys: { ...currentKeys },
        runtimeEventQueue: [],
        runtimeStarted: true,
        scenes: state.scenes.map((scene) =>
          scene.id !== state.activeSceneId
            ? scene
            : {
                ...scene,
                objects: activeObjects.map((object) => {
          const position = [...object.transform.position] as Vector3Tuple;
          const rotation = [...object.transform.rotation] as Vector3Tuple;
          const scale = [...object.transform.scale] as Vector3Tuple;
          let changed = false;

          if (object.physics?.enabled && object.physics.bodyType === 'dynamic') {
            const velocity = [...(nextVelocities[object.id] ?? [0, 0, 0])] as Vector3Tuple;
            velocity[1] -= 9.81 * object.physics.gravityScale * delta;
            velocity[0] *= 1 - Math.min(object.physics.linearDamping * delta, 0.95);
            velocity[2] *= 1 - Math.min(object.physics.linearDamping * delta, 0.95);
            position[0] += velocity[0] * delta;
            position[1] += velocity[1] * delta;
            position[2] += velocity[2] * delta;

            const floorY = groundHeight + getColliderHalfHeight(object);
            if (position[1] < floorY) {
              position[1] = floorY;
              velocity[1] = 0;
              velocity[0] *= Math.max(0, 1 - object.physics.friction * delta);
              velocity[2] *= Math.max(0, 1 - object.physics.friction * delta);
            }

            nextVelocities[object.id] = velocity;
            changed = true;
          }

          if (!object.script?.enabled) {
            return changed ? { ...object, transform: { position, rotation, scale } } : object;
          }

          const graphRuntime = graphRuntimes.get(object.script.graphId);
          if (!graphRuntime) {
            return changed ? { ...object, transform: { position, rotation, scale } } : object;
          }
          const runtime = graphRuntime;

          function executeFrom(nodeId: string, visited: Set<string>) {
            if (visited.has(nodeId)) return;
            visited.add(nodeId);
            const node = runtime.nodesById.get(nodeId);
            if (!node) return;

            applyAction(node, visited);
            (runtime.outgoing.get(nodeId) ?? []).forEach((targetId) => executeFrom(targetId, visited));
          }

          function applyAction(node: NodeForgeNode, visited: Set<string>) {
            if (node.data.nodeKind === 'action.translate') {
              position[axisIndex(node.data.axis)] += Number(node.data.amount ?? -3.6) * delta;
              changed = true;
            }

            if (node.data.nodeKind === 'action.rotate') {
              rotation[axisIndex(node.data.axis)] += (Number(node.data.amount ?? 90) * Math.PI * delta) / 180;
              changed = true;
            }

            if (node.data.nodeKind === 'action.fireEvent') {
              const eventName = (node.data.eventName || 'CustomEvent').toLowerCase();
              runtime.graph.nodes
                .filter(
                  (candidate) =>
                    candidate.data.nodeKind === 'event.custom' &&
                    (candidate.data.eventName || 'CustomEvent').toLowerCase() === eventName,
                )
                .forEach((candidate) => executeFrom(candidate.id, visited));
            }
          }

          const roots = runtime.graph.nodes
            .filter((node) => {
              if (node.data.nodeKind === 'event.start') return !state.runtimeStarted;
              if (node.data.nodeKind === 'event.update') return true;
              if (node.data.nodeKind === 'event.keyDown') return Boolean(currentKeys[node.data.keyCode ?? 'KeyW']);
              if (node.data.nodeKind === 'event.keyUp') {
                const keyCode = node.data.keyCode ?? 'KeyW';
                return Boolean(previousKeys[keyCode]) && !currentKeys[keyCode];
              }
              if (node.data.nodeKind === 'event.custom') {
                return firedEvents.has((node.data.eventName || 'CustomEvent').toLowerCase());
              }
              return false;
            })
            .map((node) => node.id);

          roots.forEach((rootId) => executeFrom(rootId, new Set()));

          return changed
            ? {
            ...object,
            transform: { position, rotation, scale },
              }
            : object;
                }),
              },
        ),
      };
    }),
  onNodesChange: (changes) =>
    set((state) => {
      const activeBlueprint = state.blueprints.find((item) => item.id === state.activeBlueprintId);
      if (!activeBlueprint) return state;
      // Pure selection/dimension changes shouldn't mark the project dirty.
      const dirtied = changes.some((change) => change.type !== 'select' && change.type !== 'dimensions');
      return {
        graphs: state.graphs.map((graph) =>
          graph.id === activeBlueprint.graphId ? { ...graph, nodes: applyNodeChanges(changes, graph.nodes) } : graph,
        ),
        ...(dirtied ? { isDirty: true } : {}),
      };
    }),
  onEdgesChange: (changes) =>
    set((state) => {
      const activeBlueprint = state.blueprints.find((item) => item.id === state.activeBlueprintId);
      if (!activeBlueprint) return state;
      const dirtied = changes.some((change) => change.type !== 'select');
      return {
        graphs: state.graphs.map((graph) =>
          graph.id === activeBlueprint.graphId ? { ...graph, edges: applyEdgeChanges(changes, graph.edges) } : graph,
        ),
        ...(dirtied ? { isDirty: true } : {}),
      };
    }),
  onConnect: (connection) =>
    set((state) => {
      const activeBlueprint = state.blueprints.find((item) => item.id === state.activeBlueprintId);
      if (!activeBlueprint) return state;
      return {
        graphs: state.graphs.map((graph) =>
          graph.id === activeBlueprint.graphId
            ? { ...graph, edges: addEdge({ ...connection, animated: true, type: 'smoothstep' }, graph.edges) }
            : graph,
        ),
        isDirty: true,
      };
    }),
  addGraphNode: (label, category) =>
    set((state) => {
      const activeBlueprint = state.blueprints.find((item) => item.id === state.activeBlueprintId);
      if (!activeBlueprint) return state;
      let selectedGraphNodeId = state.selectedGraphNodeId;
      return {
        graphs: state.graphs.map((graph) => {
          if (graph.id !== activeBlueprint.graphId) return graph;
          const offset = graph.nodes.length * 38;
          const node: NodeForgeNode = {
            id: makeId('node'),
            type: 'nodeforge',
            position: { x: 80 + (offset % 560), y: 220 + Math.floor(offset / 560) * 112 },
            data: makeNodeData(label, category),
          };
          selectedGraphNodeId = node.id;
          return { ...graph, nodes: [...graph.nodes, node] };
        }),
        selectedGraphNodeId,
        isDirty: true,
      };
    }),
  exportProject: () => {
    const state = get();
    return {
      version: PROJECT_VERSION,
      name: 'Untitled Project',
      savedAt: new Date().toISOString(),
      activeSceneId: state.activeSceneId,
      scenes: state.scenes,
      assets: state.assets.map(({ url: _url, ...asset }) => asset),
      blueprints: state.blueprints,
      graphs: state.graphs,
    };
  },
  loadProject: (project) =>
    set(() => {
      const scenes = project.scenes.length ? project.scenes : [{ id: 'scene-main', name: 'Main', objects: [] }];
      const activeSceneId = scenes.some((scene) => scene.id === project.activeSceneId)
        ? project.activeSceneId
        : scenes[0].id;
      const activeScene = scenes.find((scene) => scene.id === activeSceneId)!;
      return {
        scenes,
        activeSceneId,
        selectedObjectId: activeScene.objects[0]?.id ?? '',
        assets: project.assets,
        blueprints: project.blueprints,
        graphs: project.graphs,
        activeBlueprintId: project.blueprints[0]?.id ?? '',
        selectedGraphNodeId: undefined,
        isPlaying: false,
        playSnapshot: undefined,
        runtimeVelocities: {},
        runtimeKeys: {},
        runtimePreviousKeys: {},
        runtimeEventQueue: [],
        runtimeStarted: false,
        runtimeTime: 0,
        isDirty: false,
      };
    }),
  markClean: () => set({ isDirty: false }),
}));
