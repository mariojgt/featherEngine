import type { Edge, OnConnect, OnEdgesChange, OnNodesChange } from '@xyflow/react';
import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react';
import { create } from 'zustand';
import {
  PROJECT_VERSION,
  type AssetItem,
  type AssetType,
  type ColliderType,
  type CompareOperator,
  type DataAsset,
  type DataAssetColumn,
  type DataAssetRow,
  type GraphNodeCategory,
  type GraphValue,
  type GraphValueType,
  type GraphNodeKind,
  type GraphNodeTone,
  type AnimatorComponent,
  type MaterialDefinition,
  type MeshRendererComponent,
  type NodeForgeProject,
  type NodeForgeNode,
  type NodeForgeNodeData,
  type PhysicsComponent,
  type ProjectFolder,
  type ProjectGraph,
  type ProjectVariable,
  type RigidBodyType,
  type Scene,
  type SceneObject,
  type SceneObjectKind,
  type ScriptBlueprint,
  type SkeletonAsset,
  type SkeletonSocket,
  type SkeletalMeshAsset,
  type AnimationAsset,
  type AnimatorController,
  type AnimatorParameter,
  type AnimatorState,
  type AnimatorTransition,
  type AnimatorCondition,
  type CharacterControllerComponent,
  type TransformComponent,
  type Vector3Tuple,
} from '../types';
import { getActivePhysics, startPhysics, stopPhysics } from '../runtime/physicsWorld';
import { cameraYaw as mouseCameraYaw } from '../runtime/mouseLook';
import { resolveMaterial } from '../three/materialResolve';
import type { ModelInspection } from '../three/inspectModel';

const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

/** Live state of one object's Animator Controller during Play. */
export interface RuntimeAnimator {
  /** Active state id within the controller. */
  stateId: string;
  /** Current parameter values, keyed by parameter id. */
  params: Record<string, number | boolean>;
  /** Crossfade seconds for the transition that produced the current state (read by SkinnedModel). */
  fade: number;
  /** Seconds elapsed in the current state — drives exit-time transitions (one-shot clips). */
  time: number;
}

/** A factory for a fresh default animator component (used when one is first enabled). */
const defaultAnimator = (): AnimatorComponent => ({ enabled: false, speed: 1, loop: true });

/** Interpolate an angle toward a target along the shortest arc (radians). */
const lerpAngle = (from: number, to: number, t: number): number => {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * Math.min(Math.max(t, 0), 1);
};

/** A factory for a fresh default character controller (sensible third-person defaults). */
export const defaultCharacter = (): CharacterControllerComponent => ({
  enabled: false,
  moveSpeed: 3.4,
  sprintMultiplier: 2,
  crouchMultiplier: 0.45,
  jumpStrength: 5,
  gravity: 12,
  turnSpeed: 10,
  modelYawOffset: 0,
  groundLevel: 0,
  keyForward: 'KeyW',
  keyBackward: 'KeyS',
  keyLeft: 'KeyA',
  keyRight: 'KeyD',
  keyJump: 'Space',
  keySprint: 'ShiftLeft',
  keyCrouch: 'KeyC',
  keyRoll: 'KeyQ',
  rollSpeed: 7,
  rollDuration: 0.7,
  keyAttack: 'Mouse0',
  cameraFollow: true,
  // Behind (-Z) and above a +Z-forward character.
  cameraOffset: [0, 2.6, -6],
  mouseLook: true,
  mouseSensitivity: 0.0025,
  cameraPitch: 0.28,
  cameraMinPitch: -0.2,
  cameraMaxPitch: 1.2,
  cameraRelativeMovement: true,
});

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

const defaultMaterial = (name: string, folderId?: string): MaterialDefinition => ({
  id: makeId('mat'),
  name,
  description: 'Reusable material asset.',
  color: '#5B8CFF',
  metalness: 0.1,
  roughness: 0.65,
  emissiveColor: '#000000',
  emissiveIntensity: 0,
  folderId,
  createdAt: Date.now(),
});

const defaultValueForType = (type: GraphValueType): GraphValue => {
  if (type === 'number') return 0;
  if (type === 'string') return '';
  if (type === 'boolean') return false;
  return [0, 0, 0];
};

const valueTypeOf = (value: GraphValue): GraphValueType => {
  if (Array.isArray(value)) return 'vector3';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
};

const cloneGraphValue = (value: GraphValue): GraphValue =>
  Array.isArray(value) ? ([value[0], value[1], value[2]] as Vector3Tuple) : value;

const coerceGraphValue = (value: unknown, type: GraphValueType): GraphValue => {
  if (type === 'number') {
    const next = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(next) ? next : 0;
  }
  if (type === 'string') return value === undefined || value === null ? '' : String(value);
  if (type === 'boolean') {
    if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
    return Boolean(value);
  }
  if (Array.isArray(value)) {
    return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0] as Vector3Tuple;
  }
  return [0, 0, 0];
};

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

const starterVariables: ProjectVariable[] = [
  {
    id: 'var-score',
    name: 'Score',
    type: 'number',
    defaultValue: 0,
    persistent: true,
    createdAt: Date.now(),
  },
  {
    id: 'var-player-name',
    name: 'PlayerName',
    type: 'string',
    defaultValue: 'Hero',
    persistent: true,
    createdAt: Date.now(),
  },
  {
    id: 'var-has-key',
    name: 'HasKey',
    type: 'boolean',
    defaultValue: false,
    persistent: true,
    createdAt: Date.now(),
  },
];

const starterDataAssets: DataAsset[] = [
  {
    id: 'table-items',
    name: 'Items',
    columns: [
      { id: 'col-display-name', name: 'DisplayName', type: 'string' },
      { id: 'col-value', name: 'Value', type: 'number' },
    ],
    rows: [
      {
        id: 'row-potion',
        key: 'potion',
        values: { 'col-display-name': 'Potion', 'col-value': 25 },
      },
      {
        id: 'row-key',
        key: 'key',
        values: { 'col-display-name': 'Small Key', 'col-value': 1 },
      },
    ],
    createdAt: Date.now(),
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
  Variables: 'variable',
  Data: 'data',
  Persistence: 'persistence',
  Material: 'material',
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
  Number: 'Outputs a numeric literal.',
  String: 'Outputs a text literal.',
  Boolean: 'Outputs a true or false value.',
  Vector3: 'Stores an X, Y, Z vector.',
  'Get Variable': 'Outputs the current value of a project variable.',
  'Set Variable': 'Writes a value into a project variable.',
  'Data Asset Lookup': 'Reads a typed value from a Data Asset row.',
  'Table Lookup': 'Reads a typed value from a legacy table row.',
  'Material Output': 'Final surface — wire inputs to override the material\'s base fields.',
  Color: 'Outputs a constant color.',
  Scalar: 'Outputs a constant number.',
  Texture: 'Outputs an image texture (feed Base Color or Normal).',
  Mix: 'Blends two colors by a 0-1 factor.',
  Multiply: 'Multiplies two numbers, two colors, or a color by a scalar.',
  'Add (Material)': 'Adds two numbers or two colors.',
  'Clamp (Material)': 'Clamps a number to a min/max range.',
  'Get Material Color': "Reads this object's current material color at runtime.",
  'Get Material Property': "Reads this object's current metalness/roughness/glow at runtime.",
  Translate: 'Moves the attached object.',
  Rotate: 'Rotates the attached object.',
  'Apply Force': 'Adds force to a rigid body.',
  'Spawn Object': 'Creates an object instance.',
  'Play Sound': 'Plays an audio source.',
  'Set Material Color': 'Changes the attached object\'s material color at runtime (per-object).',
  'Set Material Property': 'Sets a numeric material property (metalness/roughness/glow) at runtime (per-object).',
  'Set Anim Float': 'Writes a float into the object\'s animator parameter (e.g. Speed) to drive its state machine.',
  'Set Anim Bool': 'Writes a true/false into the object\'s animator parameter.',
  'Set Anim Trigger': 'Fires a one-shot animator trigger (e.g. Jump, Attack) consumed by a transition.',
  'Get Anim Param': 'Reads the current value of an animator parameter (float/bool) back into the blueprint.',
  'Get Anim State': 'Outputs the name of the animator\'s currently-active state, for the blueprint to react to.',
  'Get Move Input': 'Outputs a world-space move direction (Vector3) from WASD / arrow keys.',
  Move: 'Moves the owner along the ground by a direction vector at a speed, turning it to face travel.',
  Jump: 'Makes the owning character jump (needs a Character Controller for height/gravity).',
  'Is Grounded': 'Outputs true when the owning character is on the ground.',
  'Set Camera': 'Overrides the follow-camera distance/height at runtime.',
  'Save Game': 'Writes persistent variables into local save storage.',
  'Load Game': 'Restores persistent variables from local save storage.',
  'Clear Save': 'Deletes a local save slot.',
  Print: 'Logs a message to the on-screen console during Play.',
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
  Number: 'value.number',
  String: 'value.string',
  Boolean: 'value.boolean',
  Vector3: 'value.vector3',
  'Get Variable': 'variable.get',
  'Set Variable': 'variable.set',
  'Data Asset Lookup': 'data.tableGet',
  'Table Lookup': 'data.tableGet',
  Translate: 'action.translate',
  'Translate Z -1': 'action.translate',
  Rotate: 'action.rotate',
  'Apply Force': 'action.applyForce',
  'Fire Event': 'action.fireEvent',
  'Spawn Object': 'action.spawnObject',
  'Play Sound': 'action.playSound',
  'Set Material Color': 'action.setMaterialColor',
  'Set Material Property': 'action.setMaterialProperty',
  'Set Anim Float': 'animator.setFloat',
  'Set Anim Bool': 'animator.setBool',
  'Set Anim Trigger': 'animator.setTrigger',
  'Get Anim Param': 'animator.getParam',
  'Get Anim State': 'animator.getState',
  'Get Move Input': 'input.move',
  Move: 'action.move',
  Jump: 'action.jump',
  'Is Grounded': 'query.grounded',
  'Set Camera': 'action.setCamera',
  'Material Output': 'material.output',
  Color: 'material.color',
  Scalar: 'material.scalar',
  Texture: 'material.texture',
  Mix: 'material.mix',
  Multiply: 'material.multiply',
  'Add (Material)': 'material.add',
  'Clamp (Material)': 'material.clamp',
  'Get Material Color': 'action.getMaterialColor',
  'Get Material Property': 'action.getMaterialProperty',
  'Save Game': 'save.write',
  'Load Game': 'save.load',
  'Clear Save': 'save.clear',
  Print: 'action.print',
};

const categoryByKind = (nodeKind: GraphNodeKind): GraphNodeCategory => {
  if (nodeKind.startsWith('event.')) return 'Events';
  if (nodeKind.startsWith('logic.')) return 'Logic';
  if (nodeKind.startsWith('math.')) return 'Math';
  if (nodeKind.startsWith('value.')) return 'Values';
  if (nodeKind.startsWith('variable.')) return 'Variables';
  if (nodeKind.startsWith('data.')) return 'Data';
  if (nodeKind.startsWith('save.')) return 'Persistence';
  if (nodeKind.startsWith('material.')) return 'Material';
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
    case 'logic.compare':
      return { label: `Compare ${data.compareOp ?? '=='}`, description: 'Outputs true or false by comparing two values.' };
    case 'value.number':
      return { label: `Number ${Number(data.numberValue ?? 0)}`, description: 'Outputs a numeric literal.' };
    case 'value.string':
      return { label: `String "${data.stringValue ?? ''}"`, description: 'Outputs a text literal.' };
    case 'value.boolean':
      return { label: `Boolean ${data.booleanValue ? 'True' : 'False'}`, description: 'Outputs a true or false value.' };
    case 'value.vector3': {
      const vector = data.vectorValue ?? [0, 0, 0];
      return { label: `Vector3 ${vector.join(', ')}`, description: 'Outputs an X, Y, Z vector.' };
    }
    case 'variable.get':
      return { label: 'Get Variable', description: 'Reads the current runtime value of a project variable.' };
    case 'variable.set':
      return { label: 'Set Variable', description: 'Writes a runtime value into a project variable.' };
    case 'data.tableGet':
      return { label: 'Data Asset Lookup', description: 'Reads one typed value from a Data Asset row.' };
    case 'save.write':
      return { label: `Save Game: ${data.saveSlot || 'slot1'}`, description: 'Stores all persistent variables in a local save slot.' };
    case 'save.load':
      return { label: `Load Game: ${data.saveSlot || 'slot1'}`, description: 'Restores persistent variables from a local save slot.' };
    case 'save.clear':
      return { label: `Clear Save: ${data.saveSlot || 'slot1'}`, description: 'Deletes a local save slot.' };
    case 'material.output':
      return { label: 'Material Output', description: 'Final surface — connected pins override the material\'s base fields.' };
    case 'material.color':
      return { label: `Color ${data.materialColor || '#ffffff'}`, description: 'Outputs a constant color.' };
    case 'material.scalar':
      return { label: `Scalar ${Number(data.numberValue ?? 0)}`, description: 'Outputs a constant number.' };
    case 'material.texture':
      return { label: 'Texture', description: 'Outputs an image texture (feed Base Color or Normal).' };
    case 'material.mix':
      return { label: 'Mix', description: 'Blends two colors by a 0-1 factor.' };
    case 'material.multiply':
      return { label: 'Multiply', description: 'Multiplies two numbers/colors, or a color by a scalar.' };
    case 'material.add':
      return { label: 'Add', description: 'Adds two numbers or two colors.' };
    case 'material.clamp':
      return { label: 'Clamp', description: 'Clamps a number to a min/max range.' };
    case 'action.setMaterialColor':
      return {
        label: `Set ${data.materialColorTarget === 'emissive' ? 'Emissive' : 'Color'} ${data.materialColor || '#ffffff'}`,
        description: "Sets the attached object's base or emissive color at runtime (per-object).",
      };
    case 'action.setMaterialProperty':
      return { label: `Set ${data.materialProperty ?? 'metalness'} ${Number(data.numberValue ?? 0)}`, description: 'Sets a numeric material property at runtime (per-object).' };
    case 'action.getMaterialColor':
      return { label: 'Get Material Color', description: "Reads this object's current material color at runtime." };
    case 'action.getMaterialProperty':
      return { label: `Get ${data.materialProperty ?? 'metalness'}`, description: "Reads this object's current numeric material property at runtime." };
    case 'animator.setFloat':
      return { label: `Set Anim Float: ${data.paramName || 'param'}`, description: 'Writes a float into an animator parameter.' };
    case 'animator.setBool':
      return { label: `Set Anim Bool: ${data.paramName || 'param'}`, description: 'Writes a boolean into an animator parameter.' };
    case 'animator.setTrigger':
      return { label: `Set Anim Trigger: ${data.paramName || 'param'}`, description: 'Fires a one-shot animator trigger.' };
    case 'animator.getParam':
      return { label: `Get Anim Param: ${data.paramName || 'param'}`, description: 'Reads an animator parameter value.' };
    case 'animator.getState':
      return { label: 'Get Anim State', description: 'Outputs the active animator state name.' };
    case 'input.move':
      return { label: 'Get Move Input', description: 'WASD / arrows → a world move direction.' };
    case 'action.move':
      return { label: 'Move', description: 'Moves + turns the owner along a direction at a speed.' };
    case 'action.jump':
      return { label: 'Jump', description: 'Makes the owning character jump.' };
    case 'query.grounded':
      return { label: 'Is Grounded', description: 'True when the character is on the ground.' };
    case 'action.setCamera':
      return { label: 'Set Camera', description: 'Override follow-camera distance/height at runtime.' };
    case 'action.print':
      return { label: `Print: ${data.message || 'message'}`, description: 'Logs its message to the on-screen console during Play.' };
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

  if (nodeKind === 'action.print' && typeof normalized.message !== 'string') {
    normalized.message = 'Hello';
  }

  if (
    (nodeKind === 'animator.setFloat' ||
      nodeKind === 'animator.setBool' ||
      nodeKind === 'animator.setTrigger' ||
      nodeKind === 'animator.getParam') &&
    typeof normalized.paramName !== 'string'
  ) {
    normalized.paramName = 'Speed';
  }

  if (nodeKind === 'logic.compare' && !normalized.compareOp) {
    normalized.compareOp = '==';
  }

  if (nodeKind === 'value.number') {
    normalized.valueType = 'number';
    if (typeof normalized.numberValue !== 'number') normalized.numberValue = 0;
  }

  if (nodeKind === 'value.string') {
    normalized.valueType = 'string';
    if (typeof normalized.stringValue !== 'string') normalized.stringValue = 'Text';
  }

  if (nodeKind === 'value.boolean') {
    normalized.valueType = 'boolean';
    if (typeof normalized.booleanValue !== 'boolean') normalized.booleanValue = true;
  }

  if (nodeKind === 'value.vector3') {
    normalized.valueType = 'vector3';
    if (!Array.isArray(normalized.vectorValue)) normalized.vectorValue = [0, 0, 0];
  }

  if (nodeKind === 'save.write' || nodeKind === 'save.load' || nodeKind === 'save.clear') {
    if (!normalized.saveSlot) normalized.saveSlot = 'slot1';
  }

  if (nodeKind === 'action.setMaterialColor' && typeof normalized.materialColor !== 'string') {
    normalized.materialColor = '#ff5555';
  }

  if (nodeKind === 'action.setMaterialProperty') {
    if (!normalized.materialProperty) normalized.materialProperty = 'metalness';
    if (typeof normalized.numberValue !== 'number') normalized.numberValue = 1;
  }

  if (nodeKind === 'material.output') {
    normalized.hasInput = false;
    normalized.hasOutput = false;
  }

  if (nodeKind === 'material.color' && typeof normalized.materialColor !== 'string') {
    normalized.materialColor = '#B4BCCC';
  }

  if ((nodeKind === 'material.scalar' || nodeKind === 'material.mix') && typeof normalized.numberValue !== 'number') {
    normalized.numberValue = 0.5;
  }

  if (nodeKind === 'action.getMaterialProperty' && !normalized.materialProperty) {
    normalized.materialProperty = 'metalness';
  }

  const isPureValueNode =
    nodeKind.startsWith('value.') ||
    nodeKind.startsWith('math.') ||
    nodeKind === 'logic.compare' ||
    nodeKind === 'logic.and' ||
    nodeKind === 'logic.or' ||
    nodeKind === 'variable.get' ||
    nodeKind === 'data.tableGet' ||
    nodeKind === 'material.color' ||
    nodeKind === 'material.scalar' ||
    nodeKind === 'material.texture' ||
    nodeKind === 'material.mix' ||
    nodeKind === 'material.multiply' ||
    nodeKind === 'material.add' ||
    nodeKind === 'material.clamp' ||
    nodeKind === 'action.getMaterialColor' ||
    nodeKind === 'action.getMaterialProperty' ||
    nodeKind === 'input.move' ||
    nodeKind === 'query.grounded' ||
    nodeKind === 'animator.getParam' ||
    nodeKind === 'animator.getState';

  if (isPureValueNode) {
    normalized.hasInput = false;
    normalized.hasOutput = true;
  }

  return { ...normalized, ...describeNode(normalized) };
};

const makeNodeData = (
  label: string,
  category: GraphNodeCategory,
  options: Partial<NodeForgeNodeData> = {},
): NodeForgeNodeData => normalizeNodeData({ label, category, nodeKind: options.nodeKind ?? nodeKindByLabel[label], ...options });

/** Replace a single graph (by id) via a mapper — used by the material-graph editor actions. */
const mapGraphById = (graphs: ProjectGraph[], graphId: string, fn: (graph: ProjectGraph) => ProjectGraph) =>
  graphs.map((graph) => (graph.id === graphId ? fn(graph) : graph));

/** A fresh material graph: just the Material Output sink (unconnected → renders from the material's flat fields). */
const makeMaterialGraph = (graphId: string, name: string): ProjectGraph => ({
  id: graphId,
  name,
  nodes: [
    {
      id: makeId('node'),
      type: 'nodeforge',
      position: { x: 360, y: 140 },
      data: makeNodeData('Material Output', 'Material'),
    },
  ],
  edges: [],
});

const seedNodeDataFromProject = (
  label: string,
  data: Partial<NodeForgeNodeData> | undefined,
  variables: ProjectVariable[],
  dataAssets: DataAsset[],
): Partial<NodeForgeNodeData> => {
  const next: Partial<NodeForgeNodeData> = { ...(data ?? {}) };
  if ((label === 'Get Variable' || label === 'Set Variable') && !next.variableId) {
    const variable = variables[0];
    if (variable) {
      next.variableId = variable.id;
      next.valueType = variable.type;
      const value = variable.defaultValue;
      if (variable.type === 'number') next.numberValue = value as number;
      if (variable.type === 'string') next.stringValue = value as string;
      if (variable.type === 'boolean') next.booleanValue = value as boolean;
      if (variable.type === 'vector3') next.vectorValue = value as Vector3Tuple;
    }
  }
  if ((label === 'Data Asset Lookup' || label === 'Table Lookup') && !next.tableId) {
    const table = dataAssets[0];
    if (table) {
      next.tableId = table.id;
      next.rowKey = table.rows[0]?.key;
      next.columnId = table.columns[0]?.id;
    }
  }
  return next;
};

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

const makeRuntimeVelocityMap = (objects: SceneObject[]) =>
  Object.fromEntries(
    objects
      .filter((object) => object.physics?.enabled && object.physics.bodyType === 'dynamic')
      .map((object) => [object.id, [0, 0, 0] as Vector3Tuple]),
  );

const makeRuntimeVariableMap = (variables: ProjectVariable[]) =>
  Object.fromEntries(variables.map((variable) => [variable.id, cloneGraphValue(variable.defaultValue)])) as Record<
    string,
    GraphValue
  >;

const saveKeyForSlot = (slot: string) => `nodeforge.save.${slot.trim() || 'slot1'}`;

const readSaveSlot = (slot: string): Record<string, GraphValue> | null => {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(saveKeyForSlot(slot));
    return raw ? (JSON.parse(raw) as Record<string, GraphValue>) : null;
  } catch {
    return null;
  }
};

