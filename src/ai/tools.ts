import { tool } from 'ai';
import { z } from 'zod';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import type {
  ColliderType,
  GraphNodeCategory,
  NodeForgeNodeData,
  GraphValue,
  GraphValueType,
  MaterialDefinition,
  MeshRendererComponent,
  RigidBodyType,
  SceneObjectKind,
  Vector3Tuple,
} from '../types';
import { buildSceneSnapshot } from './systemPrompt';
import { createThirdPersonTemplate } from '../project/thirdPersonTemplate';

const store = () => useEditorStore.getState();

const vec3 = z.array(z.number()).length(3).describe('[x, y, z]');
const asVec3 = (value: number[]) => value as Vector3Tuple;
const VALUE_TYPES = ['number', 'string', 'boolean', 'vector3'] as const;
const graphValue = z.union([z.number(), z.string(), z.boolean(), vec3]);
const asGraphValue = (value: string | number | boolean | number[]) =>
  (Array.isArray(value) ? asVec3(value) : value) as GraphValue;

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
  'Play Sound',
  'Set Material Color',
  'Set Material Property',
  'Get Material Color',
  'Get Material Property',
  'Set Anim Float',
  'Set Anim Bool',
  'Set Anim Trigger',
  'Get Move Input',
  'Move',
  'Jump',
  'Is Grounded',
  'Set Camera',
  'Save Game',
  'Load Game',
  'Clear Save',
  'Print',
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
  'Play Sound': 'Audio',
  'Set Material Color': 'Runtime',
  'Set Material Property': 'Runtime',
  'Get Material Color': 'Runtime',
  'Get Material Property': 'Runtime',
  'Set Anim Float': 'Runtime',
  'Set Anim Bool': 'Runtime',
  'Set Anim Trigger': 'Runtime',
  'Get Move Input': 'Runtime',
  Move: 'Runtime',
  Jump: 'Runtime',
  'Is Grounded': 'Runtime',
  'Set Camera': 'Runtime',
  'Save Game': 'Persistence',
  'Load Game': 'Persistence',
  'Clear Save': 'Persistence',
  Print: 'Runtime',
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
const findController = (id: string) => store().animatorControllers.find((controller) => controller.id === id);

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
    description:
      "Update an object's material. color (hex), metalness 0-1 and roughness 0-1 affect built-in meshes always; for an object using an imported model they only take effect when overrideMaterial is true. textureAssetId assigns an image asset as the base-color (albedo) texture and applies to both built-in meshes and models regardless of overrideMaterial — pass an empty string to remove it.",
    inputSchema: z.object({
      id: z.string(),
      color: z.string().optional(),
      metalness: z.number().min(0).max(1).optional(),
      roughness: z.number().min(0).max(1).optional(),
      textureAssetId: z
        .string()
        .optional()
        .describe('An "image"-type asset id for the base-color map, or "" to remove the texture.'),
      overrideMaterial: z
        .boolean()
        .optional()
        .describe("For model objects: when true, color/metalness/roughness override the model's baked materials."),
    }),
    execute: async ({ id, color, metalness, roughness, textureAssetId, overrideMaterial }) => {
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
      if (textureAssetId !== undefined) patch.textureAssetId = textureAssetId || undefined;
      if (overrideMaterial !== undefined) patch.overrideMaterial = overrideMaterial;
      store().updateRenderer(id, patch);
      return `Updated material of ${id}.`;
    },
  }),

  set_physics: tool({
    description: 'Enable/configure physics (collision) on an object. For a STATIC collision wall/floor/obstacle that blocks the player but never moves or falls, set enabled:true and bodyType:"fixed" — that is the standard "static collider". Use "dynamic" for objects that fall/get pushed, "kinematic" for scripted movers. An object only collides once physics is enabled.',
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
      'Play a skeletal animation on an object that renders a rigged model. Enable the animator and set animationId to an Animation asset from the snapshot whose skeletonId matches the object\'s model skeleton (any clip on that skeleton works, even one imported from another character). speed/loop are optional. Pass enabled:false to stop.',
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
      'Create a reusable Animator Controller (animation state machine). Optionally bind it to a skeletonId so only that skeleton\'s clips are offered. Returns controllerId. Then add parameters, states and transitions, and assign it to an object with set_object_controller.',
    inputSchema: z.object({ name: z.string().optional(), skeletonId: z.string().optional() }),
    execute: async ({ name, skeletonId }) => {
      if (skeletonId && !store().skeletons.some((s) => s.id === skeletonId)) return `No skeleton with id ${skeletonId}.`;
      const id = store().createAnimatorController(name, skeletonId);
      return `Created animator controller "${findController(id)?.name}" with controllerId ${id}.`;
    },
  }),

  add_animator_parameter: tool({
    description:
      'Add a parameter the state machine reads. type: float | bool | trigger. source: manual (set by scripts/AI), speed (object horizontal speed), verticalSpeed, moving (bool), or variable (mirror a project variable — pass variableId). Use a float "Speed" with source "speed" for locomotion. Returns parameterId.',
    inputSchema: z.object({
      controllerId: z.string(),
      name: z.string(),
      type: z.enum(['float', 'bool', 'trigger']),
      source: z.enum(['manual', 'speed', 'verticalSpeed', 'moving', 'variable']).optional(),
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

  add_animator_transition: tool({
    description:
      'Add a transition between states. from is a stateId or "any". Conditions are ANDed; each compares a parameterId against a value with op (==,!=,>,>=,<,<=). duration is the crossfade seconds. Returns transitionId.',
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
    }),
    execute: async ({ controllerId, from, to, conditions, duration }) => {
      const controller = findController(controllerId);
      if (!controller) return `No controller with id ${controllerId}.`;
      if (from !== 'any' && !controller.states.some((s) => s.id === from)) return `No state ${from} in controller.`;
      if (!controller.states.some((s) => s.id === to)) return `No state ${to} in controller.`;
      const id = store().addAnimatorTransition(controllerId, { from, to, conditions, duration });
      return id ? `Added transition ${from} → ${to} (${id}).` : `Couldn't add transition.`;
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
      modelYawOffset: z.number().optional().describe('Facing offset in radians; use Math.PI (~3.14159) to flip a model that faces backwards.'),
      // Key bindings — KeyboardEvent.code strings, e.g. "KeyW", "Space", "ShiftLeft", "ArrowUp".
      keyForward: z.string().optional(),
      keyBackward: z.string().optional(),
      keyLeft: z.string().optional(),
      keyRight: z.string().optional(),
      keyJump: z.string().optional(),
      keySprint: z.string().optional(),
      keyCrouch: z.string().optional(),
      // Camera.
      cameraFollow: z.boolean().optional(),
      cameraOffset: vec3.optional().describe('Resting camera position relative to the pawn: [side, up, back]. Negative Z is behind a +Z-forward model.'),
      cameraPitch: z.number().optional().describe('Base camera elevation in radians.'),
      mouseLook: z.boolean().optional().describe('Orbit the camera with the mouse (click the view to capture).'),
      mouseSensitivity: z.number().optional(),
      cameraRelativeMovement: z.boolean().optional().describe('Move relative to the camera facing.'),
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
      'One-click third-person pawn: from a RIGGED model asset (a "model"-type asset that was split into a skeletalMesh), creates an object rendering it, auto-builds a locomotion Animator Controller (Idle/Walk/Jog/Jump matched from the skeleton\'s clips by name) and attaches a character controller. Returns the new objectId. Use this as the fast path before fine-tuning with the other animator tools.',
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

  create_third_person_template: tool({
    description:
      'Build a complete, ready-to-play third-person scene from the engine\'s BUNDLED Quaternius rig: imports + splits it, adds a ground plane, and spawns a "Player" pawn with an Idle/Walk/Jog/Jump animator, a mouse-look follow camera, and an editable controller blueprint. No asset import needed — use this when the user asks for a third-person character/template from scratch. Returns the pawn objectId.',
    inputSchema: z.object({}),
    execute: async () => {
      const id = await createThirdPersonTemplate();
      return id ? `Created third-person template — pawn objectId ${id}. Press Play and use WASD + mouse.` : `Couldn't build the template.`;
    },
  }),

  create_material: tool({
    description:
      'Create a reusable material asset. It owns a node graph with a Material Output node; the flat fields (set via update_material) are the BASE surface, and graph nodes wired into the Output pins override them. Returns its materialId. Assign to objects with set_object_material.',
    inputSchema: z.object({ name: z.string().optional(), folderId: z.string().optional() }),
    execute: async ({ name, folderId }) => {
      const id = store().createMaterial(name, undefined, folderId);
      return `Created material "${findMaterial(id)?.name}" with materialId ${id}.`;
    },
  }),

  update_material: tool({
    description:
      "Update a reusable material's properties. color/emissiveColor are hex; metalness/roughness are 0-1; emissiveIntensity is a glow strength (0+). textureAssetId/normalMapAssetId must be \"image\"-type asset ids (pass \"\" to clear). Every object using this material updates live.",
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

  add_material_node: tool({
    description:
      "Add a node to a material's graph. Returns its nodeId. 'Color' sets materialColor; 'Scalar'/'Mix' set numberValue (Mix's = blend factor T); 'Texture' sets assetId (an image asset). 'Multiply'/'Add'/'Clamp' take their inputs from wires (numbers or colors). Then connect_material_nodes from this node's 'value-out' into a Material Output pin (baseColor, metalness, roughness, emissiveColor, emissiveIntensity, normal) — or into another operator's input (a/b/t, value/min/max).",
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
      const label = type === 'Add' ? 'Add (Material)' : type === 'Clamp' ? 'Clamp (Material)' : type;
      store().ensureMaterialGraph(materialId);
      store().setActiveMaterial(materialId);
      const nodeId = store().addMaterialNode(label, 'Material', { materialColor, numberValue, assetId });
      return `Added "${type}" node with id ${nodeId} to material ${materialId}.`;
    },
  }),

  connect_material_nodes: tool({
    description:
      "Wire a material node's output into another node's input pin. sourceHandle defaults to 'value-out'. targetHandle is a Material Output pin (baseColor|metalness|roughness|emissiveColor|emissiveIntensity|normal) or a Mix pin (a|b|t). Texture → baseColor/normal; Color/Mix → baseColor/emissiveColor; Scalar → metalness/roughness/emissiveIntensity.",
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
      tableId: z.string().optional().describe('Legacy alias for dataAssetId. Prefer dataAssetId.'),
      rowKey: z.string().optional(),
      columnId: z.string().optional(),
      compareOp: z.enum(['==', '!=', '>', '>=', '<', '<=']).optional(),
      saveSlot: z.string().optional(),
      eventName: z.string().optional(),
      assetId: z.string().optional().describe('Play Sound: id of an audio asset.'),
      spawnKind: z.enum(['cube', 'sphere', 'capsule', 'plane']).optional().describe('Spawn Object: what to spawn.'),
      message: z.string().optional().describe('Print: the text to log during Play.'),
      materialColor: z.string().optional().describe('Set Material Color: hex color to apply at runtime.'),
      materialColorTarget: z
        .enum(['base', 'emissive'])
        .optional()
        .describe('Set Material Color: which channel to write (base or emissive). Defaults to base.'),
      materialProperty: z
        .enum(['metalness', 'roughness', 'emissiveIntensity'])
        .optional()
        .describe('Set/Get Material Property: which numeric property to read or write (Set uses numberValue).'),
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
    }) => {
      if (!findBlueprint(blueprintId)) return `No blueprint with id ${blueprintId}.`;
      if (variableId && !findVariable(variableId)) return `No variable with id ${variableId}.`;
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
        assetId,
        spawnKind: spawnKind as SceneObjectKind | undefined,
        message,
        materialColor,
        materialColorTarget,
        materialProperty,
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
      tableId: z.string().optional().describe('Legacy alias for dataAssetId. Prefer dataAssetId.'),
      rowKey: z.string().optional(),
      columnId: z.string().optional(),
      compareOp: z.enum(['==', '!=', '>', '>=', '<', '<=']).optional(),
      saveSlot: z.string().optional(),
      eventName: z.string().optional(),
      assetId: z.string().optional(),
      spawnKind: z.enum(['cube', 'sphere', 'capsule', 'plane']).optional(),
      message: z.string().optional(),
      materialColor: z.string().optional(),
      materialColorTarget: z.enum(['base', 'emissive']).optional(),
      materialProperty: z.enum(['metalness', 'roughness', 'emissiveIntensity']).optional(),
    }),
    execute: async ({ blueprintId, nodeId, vectorValue, variableId, dataAssetId, tableId, ...patch }) => {
      if (!findBlueprint(blueprintId)) return `No blueprint with id ${blueprintId}.`;
      if (variableId && !findVariable(variableId)) return `No variable with id ${variableId}.`;
      const resolvedDataAssetId = dataAssetId ?? tableId;
      if (resolvedDataAssetId && !findDataAsset(resolvedDataAssetId)) return `No Data Asset with id ${resolvedDataAssetId}.`;
      const updates: Partial<NodeForgeNodeData> = { ...patch };
      if (variableId !== undefined) updates.variableId = variableId;
      if (resolvedDataAssetId !== undefined) updates.tableId = resolvedDataAssetId;
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
};

export type EngineTools = typeof engineTools;
