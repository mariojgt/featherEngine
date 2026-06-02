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
  'Trigger Exit',
  'Interact',
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
  'Spawn Projectile',
  'Spawn Attached',
  'Set Visible',
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
  'Trigger Exit': 'Events',
  Interact: 'Events',
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
  'Spawn Projectile': 'Runtime',
  'Spawn Attached': 'Runtime',
  'Set Visible': 'Runtime',
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
const findPrefab = (id: string) => store().prefabs.find((prefab) => prefab.id === id);

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
    description: 'Create a new scene object. Returns its id. Spawn dynamic physics objects slightly above the ground (y > 0). Pass parentId to nest it under another object (e.g. building a composite character).',
    inputSchema: z.object({
      kind: z.enum(['empty', 'cube', 'sphere', 'capsule', 'plane', 'light', 'camera']),
      name: z.string().optional(),
      position: vec3.optional(),
      color: z.string().optional().describe('Hex color, e.g. #FF6B6B'),
      parentId: z.string().optional().describe('Nest the new object under this existing object.'),
      physics: z
        .object({
          enabled: z.boolean().optional(),
          bodyType: z.enum(['dynamic', 'fixed', 'kinematic']).optional(),
          collider: z.enum(['box', 'sphere', 'capsule']).optional(),
        })
        .optional(),
    }),
    execute: async ({ kind, name, position, color, parentId, physics }) => {
      if (parentId && !findObject(parentId)) return `No object with id ${parentId} to parent under.`;
      const id = store().createObjectWithProps(kind as SceneObjectKind, {
        name,
        position: position ? asVec3(position) : undefined,
        color,
        parentId,
        physics: physics ? { ...physics, enabled: physics.enabled ?? true } : undefined,
      });
      return `Created ${kind} "${findObject(id)?.name}" with id ${id}${parentId ? ` (nested under ${parentId})` : ''}.`;
    },
  }),

  set_object_parent: tool({
    description: 'Nest an object under a parent (it follows the parent and is deleted with it), or detach it to the scene root by omitting parentId. Used to build/edit composite object hierarchies.',
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
      "Update an object's material. color (hex), metalness 0-1 and roughness 0-1 affect built-in meshes always; for an object using an imported model they only take effect when overrideMaterial is true. textureAssetId assigns an image asset as the base-color (albedo) texture and applies to both built-in meshes and models regardless of overrideMaterial — pass an empty string to remove it.",
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
      'Turn an animator state into a BLEND SPACE (Unreal-style): it blends `samples` continuously by parameter(s) instead of playing one clip — smooth, no popping. 1D (parameterName only): each sample {animationId, value} sits on one axis (e.g. Speed → idle@0/walk@1.5/jog@3.4/sprint@6.8). 2D (also pass parameterNameY): each sample also has `y`, placed on a plane (e.g. moveX × moveY → 8-way directional strafe; center sample = idle at 0,0). Pass empty samples to revert to a single-clip state.',
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
      keyCrawl: z.string().optional(),
      crawlMultiplier: z.number().optional(),
      strafe: z.boolean().optional().describe('Face the camera + move 8-way (pairs with a 2D MoveX/MoveY blend space).'),
      keyRoll: z.string().optional(),
      rollSpeed: z.number().optional(),
      rollDuration: z.number().optional(),
      keyAttack: z.string().optional(),
      keyAim: z.string().optional(),
      keyReload: z.string().optional(),
      keyInteract: z.string().optional(),
      interactRange: z.number().optional().describe('Max distance (units) to focus an interactable object in front of the character (drives the Interact prompt/event). Default 3.'),
      keyEmote: z.string().optional(),
      keyRagdoll: z.string().optional(),
      // Player sound effects — pass an "audio"-type asset id; the runtime plays each automatically on its event.
      footstepSoundId: z.string().optional().describe('Audio asset id played on each stride while moving on the ground.'),
      jumpSoundId: z.string().optional().describe('Audio asset id played when the character jumps.'),
      landSoundId: z.string().optional().describe('Audio asset id played when the character lands after falling.'),
      swimSoundId: z.string().optional().describe('Audio asset id played (splash) when the character enters a water volume.'),
      attackSoundId: z.string().optional().describe('Audio asset id played when the character starts an attack/swing.'),
      hurtSoundId: z.string().optional().describe("Audio asset id played when the character's health drops (took damage)."),
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

  set_attachment_offset: tool({
    description:
      "Set the local attach offset of an already-attached object (seat a weapon in the hand). position/scale are vec3, rotation is in DEGREES (XYZ). This offset overrides the object's own transform as the attach offset. Tip for the bundled rig (hand_r): the sword's blade is +Z and the pistol's barrel is +X, so a sword sits blade-up at rotation [0,90,0] and a pistol points forward at [0,-90,0].",
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
      'Build a complete, ready-to-play third-person STARTER GAME from the engine\'s bundled Quaternius UAL rig (127 clips): a "Player" pawn with an Idle → Walk → Jog → Sprint locomotion animator (+jump/crouch/roll/punch/kick/sword), mouse-look follow camera, editable controller blueprint, and all four gameplay kits (ranged/health/interactions/emotes); a SWORD and PISTOL that are reusable PREFABS you EQUIP BY WALKING OVER them (spawn-attached to the hand, switching melee/ranged); click to shoot a projectile while the pistol is equipped; a HUD health bar; a damageable Target Dummy. Generated content is foldered (Weapons / UI / Player). No asset import needed — use when the user asks for a third-person character/game/template from scratch. Returns the pawn objectId.',
    inputSchema: z.object({}),
    execute: async () => {
      const id = await createThirdPersonTemplate();
      return id ? `Created third-person starter — pawn objectId ${id}. Press Play: WASD move (hold Shift to sprint), mouse look, walk over the sword/pistol to equip, click to shoot (pistol), E interact, F emote.` : `Couldn't build the template.`;
    },
  }),

  create_prefab: tool({
    description:
      'Capture an object and ALL its descendants as a reusable prefab (object template) in the Project browser. Returns the prefabId. Use this to make something the user built reusable; stamp copies later with instantiate_prefab.',
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

  set_light: tool({
    description:
      'Turn an object into (or reconfigure) a light. point = an omni bulb that illuminates nearby surfaces (great for accent/mood lights); spot = a cone; directional = a sun (whole-scene, no falloff). Position it by moving the object. Pair bright lights/emissive colors with bloom (set_render_settings) for glow.',
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
      'Set project-wide post-processing (bloom + vignette) — the biggest "AAA" visual lever. Bloom makes emissive materials and additive tracers/muzzle flashes glow. Lower bloomThreshold = more things glow. Applies in Play and the exported game.',
    inputSchema: z.object({
      bloomEnabled: z.boolean().optional(),
      bloomIntensity: z.number().optional().describe('Bloom strength, ~0.3–2.'),
      bloomThreshold: z.number().optional().describe('Luminance cutoff 0–1; lower = more glow.'),
      bloomRadius: z.number().optional().describe('Bloom spread/smoothing 0–1.'),
      vignetteEnabled: z.boolean().optional(),
    }),
    execute: async ({ bloomEnabled, bloomIntensity, bloomThreshold, bloomRadius, vignetteEnabled }) => {
      store().updateRenderSettings({ bloomEnabled, bloomIntensity, bloomThreshold, bloomRadius, vignetteEnabled });
      return 'Updated render/post-processing settings.';
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
          collider: z.enum(['box', 'sphere', 'capsule']).optional(),
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
      projectileSpeed: z.number().optional().describe('Spawn Projectile: muzzle speed (units/sec). Default 20.'),
      projectileDamage: z.number().optional().describe('Spawn Projectile: hit damage subtracted from the target\'s health. Default 25.'),
      projectileSize: z.number().optional().describe('Spawn Projectile: radius of the built-in sphere bullet (ignored when projectileTemplateId is set). Default 0.18.'),
      projectileColor: z.string().optional().describe('Spawn Projectile: hex color of the built-in sphere bullet (ignored when a template is set). Default #ffd166.'),
      projectileLife: z.number().optional().describe('Spawn Projectile: seconds before the bullet auto-despawns. Default 3.'),
      projectileGravity: z.number().optional().describe('Spawn Projectile: gravity scale. 0 = flies straight; raise for an arcing shot. Default 0.'),
      projectileTemplateId: z.string().optional().describe('Spawn Projectile: id of a scene object to CLONE as the bullet (its mesh/model/scale/material). Omit for the built-in sphere.'),
      projectileMuzzle: vec3.optional().describe('Spawn Projectile: first-person muzzle offset [right, up, forward] from the eye where the shot originates (default [0.28,-0.26,0.6] = down-right of center). The shot still converges on the crosshair.'),
      projectileDebug: z.boolean().optional().describe('Spawn Projectile: when true, log every spawn + hit to the runtime console.'),
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
      projectileTemplateId,
      projectileMuzzle,
      projectileDebug,
      otherObjectId,
      targetObjectId,
    }) => {
      if (!findBlueprint(blueprintId)) return `No blueprint with id ${blueprintId}.`;
      if (variableId && !findVariable(variableId)) return `No variable with id ${variableId}.`;
      if (otherObjectId && !findObject(otherObjectId)) return `No object with id ${otherObjectId}.`;
      if (targetObjectId && !findObject(targetObjectId)) return `No object with id ${targetObjectId}.`;
      if (projectileTemplateId && !findObject(projectileTemplateId)) return `No object with id ${projectileTemplateId}.`;
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
        projectileTemplateId,
        projectileMuzzle: projectileMuzzle ? asVec3(projectileMuzzle) : undefined,
        projectileDebug,
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
      projectileSpeed: z.number().optional().describe('Spawn Projectile: muzzle speed (units/sec).'),
      projectileDamage: z.number().optional().describe('Spawn Projectile: hit damage.'),
      projectileSize: z.number().optional().describe('Spawn Projectile: built-in sphere radius (ignored with a template).'),
      projectileColor: z.string().optional().describe('Spawn Projectile: built-in sphere hex color (ignored with a template).'),
      projectileLife: z.number().optional().describe('Spawn Projectile: seconds before auto-despawn.'),
      projectileGravity: z.number().optional().describe('Spawn Projectile: gravity scale (0 = straight).'),
      projectileTemplateId: z.string().optional().describe('Spawn Projectile: scene object id to clone as the bullet; empty string clears it.'),
      projectileMuzzle: vec3.optional().describe('Spawn Projectile: first-person muzzle offset [right, up, forward] from the eye (default [0.28,-0.26,0.6]).'),
      projectileDebug: z.boolean().optional().describe('Spawn Projectile: log spawns + hits to the runtime console.'),
      // Set/Get Anim nodes: which animator parameter (by name, from the snapshot's controllers) and which object.
      paramName: z.string().optional(),
      targetObjectId: z.string().optional().describe('For Destroy Object, Set Ragdoll, and Set/Get Anim nodes: object to target; omit for self.'),
    }),
    execute: async ({ blueprintId, nodeId, vectorValue, variableId, dataAssetId, tableId, otherObjectId, targetObjectId, projectileTemplateId, projectileMuzzle, ...patch }) => {
      if (!findBlueprint(blueprintId)) return `No blueprint with id ${blueprintId}.`;
      if (variableId && !findVariable(variableId)) return `No variable with id ${variableId}.`;
      if (otherObjectId && !findObject(otherObjectId)) return `No object with id ${otherObjectId}.`;
      if (targetObjectId && !findObject(targetObjectId)) return `No object with id ${targetObjectId}.`;
      if (projectileTemplateId && !findObject(projectileTemplateId)) return `No object with id ${projectileTemplateId}.`;
      const resolvedDataAssetId = dataAssetId ?? tableId;
      if (resolvedDataAssetId && !findDataAsset(resolvedDataAssetId)) return `No Data Asset with id ${resolvedDataAssetId}.`;
      const updates: Partial<NodeForgeNodeData> = { ...patch };
      if (variableId !== undefined) updates.variableId = variableId;
      if (resolvedDataAssetId !== undefined) updates.tableId = resolvedDataAssetId;
      if (otherObjectId !== undefined) updates.otherObjectId = otherObjectId || undefined;
      if (targetObjectId !== undefined) updates.targetObjectId = targetObjectId || undefined;
      if (projectileTemplateId !== undefined) updates.projectileTemplateId = projectileTemplateId || undefined;
      if (projectileMuzzle !== undefined) updates.projectileMuzzle = asVec3(projectileMuzzle);
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
};

export type EngineTools = typeof engineTools;