const writeSaveSlot = (slot: string, values: Record<string, GraphValue>) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(saveKeyForSlot(slot), JSON.stringify(values));
};

const clearSaveSlot = (slot: string) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(saveKeyForSlot(slot));
};

const toNumber = (value: GraphValue | undefined): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') return Number(value) || 0;
  return Array.isArray(value) ? value[0] : 0;
};

const toBoolean = (value: GraphValue | undefined): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.trim().length > 0 && value.trim().toLowerCase() !== 'false';
  return Array.isArray(value) ? value.some((item) => item !== 0) : false;
};

const toVector3 = (value: GraphValue | undefined): Vector3Tuple =>
  Array.isArray(value) ? ([value[0], value[1], value[2]] as Vector3Tuple) : [toNumber(value), 0, 0];

const graphValueToString = (value: GraphValue | undefined): string => {
  if (value === undefined) return '';
  if (Array.isArray(value)) return `[${value.join(', ')}]`;
  return String(value);
};

const compareValues = (left: GraphValue | undefined, right: GraphValue | undefined, op: CompareOperator): boolean => {
  if (op === '==') return graphValueToString(left) === graphValueToString(right);
  if (op === '!=') return graphValueToString(left) !== graphValueToString(right);
  const a = toNumber(left);
  const b = toNumber(right);
  if (op === '>') return a > b;
  if (op === '>=') return a >= b;
  if (op === '<') return a < b;
  return a <= b;
};

const axisIndex = (axis: NodeForgeNodeData['axis']) => {
  if (axis === 'x') return 0;
  if (axis === 'y') return 1;
  return 2;
};

/** Build a runtime-spawned object (action.spawnObject) at a position, with dynamic physics on. */
const makeSpawnedObject = (spawnKind: SceneObjectKind, position: Vector3Tuple): SceneObject => {
  const collider: ColliderType = spawnKind === 'sphere' ? 'sphere' : spawnKind === 'capsule' ? 'capsule' : 'box';
  return {
    id: makeId('obj'),
    name: titleCase(spawnKind),
    kind: spawnKind,
    transform: defaultTransform([position[0], position[1], position[2]]),
    ...objectDefaults[spawnKind],
    physics: { ...defaultPhysics('dynamic', collider), enabled: true },
  } as SceneObject;
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
  const incomingValues = new Map<string, Edge[]>();
  graph.edges.forEach((edge) => {
    const isValueEdge = Boolean(edge.targetHandle && edge.targetHandle !== 'exec-in');
    if (isValueEdge) {
      incomingValues.set(edge.target, [...(incomingValues.get(edge.target) ?? []), edge]);
    } else {
      outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    }
  });

  return { nodesById, outgoing, incomingValues };
};

