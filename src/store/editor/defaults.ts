import type {
  AnimatorComponent,
  CharacterControllerComponent,
  ClothComponent,
  ColliderType,
  JointComponent,
  JointType,
  LightComponent,
  MaterialDefinition,
  MeshRendererComponent,
  PhysicsComponent,
  PhysicsMaterialPresetId,
  RagdollSettings,
  RenderSettings,
  RigidBodyType,
  TerrainBrushSettings,
  TerrainComponent,
  TransformComponent,
  VehicleComponent,
  Vector3Tuple,
  WaterVolumeComponent,
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
  quality: 'High',
  autoQuality: true,
  compressTextures: true,
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
  turnInPlace: true,
  turnInPlaceThreshold: 0.45,
  turnInPlaceSpeed: 10,
  mantleEnabled: true,
  keyMantle: '',
  mantleRange: 1.35,
  mantleMaxHeight: 1.45,
  vaultMaxHeight: 0.9,
  mantleDuration: 0.38,
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
  // Default to the arcade tire model; flip to 'raycast' for the real Rapier vehicle sim (fields below).
  physicsModel: 'arcade',
  // Tuned for a punchy-but-weighty arcade feel: brisk top speed, accel that pins you back, strong brakes,
  // and a touch of coast drag so letting off carries momentum into the next corner instead of gliding forever.
  maxSpeed: 34,
  maxReverseSpeed: 10,
  acceleration: 25,
  braking: 42,
  drag: 8,
  // A responsive steer lock + strong grip for crisp turn-in; the handbrake drops grip hard for a clean drift.
  steerAngle: 0.66,
  turnRate: 2.8,
  steerReturnSpeed: 0.25,
  gripFactor: 0.96,
  handbrakeGrip: 0.24,
  weightTransfer: 0.42,
  tractionControl: 0.35,
  downforce: 0.18,
  suspensionTravel: 0.14,
  suspensionStiffness: 0.18,
  bodyRoll: 0.05,
  bodyPitch: 0.05,
  crashDamageEnabled: true,
  crashDamageThreshold: 12,
  crashRolloverThreshold: 22,
  crashRolloverStrength: 0.32,
  crashDeformation: 0.45,
  crashWheelBreakThreshold: 1.6,
  crashDebris: true,
  wheelRadius: 0.4,
  rideHeight: 0.5,
  wheelRestY: 0.3,
  wheelObjectIds: [],
  steeredWheelIds: [],
  tireMarkIds: [],
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
  // --- Raycast sim defaults (used when physicsModel === 'raycast') — a stable, grippy hatchback. ---
  // Peak 1st-gear drive force; higher gears scale it down through the ratios (was a constant 1800 before
  // the drivetrain sim — raised so the geared car still launches hard and aero drag sets the top speed).
  engineForce: 2600,
  brakeForce: 2200,
  handbrakeForce: 1400,
  drivetrain: 'rwd',
  brakeBias: 0.55,
  chassisMass: 1100,
  centerOfMassY: -0.4,
  // Low now that aero drag is simulated explicitly (a high value here double-counts air resistance).
  linearDamping: 0.04,
  angularDamping: 0.6,
  wheelFrictionSlip: 1.4,
  sideFrictionStiffness: 0.9,
  suspensionRestLength: 0.35,
  suspensionStiffnessSim: 24,
  suspensionCompression: 0.82,
  suspensionRelaxation: 0.88,
  maxSuspensionForce: 30000,
  maxSuspensionTravelSim: 0.3,
  // Drivetrain sim: a 6-speed with a midrange-torque engine; auto box shifts itself, manual uses E/Q
  // (gamepad Y / LB through the default key aliases). Ratios are tuned to the 0.4u wheel so the shifts
  // land at ~45/70/100/130 km/h and the aero-limited top speed revs out 5th (6th is an overdrive).
  transmission: 'auto',
  gearRatios: [5.8, 3.8, 2.7, 2.0, 1.65, 1.35],
  finalDrive: 3.6,
  idleRpm: 900,
  maxRpm: 7200,
  shiftUpRpm: 6500,
  shiftDownRpm: 2400,
  shiftTime: 0.22,
  keyShiftUp: 'KeyE',
  keyShiftDown: 'KeyQ',
  // Aero + anti-roll + assists: planted at speed, flat in corners, forgiving to drive (assists on).
  aeroDrag: 0.35,
  downforceSim: 1.1,
  antiRollFront: 6000,
  antiRollRear: 4200,
  absEnabled: true,
  tcsEnabled: true,
  surfaceGripEnabled: true,
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
  foliageDensity: 1,
  foliageErase: false,
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

export const defaultPhysics = (
  bodyType: RigidBodyType = 'dynamic',
  collider: ColliderType = 'box',
  materialPreset: PhysicsMaterialPresetId = 'default',
): PhysicsComponent => ({
  enabled: false,
  bodyType,
  collider,
  materialPreset,
  isTrigger: false,
  collisionLayer: 0,
  collisionMask: 0xffff,
  mass: 1,
  gravityScale: 1,
  friction: 0.6,
  restitution: 0.05,
  linearDamping: 0,
  angularDamping: 0.05,
  windInfluence: 0,
});

export const defaultWaterVolume = (): WaterVolumeComponent => ({
  enabled: true,
  buoyancy: 1.25,
  drag: 1.8,
  angularDrag: 0.65,
  surfaceBounce: 0.55,
  waveAmplitude: 0.22,
  waveFrequency: 0.55,
  waveSpeed: 1.4,
  // Visuals — defaults read as a believable "ocean" until a style preset is applied.
  style: 'ocean',
  shallowColor: '#4FD2E8',
  deepColor: '#0A3A66',
  opacity: 0.82,
  reflectivity: 0.6,
  foam: 0.5,
  foamColor: '#EAF6FF',
  sparkle: 0.6,
  emissiveIntensity: 0,
  caustics: 0.35,
  underwaterFog: true,
  flowAngle: 0,
  flowStrength: 0,
  rainStrength: 0,
});

export const defaultJoint = (type: JointType = 'hinge'): JointComponent => ({
  enabled: true,
  type,
  connectedObjectId: undefined,
  localAnchor: [0, 0, 0],
  connectedAnchor: [0, 0, 0],
  axis: [0, 1, 0],
  limitsEnabled: false,
  limitMin: -Math.PI / 2,
  limitMax: Math.PI / 2,
  motorTargetVelocity: 0,
  motorMaxForce: 20,
  stiffness: 40,
  damping: 4,
  restLength: 1,
  maxLength: 2,
  collideConnected: false,
});

export const defaultCloth = (): ClothComponent => ({
  enabled: true,
  sourceMode: 'grid',
  resolution: 16,
  width: 2,
  height: 2,
  stiffness: 4,
  damping: 0.02,
  gravityScale: 1,
  wind: [1.5, 0, 0],
  turbulence: 0.4,
  pinMode: 'top-edge',
  collideFloor: true,
  floorY: 0,
  collideBodies: true,
  tearFactor: 0,
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
