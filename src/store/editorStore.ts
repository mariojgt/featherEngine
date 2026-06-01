import type { Edge, OnConnect, OnEdgesChange, OnNodesChange } from '@xyflow/react';
import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react';
import { create } from 'zustand';
import type {
  AssetItem,
  AssetType,
  ColliderType,
  GraphNodeCategory,
  GraphNodeKind,
  GraphNodeTone,
  MeshRendererComponent,
  NodeForgeProject,
  NodeForgeNode,
  NodeForgeNodeData,
  PhysicsComponent,
  ProjectGraph,
  RigidBodyType,
  SceneObject,
  SceneObjectKind,
  ScriptBlueprint,
  TransformComponent,
  Vector3Tuple,
} from '../types';

const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

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

const buildGraphRuntime = (graph: ProjectGraph) => {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  graph.edges.forEach((edge) => {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  });

  return { nodesById, outgoing };
};

interface EditorState {
  sceneObjects: SceneObject[];
  selectedObjectId: string;
  assets: AssetItem[];
  blueprints: ScriptBlueprint[];
  graphs: ProjectGraph[];
  activeBlueprintId: string;
  isPlaying: boolean;
  playSnapshot?: Record<string, TransformComponent>;
  runtimeVelocities: Record<string, Vector3Tuple>;
  runtimeKeys: Record<string, boolean>;
  runtimePreviousKeys: Record<string, boolean>;
  runtimeEventQueue: string[];
  runtimeStarted: boolean;
  runtimeTime: number;
  assetSearch: string;
  selectedGraphNodeId?: string;
  selectedObject: () => SceneObject | undefined;
  activeBlueprint: () => ScriptBlueprint | undefined;
  activeGraph: () => ProjectGraph | undefined;
  selectedGraphNode: () => NodeForgeNode | undefined;
  selectObject: (id: string) => void;
  createObject: (kind: SceneObjectKind) => void;
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
  selectGraphNode: (id?: string) => void;
  updateGraphNodeData: (id: string, patch: Partial<NodeForgeNodeData>) => void;
  fireCustomEvent: (eventName: string) => void;
  addAssets: (files: FileList | File[]) => void;
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

export const useEditorStore = create<EditorState>((set, get) => ({
  sceneObjects: starterObjects,
  selectedObjectId: 'obj-player',
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
  selectedObject: () => get().sceneObjects.find((object) => object.id === get().selectedObjectId),
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

      return {
        sceneObjects: [...state.sceneObjects, next],
        selectedObjectId: id,
      };
    }),
  deleteSelectedObject: () =>
    set((state) => {
      if (state.sceneObjects.length <= 1) return state;
      const remaining = deleteWithChildren(state.sceneObjects, state.selectedObjectId);
      return {
        sceneObjects: remaining,
        selectedObjectId: remaining[0]?.id ?? '',
      };
    }),
  duplicateSelectedObject: () =>
    set((state) => {
      const selected = state.sceneObjects.find((object) => object.id === state.selectedObjectId);
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
      return {
        sceneObjects: [...state.sceneObjects, copy],
        selectedObjectId: id,
      };
    }),
  renameObject: (id, name) =>
    set((state) => ({
      sceneObjects: state.sceneObjects.map((object) => (object.id === id ? { ...object, name } : object)),
    })),
  updateTransform: (id, field, value) =>
    set((state) => ({
      sceneObjects: state.sceneObjects.map((object) =>
        object.id === id ? { ...object, transform: { ...object.transform, [field]: value } } : object,
      ),
    })),
  updateRenderer: (id, patch) =>
    set((state) => ({
      sceneObjects: state.sceneObjects.map((object) =>
        object.id === id && object.renderer
          ? { ...object, renderer: { ...object.renderer, ...patch } }
          : object,
      ),
    })),
  updatePhysics: (id, patch) =>
    set((state) => ({
      sceneObjects: state.sceneObjects.map((object) =>
        object.id === id && object.physics ? { ...object, physics: { ...object.physics, ...patch } } : object,
      ),
    })),
  togglePhysics: (id) =>
    set((state) => ({
      sceneObjects: state.sceneObjects.map((object) => {
        if (object.id !== id) return object;
        const current = object.physics ?? defaultPhysics();
        return { ...object, physics: { ...current, enabled: !current.enabled } };
      }),
    })),
  attachScript: (id, nextBlueprintId) =>
    set((state) => {
      const blueprint = state.blueprints.find((item) => item.id === (nextBlueprintId ?? state.activeBlueprintId));
      if (!blueprint) return state;
      return {
        activeBlueprintId: blueprint.id,
        sceneObjects: state.sceneObjects.map((object) =>
          object.id === id
            ? { ...object, script: { blueprintId: blueprint.id, graphId: blueprint.graphId, enabled: true } }
            : object,
        ),
      };
    }),
  detachScript: (id) =>
    set((state) => ({
      sceneObjects: state.sceneObjects.map((object) =>
        object.id === id ? { ...object, script: undefined } : object,
      ),
    })),
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
    })),
  setAssetSearch: (assetSearch) => set({ assetSearch }),
  removeAsset: (id) =>
    set((state) => {
      const asset = state.assets.find((item) => item.id === id);
      if (asset?.url) URL.revokeObjectURL(asset.url);
      return { assets: state.assets.filter((item) => item.id !== id) };
    }),
  setPlaying: (isPlaying) =>
    set((state) => {
      if (isPlaying === state.isPlaying) return state;
      if (isPlaying) {
        return {
          isPlaying,
          runtimeTime: 0,
          runtimeVelocities: makeRuntimeVelocityMap(state.sceneObjects),
          runtimeKeys: {},
          runtimePreviousKeys: {},
          runtimeEventQueue: [],
          runtimeStarted: false,
          playSnapshot: Object.fromEntries(
            state.sceneObjects.map((object) => [object.id, structuredClone(object.transform)]),
          ),
        };
      }

      return {
        isPlaying,
        runtimeTime: 0,
        runtimeVelocities: {},
        runtimeKeys: {},
        runtimePreviousKeys: {},
        runtimeEventQueue: [],
        runtimeStarted: false,
        sceneObjects: state.sceneObjects.map((object) => ({
          ...object,
          transform: state.playSnapshot?.[object.id] ?? object.transform,
        })),
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
      const graphRuntimes = new Map(
        state.graphs.map((graph) => [graph.id, { graph, ...buildGraphRuntime(graph) }]),
      );
      const runtimeTime = state.runtimeTime + delta;
      const groundHeight = getGroundHeight(state.sceneObjects);
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
        sceneObjects: state.sceneObjects.map((object) => {
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
      };
    }),
  onNodesChange: (changes) =>
    set((state) => {
      const activeBlueprint = state.blueprints.find((item) => item.id === state.activeBlueprintId);
      if (!activeBlueprint) return state;
      return {
        graphs: state.graphs.map((graph) =>
          graph.id === activeBlueprint.graphId ? { ...graph, nodes: applyNodeChanges(changes, graph.nodes) } : graph,
        ),
      };
    }),
  onEdgesChange: (changes) =>
    set((state) => {
      const activeBlueprint = state.blueprints.find((item) => item.id === state.activeBlueprintId);
      if (!activeBlueprint) return state;
      return {
        graphs: state.graphs.map((graph) =>
          graph.id === activeBlueprint.graphId ? { ...graph, edges: applyEdgeChanges(changes, graph.edges) } : graph,
        ),
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
      };
    }),
  exportProject: () => ({
    version: '0.1.0',
    savedAt: new Date().toISOString(),
    scene: {
      objects: get().sceneObjects,
    },
    assets: get().assets.map(({ url: _url, ...asset }) => asset),
    blueprints: get().blueprints,
    graphs: get().graphs,
  }),
}));