interface EditorState {
  scenes: Scene[];
  activeSceneId: string;
  selectedObjectId: string;
  /** Object whose follow-camera offset is being positioned with the on-screen gizmo (editor UI only). */
  cameraRigTarget?: string;
  isDirty: boolean;
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
  activeBlueprintId: string;
  activeAnimatorControllerId: string;
  activeMaterialId: string;
  isPlaying: boolean;
  playSnapshot?: {
    sceneId: string;
    transforms: Record<string, TransformComponent>;
    renderers: Record<string, MeshRendererComponent | undefined>;
  };
  runtimeVelocities: Record<string, Vector3Tuple>;
  runtimeKeys: Record<string, boolean>;
  runtimePreviousKeys: Record<string, boolean>;
  runtimeEventQueue: string[];
  runtimeVariableValues: Record<string, GraphValue>;
  /** Per-object animator state machine runtime: active state + live parameter values. Play-only. */
  runtimeAnimators: Record<string, RuntimeAnimator>;
  /** Per-object follow-camera overrides written by the Set Camera node. Play-only. */
  runtimeCameraOverrides: Record<string, { distance: number; height: number }>;
  /** Character-controller object ids standing on the ground last frame (drives jump + grounded). */
  runtimeGrounded: string[];
  /** Remaining roll/dodge time (seconds) per object — drives the forward dash + "rolling" param. */
  runtimeRoll: Record<string, number>;
  /** Remaining attack time (seconds) per object — drives the "attacking" param. */
  runtimeAttack: Record<string, number>;
  /** Object ids that started a contact in the previous physics step; drives event.collisionEnter. */
  runtimeCollisions: string[];
  /** Audio asset ids queued by action.playSound this frame; drained + cleared by the audio runtime. */
  runtimeSoundQueue: string[];
  /** Messages emitted by action.print during Play; shown by the on-screen console overlay. */
  runtimeLog: string[];
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
  setCameraRigTarget: (id?: string) => void;
  createObject: (kind: SceneObjectKind) => void;
  createObjectWithProps: (kind: SceneObjectKind, options?: CreateObjectOptions) => string;
  deleteObject: (id: string) => void;
  deleteSelectedObject: () => void;
  duplicateSelectedObject: () => void;
  renameObject: (id: string, name: string) => void;
  updateTransform: (id: string, field: keyof TransformComponent, value: Vector3Tuple) => void;
  updateRenderer: (id: string, patch: Partial<MeshRendererComponent>) => void;
  setObjectModel: (id: string, modelAssetId?: string) => void;
  updatePhysics: (id: string, patch: Partial<PhysicsComponent>) => void;
  togglePhysics: (id: string) => void;
  /** Enable/disable the animator on an object (seeds a default component when first enabled). */
  toggleAnimator: (id: string) => void;
  /** Patch an object's animator component (clip, speed, loop). No-op if it has no animator. */
  updateAnimator: (id: string, patch: Partial<AnimatorComponent>) => void;
  /**
   * Split an imported model into reusable Skeleton + Skeletal Mesh + Animation assets. Skeletons are
   * deduped by signature (so rigs sharing a skeleton reuse one), and clips are deduped by
   * (skeleton, clip name) so re-importing the same animation pack doesn't pile up duplicates.
   * Returns the skeletal-mesh asset id, or undefined for a non-skinned model.
   */
  registerImportedModel: (input: {
    assetId: string;
    assetName: string;
    folderId?: string;
    inspection: ModelInspection;
  }) => string | undefined;
  // --- Animator Controller (state machine) authoring. All AI-friendly: explicit params, return ids. ---
  createAnimatorController: (name?: string, skeletonId?: string, folderId?: string) => string;
  updateAnimatorController: (id: string, patch: Partial<Pick<AnimatorController, 'name' | 'defaultStateId' | 'skeletonId'>>) => void;
  deleteAnimatorController: (id: string) => void;
  setActiveAnimatorController: (id: string) => void;
  /** Assign (or clear) the controller driving an object's animator. Seeds the animator component. */
  setObjectAnimatorController: (objectId: string, controllerId?: string) => void;
  addAnimatorParameter: (controllerId: string, param: { name: string; type: AnimatorParameter['type']; source?: AnimatorParameter['source']; variableId?: string; defaultValue?: number | boolean }) => string | undefined;
  updateAnimatorParameter: (controllerId: string, paramId: string, patch: Partial<Omit<AnimatorParameter, 'id'>>) => void;
  removeAnimatorParameter: (controllerId: string, paramId: string) => void;
  addAnimatorState: (controllerId: string, state?: { name?: string; animationId?: string; speed?: number; loop?: boolean; position?: { x: number; y: number } }) => string | undefined;
  updateAnimatorState: (controllerId: string, stateId: string, patch: Partial<Omit<AnimatorState, 'id'>>) => void;
  removeAnimatorState: (controllerId: string, stateId: string) => void;
  addAnimatorTransition: (controllerId: string, transition: { from: string; to: string; conditions?: AnimatorCondition[]; duration?: number; hasExitTime?: boolean; exitTime?: number }) => string | undefined;
  updateAnimatorTransition: (controllerId: string, transitionId: string, patch: Partial<Omit<AnimatorTransition, 'id'>>) => void;
  removeAnimatorTransition: (controllerId: string, transitionId: string) => void;
  // --- Built-in character controller ---
  /** Enable/disable the character controller on an object (seeds defaults when first enabled). */
  toggleCharacterController: (id: string) => void;
  /** Patch an object's character controller. No-op if it has none. */
  updateCharacterController: (id: string, patch: Partial<CharacterControllerComponent>) => void;
  /** Attach an object to a character's bone socket (or pass undefined target to detach). */
  setAttachment: (objectId: string, attachment?: { targetObjectId: string; boneName: string; socketName?: string }) => void;
  /** Add a named socket (bone + offset) to a Skeleton asset. Returns the socket id. */
  addSkeletonSocket: (skeletonId: string, socket: { name?: string; boneName: string }) => string | undefined;
  updateSkeletonSocket: (skeletonId: string, socketId: string, patch: Partial<Omit<SkeletonSocket, 'id'>>) => void;
  removeSkeletonSocket: (skeletonId: string, socketId: string) => void;
  /**
   * One-click third-person pawn: from a rigged model asset, create an object that renders it, build a
   * locomotion Animator Controller (Idle/Walk/Jog/Jump from the skeleton's clips, matched by name) and
   * attach a character controller. Returns the new object's id, or undefined if the model isn't rigged.
   */
  createCharacterPawn: (modelAssetId: string, name?: string) => string | undefined;
  attachScript: (id: string, nextBlueprintId?: string) => void;
  detachScript: (id: string) => void;
  setActiveBlueprint: (id: string) => void;
  createBlueprint: () => void;
  createBlueprintNamed: (
    name?: string,
    description?: string,
    folderId?: string,
  ) => { blueprintId: string; graphId: string };
  openObjectScript: (objectId: string) => string | undefined;
  createFolder: (name?: string, parentId?: string) => string;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  moveToFolder: (kind: 'asset' | 'blueprint' | 'dataAsset' | 'material', id: string, folderId?: string) => void;
  renameBlueprint: (id: string, name: string) => void;
  deleteBlueprint: (id: string) => void;
  renameAsset: (id: string, name: string) => void;
  createVariable: (name?: string, type?: GraphValueType, persistent?: boolean) => string;
  updateVariable: (id: string, patch: Partial<Pick<ProjectVariable, 'name' | 'type' | 'defaultValue' | 'persistent'>>) => void;
  deleteVariable: (id: string) => void;
  createDataAsset: (name?: string, folderId?: string) => string;
  renameDataAsset: (id: string, name: string) => void;
  deleteDataAsset: (id: string) => void;
  addDataAssetColumn: (tableId: string, name?: string, type?: GraphValueType) => string;
  updateDataAssetColumn: (
    tableId: string,
    columnId: string,
    patch: Partial<Pick<DataAssetColumn, 'name' | 'type'>>,
  ) => void;
  deleteDataAssetColumn: (tableId: string, columnId: string) => void;
  addDataAssetRow: (tableId: string, key?: string) => string;
  updateDataAssetRow: (tableId: string, rowId: string, patch: Partial<Pick<DataAssetRow, 'key'>>) => void;
  deleteDataAssetRow: (tableId: string, rowId: string) => void;
  setDataAssetCell: (tableId: string, rowId: string, columnId: string, value: GraphValue) => void;
  createMaterial: (name?: string, description?: string, folderId?: string) => string;
  renameMaterial: (id: string, name: string) => void;
  updateMaterial: (id: string, patch: Partial<MaterialDefinition>) => void;
  deleteMaterial: (id: string) => void;
  setActiveMaterial: (id: string) => void;
  setObjectMaterial: (objectId: string, materialId?: string) => void;
  ensureMaterialGraph: (materialId: string) => void;
  addMaterialNode: (
    label: string,
    category: GraphNodeCategory,
    data?: Partial<NodeForgeNodeData>,
    position?: { x: number; y: number },
  ) => string;
  connectMaterialNodes: (sourceId: string, targetId: string, sourceHandle?: string, targetHandle?: string) => void;
  deleteMaterialNode: (nodeId: string) => void;
  onMaterialNodesChange: OnNodesChange<NodeForgeNode>;
  onMaterialEdgesChange: OnEdgesChange;
  onMaterialConnect: OnConnect;
  autoLayoutMaterialGraph: () => void;
  addGraphNodeToBlueprint: (
    blueprintId: string,
    label: string,
    category: GraphNodeCategory,
    data?: Partial<NodeForgeNodeData>,
    position?: { x: number; y: number },
  ) => string;
  connectGraphNodes: (
    blueprintId: string,
    sourceId: string,
    targetId: string,
    sourceHandle?: string,
    targetHandle?: string,
  ) => void;
  deleteGraphNode: (nodeId: string) => void;
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
  clearRuntimeSounds: () => void;
  clearRuntimeLog: () => void;
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
  folders: [],
  variables: starterVariables,
  dataAssets: starterDataAssets,
  materials: [],
  skeletons: [],
  skeletalMeshes: [],
  animations: [],
  animatorControllers: [],
  blueprints: starterBlueprints,
  graphs: [{ id: graphId, name: 'Player Controller', nodes: starterNodes, edges: starterEdges }],
  activeBlueprintId: blueprintId,
  activeMaterialId: '',
  activeAnimatorControllerId: '',
  isPlaying: false,
  runtimeVelocities: {},
  runtimeKeys: {},
  runtimePreviousKeys: {},
  runtimeEventQueue: [],
  runtimeVariableValues: {},
  runtimeAnimators: {},
  runtimeCameraOverrides: {},
  runtimeGrounded: [],
  runtimeRoll: {},
  runtimeAttack: {},
  runtimeCollisions: [],
  runtimeSoundQueue: [],
  runtimeLog: [],
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
  setCameraRigTarget: (id) => set({ cameraRigTarget: id }),
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
  setObjectModel: (id, modelAssetId) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== id) return object;
          // Assigning a model needs a renderer to hang it on; seed a default one if missing.
          const renderer = object.renderer ?? defaultRenderer('cube');
          return { ...object, renderer: { ...renderer, modelAssetId: modelAssetId || undefined } };
        }),
      ),
    ),
  setObjectMaterial: (objectId, materialId) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== objectId) return object;
          // Assigning a material needs a renderer to hang it on; seed a default one if missing.
          const renderer = object.renderer ?? defaultRenderer('cube');
          return { ...object, renderer: { ...renderer, materialId: materialId || undefined } };
        }),
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
  toggleAnimator: (id) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== id) return object;
          const current = object.animator ?? { enabled: false, speed: 1, loop: true };
          return { ...object, animator: { ...current, enabled: !current.enabled } };
        }),
      ),
    ),
  updateAnimator: (id, patch) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) =>
          object.id === id && object.animator ? { ...object, animator: { ...object.animator, ...patch } } : object,
        ),
      ),
    ),
  registerImportedModel: ({ assetId, assetName, folderId, inspection }) => {
    if (!inspection.skeleton) return undefined; // static model — nothing to split
    const baseName = assetName.replace(/\.(glb|gltf|fbx)$/i, '');
    const now = Date.now();
    let skeletalMeshId: string | undefined;

    set((state) => {
      // Reuse a skeleton with the same signature, else create one. This is what lets a second
      // character on the same rig share all of the first's animations.
      let skeleton = state.skeletons.find((item) => item.signature === inspection.skeleton!.signature);
      const skeletons = [...state.skeletons];
      if (!skeleton) {
        skeleton = {
          id: makeId('skeleton'),
          name: `${baseName} Skeleton`,
          sourceAssetId: assetId,
          boneNames: inspection.skeleton!.boneNames,
          signature: inspection.skeleton!.signature,
          rootBone: inspection.skeleton!.rootBone,
          folderId,
          createdAt: now,
        };
        skeletons.push(skeleton);
      }

      const skeletalMesh: SkeletalMeshAsset = {
        id: makeId('skmesh'),
        name: baseName,
        sourceAssetId: assetId,
        skeletonId: skeleton.id,
        folderId,
        createdAt: now,
      };
      skeletalMeshId = skeletalMesh.id;

      // Add only clips not already present for this skeleton (dedupe by name).
      const existingNames = new Set(
        state.animations.filter((anim) => anim.skeletonId === skeleton!.id).map((anim) => anim.clipName),
      );
      const newAnimations: AnimationAsset[] = inspection.clips
        .filter((clip) => clip.name && !existingNames.has(clip.name))
        .map((clip) => ({
          id: makeId('anim'),
          name: clip.name,
          sourceAssetId: assetId,
          clipName: clip.name,
          skeletonId: skeleton!.id,
          duration: clip.duration,
          loop: /(_loop|idle)$/i.test(clip.name),
          folderId,
          createdAt: now,
        }));

      return {
        skeletons,
        skeletalMeshes: [...state.skeletalMeshes, skeletalMesh],
        animations: [...state.animations, ...newAnimations],
        isDirty: true,
      };
    });

    return skeletalMeshId;
  },
  createAnimatorController: (name, skeletonId, folderId) => {
    const id = makeId('animctl');
    set((state) => ({
      animatorControllers: [
        ...state.animatorControllers,
        {
          id,
          name: name ?? `Animator ${state.animatorControllers.length + 1}`,
          skeletonId,
          parameters: [],
          states: [],
          defaultStateId: undefined,
          transitions: [],
          folderId,
          createdAt: Date.now(),
        },
      ],
      activeAnimatorControllerId: id,
      isDirty: true,
    }));
    return id;
  },
  updateAnimatorController: (id, patch) =>
    set((state) => ({
      animatorControllers: state.animatorControllers.map((controller) =>
        controller.id === id ? { ...controller, ...patch } : controller,
      ),
      isDirty: true,
    })),
  deleteAnimatorController: (id) =>
    set((state) => ({
      animatorControllers: state.animatorControllers.filter((controller) => controller.id !== id),
      activeAnimatorControllerId:
        state.activeAnimatorControllerId === id
          ? state.animatorControllers.find((controller) => controller.id !== id)?.id ?? ''
          : state.activeAnimatorControllerId,
      isDirty: true,
    })),
  setActiveAnimatorController: (id) => set({ activeAnimatorControllerId: id }),
  setObjectAnimatorController: (objectId, controllerId) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== objectId) return object;
          const animator = object.animator ?? defaultAnimator();
          return { ...object, animator: { ...animator, enabled: true, controllerId: controllerId || undefined } };
        }),
      ),
    ),
  addAnimatorParameter: (controllerId, param) => {
    const controller = get().animatorControllers.find((item) => item.id === controllerId);
    if (!controller) return undefined;
    const id = makeId('param');
    const defaultValue = param.defaultValue ?? (param.type === 'float' ? 0 : false);
    set((state) => ({
      animatorControllers: state.animatorControllers.map((item) =>
        item.id === controllerId
          ? {
              ...item,
              parameters: [
                ...item.parameters,
                { id, name: param.name, type: param.type, source: param.source ?? 'manual', variableId: param.variableId, defaultValue },
              ],
            }
          : item,
      ),
      isDirty: true,
    }));
    return id;
  },
  updateAnimatorParameter: (controllerId, paramId, patch) =>
    set((state) => ({
      animatorControllers: state.animatorControllers.map((item) =>
        item.id === controllerId
          ? { ...item, parameters: item.parameters.map((p) => (p.id === paramId ? { ...p, ...patch } : p)) }
          : item,
      ),
      isDirty: true,
    })),
  removeAnimatorParameter: (controllerId, paramId) =>
    set((state) => ({
      animatorControllers: state.animatorControllers.map((item) =>
        item.id === controllerId
          ? {
              ...item,
              parameters: item.parameters.filter((p) => p.id !== paramId),
              // Drop conditions that referenced the removed parameter.
              transitions: item.transitions.map((t) => ({ ...t, conditions: t.conditions.filter((c) => c.parameterId !== paramId) })),
            }
          : item,
      ),
      isDirty: true,
    })),
  addAnimatorState: (controllerId, stateInput) => {
    const controller = get().animatorControllers.find((item) => item.id === controllerId);
    if (!controller) return undefined;
    const id = makeId('state');
    set((state) => ({
      animatorControllers: state.animatorControllers.map((item) =>
        item.id === controllerId
          ? {
              ...item,
              states: [
                ...item.states,
                {
                  id,
                  name: stateInput?.name ?? `State ${item.states.length + 1}`,
                  animationId: stateInput?.animationId,
                  speed: stateInput?.speed ?? 1,
                  loop: stateInput?.loop ?? true,
                  // Stagger new states down a column so they don't stack on the graph canvas.
                  position: stateInput?.position ?? { x: 80, y: 40 + item.states.length * 90 },
                },
              ],
              // First state added becomes the default (entry) state.
              defaultStateId: item.defaultStateId ?? id,
            }
          : item,
      ),
      isDirty: true,
    }));
    return id;
  },
  updateAnimatorState: (controllerId, stateId, patch) =>
    set((state) => ({
      animatorControllers: state.animatorControllers.map((item) =>
        item.id === controllerId
          ? { ...item, states: item.states.map((s) => (s.id === stateId ? { ...s, ...patch } : s)) }
          : item,
      ),
      isDirty: true,
    })),
  removeAnimatorState: (controllerId, stateId) =>
    set((state) => ({
      animatorControllers: state.animatorControllers.map((item) =>
        item.id === controllerId
          ? {
              ...item,
              states: item.states.filter((s) => s.id !== stateId),
              defaultStateId: item.defaultStateId === stateId ? item.states.find((s) => s.id !== stateId)?.id : item.defaultStateId,
              // Drop transitions touching the removed state.
              transitions: item.transitions.filter((t) => t.from !== stateId && t.to !== stateId),
            }
          : item,
      ),
      isDirty: true,
    })),
  addAnimatorTransition: (controllerId, transition) => {
    const controller = get().animatorControllers.find((item) => item.id === controllerId);
    if (!controller) return undefined;
    const id = makeId('xition');
    set((state) => ({
      animatorControllers: state.animatorControllers.map((item) =>
        item.id === controllerId
          ? {
              ...item,
              transitions: [
                ...item.transitions,
                { id, from: transition.from, to: transition.to, conditions: transition.conditions ?? [], duration: transition.duration ?? 0.2, hasExitTime: transition.hasExitTime, exitTime: transition.exitTime },
              ],
            }
          : item,
      ),
      isDirty: true,
    }));
    return id;
  },
  updateAnimatorTransition: (controllerId, transitionId, patch) =>
    set((state) => ({
      animatorControllers: state.animatorControllers.map((item) =>
        item.id === controllerId
          ? { ...item, transitions: item.transitions.map((t) => (t.id === transitionId ? { ...t, ...patch } : t)) }
          : item,
      ),
      isDirty: true,
    })),
  removeAnimatorTransition: (controllerId, transitionId) =>
    set((state) => ({
      animatorControllers: state.animatorControllers.map((item) =>
        item.id === controllerId
          ? { ...item, transitions: item.transitions.filter((t) => t.id !== transitionId) }
          : item,
      ),
      isDirty: true,
    })),
  toggleCharacterController: (id) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== id) return object;
          const current = object.character ?? defaultCharacter();
          return { ...object, character: { ...current, enabled: !current.enabled } };
        }),
      ),
    ),
  updateCharacterController: (id, patch) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) =>
          object.id === id && object.character ? { ...object, character: { ...object.character, ...patch } } : object,
        ),
      ),
    ),
  setAttachment: (objectId, attachment) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== objectId) return object;
          const next = { ...object };
          if (attachment) next.attachment = attachment;
          else delete next.attachment;
          return next;
        }),
      ),
    ),
  addSkeletonSocket: (skeletonId, socket) => {
    const skeleton = get().skeletons.find((item) => item.id === skeletonId);
    if (!skeleton) return undefined;
    const id = makeId('socket');
    set((state) => ({
      skeletons: state.skeletons.map((item) =>
        item.id === skeletonId
          ? {
              ...item,
              sockets: [
                ...(item.sockets ?? []),
                { id, name: socket.name ?? `Socket ${(item.sockets?.length ?? 0) + 1}`, boneName: socket.boneName, position: [0, 0, 0], rotation: [0, 0, 0] },
              ],
            }
          : item,
      ),
      isDirty: true,
    }));
    return id;
  },
  updateSkeletonSocket: (skeletonId, socketId, patch) =>
    set((state) => ({
      skeletons: state.skeletons.map((item) =>
        item.id === skeletonId
          ? { ...item, sockets: (item.sockets ?? []).map((s) => (s.id === socketId ? { ...s, ...patch } : s)) }
          : item,
      ),
      isDirty: true,
    })),
  removeSkeletonSocket: (skeletonId, socketId) =>
    set((state) => ({
      skeletons: state.skeletons.map((item) =>
        item.id === skeletonId ? { ...item, sockets: (item.sockets ?? []).filter((s) => s.id !== socketId) } : item,
      ),
      isDirty: true,
    })),
  createCharacterPawn: (modelAssetId, name) => {
    const state = get();
    const mesh = state.skeletalMeshes.find((item) => item.sourceAssetId === modelAssetId);
    if (!mesh) return undefined; // not a rigged model
    const clips = state.animations.filter((anim) => anim.skeletonId === mesh.skeletonId);
    const pick = (...patterns: RegExp[]) => {
      for (const pattern of patterns) {
        const found = clips.find((clip) => pattern.test(clip.name));
        if (found) return found.id;
      }
      return undefined;
    };
    const idleId = pick(/idle.*loop/i, /^idle/i, /loop/i);
    const walkId = pick(/walk.*loop/i, /^walk/i);
    const runId = pick(/sprint.*loop/i, /jog.*loop/i, /run.*loop/i, /run/i);
    // Full jump sequence: take-off, airborne loop, landing. Falls back to a single jump clip.
    const jumpStartId = pick(/jump.*start/i, /jump.*up/i);
    const jumpLoopId = pick(/jump.*loop/i, /jump.*air/i, /^falling/i, /in.?air/i);
    const jumpLandId = pick(/jump.*land/i, /land/i);
    const jumpId = !jumpStartId && !jumpLoopId ? pick(/^jump$/i, /jump/i, /fall/i) : undefined;
    const crouchIdleId = pick(/crouch.*idle/i);
    const crouchWalkId = pick(/crouch.*(fwd|walk)/i, /crouch.*loop/i);
    // In-place roll (we drive the dash in code) — avoid the root-motion "_RM" variant.
    const rollId = pick(/^roll$/i, /^dodge/i, /roll_loop/i);
    const rollClip = state.animations.find((a) => a.id === rollId);
    const rollDuration = rollClip?.duration ?? 0.7;
    // Match the dash distance to the rig's root-motion roll (~5 units) so the slide aligns with the clip.
    const rollSpeed = Math.round((5 / Math.max(rollDuration, 0.2)) * 10) / 10;
    // Attack clips: a sword swing when armed, a punch when not (avoid the _RM root-motion variant).
    const swordAttackId = pick(/sword.*attack(?!.*rm)/i, /sword.*slash/i, /weapon.*attack/i);
    const punchId = pick(/punch.*cross/i, /punch.*jab/i, /punch/i, /attack(?!.*rm)/i, /kick/i);

    // Build states for whichever clips exist; the first becomes the default (entry) state.
    const speedParamId = makeId('param');
    const vspeedParamId = makeId('param');
    const crouchParamId = makeId('param');
    const groundedParamId = makeId('param');
    const rollParamId = makeId('param');
    const parameters: AnimatorParameter[] = [
      { id: speedParamId, name: 'Speed', type: 'float', source: 'speed', defaultValue: 0 },
      { id: vspeedParamId, name: 'VerticalSpeed', type: 'float', source: 'verticalSpeed', defaultValue: 0 },
      { id: crouchParamId, name: 'Crouching', type: 'bool', source: 'crouching', defaultValue: false },
      { id: groundedParamId, name: 'Grounded', type: 'bool', source: 'grounded', defaultValue: true },
      { id: rollParamId, name: 'Rolling', type: 'bool', source: 'rolling', defaultValue: false },
      { id: makeId('param'), name: 'Attacking', type: 'bool', source: 'attacking', defaultValue: false },
      { id: makeId('param'), name: 'WeaponEquipped', type: 'bool', source: 'weaponEquipped', defaultValue: false },
    ];
    const attackParamId = parameters[parameters.length - 2].id;
    const weaponParamId = parameters[parameters.length - 1].id;
    const states: AnimatorState[] = [];
    const stateId: Record<string, string> = {};
    const layout: Record<string, { x: number; y: number }> = {
      idle: { x: 60, y: 40 },
      walk: { x: 320, y: 40 },
      run: { x: 580, y: 40 },
      jumpStart: { x: 320, y: 220 },
      jumpLoop: { x: 540, y: 220 },
      jumpLand: { x: 760, y: 220 },
      jump: { x: 320, y: 220 },
      crouchIdle: { x: 60, y: 380 },
      crouchWalk: { x: 320, y: 380 },
      roll: { x: 580, y: 380 },
      punch: { x: 60, y: 540 },
      swordAttack: { x: 320, y: 540 },
    };
    const addState = (key: string, name: string, animationId: string | undefined, loop = true) => {
      if (!animationId) return;
      const id = makeId('state');
      stateId[key] = id;
      states.push({ id, name, animationId, speed: 1, loop, position: layout[key] ?? { x: 60, y: 40 + states.length * 90 } });
    };
    addState('idle', 'Idle', idleId);
    addState('walk', 'Walk', walkId);
    addState('run', 'Run', runId);
    addState('jumpStart', 'Jump Start', jumpStartId, false);
    addState('jumpLoop', 'Jump Loop', jumpLoopId, true);
    addState('jumpLand', 'Jump Land', jumpLandId, false);
    addState('jump', 'Jump', jumpId, false);
    addState('crouchIdle', 'Crouch Idle', crouchIdleId);
    addState('crouchWalk', 'Crouch Walk', crouchWalkId);
    addState('roll', 'Roll', rollId, false);
    addState('punch', 'Punch', punchId, false);
    addState('swordAttack', 'Sword Attack', swordAttackId, false);
    if (!states.length) return undefined; // no usable clips

    const C = (parameterId: string, op: AnimatorCondition['op'], value: number | boolean): AnimatorCondition => ({ parameterId, op, value });
    const transitions: AnimatorTransition[] = [];
    const link = (from: string, to: string, conditions: AnimatorCondition[], duration = 0.18) => {
      if (stateId[from] && stateId[to]) transitions.push({ id: makeId('xition'), from: stateId[from], to: stateId[to], conditions, duration });
    };
    const linkAny = (to: string, conditions: AnimatorCondition[], duration = 0.12) => {
      if (stateId[to]) transitions.push({ id: makeId('xition'), from: 'any', to: stateId[to], conditions, duration });
    };
    /** Transition that waits for the source clip to play to `exitTime` (one-shots like Jump Start/Land). */
    const linkExit = (from: string, to: string, conditions: AnimatorCondition[] = [], duration = 0.12, exitTime = 1) => {
      if (stateId[from] && stateId[to]) transitions.push({ id: makeId('xition'), from: stateId[from], to: stateId[to], conditions, duration, hasExitTime: true, exitTime });
    };

    // --- Jump (highest priority). Take off → airborne loop → land, detecting the ground via Grounded. ---
    const groundStates = ['idle', 'walk', 'run', 'crouchIdle', 'crouchWalk'];
    const airKey = stateId.jumpLoop ? 'jumpLoop' : stateId.jumpStart ? 'jumpStart' : undefined;
    if (stateId.jumpStart || stateId.jumpLoop) {
      // Take-off only from grounded states (not "any") so the airborne loop never bounces back to Start.
      const entry = stateId.jumpStart ? 'jumpStart' : 'jumpLoop';
      groundStates.forEach((from) => link(from, entry, [C(vspeedParamId, '>', 1)], 0.08));
      // Start clip plays out, then the airborne loop.
      // Blend to the airborne loop partway through the launch clip so it doesn't wait the full wind-up.
      if (stateId.jumpStart && stateId.jumpLoop) linkExit('jumpStart', 'jumpLoop', [], 0.12, 0.5);
      // Short hop: if we land while still in the start clip, recover instead of waiting.
      if (stateId.jumpStart) link('jumpStart', stateId.jumpLand ? 'jumpLand' : 'idle', [C(groundedParamId, '==', true)], 0.1);
      // Land when we touch ground again.
      if (stateId.jumpLand && airKey) link(airKey, 'jumpLand', [C(groundedParamId, '==', true)], 0.1);
      // Land clip plays out, then back to idle. If there's no land clip, return on grounded.
      if (stateId.jumpLand) linkExit('jumpLand', 'idle');
      else if (airKey) link(airKey, 'idle', [C(groundedParamId, '==', true)]);
    } else if (stateId.jump) {
      groundStates.forEach((from) => link(from, 'jump', [C(vspeedParamId, '>', 1)], 0.1));
      link('jump', 'idle', [C(groundedParamId, '==', true)]);
    }
    // --- Roll/dodge: enter from grounded states while Rolling, return to idle when it ends. ---
    if (stateId.roll) {
      groundStates.forEach((from) => link(from, 'roll', [C(rollParamId, '==', true)], 0.08));
      link('roll', 'idle', [C(rollParamId, '==', false)]);
    }
    // --- Attack: sword swing when a weapon is equipped, otherwise a punch; clip plays out, then idle. ---
    if (stateId.swordAttack) {
      groundStates.forEach((from) => link(from, 'swordAttack', [C(attackParamId, '==', true), C(weaponParamId, '==', true)], 0.08));
      linkExit('swordAttack', 'idle');
    }
    if (stateId.punch) {
      // Without a sword state, punch covers both; otherwise only when unarmed.
      const conds = stateId.swordAttack ? [C(attackParamId, '==', true), C(weaponParamId, '==', false)] : [C(attackParamId, '==', true)];
      groundStates.forEach((from) => link(from, 'punch', conds, 0.08));
      linkExit('punch', 'idle');
    }
    if (stateId.crouchIdle || stateId.crouchWalk) {
      linkAny('crouchWalk', [C(crouchParamId, '==', true), C(speedParamId, '>', 0.1)]);
      linkAny('crouchIdle', [C(crouchParamId, '==', true), C(speedParamId, '<', 0.1)]);
      link('crouchIdle', 'crouchWalk', [C(speedParamId, '>', 0.1)]);
      link('crouchWalk', 'crouchIdle', [C(speedParamId, '<', 0.1)]);
      link('crouchIdle', 'idle', [C(crouchParamId, '==', false)]);
      link('crouchWalk', 'walk', [C(crouchParamId, '==', false)]);
    }
    link('idle', 'walk', [C(speedParamId, '>', 0.1), C(crouchParamId, '==', false)]);
    link('walk', 'idle', [C(speedParamId, '<', 0.1), C(crouchParamId, '==', false)]);
    link('walk', 'run', [C(speedParamId, '>', 5), C(crouchParamId, '==', false)]);
    link('run', 'walk', [C(speedParamId, '<', 5)]);
    // Fallback when there's no walk clip: idle ↔ run directly.
    if (!stateId.walk) {
      link('idle', 'run', [C(speedParamId, '>', 0.1)]);
      link('run', 'idle', [C(speedParamId, '<', 0.1)]);
    }

    const controllerId = makeId('animctl');
    const defaultStateId = stateId.idle ?? states[0].id;
    const controller: AnimatorController = {
      id: controllerId,
      name: `${mesh.name} Locomotion`,
      skeletonId: mesh.skeletonId,
      parameters,
      states,
      defaultStateId,
      transitions,
      createdAt: Date.now(),
    };

    // Preset, fully-editable controller graph (Unreal Event-Graph style): Update → Move(Get Move Input),
    // and Space → Jump. The user opens this blueprint to change the logic; the animator reads the
    // resulting motion automatically. Having an enabled script puts the character in "scripted" mode.
    const graphId = makeId('graph');
    const blueprintId = makeId('bp');
    const node = (nodeId: string, label: string, category: GraphNodeCategory, x: number, y: number, extra: Partial<NodeForgeNodeData> = {}): NodeForgeNode => ({
      id: nodeId,
      type: 'nodeforge',
      position: { x, y },
      data: makeNodeData(label, category, extra),
    });
    const updateNodeId = makeId('node');
    const inputNodeId = makeId('node');
    const moveNodeId = makeId('node');
    const spaceNodeId = makeId('node');
    const jumpNodeId = makeId('node');
    const presetNodes: NodeForgeNode[] = [
      node(updateNodeId, 'Update', 'Events', 40, 60, { hasInput: false }),
      node(inputNodeId, 'Get Move Input', 'Runtime', 40, 200),
      node(moveNodeId, 'Move', 'Runtime', 360, 90),
      node(spaceNodeId, 'Key Down', 'Events', 40, 360, { keyCode: 'Space', hasInput: false }),
      node(jumpNodeId, 'Jump', 'Runtime', 360, 360),
    ];
    const execEdge = (source: string, target: string): Edge => ({
      id: makeId('edge'),
      source,
      target,
      sourceHandle: 'exec-out',
      targetHandle: 'exec-in',
      animated: true,
      type: 'smoothstep',
    });
    const valueEdge = (source: string, target: string, targetHandle: string): Edge => ({
      id: makeId('edge'),
      source,
      target,
      sourceHandle: 'value-out',
      targetHandle,
      type: 'smoothstep',
      style: { stroke: '#3DD0DC', strokeWidth: 2 },
    });
    const presetEdges: Edge[] = [
      execEdge(updateNodeId, moveNodeId),
      valueEdge(inputNodeId, moveNodeId, 'vector'),
      execEdge(spaceNodeId, jumpNodeId),
    ];
    const presetGraph: ProjectGraph = { id: graphId, name: `${mesh.name} Controller`, nodes: presetNodes, edges: presetEdges };
    const blueprint: ScriptBlueprint = {
      id: blueprintId,
      name: `${mesh.name} Controller`,
      description: 'Third-person character logic — edit these nodes to change movement, jump, abilities.',
      graphId,
      color: '#5b8cff',
      createdAt: Date.now(),
    };

    const objectId = makeId('obj');
    const pawn: SceneObject = {
      id: objectId,
      name: name ?? mesh.name,
      kind: 'cube',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      renderer: { ...defaultRenderer('cube'), modelAssetId },
      animator: { enabled: true, controllerId, speed: 1, loop: true },
      character: { ...defaultCharacter(), enabled: true, rollDuration, rollSpeed, jumpStrength: 6 },
      script: { blueprintId, graphId, enabled: true },
    };

    set((draft) => ({
      animatorControllers: [...draft.animatorControllers, controller],
      activeAnimatorControllerId: controllerId,
      blueprints: [...draft.blueprints, blueprint],
      graphs: [...draft.graphs, presetGraph],
      activeBlueprintId: blueprintId,
      ...mapActiveSceneObjects(draft, (objects) => [...objects, pawn]),
      selectedObjectId: objectId,
    }));
    return objectId;
  },
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
  createBlueprintNamed: (name, description, folderId) => {
    const newGraphId = makeId('graph');
    const newBlueprintId = makeId('blueprint');
    set((state) => {
      const blueprint: ScriptBlueprint = {
        id: newBlueprintId,
        name: name ?? `Blueprint ${state.blueprints.length + 1}`,
        description: description ?? 'Reusable Blueprint asset.',
        graphId: newGraphId,
        color: '#3DDC97',
        folderId,
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
  openObjectScript: (objectId) => {
    const object = selectActiveObjects(get()).find((item) => item.id === objectId);
    if (!object) return undefined;
    // Already scripted → just open that blueprint in the Scripting panel.
    if (object.script) {
      set({ activeBlueprintId: object.script.blueprintId, selectedObjectId: objectId, selectedGraphNodeId: undefined });
      return object.script.blueprintId;
    }
    // No script yet → create one for this object, attach it, and open it.
    const { blueprintId } = get().createBlueprintNamed(`${object.name} Script`, `Script for ${object.name}.`);
    get().attachScript(objectId, blueprintId);
    set({ selectedObjectId: objectId });
    return blueprintId;
  },
  createFolder: (name, parentId) => {
    const id = makeId('folder');
    set((state) => ({
      folders: [...state.folders, { id, name: name ?? 'New Folder', parentId }],
      isDirty: true,
    }));
    return id;
  },
  renameFolder: (id, name) =>
    set((state) => ({
      folders: state.folders.map((folder) => (folder.id === id ? { ...folder, name } : folder)),
      isDirty: true,
    })),
  deleteFolder: (id) =>
    set((state) => {
      const folder = state.folders.find((item) => item.id === id);
      if (!folder) return state;
      // Move direct children (sub-folders, assets, blueprints) up to this folder's parent — no recursive loss.
      const parentId = folder.parentId;
      return {
        folders: state.folders
          .filter((item) => item.id !== id)
          .map((item) => (item.parentId === id ? { ...item, parentId } : item)),
        assets: state.assets.map((asset) => (asset.folderId === id ? { ...asset, folderId: parentId } : asset)),
        dataAssets: state.dataAssets.map((asset) => (asset.folderId === id ? { ...asset, folderId: parentId } : asset)),
        materials: state.materials.map((material) =>
          material.folderId === id ? { ...material, folderId: parentId } : material,
        ),
        blueprints: state.blueprints.map((blueprint) =>
          blueprint.folderId === id ? { ...blueprint, folderId: parentId } : blueprint,
        ),
        isDirty: true,
      };
    }),
  moveToFolder: (kind, id, folderId) =>
    set((state) =>
      kind === 'asset'
        ? {
            assets: state.assets.map((asset) => (asset.id === id ? { ...asset, folderId } : asset)),
            isDirty: true,
          }
        : kind === 'dataAsset'
          ? {
              dataAssets: state.dataAssets.map((asset) => (asset.id === id ? { ...asset, folderId } : asset)),
              isDirty: true,
            }
        : kind === 'material'
          ? {
              materials: state.materials.map((material) => (material.id === id ? { ...material, folderId } : material)),
              isDirty: true,
            }
        : {
            blueprints: state.blueprints.map((blueprint) =>
              blueprint.id === id ? { ...blueprint, folderId } : blueprint,
            ),
            isDirty: true,
          },
    ),
  renameBlueprint: (id, name) =>
    set((state) => {
      const blueprint = state.blueprints.find((item) => item.id === id);
      return {
        blueprints: state.blueprints.map((item) => (item.id === id ? { ...item, name } : item)),
        graphs: state.graphs.map((graph) => (graph.id === blueprint?.graphId ? { ...graph, name } : graph)),
        isDirty: true,
      };
    }),
  deleteBlueprint: (id) =>
    set((state) => {
      const blueprint = state.blueprints.find((item) => item.id === id);
      if (!blueprint) return state;
      const remaining = state.blueprints.filter((item) => item.id !== id);
      return {
        blueprints: remaining,
        graphs: state.graphs.filter((graph) => graph.id !== blueprint.graphId),
        activeBlueprintId: state.activeBlueprintId === id ? remaining[0]?.id ?? '' : state.activeBlueprintId,
        // Detach this blueprint from any object in any scene that referenced it.
        scenes: state.scenes.map((scene) => ({
          ...scene,
          objects: scene.objects.map((object) =>
            object.script?.blueprintId === id ? { ...object, script: undefined } : object,
          ),
        })),
        isDirty: true,
      };
    }),
  renameAsset: (id, name) =>
    set((state) => ({
      assets: state.assets.map((asset) => (asset.id === id ? { ...asset, name } : asset)),
      isDirty: true,
    })),
  createVariable: (name, type = 'number', persistent = true) => {
    const id = makeId('var');
    set((state) => ({
      variables: [
        ...state.variables,
        {
          id,
          name: name ?? `Variable ${state.variables.length + 1}`,
          type,
          defaultValue: defaultValueForType(type),
          persistent,
          createdAt: Date.now(),
        },
      ],
      isDirty: true,
    }));
    return id;
  },
  updateVariable: (id, patch) =>
    set((state) => ({
      variables: state.variables.map((variable) => {
        if (variable.id !== id) return variable;
        const type = patch.type ?? variable.type;
        const defaultValue =
          patch.defaultValue !== undefined
            ? coerceGraphValue(patch.defaultValue, type)
            : patch.type
              ? coerceGraphValue(variable.defaultValue, type)
              : variable.defaultValue;
        return {
          ...variable,
          ...patch,
          type,
          defaultValue,
        };
      }),
      runtimeVariableValues:
        patch.defaultValue !== undefined || patch.type
          ? Object.fromEntries(
              Object.entries(state.runtimeVariableValues).map(([variableId, value]) => [
                variableId,
                variableId === id
                  ? coerceGraphValue(
                      patch.defaultValue ?? value,
                      patch.type ?? state.variables.find((variable) => variable.id === id)?.type ?? 'number',
                    )
                  : value,
              ]),
            )
          : state.runtimeVariableValues,
      isDirty: true,
    })),
  deleteVariable: (id) =>
    set((state) => ({
      variables: state.variables.filter((variable) => variable.id !== id),
      runtimeVariableValues: Object.fromEntries(
        Object.entries(state.runtimeVariableValues).filter(([variableId]) => variableId !== id),
      ),
      graphs: state.graphs.map((graph) => ({
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.data.variableId === id ? { ...node, data: { ...node.data, variableId: undefined } } : node,
        ),
      })),
      isDirty: true,
    })),
  createDataAsset: (name, folderId) => {
    const id = makeId('data');
    const columnId = makeId('col');
    const rowId = makeId('row');
    set((state) => ({
      dataAssets: [
        ...state.dataAssets,
        {
          id,
          name: name ?? `Data Asset ${state.dataAssets.length + 1}`,
          folderId,
          columns: [{ id: columnId, name: 'Value', type: 'string' }],
          rows: [{ id: rowId, key: 'row_1', values: { [columnId]: 'Text' } }],
          createdAt: Date.now(),
        },
      ],
      isDirty: true,
    }));
    return id;
  },
  renameDataAsset: (id, name) =>
    set((state) => ({
      dataAssets: state.dataAssets.map((table) => (table.id === id ? { ...table, name } : table)),
      isDirty: true,
    })),
  deleteDataAsset: (id) =>
    set((state) => ({
      dataAssets: state.dataAssets.filter((table) => table.id !== id),
      graphs: state.graphs.map((graph) => ({
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.data.tableId === id
            ? { ...node, data: normalizeNodeData({ ...node.data, tableId: undefined, rowKey: undefined, columnId: undefined }) }
            : node,
        ),
      })),
      isDirty: true,
    })),
  addDataAssetColumn: (tableId, name, type = 'string') => {
    const id = makeId('col');
    set((state) => ({
      dataAssets: state.dataAssets.map((table) =>
        table.id === tableId
          ? {
              ...table,
              columns: [...table.columns, { id, name: name ?? `Column ${table.columns.length + 1}`, type }],
              rows: table.rows.map((row) => ({
                ...row,
                values: { ...row.values, [id]: defaultValueForType(type) },
              })),
            }
          : table,
      ),
      isDirty: true,
    }));
    return id;
  },
  updateDataAssetColumn: (tableId, columnId, patch) =>
    set((state) => ({
      dataAssets: state.dataAssets.map((table) => {
        if (table.id !== tableId) return table;
        const current = table.columns.find((column) => column.id === columnId);
        const nextType = patch.type ?? current?.type ?? 'string';
        return {
          ...table,
          columns: table.columns.map((column) =>
            column.id === columnId ? { ...column, ...patch, type: nextType } : column,
          ),
          rows: table.rows.map((row) => ({
            ...row,
            values:
              patch.type && current
                ? { ...row.values, [columnId]: coerceGraphValue(row.values[columnId], nextType) }
                : row.values,
          })),
        };
      }),
      isDirty: true,
    })),
  deleteDataAssetColumn: (tableId, columnId) =>
    set((state) => ({
      dataAssets: state.dataAssets.map((table) =>
        table.id === tableId
          ? {
              ...table,
              columns: table.columns.filter((column) => column.id !== columnId),
              rows: table.rows.map((row) => {
                const { [columnId]: _deleted, ...values } = row.values;
                return { ...row, values };
              }),
            }
          : table,
      ),
      graphs: state.graphs.map((graph) => ({
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.data.tableId === tableId && node.data.columnId === columnId
            ? { ...node, data: normalizeNodeData({ ...node.data, columnId: undefined }) }
            : node,
        ),
      })),
      isDirty: true,
    })),
  addDataAssetRow: (tableId, key) => {
    const id = makeId('row');
    set((state) => ({
      dataAssets: state.dataAssets.map((table) =>
        table.id === tableId
          ? {
              ...table,
              rows: [
                ...table.rows,
                {
                  id,
                  key: key ?? `row_${table.rows.length + 1}`,
                  values: Object.fromEntries(
                    table.columns.map((column) => [column.id, defaultValueForType(column.type)]),
                  ) as Record<string, GraphValue>,
                },
              ],
            }
          : table,
      ),
      isDirty: true,
    }));
    return id;
  },
  updateDataAssetRow: (tableId, rowId, patch) =>
    set((state) => ({
      dataAssets: state.dataAssets.map((table) =>
        table.id === tableId
          ? { ...table, rows: table.rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)) }
          : table,
      ),
      isDirty: true,
    })),
  deleteDataAssetRow: (tableId, rowId) =>
    set((state) => ({
      dataAssets: state.dataAssets.map((table) =>
        table.id === tableId ? { ...table, rows: table.rows.filter((row) => row.id !== rowId) } : table,
      ),
      isDirty: true,
    })),
  setDataAssetCell: (tableId, rowId, columnId, value) =>
    set((state) => ({
      dataAssets: state.dataAssets.map((table) => {
        if (table.id !== tableId) return table;
        const column = table.columns.find((item) => item.id === columnId);
        if (!column) return table;
        return {
          ...table,
          rows: table.rows.map((row) =>
            row.id === rowId
              ? { ...row, values: { ...row.values, [columnId]: coerceGraphValue(value, column.type) } }
              : row,
          ),
        };
      }),
      isDirty: true,
    })),
  createMaterial: (name, description, folderId) => {
    const id = makeId('material');
    const graphId = makeId('graph');
    set((state) => {
      const materialName = name ?? `Material ${state.materials.length + 1}`;
      return {
        materials: [
          ...state.materials,
          {
            id,
            name: materialName,
            description: description ?? 'Reusable material asset.',
            color: '#B4BCCC',
            metalness: 0.1,
            roughness: 0.65,
            emissiveColor: '#000000',
            emissiveIntensity: 0,
            graphId,
            folderId,
            createdAt: Date.now(),
          },
        ],
        graphs: [...state.graphs, makeMaterialGraph(graphId, materialName)],
        activeMaterialId: id,
        isDirty: true,
      };
    });
    return id;
  },
  renameMaterial: (id, name) =>
    set((state) => ({
      materials: state.materials.map((material) => (material.id === id ? { ...material, name } : material)),
      isDirty: true,
    })),
  updateMaterial: (id, patch) =>
    set((state) => ({
      materials: state.materials.map((material) => (material.id === id ? { ...material, ...patch } : material)),
      isDirty: true,
    })),
  deleteMaterial: (id) =>
    set((state) => {
      const material = state.materials.find((item) => item.id === id);
      return {
        materials: state.materials.filter((item) => item.id !== id),
        // Drop the material's paired graph too (mirrors deleteBlueprint).
        graphs: material?.graphId ? state.graphs.filter((graph) => graph.id !== material.graphId) : state.graphs,
        activeMaterialId:
          state.activeMaterialId === id ? state.materials.find((m) => m.id !== id)?.id ?? '' : state.activeMaterialId,
        // Clear dangling references so no object points at a removed material.
        scenes: state.scenes.map((scene) => ({
          ...scene,
          objects: scene.objects.map((object) =>
            object.renderer?.materialId === id
              ? { ...object, renderer: { ...object.renderer, materialId: undefined } }
              : object,
          ),
        })),
        isDirty: true,
      };
    }),
  setActiveMaterial: (id) => set({ activeMaterialId: id }),
  ensureMaterialGraph: (materialId) => {
    const state = get();
    const material = state.materials.find((item) => item.id === materialId);
    if (!material || (material.graphId && state.graphs.some((graph) => graph.id === material.graphId))) return;
    const graphId = material.graphId ?? makeId('graph');
    set((current) => ({
      materials: current.materials.map((item) => (item.id === materialId ? { ...item, graphId } : item)),
      graphs: [...current.graphs, makeMaterialGraph(graphId, material.name)],
      isDirty: true,
    }));
  },
  addMaterialNode: (label, category, data, position) => {
    const nodeId = makeId('node');
    set((state) => {
      const material = state.materials.find((item) => item.id === state.activeMaterialId);
      if (!material?.graphId) return state;
      return {
        graphs: mapGraphById(state.graphs, material.graphId, (graph) => {
          const offset = graph.nodes.length * 38;
          const node: NodeForgeNode = {
            id: nodeId,
            type: 'nodeforge',
            position: position ?? { x: 80 + (offset % 320), y: 80 + Math.floor(offset / 320) * 112 },
            data: makeNodeData(label, category, data),
          };
          return { ...graph, nodes: [...graph.nodes, node] };
        }),
        selectedGraphNodeId: nodeId,
        isDirty: true,
      };
    });
    return nodeId;
  },
  connectMaterialNodes: (sourceId, targetId, sourceHandle, targetHandle) =>
    set((state) => {
      const material = state.materials.find((item) => item.id === state.activeMaterialId);
      if (!material?.graphId) return state;
      return {
        graphs: mapGraphById(state.graphs, material.graphId, (graph) => ({
          ...graph,
          edges: addEdge(
            {
              id: makeId('edge'),
              source: sourceId,
              target: targetId,
              sourceHandle: sourceHandle ?? 'value-out',
              targetHandle,
              animated: false,
              type: 'smoothstep',
              style: { stroke: '#3DD0DC', strokeWidth: 2 },
            },
            graph.edges,
          ),
        })),
        isDirty: true,
      };
    }),
  deleteMaterialNode: (nodeId) =>
    set((state) => {
      const material = state.materials.find((item) => item.id === state.activeMaterialId);
      if (!material?.graphId) return state;
      return {
        graphs: mapGraphById(state.graphs, material.graphId, (graph) => ({
          ...graph,
          // The Material Output sink is permanent — keep it even if asked to delete.
          nodes: graph.nodes.filter((node) => node.id !== nodeId || node.data.nodeKind === 'material.output'),
          edges: graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
        })),
        selectedGraphNodeId: state.selectedGraphNodeId === nodeId ? undefined : state.selectedGraphNodeId,
        isDirty: true,
      };
    }),
  onMaterialNodesChange: (changes) =>
    set((state) => {
      const material = state.materials.find((item) => item.id === state.activeMaterialId);
      if (!material?.graphId) return state;
      const dirtied = changes.some((change) => change.type !== 'select' && change.type !== 'dimensions');
      return {
        graphs: mapGraphById(state.graphs, material.graphId, (graph) => ({
          ...graph,
          nodes: applyNodeChanges(changes, graph.nodes),
        })),
        ...(dirtied ? { isDirty: true } : {}),
      };
    }),
  onMaterialEdgesChange: (changes) =>
    set((state) => {
      const material = state.materials.find((item) => item.id === state.activeMaterialId);
      if (!material?.graphId) return state;
      const dirtied = changes.some((change) => change.type !== 'select');
      return {
        graphs: mapGraphById(state.graphs, material.graphId, (graph) => ({
          ...graph,
          edges: applyEdgeChanges(changes, graph.edges),
        })),
        ...(dirtied ? { isDirty: true } : {}),
      };
    }),
  onMaterialConnect: (connection) =>
    set((state) => {
      const material = state.materials.find((item) => item.id === state.activeMaterialId);
      if (!material?.graphId) return state;
      return {
        graphs: mapGraphById(state.graphs, material.graphId, (graph) => ({
          ...graph,
          edges: addEdge(
            { ...connection, animated: false, type: 'smoothstep', style: { stroke: '#3DD0DC', strokeWidth: 2 } },
            graph.edges,
          ),
        })),
        isDirty: true,
      };
    }),
  autoLayoutMaterialGraph: () =>
    set((state) => {
      const material = state.materials.find((item) => item.id === state.activeMaterialId);
      if (!material?.graphId) return state;
      return {
        graphs: mapGraphById(state.graphs, material.graphId, (graph) => ({
          ...graph,
          nodes: layoutGraphNodes(graph.nodes, graph.edges),
        })),
        isDirty: true,
      };
    }),
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
            data: makeNodeData(label, category, seedNodeDataFromProject(label, data, state.variables, state.dataAssets)),
          };
          return { ...graph, nodes: [...graph.nodes, node] };
        }),
        isDirty: true,
      };
    });
    return nodeId;
  },
  connectGraphNodes: (blueprintId, sourceId, targetId, sourceHandle, targetHandle) =>
    set((state) => {
      const blueprint = state.blueprints.find((item) => item.id === blueprintId);
      if (!blueprint) return state;
      const isValueEdge = Boolean(targetHandle && targetHandle !== 'exec-in');
      return {
        graphs: state.graphs.map((graph) =>
          graph.id === blueprint.graphId
            ? {
                ...graph,
                edges: addEdge(
                  {
                    id: makeId('edge'),
                    source: sourceId,
                    target: targetId,
                    sourceHandle,
                    targetHandle,
                    animated: !isValueEdge,
                    type: 'smoothstep',
                    style: isValueEdge ? { stroke: '#3DD0DC', strokeWidth: 2 } : undefined,
                  },
                  graph.edges,
                ),
              }
            : graph,
        ),
        isDirty: true,
      };
    }),
  deleteGraphNode: (nodeId) =>
    set((state) => {
      const blueprint = state.blueprints.find((item) => item.id === state.activeBlueprintId);
      if (!blueprint) return state;
      return {
        graphs: state.graphs.map((graph) =>
          graph.id === blueprint.graphId
            ? {
                ...graph,
                nodes: graph.nodes.filter((node) => node.id !== nodeId),
                edges: graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
              }
            : graph,
        ),
        selectedGraphNodeId: state.selectedGraphNodeId === nodeId ? undefined : state.selectedGraphNodeId,
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
    set((state) => ({
      // Find the node in whichever graph holds it (blueprint OR material graph).
      graphs: state.graphs.map((graph) =>
        graph.nodes.some((node) => node.id === id)
          ? {
              ...graph,
              nodes: graph.nodes.map((node) =>
                node.id === id ? { ...node, data: normalizeNodeData({ ...node.data, ...patch }) } : node,
              ),
            }
          : graph,
      ),
      isDirty: true,
    })),
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
      // Only blob: URLs need revoking; data:/asset:/empty are no-ops but harmless.
      if (asset?.url?.startsWith('blob:')) URL.revokeObjectURL(asset.url);
      return {
        assets: state.assets.filter((item) => item.id !== id),
        // Clear any dangling references so the engine never points at a removed asset.
        scenes: state.scenes.map((scene) => ({
          ...scene,
          objects: scene.objects.map((object) => {
            const renderer = object.renderer;
            if (!renderer || (renderer.modelAssetId !== id && renderer.textureAssetId !== id)) return object;
            return {
              ...object,
              renderer: {
                ...renderer,
                modelAssetId: renderer.modelAssetId === id ? undefined : renderer.modelAssetId,
                textureAssetId: renderer.textureAssetId === id ? undefined : renderer.textureAssetId,
              },
            };
          }),
        })),
        // Materials may reference this asset as a base-color or normal map.
        materials: state.materials.map((material) =>
          material.textureAssetId === id || material.normalMapAssetId === id
            ? {
                ...material,
                textureAssetId: material.textureAssetId === id ? undefined : material.textureAssetId,
                normalMapAssetId: material.normalMapAssetId === id ? undefined : material.normalMapAssetId,
              }
            : material,
        ),
        graphs: state.graphs.map((graph) => ({
          ...graph,
          nodes: graph.nodes.map((node) =>
            node.data.assetId === id ? { ...node, data: { ...node.data, assetId: undefined } } : node,
          ),
        })),
        isDirty: true,
      };
    }),
  setPlaying: (isPlaying) =>
    set((state) => {
      if (isPlaying === state.isPlaying) return state;
      if (isPlaying) {
        const objects = selectActiveObjects(state);
        // Spin up a fresh Rapier world to own the simulation for this play session.
        startPhysics();
        return {
          isPlaying,
          runtimeTime: 0,
          runtimeVelocities: makeRuntimeVelocityMap(objects),
          runtimeKeys: {},
          runtimePreviousKeys: {},
          runtimeEventQueue: [],
          runtimeVariableValues: makeRuntimeVariableMap(state.variables),
          runtimeAnimators: {},
          runtimeCameraOverrides: {},
          runtimeGrounded: [],
          runtimeRoll: {},
          runtimeAttack: {},
          runtimeCollisions: [],
          runtimeSoundQueue: [],
          runtimeLog: [],
          runtimeStarted: false,
          playSnapshot: {
            sceneId: state.activeSceneId,
            transforms: Object.fromEntries(objects.map((object) => [object.id, structuredClone(object.transform)])),
            // Snapshot renderers too so runtime material overrides ("Set Material" nodes) revert on Stop.
            renderers: Object.fromEntries(
              objects.map((object) => [object.id, object.renderer ? structuredClone(object.renderer) : undefined]),
            ),
          },
        };
      }

      // Restore the snapshot into the scene it was taken from (does NOT mark dirty).
      // Objects with no snapshot entry were spawned at runtime (action.spawnObject) — drop them.
      const snapshot = state.playSnapshot;
      const scenes = snapshot
        ? state.scenes.map((scene) =>
            scene.id === snapshot.sceneId
              ? {
                  ...scene,
                  objects: scene.objects
                    .filter((object) => snapshot.transforms[object.id])
                    .map((object) => ({
                      ...object,
                      transform: snapshot.transforms[object.id],
                      renderer: snapshot.renderers[object.id] ?? object.renderer,
                    })),
                }
              : scene,
          )
        : state.scenes;

      // Tear the physics world down so the next play session starts clean.
      stopPhysics();
      return {
        isPlaying,
        runtimeTime: 0,
        runtimeVelocities: {},
        runtimeKeys: {},
        runtimePreviousKeys: {},
        runtimeEventQueue: [],
        runtimeVariableValues: {},
        runtimeAnimators: {},
        runtimeCameraOverrides: {},
        runtimeGrounded: [],
        runtimeRoll: {},
        runtimeAttack: {},
        runtimeCollisions: [],
        runtimeSoundQueue: [],
        runtimeLog: [],
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
  clearRuntimeSounds: () =>
    set((state) => (state.runtimeSoundQueue.length ? { runtimeSoundQueue: [] } : state)),
  clearRuntimeLog: () => set((state) => (state.runtimeLog.length ? { runtimeLog: [] } : state)),
  tickRuntime: (delta) =>
    set((state) => {
      if (!state.isPlaying) return state;
      const activeObjects = selectActiveObjects(state);
      const graphRuntimes = new Map(
        state.graphs.map((graph) => [graph.id, { graph, ...buildGraphRuntime(graph) }]),
      );
      const runtimeTime = state.runtimeTime + delta;
      const nextVelocities = { ...state.runtimeVelocities };
      const nextVariableValues = { ...state.runtimeVariableValues };
      const firedEvents = new Set(state.runtimeEventQueue.map((eventName) => eventName.toLowerCase()));
      const currentKeys = state.runtimeKeys;
      const previousKeys = state.runtimePreviousKeys;
      // Contacts detected by the previous physics step fire event.collisionEnter this frame.
      const collidedObjects = new Set(state.runtimeCollisions);
      // Transforms at the start of the tick — the diff after scripts run is the motion a
      // script applied, which the physics world turns into body inputs (velocity/teleport).
      const prevTransforms = new Map(
        activeObjects.map((object) => [
          object.id,
          { position: object.transform.position, rotation: object.transform.rotation },
        ]),
      );
      // Impulses requested by action.applyForce this frame, applied to bodies post-step.
      const physicsImpulses: Record<string, Vector3Tuple> = {};
      // Side effects collected while executing graphs this frame.
      const sounds: string[] = [];
      const spawned: SceneObject[] = [];
      const prints: string[] = [];
      // Animator parameter writes requested by animator.setX nodes this frame, keyed by object id.
      const animatorWrites: Record<string, Array<{ name: string; value: number | boolean; trigger?: boolean }>> = {};
      // Character node requests this frame: object ids that fired a Jump node, and live camera overrides.
      const characterJumpRequests = new Set<string>();
      const nextCameraOverrides: Record<string, { distance: number; height: number }> = { ...state.runtimeCameraOverrides };
      // Roll/dodge + attack timers carried frame-to-frame (started on their key, counted down here).
      const nextRoll: Record<string, number> = {};
      const nextAttack: Record<string, number> = {};

      // Run each object's script graph. Physics-enabled objects are simulated by Rapier
      // in the post-pass below, so here we only collect scripted motion + side effects.
      const mappedObjects = activeObjects.map((object) => {
          const position = [...object.transform.position] as Vector3Tuple;
          const rotation = [...object.transform.rotation] as Vector3Tuple;
          const scale = [...object.transform.scale] as Vector3Tuple;
          let changed = false;
          // Per-object material overrides (Unreal-MID style) written by "Set Material" nodes — never the shared definition.
          let nextRenderer = object.renderer;

          if (!object.script?.enabled) {
            return changed ? { ...object, transform: { position, rotation, scale } } : object;
          }

          const graphRuntime = graphRuntimes.get(object.script.graphId);
          if (!graphRuntime) {
            return changed ? { ...object, transform: { position, rotation, scale } } : object;
          }
          const runtime = graphRuntime;

          function literalValueForType(data: NodeForgeNodeData, type: GraphValueType): GraphValue {
            if (type === 'number') return Number(data.numberValue ?? data.amount ?? 0);
            if (type === 'string') return data.stringValue ?? data.message ?? '';
            if (type === 'boolean') return Boolean(data.booleanValue);
            return data.vectorValue ?? [0, 0, 0];
          }

          function valueInput(node: NodeForgeNode, handle: string, fallback?: GraphValue): GraphValue | undefined {
            const edge = (runtime.incomingValues.get(node.id) ?? []).find((item) => item.targetHandle === handle);
            return edge ? evaluateValue(edge.source, new Set([node.id])) : fallback;
          }

          function evaluateValue(nodeId: string, visited: Set<string>): GraphValue | undefined {
            if (visited.has(nodeId)) return undefined;
            visited.add(nodeId);
            const node = runtime.nodesById.get(nodeId);
            if (!node) return undefined;

            if (node.data.nodeKind === 'value.number') return Number(node.data.numberValue ?? 0);
            if (node.data.nodeKind === 'value.string') return node.data.stringValue ?? '';
            if (node.data.nodeKind === 'value.boolean') return Boolean(node.data.booleanValue);
            if (node.data.nodeKind === 'value.vector3') return node.data.vectorValue ?? [0, 0, 0];

            if (node.data.nodeKind === 'input.move') {
              // Move direction from the character's key bindings (falls back to WASD), normalized.
              // Camera-relative when the character uses mouse-look so "forward" follows the view.
              const cc = object.character;
              const fwd = cc?.keyForward ?? 'KeyW';
              const back = cc?.keyBackward ?? 'KeyS';
              const left = cc?.keyLeft ?? 'KeyA';
              const right = cc?.keyRight ?? 'KeyD';
              let ix = 0;
              let iz = 0;
              if (currentKeys[fwd] || currentKeys.ArrowUp) iz += 1;
              if (currentKeys[back] || currentKeys.ArrowDown) iz -= 1;
              if (currentKeys[left] || currentKeys.ArrowLeft) ix += 1;
              if (currentKeys[right] || currentKeys.ArrowRight) ix -= 1;
              const length = Math.hypot(ix, iz);
              if (length === 0) return [0, 0, 0] as Vector3Tuple;
              let dirX = ix / length;
              let dirZ = iz / length;
              if (cc?.cameraRelativeMovement && cc.mouseLook) {
                const yaw = mouseCameraYaw(cc.mouseSensitivity);
                const cos = Math.cos(yaw);
                const sin = Math.sin(yaw);
                [dirX, dirZ] = [dirX * cos + dirZ * sin, -dirX * sin + dirZ * cos];
              }
              return [dirX, 0, dirZ] as Vector3Tuple;
            }

            if (node.data.nodeKind === 'query.grounded') {
              return position[1] <= (object.character?.groundLevel ?? 0) + 0.05;
            }

            if (node.data.nodeKind === 'animator.getParam') {
              // Read the live animator parameter (previous frame) so the blueprint can react to it.
              const controller = state.animatorControllers.find((c) => c.id === object.animator?.controllerId);
              const param = controller?.parameters.find((p) => p.name === node.data.paramName);
              const live = state.runtimeAnimators[object.id];
              if (param) return (live?.params[param.id] ?? param.defaultValue) as GraphValue;
              return 0;
            }

            if (node.data.nodeKind === 'animator.getState') {
              const controller = state.animatorControllers.find((c) => c.id === object.animator?.controllerId);
              const stateId = state.runtimeAnimators[object.id]?.stateId ?? controller?.defaultStateId;
              return controller?.states.find((s) => s.id === stateId)?.name ?? '';
            }

            if (node.data.nodeKind === 'variable.get') {
              const variable = state.variables.find((item) => item.id === node.data.variableId);
              if (!variable) return undefined;
              return cloneGraphValue(nextVariableValues[variable.id] ?? variable.defaultValue);
            }

            if (node.data.nodeKind === 'data.tableGet') {
              const table = state.dataAssets.find((item) => item.id === node.data.tableId);
              const column = table?.columns.find((item) => item.id === node.data.columnId);
              const rowKey = graphValueToString(valueInput(node, 'rowKey', node.data.rowKey ?? ''));
              const row = table?.rows.find((item) => item.key === rowKey);
              return column && row ? cloneGraphValue(row.values[column.id] ?? defaultValueForType(column.type)) : undefined;
            }

            if (node.data.nodeKind === 'math.add') {
              return toNumber(valueInput(node, 'a', Number(node.data.numberValue ?? 0))) + toNumber(valueInput(node, 'b', Number(node.data.amount ?? 0)));
            }

            if (node.data.nodeKind === 'math.clamp') {
              const value = toNumber(valueInput(node, 'value', Number(node.data.numberValue ?? 0)));
              const min = toNumber(valueInput(node, 'min', 0));
              const max = toNumber(valueInput(node, 'max', Number(node.data.amount ?? 1)));
              return Math.min(Math.max(value, min), max);
            }

            if (node.data.nodeKind === 'math.lerp') {
              const a = toNumber(valueInput(node, 'a', 0));
              const b = toNumber(valueInput(node, 'b', Number(node.data.amount ?? 1)));
              const t = Math.min(Math.max(toNumber(valueInput(node, 't', Number(node.data.numberValue ?? 0.5))), 0), 1);
              return a + (b - a) * t;
            }

            if (node.data.nodeKind === 'logic.compare') {
              return compareValues(valueInput(node, 'a', 0), valueInput(node, 'b', Number(node.data.numberValue ?? 0)), node.data.compareOp ?? '==');
            }

            if (node.data.nodeKind === 'logic.and') {
              return toBoolean(valueInput(node, 'a', false)) && toBoolean(valueInput(node, 'b', false));
            }

            if (node.data.nodeKind === 'logic.or') {
              return toBoolean(valueInput(node, 'a', false)) || toBoolean(valueInput(node, 'b', false));
            }

            // Read this object's CURRENT effective material (base + graph + overrides written so far this frame).
            if (node.data.nodeKind === 'action.getMaterialColor') {
              return resolveMaterial(nextRenderer, state.materials, state.graphs).color;
            }

            if (node.data.nodeKind === 'action.getMaterialProperty') {
              const current = resolveMaterial(nextRenderer, state.materials, state.graphs);
              return current[node.data.materialProperty ?? 'metalness'];
            }

            return undefined;
          }

          function executeFrom(nodeId: string, visited: Set<string>) {
            if (visited.has(nodeId)) return;
            visited.add(nodeId);
            const node = runtime.nodesById.get(nodeId);
            if (!node) return;

            const shouldContinue = applyAction(node, visited);
            if (shouldContinue !== false) {
              (runtime.outgoing.get(nodeId) ?? []).forEach((targetId) => executeFrom(targetId, visited));
            }
          }

          function applyAction(node: NodeForgeNode, visited: Set<string>): boolean {
            if (node.data.nodeKind === 'logic.branch') {
              return toBoolean(valueInput(node, 'condition', node.data.booleanValue ?? true));
            }

            if (node.data.nodeKind === 'action.translate') {
              const vector = valueInput(node, 'vector');
              if (Array.isArray(vector)) {
                position[0] += vector[0] * delta;
                position[1] += vector[1] * delta;
                position[2] += vector[2] * delta;
              } else {
                position[axisIndex(node.data.axis)] += toNumber(valueInput(node, 'amount', Number(node.data.amount ?? -3.6))) * delta;
              }
              changed = true;
            }

            if (node.data.nodeKind === 'action.rotate') {
              rotation[axisIndex(node.data.axis)] +=
                (toNumber(valueInput(node, 'amount', Number(node.data.amount ?? 90))) * Math.PI * delta) / 180;
              changed = true;
            }

            if (node.data.nodeKind === 'action.applyForce' && object.physics?.enabled && object.physics.bodyType === 'dynamic') {
              const forceVector = valueInput(node, 'vector');
              const amount = toNumber(valueInput(node, 'amount', Number(node.data.amount ?? 8)));
              const force = Array.isArray(forceVector)
                ? forceVector
                : ([0, 0, 0].map((value, index) => (index === axisIndex(node.data.axis) ? amount : value)) as Vector3Tuple);
              // Accumulate as an impulse (force over the frame); Rapier divides by mass on apply.
              const accrued = physicsImpulses[object.id] ?? [0, 0, 0];
              physicsImpulses[object.id] = [
                accrued[0] + force[0] * delta,
                accrued[1] + force[1] * delta,
                accrued[2] + force[2] * delta,
              ];
            }

            if (node.data.nodeKind === 'variable.set') {
              const variable = state.variables.find((item) => item.id === node.data.variableId);
              if (variable) {
                nextVariableValues[variable.id] = coerceGraphValue(
                  valueInput(node, 'value', literalValueForType(node.data, variable.type)),
                  variable.type,
                );
              }
            }

            if (node.data.nodeKind === 'save.write') {
              const saved = Object.fromEntries(
                state.variables
                  .filter((variable) => variable.persistent)
                  .map((variable) => [
                    variable.id,
                    coerceGraphValue(nextVariableValues[variable.id] ?? variable.defaultValue, variable.type),
                  ]),
              ) as Record<string, GraphValue>;
              writeSaveSlot(node.data.saveSlot ?? 'slot1', saved);
              prints.push(`${object.name}: Saved ${Object.keys(saved).length} variables`);
            }

            if (node.data.nodeKind === 'save.load') {
              const saved = readSaveSlot(node.data.saveSlot ?? 'slot1');
              if (saved) {
                state.variables
                  .filter((variable) => variable.persistent && saved[variable.id] !== undefined)
                  .forEach((variable) => {
                    nextVariableValues[variable.id] = coerceGraphValue(saved[variable.id], variable.type);
                  });
                prints.push(`${object.name}: Loaded save slot ${node.data.saveSlot ?? 'slot1'}`);
              } else {
                prints.push(`${object.name}: No save data in ${node.data.saveSlot ?? 'slot1'}`);
              }
            }

            if (node.data.nodeKind === 'save.clear') {
              clearSaveSlot(node.data.saveSlot ?? 'slot1');
              prints.push(`${object.name}: Cleared save slot ${node.data.saveSlot ?? 'slot1'}`);
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

            if (node.data.nodeKind === 'action.playSound' && node.data.assetId) {
              sounds.push(node.data.assetId);
            }

            if (node.data.nodeKind === 'action.spawnObject') {
              spawned.push(makeSpawnedObject(node.data.spawnKind ?? 'cube', position));
            }

            if (node.data.nodeKind === 'action.setMaterialColor') {
              if (nextRenderer) {
                const color = graphValueToString(valueInput(node, 'color', node.data.materialColor ?? '#ffffff'));
                // Write either the base color or the emissive color, depending on the node's target.
                const channel = node.data.materialColorTarget === 'emissive' ? 'emissiveColor' : 'color';
                nextRenderer = {
                  ...nextRenderer,
                  materialOverrides: { ...nextRenderer.materialOverrides, [channel]: color },
                };
                changed = true;
              }
            }

            if (node.data.nodeKind === 'action.setMaterialProperty') {
              if (nextRenderer) {
                const property = node.data.materialProperty ?? 'metalness';
                const value = toNumber(valueInput(node, 'value', Number(node.data.numberValue ?? 0)));
                nextRenderer = {
                  ...nextRenderer,
                  materialOverrides: { ...nextRenderer.materialOverrides, [property]: value },
                };
                changed = true;
              }
            }

            if (node.data.nodeKind === 'action.print') {
              prints.push(`${object.name}: ${graphValueToString(valueInput(node, 'message', node.data.message ?? ''))}`);
            }

            if (node.data.nodeKind === 'animator.setFloat' && node.data.paramName) {
              (animatorWrites[object.id] ??= []).push({
                name: node.data.paramName,
                value: toNumber(valueInput(node, 'value', Number(node.data.numberValue ?? 0))),
              });
            }

            if (node.data.nodeKind === 'animator.setBool' && node.data.paramName) {
              (animatorWrites[object.id] ??= []).push({
                name: node.data.paramName,
                value: toBoolean(valueInput(node, 'value', Boolean(node.data.booleanValue))),
              });
            }

            if (node.data.nodeKind === 'animator.setTrigger' && node.data.paramName) {
              (animatorWrites[object.id] ??= []).push({ name: node.data.paramName, value: true, trigger: true });
            }

            if (node.data.nodeKind === 'action.move') {
              const vector = valueInput(node, 'vector');
              const cc = object.character;
              // Apply sprint/crouch from the owner's bindings so node-driven pawns run + crouch too.
              const speedScale = cc ? (currentKeys[cc.keyCrouch] ? cc.crouchMultiplier : currentKeys[cc.keySprint] ? cc.sprintMultiplier : 1) : 1;
              const speed = toNumber(valueInput(node, 'speed', Number(node.data.amount ?? cc?.moveSpeed ?? 3.4))) * speedScale;
              if (Array.isArray(vector)) {
                position[0] += vector[0] * speed * delta;
                position[2] += vector[2] * speed * delta;
                if (vector[0] !== 0 || vector[2] !== 0) {
                  const turn = object.character?.turnSpeed ?? 10;
                  const yawOffset = object.character?.modelYawOffset ?? 0;
                  rotation[1] = lerpAngle(rotation[1], Math.atan2(vector[0], vector[2]) + yawOffset, turn * delta);
                }
                changed = true;
              }
            }

            if (node.data.nodeKind === 'action.jump') {
              characterJumpRequests.add(object.id);
            }

            if (node.data.nodeKind === 'action.setCamera') {
              const current = nextCameraOverrides[object.id];
              const offset = object.character?.cameraOffset;
              nextCameraOverrides[object.id] = {
                distance: toNumber(valueInput(node, 'distance', current?.distance ?? (offset ? Math.abs(offset[2]) : 6))),
                height: toNumber(valueInput(node, 'height', current?.height ?? (offset ? offset[1] : 2.6))),
              };
            }

            return true;
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
              if (node.data.nodeKind === 'event.collisionEnter') {
                return collidedObjects.has(object.id);
              }
              return false;
            })
            .map((node) => node.id);

          roots.forEach((rootId) => executeFrom(rootId, new Set()));

          return changed
            ? {
                ...object,
                transform: { position, rotation, scale },
                renderer: nextRenderer,
              }
            : object;
      });

      // Character controller pass: turn input into ground movement + jump for character objects.
      // Runs after scripts, before physics; the motion it produces feeds the animator's speed params.
      const movedObjects = mappedObjects.map((object) => {
        if (!object.character?.enabled) return object;
        // Backfill defaults so characters created before newer fields existed still work.
        const cc = { ...defaultCharacter(), ...object.character };
        // Scripted: a blueprint (Move/Jump nodes) drives horizontal motion + jump — Unreal Event-Graph
        // style. Auto (no blueprint): the built-in WASD/Space drives it. Vertical physics runs either way.
        const scripted = Boolean(object.script?.enabled);
        const position = [...object.transform.position] as Vector3Tuple;
        const rotation = [...object.transform.rotation] as Vector3Tuple;
        const grounded = state.runtimeGrounded.includes(object.id) || position[1] <= cc.groundLevel + 0.001;

        // Roll/dodge: started on the roll key while grounded, dashes forward for rollDuration.
        let rollRemaining = state.runtimeRoll[object.id] ?? 0;
        if (rollRemaining <= 0 && grounded && currentKeys[cc.keyRoll]) rollRemaining = cc.rollDuration;
        const rolling = rollRemaining > 0;

        if (!scripted && !rolling) {
          // Forward = +Z (model forward); right = -X. Camera sits behind, so this reads correctly on screen.
          let inputX = 0;
          let inputZ = 0;
          if (currentKeys[cc.keyForward]) inputZ += 1;
          if (currentKeys[cc.keyBackward]) inputZ -= 1;
          if (currentKeys[cc.keyLeft]) inputX += 1;
          if (currentKeys[cc.keyRight]) inputX -= 1;
          const length = Math.hypot(inputX, inputZ);
          const sprinting = Boolean(currentKeys[cc.keySprint]);
          const crouching = Boolean(currentKeys[cc.keyCrouch]);
          const speed = cc.moveSpeed * (crouching ? cc.crouchMultiplier : sprinting ? cc.sprintMultiplier : 1);
          if (length > 0) {
            let dirX = inputX / length;
            let dirZ = inputZ / length;
            // Camera-relative: rotate the input by the mouse-look camera yaw so "forward" follows the view.
            if (cc.cameraRelativeMovement && cc.mouseLook) {
              const yaw = mouseCameraYaw(cc.mouseSensitivity);
              const cos = Math.cos(yaw);
              const sin = Math.sin(yaw);
              [dirX, dirZ] = [dirX * cos + dirZ * sin, -dirX * sin + dirZ * cos];
            }
            position[0] += dirX * speed * delta;
            position[2] += dirZ * speed * delta;
            // Face the movement direction (+ the model's authored forward offset).
            rotation[1] = lerpAngle(rotation[1], Math.atan2(dirX, dirZ) + cc.modelYawOffset, cc.turnSpeed * delta);
          }
        }

        // Roll dash: travel forward (the character's facing) regardless of input mode.
        if (rolling) {
          const facing = rotation[1] - cc.modelYawOffset;
          position[0] += Math.sin(facing) * cc.rollSpeed * delta;
          position[2] += Math.cos(facing) * cc.rollSpeed * delta;
          rollRemaining = Math.max(0, rollRemaining - delta);
        }
        if (rollRemaining > 0) nextRoll[object.id] = rollRemaining;

        // Attack: a short pulse on the attack key that the animator turns into a punch / weapon swing.
        let attackRemaining = state.runtimeAttack[object.id] ?? 0;
        if (attackRemaining <= 0 && currentKeys[cc.keyAttack]) attackRemaining = 0.18;
        else if (attackRemaining > 0) attackRemaining = Math.max(0, attackRemaining - delta);
        if (attackRemaining > 0) nextAttack[object.id] = attackRemaining;

        // Vertical motion: gravity + jump. Grounded comes from the physics character controller
        // (last frame) so the character can stand on real colliders, not just the ground plane.
        let verticalVelocity = nextVelocities[object.id]?.[1] ?? 0;
        const wantsJump = scripted ? characterJumpRequests.has(object.id) : Boolean(currentKeys[cc.keyJump]);
        if (grounded && verticalVelocity < 0) verticalVelocity = 0;
        if (grounded && wantsJump) verticalVelocity = cc.jumpStrength;
        verticalVelocity -= cc.gravity * delta;
        position[1] += verticalVelocity * delta;
        if (position[1] <= cc.groundLevel) {
          position[1] = cc.groundLevel;
          if (verticalVelocity < 0) verticalVelocity = 0;
        }
        nextVelocities[object.id] = [0, verticalVelocity, 0];

        return { ...object, transform: { ...object.transform, position, rotation } };
      });

      // Physics post-pass: step the Rapier world and let it own every physics body's
      // transform (object-to-object collisions, stacking, gravity). Non-physics objects
      // keep whatever their script produced. Contacts are reported one frame later via
      // runtimeCollisions, which drives event.collisionEnter on the next tick.
      let collisions: string[] = [];
      let groundedIds: string[] = [];
      let resolvedObjects = movedObjects;
      const physics = getActivePhysics();
      if (physics) {
        const result = physics.frame(movedObjects, prevTransforms, physicsImpulses, delta);
        collisions = result.collisions;
        groundedIds = result.grounded;
        resolvedObjects = movedObjects.map((object) => {
          // Physics bodies AND character controllers get their post-collision transform written back.
          if (!object.physics?.enabled && !object.character?.enabled) return object;
          const next = result.transforms.get(object.id);
          if (!next) return object;
          return {
            ...object,
            transform: { position: next.position, rotation: next.rotation, scale: object.transform.scale },
          };
        });
      }

      const allObjects = [...resolvedObjects, ...spawned];
      const nextScenes = state.scenes.map((scene) =>
        scene.id !== state.activeSceneId ? scene : { ...scene, objects: allObjects },
      );

      // --- Animator pass: feed object state into parameters, then run the state machine. ---
      // Runs after physics so "speed"/"verticalSpeed" reflect the object's final motion this frame.
      const nextAnimators: Record<string, RuntimeAnimator> = {};
      for (const object of resolvedObjects) {
        const controllerId = object.animator?.enabled ? object.animator.controllerId : undefined;
        if (!controllerId) continue;
        const controller = state.animatorControllers.find((item) => item.id === controllerId);
        if (!controller || !controller.states.length) continue;

        // Movement this frame (start-of-tick transform vs. final transform).
        const before = prevTransforms.get(object.id);
        const after = object.transform.position;
        const dt = delta || 1 / 60;
        let horizontalSpeed = 0;
        let verticalSpeed = 0;
        if (before) {
          const dx = after[0] - before.position[0];
          const dy = after[1] - before.position[1];
          const dz = after[2] - before.position[2];
          horizontalSpeed = Math.hypot(dx, dz) / dt;
          verticalSpeed = dy / dt;
        }

        const prev = state.runtimeAnimators[object.id];
        // Seed parameter values from controller defaults, then carry over the previous frame's values.
        const params: Record<string, number | boolean> = {};
        for (const param of controller.parameters) params[param.id] = param.defaultValue;
        if (prev) for (const [key, value] of Object.entries(prev.params)) if (key in params) params[key] = value;

        // Auto-source parameters (object/world state → animator), then manual script writes.
        for (const param of controller.parameters) {
          if (param.source === 'speed') params[param.id] = horizontalSpeed;
          else if (param.source === 'verticalSpeed') params[param.id] = verticalSpeed;
          else if (param.source === 'moving') params[param.id] = horizontalSpeed > 0.1;
          else if (param.source === 'crouching') params[param.id] = Boolean(object.character && currentKeys[object.character.keyCrouch]);
          else if (param.source === 'grounded') params[param.id] = groundedIds.includes(object.id);
          else if (param.source === 'rolling') params[param.id] = (nextRoll[object.id] ?? 0) > 0;
          else if (param.source === 'attacking') params[param.id] = (nextAttack[object.id] ?? 0) > 0;
          else if (param.source === 'weaponEquipped') params[param.id] = resolvedObjects.some((o) => o.attachment?.targetObjectId === object.id);
          else if (param.source === 'variable' && param.variableId !== undefined) {
            const raw = nextVariableValues[param.variableId];
            params[param.id] = param.type === 'bool' ? toBoolean(raw) : toNumber(raw);
          }
        }
        const triggered = new Set<string>();
        for (const write of animatorWrites[object.id] ?? []) {
          const param = controller.parameters.find((p) => p.name === write.name);
          if (!param) continue;
          params[param.id] = write.value;
          if (write.trigger) triggered.add(param.id);
        }

        // Current state + how long we've been in it (drives exit-time / one-shot clips like Jump Land).
        let fromStateId = prev?.stateId ?? controller.defaultStateId ?? controller.states[0].id;
        if (!controller.states.some((s) => s.id === fromStateId)) fromStateId = controller.states[0].id;
        const fromState = controller.states.find((s) => s.id === fromStateId);
        const fromAnim = fromState?.animationId ? state.animations.find((a) => a.id === fromState.animationId) : undefined;
        const clipDuration = fromAnim ? fromAnim.duration / Math.max(fromState?.speed ?? 1, 0.01) : 0;
        const timeInState = (prev?.stateId === fromStateId ? prev.time : 0) + dt;

        // Evaluate transitions from the current state (plus "any state" transitions).
        let nextStateId = fromStateId;
        let fade = 0;
        const candidates = controller.transitions.filter((t) => t.from === fromStateId || t.from === 'any');
        for (const transition of candidates) {
          if (transition.to === fromStateId) continue;
          if (!controller.states.some((s) => s.id === transition.to)) continue;
          // Exit time: wait until the current clip has played far enough before leaving.
          if (transition.hasExitTime && timeInState < clipDuration * (transition.exitTime ?? 1)) continue;
          const pass = transition.conditions.every((condition) => {
            const param = controller.parameters.find((p) => p.id === condition.parameterId);
            if (!param) return false;
            return Boolean(compareValues(params[param.id] as GraphValue, condition.value as GraphValue, condition.op));
          });
          if (pass) {
            nextStateId = transition.to;
            fade = transition.duration;
            break;
          }
        }

        // Consume triggers (one-shot) so they don't re-fire next frame.
        for (const id of triggered) {
          const param = controller.parameters.find((p) => p.id === id);
          if (param?.type === 'trigger') params[id] = false;
        }

        nextAnimators[object.id] = { stateId: nextStateId, params, fade, time: nextStateId === fromStateId ? timeInState : 0 };
      }

      return {
        runtimeTime,
        runtimeVelocities: nextVelocities,
        runtimeVariableValues: nextVariableValues,
        runtimeAnimators: nextAnimators,
        runtimeCameraOverrides: nextCameraOverrides,
        runtimeGrounded: groundedIds,
        runtimeRoll: nextRoll,
        runtimeAttack: nextAttack,
        runtimeCollisions: collisions,
        runtimePreviousKeys: { ...currentKeys },
        runtimeEventQueue: [],
        runtimeStarted: true,
        runtimeSoundQueue: sounds.length ? [...state.runtimeSoundQueue, ...sounds] : state.runtimeSoundQueue,
        runtimeLog: prints.length ? [...state.runtimeLog, ...prints].slice(-100) : state.runtimeLog,
        scenes: nextScenes,
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
      const isValueEdge = Boolean(connection.targetHandle && connection.targetHandle !== 'exec-in');
      return {
        graphs: state.graphs.map((graph) =>
          graph.id === activeBlueprint.graphId
            ? {
                ...graph,
                edges: addEdge(
                  {
                    ...connection,
                    animated: !isValueEdge,
                    type: 'smoothstep',
                    style: isValueEdge ? { stroke: '#3DD0DC', strokeWidth: 2 } : undefined,
                  },
                  graph.edges,
                ),
              }
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
            data: makeNodeData(label, category, seedNodeDataFromProject(label, undefined, state.variables, state.dataAssets)),
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
      folders: state.folders,
      variables: state.variables,
      dataAssets: state.dataAssets,
      materials: state.materials ?? [],
      skeletons: state.skeletons ?? [],
      skeletalMeshes: state.skeletalMeshes ?? [],
      animations: state.animations ?? [],
      animatorControllers: state.animatorControllers ?? [],
      blueprints: state.blueprints,
      graphs: state.graphs,
    };
  },
  loadProject: (project) =>
    set(() => {
      // Backfill character-controller defaults so older saves (pre-cameraOffset/keys) load safely.
      const rawScenes = project.scenes.length ? project.scenes : [{ id: 'scene-main', name: 'Main', objects: [] }];
      const scenes = rawScenes.map((scene) => ({
        ...scene,
        objects: scene.objects.map((object) =>
          object.character ? { ...object, character: { ...defaultCharacter(), ...object.character } } : object,
        ),
      }));
      const activeSceneId = scenes.some((scene) => scene.id === project.activeSceneId)
        ? project.activeSceneId
        : scenes[0].id;
      const activeScene = scenes.find((scene) => scene.id === activeSceneId)!;

      // Harden the material↔graph round-trip: guarantee every material owns a real graph, and
      // drop orphan graphs that no blueprint or material references anymore.
      const graphs = [...(project.graphs ?? [])];
      const graphIds = new Set(graphs.map((graph) => graph.id));
      const materials = (project.materials ?? []).map((material) => {
        if (material.graphId && graphIds.has(material.graphId)) return material;
        const graphId = material.graphId ?? makeId('graph');
        if (!graphIds.has(graphId)) {
          graphs.push(makeMaterialGraph(graphId, material.name));
          graphIds.add(graphId);
        }
        return { ...material, graphId };
      });
      const referencedGraphIds = new Set(
        [
          ...(project.blueprints ?? []).map((blueprint) => blueprint.graphId),
          ...materials.map((material) => material.graphId),
        ].filter(Boolean) as string[],
      );
      const normalizedGraphs = graphs.filter((graph) => referencedGraphIds.has(graph.id));

      return {
        scenes,
        activeSceneId,
        selectedObjectId: activeScene.objects[0]?.id ?? '',
        assets: project.assets,
        folders: project.folders ?? [],
        variables: project.variables ?? [],
        dataAssets: project.dataAssets ?? [],
        materials,
        skeletons: project.skeletons ?? [],
        skeletalMeshes: project.skeletalMeshes ?? [],
        animations: project.animations ?? [],
        animatorControllers: project.animatorControllers ?? [],
        blueprints: project.blueprints,
        graphs: normalizedGraphs,
        activeBlueprintId: project.blueprints[0]?.id ?? '',
        activeMaterialId: project.materials?.[0]?.id ?? '',
        selectedGraphNodeId: undefined,
        isPlaying: false,
        playSnapshot: undefined,
        runtimeVelocities: {},
        runtimeKeys: {},
        runtimePreviousKeys: {},
        runtimeEventQueue: [],
        runtimeVariableValues: {},
        runtimeSoundQueue: [],
        runtimeLog: [],
        runtimeStarted: false,
        runtimeTime: 0,
        isDirty: false,
      };
    }),
  markClean: () => set({ isDirty: false }),
}));
