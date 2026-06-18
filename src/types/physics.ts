import type { ColliderType, RigidBodyType, Vector3Tuple } from './common';

export interface PhysicsComponent {
  enabled: boolean;
  bodyType: RigidBodyType;
  collider: ColliderType;
  /** Named tuning preset for physical surface behavior. */
  materialPreset?: PhysicsMaterialPresetId;
  /** When true, the collider is a sensor/trigger: it fires trigger events but does not block or push. */
  isTrigger: boolean;
  /** Collision layer index, 0-15. */
  collisionLayer: number;
  /** Bit mask of layers this collider interacts with. */
  collisionMask: number;
  mass: number;
  gravityScale: number;
  friction: number;
  /** Bounciness, 0 = no bounce, 1 = very elastic. */
  restitution?: number;
  linearDamping: number;
  angularDamping: number;
  /** How strongly global scene wind pushes this DYNAMIC body (0 = ignores wind, the default). */
  windInfluence?: number;
  /** BREAKAWAY PROP (GTA streetlight): a FIXED body with this set converts to a DYNAMIC body and tumbles
   *  when something moving faster than this speed (units/sec) slams into it — lamp posts, signs, fences,
   *  bollards. The impactor's momentum carries into the falling prop. 0/undefined = solid as ever. */
  knockOverThreshold?: number;
  /** Continuous Collision Detection. Stops fast-moving DYNAMIC bodies from tunnelling through thin
   *  walls/floors at high speed by sweeping the collider along its motion each step. Has a small cost,
   *  so it's off by default — turn it on for bullets, fast vehicles, falling-from-height props.
   *  Projectiles always get CCD regardless of this flag. */
  ccd?: boolean;
}

export type PhysicsMaterialPresetId = 'default' | 'rubber' | 'slime' | 'ice' | 'metal' | 'stone' | 'wood' | 'mud';

/**
 * Physics joint/constraint kind (Rapier impulse joints):
 * - `fixed`    — welds two bodies rigidly (one moves, the other follows). Doors-on-a-pallet, welded debris.
 * - `spherical`— ball-and-socket: free rotation about the anchor, no separation. Chains, pendulums, shoulders.
 * - `hinge`    — revolute: rotates about one axis only. Doors, wheels, levers, valves. Supports limits + a motor.
 * - `slider`   — prismatic: slides along one axis only. Lifts, drawers, pistons, sliding doors. Limits + motor.
 * - `spring`   — distance spring: pulls/pushes toward a rest length with stiffness + damping. Bungees, suspension.
 * - `rope`     — limits the two anchors to a maximum separation (slack until taut). Tethers, hanging signs.
 */
export type JointType = 'fixed' | 'spherical' | 'hinge' | 'slider' | 'spring' | 'rope';

/**
 * A physics constraint linking THIS object's rigid body to another body (or to a fixed point in the
 * world). Both bodies should have physics enabled; the joint is created during Play and torn down on
 * stop. Anchors are LOCAL offsets from each body's origin. For `hinge`/`slider`, `axis` is the local
 * axis of rotation/translation. Motors (hinge/slider) drive a target velocity; limits clamp the range.
 */
export interface JointComponent {
  enabled: boolean;
  type: JointType;
  /** Object id of the body to link to. Empty/undefined = anchor to a static point in the world. */
  connectedObjectId?: string;
  /** Local anchor offset on THIS body. */
  localAnchor: Vector3Tuple;
  /** Local anchor offset on the connected body (ignored for a world anchor). */
  connectedAnchor: Vector3Tuple;
  /** Axis of rotation (hinge) or translation (slider), local space; normalized at use. */
  axis: Vector3Tuple;
  /** Clamp the hinge angle (radians) / slider distance (world units) to [limitMin, limitMax]. */
  limitsEnabled?: boolean;
  limitMin?: number;
  limitMax?: number;
  /** Hinge/slider motor: drive toward this velocity (rad/s or units/s). 0 = motor off. */
  motorTargetVelocity?: number;
  /** Max force/torque the motor may apply (higher = stiffer drive). */
  motorMaxForce?: number;
  /** Spring stiffness (`spring` type). Also used as the motor stiffness factor. */
  stiffness?: number;
  /** Spring damping (`spring` type). */
  damping?: number;
  /** Spring rest length in world units (`spring` type). */
  restLength?: number;
  /** Max separation for a `rope` joint (world units). */
  maxLength?: number;
  /** Allow the two linked bodies to collide with each other (default false: they pass through). */
  collideConnected?: boolean;
}

