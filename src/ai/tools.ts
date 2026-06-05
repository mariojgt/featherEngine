import { tool } from 'ai';
import { z } from 'zod';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import type {
  ColliderType,
  CinematicAction,
  CinematicActionType,
  GraphNodeCategory,
  NodeForgeNodeData,
  GraphValue,
  GraphValueType,
  InventorySlot,
  MaterialDefinition,
  MeshRendererComponent,
  RigidBodyType,
  SceneEnvironmentSettings,
  SceneObjectKind,
  TerrainComponent,
  UIElement,
  Vector3Tuple,
} from '../types';
import { buildSceneSnapshot, type SceneSnapshotDetail } from './systemPrompt';
import { createThirdPersonTemplate } from '../project/thirdPersonTemplate';
import { createFirstPersonTemplate } from '../project/firstPersonTemplate';
import { createFilmModeTemplate } from '../project/filmModeTemplate';
import { createDrivingTemplate } from '../project/drivingTemplate';
import { createStoryboardCinematic, STORYBOARD_PRESETS } from '../project/cinematicStoryboard';

const store = () => useEditorStore.getState();
const projectStore = () => useProjectStore.getState();

const vec3 = z.array(z.number()).length(3).describe('[x, y, z]');
const asVec3 = (value: number[]) => value as Vector3Tuple;
const VALUE_TYPES = ['number', 'string', 'boolean', 'vector3'] as const;
const graphValue = z.union([z.number(), z.string(), z.boolean(), vec3]);
const asGraphValue = (value: string | number | boolean | number[]) =>
  (Array.isArray(value) ? asVec3(value) : value) as GraphValue;
const terrainFoliagePatchSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(['grass', 'trees', 'mixed']).optional(),
  density: z.number().min(0).max(1).optional().describe('Grass/shrub density 0..1.'),
  treeDensity: z.number().min(0).max(1).optional().describe('Tree density 0..1.'),
  minScale: z.number().min(0.1).max(12).optional(),
  maxScale: z.number().min(0.1).max(16).optional(),
  slopeLimit: z.number().min(0).max(1).optional().describe('Minimum normal Y for placement; higher avoids steep slopes.'),
  grassMesh: z.enum(['blade', 'cross', 'tuft']).optional(),
  treeMesh: z.enum(['cone', 'round']).optional(),
  grassModelAssetId: z.string().optional().describe('Optional model asset id to render custom grass/clumps, or "" to clear.'),
  treeModelAssetId: z.string().optional().describe('Optional model asset id to render custom trees, or "" to clear.'),
  grassColor: z.string().optional(),
  trunkColor: z.string().optional(),
  treeColor: z.string().optional(),
});
const terrainMaterialLayerPatchSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  color: z.string().optional(),
  textureAssetId: z.string().optional().describe('Optional image asset id for the layer base texture, or "" to clear.'),
  normalMapAssetId: z.string().optional().describe('Optional image asset id for the layer normal map, or "" to clear.'),
});
const terrainPatchSchema = z.object({
  enabled: z.boolean().optional(),
  size: z.number().min(32).max(8192).optional().describe('Total terrain width/depth in world units.'),
  chunkSize: z.number().min(8).max(512).optional().describe('Streamed chunk width/depth in world units.'),
  resolution: z.number().int().min(4).max(64).optional().describe('Segments per chunk edge. Higher = more detail/cost.'),
  streamRadius: z.number().int().min(1).max(10).optional().describe('Render chunk rings around the camera/player.'),
  physicsRadius: z.number().int().min(1).max(5).optional().describe('Physics chunk rings around characters/dynamic bodies.'),
  seed: z.number().int().optional(),
  heightScale: z.number().min(0).max(256).optional(),
  frequency: z.number().min(0.001).max(0.25).optional(),
  octaves: z.number().int().min(1).max(8).optional(),
  persistence: z.number().min(0.05).max(0.95).optional(),
  lacunarity: z.number().min(1.1).max(4).optional(),
  editSpacing: z.number().min(0.5).max(16).optional().describe('World units between persistent sculpt/paint samples.'),
  lowColor: z.string().optional(),
  midColor: z.string().optional(),
  highColor: z.string().optional(),
  materialLayers: z.array(terrainMaterialLayerPatchSchema).min(1).max(8).optional(),
  foliage: terrainFoliagePatchSchema.optional(),
});
const environmentPatchSchema = z.object({
  skyMode: z.enum(['color', 'procedural', 'image']).optional(),
  backgroundColor: z.string().optional().describe('Flat/fallback background hex color.'),
  skyTopColor: z.string().optional().describe('Procedural sky zenith hex color.'),
  skyHorizonColor: z.string().optional().describe('Procedural horizon hex color.'),
  skyGroundColor: z.string().optional().describe('Procedural lower-sky/ground-tint hex color.'),
  skyTextureAssetId: z.string().optional().describe('Image asset id for an equirectangular panorama, or "" to clear.'),
  environmentMapAssetId: z
    .string()
    .optional()
    .describe('Image asset id of an equirectangular panorama/HDRI used as the image-based-lighting (IBL) source — real reflections + ambient sampled from it, replacing the studio light rig. Independent of skyMode. "" to clear (back to studio).'),
  skyRotation: z.number().optional().describe('Sky dome yaw in degrees.'),
  environmentIntensity: z.number().min(0).optional().describe('Built-in ambient/environment light strength.'),
  sunColor: z.string().optional().describe('Directional sun hex color.'),
  sunIntensity: z.number().min(0).optional().describe('Directional sun strength.'),
  sunAzimuth: z.number().optional().describe('Sun compass angle in degrees.'),
  sunElevation: z.number().optional().describe('Sun height in degrees.'),
  fogEnabled: z.boolean().optional(),
  fogColor: z.string().optional(),
  fogNear: z.number().min(0).optional(),
  fogFar: z.number().min(1).optional(),
});
const cinematicActionSchema = z.object({
  type: z.enum(['camera', 'transform', 'visibility', 'spawn', 'animation', 'sound', 'event', 'fade', 'material', 'timeDilation', 'subsequence']),
  time: z.number().min(0).describe('Seconds from cinematic start.'),
  duration: z.number().min(0).optional().describe('Seconds this beat lasts; use for camera/transform/fade interpolation.'),
  ease: z.enum(['linear', 'smooth', 'in', 'out']).optional().describe('Interpolation curve for camera/transform/fade beats. Default smooth (ease in-out); use linear for constant-speed moves.'),
  interpolation: z.enum(['smooth', 'linear', 'hold']).optional().describe('Keyframe interpolation for camera/object/material tracks. smooth = spline/eased, linear = straight, hold = stepped/no interpolation.'),
  blend: z.number().min(0).max(10).optional().describe('Camera beats only: seconds to glide from the previous camera shot into this one (0 = hard cut, >0 = smooth dolly/blend between shots).'),
  keyframes: z
    .array(
      z.object({
        time: z.number().min(0).describe('Absolute seconds from cinematic start.'),
        position: vec3,
        lookAt: vec3,
        fov: z.number().min(10).max(140),
        focusDistance: z.number().min(0).optional().describe('Depth-of-field focus distance (world units ahead of camera). Splines across keyframes for rack-focus pulls.'),
        aperture: z.number().min(0).max(12).optional().describe('Depth-of-field blur strength (bokeh). 0 = sharp, 3–6 = shallow cinematic focus.'),
      }),
    )
    .optional()
    .describe('Camera beats only: an animated camera track. With ≥2 keyframes the camera flies smoothly (spline) through them; overrides position/lookAt/fov. Prefer this for moving camera shots.'),
  transformKeyframes: z
    .array(
      z.object({
        time: z.number().min(0).describe('Absolute seconds from cinematic start.'),
        position: vec3,
        rotation: vec3,
        scale: vec3,
      }),
    )
    .optional()
    .describe('Transform beats only: an animated object track (requires objectId). With ≥2 keyframes the object flies smoothly (spline) through them; overrides from/to. Prefer this for moving/animating an object.'),
  materialKeyframes: z
    .array(
      z.object({
        time: z.number().min(0),
        color: z.string().optional(),
        metalness: z.number().min(0).max(1).optional(),
        roughness: z.number().min(0).max(1).optional(),
        emissiveColor: z.string().optional(),
        emissiveIntensity: z.number().min(0).max(20).optional(),
      }),
    )
    .optional()
    .describe('Material beats only: keyframe color/metalness/roughness/emissive/glow over time.'),
  label: z.string().optional(),
  objectId: z.string().optional().describe('Target scene object id for transform/visibility/animation.'),
  cinematicId: z.string().optional().describe('Subsequence beats only: child cinematic id to nest in this sequence.'),
  prefabId: z.string().optional().describe('Prefab to instantiate temporarily during the cinematic.'),
  spawnKind: z.enum(['empty', 'cube', 'sphere', 'capsule', 'plane', 'terrain', 'light', 'camera']).optional(),
  name: z.string().optional(),
  fromPosition: vec3.optional(),
  toPosition: vec3.optional(),
  fromRotation: vec3.optional(),
  toRotation: vec3.optional(),
  fromScale: vec3.optional(),
  toScale: vec3.optional(),
  position: vec3.optional(),
  rotation: vec3.optional(),
  scale: vec3.optional(),
  lookAt: vec3.optional(),
  fov: z.number().min(10).max(140).optional(),
  focusDistance: z.number().min(0).optional().describe('Camera beats only: depth-of-field focus distance (world units ahead of camera). Blends with the next shot for rack-focus pulls. Needs aperture > 0.'),
  aperture: z.number().min(0).max(12).optional().describe('Camera beats only: depth-of-field blur strength (bokeh). 0 = everything sharp, 3–6 = shallow cinematic focus.'),
  visible: z.boolean().optional(),
  animationId: z.string().optional(),
  animationSpeed: z.number().min(0.05).max(5).optional(),
  soundId: z.string().optional(),
  eventName: z.string().optional(),
  fadeFrom: z.number().min(0).max(1).optional(),
  fadeTo: z.number().min(0).max(1).optional(),
  fadeColor: z.string().optional(),
  fromMaterial: z.object({
    color: z.string().optional(),
    metalness: z.number().min(0).max(1).optional(),
    roughness: z.number().min(0).max(1).optional(),
    emissiveColor: z.string().optional(),
    emissiveIntensity: z.number().min(0).max(20).optional(),
  }).optional(),
  toMaterial: z.object({
    color: z.string().optional(),
    metalness: z.number().min(0).max(1).optional(),
    roughness: z.number().min(0).max(1).optional(),
    emissiveColor: z.string().optional(),
    emissiveIntensity: z.number().min(0).max(20).optional(),
  }).optional(),
  timeScale: z.number().min(0.05).max(4).optional().describe('Time Dilation beats only: speed multiplier for cinematic playback.'),
  fromTimeScale: z.number().min(0.05).max(4).optional(),
  toTimeScale: z.number().min(0.05).max(4).optional(),
});

function normalizeCinematicAction(input: z.infer<typeof cinematicActionSchema>): Omit<CinematicAction, 'id'> {
  return {
    ...input,
    type: input.type as CinematicActionType,
    fromPosition: input.fromPosition ? asVec3(input.fromPosition) : undefined,
    toPosition: input.toPosition ? asVec3(input.toPosition) : undefined,
    fromRotation: input.fromRotation ? asVec3(input.fromRotation) : undefined,
    toRotation: input.toRotation ? asVec3(input.toRotation) : undefined,
    fromScale: input.fromScale ? asVec3(input.fromScale) : undefined,
    toScale: input.toScale ? asVec3(input.toScale) : undefined,
    position: input.position ? asVec3(input.position) : undefined,
    rotation: input.rotation ? asVec3(input.rotation) : undefined,
    scale: input.scale ? asVec3(input.scale) : undefined,
    lookAt: input.lookAt ? asVec3(input.lookAt) : undefined,
    keyframes: input.keyframes
      ? input.keyframes.map((frame) => ({ time: frame.time, position: asVec3(frame.position), lookAt: asVec3(frame.lookAt), fov: frame.fov, focusDistance: frame.focusDistance, aperture: frame.aperture }))
      : undefined,
    transformKeyframes: input.transformKeyframes
      ? input.transformKeyframes.map((frame) => ({ time: frame.time, position: asVec3(frame.position), rotation: asVec3(frame.rotation), scale: asVec3(frame.scale) }))
      : undefined,
  };
}

const NODE_LABELS = [
  'Start',
  'Update',
  'Key Down',
  'Key Up',
  'Custom Event',
  'Collision Enter',
  'Trigger Enter',
  'Trigger Exit',
  'Interact',
  'On Receive Damage',
  'Branch',
  'Compare',
  'AND',
  'OR',
  'Add',
  'Clamp',
  'Lerp',
  'Number',
  'String',
  'Boolean',
  'Vector3',
  'Get Variable',
  'Set Variable',
  'Data Asset Lookup',
  'Translate',
  'Rotate',
  'Fire Event',
  'Apply Force',
  'Spawn Object',
  'Destroy Object',
  'Play Sound',
  'Set Material Color',
  'Set Material Property',
  'Get Material Color',
  'Get Material Property',
  'Set Anim Float',
  'Set Anim Bool',
  'Set Anim Trigger',
  'Get Anim Param',
  'Get Anim State',
  'Get Move Input',
  'Get Drive Input',
  'Get Vehicle Speed',
  'Move',
  'Drive',
  'Jump',
  'Is Grounded',
  'Set Camera',
  'Set Ragdoll',
  'Spawn Projectile',
  'Spawn Attached',
  'Play Animation',
  'Play Cinematic',
  'Set Movement Mode',
  'Set Visible',
  'Distance To Player',
  'Direction To Player',
  'Face Player',
  'Cooldown',
  'For Loop',
  'Random',
  'Load Scene',
  'Camera Shake',
  'Set Quality',
  'Move To',
  'Enter Vehicle',
  'Exit Vehicle',
  'Fracture',
  'Apply Damage',
  'Save Game',
  'Load Game',
  'Clear Save',
  'Print',
  'Show UI',
  'Hide UI',
  'Set UI Text',
  'Get Object Var',
  'Set Object Var',
  'NOT',
  'Do Once',
  'Delay',
  'Subtract',
  'Multiply',
  'Divide',
  'Modulo',
  'Distance',
  'Add Vectors',
  'Subtract Vectors',
  'Scale Vector',
  'Normalize',
  'Make Vector3',
  'Get Position',
  'Get Rotation',
  'Get Scale',
  'Find Actor By Blueprint',
  'Find Actor By Tag',
  'Set Position',
  'Set Rotation',
  'Set Scale',
  'Look At',
] as const;

const NODE_CATEGORY: Record<(typeof NODE_LABELS)[number], GraphNodeCategory> = {
  Start: 'Events',
  Update: 'Events',
  'Key Down': 'Events',
  'Key Up': 'Events',
  'Custom Event': 'Events',
  'Collision Enter': 'Events',
  'Trigger Enter': 'Events',
  'Trigger Exit': 'Events',
  Interact: 'Events',
  'On Receive Damage': 'Events',
  Branch: 'Logic',
  Compare: 'Logic',
  AND: 'Logic',
  OR: 'Logic',
  Add: 'Math',
  Clamp: 'Math',
  Lerp: 'Math',
  Number: 'Values',
  String: 'Values',
  Boolean: 'Values',
  Vector3: 'Values',
  'Get Variable': 'Variables',
  'Set Variable': 'Variables',
  'Data Asset Lookup': 'Data',
  Translate: 'Runtime',
  Rotate: 'Runtime',
  'Fire Event': 'Runtime',
  'Apply Force': 'Physics',
  'Spawn Object': 'Runtime',
  'Destroy Object': 'Runtime',
  'Play Sound': 'Audio',
  'Set Material Color': 'Runtime',
  'Set Material Property': 'Runtime',
  'Get Material Color': 'Runtime',
  'Get Material Property': 'Runtime',
  'Set Anim Float': 'Runtime',
  'Set Anim Bool': 'Runtime',
  'Set Anim Trigger': 'Runtime',
  'Get Anim Param': 'Runtime',
  'Get Anim State': 'Runtime',
  'Get Move Input': 'Runtime',
  'Get Drive Input': 'Runtime',
  'Get Vehicle Speed': 'Runtime',
  Move: 'Runtime',
  Drive: 'Runtime',
  Jump: 'Runtime',
  'Is Grounded': 'Runtime',
  'Set Camera': 'Runtime',
  'Set Ragdoll': 'Runtime',
  'Spawn Projectile': 'Runtime',
  'Spawn Attached': 'Runtime',
  'Play Animation': 'Runtime',
  'Play Cinematic': 'Runtime',
  'Set Movement Mode': 'Runtime',
  'Set Visible': 'Runtime',
  'Distance To Player': 'Runtime',
  'Direction To Player': 'Runtime',
  'Face Player': 'Runtime',
  Cooldown: 'Logic',
  'For Loop': 'Logic',
  Random: 'Values',
  'Load Scene': 'Runtime',
  'Camera Shake': 'Runtime',
  'Set Quality': 'Runtime',
  'Move To': 'Runtime',
  'Enter Vehicle': 'Runtime',
  'Exit Vehicle': 'Runtime',
  Fracture: 'Physics',
  'Apply Damage': 'Runtime',
  'Save Game': 'Persistence',
  'Load Game': 'Persistence',
  'Clear Save': 'Persistence',
  Print: 'Runtime',
  'Show UI': 'UI',
  'Hide UI': 'UI',
  'Set UI Text': 'UI',
  'Get Object Var': 'Variables',
  'Set Object Var': 'Variables',
  NOT: 'Logic',
  'Do Once': 'Logic',
  Delay: 'Logic',
  Subtract: 'Math',
  Multiply: 'Math',
  Divide: 'Math',
  Modulo: 'Math',
  Distance: 'Math',
  'Add Vectors': 'Math',
  'Subtract Vectors': 'Math',
  'Scale Vector': 'Math',
  Normalize: 'Math',
  'Make Vector3': 'Math',
  'Get Position': 'Runtime',
  'Get Rotation': 'Runtime',
  'Get Scale': 'Runtime',
  'Find Actor By Blueprint': 'Runtime',
  'Find Actor By Tag': 'Runtime',
  'Set Position': 'Runtime',
  'Set Rotation': 'Runtime',
  'Set Scale': 'Runtime',
  'Look At': 'Runtime',
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
const findAsset = (id: string) => store().assets.find((asset) => asset.id === id);
const findVariable = (id: string) => store().variables.find((variable) => variable.id === id);
const findDataAsset = (id: string) => store().dataAssets.find((table) => table.id === id);
const findMaterial = (id: string) => store().materials.find((material) => material.id === id);
const findUIDocument = (id: string) => store().uiDocuments.find((doc) => doc.id === id);
const findUIElement = (root: UIElement, id: string): UIElement | undefined => {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findUIElement(child, id);
    if (found) return found;
  }
  return undefined;
};
const findController = (id: string) => store().animatorControllers.find((controller) => controller.id === id);
const findPrefab = (id: string) => store().prefabs.find((prefab) => prefab.id === id);
const findBlueprintGraph = (blueprintId: string) => {
  const blueprint = findBlueprint(blueprintId);
  const graph = blueprint ? store().graphs.find((item) => item.id === blueprint.graphId) : undefined;
  return blueprint && graph ? { blueprint, graph } : undefined;
};

const ensureNumberVariable = (name: string, defaultValue: number) => {
  let variable = store().variables.find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (!variable) {
    const id = store().createVariable(name, 'number', false);
    store().updateVariable(id, { defaultValue });
    variable = store().variables.find((item) => item.id === id);
  }
  return variable?.name ?? name;
};

const setUIStyle = (documentId: string, elementId: string, style: Partial<UIElement['style']>) => {
  const doc = findUIDocument(documentId);
  const element = doc ? findUIElement(doc.root, elementId) : undefined;
  if (!element) return;
  store().updateUIElement(documentId, elementId, {
    style: {
      ...element.style,
      ...style,
      custom: { ...(element.style.custom ?? {}), ...(style.custom ?? {}) },
    },
  });
};

