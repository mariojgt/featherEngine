import type {
  AnimatorComponent,
  CharacterControllerComponent,
  ColliderType,
  LightComponent,
  MaterialDefinition,
  MeshRendererComponent,
  PhysicsComponent,
  RagdollSettings,
  RenderSettings,
  RigidBodyType,
  TerrainBrushSettings,
  TerrainComponent,
  TransformComponent,
  Vector3Tuple,
} from '../../types';

import { makeId } from './ids';

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
export const defaultAnimator = (): AnimatorComponent => ({ enabled: false, speed: 1, loop: true });

/** Interpolate an angle toward a target along the shortest arc (radians). */
export const lerpAngle = (from: number, to: number, t: number): number => {
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

/** A factory for a fresh default arcade vehicle (car) controller. Tuned for a fun, always-controllable feel. */
export const defaultVehicle = (): VehicleComponent => ({
  enabled: false,
  // Tuned for a punchy-but-weighty arcade feel: brisk top speed, accel that pins you back, strong brakes,
  // and a touch of coast drag so letting off carries momentum into the next corner instead of gliding forever.
  maxSpeed: 30,
  maxReverseSpeed: 10,
  acceleration: 19,
  braking: 32,
  drag: 7,
  // A responsive steer lock + strong grip for crisp turn-in; the handbrake drops grip hard for a clean drift.
  steerAngle: 0.58,
  turnRate: 2.0,
  steerReturnSpeed: 0.25,
  gripFactor: 0.92,
  handbrakeGrip: 0.22,
  suspensionTravel: 0.14,
  suspensionStiffness: 0.18,
  bodyRoll: 0.05,
  bodyPitch: 0.05,
  wheelRadius: 0.4,
  rideHeight: 0.5,
  wheelRestY: 0.3,
  wheelObjectIds: [],
  steeredWheelIds: [],
  headlightIds: [],
  brakeLightIds: [],
  keyThrottle: 'KeyW',
  keyReverse: 'KeyS',
  keyLeft: 'KeyA',
  keyRight: 'KeyD',
  keyHandbrake: 'Space',
  keyHorn: 'KeyH',
  cameraFollow: true,
  // Behind (-Z) and above a +Z-forward car; a low, pulled-back chase cam (closer to the deck than a
  // character cam) reads as faster and shows more of the road ahead.
  cameraOffset: [0, 3.0, -8.5],
  cameraPitch: 0.2,
  cameraMinPitch: -0.1,
  cameraMaxPitch: 1.0,
  mouseLook: true,
  mouseSensitivity: 0.0025,
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
  terrain?: Partial<TerrainComponent>;
  /** Nest the new object under this object (sets `parentId`). */
  parentId?: string;
}

export const defaultTerrainBrush = (): TerrainBrushSettings => ({
  enabled: false,
  mode: 'sculpt',
  operation: 'raise',
  radius: 8,
  strength: 0.65,
  flattenHeight: 0,
  targetLayerId: 'terrain-grass',
});

export const syncTerrainLayerColors = (terrain: TerrainComponent): TerrainComponent => ({
  ...terrain,
  lowColor: terrain.materialLayers[0]?.color ?? terrain.lowColor,
  midColor: terrain.materialLayers[1]?.color ?? terrain.midColor,
  highColor: terrain.materialLayers[2]?.color ?? terrain.highColor,
});

export const titleCase = (value: string) => `${value[0].toUpperCase()}${value.slice(1)}`;

export const defaultTransform = (position: Vector3Tuple = [0, 0, 0]): TransformComponent => ({
  position,
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});

export const defaultRenderer = (
  mesh: MeshRendererComponent['mesh'],
  color = '#5B8CFF',
): MeshRendererComponent => ({
  enabled: true,
  mesh,
  color,
  metalness: 0.1,
  roughness: 0.65,
});

export const defaultPhysics = (bodyType: RigidBodyType = 'dynamic', collider: ColliderType = 'box'): PhysicsComponent => ({
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

export const withPhysicsDefaults = (physics: PhysicsComponent): PhysicsComponent => ({
  ...defaultPhysics(physics.bodyType, physics.collider),
  ...physics,
  collisionLayer: Math.min(Math.max(Math.trunc(physics.collisionLayer ?? 0), 0), 15),
  collisionMask: (physics.collisionMask ?? 0xffff) & 0xffff,
});

export const defaultMaterial = (name: string, folderId?: string): MaterialDefinition => ({
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
