import { tool } from 'ai';
import { z } from 'zod';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import type {
  ColliderType,
  GraphNodeCategory,
  RigidBodyType,
  SceneObjectKind,
  Vector3Tuple,
} from '../types';
import { buildSceneSnapshot } from './systemPrompt';

const store = () => useEditorStore.getState();

const vec3 = z.array(z.number()).length(3).describe('[x, y, z]');
const asVec3 = (value: number[]) => value as Vector3Tuple;

const NODE_LABELS = [
  'Start',
  'Update',
  'Key Down',
  'Key Up',
  'Custom Event',
  'Collision Enter',
  'Branch',
  'Compare',
  'AND',
  'OR',
  'Add',
  'Clamp',
  'Lerp',
  'Vector3',
  'Translate',
  'Rotate',
  'Fire Event',
  'Apply Force',
  'Spawn Object',
  'Play Sound',
] as const;

const NODE_CATEGORY: Record<(typeof NODE_LABELS)[number], GraphNodeCategory> = {
  Start: 'Events',
  Update: 'Events',
  'Key Down': 'Events',
  'Key Up': 'Events',
  'Custom Event': 'Events',
  'Collision Enter': 'Events',
  Branch: 'Logic',
  Compare: 'Logic',
  AND: 'Logic',
  OR: 'Logic',
  Add: 'Math',
  Clamp: 'Math',
  Lerp: 'Math',
  Vector3: 'Values',
  Translate: 'Runtime',
  Rotate: 'Runtime',
  'Fire Event': 'Runtime',
  'Apply Force': 'Physics',
  'Spawn Object': 'Runtime',
  'Play Sound': 'Audio',
};

const KEY_CODES = [
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
] as const;

const findObject = (id: string) => selectActiveObjects(store()).find((object) => object.id === id);
const findBlueprint = (id: string) => store().blueprints.find((blueprint) => blueprint.id === id);
const findScene = (id: string) => store().scenes.find((scene) => scene.id === id);