/**
 * Which particles of a cloth grid are anchored (don't fall). Pinned particles follow the cloth object's
 * world transform, so pinning to a moving/parented object (a character) makes the cloth hang off it.
 * - `top-edge`     — the whole top row (banner/curtain hanging from a rail).
 * - `top-corners`  — just the two top corners (a flag/sign on two ropes).
 * - `four-corners` — all four corners (a stretched tarp/net).
 * - `left-edge`    — the left column (a flag mounted to a vertical pole).
 * - `none`         — nothing pinned (a free falling sheet — drop it onto colliders).
 */
export type ClothPinMode = 'top-edge' | 'top-corners' | 'four-corners' | 'left-edge' | 'none';

/**
 * A real-time Verlet / position-based cloth sheet. This is a SEPARATE simulation from Rapier (which has
 * no soft bodies): the object renders a deforming grid mesh that integrates gravity + wind, satisfies
 * distance constraints, pins per `pinMode`, and collides against simple nearby shapes. Animates in edit
 * and Play. General-purpose: flags, banners, curtains, capes, hanging cloth.
 */
export interface ClothComponent {
  enabled: boolean;
  /** 'grid' = a procedural rectangular sheet; 'mesh' = simulate an imported model's own shape as cloth. */
  sourceMode?: 'grid' | 'mesh';
  /** Model asset whose mesh is used as the cloth when sourceMode is 'mesh' (e.g. an imported flag). */
  meshAssetId?: string;
  /** Grid divisions per axis (vertex count = (resolution+1)²). Clamped to a perf-safe range. */
  resolution: number;
  /** Sheet dimensions in local units before the object's scale (which also multiplies). */
  width: number;
  height: number;
  /** Constraint solver iterations per frame — higher = stiffer, less stretchy (and costlier). */
  stiffness: number;
  /** Velocity damping 0–1 (air resistance); higher = settles faster. */
  damping: number;
  /** Gravity multiplier (0 = floats, 1 = normal). */
  gravityScale: number;
  /** Constant wind force direction × strength (world space). */
  wind: Vector3Tuple;
  /** Random gust turbulence layered on the wind, 0–1. */
  turbulence: number;
  /** Which particles are anchored. */
  pinMode: ClothPinMode;
  /** Collide against a ground plane at `floorY`. */
  collideFloor: boolean;
  floorY: number;
  /** Collide against nearby physics/character colliders (sphere/box/capsule approximations). */
  collideBodies: boolean;
  /** Stretch ratio past which a constraint tears (snaps). 0 = never tears. */
  tearFactor: number;
}

/**
 * A real-time Verlet cable / rope — the 1D sibling of {@link ClothComponent} (Unreal's Cable Component).
 * A chain of particles linked by distance constraints, rendered as a solid TUBE through the simulated
 * points. The START is pinned to this object's world position; the far END either hangs free or, when
 * `endObjectId` is set, follows that object's position (Unreal's AttachEndTo) — so the cable spans two
 * objects and sags between them. Integrates gravity + wind, takes explosion blasts, and optionally
 * collides with the floor and nearby bodies, exactly like cloth. SEPARATE from Rapier. Animates in edit
 * and Play. Use for power lines, tow ropes, chains, hanging wires, vines, hoses, tethers.
 */
