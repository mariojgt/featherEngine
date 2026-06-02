import type { Edge, OnConnect, OnEdgesChange, OnNodesChange } from '@xyflow/react';
import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react';
import { create } from 'zustand';
import {
  PROJECT_VERSION,
  PREFAB_EDIT_SCENE_ID,
  type Prefab,
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
  type ProjectileComponent,
  type LightComponent,
  type ParticleSystemComponent,
  type ParticleConfig,
  type ParticleSystemDefinition,
  type RenderSettings,
  type ProjectVariable,
  type RigidBodyType,
  type Scene,
  type SceneObject,
  type SceneObjectKind,
  type ScriptBlueprint,
  type SkeletonAsset,
  type SkeletonSocket,
  type AttachmentComponent,
  type RagdollSettings,
  type RagdollBodyDef,
  type SkeletalMeshAsset,
  type AnimationAsset,
  type AnimatorController,
  type AnimatorParameter,
  type AnimatorState,
  type AnimatorTransition,
  type AnimatorCondition,
  type CharacterControllerComponent,
  type CinematicAction,
  type CinematicCameraKeyframe,
  type CinematicTransformKeyframe,
  type CinematicEase,
  type CinematicSequence,
  type InventoryComponent,
  type RuntimeCinematicCamera,
  type RuntimeCinematicFade,
  type RuntimeCinematicState,
  type TransformComponent,
  type Vector3Tuple,
  type UIDocument,
  type UIElement,
  type UIElementKind,
  type UIBinding,
  type UIComponent,
  type UISurface,
  type UIPresetKind,
} from '../types';
import { getActivePhysics, startPhysics, stopPhysics, type PhysicsContactEvent } from '../runtime/physicsWorld';
import { cameraPitch as mouseCameraPitch, cameraYaw as mouseCameraYaw } from '../runtime/mouseLook';
import { isRagdoll, setRagdoll, getRagdollRoot } from '../runtime/ragdollState';
import { sendParticleCommand } from '../runtime/particleBus';
import { withParticleDefaults, defaultParticleConfig, particlePresets, particleAssetConfig, type ParticlePresetId } from '../runtime/particlePresets';
import { resolveMaterial } from '../three/materialResolve';
import type { ModelInspection } from '../three/inspectModel';

const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

/** Drop keys whose value is `undefined` so a partial patch never overwrites existing fields with undefined. */
const stripUndefined = <T extends object>(patch: T): Partial<T> =>
  Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const mix = (from: number, to: number, t: number) => from + (to - from) * t;
const mixVec3 = (from: Vector3Tuple, to: Vector3Tuple, t: number): Vector3Tuple => [
  mix(from[0], to[0], t),
  mix(from[1], to[1], t),
  mix(from[2], to[2], t),
];

const lookAtFromRotation = (position: Vector3Tuple, rotation: Vector3Tuple): Vector3Tuple => {
  const pitch = rotation[0];
  const yaw = rotation[1];
  return [
    position[0] + Math.sin(yaw) * Math.cos(pitch),
    position[1] + Math.sin(pitch),
    position[2] + Math.cos(yaw) * Math.cos(pitch),
  ];
};

/** Map a linear 0..1 progress through an easing curve (smooth = ease-in-out, the cinematic default). */
const applyCinematicEase = (t: number, ease: CinematicEase = 'smooth'): number => {
  const x = clamp01(t);
  switch (ease) {
    case 'linear':
      return x;
    case 'in':
      return x * x;
    case 'out':
      return 1 - (1 - x) * (1 - x);
    case 'smooth':
    default:
      return x * x * (3 - 2 * x);
  }
};

/** Eased local progress (0..1) of a beat at `time`, using the beat's `ease` (default smooth). */
const cinematicActionLocalTime = (action: CinematicAction, time: number) =>
  applyCinematicEase(clamp01((time - action.time) / Math.max(action.duration ?? 0, 0.001)), action.ease);

const isCinematicActionActive = (action: CinematicAction, time: number) => {
  const duration = Math.max(action.duration ?? 0, 0.001);
  return time >= action.time && time <= action.time + duration;
};

/** Linearly blend two camera poses (position/lookAt/fov). */
const mixCinematicCamera = (
  from: RuntimeCinematicCamera,
  to: RuntimeCinematicCamera,
  t: number,
): RuntimeCinematicCamera => ({
  position: mixVec3(from.position, to.position, t),
  lookAt: mixVec3(from.lookAt, to.lookAt, t),
  fov: mix(from.fov, to.fov, t),
});

/** Catmull-Rom interpolation of one scalar through four control points (p1→p2 over t∈[0,1]). */
const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

const catmullRomVec3 = (p0: Vector3Tuple, p1: Vector3Tuple, p2: Vector3Tuple, p3: Vector3Tuple, t: number): Vector3Tuple => [
  catmullRom(p0[0], p1[0], p2[0], p3[0], t),
  catmullRom(p0[1], p1[1], p2[1], p3[1], t),
  catmullRom(p0[2], p1[2], p2[2], p3[2], t),
];

/**
 * Sample an animated camera track: fly smoothly through the keyframes via a Catmull-Rom spline
 * (positions + look-ats + fov). Times are absolute seconds; outside the range the camera holds on
 * the first/last keyframe. A single keyframe is a static framing.
 */
const sampleCameraKeyframes = (keyframes: CinematicCameraKeyframe[], time: number): RuntimeCinematicCamera | undefined => {
  const frames = keyframes.filter((frame) => Number.isFinite(frame.time)).sort((a, b) => a.time - b.time);
  if (!frames.length) return undefined;
  if (frames.length === 1 || time <= frames[0].time) {
    const first = frames[0];
    return { position: first.position, lookAt: first.lookAt, fov: first.fov };
  }
  const last = frames[frames.length - 1];
  if (time >= last.time) return { position: last.position, lookAt: last.lookAt, fov: last.fov };

  let i = 0;
  while (i < frames.length - 1 && frames[i + 1].time <= time) i += 1;
  const k1 = frames[i];
  const k2 = frames[i + 1];
  const k0 = frames[i - 1] ?? k1;
  const k3 = frames[i + 2] ?? k2;
  const span = Math.max(k2.time - k1.time, 0.001);
  const t = clamp01((time - k1.time) / span);
  return {
    position: catmullRomVec3(k0.position, k1.position, k2.position, k3.position, t),
    lookAt: catmullRomVec3(k0.lookAt, k1.lookAt, k2.lookAt, k3.lookAt, t),
    fov: catmullRom(k0.fov, k1.fov, k2.fov, k3.fov, t),
  };
};

const cameraFromCinematicAction = (
  action: CinematicAction,
  objects: SceneObject[],
  time: number,
): RuntimeCinematicCamera | undefined => {
  // An animated keyframe track takes over the whole framing when present.
  if (action.keyframes && action.keyframes.length) {
    const sampled = sampleCameraKeyframes(action.keyframes, time);
    if (sampled) return sampled;
  }
  const cameraObject = action.objectId ? objects.find((object) => object.id === action.objectId) : undefined;
  const toPosition = action.toPosition ?? action.position;
  const position =
    action.fromPosition && toPosition && isCinematicActionActive(action, time)
      ? mixVec3(action.fromPosition, toPosition, cinematicActionLocalTime(action, time))
      : action.position ?? action.toPosition ?? action.fromPosition ?? cameraObject?.transform.position;
  if (!position) return undefined;
  const toRotation = action.toRotation ?? action.rotation;
  const rotation =
    action.fromRotation && toRotation && isCinematicActionActive(action, time)
      ? mixVec3(action.fromRotation, toRotation, cinematicActionLocalTime(action, time))
      : action.rotation ?? action.toRotation ?? action.fromRotation ?? cameraObject?.transform.rotation;
  return {
    position,
    lookAt: action.lookAt ?? (rotation ? lookAtFromRotation(position, rotation) : [0, 1, 0]),
    fov: action.fov ?? 50,
  };
};

const cinematicCameraAt = (
  sequence: CinematicSequence | undefined,
  objects: SceneObject[],
  time: number,
  fallback?: RuntimeCinematicCamera,
): RuntimeCinematicCamera | undefined => {
  const cameraActions = (sequence?.actions.filter((item) => item.type === 'camera') ?? []).sort((a, b) => a.time - b.time);
  if (!cameraActions.length) return fallback;
  const past = cameraActions.filter((item) => item.time <= time);
  const current = past[past.length - 1] ?? cameraActions[0];
  const currentPose = cameraFromCinematicAction(current, objects, time);
  if (!currentPose) return fallback;

  // Glide from the previous shot's framing into this one over `current.blend` seconds — a smooth
  // dolly instead of a hard cut. `blend` 0 (or no previous shot) keeps the classic instant cut.
  const previous = past.length >= 2 ? past[past.length - 2] : undefined;
  const blend = current.blend ?? 0;
  if (previous && blend > 0.001 && time < current.time + blend) {
    const previousPose = cameraFromCinematicAction(previous, objects, current.time);
    if (previousPose) {
      const t = applyCinematicEase((time - current.time) / blend, current.ease);
      return mixCinematicCamera(previousPose, currentPose, t);
    }
  }
  return currentPose;
};

/** Sample an animated object transform track: fly smoothly through the keyframes via Catmull-Rom. */
const sampleTransformKeyframes = (keyframes: CinematicTransformKeyframe[], time: number): TransformComponent | undefined => {
  const frames = keyframes.filter((frame) => Number.isFinite(frame.time)).sort((a, b) => a.time - b.time);
  if (!frames.length) return undefined;
  const pick = (frame: CinematicTransformKeyframe): TransformComponent => ({ position: frame.position, rotation: frame.rotation, scale: frame.scale });
  if (frames.length === 1 || time <= frames[0].time) return pick(frames[0]);
  const last = frames[frames.length - 1];
  if (time >= last.time) return pick(last);

  let i = 0;
  while (i < frames.length - 1 && frames[i + 1].time <= time) i += 1;
  const k1 = frames[i];
  const k2 = frames[i + 1];
  const k0 = frames[i - 1] ?? k1;
  const k3 = frames[i + 2] ?? k2;
  const t = clamp01((time - k1.time) / Math.max(k2.time - k1.time, 0.001));
  return {
    position: catmullRomVec3(k0.position, k1.position, k2.position, k3.position, t),
    rotation: catmullRomVec3(k0.rotation, k1.rotation, k2.rotation, k3.rotation, t),
    scale: catmullRomVec3(k0.scale, k1.scale, k2.scale, k3.scale, t),
  };
};

const cinematicFadeAt = (
  sequence: CinematicSequence | undefined,
  time: number,
  fallback?: RuntimeCinematicFade,
): RuntimeCinematicFade | undefined => {
  const action = sequence?.actions
    .filter((item) => item.type === 'fade' && item.time <= time)
    .sort((a, b) => b.time - a.time)[0];
  if (!action) return undefined;
  const active = isCinematicActionActive(action, time);
  const local = cinematicActionLocalTime(action, time);
  return {
    opacity: active ? mix(action.fadeFrom ?? fallback?.opacity ?? 0, action.fadeTo ?? 1, local) : action.fadeTo ?? fallback?.opacity ?? 0,
    color: action.fadeColor ?? fallback?.color ?? '#000000',
  };
};

const initialCinematicCamera = (sequence: CinematicSequence | undefined, objects: SceneObject[]): RuntimeCinematicCamera | undefined =>
  cinematicCameraAt(sequence, objects, 0);

const initialCinematicFade = (sequence: CinematicSequence | undefined): RuntimeCinematicFade | undefined =>
  cinematicFadeAt(sequence, 0);

const cinematicTransformsAt = (
  sequence: CinematicSequence | undefined,
  objects: SceneObject[],
  time: number,
): Record<string, TransformComponent> => {
  if (!sequence) return {};
  const byId = new Map(objects.map((object) => [object.id, object]));
  const transforms: Record<string, TransformComponent> = {};

  sequence.actions
    .filter((action) => action.type === 'transform' && action.objectId && action.time <= time)
    .sort((a, b) => a.time - b.time)
    .forEach((action) => {
      const objectId = action.objectId;
      if (!objectId) return;
      const current = transforms[objectId] ?? byId.get(objectId)?.transform;
      if (!current) return;
      // An animated keyframe track drives the object's whole transform when present.
      if (action.transformKeyframes && action.transformKeyframes.length) {
        const sampled = sampleTransformKeyframes(action.transformKeyframes, time);
        if (sampled) transforms[objectId] = sampled;
        return;
      }
      const local = isCinematicActionActive(action, time) ? cinematicActionLocalTime(action, time) : 1;
      const toPosition = action.toPosition ?? action.position ?? current.position;
      const toRotation = action.toRotation ?? action.rotation ?? current.rotation;
      const toScale = action.toScale ?? action.scale ?? current.scale;
      transforms[objectId] = {
        position: action.fromPosition ? mixVec3(action.fromPosition, toPosition, local) : toPosition,
        rotation: action.fromRotation ? mixVec3(action.fromRotation, toRotation, local) : toRotation,
        scale: action.fromScale ? mixVec3(action.fromScale, toScale, local) : toScale,
      };
    });

  return transforms;
};

const cinematicHiddenAt = (sequence: CinematicSequence | undefined, time: number): string[] => {
  if (!sequence) return [];
  const hidden = new Set<string>();
  sequence.actions
    .filter((action) => action.type === 'visibility' && action.objectId && action.time <= time)
    .sort((a, b) => a.time - b.time)
    .forEach((action) => {
      if (!action.objectId) return;
      if (action.visible === false) hidden.add(action.objectId);
      else hidden.delete(action.objectId);
    });
  return [...hidden];
};

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
  /** Active one-shot montage (Play Animation node): overrides the state machine's clip until it ends. */
  montage?: { animationId: string; remaining: number; speed: number };
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
/** Default project render/post-processing settings — bloom on so emissive/tracers glow out of the box. */
export const defaultRenderSettings = (): RenderSettings => ({
  bloomEnabled: true,
  bloomIntensity: 0.9,
  bloomThreshold: 0.62,
  bloomRadius: 0.6,
  vignetteEnabled: true,
});

/** Default light tuning for a `kind: 'light'` object (point light — the most generally useful). */
export const defaultLight = (): LightComponent => ({
  type: 'point',
  color: '#ffffff',
  intensity: 8,
  distance: 12,
  angle: Math.PI / 6,
  castShadow: false,
});