export const engineTools = {
  list_scene: tool({
    description: 'List the current project snapshot. Defaults to tiny; request compact/standard/full only when extra graph or asset detail is needed.',
    inputSchema: z.object({ detail: z.enum(['tiny', 'compact', 'standard', 'full']).optional(), limit: z.number().int().min(1).max(200).optional() }),
    execute: async ({ detail, limit }) => JSON.stringify(buildSceneSnapshot({ detail: detail as SceneSnapshotDetail | undefined, limit })),
  }),

  inspect_object: tool({
    description:
      'Inspect one active-scene object with full components plus related blueprint/controller/material summaries. Use this instead of full scene snapshots when one object is the focus.',
    inputSchema: z.object({ objectId: z.string() }),
    execute: async ({ objectId }) => {
      const object = findObject(objectId);
      if (!object) return `No object with id ${objectId}.`;
      const blueprint = object.script?.blueprintId ? findBlueprintGraph(object.script.blueprintId) : undefined;
      const controller = object.animator?.controllerId ? findController(object.animator.controllerId) : undefined;
      const material = object.renderer?.materialId ? findMaterial(object.renderer.materialId) : undefined;
      const model = object.renderer?.modelAssetId ? findAsset(object.renderer.modelAssetId) : undefined;
      return JSON.stringify({
        object,
        model: model ? { id: model.id, name: model.name, type: model.type } : null,
        material: material
          ? { id: material.id, name: material.name, color: material.color, metalness: material.metalness, roughness: material.roughness }
          : null,
        blueprint: blueprint
          ? {
              id: blueprint.blueprint.id,
              name: blueprint.blueprint.name,
              nodes: blueprint.graph.nodes.map((node) => ({ id: node.id, position: node.position, data: node.data })),
              edges: blueprint.graph.edges,
            }
          : null,
        animatorController: controller
          ? {
              id: controller.id,
              name: controller.name,
              skeletonId: controller.skeletonId,
              parameters: controller.parameters,
              states: controller.states,
              transitions: controller.transitions,
            }
          : null,
      });
    },
  }),

  inspect_blueprint: tool({
    description: 'Inspect a blueprint node graph by blueprintId, including nodes and edges. Use for scripting/debugging logic.',
    inputSchema: z.object({ blueprintId: z.string() }),
    execute: async ({ blueprintId }) => {
      const found = findBlueprintGraph(blueprintId);
      if (!found) return `No blueprint with id ${blueprintId}.`;
      return JSON.stringify({ blueprint: found.blueprint, nodes: found.graph.nodes, edges: found.graph.edges });
    },
  }),

  inspect_animator_controller: tool({
    description: 'Inspect an Animator Controller by controllerId, including parameters, states, transitions, and clip names.',
    inputSchema: z.object({ controllerId: z.string() }),
    execute: async ({ controllerId }) => {
      const controller = findController(controllerId);
      if (!controller) return `No controller with id ${controllerId}.`;
      const animationsById = new Map(store().animations.map((animation) => [animation.id, animation]));
      return JSON.stringify({
        ...controller,
        states: controller.states.map((state) => ({
          ...state,
          animationName: state.animationId ? animationsById.get(state.animationId)?.name ?? null : null,
        })),
      });
    },
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
    description: 'Create a new scene object. Returns its id. Spawn dynamic physics objects slightly above the ground (y > 0). Pass parentId to nest it under another object (e.g. building a composite character).',
    inputSchema: z.object({
      kind: z.enum(['empty', 'cube', 'sphere', 'capsule', 'plane', 'terrain', 'light', 'camera']),
      name: z.string().optional(),
      position: vec3.optional(),
      color: z.string().optional().describe('Hex color, e.g. #FF6B6B'),
      parentId: z.string().optional().describe('Nest the new object under this existing object.'),
      terrain: terrainPatchSchema.optional().describe('Only for kind:"terrain": procedural terrain/chunk/foliage settings.'),
      physics: z
        .object({
          enabled: z.boolean().optional(),
          bodyType: z.enum(['dynamic', 'fixed', 'kinematic']).optional(),
          collider: z.enum(['box', 'sphere', 'capsule', 'mesh', 'convex']).optional(),
        })
        .optional(),
    }),
    execute: async ({ kind, name, position, color, parentId, physics, terrain }) => {
      if (parentId && !findObject(parentId)) return `No object with id ${parentId} to parent under.`;
      const id = store().createObjectWithProps(kind as SceneObjectKind, {
        name,
        position: position ? asVec3(position) : undefined,
        color,
        parentId,
        terrain: terrain as Partial<TerrainComponent> | undefined,
        physics: physics ? { ...physics, enabled: physics.enabled ?? true } : undefined,
      });
      return `Created ${kind} "${findObject(id)?.name}" with id ${id}${parentId ? ` (nested under ${parentId})` : ''}.`;
    },
  }),

  create_terrain: tool({
    description:
      'Create the MVP open-world terrain actor: procedural streamed terrain chunks, heightfield physics near active bodies, and optional instanced foliage. Returns the terrain object id.',
    inputSchema: terrainPatchSchema.extend({
      name: z.string().optional(),
      position: vec3.optional().describe('Terrain origin. Default [0,0,0].'),
    }),
    execute: async ({ name, position, ...terrain }) => {
      const id = store().createObjectWithProps('terrain', {
        name: name ?? 'Open World Terrain',
        position: position ? asVec3(position) : [0, 0, 0],
        terrain: terrain as Partial<TerrainComponent>,
        physics: { enabled: true, bodyType: 'fixed', collider: 'mesh' },
      });
      return `Created streamed terrain "${findObject(id)?.name}" with id ${id}.`;
    },
  }),

  update_terrain: tool({
    description:
      'Update a terrain object created with create_terrain/create_object kind:"terrain". Controls chunk streaming, procedural height, editable material layers, and instanced/custom foliage.',
    inputSchema: terrainPatchSchema.extend({ objectId: z.string() }),
    execute: async ({ objectId, ...patch }) => {
      const object = findObject(objectId);
      if (!object) return `No object with id ${objectId}.`;
      if (!object.terrain) return `Object ${objectId} is not a terrain object.`;
      store().updateTerrain(objectId, patch as Partial<TerrainComponent>);
      return `Updated terrain ${objectId}.`;
    },
  }),

  sculpt_terrain: tool({
    description:
      'Apply one terrain sculpt brush stroke at a world-space point. Use this for authored hills, paths, flat pads, ramps, and smoothing after create_terrain.',
    inputSchema: z.object({
      objectId: z.string(),
      worldPosition: vec3.describe('World-space brush center [x,y,z]. The y value is ignored; x/z choose the terrain point.'),
      operation: z.enum(['raise', 'lower', 'flatten', 'smooth']).optional(),
      radius: z.number().min(0.5).max(256).optional(),
      strength: z.number().min(0).max(64).optional(),
      flattenHeight: z.number().optional().describe('Local terrain height used by flatten.'),
    }),
    execute: async ({ objectId, worldPosition, operation, radius, strength, flattenHeight }) => {
      const object = findObject(objectId);
      if (!object) return `No object with id ${objectId}.`;
      if (!object.terrain) return `Object ${objectId} is not a terrain object.`;
      store().sculptTerrainAt(objectId, asVec3(worldPosition), { operation, radius, strength, flattenHeight });
      return `Sculpted terrain ${objectId}.`;
    },
  }),

  paint_terrain: tool({
    description:
      'Paint one terrain material layer at a world-space point. Use the layer id/name from the snapshot or create/update layers first.',
    inputSchema: z.object({
      objectId: z.string(),
      worldPosition: vec3.describe('World-space brush center [x,y,z]. The y value is ignored; x/z choose the terrain point.'),
      layerId: z.string().optional(),
      layerName: z.string().optional(),
      radius: z.number().min(0.5).max(256).optional(),
    }),
    execute: async ({ objectId, worldPosition, layerId, layerName, radius }) => {
      const object = findObject(objectId);
      if (!object) return `No object with id ${objectId}.`;
      if (!object.terrain) return `Object ${objectId} is not a terrain object.`;
      const layers = object.terrain.materialLayers ?? [];
      const layer =
        layers.find((item) => item.id === layerId) ??
        layers.find((item) => layerName && item.name.toLowerCase() === layerName.toLowerCase()) ??
        layers[0];
      if (!layer) return `Terrain ${objectId} has no material layers.`;
      store().paintTerrainAt(objectId, asVec3(worldPosition), { layerId: layer.id, radius });
      return `Painted terrain ${objectId} with layer ${layer.name} (${layer.id}).`;
    },
  }),

  add_terrain_layer: tool({
    description: 'Add a paintable material layer to a terrain object. Returns the layer id.',
    inputSchema: z.object({
      objectId: z.string(),
      name: z.string().optional(),
      color: z.string().optional(),
      textureAssetId: z.string().optional(),
      normalMapAssetId: z.string().optional(),
    }),
    execute: async ({ objectId, name, color, textureAssetId, normalMapAssetId }) => {
      const object = findObject(objectId);
      if (!object) return `No object with id ${objectId}.`;
      if (!object.terrain) return `Object ${objectId} is not a terrain object.`;
      for (const assetId of [textureAssetId, normalMapAssetId].filter(Boolean) as string[]) {
        const asset = findAsset(assetId);
        if (!asset) return `No asset with id ${assetId}.`;
        if (asset.type !== 'image') return `Asset ${assetId} is a ${asset.type}, not an image.`;
      }
      const id = store().addTerrainMaterialLayer(objectId);
      if (!id) return `Could not add a terrain layer to ${objectId}.`;
      store().updateTerrainMaterialLayer(objectId, id, {
        ...(name ? { name } : {}),
        ...(color ? { color } : {}),
        ...(textureAssetId !== undefined ? { textureAssetId: textureAssetId || undefined } : {}),
        ...(normalMapAssetId !== undefined ? { normalMapAssetId: normalMapAssetId || undefined } : {}),
      });
      return `Added terrain layer ${name ?? id} with id ${id}.`;
    },
  }),

  update_terrain_layer: tool({
    description: 'Update one paintable terrain material layer by layer id.',
    inputSchema: terrainMaterialLayerPatchSchema.extend({ objectId: z.string(), layerId: z.string() }),
    execute: async ({ objectId, layerId, ...patch }) => {
      const object = findObject(objectId);
      if (!object) return `No object with id ${objectId}.`;
      if (!object.terrain) return `Object ${objectId} is not a terrain object.`;
      if (!object.terrain.materialLayers?.some((layer) => layer.id === layerId)) return `Terrain ${objectId} has no layer ${layerId}.`;
      for (const assetId of [patch.textureAssetId, patch.normalMapAssetId].filter(Boolean) as string[]) {
        const asset = findAsset(assetId);
        if (!asset) return `No asset with id ${assetId}.`;
        if (asset.type !== 'image') return `Asset ${assetId} is a ${asset.type}, not an image.`;
      }
      store().updateTerrainMaterialLayer(objectId, layerId, {
        ...patch,
        textureAssetId: patch.textureAssetId || undefined,
        normalMapAssetId: patch.normalMapAssetId || undefined,
      });
      return `Updated terrain layer ${layerId}.`;
    },
  }),

  set_object_parent: tool({
    description: "Nest an object under a parent (true scene graph: it inherits the parent's position/rotation/scale and is deleted with it), or detach it to the scene root by omitting parentId. The object KEEPS its world pose across the move — its transform is recomputed into the parent's LOCAL space, so set its position to [0,0,0] afterward to snap it onto the parent. Used to build/edit composite object hierarchies.",
    inputSchema: z.object({ id: z.string(), parentId: z.string().optional() }),
    execute: async ({ id, parentId }) => {
      if (!findObject(id)) return `No object with id ${id}.`;
      if (parentId && !findObject(parentId)) return `No object with id ${parentId} to parent under.`;
      store().setObjectParent(id, parentId);
      return parentId ? `Nested ${id} under ${parentId}.` : `Detached ${id} to the scene root.`;
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
    description:
      "Update an object's inline material/render settings. For imported models, color/metalness/roughness need overrideMaterial:true; textureAssetId applies an image texture.",
    inputSchema: z.object({
      id: z.string(),
      color: z.string().optional(),
      metalness: z.number().min(0).max(1).optional(),
      roughness: z.number().min(0).max(1).optional(),
      opacity: z.number().min(0).max(1).optional().describe('Surface opacity 0–1 (1 = opaque). Below 1 renders translucent — use ~0.5 for water/glass.'),
      textureAssetId: z
        .string()
        .optional()
        .describe('An "image"-type asset id for the base-color map, or "" to remove the texture.'),
      overrideMaterial: z
        .boolean()
        .optional()
        .describe("For model objects: when true, color/metalness/roughness override the model's baked materials."),
    }),
    execute: async ({ id, color, metalness, roughness, opacity, textureAssetId, overrideMaterial }) => {
      const object = findObject(id);
      if (!object) return `No object with id ${id}.`;
      if (!object.renderer) return `Object ${id} (${object.kind}) has no mesh renderer.`;
      if (textureAssetId) {
        const asset = findAsset(textureAssetId);
        if (!asset) return `No asset with id ${textureAssetId}.`;
        if (asset.type !== 'image') return `Asset ${textureAssetId} is a ${asset.type}, not an image — textures must be image assets.`;
      }
      const patch: Partial<MeshRendererComponent> = {};
      if (color !== undefined) patch.color = color;
      if (metalness !== undefined) patch.metalness = metalness;
      if (roughness !== undefined) patch.roughness = roughness;
      if (opacity !== undefined) patch.opacity = opacity;
      if (textureAssetId !== undefined) patch.textureAssetId = textureAssetId || undefined;
      if (overrideMaterial !== undefined) patch.overrideMaterial = overrideMaterial;
      store().updateRenderer(id, patch);
      return `Updated material of ${id}.`;
    },
  }),

  set_scene_audio: tool({
    description:
      "Set Scene Settings audio for the active scene: looping ambient and/or music. These are scene-level Play loops, not Blueprint nodes. Empty string clears either.",
    inputSchema: z.object({
      ambientSoundId: z.string().optional().describe('Audio asset id looped quietly as ambience (wind/room tone), or "" to clear.'),
      musicSoundId: z.string().optional().describe('Audio asset id looped as background music, or "" to clear.'),
    }),
    execute: async ({ ambientSoundId, musicSoundId }) => {
      const sceneId = store().activeSceneId;
      const check = (id?: string) => {
        if (!id) return undefined;
        const asset = findAsset(id);
        if (!asset) return `No asset with id ${id}.`;
        if (asset.type !== 'audio') return `Asset ${id} is a ${asset.type}, not audio.`;
        return undefined;
      };
      const err = check(ambientSoundId) ?? check(musicSoundId);
      if (err) return err;
      store().setSceneAudio(sceneId, {
        ...(ambientSoundId !== undefined ? { ambientSoundId: ambientSoundId || undefined } : {}),
        ...(musicSoundId !== undefined ? { musicSoundId: musicSoundId || undefined } : {}),
      });
      return `Updated scene audio (ambient/music).`;
    },
  }),

  set_scene_environment: tool({
    description:
      'Set the active scene sky/fog/base lighting. Use this for mood, time of day, sunset/night/daylight, panorama skyboxes, and fog. This is scene-level World Settings, not a Blueprint node.',
    inputSchema: environmentPatchSchema,
    execute: async ({ skyTextureAssetId, environmentMapAssetId, ...patch }) => {
      if (skyTextureAssetId) {
        const asset = findAsset(skyTextureAssetId);
        if (!asset) return `No asset with id ${skyTextureAssetId}.`;
        if (asset.type !== 'image') return `Asset ${skyTextureAssetId} is a ${asset.type}, not an image — sky panoramas must be image assets.`;
      }
      if (environmentMapAssetId) {
        const asset = findAsset(environmentMapAssetId);
        if (!asset) return `No asset with id ${environmentMapAssetId}.`;
        if (asset.type !== 'image') return `Asset ${environmentMapAssetId} is a ${asset.type}, not an image — IBL maps must be equirectangular image assets.`;
      }
      const environmentPatch: Partial<SceneEnvironmentSettings> = {
        ...patch,
        ...(skyTextureAssetId !== undefined ? { skyTextureAssetId: skyTextureAssetId || undefined } : {}),
        ...(environmentMapAssetId !== undefined ? { environmentMapAssetId: environmentMapAssetId || undefined } : {}),
      };
      store().updateSceneEnvironment(store().activeSceneId, environmentPatch);
      return `Updated scene environment (${Object.keys(environmentPatch).join(', ') || 'defaults'}).`;
    },
  }),

  set_inventory: tool({
    description:
      "Define or remove a character weapon inventory. Slots appear in the HUD and can equip model assets, play equip animations/sounds, and toggle ranged mode.",
    inputSchema: z.object({
      objectId: z.string(),
      slots: z
        .array(
          z.object({
            label: z.string().describe('Short HUD label, e.g. "Fist", "Sword", "Pistol".'),
            weaponAssetId: z.string().optional().describe('Model asset id attached on equip; omit for unarmed.'),
            ranged: z.boolean().optional().describe('When true, equipping enables ranged fire (sets RangedMode).'),
            attachScale: z.number().optional().describe('Uniform scale of the attached weapon.'),
            attachYaw: z.number().optional().describe('Y-yaw (radians) to seat the grip.'),
            attachPosition: vec3.optional().describe('Fine local grip offset [x,y,z].'),
            attachRotation: vec3.optional().describe('Fine local grip rotation [x,y,z] in radians; overrides attachYaw when provided.'),
            equipAnimId: z.string().optional().describe('Animation asset id played as a montage on equip.'),
          }),
        )
        .describe('Ordered weapon slots shown left→right in the HUD bar.'),
      socketName: z.string().optional().describe('Named socket to attach to (default "RightHand").'),
      boneName: z.string().optional().describe('Bone to attach to (default "hand_r").'),
      switchSoundId: z.string().optional().describe('Audio asset id played on each weapon switch.'),
      equipped: z.number().optional().describe('Initially equipped slot index (default 0).'),
    }),
    execute: async ({ objectId, slots, socketName, boneName, switchSoundId, equipped }) => {
      const object = findObject(objectId);
      if (!object) return `No object with id ${objectId}.`;
      if (!slots.length) {
        store().setInventory(objectId, undefined);
        return `Removed inventory from ${objectId}.`;
      }
      const normalizedSlots: InventorySlot[] = slots.map((slot) => ({
        ...slot,
        attachPosition: slot.attachPosition ? asVec3(slot.attachPosition) : undefined,
        attachRotation: slot.attachRotation ? asVec3(slot.attachRotation) : undefined,
      }));
      store().setInventory(objectId, { slots: normalizedSlots, equipped: equipped ?? 0, socketName, boneName, switchSoundId });
      return `Set ${slots.length}-slot inventory on ${objectId}.`;
    },
  }),

  equip_slot: tool({
    description:
      'Equip the inventory slot at `index` on a character (same as clicking the HUD slot): swaps the held weapon, plays the equip montage + switch sound, and sets RangedMode. During Play it fires the montage/sound immediately.',
    inputSchema: z.object({ objectId: z.string(), index: z.number() }),
    execute: async ({ objectId, index }) => {
      const object = findObject(objectId);
      if (!object) return `No object with id ${objectId}.`;
      if (!object.inventory) return `Object ${objectId} has no inventory (use set_inventory first).`;
      store().equipInventorySlot(objectId, index);
      return `Equipped slot ${index} on ${objectId}.`;
    },
  }),

  set_physics: tool({
    description: 'Enable/configure object physics. Use fixed solids for walls/floors, dynamic for movable bodies, and fixed triggers for pickups/volumes.',
    inputSchema: z.object({
      id: z.string(),
      enabled: z.boolean().optional(),
      bodyType: z.enum(['dynamic', 'fixed', 'kinematic']).optional(),
      collider: z.enum(['box', 'sphere', 'capsule', 'mesh', 'convex']).optional(),
      isTrigger: z.boolean().optional(),
      collisionLayer: z.number().int().min(0).max(15).optional(),
      collisionMask: z.number().int().min(0).max(0xffff).optional(),
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

  set_fracture: tool({
    description:
      'Make an object DESTRUCTIBLE (configured on the object itself). It shatters into small dynamic cubes that fly apart: automatically when hit fast enough (set impactThreshold > 0, needs physics enabled to be hit), when destroyed by damage (give it a "health" instance var), or via the "Fracture" Blueprint node. Set enabled:false to turn it off.',
    inputSchema: z.object({
      id: z.string(),
      enabled: z.boolean().optional().describe('Turn destructibility on/off. Default on.'),
      pattern: z.enum(['uniform', 'chunks', 'shatter']).optional().describe("Cut style: 'uniform' even grid, 'chunks' few big irregular pieces, 'shatter' many small bits."),
      pieces: z.number().int().min(2).max(6).optional().describe('Detail / base piece count (higher = more, smaller pieces).'),
      jitter: z.number().min(0).max(1).optional().describe('Irregularity 0–1 (chunks/shatter): how uneven the piece sizes are.'),
      seed: z.number().int().min(1).optional().describe('Seed for a repeatable break; change for a different look.'),
      strength: z.number().min(0).optional().describe('Burst force on the pieces (default 3).'),
      impactThreshold: z.number().min(0).optional().describe('Hit speed (units/sec) that auto-shatters on contact; 0 = only on death / Fracture node.'),
      focusImpact: z.boolean().optional().describe('Make pieces smaller near the hit point and bigger away (radial).'),
    }),
    execute: async ({ id, ...patch }) => {
      const object = findObject(id);
      if (!object) return `No object with id ${id}.`;
      store().setObjectFracture(id, { ...patch, enabled: patch.enabled ?? true });
      return patch.enabled === false ? `Made ${id} non-destructible.` : `Made ${id} destructible (${patch.pattern ?? 'chunks'}).`;
    },
  }),

  create_particle_system: tool({
    description:
      'Create a reusable Particle System ASSET (Unreal-style: fire, smoke, sparks, magic, fountain, rain, explosion, dust). Edit it once with update_particle_system and every object/spawn that references it updates. Optionally seed from a preset. Returns the particleSystemId — then attach_particle_system to put it on an object, or use the "Spawn Particle System" Blueprint node to spawn it at runtime.',
    inputSchema: z.object({
      name: z.string().optional(),
      preset: z.enum(['fire', 'smoke', 'sparks', 'magic', 'fountain', 'rain', 'explosion', 'dust']).optional(),
      folderId: z.string().optional(),
    }),
    execute: async ({ name, preset, folderId }) => {
      const id = store().createParticleSystem(name, preset, folderId);
      return `Created particle system "${store().particleSystems.find((p) => p.id === id)?.name}" with particleSystemId ${id}.`;
    },
  }),

  update_particle_system: tool({
    description:
      'Tune a reusable Particle System asset (every referencing emitter updates live). looping=continuous (rate/sec) vs one-shot (burst count). gravity>0 falls, <0 rises (smoke). worldSpace keeps particles in the world as the emitter moves. blend additive=glow (fire/magic), normal=smoke/debris. Size/color/opacity interpolate from start→end over each particle\'s life. Pass the particleSystemId from the snapshot / create_particle_system.',
    inputSchema: z.object({
      particleSystemId: z.string(),
      looping: z.boolean().optional(),
      rate: z.number().optional().describe('Particles per second while looping.'),
      burst: z.number().optional().describe('Particles per one-shot burst (non-looping / Burst / Spawn nodes).'),
      maxParticles: z.number().optional().describe('Pool cap (1–4000).'),
      shape: z.enum(['point', 'sphere', 'hemisphere', 'cone', 'box', 'disc']).optional(),
      shapeRadius: z.number().optional(),
      coneAngle: z.number().optional().describe('Spread half-angle in degrees.'),
      speed: z.number().optional(),
      speedJitter: z.number().optional().describe('0–1 random speed variation.'),
      direction: z.array(z.number()).length(3).optional().describe('Local emit direction [x,y,z].'),
      gravity: z.number().optional().describe('Downward accel; negative = rise.'),
      drag: z.number().optional(),
      lifetime: z.number().optional(),
      lifetimeJitter: z.number().optional(),
      startSize: z.number().optional(),
      endSize: z.number().optional(),
      startColor: z.string().optional().describe('Hex color at birth.'),
      endColor: z.string().optional().describe('Hex color at death.'),
      startOpacity: z.number().optional(),
      endOpacity: z.number().optional(),
      worldSpace: z.boolean().optional(),
      blend: z.enum(['additive', 'normal']).optional(),
      light: z.boolean().optional().describe('Emit a soft point-light pulse (fire/explosions).'),
      textureAssetId: z.string().optional().describe('Image asset id for a sprite, or empty for a soft dot.'),
    }),
    execute: async ({ particleSystemId, direction, textureAssetId, ...patch }) => {
      if (!store().particleSystems.some((p) => p.id === particleSystemId)) return `No particle system with id ${particleSystemId}.`;
      if (textureAssetId) {
        const asset = findAsset(textureAssetId);
        if (!asset) return `No asset with id ${textureAssetId}.`;
        if (asset.type !== 'image') return `Asset ${textureAssetId} is a ${asset.type}, not an image.`;
      }
      store().updateParticleSystem(particleSystemId, {
        ...patch,
        ...(direction ? { direction: direction as [number, number, number] } : {}),
        ...(textureAssetId !== undefined ? { textureAssetId: textureAssetId || undefined } : {}),
      });
      return `Updated particle system ${particleSystemId}.`;
    },
  }),

  delete_particle_system: tool({
    description: 'Delete a reusable Particle System asset. Any object referencing it loses its emitter.',
    inputSchema: z.object({ particleSystemId: z.string() }),
    execute: async ({ particleSystemId }) => {
      if (!store().particleSystems.some((p) => p.id === particleSystemId)) return `No particle system with id ${particleSystemId}.`;
      store().deleteParticleSystem(particleSystemId);
      return `Deleted particle system ${particleSystemId}.`;
    },
  }),

  attach_particle_system: tool({
    description:
      'Attach a reusable Particle System asset to an object (the object emits it; editing the asset updates it). Works on any object including empties — drop an empty where you want an effect anchor. Pass particleSystemId empty to detach.',
    inputSchema: z.object({
      objectId: z.string(),
      particleSystemId: z.string().optional().describe('Particle system asset id, or empty to detach.'),
    }),
    execute: async ({ objectId, particleSystemId }) => {
      if (!findObject(objectId)) return `No object with id ${objectId}.`;
      if (particleSystemId && !store().particleSystems.some((p) => p.id === particleSystemId)) {
        return `No particle system with id ${particleSystemId}.`;
      }
      store().setObjectParticleSystem(objectId, particleSystemId || undefined);
      return particleSystemId ? `Attached particle system ${particleSystemId} to ${objectId}.` : `Detached the particle emitter from ${objectId}.`;
    },
  }),

  set_model: tool({
    description: 'Assign an imported glTF/GLB model asset to an object (rendered instead of its built-in mesh), or clear it. The assetId must be a "model"-type asset from the snapshot.',
    inputSchema: z.object({
      objectId: z.string(),
      assetId: z.string().optional().describe('Model asset id, or omit/empty to revert to the built-in mesh.'),
    }),
    execute: async ({ objectId, assetId }) => {
      if (!findObject(objectId)) return `No object with id ${objectId}.`;
      if (assetId) {
        const asset = findAsset(assetId);
        if (!asset) return `No asset with id ${assetId}.`;
        if (asset.type !== 'model') return `Asset ${assetId} is a ${asset.type}, not a model.`;
      }
      store().setObjectModel(objectId, assetId || undefined);
      return assetId ? `Assigned model ${assetId} to ${objectId}.` : `Cleared the model on ${objectId}.`;
    },
  }),

  set_animator: tool({
    description:
      'Play or stop a skeletal animation on a rigged object. animationId must belong to the same skeleton; speed/loop are optional.',
    inputSchema: z.object({
      objectId: z.string(),
      enabled: z.boolean().optional(),
      animationId: z.string().optional().describe('Animation asset id, or empty to clear (bind pose).'),
      speed: z.number().optional(),
      loop: z.boolean().optional(),
    }),
    execute: async ({ objectId, enabled, animationId, speed, loop }) => {
      const object = findObject(objectId);
      if (!object) return `No object with id ${objectId}.`;
      if (animationId && !store().animations.some((anim) => anim.id === animationId)) {
        return `No animation asset with id ${animationId}.`;
      }
      if (!object.animator) store().toggleAnimator(objectId); // seeds the component (enabled = true)
      if (enabled === false && object.animator?.enabled) store().toggleAnimator(objectId);
      else if (enabled === true && object.animator && !object.animator.enabled) store().toggleAnimator(objectId);
      const patch: Record<string, unknown> = {};
      if (animationId !== undefined) {
        patch.animationId = animationId || undefined;
        patch.clip = undefined;
      }
      if (speed !== undefined) patch.speed = speed;
      if (loop !== undefined) patch.loop = loop;
      if (Object.keys(patch).length) store().updateAnimator(objectId, patch);
      return `Updated animator on ${objectId}.`;
    },
  }),

  create_animator_controller: tool({
    description:
      'Create a reusable Animator Controller. Add parameters/states/transitions, then assign it with set_object_controller. Returns controllerId.',
    inputSchema: z.object({ name: z.string().optional(), skeletonId: z.string().optional() }),
    execute: async ({ name, skeletonId }) => {
      if (skeletonId && !store().skeletons.some((s) => s.id === skeletonId)) return `No skeleton with id ${skeletonId}.`;
      const id = store().createAnimatorController(name, skeletonId);
      return `Created animator controller "${findController(id)?.name}" with controllerId ${id}.`;
    },
  }),

  add_animator_parameter: tool({
    description:
      'Add an Animator Controller parameter. Sources can be manual, motion/input auto-sources, or variable. Returns parameterId.',
    inputSchema: z.object({
      controllerId: z.string(),
      name: z.string(),
      type: z.enum(['float', 'bool', 'trigger']),
      source: z
        .enum(['manual', 'speed', 'verticalSpeed', 'moving', 'crouching', 'grounded', 'rolling', 'attacking', 'aiming', 'reloading', 'interacting', 'emoting', 'crawling', 'swimming', 'climbing', 'moveX', 'moveY', 'weaponEquipped', 'variable'])
        .optional(),
      variableId: z.string().optional(),
    }),
    execute: async ({ controllerId, name, type, source, variableId }) => {
      if (!findController(controllerId)) return `No controller with id ${controllerId}.`;
      const id = store().addAnimatorParameter(controllerId, { name, type, source, variableId });
      return id ? `Added parameter "${name}" (${id}).` : `Couldn't add parameter.`;
    },
  }),

  add_animator_state: tool({
    description:
      'Add a state to a controller. Each state plays one Animation asset (animationId) on the controller\'s skeleton. The first state added becomes the default/entry state. Returns stateId.',
    inputSchema: z.object({
      controllerId: z.string(),
      name: z.string(),
      animationId: z.string().optional(),
      speed: z.number().optional(),
      loop: z.boolean().optional(),
    }),
    execute: async ({ controllerId, name, animationId, speed, loop }) => {
      if (!findController(controllerId)) return `No controller with id ${controllerId}.`;
      if (animationId && !store().animations.some((a) => a.id === animationId)) return `No animation asset with id ${animationId}.`;
      const id = store().addAnimatorState(controllerId, { name, animationId, speed, loop });
      return id ? `Added state "${name}" (${id}).` : `Couldn't add state.`;
    },
  }),

  update_animator_state: tool({
    description:
      'Edit an existing animator state: change its clip (animationId), name, speed, loop, and/or make it the default (entry) state with makeDefault:true.',
    inputSchema: z.object({
      controllerId: z.string(),
      stateId: z.string(),
      name: z.string().optional(),
      animationId: z.string().optional(),
      speed: z.number().optional(),
      loop: z.boolean().optional(),
      makeDefault: z.boolean().optional(),
    }),
    execute: async ({ controllerId, stateId, makeDefault, ...patch }) => {
      const controller = findController(controllerId);
      if (!controller) return `No controller with id ${controllerId}.`;
      if (!controller.states.some((s) => s.id === stateId)) return `No state ${stateId} in controller.`;
      if (patch.animationId && !store().animations.some((a) => a.id === patch.animationId)) return `No animation asset with id ${patch.animationId}.`;
      if (Object.keys(patch).length) store().updateAnimatorState(controllerId, stateId, patch);
      if (makeDefault) store().updateAnimatorController(controllerId, { defaultStateId: stateId });
      return `Updated state ${stateId}.`;
    },
  }),

  set_blendspace: tool({
    description:
      'Turn an animator state into a 1D/2D blend space. Use parameterName for X, optional parameterNameY for Y, and samples with animationId/value/y. Empty samples clears it.',
    inputSchema: z.object({
      controllerId: z.string(),
      stateId: z.string(),
      parameterName: z.string().describe('Float parameter for the X axis (e.g. "Speed" or "MoveX").'),
      parameterNameY: z.string().optional().describe('Float parameter for the Y axis — makes it a 2D blend space.'),
      samples: z.array(z.object({ animationId: z.string(), value: z.number(), y: z.number().optional() })),
    }),
    execute: async ({ controllerId, stateId, parameterName, parameterNameY, samples }) => {
      const controller = findController(controllerId);
      if (!controller) return `No controller with id ${controllerId}.`;
      if (!controller.states.some((s) => s.id === stateId)) return `No state ${stateId} in controller.`;
      const param = controller.parameters.find((p) => p.name === parameterName);
      if (!param) return `No parameter "${parameterName}" on this controller.`;
      const paramY = parameterNameY ? controller.parameters.find((p) => p.name === parameterNameY) : undefined;
      if (parameterNameY && !paramY) return `No parameter "${parameterNameY}" on this controller.`;
      const bad = samples.find((s) => !store().animations.some((a) => a.id === s.animationId));
      if (bad) return `No animation asset with id ${bad.animationId}.`;
      store().updateAnimatorState(controllerId, stateId, {
        blendParameterId: samples.length ? param.id : undefined,
        blendParameterIdY: samples.length ? paramY?.id : undefined,
        blendSamples: samples.length ? samples : undefined,
      });
      return samples.length
        ? `State ${stateId} is now a ${paramY ? '2D' : '1D'} blend space (${samples.length} samples).`
        : `Cleared blend space on ${stateId}.`;
    },
  }),

  add_animator_transition: tool({
    description:
      'Add an animator transition from a state id or "any" to another state. Conditions are ANDed; duration is crossfade seconds. Returns transitionId.',
    inputSchema: z.object({
      controllerId: z.string(),
      from: z.string().describe('Source stateId, or "any".'),
      to: z.string().describe('Target stateId.'),
      conditions: z
        .array(
          z.object({
            parameterId: z.string(),
            op: z.enum(['==', '!=', '>', '>=', '<', '<=']),
            value: z.union([z.number(), z.boolean()]),
          }),
        )
        .optional(),
      duration: z.number().optional(),
      hasExitTime: z.boolean().optional(),
      exitTime: z.number().optional().describe('Fraction 0–1 of the clip that must play before leaving (default 1 = clip end).'),
    }),
    execute: async ({ controllerId, from, to, conditions, duration, hasExitTime, exitTime }) => {
      const controller = findController(controllerId);
      if (!controller) return `No controller with id ${controllerId}.`;
      if (from !== 'any' && !controller.states.some((s) => s.id === from)) return `No state ${from} in controller.`;
      if (!controller.states.some((s) => s.id === to)) return `No state ${to} in controller.`;
      const id = store().addAnimatorTransition(controllerId, { from, to, conditions, duration, hasExitTime, exitTime });
      return id ? `Added transition ${from} → ${to} (${id}).` : `Couldn't add transition.`;
    },
  }),

  set_anim_parameter: tool({
    description:
      'Set a live animator parameter by name during Play. Best for manual params and triggers; auto-sourced params are recomputed.',
    inputSchema: z.object({ objectId: z.string(), paramName: z.string(), value: z.union([z.number(), z.boolean()]) }),
    execute: async ({ objectId, paramName, value }) => {
      const object = findObject(objectId);
      if (!object) return `No object with id ${objectId}.`;
      const controller = findController(object.animator?.controllerId ?? '');
      const param = controller?.parameters.find((p) => p.name === paramName);
      if (!param) return `No parameter "${paramName}" on ${objectId}'s animator.`;
      if (!store().isPlaying) return `Set takes effect during Play; press play first.`;
      store().setRuntimeAnimatorParam(objectId, param.id, value);
      return `Set ${paramName} = ${value} on ${objectId}.`;
    },
  }),

  set_ragdoll: tool({
    description:
      'Turn a rigged object ragdoll on/off during Play. Requires a skinned model with ragdoll settings.',
    inputSchema: z.object({ objectId: z.string(), on: z.boolean().default(true) }),
    execute: async ({ objectId, on }) => {
      if (!findObject(objectId)) return `No object with id ${objectId}.`;
      if (!store().isPlaying) return `Ragdoll only simulates during Play; press play first.`;
      store().setObjectRagdoll(objectId, on);
      return `${on ? 'Enabled' : 'Disabled'} ragdoll on ${objectId}.`;
    },
  }),

  set_object_controller: tool({
    description:
      'Assign an Animator Controller to an object\'s animator (enables it), or pass empty controllerId to detach. The object must render a rigged model whose skeleton matches the controller.',
    inputSchema: z.object({ objectId: z.string(), controllerId: z.string().optional() }),
    execute: async ({ objectId, controllerId }) => {
      if (!findObject(objectId)) return `No object with id ${objectId}.`;
      if (controllerId && !findController(controllerId)) return `No controller with id ${controllerId}.`;
      store().setObjectAnimatorController(objectId, controllerId || undefined);
      return controllerId ? `Assigned controller ${controllerId} to ${objectId}.` : `Detached controller from ${objectId}.`;
    },
  }),

  set_character_controller: tool({
    description:
      'Add/configure the built-in third-person character controller on an object (WASD move, Shift sprint, Space jump, optional follow camera). The motion it produces auto-drives an animator with speed/verticalSpeed parameters. Pass enabled:false to remove control. All numeric fields optional.',
    inputSchema: z.object({
      objectId: z.string(),
      enabled: z.boolean().optional(),
      moveSpeed: z.number().optional(),
      sprintMultiplier: z.number().optional(),
      crouchMultiplier: z.number().optional(),
      jumpStrength: z.number().optional(),
      gravity: z.number().optional(),
      turnSpeed: z.number().optional(),
      groundLevel: z.number().optional(),
      // Movement "feel" — fix stiff/floaty. acceleration/deceleration ramp horizontal speed (higher = snappier
      // starts/stops; lower = weightier). airControl (0..1) dampens mid-air steering. fallMultiplier >1 makes the
      // jump fall faster than it rose (less floaty). jumpCutMultiplier (0..1) shortens a tapped jump. coyoteTime
      // lets a jump still fire shortly after leaving a ledge.
      acceleration: z.number().optional().describe('Ground accel toward target speed (units/s²). Default 60.'),
      deceleration: z.number().optional().describe('Ground decel to a stop (units/s²). Default 70.'),
      airControl: z.number().optional().describe('Accel/decel multiplier while airborne, 0..1. Default 0.35.'),
      fallMultiplier: z.number().optional().describe('Gravity ×multiplier while descending. >1 = snappier fall. Default 1.9.'),
      jumpCutMultiplier: z.number().optional().describe('Upward velocity kept when jump released early, 0..1. Default 0.45.'),
      coyoteTime: z.number().optional().describe('Grace seconds after leaving a ledge a jump still fires. Default 0.12.'),
      modelYawOffset: z.number().optional().describe('Facing offset in radians; use Math.PI (~3.14159) to flip a model that faces backwards.'),
      // Key bindings — KeyboardEvent.code strings, e.g. "KeyW", "Space", "ShiftLeft", "ArrowUp".
      keyForward: z.string().optional(),
      keyBackward: z.string().optional(),
      keyLeft: z.string().optional(),
      keyRight: z.string().optional(),
      keyJump: z.string().optional(),
      keySprint: z.string().optional(),
      keyCrouch: z.string().optional(),
      keyCrawl: z.string().optional(),
      crawlMultiplier: z.number().optional(),
      strafe: z.boolean().optional().describe('Face the camera + move 8-way (pairs with a 2D MoveX/MoveY blend space).'),
      keyRoll: z.string().optional(),
      rollSpeed: z.number().optional(),
      rollDuration: z.number().optional(),
      keyAttack: z.string().optional(),
      meleeDamage: z.number().optional().describe('Melee damage. Default 34.'),
      meleeRange: z.number().optional().describe('Melee range. Default 2.4.'),
      keyAim: z.string().optional(),
      keyReload: z.string().optional(),
      keyInteract: z.string().optional(),
      interactRange: z.number().optional().describe('Interact distance. Default 3.'),
      keyEmote: z.string().optional(),
      keyRagdoll: z.string().optional(),
      // Player sound effects — pass an "audio"-type asset id; the runtime plays each automatically on its event.
      footstepSoundId: z.string().optional().describe('Footstep audio asset id.'),
      jumpSoundId: z.string().optional().describe('Jump audio asset id.'),
      landSoundId: z.string().optional().describe('Land audio asset id.'),
      swimSoundId: z.string().optional().describe('Water splash audio asset id.'),
      attackSoundId: z.string().optional().describe('Attack audio asset id.'),
      hurtSoundId: z.string().optional().describe('Hurt audio asset id.'),
      // Camera.
      cameraFollow: z.boolean().optional(),
      cameraOffset: vec3.optional().describe('[side, up, back]. Negative Z is behind.'),
      cameraPitch: z.number().optional().describe('Base camera elevation in radians.'),
      mouseLook: z.boolean().optional().describe('Orbit camera with mouse.'),
      mouseSensitivity: z.number().optional(),
      cameraRelativeMovement: z.boolean().optional().describe('Move relative to camera.'),
    }),
    execute: async ({ objectId, enabled, ...patch }) => {
      const object = findObject(objectId);
      if (!object) return `No object with id ${objectId}.`;
      if (!object.character) store().toggleCharacterController(objectId); // seeds defaults (enabled = true)
      if (enabled === false && store().scenes.flatMap((s) => s.objects).find((o) => o.id === objectId)?.character?.enabled) {
        store().toggleCharacterController(objectId);
      } else if (enabled === true) {
        const current = store().scenes.flatMap((s) => s.objects).find((o) => o.id === objectId)?.character;
        if (current && !current.enabled) store().toggleCharacterController(objectId);
      }
      if (Object.keys(patch).length) {
        // cameraOffset arrives as number[]; coerce to the [x,y,z] tuple the store expects.
        const { cameraOffset, ...rest } = patch;
        store().updateCharacterController(objectId, {
          ...rest,
          ...(cameraOffset ? { cameraOffset: asVec3(cameraOffset) } : {}),
        });
      }
      return `Updated character controller on ${objectId}.`;
    },
  }),

  create_character_pawn: tool({
    description:
      'Create a third-person character pawn from a rigged model asset, with locomotion controller and character controller. Returns objectId.',
    inputSchema: z.object({ modelAssetId: z.string(), name: z.string().optional() }),
    execute: async ({ modelAssetId, name }) => {
      const asset = findAsset(modelAssetId);
      if (!asset) return `No asset with id ${modelAssetId}.`;
      if (!store().skeletalMeshes.some((m) => m.sourceAssetId === modelAssetId)) {
        return `Asset ${modelAssetId} isn't a rigged model (no skeleton was extracted on import).`;
      }
      const id = store().createCharacterPawn(modelAssetId, name);
      return id
        ? `Created character pawn "${findObject(id)?.name}" (objectId ${id}) with a locomotion controller and character controller. Press Play and use WASD.`
        : `Couldn't build a pawn — no usable locomotion clips found on that skeleton.`;
    },
  }),

  add_gameplay_kit: tool({
    description:
      "Add a ready-made kit to a character Animator Controller. Kits: ranged, health, interactions, emotes. Requires matching clips on the rig.",
    inputSchema: z.object({ objectId: z.string(), kit: z.enum(['ranged', 'health', 'interactions', 'emotes']) }),
    execute: async ({ objectId, kit }) => {
      const object = findObject(objectId);
      if (!object) return `No object with id ${objectId}.`;
      if (!object.animator?.controllerId) return `${objectId} has no Animator Controller — run create_character_pawn first.`;
      const summary = store().addGameplayKit(objectId, kit);
      return summary ? `Added ${summary} to ${object.name}.` : `Couldn't add the ${kit} kit — the skeleton has no matching clips.`;
    },
  }),

  list_bones: tool({
    description: 'List the bone (socket) names of a rigged character object\'s skeleton, so you can attach items to one. Pass the objectId of an object that renders a skinned model.',
    inputSchema: z.object({ objectId: z.string() }),
    execute: async ({ objectId }) => {
      const object = findObject(objectId);
      if (!object) return `No object with id ${objectId}.`;
      const mesh = store().skeletalMeshes.find((m) => m.sourceAssetId === object.renderer?.modelAssetId);
      const skeleton = mesh ? store().skeletons.find((s) => s.id === mesh.skeletonId) : undefined;
      if (!skeleton) return `Object ${objectId} doesn't render a rigged model (no skeleton).`;
      return JSON.stringify(skeleton.boneNames);
    },
  }),

  attach_to_bone: tool({
    description:
      'Attach an object to a rigged target bone so it follows animation. Omit targetObjectId to detach. Use list_bones for bone names.',
    inputSchema: z.object({
      objectId: z.string(),
      targetObjectId: z.string().optional().describe('The character to attach to, or omit/empty to detach.'),
      boneName: z.string().optional(),
    }),
    execute: async ({ objectId, targetObjectId, boneName }) => {
      if (!findObject(objectId)) return `No object with id ${objectId}.`;
      if (!targetObjectId) {
        store().setAttachment(objectId, undefined);
        return `Detached ${objectId}.`;
      }
      const target = findObject(targetObjectId);
      if (!target) return `No target object with id ${targetObjectId}.`;
      const mesh = store().skeletalMeshes.find((m) => m.sourceAssetId === target.renderer?.modelAssetId);
      const skeleton = mesh ? store().skeletons.find((s) => s.id === mesh.skeletonId) : undefined;
      if (!skeleton) return `Target ${targetObjectId} isn't a rigged character.`;
      const bone = boneName && skeleton.boneNames.includes(boneName) ? boneName : skeleton.boneNames[0];
      store().setAttachment(objectId, { targetObjectId, boneName: bone });
      return `Attached ${objectId} to ${targetObjectId} bone "${bone}".`;
    },
  }),

  set_attachment_offset: tool({
    description:
      'Set local offset for an attached object. position/scale are vec3; rotation is XYZ degrees.',
    inputSchema: z.object({
      objectId: z.string(),
      position: z.array(z.number()).length(3).optional(),
      rotation: z.array(z.number()).length(3).optional().describe('Euler degrees XYZ.'),
      scale: z.array(z.number()).length(3).optional(),
    }),
    execute: async ({ objectId, position, rotation, scale }) => {
      const object = findObject(objectId);
      if (!object?.attachment) return `${objectId} isn't attached to anything.`;
      const patch: Record<string, unknown> = { ...object.attachment };
      if (position) patch.offsetPosition = position;
      if (rotation) patch.offsetRotation = rotation.map((d) => (d * Math.PI) / 180);
      if (scale) patch.offsetScale = scale;
      store().setAttachment(objectId, patch as never);
      return `Updated attach offset on ${object.name}.`;
    },
  }),

  add_skeleton_socket: tool({
    description:
      'Add a reusable named socket to a Skeleton asset. Returns socketId. Use list_bones for exact bone names.',
    inputSchema: z.object({ skeletonId: z.string(), name: z.string(), boneName: z.string() }),
    execute: async ({ skeletonId, name, boneName }) => {
      const skeleton = store().skeletons.find((s) => s.id === skeletonId);
      if (!skeleton) return `No skeleton with id ${skeletonId}.`;
      if (!skeleton.boneNames.includes(boneName)) return `Bone "${boneName}" not on this skeleton.`;
      const id = store().addSkeletonSocket(skeletonId, { name, boneName });
      return id ? `Added socket "${name}" on ${boneName}.` : `Couldn't add socket.`;
    },
  }),

  set_ragdoll_settings: tool({
    description:
      "Tune shared ragdoll settings for a skeleton. Optional fields control body radius, density, damping, groundY, and excluded bone-name pattern.",
    inputSchema: z.object({
      skeletonId: z.string(),
      capsuleRadius: z.number().optional(),
      density: z.number().optional(),
      linearDamping: z.number().optional(),
      angularDamping: z.number().optional(),
      groundY: z.number().optional(),
      excludePattern: z.string().optional(),
    }),
    execute: async ({ skeletonId, ...patch }) => {
      if (!store().skeletons.some((s) => s.id === skeletonId)) return `No skeleton with id ${skeletonId}.`;
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      if (!Object.keys(clean).length) return `No ragdoll fields to update.`;
      store().updateSkeletonRagdoll(skeletonId, clean);
      return `Updated ragdoll tuning on skeleton ${skeletonId}: ${Object.keys(clean).join(', ')}.`;
    },
  }),

  generate_ragdoll_bodies: tool({
    description:
      'Auto-generate default ragdoll bodies for a skeleton, then fine-tune with set_ragdoll_body.',
    inputSchema: z.object({ skeletonId: z.string() }),
    execute: async ({ skeletonId }) => {
      if (!store().skeletons.some((s) => s.id === skeletonId)) return `No skeleton with id ${skeletonId}.`;
      store().generateRagdollBodies(skeletonId);
      const count = store().skeletons.find((s) => s.id === skeletonId)?.ragdoll?.bodies?.length ?? 0;
      return `Generated ${count} ragdoll bodies on skeleton ${skeletonId}.`;
    },
  }),

  set_ragdoll_body: tool({
    description:
      "Configure one bone's ragdoll body override. Use enabled:false to exclude it; omitted fields use skeleton defaults.",
    inputSchema: z.object({
      skeletonId: z.string(),
      boneName: z.string(),
      enabled: z.boolean().optional(),
      shape: z.enum(['capsule', 'box', 'sphere']).optional(),
      radius: z.number().optional(),
      length: z.number().optional(),
      density: z.number().optional(),
      linearDamping: z.number().optional(),
      angularDamping: z.number().optional(),
    }),
    execute: async ({ skeletonId, boneName, ...patch }) => {
      const skeleton = store().skeletons.find((s) => s.id === skeletonId);
      if (!skeleton) return `No skeleton with id ${skeletonId}.`;
      if (!skeleton.boneNames.includes(boneName)) return `Bone "${boneName}" not on this skeleton.`;
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      store().setRagdollBody(skeletonId, boneName, clean);
      return `Set ragdoll body on "${boneName}" (${Object.keys(clean).join(', ') || 'defaults'}).`;
    },
  }),

  remove_ragdoll_body: tool({
    description:
      "Remove a bone's ragdoll body override so it reverts to skeleton defaults.",
    inputSchema: z.object({ skeletonId: z.string(), boneName: z.string() }),
    execute: async ({ skeletonId, boneName }) => {
      if (!store().skeletons.some((s) => s.id === skeletonId)) return `No skeleton with id ${skeletonId}.`;
      store().removeRagdollBody(skeletonId, boneName);
      return `Removed ragdoll body override on "${boneName}".`;
    },
  }),

  attach_to_socket: tool({
    description:
      'Attach an object to a named skeleton socket on a rigged target. Omit socketName to detach.',
    inputSchema: z.object({ objectId: z.string(), targetObjectId: z.string().optional(), socketName: z.string().optional() }),
    execute: async ({ objectId, targetObjectId, socketName }) => {
      if (!findObject(objectId)) return `No object with id ${objectId}.`;
      if (!targetObjectId || !socketName) {
        store().setAttachment(objectId, undefined);
        return `Detached ${objectId}.`;
      }
      const target = findObject(targetObjectId);
      const mesh = target && store().skeletalMeshes.find((m) => m.sourceAssetId === target.renderer?.modelAssetId);
      const skeleton = mesh ? store().skeletons.find((s) => s.id === mesh.skeletonId) : undefined;
      const socket = skeleton?.sockets?.find((s) => s.name === socketName);
      if (!socket) return `No socket "${socketName}" on ${targetObjectId}'s skeleton.`;
      store().setAttachment(objectId, { targetObjectId, boneName: socket.boneName, socketName });
      return `Attached ${objectId} to socket "${socketName}".`;
    },
  }),

  create_third_person_template: tool({
    description:
      'Build a complete GTA-style URBAN third-person starter from bundled assets: a dusk neon city block (road grid + sidewalks + neon-trimmed towers + lampposts), a player pawn with a Fist/Bat/Pistol inventory + a hold-Tab weapon wheel + a GTA radar minimap HUD (health/armor arcs + cash), a parked DRIVABLE car you enter with E and exit with F (camera + HUD hand off to the car), wandering PEDESTRIANS (two you can talk to), CASH pickups, and ARMOR/HEALTH shops you spend cash at — all with contextual [E] prompts. Returns pawn objectId.',
    inputSchema: z.object({}),
    execute: async () => {
      const id = await createThirdPersonTemplate();
      return id ? `Created GTA-style urban third-person starter — pawn objectId ${id}. Press Play: WASD move (Shift sprint), mouse look, LMB attack / RMB aim, Tab weapon wheel. Walk the city, grab cash, buy armor/health at the shops, talk to citizens (E), and walk up to the red car → E to drive (WASD) → F to get out.` : `Couldn't build the template.`;
    },
  }),

  create_first_person_template: tool({
    description:
      'Build a complete cyberpunk-neon FPS starter from bundled assets across TWO scenes. Scene 1 = a training playground: invisible player pawn, 5 camera-bound animated weapon arms with a 1–5 picker, hold-to-fire projectiles (each gun a distinct fire rate/damage/knockback/sound, grenade lobs an explosive orb), neon HUD (crosshair/weapon/ammo), knock-over cubes, a scoring shooting range, a moving target, a bounce pad, a physics tower, and proximity tutorial signs. Scene 2 = a Call-of-Duty-style "Breach & Clear" MISSION reached from a DEPLOY pad: a neon facility where you breach, eliminate line-of-sight enemy guards across 3 rooms, then reach the extraction zone — with an objective banner, an INTEGRITY (health) bar, MISSION FAILED/COMPLETE overlays, and ENTER to redeploy/return. Night environment + bloom + vignette + ambient bed. Returns pawn objectId.',
    inputSchema: z.object({}),
    execute: async () => {
      const id = await createFirstPersonTemplate();
      return id
        ? `Created FPS starter (two scenes) — pawn objectId ${id}. Press Play in the training room: WASD move, mouse look, hold LMB to fire, RMB aim, R reload, 1-5 swap weapons. Step on the magenta DEPLOY pad to enter the Breach & Clear mission: clear every neon guard, then reach the green extraction zone. Your INTEGRITY bar drops under fire — at 0 it's MISSION FAILED (Enter to redeploy); reaching extraction is MISSION COMPLETE (Enter to return to base).`
        : `Couldn't build the FPS template.`;
    },
  }),

  create_film_mode_template: tool({
    description:
      'Build the Film Mode cinematic template: a self-running CYBERPUNK CITY flythrough. Lays a neon street canyon from the bundled city kit (road + raised sidewalk tiles down a long avenue, building blocks + skyscrapers lining both sides, holo-billboards, neon curb rails, a rooftop satellite dish), sets a rainy-night neon environment with strong bloom + vignette, and authors an ~18s autoplay cinematic: a smooth 5-keyframe camera flythrough down the avenue that pulls up to reveal the skyline, with 2.39 letterbox, a teal/orange grade, fade bookends, a slowly sweeping dish, and a cinematic_finished event. Returns cinematicId.',
    inputSchema: z.object({}),
    execute: async () => {
      const id = await createFilmModeTemplate();
      return id ? `Created the Cyberpunk City cinematic with cinematicId ${id}. Press Play to watch the neon flythrough.` : `Couldn't build the Film Mode template.`;
    },
  }),

  create_driving_template: tool({
    description:
      'Build a complete arcade DRIVING starter from the bundled car kit: a "choose your car" start menu (5 cars), then a drivable CITY on a single flat ground slab (no streamed terrain — a city is flat, so it skips procedural chunk/heightfield streaming for steady FPS) — a square street grid (asphalt + raised sidewalk/lot blocks leaving road gaps) with a varied building skyline, dashed lane centerlines, glowing directional arrow chevrons that guide a 4-checkpoint loop through the streets, and practice zones (a roundabout to circle, a cone slalom to weave, parking bays, a pocket park). WASD + mouse-orbit driving with suspension feel (chassis squat/dive/lean + spinning, steering wheels), a real handbrake drift, headlights, brake lights, a full car sound set (looping engine + skid, brake/horn/collision one-shots), and a HUD with a speedometer + lap counter / current & best lap time. The runtime times laps automatically as the car passes the "Checkpoint N" markers in order. Cars are DYNAMIC rigid bodies (convex hull from the car model), so the buildings + roundabout are SOLID and physically stop the car (it bumps/crash-stops), while the loose cones knock flying; sidewalks/markings/arrows are flat and non-colliding. Returns the default car objectId.',
    inputSchema: z.object({}),
    execute: async () => {
      const id = await createDrivingTemplate();
      return id
        ? `Created racing starter — default car objectId ${id}. Press Play: pick a car, then W accelerate, S brake/reverse, A/D steer, Space handbrake (drift), H horn, mouse to look. Follow the cone-lined oval through the checkpoints; laps are timed on the HUD. Tune handling/audio with set_vehicle.`
        : `Couldn't build the driving template.`;
    },
  }),

  set_vehicle: tool({
    description:
      'Add/configure the built-in arcade VEHICLE (car) controller on an object — the driving peer of set_character_controller. WASD drives (W throttle, S brake/reverse, A/D steer, Space handbrake to drift, H horn), the body is a dynamic Rapier body (vertical owned by physics so it rides terrain/ramps), suspension is visual (chassis squat/dive/lean + spinning, steering wheels). The handbrake loosens rear grip (handbrakeGrip) for oversteer; while the tires slip the car leans harder and the skid sound fades in. Wire wheelObjectIds/steeredWheelIds/headlightIds/brakeLightIds to child objects and the engine/skid/brake/horn/collision audio asset ids. Pass enabled:false to remove control. All fields optional.',
    inputSchema: z.object({
      objectId: z.string(),
      enabled: z.boolean().optional(),
      maxSpeed: z.number().optional().describe('Top forward speed (u/s). Default 26.'),
      maxReverseSpeed: z.number().optional().describe('Top reverse speed (u/s). Default 9.'),
      acceleration: z.number().optional().describe('Throttle accel (u/s²). Default 16.'),
      braking: z.number().optional().describe('Brake decel (u/s²). Default 34.'),
      drag: z.number().optional().describe('Coast decel (u/s²). Default 9.'),
      steerAngle: z.number().optional().describe('Max front-wheel steer (radians). Default 0.55.'),
      turnRate: z.number().optional().describe('Yaw turn rate (rad/s) at full lock + speed. Default 2.0.'),
      gripFactor: z.number().optional().describe('Lateral grip 0..1 (drives lean + slip). Default 0.9.'),
      handbrakeGrip: z.number().optional().describe('Rear grip 0..1 while handbrake held — lower = looser drift. Default 0.28.'),
      bodyRoll: z.number().optional().describe('Chassis lean into turns. Default 0.05.'),
      bodyPitch: z.number().optional().describe('Chassis squat/dive under accel/brake. Default 0.04.'),
      suspensionStiffness: z.number().optional().describe('How quickly lean/squat settles, 0..1. Default 0.18.'),
      wheelRadius: z.number().optional().describe('Wheel radius (u) — sets spin rate. Default 0.4.'),
      wheelObjectIds: z.array(z.string()).optional().describe('The 4 wheel child object ids [FL,FR,RL,RR].'),
      steeredWheelIds: z.array(z.string()).optional().describe('Which wheels steer (the front pair).'),
      headlightIds: z.array(z.string()).optional(),
      brakeLightIds: z.array(z.string()).optional(),
      keyThrottle: z.string().optional(),
      keyReverse: z.string().optional(),
      keyLeft: z.string().optional(),
      keyRight: z.string().optional(),
      keyHandbrake: z.string().optional(),
      keyHorn: z.string().optional().describe('Key code that sounds the horn. Default KeyH.'),
      cameraFollow: z.boolean().optional(),
      cameraOffset: vec3.optional().describe('[side, up, back]. Negative Z is behind.'),
      cameraPitch: z.number().optional(),
      mouseLook: z.boolean().optional(),
      engineSoundId: z.string().optional().describe('Audio asset id LOOPED as the engine (playback rate rises with speed).'),
      skidSoundId: z.string().optional().describe('Audio asset id LOOPED while the tires slip (volume ∝ drift).'),
      brakeSoundId: z.string().optional().describe('One-shot brake squeal on hard deceleration.'),
      hornSoundId: z.string().optional().describe('One-shot horn fired on the horn key.'),
      collisionSoundId: z.string().optional().describe('One-shot impact when the car hits something while moving.'),
    }),
    execute: async ({ objectId, enabled, ...patch }) => {
      const object = findObject(objectId);
      if (!object) return `No object with id ${objectId}.`;
      if (enabled === false) {
        store().setVehicleEnabled(objectId, false);
        return `Disabled vehicle controller on ${object.name}.`;
      }
      store().setVehicleEnabled(objectId, true);
      if (Object.keys(patch).length) {
        const { cameraOffset, ...rest } = patch;
        store().updateVehicle(objectId, {
          ...rest,
          ...(cameraOffset ? { cameraOffset: asVec3(cameraOffset) } : {}),
        });
      }
      return `Updated vehicle controller on ${object.name}.`;
    },
  }),

  create_cinematic: tool({
    description:
      'Create a Film Mode cinematic timeline in the active scene. Use this for AI-authored cutscenes: camera cuts, object transform tracks, temporary spawns, animation montages, sounds, custom events, visibility, and fades.',
    inputSchema: z.object({
      name: z.string().optional(),
      duration: z.number().min(0.5).optional(),
      frameRate: z.number().min(1).max(120).optional(),
      folder: z.string().optional(),
      autoplay: z.boolean().optional(),
      actions: z.array(cinematicActionSchema).optional(),
    }),
    execute: async ({ name, duration = 8, frameRate, folder, autoplay, actions = [] }) => {
      const id = store().createCinematic(name ?? 'AI Cinematic', duration);
      store().updateCinematic(id, { autoplay, frameRate, folder });
      const created = actions
        .map((action) => store().addCinematicAction(id, normalizeCinematicAction(action)))
        .filter(Boolean);
      return `Created cinematic "${name ?? 'AI Cinematic'}" with cinematicId ${id} and ${created.length} actions.`;
    },
  }),

  create_storyboard_cinematic: tool({
    description:
      'Create a complete Sequencer-style storyboard cinematic in one call: a new sequence with film look, fades, camera shots or a smooth camera path, optional autoplay, and an optional end event for gameplay handoff. Prefer this over many low-level add_cinematic_action calls when the user asks for an intro, reveal, boss arrival, vista flyover, or simple cutscene.',
    inputSchema: z.object({
      name: z.string().optional(),
      preset: z.enum(STORYBOARD_PRESETS).optional().describe('three-shot-intro = establishing/push/reveal; orbit-reveal = one smooth camera path; gameplay-handoff = intro that ends near a gameplay camera angle.'),
      subjectObjectId: z.string().optional().describe('Optional object to frame. Omit to frame the active scene center.'),
      focusPoint: vec3.optional().describe('Optional explicit world focus point. Overrides subject framing when provided.'),
      duration: z.number().min(3).optional(),
      autoplay: z.boolean().optional(),
      includeFades: z.boolean().optional(),
      endEventName: z.string().optional().describe('Optional custom event fired near the end, e.g. cinematic_finished/start_gameplay.'),
      letterbox: z.number().min(0).max(3).optional(),
      grade: z.enum(['none', 'warm', 'teal-orange', 'noir', 'cool', 'sepia', 'custom']).optional(),
      gradeIntensity: z.number().min(0).max(1).optional(),
      grain: z.number().min(0).max(1).optional(),
      vignette: z.number().min(0).max(1).optional(),
    }),
    execute: async ({ name, preset, subjectObjectId, focusPoint, duration, autoplay, includeFades, endEventName, letterbox, grade, gradeIntensity, grain, vignette }) => {
      if (subjectObjectId && !findObject(subjectObjectId)) return `No object with id ${subjectObjectId}.`;
      const result = createStoryboardCinematic({
        name,
        preset,
        subjectObjectId,
        focusPoint: focusPoint ? asVec3(focusPoint) : undefined,
        duration,
        autoplay,
        includeFades,
        endEventName,
        look: { letterbox, grade, gradeIntensity, grain, vignette },
      });
      if (!result) return 'No active scene to add a storyboard cinematic to.';
      const subject = result.subjectName ? ` around ${result.subjectName}` : '';
      return `Created ${result.preset} storyboard cinematic${subject}: cinematicId ${result.cinematicId}, ${result.actionCount} actions, focus [${result.focus.join(', ')}].`;
    },
  }),

  duplicate_cinematic_take: tool({
    description:
      'Duplicate an existing Film Mode cinematic as a new take. Use this before trying alternate edits so the original sequence stays intact.',
    inputSchema: z.object({ cinematicId: z.string() }),
    execute: async ({ cinematicId }) => {
      const id = store().duplicateCinematicTake(cinematicId);
      return id ? `Duplicated cinematic ${cinematicId} as take ${id}.` : `No cinematic with id ${cinematicId}.`;
    },
  }),

  add_cinematic_marker: tool({
    description:
      'Add a timeline marker to a Film Mode cinematic. Use markers for named beats, edit notes, determinism fences, or AI/user handoff points.',
    inputSchema: z.object({
      cinematicId: z.string(),
      time: z.number().min(0),
      label: z.string().optional(),
      color: z.string().optional(),
      determinismFence: z.boolean().optional(),
    }),
    execute: async ({ cinematicId, time, label, color, determinismFence }) => {
      const id = store().addCinematicMarker(cinematicId, { time, label, color, determinismFence });
      return id ? `Added marker ${id} to cinematic ${cinematicId}.` : `No cinematic with id ${cinematicId}.`;
    },
  }),

  add_cinematic_action: tool({
    description:
      'Add one timed action to an existing Film Mode cinematic. Use after create_cinematic when iterating on a cutscene.',
    inputSchema: z.object({ cinematicId: z.string(), action: cinematicActionSchema }),
    execute: async ({ cinematicId, action }) => {
      const id = store().addCinematicAction(cinematicId, normalizeCinematicAction(action));
      return id ? `Added cinematic action ${id}.` : `No cinematic with id ${cinematicId}.`;
    },
  }),

  add_cinematic_shot: tool({
    description:
      'Add one static camera shot (a single framing) to a Film Mode cinematic — the "shot list" primitive. Each call is a cut to a new framing; chain several to edit a sequence (e.g. wide → push-in → reveal). Set blend>0 to dolly from the previous shot instead of a hard cut. Add focusDistance+aperture for depth-of-field; differing focusDistance across a blended shot pair produces a rack-focus pull.',
    inputSchema: z.object({
      cinematicId: z.string(),
      time: z.number().min(0).describe('Seconds from cinematic start when this shot cuts in.'),
      position: vec3.describe('Camera world position.'),
      lookAt: vec3.describe('World point the camera frames.'),
      fov: z.number().min(10).max(140).optional().describe('Field of view in degrees (default 50; lower = tighter/more telephoto).'),
      blend: z.number().min(0).max(10).optional().describe('Seconds to dolly from the previous shot. 0 = hard cut (default for the first shot); ~1–2 for a smooth move.'),
      focusDistance: z.number().min(0).optional().describe('Depth-of-field focus distance in world units ahead of the camera.'),
      aperture: z.number().min(0).max(12).optional().describe('Depth-of-field blur strength (bokeh). 0 = sharp, 3–6 = shallow cinematic focus.'),
      duration: z.number().min(0).optional(),
      label: z.string().optional(),
    }),
    execute: async ({ cinematicId, time, position, lookAt, fov, blend, focusDistance, aperture, duration, label }) => {
      const id = store().addCinematicShot(cinematicId, { time, position: asVec3(position), lookAt: asVec3(lookAt), fov, blend, focusDistance, aperture, duration, label });
      return id ? `Added camera shot ${id} at ${time}s.` : `No cinematic with id ${cinematicId}.`;
    },
  }),

  set_cinematic_look: tool({
    description:
      'Set the film "look" of a cinematic: letterbox bars, film grain, an extra vignette, and a real color grade rendered on the cinematic camera. Use to make a cutscene read as a movie. The grade is a preset PLUS optional manual params (exposure/contrast/saturation/temperature/tint) scaled by gradeIntensity — pass a preset for a quick look, or the manual params (with grade:"custom") to dial it in.',
    inputSchema: z.object({
      cinematicId: z.string(),
      letterbox: z.number().min(0).max(3).optional().describe('Letterbox aspect ratio (e.g. 2.39 for scope, 1.85 for flat). 0 = no bars.'),
      grade: z.enum(['none', 'warm', 'teal-orange', 'noir', 'cool', 'sepia', 'custom']).optional().describe('Color grade preset. Seeds the params below; use "custom" to drive the grade purely from the params.'),
      gradeIntensity: z.number().min(0).max(1).optional().describe('Overall grade strength (mix between original and graded). Default 1.'),
      exposure: z.number().min(-1).max(1).optional().describe('Exposure offset in stops. Overrides the preset.'),
      contrast: z.number().min(-1).max(1).optional().describe('Contrast, −1..1. Overrides the preset.'),
      saturation: z.number().min(-1).max(1).optional().describe('Saturation, −1 (grayscale) .. 1 (boosted). Overrides the preset.'),
      temperature: z.number().min(-1).max(1).optional().describe('Color temperature, −1 (cool) .. 1 (warm). Overrides the preset.'),
      tint: z.string().optional().describe('Custom tint color (hex) multiplied into the image by tintAmount.'),
      tintAmount: z.number().min(0).max(1).optional().describe('Strength of the custom tint, 0–1.'),
      grain: z.number().min(0).max(1).optional().describe('Film-grain strength, 0–1.'),
      vignette: z.number().min(0).max(1).optional().describe('Darkened-edge vignette strength, 0–1.'),
    }),
    execute: async ({ cinematicId, letterbox, grade, gradeIntensity, exposure, contrast, saturation, temperature, tint, tintAmount, grain, vignette }) => {
      if (!store().activeScene()?.cinematics?.some((cinematic) => cinematic.id === cinematicId)) return `No cinematic with id ${cinematicId}.`;
      store().setCinematicLook(cinematicId, { letterbox, grade, gradeIntensity, exposure, contrast, saturation, temperature, tint, tintAmount, grain, vignette });
      return `Updated film look for cinematic ${cinematicId}.`;
    },
  }),

  animate_on_timeline: tool({
    description:
      'Create an object animation on a Film Mode timeline. This adds a transform track/keyframed clip for moving, rotating, and/or scaling a scene object over time. Use for prompts like "make mesh X move/turn/grow from time A to B".',
    inputSchema: z.object({
      objectId: z.string(),
      cinematicId: z.string().optional().describe('Existing cinematic id. Omit to create/use an AI Cinematic.'),
      name: z.string().optional().describe('Name for a new cinematic if cinematicId is omitted.'),
      startTime: z.number().min(0).optional().describe('Start time in seconds. Default 0.'),
      duration: z.number().min(0.05).optional().describe('Clip length in seconds. Default 2.'),
      fromPosition: vec3.optional(),
      toPosition: vec3.optional(),
      fromRotation: vec3.optional(),
      toRotation: vec3.optional(),
      fromScale: vec3.optional(),
      toScale: vec3.optional(),
      label: z.string().optional(),
      autoplay: z.boolean().optional(),
    }),
    execute: async ({ objectId, cinematicId, name, startTime = 0, duration = 2, fromPosition, toPosition, fromRotation, toRotation, fromScale, toScale, label, autoplay }) => {
      const object = findObject(objectId);
      if (!object) return `No object with id ${objectId}.`;
      let id = cinematicId;
      if (id && !store().activeScene()?.cinematics?.some((cinematic) => cinematic.id === id)) return `No cinematic with id ${id}.`;
      if (!id) {
        id = store().activeScene()?.cinematics?.[0]?.id ?? store().createCinematic(name ?? 'AI Timeline Animation', Math.max(4, startTime + duration));
      }
      store().updateCinematic(id, { autoplay, duration: Math.max(store().activeScene()?.cinematics?.find((cinematic) => cinematic.id === id)?.duration ?? 0.5, startTime + duration) });
      const actionId = store().addCinematicAction(id, {
        type: 'transform',
        time: startTime,
        duration,
        label: label ?? `Animate ${object.name}`,
        objectId,
        fromPosition: fromPosition ? asVec3(fromPosition) : object.transform.position,
        toPosition: toPosition ? asVec3(toPosition) : undefined,
        fromRotation: fromRotation ? asVec3(fromRotation) : object.transform.rotation,
        toRotation: toRotation ? asVec3(toRotation) : undefined,
        fromScale: fromScale ? asVec3(fromScale) : object.transform.scale,
        toScale: toScale ? asVec3(toScale) : undefined,
      });
      return actionId ? `Added timeline animation ${actionId} for ${object.name} in cinematic ${id}.` : `Couldn't add timeline animation.`;
    },
  }),

  play_cinematic: tool({
    description: 'Preview or stop a Film Mode cinematic in the active scene. The game must be in Play mode for camera/fade runtime preview.',
    inputSchema: z.object({ cinematicId: z.string().optional(), stop: z.boolean().optional() }),
    execute: async ({ cinematicId, stop }) => {
      if (stop) {
        store().stopCinematic();
        return 'Stopped cinematic playback.';
      }
      const id = cinematicId ?? store().activeScene()?.cinematics?.[0]?.id;
      if (!id) return 'No cinematic found in the active scene.';
      store().playCinematic(id);
      return `Started cinematic ${id}.`;
    },
  }),

  create_prefab: tool({
    description:
      'Capture an object tree as a reusable prefab. Returns prefabId; instantiate_prefab stamps copies later.',
    inputSchema: z.object({ objectId: z.string(), name: z.string().optional(), folderId: z.string().optional() }),
    execute: async ({ objectId, name, folderId }) => {
      if (!findObject(objectId)) return `No object with id ${objectId}.`;
      const id = store().createPrefabFromObject(objectId, name, folderId);
      return id ? `Created prefab "${findPrefab(id)?.name}" with prefabId ${id}.` : `Couldn't create a prefab from ${objectId}.`;
    },
  }),

  inspect_prefab: tool({
    description:
      "Read a prefab's full contents (its object tree with components) WITHOUT opening it for editing. Use this to see what's inside a prefab before instantiating or editing — the scene snapshot only lists prefabs by name/objectCount to stay lean.",
    inputSchema: z.object({ prefabId: z.string() }),
    execute: async ({ prefabId }) => {
      const prefab = findPrefab(prefabId);
      if (!prefab) return `No prefab with id ${prefabId}.`;
      const objects = prefab.objects.map((object) => ({
        id: object.id,
        name: object.name,
        kind: object.kind,
        parentId: object.parentId ?? null,
        position: object.transform.position,
        color: object.renderer?.color ?? null,
        modelAssetId: object.renderer?.modelAssetId ?? null,
        materialId: object.renderer?.materialId ?? null,
        physics: object.physics?.enabled ? { bodyType: object.physics.bodyType, collider: object.physics.collider } : null,
        blueprintId: object.script?.enabled ? object.script.blueprintId : null,
        animatorControllerId: object.animator?.controllerId ?? null,
      }));
      return JSON.stringify({ id: prefab.id, name: prefab.name, rootId: prefab.rootId, objects });
    },
  }),

  export_prefab_package: tool({
    description:
      'Export a prefab + its full dependency closure (blueprint, graph, materials, particles, animator/skeleton/animations, sounds, UI, referenced assets) as a portable .nfpack package file the user can share or reimport into another project. Opens a save dialog (desktop) / downloads the file (web). Use when the user wants to package, share, sell, or back up a reusable template.',
    inputSchema: z.object({
      prefabId: z.string(),
      name: z.string().optional().describe('Package name; defaults to the prefab name.'),
      description: z.string().optional(),
      author: z.string().optional(),
      version: z.string().optional().describe('Content semver, e.g. "1.0.0".'),
      tags: z.array(z.string()).optional(),
    }),
    execute: async ({ prefabId, name, description, author, version, tags }) => {
      if (!findPrefab(prefabId)) return `No prefab with id ${prefabId}.`;
      const collected = store().buildPrefabPackage(prefabId);
      if (!collected) return `Couldn't collect dependencies for prefab ${prefabId}.`;
      await projectStore().exportPrefabPackage(prefabId, { name, description, author, version, tags });
      const c = collected.content;
      return `Exporting package "${name ?? findPrefab(prefabId)?.name}" — ${c.prefabs.length} prefab(s), ${c.blueprints.length} blueprint(s), ${c.materials.length} material(s), ${collected.assetIds.length} asset(s). The user chooses where to save it.`;
    },
  }),

  export_folder_package: tool({
    description:
      "Export EVERYTHING in a project-browser folder (and its subfolders) plus all dependencies as one portable .nfpack package — the equivalent of Unreal's 'Migrate folder'. Use when the user wants to package a whole folder of prefabs/blueprints/materials/etc. at once rather than a single prefab. Find the folderId in the snapshot's folders list.",
    inputSchema: z.object({
      folderId: z.string(),
      name: z.string().optional().describe('Package name; defaults to the folder name.'),
      description: z.string().optional(),
      author: z.string().optional(),
      version: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }),
    execute: async ({ folderId, name, description, author, version, tags }) => {
      const collected = store().buildFolderPackage(folderId);
      if (!collected) return `Folder ${folderId} is empty or not found — nothing to export.`;
      await projectStore().exportFolderPackage(folderId, { name, description, author, version, tags });
      const c = collected.content;
      return `Exporting folder package "${name ?? collected.name}" — ${c.prefabs.length} prefab(s), ${c.blueprints.length} blueprint(s), ${c.materials.length} material(s), ${collected.assetIds.length} asset(s). The user chooses where to save it.`;
    },
  }),

  import_package: tool({
    description:
      'Import a .nfpack package (a prefab + its dependencies, or a whole module) into the current project. Opens a file picker. Import is purely additive — every id is regenerated so it never overwrites or breaks existing objects, blueprints, variables or assets. After import the new prefab(s) appear in the Project browser; instantiate_prefab to place one. Remind the user to back up first if the project matters.',
    inputSchema: z.object({}),
    execute: async () => {
      const before = store().prefabs.length;
      await projectStore().importPackageFromFile();
      const added = store().prefabs.length - before;
      return added > 0
        ? `Imported a package — ${added} new prefab(s) added to the Project browser. Use instantiate_prefab to place one in the scene.`
        : `Import dialog closed — no package was imported.`;
    },
  }),

  instantiate_prefab: tool({
    description:
      'Stamp an independent copy of a prefab into the active scene (fresh ids). Returns the new root objectId. Instances are one-time stamps — editing the prefab later does not change them. Optionally place it at a position or nest it under a parent.',
    inputSchema: z.object({ prefabId: z.string(), position: vec3.optional(), parentId: z.string().optional() }),
    execute: async ({ prefabId, position, parentId }) => {
      if (!findPrefab(prefabId)) return `No prefab with id ${prefabId}.`;
      if (parentId && !findObject(parentId)) return `No object with id ${parentId} to parent under.`;
      const id = store().instantiatePrefab(prefabId, {
        position: position ? asVec3(position) : undefined,
        parentId,
      });
      return id ? `Instantiated prefab ${prefabId} — new objectId ${id}.` : `Couldn't instantiate prefab ${prefabId}.`;
    },
  }),

  open_prefab: tool({
    description:
      'Open a prefab for editing: the active scene becomes the prefab\'s contents so all object tools edit the prefab. The snapshot\'s editingPrefabId becomes non-null. Add/nest objects, then call close_prefab to finish. Blocked during Play.',
    inputSchema: z.object({ prefabId: z.string() }),
    execute: async ({ prefabId }) => {
      if (!findPrefab(prefabId)) return `No prefab with id ${prefabId}.`;
      if (store().isPlaying) return `Stop Play before editing a prefab.`;
      store().openPrefabEditor(prefabId);
      return `Editing prefab ${prefabId}. Object tools now edit its contents; call close_prefab(save:true) when done.`;
    },
  }),

  close_prefab: tool({
    description:
      'Close the prefab editor. save:true (default) writes your edits back into the prefab (and all future instances); save:false discards them. Returns to the scene you were in before.',
    inputSchema: z.object({ save: z.boolean().optional() }),
    execute: async ({ save }) => {
      if (!store().editingPrefabId) return `Not currently editing a prefab.`;
      store().closePrefabEditor(save ?? true);
      return save === false ? `Discarded prefab edits and closed the editor.` : `Saved prefab edits and closed the editor.`;
    },
  }),

  rename_prefab: tool({
    description: 'Rename a prefab.',
    inputSchema: z.object({ id: z.string(), name: z.string() }),
    execute: async ({ id, name }) => {
      if (!findPrefab(id)) return `No prefab with id ${id}.`;
      store().renamePrefab(id, name);
      return `Renamed prefab to "${name}".`;
    },
  }),

  delete_prefab: tool({
    description: 'Delete a prefab from the library. Already-placed instances in scenes are unaffected.',
    inputSchema: z.object({ id: z.string() }),
    execute: async ({ id }) => {
      if (!findPrefab(id)) return `No prefab with id ${id}.`;
      store().deletePrefab(id);
      return `Deleted prefab ${id}.`;
    },
  }),

  apply_instance_to_prefab: tool({
    description:
      "Push a prefab-INSTANCE's current edits back into its source prefab so FUTURE instances inherit them. Pass the instance's root objectId (one whose snapshot prefabSourceId is set). Other already-placed instances are NOT changed (stamps are independent). Returns the updated prefabId.",
    inputSchema: z.object({ objectId: z.string() }),
    execute: async ({ objectId }) => {
      const object = findObject(objectId);
      if (!object) return `No object with id ${objectId}.`;
      if (!object.prefabSourceId) return `${objectId} isn't a prefab instance (no prefabSourceId).`;
      const id = store().applyInstanceToPrefab(objectId);
      return id ? `Applied ${objectId}'s changes to prefab ${id}.` : `Couldn't apply ${objectId} to its prefab.`;
    },
  }),

  revert_instance_to_prefab: tool({
    description:
      "Discard a prefab-instance's local edits and replace it with a fresh copy of its prefab, keeping its position/parent. Pass the instance's root objectId (snapshot prefabSourceId set). Returns the new root objectId.",
    inputSchema: z.object({ objectId: z.string() }),
    execute: async ({ objectId }) => {
      const object = findObject(objectId);
      if (!object) return `No object with id ${objectId}.`;
      if (!object.prefabSourceId) return `${objectId} isn't a prefab instance (no prefabSourceId).`;
      const id = store().revertInstanceToPrefab(objectId);
      return id ? `Reverted instance to its prefab — new objectId ${id}.` : `Couldn't revert ${objectId}.`;
    },
  }),

  create_material: tool({
    description:
      'Create a reusable material asset with a Material Output graph. Returns materialId; assign with set_object_material.',
    inputSchema: z.object({ name: z.string().optional(), folderId: z.string().optional() }),
    execute: async ({ name, folderId }) => {
      const id = store().createMaterial(name, undefined, folderId);
      return `Created material "${findMaterial(id)?.name}" with materialId ${id}.`;
    },
  }),

  update_material: tool({
    description:
      'Update a reusable material. Color fields are hex; metalness/roughness are 0-1; texture/normal ids must be image assets.',
    inputSchema: z.object({
      id: z.string(),
      name: z.string().optional(),
      color: z.string().optional(),
      metalness: z.number().min(0).max(1).optional(),
      roughness: z.number().min(0).max(1).optional(),
      emissiveColor: z.string().optional(),
      emissiveIntensity: z.number().min(0).optional(),
      textureAssetId: z.string().optional().describe('Image asset id for the base-color map, or "" to clear.'),
      normalMapAssetId: z.string().optional().describe('Image asset id for the normal map, or "" to clear.'),
    }),
    execute: async ({ id, textureAssetId, normalMapAssetId, ...rest }) => {
      if (!findMaterial(id)) return `No material with id ${id}.`;
      for (const [field, value] of [
        ['textureAssetId', textureAssetId],
        ['normalMapAssetId', normalMapAssetId],
      ] as const) {
        if (value) {
          const asset = findAsset(value);
          if (!asset) return `No asset with id ${value} for ${field}.`;
          if (asset.type !== 'image') return `Asset ${value} is a ${asset.type}, not an image — ${field} must be an image asset.`;
        }
      }
      const patch: Partial<MaterialDefinition> = { ...rest };
      if (textureAssetId !== undefined) patch.textureAssetId = textureAssetId || undefined;
      if (normalMapAssetId !== undefined) patch.normalMapAssetId = normalMapAssetId || undefined;
      store().updateMaterial(id, patch);
      return `Updated material ${id}.`;
    },
  }),

  set_object_material: tool({
    description:
      "Assign a reusable material to an object (overrides its inline color/texture and a model's baked materials), or clear it. The materialId must be a material from the snapshot.",
    inputSchema: z.object({
      objectId: z.string(),
      materialId: z.string().optional().describe('Material id, or omit/empty to detach the material.'),
    }),
    execute: async ({ objectId, materialId }) => {
      if (!findObject(objectId)) return `No object with id ${objectId}.`;
      if (materialId && !findMaterial(materialId)) return `No material with id ${materialId}.`;
      store().setObjectMaterial(objectId, materialId || undefined);
      return materialId ? `Assigned material ${materialId} to ${objectId}.` : `Detached the material from ${objectId}.`;
    },
  }),

  delete_material: tool({
    description: 'Delete a reusable material (and its node graph). Objects using it revert to their inline material.',
    inputSchema: z.object({ id: z.string() }),
    execute: async ({ id }) => {
      if (!findMaterial(id)) return `No material with id ${id}.`;
      store().deleteMaterial(id);
      return `Deleted material ${id}.`;
    },
  }),

  create_ui_document: tool({
    description:
      'Create a screen HUD or world UI document with a root panel. Returns uiDocumentId; add elements or presets next. Set renderMode "webgl" for cinematic UI rendered inside the 3D canvas (gets bloom/post-FX, depth-correct in world space, and required for diegetic in-world screens and element fx).',
    inputSchema: z.object({
      name: z.string().optional(),
      surface: z.enum(['screen', 'world']).optional().describe('Defaults to "screen".'),
      renderMode: z.enum(['dom', 'webgl']).optional().describe('"dom" (default) = HTML/CSS overlay. "webgl" = rendered in-canvas via uikit; enables bloom, world-space depth occlusion, diegetic surfaces, and element fx.'),
      folderId: z.string().optional(),
    }),
    execute: async ({ name, surface, renderMode, folderId }) => {
      const id = store().createUIDocument(name, surface ?? 'screen', folderId);
      if (renderMode) store().updateUIDocument(id, { renderMode });
      const doc = findUIDocument(id);
      return `Created ${doc?.surface} UI "${doc?.name}" (${doc?.renderMode ?? 'dom'} renderer) with uiDocumentId ${id}. Its root panel id is ${doc?.root.id}.`;
    },
  }),

  set_ui_render_mode: tool({
    description:
      'Switch an existing UI document between the DOM overlay and the WebGL (uikit) renderer. WebGL gets bloom/post-FX, depth-correct world placement, diegetic surfaces and element fx; DOM has full CSS. Use on docs from create_ui_template to make them cinematic.',
    inputSchema: z.object({
      documentId: z.string(),
      renderMode: z.enum(['dom', 'webgl']),
    }),
    execute: async ({ documentId, renderMode }) => {
      const doc = findUIDocument(documentId);
      if (!doc) return `No UI document with id ${documentId}.`;
      store().updateUIDocument(documentId, { renderMode });
      return `UI "${doc.name}" now uses the ${renderMode} renderer.`;
    },
  }),

  create_ui_template: tool({
    description:
      'Create a polished screen UI template in one call. Use for beautiful HUDs, main menus, dialogue boxes, inventory panels, and quick UI mockups.',
    inputSchema: z.object({
      template: z.enum(['hud', 'mainMenu', 'dialogue', 'inventory']).optional().describe('Defaults to hud.'),
      name: z.string().optional(),
      title: z.string().optional(),
      themeColor: z.string().optional().describe('Primary accent hex color. Defaults to #3DDC97.'),
      folderId: z.string().optional(),
    }),
    execute: async ({ template = 'hud', name, title, themeColor, folderId }) => {
      const accent = themeColor ?? '#3DDC97';
      const documentId = store().createUIDocument(name ?? `${title ?? template} UI`, 'screen', folderId);
      const doc = findUIDocument(documentId);
      if (!doc) return `Couldn't create UI template.`;
      const rootId = doc.root.id;
      const elements: Record<string, string> = { rootId };
      const add = (kind: 'panel' | 'text' | 'bar' | 'button' | 'image', parentId = rootId) => {
        const id = store().addUIElement(documentId, parentId, kind);
        return id;
      };
      const update = (elementId: string, patch: Partial<UIElement>) => store().updateUIElement(documentId, elementId, patch);

      setUIStyle(documentId, rootId, {
        width: '100%',
        height: '100%',
        padding: '18px',
        custom: { pointerEvents: 'none' },
      });

      if (template === 'mainMenu') {
        setUIStyle(documentId, rootId, {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(4,8,14,0.42)',
        });
        const panel = add('panel');
        elements.panel = panel;
        setUIStyle(documentId, panel, {
          width: '360px',
          padding: '22px',
          gap: '12px',
          background: 'rgba(12,17,24,0.86)',
          border: '1px solid rgba(255,255,255,0.14)',
          borderRadius: '8px',
          custom: { boxShadow: '0 18px 52px rgba(0,0,0,0.38)', backdropFilter: 'blur(12px)' },
        });
        const heading = add('text', panel);
        elements.heading = heading;
        update(heading, {
          text: title ?? 'New Game',
          style: { color: '#ffffff', fontSize: '34px', fontWeight: '800', textAlign: 'center' },
        });
        const subtitle = add('text', panel);
        elements.subtitle = subtitle;
        update(subtitle, {
          text: 'Choose your next move',
          style: { color: '#B8C2D8', fontSize: '13px', textAlign: 'center' },
        });
        for (const [index, label] of ['Start', 'Options', 'Quit'].entries()) {
          const button = add('button', panel);
          elements[`button${index + 1}`] = button;
          update(button, {
            text: label,
            onClickEvent: label === 'Start' ? 'startGame' : `${label.toLowerCase()}Pressed`,
            style: {
              padding: '11px 14px',
              background: index === 0 ? accent : 'rgba(255,255,255,0.08)',
              color: '#ffffff',
              borderRadius: '8px',
              fontWeight: '700',
              textAlign: 'center',
            },
          });
        }
      } else if (template === 'dialogue') {
        setUIStyle(documentId, rootId, { custom: { pointerEvents: 'auto' } });
        const box = add('panel');
        elements.dialogueBox = box;
        setUIStyle(documentId, box, {
          width: 'min(760px, calc(100% - 40px))',
          padding: '18px',
          gap: '8px',
          background: 'rgba(8,12,18,0.88)',
          border: '1px solid rgba(255,255,255,0.16)',
          borderRadius: '8px',
          position: 'absolute',
          left: '20px',
          custom: { bottom: '20px', boxShadow: '0 14px 44px rgba(0,0,0,0.42)' },
        });
        const speaker = add('text', box);
        elements.speaker = speaker;
        update(speaker, {
          text: title ?? 'Guide',
          style: { color: accent, fontSize: '13px', fontWeight: '800' },
        });
        const body = add('text', box);
        elements.body = body;
        update(body, {
          text: 'The door is locked. Find the key, then come back.',
          style: { color: '#ffffff', fontSize: '18px' },
        });
        const button = add('button', box);
        elements.continueButton = button;
        update(button, {
          text: 'Continue',
          onClickEvent: 'dialogueContinue',
          style: { width: '120px', padding: '9px 12px', background: accent, color: '#06100d', borderRadius: '8px', fontWeight: '800' },
        });
      } else if (template === 'inventory') {
        const panel = add('panel');
        elements.panel = panel;
        setUIStyle(documentId, panel, {
          width: '280px',
          padding: '14px',
          gap: '10px',
          background: 'rgba(10,15,22,0.84)',
          border: '1px solid rgba(255,255,255,0.14)',
          borderRadius: '8px',
          position: 'absolute',
          custom: { right: '18px', top: '18px', boxShadow: '0 12px 36px rgba(0,0,0,0.32)' },
        });
        const heading = add('text', panel);
        elements.heading = heading;
        update(heading, {
          text: title ?? 'Inventory',
          style: { color: '#ffffff', fontSize: '18px', fontWeight: '800' },
        });
        for (let i = 1; i <= 5; i += 1) {
          const slot = add('panel', panel);
          elements[`slot${i}`] = slot;
          setUIStyle(documentId, slot, {
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: '10px',
            padding: '9px',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px',
          });
          const index = add('text', slot);
          update(index, { text: String(i), style: { color: accent, fontSize: '13px', fontWeight: '800', width: '18px' } });
          const item = add('text', slot);
          update(item, { text: i === 1 ? 'Starter Blade' : 'Empty Slot', style: { color: '#ffffff', fontSize: '13px' } });
        }
      } else {
        const health = ensureNumberVariable('Health', 100);
        const score = ensureNumberVariable('Score', 0);
        const ammo = ensureNumberVariable('Ammo', 12);
        const top = add('panel');
        elements.topBar = top;
        setUIStyle(documentId, top, {
          display: 'flex',
          flexDirection: 'row',
          gap: '12px',
          position: 'absolute',
          left: '18px',
          custom: { top: '18px', right: '18px', justifyContent: 'space-between', alignItems: 'flex-start' },
        });
        const left = add('panel', top);
        elements.leftCluster = left;
        setUIStyle(documentId, left, {
          gap: '7px',
          padding: '10px',
          background: 'rgba(7,11,18,0.66)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '8px',
        });
        const label = add('text', left);
        update(label, { text: title ?? 'Player', style: { color: '#FFFFFF', fontSize: '13px', fontWeight: '800' } });
        const healthBar = add('bar', left);
        elements.healthBar = healthBar;
        setUIStyle(documentId, healthBar, { width: '210px', height: '12px', background: 'rgba(255,255,255,0.12)', borderRadius: '8px' });
        store().setUIBinding(documentId, healthBar, 'fill', `${health} / 100`);
        store().setUIBinding(documentId, healthBar, 'color', `'${accent}'`);
        const scoreText = add('text', top);
        elements.scoreText = scoreText;
        update(scoreText, {
          text: 'Score: 0',
          style: {
            color: '#ffffff',
            fontSize: '17px',
            fontWeight: '800',
            textAlign: 'right',
            custom: { textShadow: '0 2px 8px rgba(0,0,0,0.7)' },
          },
        });
        store().setUIBinding(documentId, scoreText, 'text', `'Score: ' + ${score}`);
        const crosshair = add('text');
        elements.crosshair = crosshair;
        update(crosshair, {
          text: '+',
          style: {
            position: 'absolute',
            left: '50%',
            top: '50%',
            color: 'rgba(255,255,255,0.8)',
            fontSize: '24px',
            fontWeight: '700',
            textAlign: 'center',
            custom: { transform: 'translate(-50%, -50%)', textShadow: '0 1px 6px rgba(0,0,0,0.7)' },
          },
        });
        const ammoText = add('text');
        elements.ammoText = ammoText;
        update(ammoText, {
          text: 'Ammo: 12',
          style: {
            position: 'absolute',
            color: '#ffffff',
            fontSize: '22px',
            fontWeight: '800',
            textAlign: 'right',
            custom: { right: '20px', bottom: '18px', textShadow: '0 2px 8px rgba(0,0,0,0.7)' },
          },
        });
        store().setUIBinding(documentId, ammoText, 'text', `'Ammo: ' + ${ammo}`);
      }

      store().setActiveUIDocument(documentId);
      return `Created polished ${template} UI "${findUIDocument(documentId)?.name}" with uiDocumentId ${documentId}. Elements: ${JSON.stringify(elements)}.`;
    },
  }),

  add_ui_element: tool({
    description:
      'Add a UI element under a parent or root. Kinds: panel, text, bar, button, image. Returns elementId.',
    inputSchema: z.object({
      documentId: z.string(),
      parentId: z.string().optional().describe('Parent element id; defaults to the root panel.'),
      kind: z.enum(['panel', 'text', 'bar', 'button', 'image']),
    }),
    execute: async ({ documentId, parentId, kind }) => {
      if (!findUIDocument(documentId)) return `No UI document with id ${documentId}.`;
      const id = store().addUIElement(documentId, parentId, kind);
      return `Added ${kind} element ${id} to UI ${documentId}.`;
    },
  }),

  update_ui_element: tool({
    description:
      'Update UI element text/name/class/event/image/style/fx. Style uses CSS-like strings plus flexDirection/textAlign enums. fx applies only when the document renderMode is "webgl".',
    inputSchema: z.object({
      documentId: z.string(),
      elementId: z.string(),
      name: z.string().optional(),
      text: z.string().optional(),
      className: z.string().optional(),
      onClickEvent: z.string().optional(),
      assetId: z.string().optional(),
      fx: z.enum(['glow', 'holographic', 'scanline']).optional().describe('WebGL-only visual effect. "glow" blooms via post-FX (use a bright color); "holographic"/"scanline" render translucent. Pass "" via none is not supported here; omit to leave unchanged.'),
      style: z
        .object({
          background: z.string().optional(),
          color: z.string().optional(),
          width: z.string().optional(),
          height: z.string().optional(),
          padding: z.string().optional(),
          gap: z.string().optional(),
          fontSize: z.string().optional(),
          borderRadius: z.string().optional(),
          flexDirection: z.enum(['row', 'column']).optional(),
          textAlign: z.enum(['left', 'center', 'right']).optional(),
        })
        .optional(),
    }),
    execute: async ({ documentId, elementId, style, ...rest }) => {
      const doc = findUIDocument(documentId);
      if (!doc) return `No UI document with id ${documentId}.`;
      const existing = findUIElement(doc.root, elementId);
      if (!existing) return `No element ${elementId} in UI ${documentId}.`;
      // Merge style onto the element's existing style so partial updates don't drop other fields.
      store().updateUIElement(documentId, elementId, {
        ...rest,
        ...(style ? { style: { ...existing.style, ...style } } : {}),
      });
      return `Updated element ${elementId}.`;
    },
  }),

  bind_ui_element: tool({
    description:
      "Bind a UI property to a live expression using project variable names or self.<key> for world UI. Use vars['Display Name'] for variable names with spaces. Empty expression removes the binding.",
    inputSchema: z.object({
      documentId: z.string(),
      elementId: z.string(),
      target: z.enum(['text', 'fill', 'visible', 'color', 'background', 'width']),
      expression: z.string().describe('e.g. "score", "health / 100", "vars[\'Gold Coins\']", "self.health > 0"'),
    }),
    execute: async ({ documentId, elementId, target, expression }) => {
      if (!findUIDocument(documentId)) return `No UI document with id ${documentId}.`;
      store().setUIBinding(documentId, elementId, target, expression);
      return expression.trim()
        ? `Bound ${target} of ${elementId} to "${expression}".`
        : `Removed the ${target} binding from ${elementId}.`;
    },
  }),

  attach_world_ui: tool({
    description:
      'Anchor a world UI document over an object; bindings can read object variables via self.<key>. Empty documentId detaches. Set diegetic:true (needs the document renderMode "webgl") to render the UI onto a flat in-world screen — a monitor/terminal/wrist display — oriented by the object transform.',
    inputSchema: z.object({
      objectId: z.string(),
      documentId: z.string().optional().describe('A world UI document id, or empty to detach.'),
      billboard: z.boolean().optional().describe('Always face the camera (ignored when diegetic).'),
      diegetic: z.boolean().optional().describe('Render onto an in-world surface via render-to-texture. Requires the document renderMode "webgl".'),
      surfaceWidth: z.number().optional().describe('Diegetic panel width in world units (default 1.6).'),
      surfaceHeight: z.number().optional().describe('Diegetic panel height in world units (default 0.9).'),
    }),
    execute: async ({ objectId, documentId, billboard, diegetic, surfaceWidth, surfaceHeight }) => {
      if (!findObject(objectId)) return `No object with id ${objectId}.`;
      if (documentId) {
        const doc = findUIDocument(documentId);
        if (!doc) return `No UI document with id ${documentId}.`;
        if (doc.surface !== 'world') return `UI ${documentId} is a screen document; only "world" docs can be anchored to objects.`;
        store().attachUI(objectId, documentId);
        const patch: Record<string, unknown> = {};
        if (billboard !== undefined) patch.billboard = billboard;
        if (diegetic !== undefined) patch.diegetic = diegetic;
        if (surfaceWidth !== undefined) patch.surfaceWidth = surfaceWidth;
        if (surfaceHeight !== undefined) patch.surfaceHeight = surfaceHeight;
        if (Object.keys(patch).length) store().updateUIComponent(objectId, patch);
        const note = diegetic
          ? ` as a diegetic in-world screen${doc.renderMode !== 'webgl' ? ' — WARNING: set this document renderMode to "webgl" or it will fall back to a DOM widget' : ''}`
          : '';
        return `Anchored world UI ${documentId} to ${objectId}${note}.`;
      }
      store().detachUI(objectId);
      return `Detached the world UI from ${objectId}.`;
    },
  }),

  set_object_variable: tool({
    description:
      "Set an object's per-instance variable for scripts and world UI self.<key> bindings.",
    inputSchema: z.object({ objectId: z.string(), key: z.string(), value: graphValue }),
    execute: async ({ objectId, key, value }) => {
      if (!findObject(objectId)) return `No object with id ${objectId}.`;
      store().setObjectVariable(objectId, key, asGraphValue(value));
      return `Set ${objectId}.${key} = ${JSON.stringify(value)}.`;
    },
  }),

  add_blueprint_variable: tool({
    description:
      'Declare a typed PER-INSTANCE variable on a blueprint (Unreal-style class variable). Every object running this blueprint gets its OWN copy (seeded by name into its instance variables) — use this for per-actor state like a player\'s Gold/Health/Ammo, an enemy\'s aggro, etc., so it is NOT shared across instances the way a project variable is. Read/write it with Get/Set Object Var nodes (objectKey = the variable name), on self or another actor via a target/Cast. Returns the blueprint-variable id.',
    inputSchema: z.object({
      blueprintId: z.string(),
      name: z.string().optional(),
      type: z.enum(VALUE_TYPES).optional(),
      defaultValue: graphValue.optional(),
    }),
    execute: async ({ blueprintId, name, type = 'number', defaultValue }) => {
      if (!store().blueprints.some((b) => b.id === blueprintId)) return `No blueprint with id ${blueprintId}.`;
      const id = store().addBlueprintVariable(blueprintId, { name, type: type as GraphValueType, defaultValue: defaultValue !== undefined ? asGraphValue(defaultValue) : undefined });
      return id ? `Added instance variable "${name ?? id}" (${type}) to blueprint ${blueprintId}. Each object running it gets its own copy; access via Get/Set Object Var (objectKey = the name).` : `Couldn't add the variable.`;
    },
  }),

  update_blueprint_variable: tool({
    description: "Rename, retype, or change the default of a blueprint's per-instance variable.",
    inputSchema: z.object({
      blueprintId: z.string(),
      variableId: z.string(),
      name: z.string().optional(),
      type: z.enum(VALUE_TYPES).optional(),
      defaultValue: graphValue.optional(),
    }),
    execute: async ({ blueprintId, variableId, name, type, defaultValue }) => {
      store().updateBlueprintVariable(blueprintId, variableId, { name, type: type as GraphValueType | undefined, defaultValue: defaultValue !== undefined ? asGraphValue(defaultValue) : undefined });
      return `Updated blueprint variable ${variableId}.`;
    },
  }),

  remove_blueprint_variable: tool({
    description: "Remove a per-instance variable declaration from a blueprint.",
    inputSchema: z.object({ blueprintId: z.string(), variableId: z.string() }),
    execute: async ({ blueprintId, variableId }) => {
      store().removeBlueprintVariable(blueprintId, variableId);
      return `Removed blueprint variable ${variableId}.`;
    },
  }),

  create_collectible_counter: tool({
    description: 'Create a reliable pickup collectible that increments a project counter, updates a HUD text counter, and destroys itself on trigger enter.',
    inputSchema: z.object({
      name: z.string().optional(),
      variableName: z.string().optional().describe('Counter variable name, e.g. Coins or Score. Defaults to Coins.'),
      label: z.string().optional().describe('HUD label. Defaults to variableName.'),
      amount: z.number().optional().describe('Amount added when collected. Defaults to 1.'),
      position: vec3.optional(),
      playerObjectId: z.string().optional().describe('Optional player id filter; omit to let any object collect it.'),
      color: z.string().optional().describe('Pickup color hex. Defaults to gold.'),
    }),
    execute: async ({ name, variableName, label, amount, position, playerObjectId, color }) => {
      if (playerObjectId && !findObject(playerObjectId)) return `No player object with id ${playerObjectId}.`;
      const result = store().createCollectibleCounter({
        name,
        variableName,
        label,
        amount,
        position: position ? asVec3(position) : undefined,
        playerObjectId,
        color,
      });
      return `Created collectible ${result.objectId}; it increments variable ${result.variableId}, updates HUD ${result.uiDocumentId}/${result.counterElementId}, and uses blueprint ${result.blueprintId}.`;
    },
  }),

  set_light: tool({
    description:
      'Configure an object light: point, spot, or directional. Move the object to position the light.',
    inputSchema: z.object({
      objectId: z.string(),
      type: z.enum(['point', 'spot', 'directional']).optional(),
      color: z.string().optional().describe('Hex color, e.g. #ff8a3d.'),
      intensity: z.number().optional().describe('Brightness. Point/spot ~4–20; directional ~1–3.'),
      distance: z.number().optional().describe('point/spot falloff range in world units (0 = no limit).'),
      angleDegrees: z.number().optional().describe('spot cone half-angle in degrees.'),
      castShadow: z.boolean().optional(),
    }),
    execute: async ({ objectId, type, color, intensity, distance, angleDegrees, castShadow }) => {
      if (!findObject(objectId)) return `No object with id ${objectId}.`;
      store().setObjectLight(objectId, {
        type,
        color,
        intensity,
        distance,
        ...(angleDegrees !== undefined ? { angle: (angleDegrees * Math.PI) / 180 } : {}),
        castShadow,
      });
      return `Configured light on ${objectId}${type ? ` (${type})` : ''}.`;
    },
  }),

  set_render_settings: tool({
    description:
      'Set project-wide bloom/vignette post-processing + the GTA-style minimap/radar, used in Play and export. The radar draws the player (or driven car) at center with building footprints (objects with a `minimapShape` instance var) + colored blips (objects with a `minimapBlip` color var) + health/armor arcs + a cash readout from the player\'s health/maxHealth/armor/money instance vars.',
    inputSchema: z.object({
      bloomEnabled: z.boolean().optional(),
      bloomIntensity: z.number().optional().describe('Bloom strength, ~0.3–2.'),
      bloomThreshold: z.number().optional().describe('Luminance cutoff 0–1; lower = more glow.'),
      bloomRadius: z.number().optional().describe('Bloom spread/smoothing 0–1.'),
      vignetteEnabled: z.boolean().optional(),
      minimapEnabled: z.boolean().optional().describe('Show the GTA-style radar minimap overlay.'),
      minimapRotate: z.boolean().optional().describe('Rotate the radar with the player heading (true, GTA-style) or keep north-up (false).'),
      minimapRange: z.number().optional().describe('World-units half-extent the radar shows around the player (~40–100).'),
      compressTextures: z
        .boolean()
        .optional()
        .describe(
          'Texture compression for FUTURE model imports. On (default) transcodes imported model textures to GPU-compressed KTX2 — cuts GPU memory ~6–8x and shrinks the exported game (the biggest browser perf/size lever). Off keeps textures lossless. Affects models imported AFTER this is set, not ones already in the project.',
        ),
    }),
    execute: async ({ bloomEnabled, bloomIntensity, bloomThreshold, bloomRadius, vignetteEnabled, minimapEnabled, minimapRotate, minimapRange, compressTextures }) => {
      store().updateRenderSettings({ bloomEnabled, bloomIntensity, bloomThreshold, bloomRadius, vignetteEnabled, minimapEnabled, minimapRotate, minimapRange, compressTextures });
      return 'Updated render/post-processing settings.';
    },
  }),

  set_quality: tool({
    description:
      'Set the project-wide game QUALITY (scalability) preset, Unreal-style. Low/Medium/High/Epic trade visual fidelity for performance — it scales render resolution (DPR), shadow casting + map size, post-FX MSAA, and bloom blur. Applies live in the editor viewport, Play, and export. Use Low when the user reports lag/low FPS, Epic for screenshots/showcase. Also exposed on the viewport and as the "Set Quality" Blueprint node (for in-game settings menus).',
    inputSchema: z.object({
      level: z.enum(['Low', 'Medium', 'High', 'Epic']).describe('Low = fastest (no shadows, 0.75x res); Epic = best (4x shadows budget, 2x res, 4x MSAA).'),
    }),
    execute: async ({ level }) => {
      store().updateRenderSettings({ quality: level });
      return `Set game quality to ${level}.`;
    },
  }),

  add_ui_preset: tool({
    description:
      'Insert a ready-made UI widget. Presets include healthBar, counter, label, button, panel, image. Returns elementId.',
    inputSchema: z.object({
      documentId: z.string(),
      preset: z.enum(['panel', 'label', 'healthBar', 'button', 'counter', 'image']),
      parentId: z.string().optional().describe('Parent element id; defaults to the root panel.'),
      variableName: z.string().optional().describe('For healthBar/counter: which variable to bind (created as a number if missing).'),
    }),
    execute: async ({ documentId, preset, parentId, variableName }) => {
      if (!findUIDocument(documentId)) return `No UI document with id ${documentId}.`;
      const id = store().addUIPreset(documentId, parentId, preset, variableName ? { variableName } : undefined);
      return `Added ${preset} preset (element ${id}) to UI ${documentId}.`;
    },
  }),

  move_ui_element: tool({
    description: 'Reorder a UI element among its siblings (up = earlier/before, down = later/after).',
    inputSchema: z.object({ documentId: z.string(), elementId: z.string(), direction: z.enum(['up', 'down']) }),
    execute: async ({ documentId, elementId, direction }) => {
      if (!findUIDocument(documentId)) return `No UI document with id ${documentId}.`;
      store().moveUIElement(documentId, elementId, direction);
      return `Moved ${elementId} ${direction}.`;
    },
  }),

  duplicate_ui_element: tool({
    description: 'Duplicate a UI element (and its children) next to itself. Returns the new element id.',
    inputSchema: z.object({ documentId: z.string(), elementId: z.string() }),
    execute: async ({ documentId, elementId }) => {
      if (!findUIDocument(documentId)) return `No UI document with id ${documentId}.`;
      const id = store().duplicateUIElement(documentId, elementId);
      return `Duplicated ${elementId} → ${id}.`;
    },
  }),

  open_ui_logic: tool({
    description:
      "Get/create the Blueprint that runs a UI document's behavior. Returns blueprintId for add_node/connect_nodes.",
    inputSchema: z.object({ documentId: z.string() }),
    execute: async ({ documentId }) => {
      if (!findUIDocument(documentId)) return `No UI document with id ${documentId}.`;
      const blueprintId = store().openUILogic(documentId);
      return `UI logic blueprint is ${blueprintId}. Add nodes to it with add_node using blueprintId ${blueprintId}.`;
    },
  }),

  delete_ui_document: tool({
    description: 'Delete a UI document. Objects anchored to it (world UI) are detached.',
    inputSchema: z.object({ id: z.string() }),
    execute: async ({ id }) => {
      if (!findUIDocument(id)) return `No UI document with id ${id}.`;
      store().deleteUIDocument(id);
      return `Deleted UI document ${id}.`;
    },
  }),

  add_material_node: tool({
    description:
      "Add a material graph node. Color uses materialColor; Scalar/Mix use numberValue; Texture uses image assetId. Returns nodeId.",
    inputSchema: z.object({
      materialId: z.string(),
      type: z.enum(['Color', 'Scalar', 'Texture', 'Mix', 'Multiply', 'Add', 'Clamp']),
      materialColor: z.string().optional().describe('Color/Mix: hex color.'),
      numberValue: z.number().optional().describe('Scalar value, or Mix blend factor 0-1.'),
      assetId: z.string().optional().describe('Texture: an "image"-type asset id.'),
    }),
    execute: async ({ materialId, type, materialColor, numberValue, assetId }) => {
      if (!findMaterial(materialId)) return `No material with id ${materialId}.`;
      if (type === 'Texture' && assetId) {
        const asset = findAsset(assetId);
        if (!asset) return `No asset with id ${assetId}.`;
        if (asset.type !== 'image') return `Asset ${assetId} is a ${asset.type}, not an image.`;
      }
      // Material operators reuse names that collide with blueprint math nodes — map to their material labels.
      const label =
        type === 'Add' ? 'Add (Material)' : type === 'Clamp' ? 'Clamp (Material)' : type === 'Multiply' ? 'Multiply (Material)' : type;
      store().ensureMaterialGraph(materialId);
      store().setActiveMaterial(materialId);
      const nodeId = store().addMaterialNode(label, 'Material', { materialColor, numberValue, assetId });
      return `Added "${type}" node with id ${nodeId} to material ${materialId}.`;
    },
  }),

  connect_material_nodes: tool({
    description:
      "Wire a material node output to another node/input pin. sourceHandle defaults to value-out; targetHandle names the target pin.",
    inputSchema: z.object({
      materialId: z.string(),
      sourceId: z.string(),
      targetId: z.string(),
      targetHandle: z.string(),
      sourceHandle: z.string().optional(),
    }),
    execute: async ({ materialId, sourceId, targetId, targetHandle, sourceHandle }) => {
      if (!findMaterial(materialId)) return `No material with id ${materialId}.`;
      store().setActiveMaterial(materialId);
      store().connectMaterialNodes(sourceId, targetId, sourceHandle ?? 'value-out', targetHandle);
      return `Connected ${sourceId} -> ${targetId}:${targetHandle} in material ${materialId}.`;
    },
  }),

  update_material_node: tool({
    description: "Update a material-graph node's value (materialColor, numberValue, or assetId).",
    inputSchema: z.object({
      materialId: z.string(),
      nodeId: z.string(),
      materialColor: z.string().optional(),
      numberValue: z.number().optional(),
      assetId: z.string().optional(),
    }),
    execute: async ({ materialId, nodeId, ...patch }) => {
      if (!findMaterial(materialId)) return `No material with id ${materialId}.`;
      store().updateGraphNodeData(nodeId, patch);
      return `Updated material node ${nodeId}.`;
    },
  }),

  delete_material_node: tool({
    description: 'Delete a node from a material graph (the Material Output sink cannot be deleted).',
    inputSchema: z.object({ materialId: z.string(), nodeId: z.string() }),
    execute: async ({ materialId, nodeId }) => {
      if (!findMaterial(materialId)) return `No material with id ${materialId}.`;
      store().setActiveMaterial(materialId);
      store().deleteMaterialNode(nodeId);
      return `Deleted material node ${nodeId}.`;
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

  duplicate_object: tool({
    description:
      'Clone an object (and all its children) one or more times. Each copy is offset from the previous one by `offset` (default [0.8,0,0.8]) — pass count + offset to lay out rows of identical objects fast (fences, pillars, crates). Returns the new root ids.',
    inputSchema: z.object({
      id: z.string(),
      count: z.number().int().min(1).max(200).optional().describe('How many copies to make (default 1).'),
      offset: vec3.optional().describe('Per-copy position step, added cumulatively. Default [0.8,0,0.8].'),
    }),
    execute: async ({ id, count, offset }) => {
      if (!findObject(id)) return `No object with id ${id}.`;
      const ids = store().duplicateObject(id, { count, offset: offset ? asVec3(offset) : undefined });
      return `Created ${ids.length} copy(ies): ${ids.join(', ')}.`;
    },
  }),

  group_objects: tool({
    description:
      'Group existing objects under a new empty parent (like Unreal folders / Unity empties). Creates an "empty" object at `position` (default origin) and parents every id under it. Great for keeping a level tidy (e.g. group all props, all lights). Returns the new group id.',
    inputSchema: z.object({
      ids: z.array(z.string()).min(1),
      name: z.string().optional(),
      position: vec3.optional(),
    }),
    execute: async ({ ids, name, position }) => {
      const missing = ids.filter((id) => !findObject(id));
      if (missing.length) return `No object(s) with id: ${missing.join(', ')}.`;
      const groupId = store().createObjectWithProps('empty', {
        name: name ?? 'Group',
        position: position ? asVec3(position) : [0, 0, 0],
      });
      ids.forEach((id) => store().setObjectParent(id, groupId));
      return `Grouped ${ids.length} object(s) under "${name ?? 'Group'}" (${groupId}).`;
    },
  }),

  spawn_grid: tool({
    description:
      'Spawn a rectangular grid of identical primitives in one call — the fastest way to block out a level (tile a floor, build a wall of crates, scatter pillars). Lays `rows` × `cols` objects on the X/Z plane spaced by `spacing`, starting at `origin`. Returns the spawned ids.',
    inputSchema: z.object({
      kind: z.enum(['empty', 'cube', 'sphere', 'capsule', 'plane', 'light', 'camera']),
      rows: z.number().int().min(1).max(40),
      cols: z.number().int().min(1).max(40),
      spacing: z.number().positive().optional().describe('Distance between grid cells (default 1.5).'),
      origin: vec3.optional().describe('World position of the first cell (default [0,0,0]).'),
      color: z.string().optional().describe('Hex color applied to every object.'),
      physics: z
        .object({
          enabled: z.boolean().optional(),
          bodyType: z.enum(['dynamic', 'fixed', 'kinematic']).optional(),
          collider: z.enum(['box', 'sphere', 'capsule', 'mesh', 'convex']).optional(),
        })
        .optional(),
      namePrefix: z.string().optional(),
    }),
    execute: async ({ kind, rows, cols, spacing, origin, color, physics, namePrefix }) => {
      const total = rows * cols;
      if (total > 400) return `That grid is ${total} objects — keep rows × cols ≤ 400.`;
      const step = spacing ?? 1.5;
      const [ox, oy, oz] = origin ? asVec3(origin) : [0, 0, 0];
      const ids: string[] = [];
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const id = store().createObjectWithProps(kind as SceneObjectKind, {
            name: `${namePrefix ?? kind[0].toUpperCase() + kind.slice(1)} ${r * cols + c + 1}`,
            position: [ox + c * step, oy, oz + r * step],
            color,
            physics: physics ? { ...physics, enabled: physics.enabled ?? true } : undefined,
          });
          ids.push(id);
        }
      }
      return `Spawned a ${rows}×${cols} grid of ${kind} (${ids.length} objects).`;
    },
  }),

  align_objects: tool({
    description:
      'Align objects along one axis so they share a coordinate — e.g. line up props on the floor (axis "y", mode "min") or flush against a wall. mode: min/max/center snap to the group bounds; "first" matches the first id; "value" uses the explicit `value`.',
    inputSchema: z.object({
      ids: z.array(z.string()).min(2),
      axis: z.enum(['x', 'y', 'z']),
      mode: z.enum(['min', 'max', 'center', 'first', 'value']),
      value: z.number().optional().describe('Required when mode is "value".'),
    }),
    execute: async ({ ids, axis, mode, value }) => {
      const objects = ids.map(findObject);
      const missing = ids.filter((_, i) => !objects[i]);
      if (missing.length) return `No object(s) with id: ${missing.join(', ')}.`;
      const a = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
      const coords = objects.map((o) => o!.transform.position[a]);
      let target: number;
      if (mode === 'value') {
        if (value === undefined) return 'mode "value" requires a `value`.';
        target = value;
      } else if (mode === 'first') target = coords[0];
      else if (mode === 'min') target = Math.min(...coords);
      else if (mode === 'max') target = Math.max(...coords);
      else target = (Math.min(...coords) + Math.max(...coords)) / 2;
      objects.forEach((o) => {
        const pos = [...o!.transform.position] as Vector3Tuple;
        pos[a] = target;
        store().updateTransform(o!.id, 'position', pos);
      });
      return `Aligned ${ids.length} objects on ${axis} to ${target.toFixed(2)}.`;
    },
  }),

  distribute_objects: tool({
    description:
      'Evenly space objects along one axis (like Unreal\'s distribute). Sorts the ids by their current coordinate, then spreads them with equal `spacing` (or evenly between the current first and last when spacing is omitted).',
    inputSchema: z.object({
      ids: z.array(z.string()).min(3),
      axis: z.enum(['x', 'y', 'z']),
      spacing: z.number().optional().describe('Gap between objects; omit to spread evenly across the current span.'),
    }),
    execute: async ({ ids, axis, spacing }) => {
      const objects = ids.map(findObject);
      const missing = ids.filter((_, i) => !objects[i]);
      if (missing.length) return `No object(s) with id: ${missing.join(', ')}.`;
      const a = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
      const sorted = [...objects].sort((x, y) => x!.transform.position[a] - y!.transform.position[a]);
      const start = sorted[0]!.transform.position[a];
      const end = sorted[sorted.length - 1]!.transform.position[a];
      const gap = spacing ?? (end - start) / (sorted.length - 1);
      sorted.forEach((o, i) => {
        const pos = [...o!.transform.position] as Vector3Tuple;
        pos[a] = start + gap * i;
        store().updateTransform(o!.id, 'position', pos);
      });
      return `Distributed ${ids.length} objects along ${axis} (gap ${gap.toFixed(2)}).`;
    },
  }),

  batch_transform: tool({
    description:
      'Apply a transform change to many objects at once. `offset` is added to each position (relative move); `rotation` and `scale` are set absolutely on every id when provided. Use for nudging or uniformly orienting/scaling a selection.',
    inputSchema: z.object({
      ids: z.array(z.string()).min(1),
      offset: vec3.optional().describe('Added to each object\'s position.'),
      rotation: vec3.optional().describe('Set as each object\'s rotation (radians).'),
      scale: vec3.optional().describe('Set as each object\'s scale.'),
    }),
    execute: async ({ ids, offset, rotation, scale }) => {
      const missing = ids.filter((id) => !findObject(id));
      if (missing.length) return `No object(s) with id: ${missing.join(', ')}.`;
      ids.forEach((id) => {
        const object = findObject(id)!;
        if (offset) {
          const p = object.transform.position;
          store().updateTransform(id, 'position', [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]]);
        }
        if (rotation) store().updateTransform(id, 'rotation', asVec3(rotation));
        if (scale) store().updateTransform(id, 'scale', asVec3(scale));
      });
      return `Updated ${ids.length} objects.`;
    },
  }),

  create_blueprint: tool({
    description: 'Create a new reusable blueprint (visual-scripting graph). Returns its blueprintId. Starts with a Start and Update node. Pass folderId to place it inside a project folder.',
    inputSchema: z.object({
      name: z.string().optional(),
      description: z.string().optional(),
      folderId: z.string().optional(),
    }),
    execute: async ({ name, description, folderId }) => {
      const { blueprintId } = store().createBlueprintNamed(name, description, folderId);
      return `Created blueprint "${findBlueprint(blueprintId)?.name}" with blueprintId ${blueprintId}.`;
    },
  }),

  create_folder: tool({
    description: 'Create a project-browser folder for organizing assets and blueprints. Returns its folderId. Pass parentId to nest it.',
    inputSchema: z.object({ name: z.string().optional(), parentId: z.string().optional() }),
    execute: async ({ name, parentId }) => {
      const id = store().createFolder(name, parentId);
      return `Created folder "${name ?? 'New Folder'}" with folderId ${id}.`;
    },
  }),

  move_to_folder: tool({
    description: 'Move an asset, blueprint, or Data Asset into a project-browser folder, or omit folderId to move it back to the root. Folders are organizational only and never change ids.',
    inputSchema: z.object({
      kind: z.enum(['asset', 'blueprint', 'dataAsset']),
      id: z.string(),
      folderId: z.string().optional().describe('Target folder id, or omit/empty to move to the root.'),
    }),
    execute: async ({ kind, id, folderId }) => {
      if (kind === 'asset' && !findAsset(id)) return `No asset with id ${id}.`;
      if (kind === 'blueprint' && !findBlueprint(id)) return `No blueprint with id ${id}.`;
      if (kind === 'dataAsset' && !findDataAsset(id)) return `No Data Asset with id ${id}.`;
      if (folderId && !store().folders.some((folder) => folder.id === folderId)) return `No folder with id ${folderId}.`;
      store().moveToFolder(kind, id, folderId || undefined);
      return folderId ? `Moved ${kind} ${id} into folder ${folderId}.` : `Moved ${kind} ${id} to the root.`;
    },
  }),

  create_variable: tool({
    description:
      'Create a typed project variable for Blueprint graphs. Use persistent=true for inventory, score, unlocks, settings, and anything Save Game should store. Returns variableId.',
    inputSchema: z.object({
      name: z.string().optional(),
      type: z.enum(VALUE_TYPES).optional(),
      persistent: z.boolean().optional(),
      defaultValue: graphValue.optional(),
    }),
    execute: async ({ name, type = 'number', persistent = true, defaultValue }) => {
      const id = store().createVariable(name, type as GraphValueType, persistent);
      if (defaultValue !== undefined) store().updateVariable(id, { defaultValue: asGraphValue(defaultValue) });
      return `Created ${type} variable "${findVariable(id)?.name}" with variableId ${id}.`;
    },
  }),

  update_variable: tool({
    description: 'Rename, retype, change persistence, or set the default value of an existing project variable.',
    inputSchema: z.object({
      id: z.string(),
      name: z.string().optional(),
      type: z.enum(VALUE_TYPES).optional(),
      persistent: z.boolean().optional(),
      defaultValue: graphValue.optional(),
    }),
    execute: async ({ id, name, type, persistent, defaultValue }) => {
      if (!findVariable(id)) return `No variable with id ${id}.`;
      store().updateVariable(id, {
        name,
        type: type as GraphValueType | undefined,
        persistent,
        defaultValue: defaultValue !== undefined ? asGraphValue(defaultValue) : undefined,
      });
      return `Updated variable ${id}.`;
    },
  }),

  create_data_asset: tool({
    description: 'Create a typed Data Asset for lookup values such as item stats, dialogue, shop prices, or level tuning. Returns dataAssetId. Pass folderId to place it in the Project Browser.',
    inputSchema: z.object({ name: z.string().optional(), folderId: z.string().optional() }),
    execute: async ({ name, folderId }) => {
      if (folderId && !store().folders.some((folder) => folder.id === folderId)) return `No folder with id ${folderId}.`;
      const id = store().createDataAsset(name, folderId);
      return `Created Data Asset "${findDataAsset(id)?.name}" with dataAssetId ${id}.`;
    },
  }),

  add_data_asset_column: tool({
    description: 'Add a typed column to a Data Asset. Returns columnId.',
    inputSchema: z.object({
      dataAssetId: z.string(),
      name: z.string().optional(),
      type: z.enum(VALUE_TYPES).optional(),
    }),
    execute: async ({ dataAssetId, name, type = 'string' }) => {
      if (!findDataAsset(dataAssetId)) return `No Data Asset with id ${dataAssetId}.`;
      const id = store().addDataAssetColumn(dataAssetId, name, type as GraphValueType);
      return `Added ${type} column "${name ?? 'Column'}" with columnId ${id}.`;
    },
  }),

  add_data_asset_row: tool({
    description: 'Add a keyed row to a Data Asset. Returns rowId. Use set_data_asset_cell to fill values after creating it.',
    inputSchema: z.object({ dataAssetId: z.string(), key: z.string().optional() }),
    execute: async ({ dataAssetId, key }) => {
      if (!findDataAsset(dataAssetId)) return `No Data Asset with id ${dataAssetId}.`;
      const id = store().addDataAssetRow(dataAssetId, key);
      return `Added data row "${key ?? 'row'}" with rowId ${id}.`;
    },
  }),

  set_data_asset_cell: tool({
    description: 'Set one Data Asset cell. The value is coerced to the target column type.',
    inputSchema: z.object({
      dataAssetId: z.string(),
      rowId: z.string(),
      columnId: z.string(),
      value: graphValue,
    }),
    execute: async ({ dataAssetId, rowId, columnId, value }) => {
      const table = findDataAsset(dataAssetId);
      if (!table) return `No Data Asset with id ${dataAssetId}.`;
      if (!table.rows.some((row) => row.id === rowId)) return `No row ${rowId} in Data Asset ${dataAssetId}.`;
      if (!table.columns.some((column) => column.id === columnId)) return `No column ${columnId} in Data Asset ${dataAssetId}.`;
      store().setDataAssetCell(dataAssetId, rowId, columnId, asGraphValue(value));
      return `Set Data Asset cell ${dataAssetId}/${rowId}/${columnId}.`;
    },
  }),

  add_node: tool({
    description: 'Add a node to a blueprint graph. Returns its nodeId. For variables set variableId; for Data Asset Lookup set dataAssetId/rowKey/columnId; for constants set numberValue/stringValue/booleanValue/vectorValue; for Save/Load/Clear set saveSlot.',
    inputSchema: z.object({
      blueprintId: z.string(),
      type: z.enum(NODE_LABELS),
      keyCode: z.enum(KEY_CODES).optional(),
      axis: z.enum(['x', 'y', 'z']).optional(),
      amount: z.number().optional(),
      numberValue: z.number().optional(),
      stringValue: z.string().optional(),
      booleanValue: z.boolean().optional(),
      vectorValue: vec3.optional(),
      variableId: z.string().optional(),
      dataAssetId: z.string().optional(),
      tableId: z.string().optional().describe('Alias for dataAssetId.'),
      rowKey: z.string().optional(),
      columnId: z.string().optional(),
      compareOp: z.enum(['==', '!=', '>', '>=', '<', '<=']).optional(),
      saveSlot: z.string().optional(),
      eventName: z.string().optional(),
      otherObjectId: z.string().optional().describe('Collision/trigger filter object id.'),
      targetObjectId: z.string().optional().describe('Target object id; omit for self.'),
      assetId: z.string().optional().describe('Play Sound: id of an audio asset.'),
      spawnKind: z.enum(['cube', 'sphere', 'capsule', 'plane']).optional().describe('Spawn Object: what to spawn.'),
      message: z.string().optional().describe('Print: the text to log during Play.'),
      materialColor: z.string().optional().describe('Set Material Color: hex color to apply at runtime.'),
      materialColorTarget: z.enum(['base', 'emissive']).optional().describe('base or emissive. Default base.'),
      materialProperty: z
        .enum(['metalness', 'roughness', 'emissiveIntensity'])
        .optional()
        .describe('Numeric material property.'),
      projectileSpeed: z.number().optional().describe('Projectile speed. Default 20.'),
      projectileDamage: z.number().optional().describe('Projectile damage. Default 25.'),
      projectileSize: z.number().optional().describe('Built-in projectile radius.'),
      projectileColor: z.string().optional().describe('Built-in projectile color.'),
      projectileLife: z.number().optional().describe('Projectile lifetime. Default 3.'),
      projectileGravity: z.number().optional().describe('Projectile gravity. 0 = straight.'),
      projectileKnockback: z.number().optional().describe('How hard a hit shoves a DYNAMIC prop along the shot (multiplier, default 1; 0 = no knockback). Raise for heavier punch.'),
      projectileExplosive: z.boolean().optional().describe('Detonate on impact / fuse-out: a blast + area damage instead of a plain hit (grenades, rockets). Pair with projectileGravity for an arc.'),
      projectileBlastRadius: z.number().optional().describe('Explosive blast radius (default 4.5).'),
      projectileBlastDamage: z.number().optional().describe('Explosive blast damage to every health object in radius (default 60).'),
      projectileBlastSound: z.string().optional().describe('Audio asset id played on detonation.'),
      projectileTemplateId: z.string().optional().describe('Scene object id to clone as projectile.'),
      projectileMuzzle: vec3.optional().describe('First-person muzzle offset [right, up, forward].'),
      projectileDebug: z.boolean().optional().describe('Log projectile spawns/hits.'),
      projectileSpread: z.number().optional().describe('Random firing-cone half-angle in degrees (0 = pin-accurate; 2-5 rifle, 8-12 shotgun/SMG).'),
      animationId: z.string().optional().describe('One-shot animation asset id.'),
      animationSpeed: z.number().optional().describe('Animation speed. Default 1.'),
      cinematicId: z.string().optional().describe('Play Cinematic: Film Mode cinematic id.'),
      movementMode: z.enum(['walking', 'swimming', 'climbing', 'flying']).optional().describe('Character movement mode.'),
      randomMin: z.number().optional().describe('Random: inclusive low bound. Default 0.'),
      randomMax: z.number().optional().describe('Random: inclusive high bound. Default 1.'),
      randomInteger: z.boolean().optional().describe('Random: round to a whole number (Max inclusive) for dice/index rolls.'),
      loopCount: z.number().int().optional().describe('For Loop: how many times to fire the Body output. Default 4, capped at 10000.'),
      targetSceneId: z.string().optional().describe('Load Scene: id of the scene to switch to during Play.'),
      shakeAmount: z.number().optional().describe('Camera Shake: trauma 0..1 to add to the player camera (fades automatically).'),
      qualityLevel: z.enum(['Low', 'Medium', 'High', 'Epic']).optional().describe('Set Quality: scalability preset to apply at runtime.'),
      damageAmount: z.number().optional().describe('Apply Damage: HP to subtract from the target\'s health variable. Default 10. Use targetObjectId ($self/$player/$trigger/$cast or an id) to pick who takes it.'),
    }),
    execute: async ({
      blueprintId,
      type,
      keyCode,
      axis,
      amount,
      numberValue,
      stringValue,
      booleanValue,
      vectorValue,
      variableId,
      dataAssetId,
      tableId,
      rowKey,
      columnId,
      compareOp,
      saveSlot,
      eventName,
      assetId,
      spawnKind,
      message,
      materialColor,
      materialColorTarget,
      materialProperty,
      projectileSpeed,
      projectileDamage,
      projectileSize,
      projectileColor,
      projectileLife,
      projectileGravity,
      projectileKnockback,
      projectileExplosive,
      projectileBlastRadius,
      projectileBlastDamage,
      projectileBlastSound,
      projectileTemplateId,
      projectileMuzzle,
      projectileDebug,
      animationId,
      animationSpeed,
      cinematicId,
      movementMode,
      otherObjectId,
      targetObjectId,
      randomMin,
      randomMax,
      randomInteger,
      loopCount,
      targetSceneId,
      projectileSpread,
      shakeAmount,
      qualityLevel,
      damageAmount,
    }) => {
      if (!findBlueprint(blueprintId)) return `No blueprint with id ${blueprintId}.`;
      if (targetSceneId && !findScene(targetSceneId)) return `No scene with id ${targetSceneId}.`;
      if (variableId && !findVariable(variableId)) return `No variable with id ${variableId}.`;
      if (otherObjectId && !findObject(otherObjectId)) return `No object with id ${otherObjectId}.`;
      if (targetObjectId && !targetObjectId.startsWith('$') && !findObject(targetObjectId)) return `No object with id ${targetObjectId}.`;
      if (projectileTemplateId && !findObject(projectileTemplateId)) return `No object with id ${projectileTemplateId}.`;
      if (cinematicId && !store().activeScene()?.cinematics?.some((cinematic) => cinematic.id === cinematicId)) return `No cinematic with id ${cinematicId}.`;
      const resolvedDataAssetId = dataAssetId ?? tableId;
      if (resolvedDataAssetId && !findDataAsset(resolvedDataAssetId)) return `No Data Asset with id ${resolvedDataAssetId}.`;
      const nodeId = store().addGraphNodeToBlueprint(blueprintId, type, NODE_CATEGORY[type], {
        keyCode,
        axis,
        amount,
        numberValue,
        stringValue,
        booleanValue,
        vectorValue: vectorValue ? asVec3(vectorValue) : undefined,
        variableId,
        tableId: resolvedDataAssetId,
        rowKey,
        columnId,
        compareOp,
        saveSlot,
        eventName,
        otherObjectId,
        targetObjectId,
        assetId,
        spawnKind: spawnKind as SceneObjectKind | undefined,
        message,
        materialColor,
        materialColorTarget,
        materialProperty,
        projectileSpeed,
        projectileDamage,
        projectileSize,
        projectileColor,
        projectileLife,
        projectileGravity,
        projectileKnockback,
        projectileExplosive,
        projectileBlastRadius,
        projectileBlastDamage,
        projectileBlastSound,
        projectileTemplateId,
        projectileMuzzle: projectileMuzzle ? asVec3(projectileMuzzle) : undefined,
        projectileDebug,
        animationId,
        animationSpeed,
        cinematicId,
        movementMode,
        randomMin,
        randomMax,
        randomInteger,
        loopCount,
        targetSceneId,
        projectileSpread,
        shakeAmount,
        qualityLevel,
        damageAmount,
      });
      return `Added "${type}" node with id ${nodeId} to blueprint ${blueprintId}.`;
    },
  }),

  connect_nodes: tool({
    description:
      'Connect two nodes in a blueprint. Omit handles for execution flow. For typed value flow, use sourceHandle "value-out" and a targetHandle such as value, condition, amount, vector, message, rowKey, a, b, min, max, or t.',
    inputSchema: z.object({
      blueprintId: z.string(),
      sourceId: z.string(),
      targetId: z.string(),
      sourceHandle: z.string().optional(),
      targetHandle: z.string().optional(),
    }),
    execute: async ({ blueprintId, sourceId, targetId, sourceHandle, targetHandle }) => {
      if (!findBlueprint(blueprintId)) return `No blueprint with id ${blueprintId}.`;
      store().connectGraphNodes(blueprintId, sourceId, targetId, sourceHandle, targetHandle);
      return targetHandle
        ? `Connected value ${sourceId}:${sourceHandle ?? 'value-out'} -> ${targetId}:${targetHandle}.`
        : `Connected ${sourceId} -> ${targetId}.`;
    },
  }),

  update_node: tool({
    description: 'Update a node\'s parameters, including typed literal values, variable/Data Asset bindings, compare operators, save slots, and action settings.',
    inputSchema: z.object({
      blueprintId: z.string(),
      nodeId: z.string(),
      keyCode: z.enum(KEY_CODES).optional(),
      axis: z.enum(['x', 'y', 'z']).optional(),
      amount: z.number().optional(),
      numberValue: z.number().optional(),
      stringValue: z.string().optional(),
      booleanValue: z.boolean().optional(),
      vectorValue: vec3.optional(),
      variableId: z.string().optional(),
      dataAssetId: z.string().optional(),
      tableId: z.string().optional().describe('Alias for dataAssetId.'),
      rowKey: z.string().optional(),
      columnId: z.string().optional(),
      compareOp: z.enum(['==', '!=', '>', '>=', '<', '<=']).optional(),
      saveSlot: z.string().optional(),
      eventName: z.string().optional(),
      otherObjectId: z.string().optional().describe('Collision/trigger filter object id.'),
      assetId: z.string().optional(),
      spawnKind: z.enum(['cube', 'sphere', 'capsule', 'plane']).optional(),
      message: z.string().optional(),
      materialColor: z.string().optional(),
      materialColorTarget: z.enum(['base', 'emissive']).optional(),
      materialProperty: z.enum(['metalness', 'roughness', 'emissiveIntensity']).optional(),
      projectileSpeed: z.number().optional().describe('Spawn Projectile: muzzle speed (units/sec).'),
      projectileDamage: z.number().optional().describe('Spawn Projectile: hit damage.'),
      projectileSize: z.number().optional().describe('Built-in projectile radius.'),
      projectileColor: z.string().optional().describe('Built-in projectile color.'),
      projectileLife: z.number().optional().describe('Projectile lifetime.'),
      projectileGravity: z.number().optional().describe('Projectile gravity.'),
      projectileKnockback: z.number().optional().describe('How hard a hit shoves a DYNAMIC prop along the shot (multiplier, default 1; 0 = no knockback).'),
      projectileExplosive: z.boolean().optional().describe('Detonate on impact / fuse-out: blast + area damage (grenades, rockets).'),
      projectileBlastRadius: z.number().optional().describe('Explosive blast radius (default 4.5).'),
      projectileBlastDamage: z.number().optional().describe('Explosive blast damage in radius (default 60).'),
      projectileBlastSound: z.string().optional().describe('Audio asset id played on detonation.'),
      projectileTemplateId: z.string().optional().describe('Scene object id to clone as projectile.'),
      projectileMuzzle: vec3.optional().describe('First-person muzzle offset.'),
      projectileDebug: z.boolean().optional().describe('Log projectile spawns/hits.'),
      cinematicId: z.string().optional().describe('Play Cinematic: Film Mode cinematic id.'),
      // Set/Get Anim nodes: which animator parameter (by name, from the snapshot's controllers) and which object.
      paramName: z.string().optional(),
      targetObjectId: z.string().optional().describe('Target object id; omit for self.'),
      randomMin: z.number().optional().describe('Random: inclusive low bound.'),
      randomMax: z.number().optional().describe('Random: inclusive high bound.'),
      randomInteger: z.boolean().optional().describe('Random: whole-number mode (Max inclusive).'),
      loopCount: z.number().int().optional().describe('For Loop: Body iteration count (capped 10000).'),
      targetSceneId: z.string().optional().describe('Load Scene: scene id to switch to during Play.'),
      projectileSpread: z.number().optional().describe('Spawn Projectile: firing-cone half-angle in degrees.'),
      shakeAmount: z.number().optional().describe('Camera Shake: trauma 0..1.'),
      qualityLevel: z.enum(['Low', 'Medium', 'High', 'Epic']).optional().describe('Set Quality: scalability preset to apply at runtime.'),
      damageAmount: z.number().optional().describe('Apply Damage: HP to subtract from the target\'s health variable.'),
    }),
    execute: async ({ blueprintId, nodeId, vectorValue, variableId, dataAssetId, tableId, otherObjectId, targetObjectId, projectileTemplateId, projectileMuzzle, cinematicId, targetSceneId, ...patch }) => {
      if (!findBlueprint(blueprintId)) return `No blueprint with id ${blueprintId}.`;
      if (targetSceneId && !findScene(targetSceneId)) return `No scene with id ${targetSceneId}.`;
      if (variableId && !findVariable(variableId)) return `No variable with id ${variableId}.`;
      if (otherObjectId && !findObject(otherObjectId)) return `No object with id ${otherObjectId}.`;
      if (targetObjectId && !targetObjectId.startsWith('$') && !findObject(targetObjectId)) return `No object with id ${targetObjectId}.`;
      if (projectileTemplateId && !findObject(projectileTemplateId)) return `No object with id ${projectileTemplateId}.`;
      if (cinematicId && !store().activeScene()?.cinematics?.some((cinematic) => cinematic.id === cinematicId)) return `No cinematic with id ${cinematicId}.`;
      const resolvedDataAssetId = dataAssetId ?? tableId;
      if (resolvedDataAssetId && !findDataAsset(resolvedDataAssetId)) return `No Data Asset with id ${resolvedDataAssetId}.`;
      const updates: Partial<NodeForgeNodeData> = { ...patch };
      if (variableId !== undefined) updates.variableId = variableId;
      if (resolvedDataAssetId !== undefined) updates.tableId = resolvedDataAssetId;
      if (otherObjectId !== undefined) updates.otherObjectId = otherObjectId || undefined;
      if (targetObjectId !== undefined) updates.targetObjectId = targetObjectId || undefined;
      if (projectileTemplateId !== undefined) updates.projectileTemplateId = projectileTemplateId || undefined;
      if (projectileMuzzle !== undefined) updates.projectileMuzzle = asVec3(projectileMuzzle);
      if (cinematicId !== undefined) updates.cinematicId = cinematicId || undefined;
      if (targetSceneId !== undefined) updates.targetSceneId = targetSceneId || undefined;
      if (vectorValue !== undefined) updates.vectorValue = asVec3(vectorValue);
      store().setActiveBlueprint(blueprintId);
      store().updateGraphNodeData(nodeId, updates);
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

  open_object_script: tool({
    description:
      "Open a scene object's script for editing in the Scripting panel. If the object already has a blueprint attached, that blueprint is opened; otherwise a new blueprint is created, attached to the object, and opened. Returns the blueprintId.",
    inputSchema: z.object({ objectId: z.string() }),
    execute: async ({ objectId }) => {
      if (!findObject(objectId)) return `No object with id ${objectId}.`;
      const blueprintId = store().openObjectScript(objectId);
      if (!blueprintId) return `Could not open a script for object ${objectId}.`;
      return `Opened blueprint ${blueprintId} ("${findBlueprint(blueprintId)?.name}") for object ${objectId}.`;
    },
  }),

  set_playing: tool({
    description: 'Start or stop the runtime preview (Play mode).',
    inputSchema: z.object({ playing: z.boolean() }),
    execute: async ({ playing }) => {
      if (playing && store().editingPrefabId) {
        return 'Close the prefab editor first (close_prefab) — Play runs the game scene, not a prefab.';
      }
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

  export_game: tool({
    description:
      'Export the whole project as a standalone game bundle (game.json) that the engine\'s player runtime runs. Downloads the file on web, or prompts for a save location on desktop. Use when the user wants to ship/build/export the final game. Run the standalone player with `npm run build:player`.',
    inputSchema: z.object({}),
    execute: async () => {
      if (!useProjectStore.getState().hasProject) return 'No project is open to export.';
      await useProjectStore.getState().exportGame();
      const { error } = useProjectStore.getState();
      return error ? `Export failed: ${error}` : 'Exported the game bundle (game.json).';
    },
  }),

  export_production: tool({
    description:
      'Export the game to PRODUCTION: build a playable native app for the current OS plus a portable web build. On the DESKTOP app it first asks the user to choose a destination folder, then runs the full build right away (live progress; a few minutes) and writes the native installers (<slug>-native/) and portable web build (<slug>-web/) into that folder. On web it instead downloads game.json and the build is finished from the engine folder with `npm run export:production`. Use when the user wants a final shippable/playable build for desktop platforms, not just the raw game bundle.',
    inputSchema: z.object({}),
    execute: async () => {
      if (!useProjectStore.getState().hasProject) return 'No project is open to export.';
      await useProjectStore.getState().exportProduction();
      const { error } = useProjectStore.getState();
      return error
        ? `Production build failed: ${error}`
        : 'Production build done (desktop): native app + web build are in src-tauri/target/release/bundle/ and exports/. On web, game.json was downloaded to finish with `npm run export:production`.';
    },
  }),
};

export type EngineTools = typeof engineTools;