export const engineTools = {
  list_scene: tool({
    description: 'List the current (active) scene objects, all scenes, blueprints and runtime state. Call this before acting if unsure.',
    inputSchema: z.object({}),
    execute: async () => JSON.stringify(buildSceneSnapshot()),
  }),

  list_scenes: tool({
    description: 'List all scenes in the project and which one is active. Object edits always apply to the active scene.',
    inputSchema: z.object({}),
    execute: async () => {
      const state = store();
      return JSON.stringify({
        activeSceneId: state.activeSceneId,
        scenes: state.scenes.map((scene) => ({ id: scene.id, name: scene.name, objectCount: scene.objects.length })),
      });
    },
  }),

  create_scene: tool({
    description: 'Create a new empty scene. Returns its id. Does NOT switch to it — call switch_scene to make it active.',
    inputSchema: z.object({ name: z.string().optional() }),
    execute: async ({ name }) => {
      const id = store().createScene(name);
      return `Created scene "${findScene(id)?.name}" with id ${id}.`;
    },
  }),

  switch_scene: tool({
    description: 'Make a scene the active scene (subsequent object edits apply to it). Blocked while Play mode is running.',
    inputSchema: z.object({ id: z.string() }),
    execute: async ({ id }) => {
      if (!findScene(id)) return `No scene with id ${id}.`;
      if (store().isPlaying) return 'Cannot switch scenes while Play mode is running. Stop play first.';
      store().setActiveScene(id);
      return `Switched to scene ${id}.`;
    },
  }),

  rename_scene: tool({
    description: 'Rename a scene.',
    inputSchema: z.object({ id: z.string(), name: z.string() }),
    execute: async ({ id, name }) => {
      if (!findScene(id)) return `No scene with id ${id}.`;
      store().renameScene(id, name);
      return `Renamed scene ${id} to "${name}".`;
    },
  }),

  create_object: tool({
    description: 'Create a new scene object. Returns its id. Spawn dynamic physics objects slightly above the ground (y > 0).',
    inputSchema: z.object({
      kind: z.enum(['empty', 'cube', 'sphere', 'capsule', 'plane', 'light', 'camera']),
      name: z.string().optional(),
      position: vec3.optional(),
      color: z.string().optional().describe('Hex color, e.g. #FF6B6B'),
      physics: z
        .object({
          enabled: z.boolean().optional(),
          bodyType: z.enum(['dynamic', 'fixed', 'kinematic']).optional(),
          collider: z.enum(['box', 'sphere', 'capsule']).optional(),
        })
        .optional(),
    }),
    execute: async ({ kind, name, position, color, physics }) => {
      const id = store().createObjectWithProps(kind as SceneObjectKind, {
        name,
        position: position ? asVec3(position) : undefined,
        color,
        physics: physics ? { ...physics, enabled: physics.enabled ?? true } : undefined,
      });
      return `Created ${kind} "${findObject(id)?.name}" with id ${id}.`;
    },
  }),

  update_transform: tool({
    description: 'Update an object\'s position, rotation (radians) and/or scale.',
    inputSchema: z.object({
      id: z.string(),
      position: vec3.optional(),
      rotation: vec3.optional(),
      scale: vec3.optional(),
    }),
    execute: async ({ id, position, rotation, scale }) => {
      if (!findObject(id)) return `No object with id ${id}.`;
      if (position) store().updateTransform(id, 'position', asVec3(position));
      if (rotation) store().updateTransform(id, 'rotation', asVec3(rotation));
      if (scale) store().updateTransform(id, 'scale', asVec3(scale));
      return `Updated transform of ${id}.`;
    },
  }),

  update_renderer: tool({
    description: 'Update an object\'s material (color hex, metalness 0-1, roughness 0-1).',
    inputSchema: z.object({
      id: z.string(),
      color: z.string().optional(),
      metalness: z.number().min(0).max(1).optional(),
      roughness: z.number().min(0).max(1).optional(),
    }),
    execute: async ({ id, ...patch }) => {
      const object = findObject(id);
      if (!object) return `No object with id ${id}.`;
      if (!object.renderer) return `Object ${id} (${object.kind}) has no mesh renderer.`;
      store().updateRenderer(id, patch);
      return `Updated material of ${id}.`;
    },
  }),

  set_physics: tool({
    description: 'Enable/configure physics on an object. Use bodyType "dynamic" for objects that should move or fall, "fixed" for static ground/walls.',
    inputSchema: z.object({
      id: z.string(),
      enabled: z.boolean().optional(),
      bodyType: z.enum(['dynamic', 'fixed', 'kinematic']).optional(),
      collider: z.enum(['box', 'sphere', 'capsule']).optional(),
      mass: z.number().optional(),
      gravityScale: z.number().optional(),
      friction: z.number().optional(),
      linearDamping: z.number().optional(),
      angularDamping: z.number().optional(),
    }),
    execute: async ({ id, ...patch }) => {
      const object = findObject(id);
      if (!object) return `No object with id ${id}.`;
      if (!object.physics) {
        // togglePhysics seeds a default physics component (enabled = true).
        store().togglePhysics(id);
      }
      store().updatePhysics(id, {
        ...patch,
        bodyType: patch.bodyType as RigidBodyType | undefined,
        collider: patch.collider as ColliderType | undefined,
      });
      return `Updated physics of ${id}.`;
    },
  }),

  rename_object: tool({
    description: 'Rename a scene object.',
    inputSchema: z.object({ id: z.string(), name: z.string() }),
    execute: async ({ id, name }) => {
      if (!findObject(id)) return `No object with id ${id}.`;
      store().renameObject(id, name);
      return `Renamed ${id} to "${name}".`;
    },
  }),

  select_object: tool({
    description: 'Select an object so it shows in the inspector.',
    inputSchema: z.object({ id: z.string() }),
    execute: async ({ id }) => {
      if (!findObject(id)) return `No object with id ${id}.`;
      store().selectObject(id);
      return `Selected ${id}.`;
    },
  }),

  delete_object: tool({
    description: 'Delete a scene object (and its children).',
    inputSchema: z.object({ id: z.string() }),
    execute: async ({ id }) => {
      if (!findObject(id)) return `No object with id ${id}.`;
      store().deleteObject(id);
      return `Deleted ${id}.`;
    },
  }),

  create_blueprint: tool({
    description: 'Create a new reusable blueprint (visual-scripting graph). Returns its blueprintId. Starts with a Start and Update node.',
    inputSchema: z.object({ name: z.string().optional(), description: z.string().optional() }),
    execute: async ({ name, description }) => {
      const { blueprintId } = store().createBlueprintNamed(name, description);
      return `Created blueprint "${findBlueprint(blueprintId)?.name}" with blueprintId ${blueprintId}.`;
    },
  }),

  add_node: tool({
    description: 'Add a node to a blueprint graph. Returns its nodeId. For Key Down/Up set keyCode; for Translate/Rotate set axis and amount; for Custom Event/Fire Event set eventName.',
    inputSchema: z.object({
      blueprintId: z.string(),
      type: z.enum(NODE_LABELS),
      keyCode: z.enum(KEY_CODES).optional(),
      axis: z.enum(['x', 'y', 'z']).optional(),
      amount: z.number().optional(),
      eventName: z.string().optional(),
    }),
    execute: async ({ blueprintId, type, keyCode, axis, amount, eventName }) => {
      if (!findBlueprint(blueprintId)) return `No blueprint with id ${blueprintId}.`;
      const nodeId = store().addGraphNodeToBlueprint(blueprintId, type, NODE_CATEGORY[type], {
        keyCode,
        axis,
        amount,
        eventName,
      });
      return `Added "${type}" node with id ${nodeId} to blueprint ${blueprintId}.`;
    },
  }),

  connect_nodes: tool({
    description: 'Connect two nodes in a blueprint so execution flows sourceId -> targetId (e.g. a Key Down event into a Translate action).',
    inputSchema: z.object({ blueprintId: z.string(), sourceId: z.string(), targetId: z.string() }),
    execute: async ({ blueprintId, sourceId, targetId }) => {
      if (!findBlueprint(blueprintId)) return `No blueprint with id ${blueprintId}.`;
      store().connectGraphNodes(blueprintId, sourceId, targetId);
      return `Connected ${sourceId} -> ${targetId}.`;
    },
  }),

  update_node: tool({
    description: 'Update a node\'s parameters (keyCode, axis, amount, eventName).',
    inputSchema: z.object({
      blueprintId: z.string(),
      nodeId: z.string(),
      keyCode: z.enum(KEY_CODES).optional(),
      axis: z.enum(['x', 'y', 'z']).optional(),
      amount: z.number().optional(),
      eventName: z.string().optional(),
    }),
    execute: async ({ blueprintId, nodeId, ...patch }) => {
      if (!findBlueprint(blueprintId)) return `No blueprint with id ${blueprintId}.`;
      store().setActiveBlueprint(blueprintId);
      store().updateGraphNodeData(nodeId, patch);
      return `Updated node ${nodeId}.`;
    },
  }),

  auto_layout: tool({
    description: 'Tidy up the currently active blueprint graph: arrange nodes left-to-right by execution flow and snap them to a grid. Call this after building or editing a graph.',
    inputSchema: z.object({ blueprintId: z.string().optional() }),
    execute: async ({ blueprintId }) => {
      if (blueprintId) {
        if (!findBlueprint(blueprintId)) return `No blueprint with id ${blueprintId}.`;
        store().setActiveBlueprint(blueprintId);
      }
      store().autoLayoutActiveGraph();
      return 'Arranged the graph nodes on a grid.';
    },
  }),

  attach_blueprint: tool({
    description: 'Attach a blueprint to a scene object so the graph runs for that object during Play.',
    inputSchema: z.object({ objectId: z.string(), blueprintId: z.string() }),
    execute: async ({ objectId, blueprintId }) => {
      if (!findObject(objectId)) return `No object with id ${objectId}.`;
      if (!findBlueprint(blueprintId)) return `No blueprint with id ${blueprintId}.`;
      store().attachScript(objectId, blueprintId);
      return `Attached blueprint ${blueprintId} to object ${objectId}.`;
    },
  }),

  set_playing: tool({
    description: 'Start or stop the runtime preview (Play mode).',
    inputSchema: z.object({ playing: z.boolean() }),
    execute: async ({ playing }) => {
      store().setPlaying(playing);
      return playing ? 'Started Play mode.' : 'Stopped Play mode.';
    },
  }),

  fire_event: tool({
    description: 'Fire a custom event by name during Play mode (triggers matching Custom Event nodes).',
    inputSchema: z.object({ eventName: z.string() }),
    execute: async ({ eventName }) => {
      store().fireCustomEvent(eventName);
      return `Fired event "${eventName}".`;
    },
  }),
};

export type EngineTools = typeof engineTools;