export const defaultCharacter = (): CharacterControllerComponent => ({
  enabled: false,
  moveSpeed: 3.4,
  sprintMultiplier: 2,
  crouchMultiplier: 0.45,
  jumpStrength: 6.4,
  gravity: 16,
  fallMultiplier: 1.9,
  jumpCutMultiplier: 0.45,
  coyoteTime: 0.12,
  acceleration: 60,
  deceleration: 70,
  airControl: 0.35,
  turnSpeed: 12,
  modelYawOffset: 0,
  groundLevel: 0,
  keyForward: 'KeyW',
  keyBackward: 'KeyS',
  keyLeft: 'KeyA',
  keyRight: 'KeyD',
  keyJump: 'Space',
  keySprint: 'ShiftLeft',
  keyCrouch: 'KeyC',
  keyCrawl: 'KeyZ',
  crawlMultiplier: 0.4,
  strafe: false,
  keyRoll: 'KeyQ',
  rollSpeed: 7,
  rollDuration: 0.7,
  keyAttack: 'Mouse0',
  keyAim: 'Mouse1',
  keyReload: 'KeyR',
  keyInteract: 'KeyE',
  keyEmote: 'KeyF',
  keyRagdoll: 'KeyP',
  cameraMode: 'thirdPerson',
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

/** Default ragdoll tuning — the same conservative values RagdollRig was hardcoded with. */
export const defaultRagdollSettings = (): RagdollSettings => ({
  capsuleRadius: 0.06,
  density: 1.2,
  linearDamping: 0.1,
  angularDamping: 0.8,
  groundY: 0,
  excludePattern: 'thumb|index|middle|ring|pinky|finger|toe|eye|jaw|tongue|teeth|hair|cloth|ik|pole|twist|root$',
});

export interface CreateObjectOptions {
  name?: string;
  position?: Vector3Tuple;
  color?: string;
  physics?: Partial<PhysicsComponent>;
  /** Nest the new object under this object (sets `parentId`). */
  parentId?: string;
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
  isTrigger: false,
  collisionLayer: 0,
  collisionMask: 0xffff,
  mass: 1,
  gravityScale: 1,
  friction: 0.6,
  linearDamping: 0,
  angularDamping: 0.05,
});

const withPhysicsDefaults = (physics: PhysicsComponent): PhysicsComponent => ({
  ...defaultPhysics(physics.bodyType, physics.collider),
  ...physics,
  collisionLayer: Math.min(Math.max(Math.trunc(physics.collisionLayer ?? 0), 0), 15),
  collisionMask: (physics.collisionMask ?? 0xffff) & 0xffff,
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

// --- Game UI helpers -------------------------------------------------------
/** A blank element of a given kind, with sensible default styling per kind. */
const makeUIElement = (kind: UIElementKind, name?: string): UIElement => {
  const base: UIElement = {
    id: makeId('uiel'),
    kind,
    name: name ?? kind.charAt(0).toUpperCase() + kind.slice(1),
    style: {},
    bindings: [],
    children: [],
  };
  if (kind === 'panel') base.style = { display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px' };
  if (kind === 'text' || kind === 'button') base.text = kind === 'button' ? 'Button' : 'Text';
  if (kind === 'bar') base.style = { width: '160px', height: '16px', background: '#23262F', borderRadius: '8px' };
  if (kind === 'button') base.style = { padding: '6px 12px', background: '#5B8CFF', color: '#fff', borderRadius: '8px' };
  return base;
};

/** A fresh UI document with a root panel. Screen docs anchor top-left by default. */
const makeUIDocument = (name: string, surface: UISurface, folderId?: string): UIDocument => {
  const root = makeUIElement('panel', 'Root');
  if (surface === 'screen') root.anchor = { h: 'left', v: 'top', offsetX: 16, offsetY: 16 };
  return {
    id: makeId('ui'),
    name,
    surface,
    root,
    css: '',
    visibleOnStart: true,
    folderId,
    createdAt: Date.now(),
  };
};

/** Depth-first search for an element by id within a tree. */
const findUIElement = (root: UIElement, id: string): UIElement | undefined => {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findUIElement(child, id);
    if (found) return found;
  }
  return undefined;
};

/** Return a new tree with `fn` applied to the element matching `id` (immutable). */
const mapUIElement = (root: UIElement, id: string, fn: (el: UIElement) => UIElement): UIElement => {
  if (root.id === id) return fn(root);
  return { ...root, children: root.children.map((child) => mapUIElement(child, id, fn)) };
};

/** Return a new tree with the element matching `id` removed (root is never removed). */
const removeUIElementFromTree = (root: UIElement, id: string): UIElement => ({
  ...root,
  children: root.children.filter((child) => child.id !== id).map((child) => removeUIElementFromTree(child, id)),
});

/** Deep-clone an element subtree with fresh ids (for duplicate / preset insertion). */
const cloneUIElementFresh = (element: UIElement): UIElement => ({
  ...element,
  id: makeId('uiel'),
  style: { ...element.style },
  bindings: element.bindings.map((b) => ({ ...b })),
  children: element.children.map(cloneUIElementFresh),
});

/** Find the parent element of `childId` (or undefined if it's the root / not found). */
const findUIParent = (root: UIElement, childId: string): UIElement | undefined => {
  for (const child of root.children) {
    if (child.id === childId) return root;
    const found = findUIParent(child, childId);
    if (found) return found;
  }
  return undefined;
};

const defaultUIComponent = (documentId: string): UIComponent => ({
  documentId,
  offset: [0, 1.5, 0],
  scale: 1,
  billboard: true,
});

/**
 * Build a preset widget subtree (returned root not yet inserted). Presets that show live data set a
 * binding referencing `variableName` BY NAME — the caller ensures that project variable exists.
 */
const makeUIPreset = (preset: UIPresetKind, variableName: string): UIElement => {
  switch (preset) {
    case 'healthBar': {
      const container = makeUIElement('panel', 'Health Bar');
      container.style = { display: 'flex', flexDirection: 'column', gap: '4px', width: '200px' };
      const label = makeUIElement('text', 'Label');
      label.text = 'Health';
      label.style = { color: '#ffffff', fontSize: '12px', fontWeight: '600' };
      const bar = makeUIElement('bar', 'Bar');
      bar.style = { width: '200px', height: '16px', background: '#23262F', borderRadius: '8px' };
      bar.bindings = [{ target: 'fill', expression: `${variableName} / 100` }];
      container.children = [label, bar];
      return container;
    }
    case 'counter': {
      const text = makeUIElement('text', 'Counter');
      text.text = '0';
      text.style = { color: '#ffffff', fontSize: '20px', fontWeight: '700' };
      text.bindings = [{ target: 'text', expression: variableName }];
      return text;
    }
    case 'label': {
      const text = makeUIElement('text', 'Label');
      text.text = 'Label';
      text.style = { color: '#ffffff', fontSize: '14px' };
      return text;
    }
    case 'button': {
      const button = makeUIElement('button', 'Button');
      button.text = 'Click';
      button.onClickEvent = 'buttonClick';
      button.style = { padding: '8px 16px', background: '#5B8CFF', color: '#fff', borderRadius: '8px', fontWeight: '600' };
      return button;
    }
    case 'image': {
      const image = makeUIElement('image', 'Image');
      image.style = { width: '64px', height: '64px' };
      return image;
    }
    case 'panel':
    default: {
      const panel = makeUIElement('panel', 'Panel');
      panel.style = { display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px', background: 'rgba(15,17,23,0.6)', borderRadius: '8px' };
      return panel;
    }
  }
};

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
  UI: 'ui',
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
  'Trigger Enter': 'Fires when this object starts overlapping a trigger collider.',
  'Trigger Exit': 'Fires when this object stops overlapping a trigger collider.',
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
  'Destroy Object': 'Removes an object during Play.',
  'Play Sound': 'Plays an audio source.',
  'Play Cinematic': 'Starts a Film Mode cinematic sequence.',
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
  'Trigger Enter': 'event.triggerEnter',
  'Trigger Exit': 'event.triggerExit',
  Interact: 'event.interact',
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
  'Destroy Object': 'action.destroyObject',
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
  'Set Ragdoll': 'action.setRagdoll',
  'Spawn Projectile': 'action.spawnProjectile',
  'Set Visible': 'action.setVisible',
  'Spawn Attached': 'action.spawnAttached',
  'Play Animation': 'action.playAnimation',
  'Play Cinematic': 'action.playCinematic',
  'Set Movement Mode': 'action.setMovementMode',
  'Distance To Player': 'ai.distanceToPlayer',
  'Direction To Player': 'ai.directionToPlayer',
  'Player Location': 'ai.playerLocation',
  'Face Player': 'action.facePlayer',
  Cooldown: 'logic.cooldown',
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
  'Show UI': 'ui.show',
  'Hide UI': 'ui.hide',
  'Set UI Text': 'ui.setText',
  'Get Object Var': 'variable.getObject',
  'Set Object Var': 'variable.setObject',
  'Burst Particles': 'action.burstParticles',
  'Set Particles Emitting': 'action.setParticlesEmitting',
  'Spawn Particle System': 'action.spawnParticleSystem',
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
  if (nodeKind.startsWith('ui.')) return 'UI';
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
    case 'event.collisionEnter':
      return {
        label: 'Collision Enter',
        description: data.otherObjectId
          ? 'Fires when this object starts touching the selected other object.'
          : 'Fires when this object starts touching any solid collider.',
      };
    case 'event.triggerEnter':
      return {
        label: 'Trigger Enter',
        description: data.otherObjectId
          ? 'Fires when this object starts overlapping the selected trigger participant.'
          : 'Fires when this object starts overlapping any trigger collider.',
      };
    case 'event.triggerExit':
      return {
        label: 'Trigger Exit',
        description: data.otherObjectId
          ? 'Fires when this object stops overlapping the selected trigger participant (e.g. walks away).'
          : 'Fires when this object stops overlapping a trigger collider.',
      };
    case 'event.interact':
      return {
        label: 'Interact',
        description: 'Fires when the player presses the interact key while focused on this object (Unreal-style). Mark the object interactable with an "interactable" instance variable; an "interactPrompt" variable sets the on-screen label.',
      };
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
    case 'action.destroyObject':
      return {
        label: data.targetObjectId ? 'Destroy Object' : 'Destroy Self',
        description: data.targetObjectId ? 'Removes the target object during Play.' : 'Removes the owning object during Play.',
      };
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
    case 'action.setRagdoll':
      return {
        label: `Set Ragdoll ${data.booleanValue === false ? 'Off' : 'On'}`,
        description: 'Switches the owner (or Target) into a physics ragdoll — bones go limp.',
      };
    case 'action.spawnProjectile':
      return {
        label: 'Spawn Projectile',
        description: 'Fires a projectile forward from the owner that damages whatever it hits, then despawns.',
      };
    case 'action.setVisible':
      return {
        label: `Set Visible ${data.visible === false ? 'Off' : 'On'}`,
        description: 'Shows or hides the owner (or Target) object during Play — used to equip/holster weapons.',
      };
    case 'action.spawnAttached':
      return {
        label: 'Spawn Attached',
        description: 'Spawns a model and attaches it to the owner (or Target) at a bone/socket — Unreal-style equip. Replaces any weapon already on that socket.',
      };
    case 'ai.distanceToPlayer':
      return { label: 'Distance To Player', description: 'Outputs the distance (units) from this object to the player. Wire into Compare for range checks.' };
    case 'ai.directionToPlayer':
      return { label: 'Direction To Player', description: 'Outputs a normalized direction vector toward the player. Wire into Move so the enemy chases.' };
    case 'ai.playerLocation':
      return { label: 'Player Location', description: "Outputs the player's world position [x,y,z]. Wire into Spawn Particle System's Location (or any vector input) to spawn an effect at the player." };
    case 'action.facePlayer':
      return { label: 'Face Player', description: 'Turns this object to face the player (so Spawn Projectile fires at them).' };
    case 'logic.cooldown':
      return { label: `Cooldown: ${Number(data.numberValue ?? 1)}s`, description: 'Gate: lets execution through at most once every N seconds. Use for fire rate / spawn rate.' };
    case 'action.playAnimation':
      return {
        label: 'Play Animation',
        description: "Plays a one-shot animation (montage) on the owner's (or Target's) animator, overriding the state machine until it finishes, then returning automatically. Unreal Play-Montage style — fire it from any event (Interact, key, equip).",
      };
    case 'action.playCinematic':
      return { label: 'Play Cinematic', description: 'Starts a Film Mode cinematic sequence from Blueprint logic, trigger volumes, or interactions.' };
    case 'action.setMovementMode':
      return {
        label: `Set Movement Mode: ${data.movementMode ?? 'walking'}`,
        description: "Sets how the owner (or Target) character moves until changed — walking / swimming (buoyant) / climbing (wall) / flying (free 3D). Drives the swimming/climbing animator params. Wire Trigger Enter→swimming, Trigger Exit→walking for a water volume (Unreal SetMovementMode).",
      };
    case 'action.print':
      return { label: `Print: ${data.message || 'message'}`, description: 'Logs its message to the on-screen console during Play.' };
    case 'ui.show':
      return { label: 'Show UI', description: 'Shows a screen UI document (HUD) during Play.' };
    case 'ui.hide':
      return { label: 'Hide UI', description: 'Hides a screen UI document during Play.' };
    case 'ui.setText':
      return { label: 'Set UI Text', description: "Overrides a UI element's text at runtime (wire a value into Text)." };
    case 'action.burstParticles':
      return {
        label: `Burst Particles x${Number(data.numberValue ?? 16)}`,
        description: "Emits a one-shot burst from the owner's (or Target's) particle emitter — explosions, hit sparks, puffs. The object must have a particle emitter.",
      };
    case 'action.setParticlesEmitting':
      return {
        label: `Particles ${data.booleanValue === false ? 'Off' : 'On'}`,
        description: 'Starts or stops a continuous particle emitter on the owner (or Target) — e.g. ignite a torch, switch on a smoke plume.',
      };
    case 'action.spawnParticleSystem':
      return {
        label: 'Spawn Particle System',
        description: "Spawns a fresh emitter from a reusable Particle System asset (explosions, pickups, hit effects). Position priority: a Vector3 wired into Location (e.g. Player Location) → the Target object's position → the owner. An Offset vector is added on top. Set its particleSystemId. Runtime-spawned; removed on Stop.",
      };
    case 'variable.getObject':
      return { label: `Get Object Var: ${data.objectKey || 'health'}`, description: "Reads one of this object's instance variables (self)." };
    case 'variable.setObject':
      return { label: `Set Object Var: ${data.objectKey || 'health'}`, description: "Writes one of this object's instance variables (self)." };
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
    nodeKind === 'ai.distanceToPlayer' ||
    nodeKind === 'ai.directionToPlayer' ||
    nodeKind === 'ai.playerLocation' ||
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
    nodeKind === 'animator.getState' ||
    nodeKind === 'variable.getObject';

  if ((nodeKind === 'variable.getObject' || nodeKind === 'variable.setObject') && typeof normalized.objectKey !== 'string') {
    normalized.objectKey = 'health';
  }

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

/** Tunable setup for a spawned projectile (read from the Spawn Projectile node). */
interface ProjectileSetup {
  size?: number;
  color?: string;
  life?: number;
  gravity?: number;
  debug?: boolean;
  /** Optional scene object to clone the look from (mesh/model/scale/material). */
  template?: SceneObject;
}

/**
 * Build a runtime projectile: by default a small fast sphere that flies straight (no gravity) and
 * damages on hit. `setup` overrides its size/color/lifetime/gravity; a `template` object clones its
 * mesh/model/scale/material so users can design a custom bullet (rocket, arrow, orb) in the scene.
 */
const makeProjectileObject = (
  position: Vector3Tuple,
  velocity: Vector3Tuple,
  ownerId: string,
  damage: number,
  setup: ProjectileSetup = {},
): SceneObject => {
  const life = typeof setup.life === 'number' && setup.life > 0 ? setup.life : 3;
  const gravityScale = typeof setup.gravity === 'number' ? setup.gravity : 0;
  const projectile: ProjectileComponent = {
    ownerId,
    damage,
    life,
    velocity: [...velocity] as Vector3Tuple,
    debug: setup.debug || undefined,
  };

  // Clone the look from a chosen template object (keep its mesh/model/material/scale), but force
  // projectile physics + behaviour so it always flies + reports hits regardless of the template's setup.
  if (setup.template) {
    const t = setup.template;
    const collider: ColliderType = t.kind === 'sphere' ? 'sphere' : t.kind === 'capsule' ? 'capsule' : 'box';
    return {
      id: makeId('proj'),
      name: `${t.name} (projectile)`,
      kind: t.kind === 'empty' || t.kind === 'light' || t.kind === 'camera' ? 'sphere' : t.kind,
      transform: { position: [...position] as Vector3Tuple, rotation: [...t.transform.rotation] as Vector3Tuple, scale: [...t.transform.scale] as Vector3Tuple },
      renderer: t.renderer ? { ...t.renderer } : { ...defaultRenderer('sphere'), color: setup.color ?? '#ffd166' },
      physics: { ...defaultPhysics('dynamic', collider), enabled: true, gravityScale },
      projectile,
    };
  }

  const size = typeof setup.size === 'number' && setup.size > 0 ? setup.size : 0.18;
  return {
    id: makeId('proj'),
    name: 'Projectile',
    kind: 'sphere',
    transform: { position: [...position] as Vector3Tuple, rotation: [0, 0, 0], scale: [size, size, size] },
    renderer: { ...defaultRenderer('sphere'), color: setup.color ?? '#ffd166', metalness: 0.1, roughness: 0.4 },
    // Dynamic + zero gravity (by default) so it flies straight AND generates contact events (kinematic
    // bodies don't report contacts against static/dynamic targets in Rapier). The runtime drives its velocity.
    physics: { ...defaultPhysics('dynamic', 'sphere'), enabled: true, gravityScale },
    projectile,
  };
};

/** A short-lived particle burst (THREE.Points) at a bullet-impact point. No physics; despawns itself. */
const makeImpactObject = (position: Vector3Tuple, color = '#ffd27f'): SceneObject => ({
  id: makeId('fx'),
  name: 'Impact',
  kind: 'empty',
  transform: { position: [...position] as Vector3Tuple, rotation: [0, 0, 0], scale: [1, 1, 1] },
  effect: { kind: 'impact', life: 0.45, maxLife: 0.45, color, count: 24 },
});

/** A floating combat damage number that rises + fades above a hit. */
const makeDamageNumber = (position: Vector3Tuple, value: number, color = '#ffe08a'): SceneObject => ({
  id: makeId('fx'),
  name: 'Damage',
  kind: 'empty',
  transform: { position: [position[0], position[1] + 0.6, position[2]] as Vector3Tuple, rotation: [0, 0, 0], scale: [1, 1, 1] },
  effect: { kind: 'damage', life: 0.9, maxLife: 0.9, color, count: 1, value },
});

/** A water-entry splash: a crown of droplets that fountain up and arc back down. */
const makeSplashObject = (position: Vector3Tuple, color = '#9fd8ff'): SceneObject => ({
  id: makeId('fx'),
  name: 'Splash',
  kind: 'empty',
  transform: { position: [...position] as Vector3Tuple, rotation: [0, 0, 0], scale: [1, 1, 1] },
  effect: { kind: 'splash', life: 0.7, maxLife: 0.7, color, count: 40 },
});

/** A brief muzzle flash (bright forward spark + light) at the gun when a shot is fired. */
const makeMuzzleFlash = (position: Vector3Tuple, color = '#fff1c2'): SceneObject => ({
  id: makeId('fx'),
  name: 'Muzzle Flash',
  kind: 'empty',
  transform: { position: [...position] as Vector3Tuple, rotation: [0, 0, 0], scale: [1, 1, 1] },
  effect: { kind: 'muzzle', life: 0.07, maxLife: 0.07, color, count: 10 },
});

/** Build a runtime-spawned weapon actor attached to an owner's bone/socket (Unreal-style equip). The
 *  grip alignment travels with it via the attachment offset, so it doesn't depend on any map object. */
const makeAttachedWeapon = (
  ownerId: string,
  assetId: string,
  boneName: string,
  socketName: string | undefined,
  offsetPosition?: Vector3Tuple,
  offsetRotation?: Vector3Tuple,
  offsetScale?: Vector3Tuple,
): SceneObject => ({
  id: makeId('weapon'),
  name: 'Weapon',
  kind: 'cube',
  transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: offsetScale ?? [1, 1, 1] },
  renderer: { ...defaultRenderer('cube'), modelAssetId: assetId },
  attachment: { targetObjectId: ownerId, boneName, socketName, offsetPosition, offsetRotation, offsetScale },
  // Marker so a later equip can find + replace the weapon already on this slot.
  variables: { __attachedWeapon: socketName || boneName || '1' },
});

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

/** A runtime-spawned emitter that references a particle-system asset (Spawn Particle System node). */
const makeSpawnedParticleEmitter = (systemId: string, position: Vector3Tuple): SceneObject => ({
  id: makeId('psfx'),
  name: 'Particle System',
  kind: 'empty',
  transform: defaultTransform([position[0], position[1], position[2]]),
  particles: { ...withParticleDefaults({ enabled: true }), systemId },
});

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
  /** Project-wide render / post-processing (bloom, vignette). */
  renderSettings: RenderSettings;
  variables: ProjectVariable[];
  dataAssets: DataAsset[];
  materials: MaterialDefinition[];
  particleSystems: ParticleSystemDefinition[];
  skeletons: SkeletonAsset[];
  skeletalMeshes: SkeletalMeshAsset[];
  animations: AnimationAsset[];
  animatorControllers: AnimatorController[];
  blueprints: ScriptBlueprint[];
  graphs: ProjectGraph[];
  uiDocuments: UIDocument[];
  /** Reusable object templates (prefabs). */
  prefabs: Prefab[];
  /** Id of the prefab currently open in the prefab editor, or null when editing a normal scene. */
  editingPrefabId: string | null;
  /** While editing a prefab, the scene to return to when the editor closes. */
  prefabReturnSceneId: string | null;
  activeBlueprintId: string;
  activeAnimatorControllerId: string;
  activeMaterialId: string;
  activeParticleSystemId: string;
  activeUIDocumentId: string;
  activeCinematicId: string;
  /** Editor-only: selected UI element id (shared between the UI panel and viewport overlay). */
  selectedUIElementId: string;
  isPlaying: boolean;
  playSnapshot?: {
    sceneId: string;
    /** Deep clone of the scene's objects at play start — restored wholesale on Stop (re-adds destroyed
     *  objects, drops runtime-spawned ones, resets transforms/renderers/instance variables). */
    objects: SceneObject[];
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
  /** Character ids currently inside a water volume (swim mode) / on a climb volume (climb mode). Maintained
   *  via trigger enter/exit against objects whose `volume` instance variable is 'water' / 'climb'. */
  runtimeSwimming: string[];
  runtimeClimbing: string[];
  /** Remaining roll/dodge time (seconds) per object — drives the forward dash + "rolling" param. */
  runtimeRoll: Record<string, number>;
  /** Remaining coyote-time (seconds) per object — a jump still registers this long after leaving the ground. */
  runtimeCoyote: Record<string, number>;
  /** Remaining attack time (seconds) per object — drives the "attacking" param. */
  runtimeAttack: Record<string, number>;
  /** Remaining reload time (seconds) per object — drives the "reloading" param. */
  runtimeReload: Record<string, number>;
  /** Remaining interact time (seconds) per object — drives the "interacting" param. */
  runtimeInteract: Record<string, number>;
  /** Distance walked since the last footstep sound, per object — drives footstep audio cadence. */
  runtimeFootstep: Record<string, number>;
  /** Per (object:node) remaining seconds for Cooldown gate nodes — drives AI fire rate / spawn rate. */
  runtimeCooldowns: Record<string, number>;
  /** Object ids hidden at runtime by action.setVisible (e.g. holstered weapons). */
  runtimeHidden: string[];
  /** The interactable object the local (camera-follow) player is currently focused on — highlighted +
   *  prompted on screen; pressing the interact key fires its event.interact. Null when nothing is in range. */
  runtimeInteractFocusId: string | null;
  /** Monotonic counter bumped each time a player-owned projectile lands a hit — drives the HUD hit marker. */
  runtimeHitMarker: number;
  /** Monotonic counter bumped each time the local player takes damage — drives the HUD hurt flash. */
  runtimeHurt: number;
  /** Per-enemy attack cooldown (seconds remaining) so contact damage applies on a cadence, not every frame. */
  runtimeEnemyCooldown: Record<string, number>;
  /** Per-object hit-flash time remaining (seconds) — drives a brief red emissive pulse when something takes damage. */
  runtimeHitFlash: Record<string, number>;
  /** Per-character footstep-sound override from the surface volume they're standing in (a trigger tagged with
   *  a `footstepSound` instance variable). Empty → use the character's own footstepSoundId. */
  runtimeSurfaceSound: Record<string, string>;
  /** Per-character movement-mode override set by the "Set Movement Mode" node (walking/swimming/climbing/
   *  flying). Persists until changed; takes precedence over the volume-tag swim/climb detection. */
  runtimeMovementMode: Record<string, string>;
  /** One-shot montage requests from outside the tick (e.g. clicking an inventory slot) — consumed next tick
   *  to start a Play-Animation montage on the keyed object. Keyed by target object id. */
  runtimeMontageRequests: Record<string, { animationId: string; speed: number }>;
  /** Solid-contact pairs that started in the previous physics step; drives event.collisionEnter. */
  runtimeCollisions: PhysicsContactEvent[];
  /** Trigger-overlap pairs that started in the previous physics step; drives event.triggerEnter. */
  runtimeTriggers: PhysicsContactEvent[];
  /** Trigger-overlap pairs that ENDED in the previous physics step; drives event.triggerExit. */
  runtimeTriggersExit: PhysicsContactEvent[];
  /** Audio asset ids queued by action.playSound this frame; drained + cleared by the audio runtime. */
  runtimeSoundQueue: string[];
  /** Messages emitted by action.print during Play; shown by the on-screen console overlay. */
  runtimeLog: string[];
  /** Screen UI documents currently shown during Play (keyed by doc id). Seeded from `visibleOnStart`. */
  runtimeVisibleUI: Record<string, boolean>;
  /** Per-object instance variables during Play (e.g. each enemy's health), read by world-UI `self.*` bindings. */
  runtimeObjectVariables: Record<string, Record<string, GraphValue>>;
  /** Runtime text overrides written by ui.setText, keyed by `${docId}:${elementId}`. Play-only. */
  runtimeUITextOverrides: Record<string, string>;
  runtimeCinematic?: RuntimeCinematicState;
  runtimeCinematicCamera?: RuntimeCinematicCamera;
  runtimeCinematicFade?: RuntimeCinematicFade;
  editorCinematicPreview?: { sequenceId: string; time: number };
  editorCinematicPreviewCamera?: RuntimeCinematicCamera;
  editorCinematicPreviewFade?: RuntimeCinematicFade;
  editorCinematicPreviewTransforms: Record<string, TransformComponent>;
  editorCinematicPreviewHidden: string[];
  /** Editor-only: Film Mode "Record" mode — moving the camera or dragging objects auto-keys them. */
  cinematicRecording: boolean;
  runtimeStarted: boolean;
  runtimeTime: number;
  assetSearch: string;
  selectedGraphNodeId?: string;
  activeScene: () => Scene | undefined;
  selectedObject: () => SceneObject | undefined;
  createScene: (name?: string) => string;
  renameScene: (id: string, name: string) => void;
  setSceneAudio: (id: string, patch: { ambientSoundId?: string; musicSoundId?: string }) => void;
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
  /** Clone an object (and its descendants) `count` times, each offset from the previous copy. Returns the new root ids. */
  duplicateObject: (id: string, options?: { count?: number; offset?: Vector3Tuple }) => string[];
  renameObject: (id: string, name: string) => void;
  /** Re-parent `id` under `parentId` (or detach to scene root when undefined). Cycle-safe. */
  setObjectParent: (id: string, parentId?: string) => void;
  // --- Prefabs (reusable objects) ---
  /** Capture an object + all its descendants as a reusable prefab in the browser. Returns the prefab id. */
  createPrefabFromObject: (objectId: string, name?: string, folderId?: string) => string | undefined;
  /** Stamp an independent copy of a prefab into the active scene (fresh ids). Returns the new root object id. */
  instantiatePrefab: (prefabId: string, options?: { position?: Vector3Tuple; parentId?: string }) => string | undefined;
  /** Open a prefab in the editor: swaps the active scene to a transient edit scene built from it. */
  openPrefabEditor: (prefabId: string) => void;
  /** Close the prefab editor, optionally saving edits back into the prefab, and restore the prior scene. */
  closePrefabEditor: (save?: boolean) => void;
  renamePrefab: (id: string, name: string) => void;
  deletePrefab: (id: string) => void;
  /** Push a prefab-instance's current edits back into its source prefab (affects FUTURE instances only).
   * `objectId` must be an instance root (carries prefabSourceId). Returns the updated prefab id. */
  applyInstanceToPrefab: (objectId: string) => string | undefined;
  /** Discard a prefab-instance's local edits and replace its subtree with a fresh copy of the prefab,
   * keeping its world position/parent. `objectId` must be an instance root. Returns the new root id. */
  revertInstanceToPrefab: (objectId: string) => string | undefined;
  /** Prefab ids awaiting an offscreen-rendered thumbnail (drained by the PrefabThumbnailHost). */
  prefabThumbnailQueue: string[];
  /** Queue a prefab for (re)rendering its browser thumbnail. */
  requestPrefabThumbnail: (prefabId: string) => void;
  /** Store a freshly rendered thumbnail (PNG data URL) and drop the prefab from the render queue. */
  setPrefabThumbnail: (prefabId: string, dataUrl: string) => void;
  updateTransform: (id: string, field: keyof TransformComponent, value: Vector3Tuple) => void;
  updateRenderer: (id: string, patch: Partial<MeshRendererComponent>) => void;
  setObjectModel: (id: string, modelAssetId?: string) => void;
  updatePhysics: (id: string, patch: Partial<PhysicsComponent>) => void;
  togglePhysics: (id: string) => void;
  /** Enable/disable the animator on an object (seeds a default component when first enabled). */
  toggleAnimator: (id: string) => void;
  /** Patch an object's animator component (clip, speed, loop). No-op if it has no animator. */
  updateAnimator: (id: string, patch: Partial<AnimatorComponent>) => void;
  /** Live-set a running animator parameter value (for the in-Play parameters panel / testing). */
  setRuntimeAnimatorParam: (objectId: string, paramId: string, value: number | boolean) => void;
  /** Toggle a physics ragdoll on an object during Play (bones go limp). */
  setObjectRagdoll: (objectId: string, on: boolean) => void;
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
  /** Define/replace an object's weapon inventory (pass undefined to remove it). */
  setInventory: (objectId: string, inventory: InventoryComponent | undefined) => void;
  /** Equip the inventory slot at `index`: swaps the attached weapon, plays the equip montage + switch sound,
   *  and sets the RangedMode animator param. Driven by the on-screen inventory bar (and AI). */
  equipInventorySlot: (objectId: string, index: number) => void;
  /** Update project-wide render/post-processing settings (bloom, vignette). */
  updateRenderSettings: (patch: Partial<RenderSettings>) => void;
  /** Configure a `kind: 'light'` object's light (type/color/intensity/distance/angle). Creates the component if absent. */
  setObjectLight: (objectId: string, patch: Partial<LightComponent>) => void;
  /** Add an authored particle emitter to an object (optionally seeded from a preset). Creates the component if absent. */
  addParticles: (objectId: string, preset?: ParticlePresetId) => void;
  /** Patch an object's particle emitter (no-op if it has none). */
  updateParticles: (objectId: string, patch: Partial<ParticleSystemComponent>) => void;
  /** Remove an object's particle emitter. */
  removeParticles: (objectId: string) => void;
  /** Attach an object to a character's bone socket (or pass undefined target to detach). */
  setAttachment: (objectId: string, attachment?: AttachmentComponent) => void;
  /** Add a named socket (bone + offset) to a Skeleton asset. Returns the socket id. */
  addSkeletonSocket: (skeletonId: string, socket: { name?: string; boneName: string }) => string | undefined;
  updateSkeletonSocket: (skeletonId: string, socketId: string, patch: Partial<Omit<SkeletonSocket, 'id'>>) => void;
  removeSkeletonSocket: (skeletonId: string, socketId: string) => void;
  /** Tune a skeleton's global ragdoll defaults (shared by everything using that skeleton). */
  updateSkeletonRagdoll: (skeletonId: string, patch: Partial<RagdollSettings>) => void;
  /** Upsert a per-bone ragdoll body override (Unreal PhAT-style). */
  setRagdollBody: (skeletonId: string, boneName: string, patch: Partial<Omit<RagdollBodyDef, 'boneName'>>) => void;
  /** Remove a per-bone ragdoll body override (the bone reverts to the global defaults). */
  removeRagdollBody: (skeletonId: string, boneName: string) => void;
  /** Auto-generate a default capsule body for every non-excluded bone (Unreal "auto-generate bodies"). */
  generateRagdollBodies: (skeletonId: string) => void;
  /**
   * One-click third-person pawn: from a rigged model asset, create an object that renders it, build a
   * locomotion Animator Controller (Idle/Walk/Jog/Jump from the skeleton's clips, matched by name) and
   * attach a character controller. Returns the new object's id, or undefined if the model isn't rigged.
   */
  createCharacterPawn: (modelAssetId: string, name?: string) => string | undefined;
  /** Augment a character's animator with a gameplay kit (extra states/params/transitions). Returns a summary. */
  addGameplayKit: (objectId: string, kit: 'ranged' | 'health' | 'interactions' | 'emotes') => string | undefined;
  /** Create a self-contained collectible pickup wired to increment a project variable and update a HUD counter. */
  createCollectibleCounter: (options?: {
    name?: string;
    variableName?: string;
    label?: string;
    amount?: number;
    position?: Vector3Tuple;
    playerObjectId?: string;
    color?: string;
  }) => { objectId: string; blueprintId: string; variableId: string; uiDocumentId: string; counterElementId: string };
  createCinematic: (name?: string, duration?: number) => string;
  updateCinematic: (id: string, patch: Partial<Omit<CinematicSequence, 'id' | 'actions' | 'createdAt'>>) => void;
  deleteCinematic: (id: string) => void;
  setActiveCinematic: (id: string) => void;
  addCinematicAction: (cinematicId: string, action: Omit<CinematicAction, 'id'>) => string | undefined;
  updateCinematicAction: (cinematicId: string, actionId: string, patch: Partial<Omit<CinematicAction, 'id'>>) => void;
  removeCinematicAction: (cinematicId: string, actionId: string) => void;
  /** Capture/replace a camera keyframe at `time` on the cinematic's camera track (creates one). */
  addCinematicCameraKeyframe: (cinematicId: string, time: number, pose: RuntimeCinematicCamera) => string | undefined;
  /** Capture/replace an object transform keyframe at `time` (uses `transform` or the object's live pose). */
  addCinematicTransformKeyframe: (cinematicId: string, objectId: string, time: number, transform?: TransformComponent) => string | undefined;
  setCinematicRecording: (recording: boolean) => void;
  previewCinematic: (cinematicId: string, time: number) => void;
  clearCinematicPreview: () => void;
  playCinematic: (cinematicId: string) => void;
  stopCinematic: () => void;
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
  moveToFolder: (kind: 'asset' | 'blueprint' | 'dataAsset' | 'material' | 'particleSystem' | 'uiDocument' | 'prefab', id: string, folderId?: string) => void;
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
  // --- Reusable particle-system assets (Unreal-style). Edit once, every referencing emitter updates. ---
  createParticleSystem: (name?: string, preset?: ParticlePresetId, folderId?: string) => string;
  renameParticleSystem: (id: string, name: string) => void;
  updateParticleSystem: (id: string, patch: Partial<ParticleConfig>) => void;
  deleteParticleSystem: (id: string) => void;
  setActiveParticleSystem: (id: string) => void;
  /** Assign a particle-system asset to an object (seeds/points its emitter component at the asset). Pass undefined to detach. */
  setObjectParticleSystem: (objectId: string, systemId?: string) => void;
  // --- Game UI documents (HUD + world-space widgets). AI-friendly: explicit params, return ids. ---
  createUIDocument: (name?: string, surface?: UISurface, folderId?: string) => string;
  renameUIDocument: (id: string, name: string) => void;
  updateUIDocument: (id: string, patch: Partial<Pick<UIDocument, 'name' | 'surface' | 'css' | 'visibleOnStart' | 'logicBlueprintId'>>) => void;
  deleteUIDocument: (id: string) => void;
  setActiveUIDocument: (id: string) => void;
  /** Editor-only: which UI element is selected (shared by the panel tree and the viewport overlay). */
  selectUIElement: (id: string) => void;
  /** Ensure a UI document has a runnable behaviour blueprint (+ "UI Logic" controller object). Returns its id. */
  openUILogic: (docId: string) => string;
  /** Add a child element under `parentId` (or the doc root when omitted). Returns the new element id. */
  addUIElement: (docId: string, parentId: string | undefined, kind: UIElementKind) => string;
  updateUIElement: (docId: string, elementId: string, patch: Partial<Omit<UIElement, 'id' | 'children'>>) => void;
  removeUIElement: (docId: string, elementId: string) => void;
  /** Upsert a data binding (by target) on an element. Pass an empty expression to remove it. */
  setUIBinding: (docId: string, elementId: string, target: UIBinding['target'], expression: string) => void;
  /** Insert a prebuilt widget (pre-styled, pre-bound) under parentId (or root). Returns its element id. */
  addUIPreset: (docId: string, parentId: string | undefined, preset: UIPresetKind, options?: { variableName?: string }) => string;
  /** Reorder an element among its siblings. */
  moveUIElement: (docId: string, elementId: string, dir: 'up' | 'down') => void;
  /** Deep-clone an element next to itself (fresh ids). Returns the new element id. */
  duplicateUIElement: (docId: string, elementId: string) => string;
  /** Attach (or replace) a world-space UI document on an object. Seeds offset/scale/billboard defaults. */
  attachUI: (objectId: string, documentId: string) => void;
  detachUI: (objectId: string) => void;
  updateUIComponent: (objectId: string, patch: Partial<UIComponent>) => void;
  /** Author a per-instance object variable (read by world UI via `self.<key>`). */
  setObjectVariable: (objectId: string, key: string, value: GraphValue) => void;
  /** Runtime: show/hide a screen UI document (driven by ui.show/ui.hide nodes). */
  showUI: (docId: string) => void;
  hideUI: (docId: string) => void;
  /** Runtime: override an element's text (driven by ui.setText nodes). */
  setUIText: (docId: string, elementId: string, text: string) => void;
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

/** Collect `rootId` plus every descendant (following parentId), preserving document order. */
const collectSubtree = (objects: SceneObject[], rootId: string): SceneObject[] => {
  const ids = new Set<string>([rootId]);
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
  return objects.filter((object) => ids.has(object.id));
};

/**
 * Deep-clone a self-contained object tree with fresh ids, remapping every INTERNAL reference
 * (parentId + the cross-object id fields attachment/viewModel hold) from old → new. References that
 * point outside the tree are left untouched. Returns the cloned objects and the new root id.
 */
const cloneObjectTree = (
  tree: SceneObject[],
  rootId: string,
): { objects: SceneObject[]; rootId: string } => {
  const idMap = new Map<string, string>();
  tree.forEach((object) => idMap.set(object.id, makeId('obj')));
  const remap = (id: string | undefined) => (id && idMap.has(id) ? idMap.get(id)! : id);
  const objects = tree.map((object) => {
    const clone = structuredClone(object) as SceneObject;
    clone.id = idMap.get(object.id)!;
    if (clone.parentId) clone.parentId = remap(clone.parentId);
    if (clone.attachment?.targetObjectId) {
      clone.attachment = { ...clone.attachment, targetObjectId: remap(clone.attachment.targetObjectId)! };
    }
    if (clone.viewModel?.ownerObjectId) {
      clone.viewModel = { ...clone.viewModel, ownerObjectId: remap(clone.viewModel.ownerObjectId)! };
    }
    return clone;
  });
  return { objects, rootId: idMap.get(rootId)! };
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
  renderSettings: defaultRenderSettings(),
  variables: starterVariables,
  dataAssets: starterDataAssets,
  materials: [],
  particleSystems: [],
  skeletons: [],
  skeletalMeshes: [],
  animations: [],
  animatorControllers: [],
  blueprints: starterBlueprints,
  graphs: [{ id: graphId, name: 'Player Controller', nodes: starterNodes, edges: starterEdges }],
  uiDocuments: [],
  prefabs: [],
  editingPrefabId: null,
  prefabReturnSceneId: null,
  prefabThumbnailQueue: [],
  activeBlueprintId: blueprintId,
  activeMaterialId: '',
  activeParticleSystemId: '',
  activeUIDocumentId: '',
  activeCinematicId: '',
  selectedUIElementId: '',
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
  runtimeSwimming: [],
  runtimeClimbing: [],
  runtimeRoll: {},
  runtimeCoyote: {},
  runtimeAttack: {},
  runtimeReload: {},
  runtimeInteract: {},
  runtimeFootstep: {},
  runtimeCooldowns: {},
  runtimeHidden: [],
  runtimeInteractFocusId: null,
  runtimeHitMarker: 0,
  runtimeHurt: 0,
  runtimeEnemyCooldown: {},
  runtimeHitFlash: {},
  runtimeSurfaceSound: {},
  runtimeMovementMode: {},
  runtimeMontageRequests: {},
  runtimeCollisions: [],
  runtimeTriggers: [],
  runtimeTriggersExit: [],
  runtimeSoundQueue: [],
  runtimeLog: [],
  runtimeVisibleUI: {},
  runtimeObjectVariables: {},
  runtimeUITextOverrides: {},
  runtimeCinematic: undefined,
  runtimeCinematicCamera: undefined,
  runtimeCinematicFade: undefined,
  editorCinematicPreview: undefined,
  editorCinematicPreviewCamera: undefined,
  editorCinematicPreviewFade: undefined,
  editorCinematicPreviewTransforms: {},
  editorCinematicPreviewHidden: [],
  cinematicRecording: false,
  runtimeStarted: false,
  runtimeTime: 0,
  assetSearch: '',
  activeScene: () => get().scenes.find((scene) => scene.id === get().activeSceneId),
  selectedObject: () => selectActiveObjects(get()).find((object) => object.id === get().selectedObjectId),
  createScene: (name) => {
    const id = makeId('scene');
    set((state) => ({
      scenes: [...state.scenes, { id, name: name ?? `Scene ${state.scenes.length + 1}`, objects: [], cinematics: [] }],
      isDirty: true,
    }));
    return id;
  },
  renameScene: (id, name) =>
    set((state) => ({
      scenes: state.scenes.map((scene) => (scene.id === id ? { ...scene, name } : scene)),
      isDirty: true,
    })),
  setSceneAudio: (id, patch) =>
    set((state) => ({
      scenes: state.scenes.map((scene) => (scene.id === id ? { ...scene, ...patch } : scene)),
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
      // Keep ids inside the scene copy: they only need to be unique within a scene, and preserving them
      // keeps parent/action/track links intact. Scenes run independently, so cross-scene id reuse is fine.
      const copy: Scene = { ...structuredClone(source), id: newId, name: `${source.name} Copy` };
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
        next.physics = withPhysicsDefaults({ ...(next.physics ?? defaultPhysics()), ...options.physics });
      }
      // Nest under a parent when asked (only if that parent exists in the active scene).
      if (options.parentId && selectActiveObjects(state).some((object) => object.id === options.parentId)) {
        next.parentId = options.parentId;
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
  duplicateObject: (id, options = {}) => {
    const count = Math.max(1, Math.min(Math.round(options.count ?? 1), 200));
    const offset = options.offset ?? [0.8, 0, 0.8];
    const newRootIds: string[] = [];
    set((state) => {
      const objects = selectActiveObjects(state);
      const root = objects.find((object) => object.id === id);
      if (!root) return state;
      const subtree = collectSubtree(objects, id);
      const additions: SceneObject[] = [];
      for (let i = 1; i <= count; i += 1) {
        const { objects: clones, rootId } = cloneObjectTree(subtree, id);
        const placed = clones.map((object) => {
          if (object.id !== rootId) return object;
          return {
            ...object,
            name: `${root.name} Copy${count > 1 ? ` ${i}` : ''}`,
            transform: {
              ...object.transform,
              position: [
                root.transform.position[0] + offset[0] * i,
                root.transform.position[1] + offset[1] * i,
                root.transform.position[2] + offset[2] * i,
              ] as Vector3Tuple,
            },
          };
        });
        newRootIds.push(rootId);
        additions.push(...placed);
      }
      return {
        ...mapActiveSceneObjects(state, (current) => [...current, ...additions]),
        selectedObjectId: newRootIds[newRootIds.length - 1],
      };
    });
    return newRootIds;
  },
  setObjectParent: (id, parentId) =>
    set((state) => {
      if (id === parentId) return state;
      const objects = selectActiveObjects(state);
      if (!objects.some((object) => object.id === id)) return state;
      if (parentId && !objects.some((object) => object.id === parentId)) return state;
      // Reject cycles: a node can't be parented under one of its own descendants.
      if (parentId && collectSubtree(objects, id).some((object) => object.id === parentId)) return state;
      return mapActiveSceneObjects(state, (current) =>
        current.map((object) => (object.id === id ? { ...object, parentId: parentId || undefined } : object)),
      );
    }),
  createPrefabFromObject: (objectId, name, folderId) => {
    const objects = selectActiveObjects(get());
    const root = objects.find((object) => object.id === objectId);
    if (!root) return undefined;
    // Capture the object + all descendants, then re-id to prefab-local ids so the stored template
    // never collides with the live scene it was captured from.
    const subtree = collectSubtree(objects, objectId);
    const { objects: captured, rootId } = cloneObjectTree(subtree, objectId);
    // The prefab root has no parent inside the prefab; strip instance-provenance so the template is clean.
    const normalized = captured.map((object) => {
      const { prefabSourceId: _drop, ...rest } = object;
      return object.id === rootId ? { ...rest, parentId: undefined } : rest;
    });
    const id = makeId('prefab');
    set((state) => ({
      prefabs: [
        ...state.prefabs,
        { id, name: name ?? `${root.name} Prefab`, folderId, objects: normalized, rootId, createdAt: Date.now() },
      ],
      // Render a browser thumbnail for the new prefab.
      prefabThumbnailQueue: [...state.prefabThumbnailQueue, id],
      isDirty: true,
    }));
    return id;
  },
  requestPrefabThumbnail: (prefabId) =>
    set((state) =>
      state.prefabThumbnailQueue.includes(prefabId)
        ? state
        : { prefabThumbnailQueue: [...state.prefabThumbnailQueue, prefabId] },
    ),
  setPrefabThumbnail: (prefabId, dataUrl) =>
    set((state) => ({
      prefabs: state.prefabs.map((prefab) => (prefab.id === prefabId ? { ...prefab, thumbnail: dataUrl } : prefab)),
      prefabThumbnailQueue: state.prefabThumbnailQueue.filter((id) => id !== prefabId),
    })),
  instantiatePrefab: (prefabId, options = {}) => {
    const state = get();
    const prefab = state.prefabs.find((item) => item.id === prefabId);
    if (!prefab || !prefab.objects.length) return undefined;
    const { objects: clones, rootId } = cloneObjectTree(prefab.objects, prefab.rootId);
    const capturedRoot = prefab.objects.find((object) => object.id === prefab.rootId);
    // Without an explicit drop position, spread successive stamps diagonally so they don't pile up
    // exactly on top of each other (one step per existing instance of this prefab in the active scene).
    const existing = selectActiveObjects(state).filter((object) => object.prefabSourceId === prefabId).length;
    const base = capturedRoot?.transform.position ?? ([0, 0, 0] as Vector3Tuple);
    const spread: Vector3Tuple = [base[0] + existing * 1.2, base[1], base[2] + existing * 1.2];
    const placed = clones.map((object) => {
      if (object.id !== rootId) return object;
      const next: SceneObject = { ...object, parentId: options.parentId, prefabSourceId: prefabId };
      next.transform = { ...object.transform, position: options.position ?? spread };
      return next;
    });
    set((current) => ({
      ...mapActiveSceneObjects(current, (objects) => [...objects, ...placed]),
      selectedObjectId: rootId,
    }));
    return rootId;
  },
  openPrefabEditor: (prefabId) =>
    set((state) => {
      const prefab = state.prefabs.find((item) => item.id === prefabId);
      if (!prefab) return state;
      if (state.isPlaying) return state; // don't enter the prefab editor mid-play
      if (state.editingPrefabId === prefabId) return state; // already open

      // If another prefab is already open, save its edits before switching so nothing is lost.
      let prefabs = state.prefabs;
      const openEditScene = state.scenes.find((scene) => scene.id === PREFAB_EDIT_SCENE_ID);
      if (state.editingPrefabId && openEditScene) {
        prefabs = prefabs.map((item) => {
          if (item.id !== state.editingPrefabId) return item;
          const objects = structuredClone(openEditScene.objects);
          const root = objects.find((o) => o.id === item.rootId) ?? objects.find((o) => !o.parentId);
          return { ...item, objects, rootId: root?.id ?? item.rootId };
        });
      }
      const savedPrefab = prefabs.find((item) => item.id === prefabId)!;

      // Build a fresh transient scene from a clone of the prefab so edits don't mutate it until saved.
      const editScene: Scene = {
        id: PREFAB_EDIT_SCENE_ID,
        name: `Prefab: ${savedPrefab.name}`,
        objects: structuredClone(savedPrefab.objects),
      };
      const scenes = [...state.scenes.filter((scene) => scene.id !== PREFAB_EDIT_SCENE_ID), editScene];
      return {
        prefabs,
        scenes,
        activeSceneId: PREFAB_EDIT_SCENE_ID,
        editingPrefabId: prefabId,
        // Only remember a real scene to return to (never the edit scene itself).
        prefabReturnSceneId:
          state.activeSceneId === PREFAB_EDIT_SCENE_ID ? state.prefabReturnSceneId : state.activeSceneId,
        selectedObjectId: savedPrefab.rootId,
        isDirty: true,
      };
    }),
  closePrefabEditor: (save = true) =>
    set((state) => {
      const editScene = state.scenes.find((scene) => scene.id === PREFAB_EDIT_SCENE_ID);
      const editingPrefabId = state.editingPrefabId;
      let prefabs = state.prefabs;
      if (save && editScene && editingPrefabId) {
        prefabs = state.prefabs.map((prefab) => {
          if (prefab.id !== editingPrefabId) return prefab;
          const objects = structuredClone(editScene.objects);
          // The root is whichever object still has no parent (the original root, unless the user
          // re-rooted the tree). Fall back to the stored rootId if it's still present.
          const root =
            objects.find((object) => object.id === prefab.rootId) ?? objects.find((object) => !object.parentId);
          return { ...prefab, objects, rootId: root?.id ?? prefab.rootId };
        });
      }
      const scenes = state.scenes.filter((scene) => scene.id !== PREFAB_EDIT_SCENE_ID);
      const activeSceneId =
        state.prefabReturnSceneId && scenes.some((scene) => scene.id === state.prefabReturnSceneId)
          ? state.prefabReturnSceneId
          : scenes[0]?.id ?? '';
      const activeObjects = scenes.find((scene) => scene.id === activeSceneId)?.objects ?? [];
      // Re-render the thumbnail for the prefab we just saved.
      const prefabThumbnailQueue =
        save && editingPrefabId && !state.prefabThumbnailQueue.includes(editingPrefabId)
          ? [...state.prefabThumbnailQueue, editingPrefabId]
          : state.prefabThumbnailQueue;
      return {
        scenes,
        prefabs,
        activeSceneId,
        editingPrefabId: null,
        prefabReturnSceneId: null,
        selectedObjectId: activeObjects[0]?.id ?? '',
        prefabThumbnailQueue,
        isDirty: true,
      };
    }),
  renamePrefab: (id, name) =>
    set((state) => ({
      prefabs: state.prefabs.map((prefab) => (prefab.id === id ? { ...prefab, name } : prefab)),
      isDirty: true,
    })),
  deletePrefab: (id) =>
    set((state) => ({ prefabs: state.prefabs.filter((prefab) => prefab.id !== id), isDirty: true })),
  applyInstanceToPrefab: (objectId) => {
    const objects = selectActiveObjects(get());
    const instance = objects.find((object) => object.id === objectId);
    if (!instance?.prefabSourceId) return undefined;
    const prefabId = instance.prefabSourceId;
    if (!get().prefabs.some((prefab) => prefab.id === prefabId)) return undefined;
    // Capture the instance's current subtree (re-id to prefab-local) and overwrite the source prefab.
    // Other already-placed instances are untouched — only future stamps get the new layout.
    const subtree = collectSubtree(objects, objectId);
    const { objects: captured, rootId } = cloneObjectTree(subtree, objectId);
    const normalized = captured.map((object) => {
      const { prefabSourceId: _drop, ...rest } = object;
      return object.id === rootId ? { ...rest, parentId: undefined } : rest;
    });
    set((state) => ({
      prefabs: state.prefabs.map((prefab) =>
        prefab.id === prefabId ? { ...prefab, objects: normalized, rootId } : prefab,
      ),
      prefabThumbnailQueue: state.prefabThumbnailQueue.includes(prefabId)
        ? state.prefabThumbnailQueue
        : [...state.prefabThumbnailQueue, prefabId],
      isDirty: true,
    }));
    return prefabId;
  },
  revertInstanceToPrefab: (objectId) => {
    const state = get();
    const objects = selectActiveObjects(state);
    const instance = objects.find((object) => object.id === objectId);
    if (!instance?.prefabSourceId) return undefined;
    const prefab = state.prefabs.find((item) => item.id === instance.prefabSourceId);
    if (!prefab || !prefab.objects.length) return undefined;
    // Drop the instance's current subtree, then stamp a fresh copy of the prefab at the same
    // world position/parent so local tweaks are discarded.
    const remaining = deleteWithChildren(objects, objectId);
    const { objects: clones, rootId } = cloneObjectTree(prefab.objects, prefab.rootId);
    const placed = clones.map((object) =>
      object.id === rootId
        ? {
            ...object,
            parentId: instance.parentId,
            prefabSourceId: prefab.id,
            transform: { ...object.transform, position: instance.transform.position },
          }
        : object,
    );
    set((current) => ({
      ...mapActiveSceneObjects(current, () => [...remaining, ...placed]),
      selectedObjectId: rootId,
    }));
    return rootId;
  },
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
          object.id === id && object.physics ? { ...object, physics: withPhysicsDefaults({ ...object.physics, ...patch }) } : object,
        ),
      ),
    ),
  togglePhysics: (id) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== id) return object;
          const current = withPhysicsDefaults(object.physics ?? defaultPhysics());
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
  setRuntimeAnimatorParam: (objectId, paramId, value) =>
    set((state) => {
      const live = state.runtimeAnimators[objectId];
      if (!live) {
        const object = selectActiveObjects(state).find((item) => item.id === objectId);
        const controller = state.animatorControllers.find((item) => item.id === object?.animator?.controllerId);
        const stateId = controller?.defaultStateId ?? controller?.states[0]?.id;
        if (!controller || !stateId) return state;
        const params = Object.fromEntries(controller.parameters.map((param) => [param.id, param.defaultValue])) as Record<
          string,
          number | boolean
        >;
        if (!(paramId in params)) return state;
        return {
          runtimeAnimators: {
            ...state.runtimeAnimators,
            [objectId]: { stateId, params: { ...params, [paramId]: value }, fade: 0, time: 0 },
          },
        };
      }
      // Carried into next tick; manual params persist (auto-sourced ones get recomputed, as expected).
      return { runtimeAnimators: { ...state.runtimeAnimators, [objectId]: { ...live, params: { ...live.params, [paramId]: value } } } };
    }),
  setObjectRagdoll: (objectId, on) => {
    // Module-singleton flag (see ragdollState); the render layer (RagdollRig) reacts each frame.
    setRagdoll(objectId, on);
  },
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
  setInventory: (objectId, inventory) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => (object.id === objectId ? { ...object, inventory } : object)),
      ),
    ),
  equipInventorySlot: (objectId, index) => {
    const player = selectActiveObjects(get()).find((o) => o.id === objectId);
    const inv = player?.inventory;
    if (!player || !inv || index < 0 || index >= inv.slots.length) return;
    const slot = inv.slots[index];
    const socketName = inv.socketName ?? 'RightHand';
    const boneName = inv.boneName ?? 'hand_r';
    const markerSlot = socketName || boneName;
    const scale = slot.attachScale ?? 1;
    const yaw = slot.attachYaw ?? 0;
    const offsetPosition = slot.attachPosition;
    const offsetRotation = slot.attachRotation ?? ([0, yaw, 0] as Vector3Tuple);
    const offsetScale = [scale, scale, scale] as Vector3Tuple;
    set((state) => {
      const scenes = state.scenes.map((scene) => {
        if (scene.id !== state.activeSceneId) return scene;
        // Drop the weapon currently held on that socket, then attach the new slot's weapon (if any).
        let objects = scene.objects.filter(
          (o) =>
            !(o.variables?.__attachedWeapon && o.attachment?.targetObjectId === objectId && (o.attachment.socketName || o.attachment.boneName) === markerSlot),
        );
        if (slot.weaponAssetId) {
          objects = [...objects, makeAttachedWeapon(objectId, slot.weaponAssetId, boneName, socketName, offsetPosition, offsetRotation, offsetScale)];
        }
        objects = objects.map((o) => (o.id === objectId && o.inventory ? { ...o, inventory: { ...o.inventory, equipped: index } } : o));
        return { ...scene, objects };
      });
      const playing = state.isPlaying;
      return {
        scenes,
        // During Play: fire the equip montage + switch sound. (Don't dirty the project — it's gameplay.)
        runtimeMontageRequests:
          playing && slot.equipAnimId
            ? { ...state.runtimeMontageRequests, [objectId]: { animationId: slot.equipAnimId, speed: 1 } }
            : state.runtimeMontageRequests,
        runtimeSoundQueue: playing && inv.switchSoundId ? [...state.runtimeSoundQueue, inv.switchSoundId] : state.runtimeSoundQueue,
        isDirty: playing ? state.isDirty : true,
      };
    });
    // Ranged gate + aim pose follow the equipped slot (RangedMode is target-able by the shooting graph).
    if (get().isPlaying) {
      const controller = get().animatorControllers.find((c) => c.id === player.animator?.controllerId);
      const ranged = controller?.parameters.find((p) => p.name === 'RangedMode');
      if (ranged) get().setRuntimeAnimatorParam(objectId, ranged.id, Boolean(slot.ranged));
    }
  },
  updateRenderSettings: (patch) =>
    set((state) => ({ renderSettings: { ...state.renderSettings, ...stripUndefined(patch) }, isDirty: true })),
  setObjectLight: (objectId, patch) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) =>
          object.id === objectId
            ? { ...object, kind: 'light', light: { ...defaultLight(), ...object.light, ...stripUndefined(patch) } }
            : object,
        ),
      ),
    ),
  addParticles: (objectId, preset) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) =>
          object.id === objectId
            ? { ...object, particles: withParticleDefaults({ ...object.particles, ...(preset ? particlePresets[preset] : {}) }) }
            : object,
        ),
      ),
    ),
  updateParticles: (objectId, patch) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) =>
          object.id === objectId && object.particles
            ? { ...object, particles: { ...object.particles, ...stripUndefined(patch) } }
            : object,
        ),
      ),
    ),
  removeParticles: (objectId) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== objectId) return object;
          const next = { ...object };
          delete next.particles;
          return next;
        }),
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
  updateSkeletonRagdoll: (skeletonId, patch) =>
    set((state) => ({
      skeletons: state.skeletons.map((item) =>
        item.id === skeletonId ? { ...item, ragdoll: { ...defaultRagdollSettings(), ...item.ragdoll, ...patch } } : item,
      ),
      isDirty: true,
    })),
  setRagdollBody: (skeletonId, boneName, patch) =>
    set((state) => ({
      skeletons: state.skeletons.map((item) => {
        if (item.id !== skeletonId) return item;
        if (!item.boneNames.includes(boneName)) return item;
        const base = { ...defaultRagdollSettings(), ...item.ragdoll };
        const bodies = base.bodies ?? [];
        const existing = bodies.find((b) => b.boneName === boneName);
        const nextBodies = existing
          ? bodies.map((b) => (b.boneName === boneName ? { ...b, ...patch } : b))
          : [...bodies, { boneName, ...patch }];
        return { ...item, ragdoll: { ...base, bodies: nextBodies } };
      }),
      isDirty: true,
    })),
  removeRagdollBody: (skeletonId, boneName) =>
    set((state) => ({
      skeletons: state.skeletons.map((item) => {
        if (item.id !== skeletonId || !item.ragdoll) return item;
        return { ...item, ragdoll: { ...item.ragdoll, bodies: (item.ragdoll.bodies ?? []).filter((b) => b.boneName !== boneName) } };
      }),
      isDirty: true,
    })),
  generateRagdollBodies: (skeletonId) =>
    set((state) => ({
      skeletons: state.skeletons.map((item) => {
        if (item.id !== skeletonId) return item;
        const base = { ...defaultRagdollSettings(), ...item.ragdoll };
        let exclude: RegExp;
        try {
          exclude = new RegExp(base.excludePattern, 'i');
        } catch {
          exclude = new RegExp(defaultRagdollSettings().excludePattern, 'i');
        }
        // One default capsule body per non-excluded bone — a starting point the user/AI can tweak.
        const bodies = item.boneNames
          .filter((name) => !exclude.test(name))
          .map((boneName) => ({ boneName, enabled: true, shape: 'capsule' as const }));
        return { ...item, ragdoll: { ...base, bodies } };
      }),
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
    const idleId = pick(/^idle_loop/i, /idle.*loop/i, /^idle/i, /loop/i);
    const walkId = pick(/^walk_loop/i, /walk.*loop/i, /^walk/i);
    // Three move tiers: Walk (slow) → Jog (normal) → Sprint (fast). Falls back gracefully if some are absent.
    const runId = pick(/jog.*fwd.*loop/i, /jog.*loop/i, /run.*loop/i, /run/i);
    const sprintId = pick(/sprint.*loop/i, /sprint/i);
    const kickId = pick(/^kick$/i, /kick/i);
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
    // Directional + crawl sources (strafe blend space + crawl traversal). Added after the index lookups above.
    const moveXParamId = makeId('param');
    const moveYParamId = makeId('param');
    const crawlParamId = makeId('param');
    const swimParamId = makeId('param');
    const climbParamId = makeId('param');
    parameters.push(
      { id: moveXParamId, name: 'MoveX', type: 'float', source: 'moveX', defaultValue: 0 },
      { id: moveYParamId, name: 'MoveY', type: 'float', source: 'moveY', defaultValue: 0 },
      { id: crawlParamId, name: 'Crawling', type: 'bool', source: 'crawling', defaultValue: false },
      { id: swimParamId, name: 'Swimming', type: 'bool', source: 'swimming', defaultValue: false },
      { id: climbParamId, name: 'Climbing', type: 'bool', source: 'climbing', defaultValue: false },
    );
    // PRECISE underscore-anchored picks so directional clips don't collide (loose /jog.*fwd.*loop/ matches
    // BOTH "Jog_Fwd_Loop" and "Jog_Fwd_L_Loop" → duplicate samples → one overwrites the other's weight → A-pose).
    // Each direction must resolve to a DISTINCT clip.
    const jogFwd = pick(/jog_fwd_loop/i) ?? runId; // straight forward
    const jogBwd = pick(/jog_bwd_loop/i);
    const jogLeftId = pick(/jog_left_loop/i);
    const jogRightId = pick(/jog_right_loop/i);
    const jogFwdL = pick(/jog_fwd_l_loop/i, /jog_fwd_leanl_loop/i);
    const jogFwdR = pick(/jog_fwd_r_loop/i, /jog_fwd_leanr_loop/i);
    const jogBwdL = pick(/jog_bwd_l_loop/i);
    const jogBwdR = pick(/jog_bwd_r_loop/i);
    const crawlIdleId = pick(/crawl.*idle.*loop/i, /crawl.*idle/i);
    const crawlFwdId = pick(/crawl.*fwd.*loop/i, /crawl.*loop/i);
    // Traversal modes: swim (in a water volume) + climb (on a climb volume). Each is a BLEND SPACE so it
    // eases between a stationary pose and the moving stroke/climb (no hard pop, idle when not moving).
    const swimIdleId = pick(/swim.*idle.*loop/i, /tread.*water/i, /swim.*idle/i);
    const swimFwdId = pick(/swim.*fwd.*loop/i, /swim.*forward/i, /swim.*loop/i);
    const climbIdleId = pick(/climb.*idle.*loop/i, /climb.*idle/i, /hang.*idle/i);
    const climbUpId = pick(/climb.*up.*loop/i, /climb.*up/i, /climb.*loop/i);
    const climbDownId = pick(/climb.*down.*loop/i, /climb.*down/i);
    // Strafe locomotion needs at least forward + the two sides; otherwise fall back to 1D speed locomotion.
    const strafeMode = Boolean(jogFwd && jogLeftId && jogRightId);
    const states: AnimatorState[] = [];
    const stateId: Record<string, string> = {};
    const layout: Record<string, { x: number; y: number }> = {
      idle: { x: 60, y: 40 },
      walk: { x: 320, y: 40 },
      run: { x: 580, y: 40 },
      sprint: { x: 840, y: 40 },
      kick: { x: 60, y: 700 },
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
    // Locomotion blend space. STRAFE mode (when 8-way jog clips exist): a 2D blend over MoveX × MoveY so the
    // character faces the camera and blends directional jogs (Unreal-style). Otherwise a 1D blend over Speed
    // (idle→walk→jog→sprint). Either way it's one smooth state with no popping.
    if (strafeMode) {
      const dir = [
        idleId && { animationId: idleId, value: 0, y: 0 },
        jogFwd && { animationId: jogFwd, value: 0, y: 1 },
        jogBwd && { animationId: jogBwd, value: 0, y: -1 },
        jogLeftId && { animationId: jogLeftId, value: -1, y: 0 },
        jogRightId && { animationId: jogRightId, value: 1, y: 0 },
        jogFwdL && { animationId: jogFwdL, value: -0.7, y: 0.7 },
        jogFwdR && { animationId: jogFwdR, value: 0.7, y: 0.7 },
        jogBwdL && { animationId: jogBwdL, value: -0.7, y: -0.7 },
        jogBwdR && { animationId: jogBwdR, value: 0.7, y: -0.7 },
      ].filter(Boolean) as { animationId: string; value: number; y: number }[];
      const id = makeId('state');
      stateId.locomotion = id;
      states.push({
        id,
        name: 'Locomotion',
        animationId: idleId ?? dir[0].animationId,
        speed: 1,
        loop: true,
        position: layout.idle,
        blendParameterId: moveXParamId,
        blendParameterIdY: moveYParamId,
        blendSamples: dir,
      });
    } else {
      const locoSamples = [
        idleId && { animationId: idleId, value: 0 },
        walkId && { animationId: walkId, value: 1.5 },
        runId && { animationId: runId, value: 3.4 },
        sprintId && { animationId: sprintId, value: 6.8 },
      ].filter(Boolean) as { animationId: string; value: number }[];
      if (locoSamples.length) {
        const id = makeId('state');
        stateId.locomotion = id;
        states.push({
          id,
          name: 'Locomotion',
          animationId: idleId ?? locoSamples[0].animationId,
          speed: 1,
          loop: true,
          position: layout.idle,
          blendParameterId: speedParamId,
          blendSamples: locoSamples,
        });
      }
    }
    addState('jumpStart', 'Jump Start', jumpStartId, false);
    addState('jumpLoop', 'Jump Loop', jumpLoopId, true);
    addState('jumpLand', 'Jump Land', jumpLandId, false);
    addState('jump', 'Jump', jumpId, false);
    addState('crouchIdle', 'Crouch Idle', crouchIdleId);
    addState('crouchWalk', 'Crouch Walk', crouchWalkId);
    addState('crawlIdle', 'Crawl Idle', crawlIdleId);
    addState('crawlFwd', 'Crawl', crawlFwdId);
    // Swim — 1D blend over Speed: float/tread when still, stroke forward as horizontal speed rises.
    const swimSamples = [
      swimIdleId && { animationId: swimIdleId, value: 0 },
      swimFwdId && { animationId: swimFwdId, value: 3 },
    ].filter(Boolean) as { animationId: string; value: number }[];
    if (swimSamples.length) {
      const id = makeId('state');
      stateId.swim = id;
      states.push({
        id,
        name: 'Swim',
        animationId: swimIdleId ?? swimSamples[0].animationId,
        speed: 1,
        loop: true,
        position: { x: 840, y: 380 },
        blendParameterId: speedParamId,
        blendSamples: swimSamples,
      });
    }
    // Climb — 1D blend over VerticalSpeed: descend (−) ↔ cling (0) ↔ ascend (+), so it reverses on the way down.
    const climbSamples = [
      climbDownId && { animationId: climbDownId, value: -1.5 },
      climbIdleId && { animationId: climbIdleId, value: 0 },
      climbUpId && { animationId: climbUpId, value: 1.5 },
    ].filter(Boolean) as { animationId: string; value: number }[];
    if (climbSamples.length) {
      const id = makeId('state');
      stateId.climb = id;
      states.push({
        id,
        name: 'Climb',
        animationId: climbIdleId ?? climbSamples[0].animationId,
        speed: 1,
        loop: true,
        position: { x: 840, y: 540 },
        blendParameterId: vspeedParamId,
        blendSamples: climbSamples,
      });
    }
    addState('roll', 'Roll', rollId, false);
    addState('punch', 'Punch', punchId, false);
    addState('kick', 'Kick', kickId, false);
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
    const groundStates = ['locomotion', 'crouchIdle', 'crouchWalk'];
    const airKey = stateId.jumpLoop ? 'jumpLoop' : stateId.jumpStart ? 'jumpStart' : undefined;
    if (stateId.jumpStart || stateId.jumpLoop) {
      // Take-off only from grounded states (not "any") so the airborne loop never bounces back to Start.
      const entry = stateId.jumpStart ? 'jumpStart' : 'jumpLoop';
      groundStates.forEach((from) => link(from, entry, [C(vspeedParamId, '>', 1)], 0.08));
      // Start clip plays out, then the airborne loop.
      // Blend to the airborne loop partway through the launch clip so it doesn't wait the full wind-up.
      if (stateId.jumpStart && stateId.jumpLoop) linkExit('jumpStart', 'jumpLoop', [], 0.12, 0.5);
      // Short hop: if we land while still in the start clip, recover instead of waiting.
      if (stateId.jumpStart) link('jumpStart', stateId.jumpLand ? 'jumpLand' : 'locomotion', [C(groundedParamId, '==', true)], 0.1);
      // Land when we touch ground again. If you touch down ALREADY MOVING, skip the land plant and go straight
      // to locomotion (push this first so it wins); land stationary and the plant clip plays.
      if (stateId.jumpLand && airKey) {
        link(airKey, 'locomotion', [C(groundedParamId, '==', true), C(speedParamId, '>', 0.1)], 0.12);
        link(airKey, 'jumpLand', [C(groundedParamId, '==', true)], 0.1);
      }
      // Out of the land plant: starting to move INTERRUPTS it immediately (no exit time) so it never overstays;
      // if you just stand there it still recovers partway through the clip rather than waiting for the full end.
      if (stateId.jumpLand) {
        link('jumpLand', 'locomotion', [C(speedParamId, '>', 0.1)]);
        linkExit('jumpLand', 'locomotion', [], 0.12, 0.45);
      } else if (airKey) link(airKey, 'locomotion', [C(groundedParamId, '==', true)]);
    } else if (stateId.jump) {
      groundStates.forEach((from) => link(from, 'jump', [C(vspeedParamId, '>', 1)], 0.1));
      link('jump', 'locomotion', [C(groundedParamId, '==', true)]);
    }
    // --- Roll/dodge: enter from grounded states while Rolling, return to locomotion when it ends. ---
    if (stateId.roll) {
      groundStates.forEach((from) => link(from, 'roll', [C(rollParamId, '==', true)], 0.08));
      link('roll', 'locomotion', [C(rollParamId, '==', false)]);
    }
    // --- Attack: sword swing when a weapon is equipped, otherwise a punch; clip plays out, then locomotion. ---
    if (stateId.swordAttack) {
      groundStates.forEach((from) => link(from, 'swordAttack', [C(attackParamId, '==', true), C(weaponParamId, '==', true)], 0.08));
      linkExit('swordAttack', 'locomotion');
    }
    // Unarmed: a running attack (moving fast) plays a Kick; standing plays a Punch. Evaluated before
    // punch so the speed>4 case wins. Both require the weapon to be unequipped (when a sword exists).
    const unarmed = stateId.swordAttack ? [C(weaponParamId, '==', false)] : [];
    if (stateId.kick) {
      groundStates.forEach((from) => link(from, 'kick', [C(attackParamId, '==', true), C(speedParamId, '>', 4), ...unarmed], 0.08));
      linkExit('kick', 'locomotion');
    }
    if (stateId.punch) {
      groundStates.forEach((from) => link(from, 'punch', [C(attackParamId, '==', true), ...unarmed], 0.08));
      linkExit('punch', 'locomotion');
    }
    // Crouch: enter the crouch states while crouching, return to the locomotion blend space when released.
    if (stateId.crouchIdle || stateId.crouchWalk) {
      linkAny('crouchWalk', [C(crouchParamId, '==', true), C(speedParamId, '>', 0.1)]);
      linkAny('crouchIdle', [C(crouchParamId, '==', true), C(speedParamId, '<', 0.1)]);
      link('crouchIdle', 'crouchWalk', [C(speedParamId, '>', 0.1)]);
      link('crouchWalk', 'crouchIdle', [C(speedParamId, '<', 0.1)]);
      link('crouchIdle', 'locomotion', [C(crouchParamId, '==', false)]);
      link('crouchWalk', 'locomotion', [C(crouchParamId, '==', false)]);
    }
    // Crawl (traversal): hold the crawl key → drop to crawl idle/move, release → back to locomotion.
    if (stateId.crawlIdle || stateId.crawlFwd) {
      linkAny('crawlFwd', [C(crawlParamId, '==', true), C(speedParamId, '>', 0.1)]);
      linkAny('crawlIdle', [C(crawlParamId, '==', true), C(speedParamId, '<', 0.1)]);
      if (stateId.crawlIdle && stateId.crawlFwd) {
        link('crawlIdle', 'crawlFwd', [C(speedParamId, '>', 0.1)]);
        link('crawlFwd', 'crawlIdle', [C(speedParamId, '<', 0.1)]);
      }
      link('crawlIdle', 'locomotion', [C(crawlParamId, '==', false)]);
      link('crawlFwd', 'locomotion', [C(crawlParamId, '==', false)]);
    }
    // Swim / climb traversal modes (entered while inside a water / climb volume; highest priority via "any").
    if (stateId.swim) {
      linkAny('swim', [C(swimParamId, '==', true)], 0.15);
      link('swim', 'locomotion', [C(swimParamId, '==', false)], 0.15);
    }
    if (stateId.climb) {
      linkAny('climb', [C(climbParamId, '==', true)], 0.15);
      link('climb', 'locomotion', [C(climbParamId, '==', false)], 0.15);
    }
    // (Speed tiers are handled inside the Locomotion blend space — no discrete tier transitions.)

    const controllerId = makeId('animctl');
    const defaultStateId = stateId.locomotion ?? stateId.idle ?? states[0].id;
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
      // Strafe mode (faces camera + 8-way move) when the rig has directional jogs for the 2D blend space.
      character: { ...defaultCharacter(), enabled: true, rollDuration, rollSpeed, jumpStrength: 6, strafe: strafeMode },
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
  addGameplayKit: (objectId, kit) => {
    let summary = '';
    set((draft) => {
      const object = selectActiveObjects(draft).find((o) => o.id === objectId);
      const controller = draft.animatorControllers.find((c) => c.id === object?.animator?.controllerId);
      if (!object || !controller) return draft;
      const clips = draft.animations.filter((a) => a.skeletonId === controller.skeletonId);
      const pick = (...patterns: RegExp[]) => {
        for (const p of patterns) {
          const f = clips.find((c) => p.test(c.name));
          if (f) return f.id;
        }
        return undefined;
      };
      const params = [...controller.parameters];
      const states = [...controller.states];
      const transitions = [...controller.transitions];
      let nextVariables = draft.variables;
      const C = (parameterId: string, op: AnimatorCondition['op'], value: number | boolean): AnimatorCondition => ({ parameterId, op, value });
      const ensureParam = (name: string, type: AnimatorParameter['type'], source: AnimatorParameter['source'], defaultValue: number | boolean, variableId?: string) => {
        let p = params.find((x) => x.name === name);
        if (!p) {
          p = { id: makeId('param'), name, type, source, defaultValue, ...(variableId ? { variableId } : {}) };
          params.push(p);
        }
        return p.id;
      };
      // "Home" = the locomotion idle we return action states to.
      const homeId = (
        states.find((s) => /^idle$/i.test(s.name)) ??
        states.find((s) => /idle/i.test(s.name) && !/pistol|crouch/i.test(s.name)) ??
        states.find((s) => s.id === controller.defaultStateId) ??
        states[0]
      ).id;
      let placeX = 60;
      let placeY = 760;
      const addState = (name: string, animationId: string | undefined, loop: boolean) => {
        if (!animationId) return undefined;
        const existing = states.find((s) => s.name === name);
        if (existing) return existing.id;
        const id = makeId('state');
        states.push({ id, name, animationId, speed: 1, loop, position: { x: placeX, y: placeY } });
        placeX += 240;
        if (placeX > 820) {
          placeX = 60;
          placeY += 160;
        }
        return id;
      };
      const link = (from: string, to: string, conds: AnimatorCondition[], duration = 0.12) =>
        transitions.push({ id: makeId('xition'), from, to, conditions: conds, duration });
      const linkAny = (to: string, conds: AnimatorCondition[], duration = 0.12) =>
        transitions.push({ id: makeId('xition'), from: 'any', to, conditions: conds, duration });
      const linkExit = (from: string, to: string, conds: AnimatorCondition[] = [], exitTime = 0.9) =>
        transitions.push({ id: makeId('xition'), from, to, conditions: conds, duration: 0.12, hasExitTime: true, exitTime });

      if (kit === 'ranged') {
        const aiming = ensureParam('Aiming', 'bool', 'aiming', false);
        const reloading = ensureParam('Reloading', 'bool', 'reloading', false);
        const attacking = ensureParam('Attacking', 'bool', 'attacking', false);
        const ranged = ensureParam('RangedMode', 'bool', 'manual', false);
        const pistolIdle = addState('Pistol Idle', pick(/pistol.*idle/i), true);
        const aim = addState('Aim', pick(/pistol.*aim.*neutral/i, /pistol.*aim/i), true);
        const shoot = addState('Shoot', pick(/pistol.*shoot/i), false);
        const reload = addState('Reload', pick(/pistol.*reload/i), false);
        if (pistolIdle) {
          const meleeStateIds = new Set(
            states.filter((state) => /sword attack|punch|kick/i.test(state.name)).map((state) => state.id),
          );
          transitions.forEach((transition) => {
            if (!meleeStateIds.has(transition.to)) return;
            if (transition.conditions.some((condition) => condition.parameterId === ranged)) return;
            transition.conditions = [...transition.conditions, C(ranged, '==', false)];
          });
          const linkFirst = (from: string, to: string, conds: AnimatorCondition[], duration = 0.08) =>
            transitions.unshift({ id: makeId('xition'), from, to, conditions: conds, duration });
          link(homeId, pistolIdle, [C(ranged, '==', true)]);
          link(pistolIdle, homeId, [C(ranged, '==', false)]);
          if (aim) {
            link(pistolIdle, aim, [C(aiming, '==', true)]);
            link(aim, pistolIdle, [C(aiming, '==', false)]);
          }
          if (shoot) {
            linkFirst(homeId, shoot, [C(ranged, '==', true), C(attacking, '==', true)]);
            link(pistolIdle, shoot, [C(attacking, '==', true)]);
            if (aim) link(aim, shoot, [C(attacking, '==', true)]);
            linkExit(shoot, aim ?? pistolIdle);
          }
          if (reload) {
            link(pistolIdle, reload, [C(reloading, '==', true)]);
            if (aim) link(aim, reload, [C(reloading, '==', true)]);
            linkExit(reload, pistolIdle);
          }
          summary = 'ranged pistol (aim/shoot/reload)';
        }
      } else if (kit === 'health') {
        let healthVar = draft.variables.find((v) => v.name === 'Health');
        if (!healthVar) {
          healthVar = { id: makeId('var'), name: 'Health', type: 'number', defaultValue: 100, persistent: false, createdAt: Date.now() };
          nextVariables = [...draft.variables, healthVar];
        }
        const health = ensureParam('Health', 'float', 'variable', 100, healthVar.id);
        const hit = ensureParam('Hit', 'trigger', 'manual', false);
        const hitState = addState('Hit React', pick(/hit.*chest/i, /hit.*head/i, /hit/i), false);
        const deathState = addState('Death', pick(/death/i, /\bdie\b/i), false);
        if (hitState) {
          linkAny(hitState, [C(hit, '==', true)]);
          linkExit(hitState, homeId);
        }
        // Entering a "Death" state auto-triggers the ragdoll (see tickRuntime).
        if (deathState) linkAny(deathState, [C(health, '<=', 0)]);
        summary = 'health + hit reactions + death→ragdoll';
      } else if (kit === 'interactions') {
        const interacting = ensureParam('Interacting', 'bool', 'interacting', false);
        const interact = addState('Interact', pick(/^interact$/i, /pick.?up/i, /interact/i, /fixing/i), false);
        if (interact) {
          link(homeId, interact, [C(interacting, '==', true)]);
          linkExit(interact, homeId);
          summary = 'interactions (use / pick up)';
        }
      } else if (kit === 'emotes') {
        const emoting = ensureParam('Emoting', 'bool', 'emoting', false);
        const dance = addState('Emote', pick(/dance/i, /talk/i), true);
        if (dance) {
          link(homeId, dance, [C(emoting, '==', true)]);
          link(dance, homeId, [C(emoting, '==', false)]);
          summary = 'emote (dance/wave)';
        }
      }

      if (!summary) return draft;
      const nextController: AnimatorController = { ...controller, parameters: params, states, transitions };
      return {
        variables: nextVariables,
        animatorControllers: draft.animatorControllers.map((c) => (c.id === controller.id ? nextController : c)),
        isDirty: true,
      };
    });
    return summary || undefined;
  },
  createCollectibleCounter: (options = {}) => {
    const rawVariableName = options.variableName?.trim() || 'Coins';
    const variableName = (/^[A-Za-z_][A-Za-z0-9_]*$/.test(rawVariableName) ? rawVariableName : rawVariableName.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z_]+/, '')) || 'Coins';
    const label = options.label?.trim() || variableName;
    const amount = options.amount ?? 1;
    const name = options.name?.trim() || `${label} Pickup`;
    const color = options.color ?? '#FFD166';
    const expressionLabel = label.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    let variable = get().variables.find((item) => item.name === variableName);
    if (!variable) {
      const id = get().createVariable(variableName, 'number', false);
      get().updateVariable(id, { defaultValue: 0 });
      variable = get().variables.find((item) => item.id === id);
    }
    const variableId = variable?.id ?? get().createVariable(variableName, 'number', false);

    const findCounter = (element: UIElement): string | undefined => {
      if (element.bindings.some((binding) => binding.target === 'text' && binding.expression.includes(variableName))) {
        return element.id;
      }
      for (const child of element.children) {
        const found = findCounter(child);
        if (found) return found;
      }
      return undefined;
    };

    let uiDocument =
      get().uiDocuments.find((doc) => doc.surface === 'screen' && doc.name.toLowerCase() === `${label.toLowerCase()} hud`) ??
      get().uiDocuments.find((doc) => doc.surface === 'screen' && doc.name.toLowerCase() === 'hud') ??
      get().uiDocuments.find((doc) => doc.surface === 'screen');
    if (!uiDocument) {
      const docId = get().createUIDocument(`${label} HUD`, 'screen');
      uiDocument = get().uiDocuments.find((doc) => doc.id === docId);
    }
    const uiDocumentId = uiDocument?.id ?? get().createUIDocument(`${label} HUD`, 'screen');
    const currentDoc = get().uiDocuments.find((doc) => doc.id === uiDocumentId);
    let counterElementId = currentDoc ? findCounter(currentDoc.root) : undefined;
    if (!counterElementId) {
      counterElementId = get().addUIElement(uiDocumentId, undefined, 'text');
      get().updateUIElement(uiDocumentId, counterElementId, {
        name: `${label} Counter`,
        text: `${label}: 0`,
        style: {
          color: '#ffffff',
          fontSize: '20px',
          fontWeight: '700',
          custom: { textShadow: '0 2px 6px rgba(0,0,0,0.65)' },
        },
      });
      get().setUIBinding(uiDocumentId, counterElementId, 'text', `'${expressionLabel}: ' + ${variableName}`);
    }

    const objectId = get().createObjectWithProps('sphere', {
      name,
      position: options.position ?? [0, 1, 0],
      color,
      physics: { enabled: true, bodyType: 'fixed', collider: 'sphere', isTrigger: true, gravityScale: 0 },
    });
    get().updateTransform(objectId, 'scale', [0.35, 0.35, 0.35]);

    const { blueprintId } = get().createBlueprintNamed(`${name} Pickup Logic`, `Adds ${amount} to ${variableName} and removes the pickup.`);
    const triggerId = get().addGraphNodeToBlueprint(
      blueprintId,
      'Trigger Enter',
      'Events',
      { otherObjectId: options.playerObjectId },
      { x: 80, y: 180 },
    );
    const getId = get().addGraphNodeToBlueprint(blueprintId, 'Get Variable', 'Variables', { variableId }, { x: 80, y: 360 });
    const amountId = get().addGraphNodeToBlueprint(blueprintId, 'Number', 'Values', { numberValue: amount }, { x: 80, y: 500 });
    const addId = get().addGraphNodeToBlueprint(blueprintId, 'Add', 'Math', {}, { x: 320, y: 420 });
    const setId = get().addGraphNodeToBlueprint(blueprintId, 'Set Variable', 'Variables', { variableId }, { x: 560, y: 240 });
    const destroyId = get().addGraphNodeToBlueprint(blueprintId, 'Destroy Object', 'Runtime', {}, { x: 800, y: 240 });
    get().connectGraphNodes(blueprintId, triggerId, setId);
    get().connectGraphNodes(blueprintId, setId, destroyId);
    get().connectGraphNodes(blueprintId, getId, addId, 'value-out', 'a');
    get().connectGraphNodes(blueprintId, amountId, addId, 'value-out', 'b');
    get().connectGraphNodes(blueprintId, addId, setId, 'value-out', 'value');
    get().attachScript(objectId, blueprintId);
    get().setActiveBlueprint(blueprintId);

    return { objectId, blueprintId, variableId, uiDocumentId, counterElementId };
  },
  createCinematic: (name = 'New Cinematic', duration = 8) => {
    const id = makeId('cinematic');
    const sequence: CinematicSequence = {
      id,
      name,
      duration: Math.max(0.5, duration),
      skippable: true,
      actions: [],
      createdAt: Date.now(),
    };
    set((state) => ({
      scenes: state.scenes.map((scene) =>
        scene.id === state.activeSceneId ? { ...scene, cinematics: [...(scene.cinematics ?? []), sequence] } : scene,
      ),
      activeCinematicId: id,
      isDirty: true,
    }));
    return id;
  },
  updateCinematic: (id, patch) =>
    set((state) => ({
      scenes: state.scenes.map((scene) => ({
        ...scene,
        cinematics: (scene.cinematics ?? []).map((cinematic) =>
          cinematic.id === id ? { ...cinematic, ...stripUndefined(patch), duration: Math.max(0.5, patch.duration ?? cinematic.duration) } : cinematic,
        ),
      })),
      isDirty: true,
    })),
  deleteCinematic: (id) =>
    set((state) => ({
      scenes: state.scenes.map((scene) => ({
        ...scene,
        cinematics: (scene.cinematics ?? []).filter((cinematic) => cinematic.id !== id),
      })),
      activeCinematicId: state.activeCinematicId === id ? '' : state.activeCinematicId,
      runtimeCinematic: state.runtimeCinematic?.sequenceId === id ? undefined : state.runtimeCinematic,
      runtimeCinematicCamera: state.runtimeCinematic?.sequenceId === id ? undefined : state.runtimeCinematicCamera,
      runtimeCinematicFade: state.runtimeCinematic?.sequenceId === id ? undefined : state.runtimeCinematicFade,
      editorCinematicPreview: state.editorCinematicPreview?.sequenceId === id ? undefined : state.editorCinematicPreview,
      editorCinematicPreviewCamera: state.editorCinematicPreview?.sequenceId === id ? undefined : state.editorCinematicPreviewCamera,
      editorCinematicPreviewFade: state.editorCinematicPreview?.sequenceId === id ? undefined : state.editorCinematicPreviewFade,
      editorCinematicPreviewTransforms: state.editorCinematicPreview?.sequenceId === id ? {} : state.editorCinematicPreviewTransforms,
      editorCinematicPreviewHidden: state.editorCinematicPreview?.sequenceId === id ? [] : state.editorCinematicPreviewHidden,
      isDirty: true,
    })),
  setActiveCinematic: (id) =>
    set((state) =>
      state.editorCinematicPreview && state.editorCinematicPreview.sequenceId !== id
        ? {
            activeCinematicId: id,
            editorCinematicPreview: undefined,
            editorCinematicPreviewCamera: undefined,
            editorCinematicPreviewFade: undefined,
            editorCinematicPreviewTransforms: {},
            editorCinematicPreviewHidden: [],
          }
        : { activeCinematicId: id },
    ),
  addCinematicAction: (cinematicId, action) => {
    const actionId = makeId('caction');
    set((state) => {
      let found = false;
      const scenes = state.scenes.map((scene) => ({
        ...scene,
        cinematics: (scene.cinematics ?? []).map((cinematic) => {
          if (cinematic.id !== cinematicId) return cinematic;
          found = true;
          const nextAction: CinematicAction = { ...action, id: actionId, time: Math.max(0, action.time) };
          const actions = [...cinematic.actions, nextAction].sort((a, b) => a.time - b.time);
          const duration = Math.max(cinematic.duration, nextAction.time + (nextAction.duration ?? 0.1));
          return { ...cinematic, actions, duration };
        }),
      }));
      return found ? { scenes, isDirty: true } : state;
    });
    return get().activeScene()?.cinematics?.some((cinematic) => cinematic.id === cinematicId) ? actionId : undefined;
  },
  updateCinematicAction: (cinematicId, actionId, patch) =>
    set((state) => ({
      scenes: state.scenes.map((scene) => ({
        ...scene,
        cinematics: (scene.cinematics ?? []).map((cinematic) =>
          cinematic.id === cinematicId
            ? {
                ...cinematic,
                actions: cinematic.actions
                  .map((action) => (action.id === actionId ? { ...action, ...stripUndefined(patch), time: Math.max(0, patch.time ?? action.time) } : action))
                  .sort((a, b) => a.time - b.time),
              }
            : cinematic,
        ),
      })),
      isDirty: true,
    })),
  removeCinematicAction: (cinematicId, actionId) =>
    set((state) => ({
      scenes: state.scenes.map((scene) => ({
        ...scene,
        cinematics: (scene.cinematics ?? []).map((cinematic) =>
          cinematic.id === cinematicId ? { ...cinematic, actions: cinematic.actions.filter((action) => action.id !== actionId) } : cinematic,
        ),
      })),
      isDirty: true,
    })),
  addCinematicCameraKeyframe: (cinematicId, time, pose) => {
    const cinematic = get().activeScene()?.cinematics?.find((item) => item.id === cinematicId);
    if (!cinematic) return undefined;
    const frame: CinematicCameraKeyframe = {
      time: Number(Math.max(0, time).toFixed(3)),
      position: [...pose.position],
      lookAt: [...pose.lookAt],
      fov: Math.round(pose.fov),
    };
    const track = cinematic.actions.find((action) => action.type === 'camera' && action.keyframes?.length);
    let actionId = track?.id;
    if (!track) {
      actionId = get().addCinematicAction(cinematicId, { type: 'camera', time: frame.time, duration: 0.5, label: 'Camera track', ease: 'smooth', keyframes: [frame] });
    }
    if (!actionId) return undefined;
    const existing = track?.keyframes ?? [frame];
    const merged = [...existing.filter((keyframe) => Math.abs(keyframe.time - frame.time) > 0.06), frame].sort((a, b) => a.time - b.time);
    const minTime = Math.min(0, ...merged.map((keyframe) => keyframe.time));
    const maxTime = Math.max(0.5, ...merged.map((keyframe) => keyframe.time));
    get().updateCinematicAction(cinematicId, actionId, { keyframes: merged, time: minTime, duration: Math.max(0.5, maxTime - minTime) });
    const preview = get().editorCinematicPreview;
    if (preview?.sequenceId === cinematicId) get().previewCinematic(cinematicId, preview.time);
    return actionId;
  },
  addCinematicTransformKeyframe: (cinematicId, objectId, time, transform) => {
    const cinematic = get().activeScene()?.cinematics?.find((item) => item.id === cinematicId);
    if (!cinematic) return undefined;
    const object = selectActiveObjects(get()).find((item) => item.id === objectId);
    const pose = transform ?? object?.transform;
    if (!pose) return undefined;
    const frame: CinematicTransformKeyframe = {
      time: Number(Math.max(0, time).toFixed(3)),
      position: [...pose.position],
      rotation: [...pose.rotation],
      scale: [...pose.scale],
    };
    const track = cinematic.actions.find((action) => action.type === 'transform' && action.objectId === objectId && action.transformKeyframes);
    let actionId = track?.id;
    if (!track) {
      actionId = get().addCinematicAction(cinematicId, {
        type: 'transform',
        objectId,
        time: frame.time,
        duration: 0.5,
        label: `Animate ${object?.name ?? 'object'}`,
        ease: 'smooth',
        transformKeyframes: [frame],
      });
    }
    if (!actionId) return undefined;
    const existing = track?.transformKeyframes ?? [frame];
    const merged = [...existing.filter((keyframe) => Math.abs(keyframe.time - frame.time) > 0.06), frame].sort((a, b) => a.time - b.time);
    const minTime = Math.min(0, ...merged.map((keyframe) => keyframe.time));
    const maxTime = Math.max(0.5, ...merged.map((keyframe) => keyframe.time));
    get().updateCinematicAction(cinematicId, actionId, { transformKeyframes: merged, time: minTime, duration: Math.max(0.5, maxTime - minTime) });
    const preview = get().editorCinematicPreview;
    if (preview?.sequenceId === cinematicId) get().previewCinematic(cinematicId, preview.time);
    return actionId;
  },
  setCinematicRecording: (recording) =>
    set((state) => {
      if (!recording) return { cinematicRecording: false };
      // Turning Record on implies an active preview so the playhead has a position to key against.
      const cinematicId = state.activeCinematicId || state.scenes.find((scene) => scene.id === state.activeSceneId)?.cinematics?.[0]?.id;
      if (cinematicId && !state.editorCinematicPreview) {
        queueMicrotask(() => get().previewCinematic(cinematicId, 0));
      }
      return { cinematicRecording: true };
    }),
  previewCinematic: (cinematicId, time) =>
    set((state) => {
      if (state.isPlaying) return state;
      const scene = state.scenes.find((item) => item.id === state.activeSceneId);
      const sequence = scene?.cinematics?.find((cinematic) => cinematic.id === cinematicId);
      if (!sequence) return state;
      const previewTime = Math.min(Math.max(time, 0), sequence.duration);
      const objects = scene?.objects ?? [];
      return {
        editorCinematicPreview: { sequenceId: cinematicId, time: previewTime },
        editorCinematicPreviewCamera: cinematicCameraAt(sequence, objects, previewTime),
        editorCinematicPreviewFade: cinematicFadeAt(sequence, previewTime),
        editorCinematicPreviewTransforms: cinematicTransformsAt(sequence, objects, previewTime),
        editorCinematicPreviewHidden: cinematicHiddenAt(sequence, previewTime),
      };
    }),
  clearCinematicPreview: () =>
    set((state) =>
      state.editorCinematicPreview
        ? {
            editorCinematicPreview: undefined,
            editorCinematicPreviewCamera: undefined,
            editorCinematicPreviewFade: undefined,
            editorCinematicPreviewTransforms: {},
            editorCinematicPreviewHidden: [],
          }
        : state,
    ),
  playCinematic: (cinematicId) => {
    const current = get();
    if (!current.isPlaying) {
      current.setPlaying(true);
      if (!get().isPlaying) return;
    }

    set((state) => {
      const scene = state.scenes.find((item) => item.id === state.activeSceneId);
      const sequence = scene?.cinematics?.find((cinematic) => cinematic.id === cinematicId);
      if (!sequence) return state;
      return {
        runtimeCinematic: { sequenceId: cinematicId, time: 0, firedActionIds: [], spawnedObjectIds: [] },
        runtimeCinematicCamera: initialCinematicCamera(sequence, scene?.objects ?? []),
        runtimeCinematicFade: initialCinematicFade(sequence),
      };
    });
  },
  stopCinematic: () =>
    set((state) => {
      const spawnedIds = new Set(state.runtimeCinematic?.spawnedObjectIds ?? []);
      return {
        scenes: spawnedIds.size
          ? state.scenes.map((scene) => (scene.id === state.activeSceneId ? { ...scene, objects: scene.objects.filter((object) => !spawnedIds.has(object.id)) } : scene))
          : state.scenes,
        runtimeCinematic: undefined,
        runtimeCinematicCamera: undefined,
        runtimeCinematicFade: undefined,
      };
    }),
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
        prefabs: state.prefabs.map((prefab) =>
          prefab.folderId === id ? { ...prefab, folderId: parentId } : prefab,
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
        : kind === 'particleSystem'
          ? {
              particleSystems: state.particleSystems.map((system) => (system.id === id ? { ...system, folderId } : system)),
              isDirty: true,
            }
        : kind === 'uiDocument'
          ? {
              uiDocuments: state.uiDocuments.map((doc) => (doc.id === id ? { ...doc, folderId } : doc)),
              isDirty: true,
            }
        : kind === 'prefab'
          ? {
              prefabs: state.prefabs.map((prefab) => (prefab.id === id ? { ...prefab, folderId } : prefab)),
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
  // --- Reusable particle-system assets ---
  createParticleSystem: (name, preset, folderId) => {
    const id = makeId('psys');
    set((state) => {
      const systemName = name ?? `Particle System ${state.particleSystems.length + 1}`;
      const config: ParticleConfig = { ...defaultParticleConfig(), ...(preset ? particlePresets[preset] : {}) };
      return {
        particleSystems: [
          ...state.particleSystems,
          { id, name: systemName, description: 'Reusable particle system.', folderId, createdAt: Date.now(), ...config },
        ],
        activeParticleSystemId: id,
        isDirty: true,
      };
    });
    return id;
  },
  renameParticleSystem: (id, name) =>
    set((state) => ({
      particleSystems: state.particleSystems.map((system) => (system.id === id ? { ...system, name } : system)),
      isDirty: true,
    })),
  updateParticleSystem: (id, patch) =>
    set((state) => ({
      particleSystems: state.particleSystems.map((system) => (system.id === id ? { ...system, ...stripUndefined(patch) } : system)),
      isDirty: true,
    })),
  deleteParticleSystem: (id) =>
    set((state) => ({
      particleSystems: state.particleSystems.filter((item) => item.id !== id),
      activeParticleSystemId:
        state.activeParticleSystemId === id ? state.particleSystems.find((p) => p.id !== id)?.id ?? '' : state.activeParticleSystemId,
      // Detach the emitter from any object referencing the removed asset.
      scenes: state.scenes.map((scene) => ({
        ...scene,
        objects: scene.objects.map((object) => {
          if (object.particles?.systemId !== id) return object;
          const next = { ...object };
          delete next.particles;
          return next;
        }),
      })),
      isDirty: true,
    })),
  setActiveParticleSystem: (id) => set({ activeParticleSystemId: id }),
  setObjectParticleSystem: (objectId, systemId) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => {
          if (object.id !== objectId) return object;
          if (!systemId) {
            const next = { ...object };
            delete next.particles;
            return next;
          }
          const asset = state.particleSystems.find((p) => p.id === systemId);
          const config = asset ? particleAssetConfig(asset) : defaultParticleConfig();
          return { ...object, particles: { ...config, enabled: true, systemId } };
        }),
      ),
    ),
  // --- Game UI documents ---
  createUIDocument: (name, surface, folderId) => {
    const docName = name ?? `UI ${useEditorStore.getState().uiDocuments.length + 1}`;
    const doc = makeUIDocument(docName, surface ?? 'screen', folderId);
    set((state) => ({
      uiDocuments: [...state.uiDocuments, doc],
      activeUIDocumentId: doc.id,
      isDirty: true,
    }));
    return doc.id;
  },
  renameUIDocument: (id, name) =>
    set((state) => ({
      uiDocuments: state.uiDocuments.map((doc) => (doc.id === id ? { ...doc, name } : doc)),
      isDirty: true,
    })),
  updateUIDocument: (id, patch) =>
    set((state) => ({
      uiDocuments: state.uiDocuments.map((doc) => (doc.id === id ? { ...doc, ...patch } : doc)),
      isDirty: true,
    })),
  deleteUIDocument: (id) =>
    set((state) => ({
      uiDocuments: state.uiDocuments.filter((doc) => doc.id !== id),
      activeUIDocumentId:
        state.activeUIDocumentId === id ? state.uiDocuments.find((doc) => doc.id !== id)?.id ?? '' : state.activeUIDocumentId,
      // Clear dangling world-UI references so no object points at a removed document.
      scenes: state.scenes.map((scene) => ({
        ...scene,
        objects: scene.objects.map((object) =>
          object.ui?.documentId === id ? { ...object, ui: undefined } : object,
        ),
      })),
      isDirty: true,
    })),
  setActiveUIDocument: (id) => set({ activeUIDocumentId: id, selectedUIElementId: '' }),
  selectUIElement: (id) => set({ selectedUIElementId: id }),
  openUILogic: (docId) => {
    const state = get();
    const doc = state.uiDocuments.find((d) => d.id === docId);
    if (!doc) return '';
    // Reuse an existing logic blueprint if it's still around, else make one.
    let blueprintId = doc.logicBlueprintId && state.blueprints.some((b) => b.id === doc.logicBlueprintId) ? doc.logicBlueprintId : '';
    if (!blueprintId) {
      blueprintId = get().createBlueprintNamed(`${doc.name} Logic`, 'UI behaviour graph.').blueprintId;
      get().updateUIDocument(docId, { logicBlueprintId: blueprintId });
    }
    // Ensure something runs the graph: a tiny empty "UI Logic" object carrying this blueprint.
    const objects = selectActiveObjects(get());
    const hasController = objects.some((o) => o.script?.blueprintId === blueprintId);
    if (!hasController) {
      const objectId = get().createObjectWithProps('empty', { name: `${doc.name} UI Logic` });
      get().attachScript(objectId, blueprintId);
    }
    get().setActiveBlueprint(blueprintId);
    return blueprintId;
  },
  addUIElement: (docId, parentId, kind) => {
    const element = makeUIElement(kind);
    set((state) => ({
      uiDocuments: state.uiDocuments.map((doc) => {
        if (doc.id !== docId) return doc;
        const targetId = parentId ?? doc.root.id;
        return { ...doc, root: mapUIElement(doc.root, targetId, (el) => ({ ...el, children: [...el.children, element] })) };
      }),
      isDirty: true,
    }));
    return element.id;
  },
  updateUIElement: (docId, elementId, patch) =>
    set((state) => ({
      uiDocuments: state.uiDocuments.map((doc) =>
        doc.id === docId ? { ...doc, root: mapUIElement(doc.root, elementId, (el) => ({ ...el, ...patch })) } : doc,
      ),
      isDirty: true,
    })),
  removeUIElement: (docId, elementId) =>
    set((state) => ({
      uiDocuments: state.uiDocuments.map((doc) =>
        // Never remove the root element.
        doc.id === docId && doc.root.id !== elementId ? { ...doc, root: removeUIElementFromTree(doc.root, elementId) } : doc,
      ),
      isDirty: true,
    })),
  setUIBinding: (docId, elementId, target, expression) =>
    set((state) => ({
      uiDocuments: state.uiDocuments.map((doc) => {
        if (doc.id !== docId) return doc;
        return {
          ...doc,
          root: mapUIElement(doc.root, elementId, (el) => {
            const rest = el.bindings.filter((b) => b.target !== target);
            const bindings = expression.trim() ? [...rest, { target, expression }] : rest;
            return { ...el, bindings };
          }),
        };
      }),
      isDirty: true,
    })),
  addUIPreset: (docId, parentId, preset, options) => {
    // Data-bound presets reference a variable BY NAME; make sure it exists (create a number var if not).
    let variableName = options?.variableName ?? (preset === 'healthBar' ? 'health' : preset === 'counter' ? 'score' : '');
    if ((preset === 'healthBar' || preset === 'counter') && variableName) {
      const existing = get().variables.find((v) => v.name === variableName);
      if (!existing) {
        const id = get().createVariable(variableName, 'number', false);
        // Health defaults to 100 so the preview bar starts full.
        get().updateVariable(id, { defaultValue: preset === 'healthBar' ? 100 : 0 });
        variableName = get().variables.find((v) => v.id === id)?.name ?? variableName;
      }
    }
    const subtree = makeUIPreset(preset, variableName);
    set((state) => ({
      uiDocuments: state.uiDocuments.map((doc) => {
        if (doc.id !== docId) return doc;
        const targetId = parentId ?? doc.root.id;
        return { ...doc, root: mapUIElement(doc.root, targetId, (el) => ({ ...el, children: [...el.children, subtree] })) };
      }),
      isDirty: true,
    }));
    return subtree.id;
  },
  moveUIElement: (docId, elementId, dir) =>
    set((state) => ({
      uiDocuments: state.uiDocuments.map((doc) => {
        if (doc.id !== docId) return doc;
        const parent = findUIParent(doc.root, elementId);
        if (!parent) return doc; // root can't move
        const index = parent.children.findIndex((c) => c.id === elementId);
        const swap = dir === 'up' ? index - 1 : index + 1;
        if (swap < 0 || swap >= parent.children.length) return doc;
        const reordered = [...parent.children];
        [reordered[index], reordered[swap]] = [reordered[swap], reordered[index]];
        return { ...doc, root: mapUIElement(doc.root, parent.id, (el) => ({ ...el, children: reordered })) };
      }),
      isDirty: true,
    })),
  duplicateUIElement: (docId, elementId) => {
    const doc = get().uiDocuments.find((d) => d.id === docId);
    const original = doc ? findUIElement(doc.root, elementId) : undefined;
    if (!doc || !original || doc.root.id === elementId) return elementId; // never duplicate the root
    const clone = cloneUIElementFresh(original);
    set((state) => ({
      uiDocuments: state.uiDocuments.map((d) => {
        if (d.id !== docId) return d;
        const parent = findUIParent(d.root, elementId);
        if (!parent) return d;
        const index = parent.children.findIndex((c) => c.id === elementId);
        const next = [...parent.children];
        next.splice(index + 1, 0, clone);
        return { ...d, root: mapUIElement(d.root, parent.id, (el) => ({ ...el, children: next })) };
      }),
      isDirty: true,
    }));
    return clone.id;
  },
  attachUI: (objectId, documentId) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) =>
          object.id === objectId ? { ...object, ui: { ...defaultUIComponent(documentId), ...object.ui, documentId } } : object,
        ),
      ),
    ),
  detachUI: (objectId) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => (object.id === objectId ? { ...object, ui: undefined } : object)),
      ),
    ),
  updateUIComponent: (objectId, patch) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) => (object.id === objectId && object.ui ? { ...object, ui: { ...object.ui, ...patch } } : object)),
      ),
    ),
  setObjectVariable: (objectId, key, value) =>
    set((state) =>
      mapActiveSceneObjects(state, (objects) =>
        objects.map((object) =>
          object.id === objectId ? { ...object, variables: { ...(object.variables ?? {}), [key]: value } } : object,
        ),
      ),
    ),
  showUI: (docId) =>
    set((state) => ({ runtimeVisibleUI: { ...state.runtimeVisibleUI, [docId]: true } })),
  hideUI: (docId) =>
    set((state) => ({ runtimeVisibleUI: { ...state.runtimeVisibleUI, [docId]: false } })),
  setUIText: (docId, elementId, text) =>
    set((state) => ({ runtimeUITextOverrides: { ...state.runtimeUITextOverrides, [`${docId}:${elementId}`]: text } })),
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
      // Play runs the game scene, not a prefab being edited — block it while the prefab editor is open.
      if (isPlaying && state.editingPrefabId) return state;
      if (isPlaying) {
        const objects = selectActiveObjects(state);
        const autoplay = state.scenes.find((scene) => scene.id === state.activeSceneId)?.cinematics?.find((cinematic) => cinematic.autoplay);
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
          runtimeSwimming: [],
          runtimeClimbing: [],
          runtimeRoll: {},
          runtimeCoyote: {},
          runtimeAttack: {},
      runtimeReload: {},
      runtimeInteract: {},
      runtimeFootstep: {},
      runtimeCooldowns: {},
      runtimeHidden: [],
      runtimeInteractFocusId: null,
      runtimeHitMarker: 0,
      runtimeHurt: 0,
      runtimeEnemyCooldown: {},
      runtimeHitFlash: {},
      runtimeSurfaceSound: {},
      runtimeMovementMode: {},
      runtimeMontageRequests: {},
          runtimeCollisions: [],
          runtimeTriggers: [],
          runtimeTriggersExit: [],
          runtimeSoundQueue: [],
          runtimeLog: [],
          // Show every screen HUD flagged visibleOnStart; world docs render whenever their object exists.
          runtimeVisibleUI: Object.fromEntries(
            state.uiDocuments.filter((doc) => doc.surface === 'screen' && doc.visibleOnStart).map((doc) => [doc.id, true]),
          ),
          // Seed per-instance object variables so world-UI `self.*` bindings have authored starting values.
          runtimeObjectVariables: Object.fromEntries(
            objects.filter((object) => object.variables).map((object) => [object.id, { ...object.variables }]),
          ),
          runtimeUITextOverrides: {},
          runtimeCinematic: autoplay ? { sequenceId: autoplay.id, time: 0, firedActionIds: [], spawnedObjectIds: [] } : undefined,
          runtimeCinematicCamera: initialCinematicCamera(autoplay, objects),
          runtimeCinematicFade: initialCinematicFade(autoplay),
          editorCinematicPreview: undefined,
          editorCinematicPreviewCamera: undefined,
          editorCinematicPreviewFade: undefined,
          editorCinematicPreviewTransforms: {},
          editorCinematicPreviewHidden: [],
          runtimeStarted: false,
          // Full deep clone so Stop fully resets the scene (restores picked-up/destroyed objects, removes
          // spawned projectiles, reverts transforms/materials/instance variables).
          playSnapshot: { sceneId: state.activeSceneId, objects: structuredClone(objects) },
        };
      }

      // Restore the snapshot wholesale into the scene it was taken from (does NOT mark dirty): the cloned
      // objects re-appear (picked-up/destroyed ones come back, runtime-spawned ones are gone).
      const snapshot = state.playSnapshot;
      const scenes = snapshot
        ? state.scenes.map((scene) => (scene.id === snapshot.sceneId ? { ...scene, objects: snapshot.objects } : scene))
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
        runtimeSwimming: [],
        runtimeClimbing: [],
        runtimeRoll: {},
        runtimeCoyote: {},
        runtimeAttack: {},
      runtimeReload: {},
      runtimeInteract: {},
      runtimeFootstep: {},
      runtimeCooldowns: {},
      runtimeHidden: [],
      runtimeInteractFocusId: null,
      runtimeHitMarker: 0,
      runtimeHurt: 0,
      runtimeEnemyCooldown: {},
      runtimeHitFlash: {},
      runtimeSurfaceSound: {},
      runtimeMovementMode: {},
      runtimeMontageRequests: {},
        runtimeCollisions: [],
        runtimeTriggers: [],
        runtimeTriggersExit: [],
        runtimeSoundQueue: [],
        runtimeLog: [],
        runtimeVisibleUI: {},
        runtimeObjectVariables: {},
        runtimeUITextOverrides: {},
        runtimeCinematic: undefined,
        runtimeCinematicCamera: undefined,
        runtimeCinematicFade: undefined,
        editorCinematicPreview: undefined,
        editorCinematicPreviewCamera: undefined,
        editorCinematicPreviewFade: undefined,
        editorCinematicPreviewTransforms: {},
        editorCinematicPreviewHidden: [],
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
      // Per-object instance variables (read/written by self.* and the object-var nodes). Deep-copied per object.
      const nextObjectVariables: Record<string, Record<string, GraphValue>> = {};
      for (const [objId, vars] of Object.entries(state.runtimeObjectVariables)) nextObjectVariables[objId] = { ...vars };
      // UI runtime side effects this frame.
      const nextVisibleUI = { ...state.runtimeVisibleUI };
      const nextUITextOverrides = { ...state.runtimeUITextOverrides };
      const firedEvents = new Set(state.runtimeEventQueue.map((eventName) => eventName.toLowerCase()));
      const currentKeys = state.runtimeKeys;
      const previousKeys = state.runtimePreviousKeys;
      // Contacts detected by the previous physics step fire event nodes this frame.
      const contactMatches = (events: PhysicsContactEvent[], objectId: string, otherObjectId?: string) =>
        events.some((event) => event.objectId === objectId && (!otherObjectId || event.otherObjectId === otherObjectId));
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
      const destroyedIds = new Set<string>();
      const prints: string[] = [];
      let pendingCinematicId: string | undefined;
      // Combat feedback counters (bumped on hits / when the local player is hurt) + per-enemy attack cooldowns.
      let hitMarker = state.runtimeHitMarker;
      let hurt = state.runtimeHurt;
      const nextEnemyCd: Record<string, number> = {};
      // Hit-flash timers: decay last frame's flashes by delta (drop the spent ones); the combat pass re-arms a
      // target to HIT_FLASH_TIME whenever it takes damage. The render layer turns this into a red emissive pulse.
      const HIT_FLASH_TIME = 0.16;
      const nextHitFlash: Record<string, number> = {};
      for (const [id, t] of Object.entries(state.runtimeHitFlash)) {
        const left = t - delta;
        if (left > 0) nextHitFlash[id] = left;
      }
      const meleeSwings = new Set<string>(); // characters that started an attack swing this frame (melee hit-test)
      // Per-character movement-mode override (Set Movement Mode node) — persists across frames, updated by the
      // node in the script pass, then read by the character + animator passes below.
      const movementModeNow: Record<string, string> = { ...state.runtimeMovementMode };
      // The local player = the camera-follow character (drives hit marker / hurt flash / who enemies chase).
      const playerId = activeObjects.find((o) => o.character?.enabled && o.character.cameraFollow)?.id;
      // Objects hidden by action.setVisible — carried across frames so weapons stay holstered.
      const nextHidden = new Set<string>(state.runtimeHidden);
      // Animator parameter writes requested by animator.setX nodes this frame, keyed by object id.
      const animatorWrites: Record<string, Array<{ name: string; value: number | boolean; trigger?: boolean }>> = {};
      // One-shot montage requests this frame (Play Animation node + external HUD equips), keyed by target id.
      const animMontages: Record<string, { animationId: string; speed: number }> = { ...state.runtimeMontageRequests };
      // Character node requests this frame: object ids that fired a Jump node, and live camera overrides.
      const characterJumpRequests = new Set<string>();
      const nextCameraOverrides: Record<string, { distance: number; height: number }> = { ...state.runtimeCameraOverrides };
      // Roll/dodge + attack/reload/interact timers carried frame-to-frame (started on their key, counted down here).
      const nextRoll: Record<string, number> = {};
      const nextCoyote: Record<string, number> = {};
      const nextAttack: Record<string, number> = {};
      const nextReload: Record<string, number> = {};
      const nextInteract: Record<string, number> = {};
      // Distance-since-last-footstep per character (carried across frames) → footstep audio cadence.
      const nextFootstep: Record<string, number> = { ...state.runtimeFootstep };
      // Cooldown gate timers per (object:node), decremented each frame; armed to N seconds when one passes.
      const nextCooldowns: Record<string, number> = {};
      for (const [key, remaining] of Object.entries(state.runtimeCooldowns)) {
        const left = remaining - (delta || 1 / 60);
        if (left > 0) nextCooldowns[key] = left;
      }
      // "The player" for AI nodes (Distance/Direction/Face To Player) = the active follow-camera character.
      const aiPlayer = activeObjects.find((o) => o.character?.enabled && o.character.cameraFollow);

      // --- Interaction focus (Unreal-style): each character looks for the nearest object tagged with an
      //     `interactable` instance variable, within interactRange and roughly in front. The focused object
      //     is highlighted + prompted on screen (camera-follow character only); a rising edge on the interact
      //     key fires that object's event.interact this frame. ---
      const interactedThisFrame = new Set<string>();
      let interactFocusId: string | null = null;
      {
        const interactables = activeObjects.filter((o) => o.variables?.interactable);
        if (interactables.length) {
          for (const char of activeObjects) {
            const cc = char.character;
            if (!cc?.enabled || isRagdoll(char.id)) continue;
            const range = cc.interactRange ?? 3;
            const cp = char.transform.position;
            const facing = char.transform.rotation[1] - (cc.modelYawOffset ?? 0);
            const fwd: [number, number] = [Math.sin(facing), Math.cos(facing)];
            let best: { id: string; d: number } | null = null;
            for (const it of interactables) {
              if (it.id === char.id) continue;
              const dx = it.transform.position[0] - cp[0];
              const dz = it.transform.position[2] - cp[2];
              const d = Math.hypot(dx, dz);
              if (d > range) continue;
              // Must be in front (wide cone) — unless we're basically on top of it.
              if (d > 0.6) {
                const dot = (dx / d) * fwd[0] + (dz / d) * fwd[1];
                if (dot < 0.25) continue;
              }
              if (!best || d < best.d) best = { id: it.id, d };
            }
            if (best) {
              if (cc.cameraFollow) interactFocusId = best.id;
              const k = cc.keyInteract;
              if (k && currentKeys[k] && !previousKeys[k]) interactedThisFrame.add(best.id);
            }
          }
        }
      }

      // Run each object's script graph. Physics-enabled objects are simulated by Rapier
      // in the post-pass below, so here we only collect scripted motion + side effects.
      const mappedObjects = activeObjects.map((object) => {
          if (destroyedIds.has(object.id)) return object;
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

            if (node.data.nodeKind === 'ai.distanceToPlayer') {
              if (!aiPlayer || aiPlayer.id === object.id) return 9999;
              const p = aiPlayer.transform.position;
              return Math.hypot(p[0] - position[0], p[2] - position[2]);
            }

            if (node.data.nodeKind === 'ai.directionToPlayer') {
              if (!aiPlayer || aiPlayer.id === object.id) return [0, 0, 0] as Vector3Tuple;
              const p = aiPlayer.transform.position;
              const dx = p[0] - position[0];
              const dz = p[2] - position[2];
              const len = Math.hypot(dx, dz) || 1;
              return [dx / len, 0, dz / len] as Vector3Tuple;
            }

            if (node.data.nodeKind === 'ai.playerLocation') {
              const p = aiPlayer?.transform.position;
              return (p ? [p[0], p[1], p[2]] : [0, 0, 0]) as Vector3Tuple;
            }

            if (node.data.nodeKind === 'animator.getParam') {
              // Read the live animator parameter (previous frame) — from self, or another object's animator.
              const targetId = node.data.targetObjectId || object.id;
              const targetObj = targetId === object.id ? object : activeObjects.find((o) => o.id === targetId);
              const controller = state.animatorControllers.find((c) => c.id === targetObj?.animator?.controllerId);
              const param = controller?.parameters.find((p) => p.name === node.data.paramName);
              const live = state.runtimeAnimators[targetId];
              if (param) return (live?.params[param.id] ?? param.defaultValue) as GraphValue;
              return 0;
            }

            if (node.data.nodeKind === 'animator.getState') {
              const targetId = node.data.targetObjectId || object.id;
              const targetObj = targetId === object.id ? object : activeObjects.find((o) => o.id === targetId);
              const controller = state.animatorControllers.find((c) => c.id === targetObj?.animator?.controllerId);
              const stateId = state.runtimeAnimators[targetId]?.stateId ?? controller?.defaultStateId;
              return controller?.states.find((s) => s.id === stateId)?.name ?? '';
            }

            if (node.data.nodeKind === 'variable.get') {
              const variable = state.variables.find((item) => item.id === node.data.variableId);
              if (!variable) return undefined;
              return cloneGraphValue(nextVariableValues[variable.id] ?? variable.defaultValue);
            }

            if (node.data.nodeKind === 'variable.getObject') {
              const key = node.data.objectKey || '';
              return cloneGraphValue(nextObjectVariables[object.id]?.[key] ?? object.variables?.[key] ?? 0);
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

          // Resolve a node's target object id, supporting the "$trigger" sentinel = the object overlapping the
          // owner this frame (lets a volume/pickup's own script act on whoever entered OR left it). Checks the
          // enter list first, then the exit list (so Trigger Exit handlers can target the leaving object too).
          const resolveTarget = (raw: string | undefined): string | undefined =>
            raw === '$trigger'
              ? state.runtimeTriggers.find((t) => t.objectId === object.id)?.otherObjectId ??
                state.runtimeTriggersExit.find((t) => t.objectId === object.id)?.otherObjectId
              : raw;

          function applyAction(node: NodeForgeNode, visited: Set<string>): boolean {
            if (node.data.nodeKind === 'logic.branch') {
              return toBoolean(valueInput(node, 'condition', node.data.booleanValue ?? true));
            }

            // Cooldown gate: passes through at most once per N seconds (fire rate / spawn rate). While on
            // cooldown it stops the chain (returns false). Tracked per (object:node) in nextCooldowns.
            if (node.data.nodeKind === 'logic.cooldown') {
              const key = `${object.id}:${node.id}`;
              if ((nextCooldowns[key] ?? 0) > 0) return false;
              nextCooldowns[key] = Math.max(0.05, toNumber(valueInput(node, 'seconds', Number(node.data.numberValue ?? 1))));
              return true;
            }

            // Turn this object to face the player on the ground plane (so Spawn Projectile fires at them).
            if (node.data.nodeKind === 'action.facePlayer') {
              if (aiPlayer && aiPlayer.id !== object.id) {
                const p = aiPlayer.transform.position;
                rotation[1] = Math.atan2(p[0] - position[0], p[2] - position[2]) + (object.character?.modelYawOffset ?? 0);
                changed = true;
              }
              return true;
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

            if (node.data.nodeKind === 'variable.setObject') {
              const key = node.data.objectKey || '';
              if (key) {
                (nextObjectVariables[object.id] ??= { ...(object.variables ?? {}) })[key] = coerceGraphValue(
                  valueInput(node, 'value', node.data.numberValue ?? 0),
                  'number',
                );
              }
            }

            if (node.data.nodeKind === 'ui.show' && node.data.documentId) {
              nextVisibleUI[node.data.documentId] = true;
            }

            if (node.data.nodeKind === 'ui.hide' && node.data.documentId) {
              nextVisibleUI[node.data.documentId] = false;
            }

            if (node.data.nodeKind === 'ui.setText' && node.data.documentId && node.data.elementId) {
              const text = graphValueToString(valueInput(node, 'text', node.data.stringValue ?? ''));
              nextUITextOverrides[`${node.data.documentId}:${node.data.elementId}`] = text;
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

            if (node.data.nodeKind === 'action.playCinematic' && node.data.cinematicId) {
              pendingCinematicId = node.data.cinematicId;
            }

            if (node.data.nodeKind === 'action.burstParticles') {
              // Spit a one-shot burst from the target's authored emitter (e.g. an explosion on hit).
              const target = resolveTarget(node.data.targetObjectId) || object.id;
              const count = Math.max(1, Math.round(toNumber(valueInput(node, 'count', Number(node.data.numberValue ?? 16)))));
              sendParticleCommand(target, { type: 'burst', count });
            }

            if (node.data.nodeKind === 'action.setParticlesEmitting') {
              // Start/stop a continuous emitter (e.g. ignite a torch, turn on a smoke plume).
              const target = resolveTarget(node.data.targetObjectId) || object.id;
              const on = toBoolean(valueInput(node, 'on', node.data.booleanValue ?? true));
              sendParticleCommand(target, { type: 'emit', on });
            }

            if (node.data.nodeKind === 'action.spawnParticleSystem' && node.data.particleSystemId) {
              // Position priority: a Vector3 wired into Location → the Target object's position → the owner.
              const loc = valueInput(node, 'location');
              let base: Vector3Tuple;
              if (Array.isArray(loc) && loc.length === 3) {
                base = [Number(loc[0]) || 0, Number(loc[1]) || 0, Number(loc[2]) || 0];
              } else {
                const targetId = resolveTarget(node.data.targetObjectId);
                const targetObj = targetId && targetId !== object.id ? activeObjects.find((o) => o.id === targetId) : null;
                base = targetObj ? [...targetObj.transform.position] : [position[0], position[1], position[2]];
              }
              // A static Offset (the node's vector field) is added on top — e.g. spawn 2 units above.
              const off = node.data.vectorValue;
              if (Array.isArray(off) && off.length === 3) base = [base[0] + off[0], base[1] + off[1], base[2] + off[2]];
              spawned.push(makeSpawnedParticleEmitter(node.data.particleSystemId, base));
            }

            if (node.data.nodeKind === 'action.spawnObject') {
              spawned.push(makeSpawnedObject(node.data.spawnKind ?? 'cube', position));
            }

            if (node.data.nodeKind === 'action.destroyObject') {
              destroyedIds.add(node.data.targetObjectId || object.id);
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

            // Anim writes target the owning object by default, or another object via targetObjectId ($trigger = whoever triggered).
            const animTargetId = resolveTarget(node.data.targetObjectId) || object.id;

            if (node.data.nodeKind === 'animator.setFloat' && node.data.paramName) {
              (animatorWrites[animTargetId] ??= []).push({
                name: node.data.paramName,
                value: toNumber(valueInput(node, 'value', Number(node.data.numberValue ?? 0))),
              });
            }

            if (node.data.nodeKind === 'animator.setBool' && node.data.paramName) {
              (animatorWrites[animTargetId] ??= []).push({
                name: node.data.paramName,
                value: toBoolean(valueInput(node, 'value', Boolean(node.data.booleanValue))),
              });
            }

            if (node.data.nodeKind === 'animator.setTrigger' && node.data.paramName) {
              (animatorWrites[animTargetId] ??= []).push({ name: node.data.paramName, value: true, trigger: true });
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

            if (node.data.nodeKind === 'action.setRagdoll') {
              // Default On; wire/author a boolean into `on` to turn it off.
              const target = node.data.targetObjectId || object.id;
              const on = toBoolean(valueInput(node, 'on', node.data.booleanValue ?? true));
              setRagdoll(target, on);
            }

            if (node.data.nodeKind === 'action.setVisible') {
              // Hide/show the owner (or Target) — e.g. holster the inactive weapon.
              const target = node.data.targetObjectId || object.id;
              const visible = toBoolean(valueInput(node, 'visible', node.data.visible ?? true));
              if (visible) nextHidden.delete(target);
              else nextHidden.add(target);
            }

            if (node.data.nodeKind === 'action.spawnAttached' && node.data.assetId) {
              // Equip: spawn the weapon model attached to the owner's bone/socket, replacing any weapon
              // already on that slot. The grip offset rides on the attachment so it's map-independent.
              // targetObjectId "$trigger" attaches to whoever walked into the pickup (self-contained pickups).
              const owner = resolveTarget(node.data.targetObjectId) || object.id;
              const socketName = node.data.attachSocketName;
              const boneName = node.data.attachBoneName ?? '';
              const slot = socketName || boneName;
              for (const o of selectActiveObjects(state)) {
                if (o.variables?.__attachedWeapon && o.attachment?.targetObjectId === owner && (o.attachment.socketName || o.attachment.boneName) === slot) {
                  destroyedIds.add(o.id);
                }
              }
              spawned.push(
                makeAttachedWeapon(owner, node.data.assetId, boneName, socketName, node.data.attachOffsetPosition, node.data.attachOffsetRotation, node.data.attachOffsetScale),
              );
            }

            if (node.data.nodeKind === 'action.playAnimation' && node.data.animationId) {
              // Montage: queue a one-shot clip on the owner's (or Target's) animator — the animator pass below
              // turns it into a timed override that returns to the state machine when done.
              const target = resolveTarget(node.data.targetObjectId) || object.id;
              animMontages[target] = { animationId: node.data.animationId, speed: Math.max(0.05, node.data.animationSpeed ?? 1) };
            }

            if (node.data.nodeKind === 'action.setMovementMode') {
              // Override how the target moves (walking/swimming/climbing/flying) until changed — the character
              // + animator passes read movementModeNow. This is what makes swim/climb fully blueprint-driven.
              const target = resolveTarget(node.data.targetObjectId) || object.id;
              movementModeNow[target] = node.data.movementMode ?? 'walking';
            }

            if (node.data.nodeKind === 'action.spawnProjectile') {
              // Ammo: if the shooter owns an `ammo` instance variable, each shot consumes one and an empty
              // clip blocks the shot (reload — see the character pass — refills it to `ammoMax`).
              const ammoNow = nextObjectVariables[object.id]?.ammo ?? object.variables?.ammo;
              if (ammoNow !== undefined) {
                const ammo = toNumber(ammoNow);
                if (ammo <= 0) return true; // out of ammo — no shot
                (nextObjectVariables[object.id] ??= { ...(object.variables ?? {}) }).ammo = ammo - 1;
              }
              const speed = toNumber(valueInput(node, 'speed', node.data.projectileSpeed ?? 20));
              const damage = toNumber(valueInput(node, 'damage', node.data.projectileDamage ?? 25));
              const template = node.data.projectileTemplateId
                ? activeObjects.find((candidate) => candidate.id === node.data.projectileTemplateId)
                : undefined;
              const setup: ProjectileSetup = {
                size: node.data.projectileSize,
                color: node.data.projectileColor,
                life: node.data.projectileLife,
                gravity: node.data.projectileGravity,
                debug: node.data.projectileDebug,
                template,
              };
              const cc = object.character ? { ...defaultCharacter(), ...object.character } : undefined;
              const facing = cc?.cameraMode === 'firstPerson' && cc.mouseLook
                ? mouseCameraYaw(cc.mouseSensitivity)
                : rotation[1] - (cc?.modelYawOffset ?? 0);
              const pitch = cc?.cameraMode === 'firstPerson' && cc.mouseLook
                ? mouseCameraPitch(cc.cameraPitch, cc.mouseSensitivity, cc.cameraMinPitch, cc.cameraMaxPitch)
                : 0;
              const horizontal = Math.cos(pitch);
              const dir: Vector3Tuple = [Math.sin(facing) * horizontal, Math.sin(pitch), Math.cos(facing) * horizontal];
              const right: Vector3Tuple = [Math.cos(facing), 0, -Math.sin(facing)];
              const fp = cc?.cameraMode === 'firstPerson';
              // The eye/camera world position — where the crosshair ray starts.
              const off = cc?.cameraOffset ?? [0, 1.4, 0];
              const eye: Vector3Tuple = fp
                ? [
                    position[0] + right[0] * off[0] + dir[0] * off[2],
                    position[1] + off[1] + dir[1] * off[2],
                    position[2] + right[2] * off[0] + dir[2] * off[2],
                  ]
                : [position[0], position[1] + 1.4, position[2]];
              // Spawn at the WEAPON MUZZLE: a configurable camera-space offset [right, up, forward] from
              // the eye (default = down-right where a held gun's barrel sits).
              const m = (fp && node.data.projectileMuzzle) || [0.12, -0.24, 0.8];
              const muzzle: Vector3Tuple = fp
                ? [
                    eye[0] + right[0] * m[0] + dir[0] * m[2],
                    eye[1] + m[1] + dir[1] * m[2],
                    eye[2] + right[2] * m[0] + dir[2] * m[2],
                  ]
                : [position[0] + dir[0] * 0.8, position[1] + 1.4, position[2] + dir[2] * 0.8];
              // Converge: aim from the muzzle toward a point far down the crosshair ray so the shot both
              // LOOKS like it leaves the gun AND still hits where the player is aiming.
              let velocity: Vector3Tuple = [dir[0] * speed, dir[1] * speed, dir[2] * speed];
              if (fp) {
                const ax = eye[0] + dir[0] * 50 - muzzle[0];
                const ay = eye[1] + dir[1] * 50 - muzzle[1];
                const az = eye[2] + dir[2] * 50 - muzzle[2];
                const len = Math.hypot(ax, ay, az) || 1;
                velocity = [(ax / len) * speed, (ay / len) * speed, (az / len) * speed];
              }
              const projectileObj = makeProjectileObject(muzzle, velocity, object.id, damage, setup);
              spawned.push(projectileObj);
              // Muzzle flash at the barrel for punchy weapon feedback.
              spawned.push(makeMuzzleFlash(muzzle));
              if (setup.debug) {
                prints.push(
                  `${object.name}: 🔫 spawned ${projectileObj.name} [${projectileObj.id.slice(-4)}] ` +
                    `at (${muzzle.map((n) => n.toFixed(1)).join(', ')}) ` +
                    `vel (${velocity.map((n) => n.toFixed(1)).join(', ')}) speed ${speed} dmg ${damage}` +
                    (template ? ` · template "${template.name}"` : ''),
                );
              }
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
                return contactMatches(state.runtimeCollisions, object.id, node.data.otherObjectId);
              }
              if (node.data.nodeKind === 'event.triggerEnter') {
                return contactMatches(state.runtimeTriggers, object.id, node.data.otherObjectId);
              }
              if (node.data.nodeKind === 'event.triggerExit') {
                return contactMatches(state.runtimeTriggersExit, object.id, node.data.otherObjectId);
              }
              if (node.data.nodeKind === 'event.interact') {
                return interactedThisFrame.has(object.id);
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
      // Move `current` toward `target` by at most `maxStep` — the basis for accel/decel velocity ramping.
      const approach = (current: number, target: number, maxStep: number) => {
        const diff = target - current;
        return Math.abs(diff) <= maxStep ? target : current + Math.sign(diff) * maxStep;
      };
      const movedObjects = mappedObjects.map((object) => {
        // Particle bursts (impacts): count down their life; despawn when spent.
        if (object.effect) {
          const life = object.effect.life - delta;
          if (life <= 0) {
            destroyedIds.add(object.id);
            return object;
          }
          return { ...object, effect: { ...object.effect, life } };
        }
        // Projectiles: fly straight along their stored velocity and count down their life.
        if (object.projectile) {
          const v = object.projectile.velocity;
          const p = object.transform.position;
          return {
            ...object,
            transform: { ...object.transform, position: [p[0] + v[0] * delta, p[1] + v[1] * delta, p[2] + v[2] * delta] as Vector3Tuple },
            projectile: { ...object.projectile, life: object.projectile.life - delta },
          };
        }
        // Enemy AI (Unreal-style behavior, no scripting): an object tagged with an `enemy` instance variable
        // chases the local player when within `chaseRange` and otherwise drifts back toward its spawn. Contact
        // damage is applied in the post-physics combat pass. Tunables: enemySpeed, chaseRange (instance vars).
        if (object.variables?.enemy && !object.character?.enabled) {
          const player = playerId ? activeObjects.find((o) => o.id === playerId) : undefined;
          if (!player) return object;
          const p = [...object.transform.position] as Vector3Tuple;
          const r = [...object.transform.rotation] as Vector3Tuple;
          const speed = toNumber(object.variables.enemySpeed ?? 2.6);
          const chaseRange = toNumber(object.variables.chaseRange ?? 9);
          const tp = player.transform.position;
          const dx = tp[0] - p[0];
          const dz = tp[2] - p[2];
          const dist = Math.hypot(dx, dz);
          if (dist < chaseRange && dist > 1.1) {
            p[0] += (dx / dist) * speed * delta;
            p[2] += (dz / dist) * speed * delta;
            r[1] = Math.atan2(dx, dz); // face the player
          }
          return { ...object, transform: { ...object.transform, position: p, rotation: r } };
        }
        if (!object.character?.enabled) return object;
        // Ragdolling: physics owns the bones; the controller must not drive motion (it goes limp).
        // Track the limp body's pelvis so the follow camera stays on it instead of a frozen point.
        if (isRagdoll(object.id)) {
          const rootPos = getRagdollRoot(object.id);
          return rootPos ? { ...object, transform: { ...object.transform, position: rootPos } } : object;
        }
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

        // Persistent horizontal velocity (carried across frames so movement accelerates/decelerates instead of
        // snapping on/off — the fix for "stiff" feel). Only the auto-WASD path ramps it; scripted/rolling motion
        // is driven directly, so they start from a clean stop.
        const storedVel = nextVelocities[object.id];
        let hVelX = !scripted && !rolling ? storedVel?.[0] ?? 0 : 0;
        let hVelZ = !scripted && !rolling ? storedVel?.[2] ?? 0 : 0;

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
          const crawling = Boolean(cc.keyCrawl && currentKeys[cc.keyCrawl]);
          const speed = cc.moveSpeed * (crawling ? cc.crawlMultiplier ?? 0.4 : crouching ? cc.crouchMultiplier : sprinting ? cc.sprintMultiplier : 1);
          // Target velocity from the (camera-relative) input direction; 0 when no key is held (→ decelerate to stop).
          let targetX = 0;
          let targetZ = 0;
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
            targetX = dirX * speed;
            targetZ = dirZ * speed;
          }
          // Ramp velocity toward the target: accelerate when there's input, decelerate when not. Airborne motion
          // is dampened (airControl) so you mostly keep your jump momentum instead of turning on a dime mid-air.
          const rate = (length > 0 ? cc.acceleration ?? 60 : cc.deceleration ?? 70) * (grounded ? 1 : cc.airControl ?? 0.35);
          const maxStep = rate * delta;
          hVelX = approach(hVelX, targetX, maxStep);
          hVelZ = approach(hVelZ, targetZ, maxStep);
          position[0] += hVelX * delta;
          position[2] += hVelZ * delta;
          // Face the actual velocity (not raw input) so turning eases in/out with the slide. Strafe faces the camera.
          const moveLen = Math.hypot(hVelX, hVelZ);
          if (!(cc.strafe && cc.mouseLook) && moveLen > 0.05) {
            rotation[1] = lerpAngle(rotation[1], Math.atan2(hVelX, hVelZ) + cc.modelYawOffset, cc.turnSpeed * delta);
          }
          // Strafe: always face the camera yaw so the character can move in all 8 directions (2D blend).
          if (cc.strafe && cc.mouseLook) {
            rotation[1] = mouseCameraYaw(cc.mouseSensitivity) + cc.modelYawOffset;
          }
        }

        if (cc.cameraMode === 'firstPerson' && cc.mouseLook) {
          rotation[1] = mouseCameraYaw(cc.mouseSensitivity) + cc.modelYawOffset;
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
        if (attackRemaining <= 0 && currentKeys[cc.keyAttack]) {
          attackRemaining = 0.18;
          if (cc.attackSoundId) sounds.push(cc.attackSoundId); // swing/whoosh on the swing's first frame
          meleeSwings.add(object.id); // melee hit-test this frame (skipped later if a ranged weapon is out)
        } else if (attackRemaining > 0) attackRemaining = Math.max(0, attackRemaining - delta);
        if (attackRemaining > 0) nextAttack[object.id] = attackRemaining;

        // Reload: a longer pulse on the reload key (ranged weapon) → the "reloading" param. On start it
        // refills `ammo` to `ammoMax` (if the character owns those instance variables).
        let reloadRemaining = state.runtimeReload[object.id] ?? 0;
        if (reloadRemaining <= 0 && currentKeys[cc.keyReload]) {
          reloadRemaining = 1.2;
          const ammoMax = nextObjectVariables[object.id]?.ammoMax ?? object.variables?.ammoMax;
          if (ammoMax !== undefined) (nextObjectVariables[object.id] ??= { ...(object.variables ?? {}) }).ammo = toNumber(ammoMax);
        } else if (reloadRemaining > 0) reloadRemaining = Math.max(0, reloadRemaining - delta);
        if (reloadRemaining > 0) nextReload[object.id] = reloadRemaining;

        // Interact: a short pulse on the interact key → the "interacting" param (use / pick up).
        let interactRemaining = state.runtimeInteract[object.id] ?? 0;
        if (interactRemaining <= 0 && currentKeys[cc.keyInteract]) interactRemaining = 0.9;
        else if (interactRemaining > 0) interactRemaining = Math.max(0, interactRemaining - delta);
        if (interactRemaining > 0) nextInteract[object.id] = interactRemaining;

        // Movement mode: a "Set Movement Mode" node OVERRIDES the volume-tag swim/climb detection (so swim/
        // climb can be fully blueprint-driven). Falls back to the volume sets when no override is set.
        const overrideMode = movementModeNow[object.id];
        const swimming = overrideMode === 'swimming' || (!overrideMode && state.runtimeSwimming.includes(object.id));
        const climbing = overrideMode === 'climbing' || (!overrideMode && state.runtimeClimbing.includes(object.id));
        const flying = overrideMode === 'flying';
        if (climbing) {
          // Lock horizontal to the wall (undo this frame's script/auto XZ move) and climb up/down with fwd/back keys.
          const start = prevTransforms.get(object.id)?.position;
          if (start) {
            position[0] = start[0];
            position[2] = start[2];
          }
          const climbDir = (currentKeys[cc.keyForward] ? 1 : 0) - (currentKeys[cc.keyBackward] ? 1 : 0);
          position[1] += climbDir * cc.moveSpeed * 0.6 * delta;
          nextVelocities[object.id] = [0, 0, 0];
        } else if (swimming || flying) {
          // No gravity. Swim = buoyant (settles toward neutral); fly = stays put. Both: jump=up, crouch=down,
          // horizontal moves freely (the horizontal step is applied above by the move pass).
          let vy = nextVelocities[object.id]?.[1] ?? 0;
          if (currentKeys[cc.keyJump]) vy = cc.moveSpeed * 0.7;
          else if (currentKeys[cc.keyCrouch]) vy = -cc.moveSpeed * 0.7;
          else vy *= swimming ? 0.85 : 0; // swim drifts toward neutral buoyancy; fly holds altitude
          position[1] += vy * delta;
          nextVelocities[object.id] = [hVelX, vy, hVelZ];
        } else {
          // Vertical motion: gravity + jump. Grounded comes from the physics character controller
          // (last frame) so the character can stand on real colliders, not just the ground plane.
          let verticalVelocity = nextVelocities[object.id]?.[1] ?? 0;
          const wantsJump = scripted ? characterJumpRequests.has(object.id) : Boolean(currentKeys[cc.keyJump]);
          if (grounded && verticalVelocity < 0) verticalVelocity = 0;
          // Coyote time: top up the grace window while grounded; otherwise count it down. Lets a jump pressed a
          // few frames after running off a ledge still fire — a big responsiveness win.
          let coyote = grounded ? cc.coyoteTime ?? 0.12 : Math.max(0, (state.runtimeCoyote[object.id] ?? 0) - delta);
          // Jump only when on (or just-off) the ground AND not already rising (prevents a grounded re-jump / double jump).
          if (wantsJump && (grounded || coyote > 0) && verticalVelocity <= 0.0001) {
            verticalVelocity = cc.jumpStrength;
            coyote = 0; // consume the grace so one press = one jump
            if (cc.jumpSoundId) sounds.push(cc.jumpSoundId);
          }
          // Variable jump height: releasing the jump key while still rising cuts the climb short (tap = hop,
          // hold = full jump). Auto mode only — scripted jumps don't read the raw key.
          if (!scripted && verticalVelocity > 0 && !currentKeys[cc.keyJump] && previousKeys[cc.keyJump]) {
            verticalVelocity *= cc.jumpCutMultiplier ?? 0.45;
          }
          // Asymmetric gravity: fall faster than you rose so the arc feels snappy, not floaty.
          const g = cc.gravity * (verticalVelocity < 0 ? cc.fallMultiplier ?? 1.9 : 1);
          verticalVelocity -= g * delta;
          position[1] += verticalVelocity * delta;
          if (position[1] <= cc.groundLevel) {
            position[1] = cc.groundLevel;
            if (verticalVelocity < 0) verticalVelocity = 0;
          }
          nextVelocities[object.id] = [hVelX, verticalVelocity, hVelZ];
          if (coyote > 0) nextCoyote[object.id] = coyote;
        }

        // Footsteps: accumulate horizontal distance and play a footstep sound each stride while grounded.
        // Surface-aware: a footstep volume the character stands in overrides the default sound (grass/stone/etc.).
        const stepSound = state.runtimeSurfaceSound[object.id] || cc.footstepSoundId;
        if (stepSound) {
          const start = object.transform.position;
          const stepped = Math.hypot(position[0] - start[0], position[2] - start[2]);
          let acc = (nextFootstep[object.id] ?? 0) + stepped;
          const stride = 2.1; // world units between footstep sounds
          if (grounded && acc >= stride) {
            sounds.push(stepSound);
            acc = 0;
          }
          nextFootstep[object.id] = grounded ? acc : 0; // reset mid-air so landing doesn't dump a step
        }

        return { ...object, transform: { ...object.transform, position, rotation } };
      });

      // Physics post-pass: step the Rapier world and let it own every physics body's
      // transform (object-to-object collisions, stacking, gravity). Non-physics objects
      // keep whatever their script produced. Contacts/triggers are reported one frame later
      // so graph events run from a stable, previous-step physics result.
      let collisions: PhysicsContactEvent[] = [];
      let triggers: PhysicsContactEvent[] = [];
      let triggersExit: PhysicsContactEvent[] = [];
      let groundedIds: string[] = [];
      let resolvedObjects = movedObjects;
      const physics = getActivePhysics();
      if (physics) {
        const result = physics.frame(movedObjects, prevTransforms, physicsImpulses, delta);
        collisions = result.collisions;
        triggers = result.triggers;
        triggersExit = result.triggersExit;
        groundedIds = result.grounded;
        resolvedObjects = movedObjects.map((object) => {
          // While ragdolling the limp body owns the transform (set from the pelvis above) — don't let
          // the kinematic character capsule overwrite it back to a standing pose.
          if (isRagdoll(object.id)) return object;
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

      // Swim / climb modes: maintain the "inside a volume" sets from trigger enter/exit against objects
      // tagged with a `volume` instance variable of 'water' or 'climb'. One frame delayed (like grounded).
      const nextSwimming = new Set(state.runtimeSwimming);
      const nextClimbing = new Set(state.runtimeClimbing);
      const nextSurfaceSound: Record<string, string> = { ...state.runtimeSurfaceSound };
      if (triggers.length || triggersExit.length) {
        const otherObj = (id: string) => resolvedObjects.find((o) => o.id === id);
        const volumeKind = (id: string) => {
          const v = otherObj(id)?.variables?.volume;
          return typeof v === 'string' ? v : undefined;
        };
        const isCharacter = (id: string) => Boolean(resolvedObjects.find((o) => o.id === id)?.character?.enabled);
        const apply = (charId: string, otherId: string, entering: boolean) => {
          if (!isCharacter(charId)) return;
          const kind = volumeKind(otherId);
          if (kind === 'water') entering ? nextSwimming.add(charId) : nextSwimming.delete(charId);
          else if (kind === 'climb') entering ? nextClimbing.add(charId) : nextClimbing.delete(charId);
          // Surface-aware footsteps: a footstep volume overrides the character's step sound while inside it.
          const surface = otherObj(otherId)?.variables?.footstepSound;
          if (typeof surface === 'string' && surface) {
            if (entering) nextSurfaceSound[charId] = surface;
            else if (nextSurfaceSound[charId] === surface) delete nextSurfaceSound[charId];
          }
        };
        for (const t of triggers) apply(t.objectId, t.otherObjectId, true);
        for (const t of triggersExit) apply(t.objectId, t.otherObjectId, false);
      }
      // Effective swim/climb = the "Set Movement Mode" OVERRIDE if present, else the volume-tag set. This is
      // what makes swim/climb work whether driven by a blueprint (Set Movement Mode) or the zero-config volume.
      const candidateIds = new Set<string>([...nextSwimming, ...nextClimbing, ...Object.keys(movementModeNow)]);
      const swimmingIds: string[] = [];
      const climbingIds: string[] = [];
      for (const id of candidateIds) {
        const m = movementModeNow[id];
        if (m ? m === 'swimming' : nextSwimming.has(id)) swimmingIds.push(id);
        if (m ? m === 'climbing' : nextClimbing.has(id)) climbingIds.push(id);
      }

      // Water entry FX: when a character first starts swimming (volume- OR blueprint-driven), fountain a splash
      // at its feet and play its swim/splash sound. Detected as "newly swimming vs last frame".
      for (const id of swimmingIds) {
        if (state.runtimeSwimming.includes(id)) continue;
        const obj = resolvedObjects.find((o) => o.id === id);
        if (!obj) continue;
        spawned.push(makeSplashObject(obj.transform.position));
        const splashSound = obj.character?.swimSoundId;
        if (splashSound) sounds.push(splashSound);
      }

      // Landing sound: a character that became grounded this frame after falling (downward velocity last
      // frame) plays its land sound. The velocity check skips the play-start frame (rests at rest).
      for (const id of groundedIds) {
        if (state.runtimeGrounded.includes(id)) continue;
        const wasFalling = (state.runtimeVelocities[id]?.[1] ?? 0) < -1;
        if (!wasFalling) continue;
        const landSound = resolvedObjects.find((o) => o.id === id)?.character?.landSoundId;
        if (landSound) sounds.push(landSound);
      }

      // Projectiles: on first contact with a non-owner, subtract from that object's `health` instance
      // variable (if it has one) and despawn; also despawn when their life runs out.
      for (const obj of resolvedObjects) {
        const proj = obj.projectile;
        if (!proj) continue;
        if (proj.life <= 0) {
          destroyedIds.add(obj.id);
          continue;
        }
        for (const c of collisions) {
          const other = c.objectId === obj.id ? c.otherObjectId : c.otherObjectId === obj.id ? c.objectId : undefined;
          if (!other || other === proj.ownerId) continue;
          const target = resolvedObjects.find((o) => o.id === other);
          if (!target || target.projectile) continue; // ignore other projectiles
          const hasHealth = nextObjectVariables[other]?.health !== undefined || target.variables?.health !== undefined;
          if (hasHealth) {
            const cur = toNumber(nextObjectVariables[other]?.health ?? target.variables?.health ?? 0);
            const next = Math.max(0, cur - proj.damage);
            (nextObjectVariables[other] ??= { ...(target.variables ?? {}) }).health = next;
            // Hurt sound: a damaged character grunts (unless this hit kills it — death handles that).
            if (next > 0 && target.character?.hurtSoundId) sounds.push(target.character.hurtSoundId);
            if (next <= 0) destroyedIds.add(other); // dummy/enemy dies
            // Combat feedback: floating damage number at the hit; hit marker if the LOCAL player shot it;
            // hurt flash if the LOCAL player was the one hit.
            spawned.push(makeDamageNumber(obj.transform.position, proj.damage));
            nextHitFlash[other] = HIT_FLASH_TIME; // red pulse on the struck object
            if (proj.ownerId === playerId) hitMarker += 1;
            if (other === playerId) hurt += 1;
            if (proj.debug) prints.push(`🎯 ${obj.name} [${obj.id.slice(-4)}] hit ${target.name}: -${proj.damage} hp → ${next}${next <= 0 ? ' (destroyed)' : ''}`);
          } else if (proj.debug) {
            prints.push(`🎯 ${obj.name} [${obj.id.slice(-4)}] hit ${target.name} (no health var — no damage)`);
          }
          // Spawn a particle burst at the impact point (the projectile's current position).
          spawned.push(makeImpactObject(obj.transform.position));
          destroyedIds.add(obj.id);
          break;
        }
      }

      // Enemy contact damage: an enemy within `attackRange` of the local player drains its `health` on a
      // ~1s cadence (per-enemy cooldown). Triggers the hurt flash + the player's hurt sound.
      if (playerId) {
        const player = resolvedObjects.find((o) => o.id === playerId);
        if (player) {
          const pp = player.transform.position;
          const hasHealth = nextObjectVariables[playerId]?.health !== undefined || player.variables?.health !== undefined;
          for (const e of resolvedObjects) {
            if (!e.variables?.enemy) continue;
            let cd = (state.runtimeEnemyCooldown[e.id] ?? 0) - delta;
            const dx = pp[0] - e.transform.position[0];
            const dz = pp[2] - e.transform.position[2];
            const near = Math.hypot(dx, dz) < toNumber(e.variables.attackRange ?? 1.6);
            if (near && cd <= 0 && hasHealth) {
              const dmg = toNumber(e.variables.enemyDamage ?? 10);
              const cur = toNumber(nextObjectVariables[playerId]?.health ?? player.variables?.health ?? 0);
              (nextObjectVariables[playerId] ??= { ...(player.variables ?? {}) }).health = Math.max(0, cur - dmg);
              hurt += 1;
              nextHitFlash[playerId] = HIT_FLASH_TIME;
              if (player.character?.hurtSoundId) sounds.push(player.character.hurtSoundId);
              cd = 1;
            }
            if (cd > 0) nextEnemyCd[e.id] = cd;
          }
        }
      }

      // Melee hits: a character that started an attack swing this frame WITHOUT a ranged weapon out (sword
      // swing / punch) damages every object with `health` in a front cone within meleeRange. Ranged shots are
      // handled by the projectile system, so attackers in RangedMode are skipped here.
      for (const attackerId of meleeSwings) {
        const attacker = resolvedObjects.find((o) => o.id === attackerId);
        if (!attacker?.character) continue;
        const ctrl = state.animatorControllers.find((c) => c.id === attacker.animator?.controllerId);
        const rangedParam = ctrl?.parameters.find((p) => p.name === 'RangedMode');
        const isRanged = rangedParam ? Boolean(state.runtimeAnimators[attackerId]?.params?.[rangedParam.id]) : false;
        if (isRanged) continue; // the gun's projectiles deal the damage, not the swing
        const acc = { ...defaultCharacter(), ...attacker.character };
        const range = acc.meleeRange ?? 2.4;
        const dmg = acc.meleeDamage ?? 34;
        const ap = attacker.transform.position;
        const facing = attacker.transform.rotation[1] - (acc.modelYawOffset ?? 0);
        const fwd: [number, number] = [Math.sin(facing), Math.cos(facing)];
        for (const target of resolvedObjects) {
          if (target.id === attackerId || target.projectile) continue;
          const hasHealth = nextObjectVariables[target.id]?.health !== undefined || target.variables?.health !== undefined;
          if (!hasHealth) continue;
          const dx = target.transform.position[0] - ap[0];
          const dz = target.transform.position[2] - ap[2];
          const d = Math.hypot(dx, dz);
          if (d > range) continue;
          if (d > 0.3 && (dx / d) * fwd[0] + (dz / d) * fwd[1] < 0.35) continue; // must be in the swing's front cone
          const cur = toNumber(nextObjectVariables[target.id]?.health ?? target.variables?.health ?? 0);
          const next = Math.max(0, cur - dmg);
          (nextObjectVariables[target.id] ??= { ...(target.variables ?? {}) }).health = next;
          spawned.push(makeDamageNumber(target.transform.position, dmg));
          spawned.push(makeImpactObject(target.transform.position, '#ffd27f'));
          nextHitFlash[target.id] = HIT_FLASH_TIME; // red pulse on the struck object
          if (attackerId === playerId) hitMarker += 1;
          if (target.id === playerId) hurt += 1;
          if (next > 0 && target.character?.hurtSoundId) sounds.push(target.character.hurtSoundId);
          if (next <= 0) destroyedIds.add(target.id);
        }
      }

      let allObjects = [...resolvedObjects, ...spawned];
      for (const id of destroyedIds) allObjects = deleteWithChildren(allObjects, id);
      const cinematicEvents: string[] = [];
      const startingCinematic = pendingCinematicId ? { sequenceId: pendingCinematicId, time: 0, firedActionIds: [], spawnedObjectIds: [] } : undefined;
      let nextRuntimeCinematic = startingCinematic ?? state.runtimeCinematic;
      let nextRuntimeCinematicCamera = startingCinematic ? undefined : state.runtimeCinematicCamera;
      let nextRuntimeCinematicFade = startingCinematic ? undefined : state.runtimeCinematicFade;
      if (nextRuntimeCinematic) {
        const scene = state.scenes.find((item) => item.id === state.activeSceneId);
        const sequence = scene?.cinematics?.find((item) => item.id === nextRuntimeCinematic?.sequenceId);
        if (!sequence) {
          nextRuntimeCinematic = undefined;
          nextRuntimeCinematicCamera = undefined;
          nextRuntimeCinematicFade = undefined;
        } else {
          const prevTime = nextRuntimeCinematic.time;
          const currentTime = Math.min(sequence.duration, prevTime + delta);
          const fired = new Set(nextRuntimeCinematic.firedActionIds);
          const spawnedByCinematic = new Set(nextRuntimeCinematic.spawnedObjectIds);

          nextRuntimeCinematicCamera = cinematicCameraAt(sequence, allObjects, currentTime, nextRuntimeCinematicCamera);
          nextRuntimeCinematicFade = cinematicFadeAt(sequence, currentTime, nextRuntimeCinematicFade);

          for (const action of sequence.actions) {
            const length = Math.max(action.duration ?? 0, 0.001);
            const local = clamp01((currentTime - action.time) / length);
            const active = currentTime >= action.time && currentTime <= action.time + length;
            const shouldFire = !fired.has(action.id) && action.time >= prevTime && action.time <= currentTime;

            if (action.type === 'transform' && active && action.objectId) {
              allObjects = allObjects.map((object) => {
                if (object.id !== action.objectId) return object;
                return {
                  ...object,
                  transform: {
                    position: action.fromPosition && action.toPosition ? mixVec3(action.fromPosition, action.toPosition, local) : action.toPosition ?? action.position ?? object.transform.position,
                    rotation: action.fromRotation && action.toRotation ? mixVec3(action.fromRotation, action.toRotation, local) : action.toRotation ?? action.rotation ?? object.transform.rotation,
                    scale: action.fromScale && action.toScale ? mixVec3(action.fromScale, action.toScale, local) : action.toScale ?? action.scale ?? object.transform.scale,
                  },
                };
              });
            }

            if (!shouldFire) continue;
            fired.add(action.id);
            if (action.type === 'visibility' && action.objectId) {
              if (action.visible === false) nextHidden.add(action.objectId);
              else nextHidden.delete(action.objectId);
            } else if (action.type === 'spawn') {
              if (action.prefabId) {
                const prefab = state.prefabs.find((item) => item.id === action.prefabId);
                if (prefab) {
                  const { objects: clones, rootId } = cloneObjectTree(prefab.objects, prefab.rootId);
                  const root = clones.find((object) => object.id === rootId);
                  if (root && action.position) root.transform.position = action.position;
                  allObjects = [...allObjects, ...clones];
                  for (const clone of clones) spawnedByCinematic.add(clone.id);
                }
              } else {
                const kind = action.spawnKind ?? 'cube';
                const object: SceneObject = {
                  id: makeId('obj'),
                  name: action.name ?? `Cinematic ${kind}`,
                  kind,
                  transform: {
                    position: action.position ?? [0, 1, 0],
                    rotation: action.rotation ?? [0, 0, 0],
                    scale: action.scale ?? [1, 1, 1],
                  },
                  ...objectDefaults[kind],
                  variables: { cinematicOnly: true },
                };
                allObjects.push(object);
                spawnedByCinematic.add(object.id);
              }
            } else if (action.type === 'animation' && action.objectId && action.animationId) {
              animMontages[action.objectId] = { animationId: action.animationId, speed: action.animationSpeed ?? 1 };
            } else if (action.type === 'sound' && action.soundId) {
              sounds.push(action.soundId);
            } else if (action.type === 'event' && action.eventName) {
              cinematicEvents.push(action.eventName);
            }
          }

          if (currentTime >= sequence.duration) {
            allObjects = allObjects.filter((object) => !spawnedByCinematic.has(object.id));
            nextRuntimeCinematic = undefined;
            nextRuntimeCinematicCamera = undefined;
            nextRuntimeCinematicFade = undefined;
          } else {
            nextRuntimeCinematic = { ...nextRuntimeCinematic, time: currentTime, firedActionIds: [...fired], spawnedObjectIds: [...spawnedByCinematic] };
          }
        }
      }
      const remainingObjectIds = new Set(allObjects.map((object) => object.id));
      const remainingResolvedObjects = resolvedObjects.filter((object) => remainingObjectIds.has(object.id));
      const nextScenes = state.scenes.map((scene) =>
        scene.id !== state.activeSceneId ? scene : { ...scene, objects: allObjects },
      );

      // --- Animator pass: feed object state into parameters, then run the state machine. ---
      // Runs after physics so "speed"/"verticalSpeed" reflect the object's final motion this frame.
      const nextAnimators: Record<string, RuntimeAnimator> = {};
      for (const object of remainingResolvedObjects) {
        const controllerId = object.animator?.enabled ? object.animator.controllerId : undefined;
        if (!controllerId) continue;
        const controller = state.animatorControllers.find((item) => item.id === controllerId);
        if (!controller || !controller.states.length) continue;

        // A first-person view model (arms/weapon) is pinned to the camera and never moves, and has no
        // character of its own — so its animator sources state from the OWNER pawn (speed, grounded,
        // aim/fire/reload keys, etc.). This is what makes per-weapon arm rigs animate automatically.
        const ownerId = object.viewModel?.ownerObjectId;
        const sourceObj = (ownerId ? remainingResolvedObjects.find((o) => o.id === ownerId) : undefined) ?? object;
        const sourceId = sourceObj.id;

        // Movement this frame (start-of-tick transform vs. final transform) of the source object.
        const before = prevTransforms.get(sourceId);
        const after = sourceObj.transform.position;
        const dt = delta || 1 / 60;
        let horizontalSpeed = 0;
        let verticalSpeed = 0;
        // Local move direction relative to the source's facing (for 2D directional/strafe blend spaces):
        // moveY = forward (−1 back … +1 fwd), moveX = right (−1 left … +1 right); ~0 when idle.
        let moveX = 0;
        let moveY = 0;
        if (before) {
          const dx = after[0] - before.position[0];
          const dy = after[1] - before.position[1];
          const dz = after[2] - before.position[2];
          horizontalSpeed = Math.hypot(dx, dz) / dt;
          verticalSpeed = dy / dt;
          const h = Math.hypot(dx, dz);
          if (h > 1e-4) {
            const facing = sourceObj.transform.rotation[1] - (sourceObj.character?.modelYawOffset ?? 0);
            const wx = dx / h;
            const wz = dz / h;
            moveY = wx * Math.sin(facing) + wz * Math.cos(facing); // forward axis (sin,cos)
            moveX = wx * Math.cos(facing) - wz * Math.sin(facing); // right axis (cos,−sin)
          }
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
          else if (param.source === 'crouching') params[param.id] = Boolean(sourceObj.character && currentKeys[sourceObj.character.keyCrouch]);
          else if (param.source === 'crawling') params[param.id] = Boolean(sourceObj.character?.keyCrawl && currentKeys[sourceObj.character.keyCrawl]);
          else if (param.source === 'moveX') params[param.id] = moveX;
          else if (param.source === 'moveY') params[param.id] = moveY;
          else if (param.source === 'grounded') params[param.id] = groundedIds.includes(sourceId);
          else if (param.source === 'swimming') params[param.id] = swimmingIds.includes(sourceId);
          else if (param.source === 'climbing') params[param.id] = climbingIds.includes(sourceId);
          else if (param.source === 'rolling') params[param.id] = (nextRoll[sourceId] ?? 0) > 0;
          else if (param.source === 'attacking') params[param.id] = (nextAttack[sourceId] ?? 0) > 0;
          else if (param.source === 'aiming') params[param.id] = Boolean(sourceObj.character && currentKeys[sourceObj.character.keyAim]);
          else if (param.source === 'reloading') params[param.id] = (nextReload[sourceId] ?? 0) > 0;
          else if (param.source === 'interacting') params[param.id] = (nextInteract[sourceId] ?? 0) > 0;
          else if (param.source === 'emoting') params[param.id] = Boolean(sourceObj.character && currentKeys[sourceObj.character.keyEmote]);
          else if (param.source === 'weaponEquipped') params[param.id] = allObjects.some((o) => o.attachment?.targetObjectId === sourceId);
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

        // Montage (Play Animation): a fresh request this frame starts a timed clip override; otherwise the
        // previous montage counts down and clears when done. While active it overrides the state-machine clip.
        let montage = prev?.montage && prev.montage.remaining > 0
          ? { ...prev.montage, remaining: prev.montage.remaining - dt }
          : undefined;
        const requested = animMontages[object.id];
        if (requested) {
          const clip = state.animations.find((a) => a.id === requested.animationId);
          if (clip) montage = { animationId: requested.animationId, speed: requested.speed, remaining: clip.duration / requested.speed };
        }
        if (montage && montage.remaining <= 0) montage = undefined;

        nextAnimators[object.id] = { stateId: nextStateId, params, fade, time: nextStateId === fromStateId ? timeInState : 0, montage };

        // Death → ragdoll: entering a state named like "death"/"dead"/"die" goes limp automatically.
        const nextStateName = controller.states.find((s) => s.id === nextStateId)?.name ?? '';
        if (/death|dead|\bdie\b/i.test(nextStateName)) setRagdoll(object.id, true);
      }

      return {
        runtimeTime,
        runtimeVelocities: nextVelocities,
        runtimeVariableValues: nextVariableValues,
        runtimeAnimators: nextAnimators,
        runtimeCameraOverrides: nextCameraOverrides,
        runtimeGrounded: groundedIds,
        runtimeSwimming: swimmingIds,
        runtimeClimbing: climbingIds,
        runtimeRoll: nextRoll,
        runtimeCoyote: nextCoyote,
        runtimeAttack: nextAttack,
        runtimeReload: nextReload,
        runtimeInteract: nextInteract,
        runtimeFootstep: nextFootstep,
        runtimeCooldowns: nextCooldowns,
        runtimeHidden: [...nextHidden],
        runtimeInteractFocusId: interactFocusId,
        runtimeHitMarker: hitMarker,
        runtimeHurt: hurt,
        runtimeEnemyCooldown: nextEnemyCd,
        runtimeHitFlash: nextHitFlash,
        runtimeSurfaceSound: nextSurfaceSound,
        runtimeMovementMode: movementModeNow,
        runtimeMontageRequests: {},
        runtimeCollisions: collisions,
        runtimeTriggers: triggers,
        runtimeTriggersExit: triggersExit,
        runtimePreviousKeys: { ...currentKeys },
        runtimeEventQueue: cinematicEvents,
        runtimeStarted: true,
        runtimeSoundQueue: sounds.length ? [...state.runtimeSoundQueue, ...sounds] : state.runtimeSoundQueue,
        runtimeLog: prints.length ? [...state.runtimeLog, ...prints].slice(-100) : state.runtimeLog,
        runtimeObjectVariables: nextObjectVariables,
        runtimeVisibleUI: nextVisibleUI,
        runtimeUITextOverrides: nextUITextOverrides,
        runtimeCinematic: nextRuntimeCinematic,
        runtimeCinematicCamera: nextRuntimeCinematicCamera,
        runtimeCinematicFade: nextRuntimeCinematicFade,
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
      // Exclude the transient prefab-editing scene; fall back active id to a real scene if needed.
      activeSceneId:
        state.activeSceneId === PREFAB_EDIT_SCENE_ID
          ? state.prefabReturnSceneId ??
            state.scenes.find((scene) => scene.id !== PREFAB_EDIT_SCENE_ID)?.id ??
            state.activeSceneId
          : state.activeSceneId,
      scenes: state.scenes.filter((scene) => scene.id !== PREFAB_EDIT_SCENE_ID),
      assets: state.assets.map(({ url: _url, ...asset }) => asset),
      folders: state.folders,
      variables: state.variables,
      dataAssets: state.dataAssets,
      materials: state.materials ?? [],
      skeletons: state.skeletons ?? [],
      skeletalMeshes: state.skeletalMeshes ?? [],
      animations: state.animations ?? [],
      animatorControllers: state.animatorControllers ?? [],
      uiDocuments: state.uiDocuments ?? [],
      particleSystems: state.particleSystems ?? [],
      blueprints: state.blueprints,
      graphs: state.graphs,
      prefabs: state.prefabs ?? [],
    };
  },
  loadProject: (project) =>
    set(() => {
      // Backfill component defaults so older saves load safely.
      const rawScenes = project.scenes.length ? project.scenes : [{ id: 'scene-main', name: 'Main', objects: [] }];
      const scenes = rawScenes.map((scene) => ({
        ...scene,
        cinematics: scene.cinematics ?? [],
        objects: scene.objects.map((object) => ({
          ...object,
          character: object.character ? { ...defaultCharacter(), ...object.character } : object.character,
          physics: object.physics ? withPhysicsDefaults(object.physics) : object.physics,
        })),
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
        renderSettings: { ...defaultRenderSettings(), ...project.renderSettings },
        variables: project.variables ?? [],
        dataAssets: project.dataAssets ?? [],
        materials,
        skeletons: project.skeletons ?? [],
        skeletalMeshes: project.skeletalMeshes ?? [],
        animations: project.animations ?? [],
        animatorControllers: project.animatorControllers ?? [],
        uiDocuments: project.uiDocuments ?? [],
        blueprints: project.blueprints,
        graphs: normalizedGraphs,
        prefabs: project.prefabs ?? [],
        editingPrefabId: null,
        prefabReturnSceneId: null,
        // Regenerate thumbnails for any prefabs that were saved without one.
        prefabThumbnailQueue: (project.prefabs ?? []).filter((prefab) => !prefab.thumbnail).map((prefab) => prefab.id),
        activeBlueprintId: project.blueprints[0]?.id ?? '',
        activeMaterialId: project.materials?.[0]?.id ?? '',
        activeUIDocumentId: project.uiDocuments?.[0]?.id ?? '',
        activeCinematicId: activeScene.cinematics?.[0]?.id ?? '',
        selectedGraphNodeId: undefined,
        isPlaying: false,
        playSnapshot: undefined,
        runtimeVelocities: {},
        runtimeKeys: {},
        runtimePreviousKeys: {},
        runtimeEventQueue: [],
        runtimeVariableValues: {},
        runtimeAnimators: {},
        runtimeCameraOverrides: {},
        runtimeGrounded: [],
        runtimeSwimming: [],
        runtimeClimbing: [],
        runtimeRoll: {},
        runtimeCoyote: {},
        runtimeAttack: {},
      runtimeReload: {},
      runtimeInteract: {},
      runtimeFootstep: {},
      runtimeCooldowns: {},
      runtimeHidden: [],
      runtimeInteractFocusId: null,
      runtimeHitMarker: 0,
      runtimeHurt: 0,
      runtimeEnemyCooldown: {},
      runtimeHitFlash: {},
      runtimeSurfaceSound: {},
      runtimeMovementMode: {},
      runtimeMontageRequests: {},
        runtimeCollisions: [],
        runtimeSoundQueue: [],
        runtimeLog: [],
        runtimeVisibleUI: {},
        runtimeObjectVariables: {},
        runtimeUITextOverrides: {},
        runtimeCinematic: undefined,
        runtimeCinematicCamera: undefined,
        runtimeCinematicFade: undefined,
        editorCinematicPreview: undefined,
        editorCinematicPreviewCamera: undefined,
        editorCinematicPreviewFade: undefined,
        editorCinematicPreviewTransforms: {},
        editorCinematicPreviewHidden: [],
        runtimeTriggers: [],
        runtimeTriggersExit: [],
        runtimeStarted: false,
        runtimeTime: 0,
        isDirty: false,
      };
    }),
  markClean: () => set({ isDirty: false }),
}));