export interface CableComponent {
  enabled: boolean;
  /** Number of links; particle count = segments + 1. Clamped to a perf-safe range. */
  segments: number;
  /** Rest length of the cable in world units (the slack when its two ends are pulled apart). */
  length: number;
  /** Tube radius (cable thickness) in world units. */
  radius: number;
  /** Constraint solver iterations per frame — higher = stiffer, less stretchy (and costlier). */
  stiffness: number;
  /** Velocity damping 0–1 (air resistance); higher = settles faster. */
  damping: number;
  /** Gravity multiplier (0 = floats, 1 = normal). */
  gravityScale: number;
  /** Constant wind force direction × strength (world space). */
  wind: Vector3Tuple;
  /** Random gust turbulence layered on the wind, 0–1. */
  turbulence: number;
  /** Attach the far end to this object (Unreal AttachEndTo). Unset/empty = the end hangs free. */
  endObjectId?: string;
  /** Local offset added to the end object's position for the end attach point. */
  endOffset?: Vector3Tuple;
  /** World-space offset of the START attach point from this object's origin (e.g. a crane-tip pulley). */
  startOffset?: Vector3Tuple;
  /** Physical constraint flavor when `physics` is on: 'rope' (slack→taut tether) or 'spring' (elastic bungee). */
  physicsMode?: 'rope' | 'spring';
  /** Spring stiffness (physicsMode 'spring'): higher = pulls harder toward `length`. */
  springStiffness?: number;
  /** Spring damping (physicsMode 'spring'): higher = settles faster / less bouncy. */
  springDamping?: number;
  /** Visual look: 'cable' (smooth tube), 'rope' (helical braid), 'chain' (beaded links), 'wire' (thin). */
  style?: 'cable' | 'rope' | 'chain' | 'wire';
  /** Tint the cable toward red as it nears its breaking stretch (or just goes taut) — tension feedback. */
  tensionColor?: boolean;
  /**
   * PHYSICAL cable: when true (and an `endObjectId` is set), the runtime auto-maintains a Rapier ROPE
   * joint between this object's body and the end object's body, capped at `length` — so a dynamic end
   * actually swings/hangs under physics (wrecking ball, pendulum, tow rope) while the cable draws it.
   * Both ends need physics bodies (the store enables them: a missing start → fixed anchor, end → dynamic).
   * Off = the cable is purely cosmetic and just follows the end object's position.
   */
  physics?: boolean;
  /**
   * USE AN EXISTING physics joint instead of creating one. When true, the cable derives its far end from
   * a Rapier {@link JointComponent} (add_joint) already wired on this object (its connectedObjectId) — or,
   * if this object has none, from whatever object's joint connects TO it — and draws the rope between the
   * two physically-constrained bodies. It creates NO joint of its own (the existing constraint is the
   * authority), so it never double-constrains. Use this when you've already set up the wrecking-ball/
   * pendulum joint yourself and just want the cable to visualize it. Overrides `physics`.
   */
  followJoint?: boolean;
  /** Collide against a ground plane at `floorY`. */
  collideFloor: boolean;
  floorY: number;
  /** Collide against nearby physics/character colliders (sphere/box/capsule approximations). */
  collideBodies: boolean;
  /** Stretch ratio past which a link tears (snaps the cable). 0 = never tears. */
  tearFactor: number;
}

/** Ready-made looks for a Water Volume. 'custom' = keep whatever visual fields are set by hand. */
export type WaterStylePreset = 'ocean' | 'pool' | 'lake' | 'toxic' | 'lava' | 'custom';

export interface WaterVolumeComponent {
  enabled: boolean;
  /** Upward force multiplier for dynamic bodies below the water surface. */
  buoyancy: number;
  /** Linear drag applied while inside the volume; higher slows bodies faster. */
  drag: number;
  /** Angular drag applied while inside the volume. */
  angularDrag: number;
  /** Extra upward kick when a body hits/oscillates near the water surface. */
  surfaceBounce: number;
  /** Vertical wave height used by buoyancy and surface bounce. */
  waveAmplitude: number;
  /** Wave cycles per world unit. */
  waveFrequency: number;
  /** Wave scroll speed. */
  waveSpeed: number;

  // --- Visuals (rendered by the WaterSurface shader; all optional so legacy water keeps working) ---
  /** Look preset; applying one (other than 'custom') overwrites the visual fields below. */
  style?: WaterStylePreset;
  /** Tint near the surface / shallow edges. */
  shallowColor?: string;
  /** Tint of deep water (blended toward by view depth & fresnel). */
  deepColor?: string;
  /** Base surface opacity 0–1 (clear pools low, murky water high). */
  opacity?: number;
  /** Fresnel + sky-reflection strength 0–1. */
  reflectivity?: number;
  /** Crest + shoreline foam amount 0–1. */
  foam?: number;
  /** Foam tint. */
  foamColor?: string;
  /** Animated micro-ripple sparkle / specular sharpness 0–1. */
  sparkle?: number;
  /** Self-illumination 0–2 (glowing lava / toxic sludge). */
  emissiveIntensity?: number;
  /** Animated caustic shimmer across the surface 0–1. */
  caustics?: number;
  /** Tint the screen & add fog while the active camera is submerged. */
  underwaterFog?: boolean;
  /** Current direction in degrees on the XZ plane (0 = +X, 90 = +Z). Drives rivers/waterfalls. */
  flowAngle?: number;
  /** Current strength 0–4: scrolls the surface and pushes dynamic bodies along `flowAngle`. 0 = still. */
  flowStrength?: number;
  /** Rain intensity 0–1: speckles the surface with expanding raindrop ripple rings. 0 = clear weather. */
  rainStrength?: number;
}

