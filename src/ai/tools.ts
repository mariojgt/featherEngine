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
  UIElement,
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
  'Trigger Enter',
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
  'Move',
  'Jump',
  'Is Grounded',
  'Set Camera',
  'Set Ragdoll',
  'Save Game',
  'Load Game',
  'Clear Save',
  'Print',
  'Show UI',
  'Hide UI',
  'Set UI Text',
  'Get Object Var',
  'Set Object Var',
] as const;

const NODE_CATEGORY: Record<(typeof NODE_LABELS)[number], GraphNodeCategory> = {
  Start: 'Events',
  Update: 'Events',
  'Key Down': 'Events',
  'Key Up': 'Events',
  'Custom Event': 'Events',
  'Collision Enter': 'Events',
  'Trigger Enter': 'Events',
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
  Move: 'Runtime',
  Jump: 'Runtime',
  'Is Grounded': 'Runtime',
  'Set Camera': 'Runtime',
  'Set Ragdoll': 'Runtime',
  'Save Game': 'Persistence',
  'Load Game': 'Persistence',
  'Clear Save': 'Persistence',
  Print: 'Runtime',
  'Show UI': 'UI',
  'Hide UI': 'UI',
  'Set UI Text': 'UI',
  'Get Object Var': 'Variables',
  'Set Object Var': 'Variables',
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
    description: 'Enable/configure physics on an object. For solid walls/floors set enabled:true, bodyType:"fixed", isTrigger:false. For pickups/overlap volumes set enabled:true, bodyType:"fixed", isTrigger:true so it fires Trigger Enter without blocking. collisionLayer is 0-15 and collisionMask is a 16-bit layer bitmask.',
    inputSchema: z.object({
      id: z.string(),
      enabled: z.boolean().optional(),
      bodyType: z.enum(['dynamic', 'fixed', 'kinematic']).optional(),
      collider: z.enum(['box', 'sphere', 'capsule']).optional(),
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
      source: z
        .enum(['manual', 'speed', 'verticalSpeed', 'moving', 'crouching', 'grounded', 'rolling', 'attacking', 'aiming', 'reloading', 'interacting', 'emoting', 'weaponEquipped', 'variable'])
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

  add_animator_transition: tool({
    description:
      'Add a transition between states. from is a stateId or "any". Conditions are ANDed; each compares a parameterId against a value with op (==,!=,>,>=,<,<=). duration is the crossfade seconds. Set hasExitTime:true for one-shot states (e.g. Jump Start/Land) so the transition only fires after the clip finishes. Returns transitionId.',
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
      'Set a live animator parameter value on an object during Play (e.g. flip a manual "WeaponEquipped" bool, set a float). Resolves the parameter by name on the object\'s controller. Auto-sourced params (speed, grounded, etc.) are recomputed each frame so setting them has no lasting effect — use for "manual" params and triggers.',
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
      'Turn a physics ragdoll on or off for a character object during Play — its skeleton goes limp and falls under gravity (works on any rigged object). Takes effect immediately during Play; entering an animator state named "Death" auto-ragdolls. Use the "Set Ragdoll" node for in-graph triggers, or the character\'s Ragdoll test key.',
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
      modelYawOffset: z.number().optional().describe('Facing offset in radians; use Math.PI (~3.14159) to flip a model that faces backwards.'),
      // Key bindings — KeyboardEvent.code strings, e.g. "KeyW", "Space", "ShiftLeft", "ArrowUp".
      keyForward: z.string().optional(),
      keyBackward: z.string().optional(),
      keyLeft: z.string().optional(),
      keyRight: z.string().optional(),
      keyJump: z.string().optional(),
      keySprint: z.string().optional(),
      keyCrouch: z.string().optional(),
      keyRoll: z.string().optional(),
      rollSpeed: z.number().optional(),
      rollDuration: z.number().optional(),
      keyAttack: z.string().optional(),
      keyAim: z.string().optional(),
      keyReload: z.string().optional(),
      keyInteract: z.string().optional(),
      keyEmote: z.string().optional(),
      keyRagdoll: z.string().optional(),
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

  add_gameplay_kit: tool({
    description:
      "Add a ready-made gameplay system to a character that already has an Animator Controller (e.g. from create_character_pawn) — augments its state machine with extra states/params/transitions matched from the skeleton's clips. Kits: 'ranged' (pistol aim/shoot/reload — toggle the RangedMode param to enter; aim=keyAim/RMB, shoot=keyAttack, reload=keyReload), 'health' (a Health project variable + Hit-reaction state fired by a manual 'Hit' trigger + a Death state that auto-drops into the ragdoll at Health<=0), 'interactions' (an Interact state on keyInteract/E), 'emotes' (a dance/wave Emote held on keyEmote/F). The bundled third-person template ships with all four.",
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
      'Attach an object to a bone "socket" of a character\'s animated skeleton (e.g. a sword to "hand_r"), so it follows the bone. The object\'s transform becomes the offset from the bone — use update_transform to fine-tune position/rotation. Pass no targetObjectId to detach. Use list_bones to find bone names.',
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

  add_skeleton_socket: tool({
    description:
      'Add a reusable named socket (a bone + offset) to a Skeleton asset, Unreal-style. Attachments can then target it by name with attach_to_socket, and editing the socket moves everything attached to it. Returns the socketId. skeletonId comes from the snapshot\'s skeletalMeshes[].skeletonId; use list_bones on a character to find bone names.',
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
      "Tune a skeleton's physics-ragdoll definition (shared by every character using that skeleton). Adjust when a ragdoll looks too floppy/stiff/light. skeletonId comes from the snapshot's skeletalMeshes[].skeletonId or skeletons[].id. All fields optional. capsuleRadius (bone thickness, fatter=more stable), density (mass, heavier=swings slower), linearDamping/angularDamping (higher=less motion/stiffer), groundY (floor height it piles on), excludePattern (case-insensitive regex of bone names NOT simulated).",
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
      'Auto-generate a default capsule physics body for every simulated bone of a skeleton (Unreal "auto-generate bodies"). A starting point you then fine-tune per bone with set_ragdoll_body. skeletonId from snapshot skeletalMeshes[].skeletonId / skeletons[].id.',
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
      "Configure ONE bone's physics body in a skeleton's ragdoll, Unreal-PhAT-style (overrides the global ragdoll defaults for that bone). Use list_bones on a character to get exact bone names. enabled:false removes that bone from the simulation. shape: capsule|box|sphere. radius (capsule/sphere), length (capsule half-length; 0=auto from bone), density (mass), linearDamping, angularDamping (=joint stiffness, higher=stiffer). Omitted fields fall back to the skeleton defaults.",
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
      "Remove a bone's per-bone ragdoll body override so it reverts to the skeleton's global defaults. To instead stop a bone from simulating at all, use set_ragdoll_body with enabled:false.",
    inputSchema: z.object({ skeletonId: z.string(), boneName: z.string() }),
    execute: async ({ skeletonId, boneName }) => {
      if (!store().skeletons.some((s) => s.id === skeletonId)) return `No skeleton with id ${skeletonId}.`;
      store().removeRagdollBody(skeletonId, boneName);
      return `Removed ragdoll body override on "${boneName}".`;
    },
  }),

  attach_to_socket: tool({
    description:
      'Attach an object to a named skeleton socket on a character (created with add_skeleton_socket). Like attach_to_bone but references the reusable socket by name so its offset is shared. Pass no socketName to detach.',
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

  create_ui_document: tool({
    description:
      'Create a Game UI document. surface "screen" = a HUD overlay drawn on the player\'s screen (health bars, score); "world" = a widget anchored over a 3D object (attach with attach_world_ui). It starts with an empty root Panel. Returns its uiDocumentId; add elements with add_ui_element.',
    inputSchema: z.object({
      name: z.string().optional(),
      surface: z.enum(['screen', 'world']).optional().describe('Defaults to "screen".'),
      folderId: z.string().optional(),
    }),
    execute: async ({ name, surface, folderId }) => {
      const id = store().createUIDocument(name, surface ?? 'screen', folderId);
      const doc = findUIDocument(id);
      return `Created ${doc?.surface} UI "${doc?.name}" with uiDocumentId ${id}. Its root panel id is ${doc?.root.id}.`;
    },
  }),

  add_ui_element: tool({
    description:
      'Add an element to a UI document under a parent element (omit parentId to add under the root panel). kind: panel (container), text, bar (a fill bar — bind its "fill" to a 0-1 value), button (set onClickEvent via update_ui_element), image. Returns the new elementId.',
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
      "Update a UI element: text (text/button label), className (for raw CSS), onClickEvent (button → fires that custom event), assetId (image), and style (CSS-like: background, color hex; width/height/padding/fontSize/borderRadius as CSS strings e.g. '160px'; flexDirection 'row'|'column').",
    inputSchema: z.object({
      documentId: z.string(),
      elementId: z.string(),
      name: z.string().optional(),
      text: z.string().optional(),
      className: z.string().optional(),
      onClickEvent: z.string().optional(),
      assetId: z.string().optional(),
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
      'Bind a UI element property to a live expression evaluated every frame. target: "text" (element text), "fill" (a bar\'s 0-1 fill; e.g. health/maxHealth), "visible" (show/hide), "color"/"background" (CSS color), "width". The expression reads project variables BY NAME (e.g. "health / 100") and, for world UI, the host object via "self.<key>" (e.g. "self.health"). Pass an empty expression to remove the binding.',
    inputSchema: z.object({
      documentId: z.string(),
      elementId: z.string(),
      target: z.enum(['text', 'fill', 'visible', 'color', 'background', 'width']),
      expression: z.string().describe('e.g. "score", "health / 100", "self.health > 0"'),
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
      'Anchor a "world" UI document over a 3D object (e.g. an enemy health bar). The object then shows the widget at its position; world UI bindings can read that object\'s instance variables via self.<key> (set with set_object_variable). Pass empty documentId to detach.',
    inputSchema: z.object({
      objectId: z.string(),
      documentId: z.string().optional().describe('A world UI document id, or empty to detach.'),
    }),
    execute: async ({ objectId, documentId }) => {
      if (!findObject(objectId)) return `No object with id ${objectId}.`;
      if (documentId) {
        const doc = findUIDocument(documentId);
        if (!doc) return `No UI document with id ${documentId}.`;
        if (doc.surface !== 'world') return `UI ${documentId} is a screen document; only "world" docs can be anchored to objects.`;
        store().attachUI(objectId, documentId);
        return `Anchored world UI ${documentId} to ${objectId}.`;
      }
      store().detachUI(objectId);
      return `Detached the world UI from ${objectId}.`;
    },
  }),

  set_object_variable: tool({
    description:
      "Set a per-instance variable on an object (e.g. this enemy's health). Read by that object's world UI as self.<key> and by Get/Set Object Var script nodes. Use this to seed starting values like health=100.",
    inputSchema: z.object({ objectId: z.string(), key: z.string(), value: graphValue }),
    execute: async ({ objectId, key, value }) => {
      if (!findObject(objectId)) return `No object with id ${objectId}.`;
      store().setObjectVariable(objectId, key, asGraphValue(value));
      return `Set ${objectId}.${key} = ${JSON.stringify(value)}.`;
    },
  }),

  add_ui_preset: tool({
    description:
      'Insert a ready-made widget into a UI document — the FAST way to build common UI. "healthBar" = a labeled bar pre-bound to a number variable (auto-created if missing, default "health"=100); "counter" = a text pre-bound to a variable (default "score"); "label"/"button"/"panel"/"image" = styled primitives. Drops under parentId (or the root). Returns the inserted element id. Prefer this over composing primitives by hand.',
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
      "Get (or create) the Blueprint that holds a UI document's behaviour, and ensure it runs (an empty \"UI Logic\" object carrying it is auto-created). Returns its blueprintId — then use add_node / connect_nodes on it to wire behaviour (Show UI, Hide UI, Set UI Text, Custom Event ← button clicks, etc.).",
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
      otherObjectId: z.string().optional().describe('Collision/Trigger Enter: optional id of the other object to filter against.'),
      targetObjectId: z.string().optional().describe('Destroy Object / Set Ragdoll / animator nodes: target object; omit for self.'),
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
      otherObjectId,
      targetObjectId,
    }) => {
      if (!findBlueprint(blueprintId)) return `No blueprint with id ${blueprintId}.`;
      if (variableId && !findVariable(variableId)) return `No variable with id ${variableId}.`;
      if (otherObjectId && !findObject(otherObjectId)) return `No object with id ${otherObjectId}.`;
      if (targetObjectId && !findObject(targetObjectId)) return `No object with id ${targetObjectId}.`;
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
      otherObjectId: z.string().optional().describe('Collision/Trigger Enter: optional id of the other object to filter against.'),
      assetId: z.string().optional(),
      spawnKind: z.enum(['cube', 'sphere', 'capsule', 'plane']).optional(),
      message: z.string().optional(),
      materialColor: z.string().optional(),
      materialColorTarget: z.enum(['base', 'emissive']).optional(),
      materialProperty: z.enum(['metalness', 'roughness', 'emissiveIntensity']).optional(),
      // Set/Get Anim nodes: which animator parameter (by name, from the snapshot's controllers) and which object.
      paramName: z.string().optional(),
      targetObjectId: z.string().optional().describe('For Destroy Object, Set Ragdoll, and Set/Get Anim nodes: object to target; omit for self.'),
    }),
    execute: async ({ blueprintId, nodeId, vectorValue, variableId, dataAssetId, tableId, otherObjectId, targetObjectId, ...patch }) => {
      if (!findBlueprint(blueprintId)) return `No blueprint with id ${blueprintId}.`;
      if (variableId && !findVariable(variableId)) return `No variable with id ${variableId}.`;
      if (otherObjectId && !findObject(otherObjectId)) return `No object with id ${otherObjectId}.`;
      if (targetObjectId && !findObject(targetObjectId)) return `No object with id ${targetObjectId}.`;
      const resolvedDataAssetId = dataAssetId ?? tableId;
      if (resolvedDataAssetId && !findDataAsset(resolvedDataAssetId)) return `No Data Asset with id ${resolvedDataAssetId}.`;
      const updates: Partial<NodeForgeNodeData> = { ...patch };
      if (variableId !== undefined) updates.variableId = variableId;
      if (resolvedDataAssetId !== undefined) updates.tableId = resolvedDataAssetId;
      if (otherObjectId !== undefined) updates.otherObjectId = otherObjectId || undefined;
      if (targetObjectId !== undefined) updates.targetObjectId = targetObjectId || undefined;
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
