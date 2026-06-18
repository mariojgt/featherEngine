import type { GraphValue, SceneObjectKind, Vector3Tuple } from './common';
import type { MeshRendererComponent, TerrainComponent, TransformComponent } from './geometry';
import type { AnimatorComponent, CharacterControllerComponent } from './animation';
import type { CableComponent, ClothComponent, JointComponent, PhysicsComponent, WaterVolumeComponent } from './physics';
import type { AttachmentComponent, LightComponent, ScriptGraphComponent, UIComponent, ViewModelComponent } from './environment';
import type { VehicleComponent } from './vehicle';

export interface SceneObject {
  id: string;
  name: string;
  kind: SceneObjectKind;
  parentId?: string;
  transform: TransformComponent;
  renderer?: MeshRendererComponent;
  physics?: PhysicsComponent;
  /** Physics constraint linking this body to another (hinge/slider/spring/rope/fixed/ball). See {@link JointComponent}. */
  joint?: JointComponent;
  /** Real-time cloth sheet (Verlet sim, separate from Rapier). See {@link ClothComponent}. */
  cloth?: ClothComponent;
  /** Real-time cable/rope (Verlet sim rendered as a tube, separate from Rapier). See {@link CableComponent}. */
  cable?: CableComponent;
  script?: ScriptGraphComponent;
  animator?: AnimatorComponent;
  character?: CharacterControllerComponent;
  /** Built-in arcade car controller (driving). See {@link VehicleComponent}. */
  vehicle?: VehicleComponent;
  attachment?: AttachmentComponent;
  viewModel?: ViewModelComponent;
  ui?: UIComponent;
  /** Procedural streamed terrain surface and optional instanced foliage. */
  terrain?: TerrainComponent;
  /** Unreal-style water/physics volume: swim mode for characters plus buoyancy/drag/waves for dynamic bodies. */
  water?: WaterVolumeComponent;
  /** Per-instance data (e.g. this enemy's `health`), read/written by scripts and world UI bindings via `self.*`. */
  variables?: Record<string, GraphValue>;
  /** Present on runtime-spawned projectiles (action.spawnProjectile): flies forward, damages on hit, despawns. */
  projectile?: ProjectileComponent;
  /** Present on a runtime-spawned particle burst (e.g. a bullet impact): a short-lived THREE.Points effect. */
  effect?: EffectComponent;
  /** Authored particle emitter (fire, smoke, sparks, magic, fountain) — previews in the editor and plays in-game. */
  particles?: ParticleSystemComponent;
  /** Lighting for a `kind: 'light'` object — configurable point / spot / directional light. */
  light?: LightComponent;
  /** Weapon/item inventory — drives the on-screen slot bar and click-to-equip (spawn attached + montage). */
  inventory?: InventoryComponent;
  /** Set on EVERY object stamped from a prefab — the source prefab's id. Lets the editor find all
   * instances of a prefab and propagate edits to them (with per-instance overrides preserved). */
  prefabSourceId?: string;
  /** The id of the object WITHIN the prefab definition this instance object was stamped from. Pairs with
   * prefabSourceId to 3-way-merge prefab edits while keeping per-instance overrides. Absent on objects
   * the user ADDED to an instance (instance-local additions, which are kept as-is on re-merge). */
  prefabObjectId?: string;
  /** Destructible setup — when enabled, the object shatters into dynamic cubes on impact/damage or the Fracture node. */
  fracture?: FractureComponent;
}

/** How the pieces are cut: an even grid, big irregular chunks, or many small bits. */
export type FracturePattern = 'uniform' | 'chunks' | 'shatter';

/** Makes an object destructible. Shatters into dynamic box pieces that burst apart. */
export interface FractureComponent {
  enabled: boolean;
  /** Cut style: 'uniform' even grid, 'chunks' few big irregular pieces, 'shatter' many small bits. */
  pattern: FracturePattern;
  /** Detail / base piece count (2–6). Higher = more, smaller pieces. */
  pieces: number;
  /** Irregularity 0–1: how uneven the piece sizes are (chunks/shatter only). */
  jitter: number;
  /** Seed so a break is repeatable; change it for a different-looking break. */
  seed: number;
  /** Burst impulse applied to each piece when it breaks. */
  strength: number;
  /** Auto-shatter when hit at this speed (units/sec) or faster; 0 = only on death/Fracture node. */
  impactThreshold: number;
  /** Make pieces smaller near the impact point and bigger away (radial fracture). */
  focusImpact: boolean;
}

/** One equippable inventory slot (a weapon/item). An empty `weaponAssetId` is the "unarmed" slot. */
export interface InventorySlot {
  /** Short label shown on the HUD slot (e.g. "Fist", "Sword", "Pistol"). */
  label: string;
  /** Model asset id attached to the hand on equip; omit for unarmed (holster). */
  weaponAssetId?: string;
  /** When true, equipping this slot enables ranged fire (sets the RangedMode animator param). */
  ranged?: boolean;
  /** Uniform scale + Y-yaw applied to the attached weapon so the grip seats correctly. */
  attachScale?: number;
  attachYaw?: number;
  /** Fine-grained local grip offset applied after the target hand/socket transform. */
  attachPosition?: Vector3Tuple;
  attachRotation?: Vector3Tuple;
  /** One-shot montage (Animation asset id) played on the character when this slot is equipped. */
  equipAnimId?: string;
}

/** A character's weapon inventory — the on-screen bar + click-to-equip switching. */
export interface InventoryComponent {
  slots: InventorySlot[];
  /** Index of the currently equipped slot. */
  equipped: number;
  /** Bone + named socket the weapon attaches to (default hand_r / "RightHand"). */
  boneName?: string;
  socketName?: string;
  /** Audio asset id played on each weapon switch. */
  switchSoundId?: string;
}

/** Marks a runtime-spawned projectile. The runtime moves it by `velocity`, despawns it after `life`
 * seconds, and on contact with a non-owner reduces that object's `health` instance variable by `damage`. */
export interface ProjectileComponent {
  /** Object that fired it — never damaged by its own projectile. */
  ownerId: string;
  /** Hit-point damage subtracted from the struck object's `health` instance variable. */
  damage: number;
  /** Seconds left before it despawns on its own. */
  life: number;
  /** World-space travel velocity (units/sec). */
  velocity: Vector3Tuple;
  /** Multiplier for the knockback impulse applied to a struck DYNAMIC prop (0 = none). Default ~1. */
  knockback?: number;
  /** When true, the projectile detonates (area-damage blast + VFX) on impact / lifetime expiry. */
  explosive?: boolean;
  /** Blast radius + damage for an explosive projectile (defaults 4.5 / 60). */
  blastRadius?: number;
  blastDamage?: number;
  /** Audio asset id played when an explosive projectile detonates. */
  blastSound?: string;
  /** When true, the runtime logs this projectile's spawn + hits to the runtime console. */
  debug?: boolean;
}

/** A runtime-spawned, self-despawning particle burst (bullet impacts, muzzle flashes). THREE.Points + a flash light. */
export interface EffectComponent {
  /** 'impact' = omni spark burst; 'muzzle' = brief forward flash; 'splash' = water droplets; 'dust' = soft
   *  drifting smoke/dust billows (tire smoke, offroad dust, landings); 'damage' = a floating combat damage
   *  number (uses `value`). */
  kind: 'impact' | 'muzzle' | 'splash' | 'dust' | 'damage';
  /** For kind 'damage': the number to display (the hit-point amount). */
  value?: number;
  /** Seconds remaining before it despawns. */
  life: number;
  /** Total lifetime (so the renderer can compute 0→1 progress for expansion + fade). */
  maxLife: number;
  /** Particle tint. */
  color: string;
  /** Particle count. */
  count: number;
}

/** Emission volume the particles spawn from (in the emitter's local space). */
export type ParticleEmitterShape = 'point' | 'sphere' | 'hemisphere' | 'cone' | 'box' | 'disc';
/** How particles composite — additive glows (fire/sparks/magic), normal layers (smoke/debris). */
export type ParticleBlendMode = 'additive' | 'normal';

/**
 * The tunable emitter settings shared by an authored particle component AND a reusable particle-system
 * asset ([ParticleSystemDefinition]). Pure data — no identity, no enable flag.
 */
export interface ParticleConfig {
  /** Emit continuously while active (fire/smoke/fountain). False = only bursts emit. */
  looping: boolean;
  /** Particles spawned per second while looping. */
  rate: number;
  /** Particles released in one burst on start (and via the Burst Particles node / bus). */
  burst: number;
  /** Hard cap on simultaneously-live particles (pool size). */
  maxParticles: number;
  /** Emission volume shape. */
  shape: ParticleEmitterShape;
  /** Radius for sphere / hemisphere / cone base / disc (units). */
  shapeRadius: number;
  /** Cone half-angle in degrees (shape 'cone'). */
  coneAngle: number;
  /** Initial speed along the emission direction (units/sec). */
  speed: number;
  /** 0–1 random speed variation. */
  speedJitter: number;
  /** Base emit direction in the emitter's local space (normalized at runtime). */
  direction: Vector3Tuple;
  /** Constant downward acceleration (world -Y). Negative = buoyant rise (smoke). */
  gravity: number;
  /** Velocity damping per second (0 = none). */
  drag: number;
  /** Particle lifetime in seconds. */
  lifetime: number;
  /** 0–1 random lifetime variation. */
  lifetimeJitter: number;
  /** Particle size (world units) at birth and death — interpolated over life. */
  startSize: number;
  endSize: number;
  /** Particle color (hex) at birth and death — interpolated over life. */
  startColor: string;
  endColor: string;
  /** Opacity at birth and death — interpolated over life. */
  startOpacity: number;
  endOpacity: number;
  /** Simulate in world space (particles stay put as the emitter moves) vs local (ride the emitter). */
  worldSpace: boolean;
  /** Additive (fire/sparks/magic) or normal (smoke/debris) blending. */
  blend: ParticleBlendMode;
  /** Optional sprite texture (image asset id). Falls back to a soft round dot. */
  textureAssetId?: string;
  /** Emit a soft point-light pulse tinted to startColor (nice for fire/explosions). */
  light?: boolean;
}

/**
 * An authored particle emitter living on an object (fire, smoke, sparks, magic, fountain). Previews
 * live in the editor and plays in-game. The renderer ([src/three/ParticleSystem.tsx]) pools
 * `maxParticles` points and simulates them each frame; scripts start/stop emission and fire bursts via
 * the particle command bus ([src/runtime/particleBus.ts]). When `systemId` is set the emitter pulls its
 * config from a reusable [ParticleSystemDefinition] asset (editing the asset updates every instance,
 * like materials); otherwise the inline fields are used.
 */
export interface ParticleSystemComponent extends ParticleConfig {
  /** Master switch — false = dormant (no preview, no play emission). */
  enabled: boolean;
  /** When set, the emitter resolves its config from this reusable particle-system asset. */
  systemId?: string;
}

/**
 * A reusable, project-level particle-system asset (Unreal-style). Created via the Project Browser,
 * edited in the Particle System panel with a live preview, referenced by objects (`systemId`) and
 * spawned at runtime via the "Spawn Particle System" Blueprint node.
 */
export interface ParticleSystemDefinition extends ParticleConfig {
  id: string;
  name: string;
  description?: string;
  folderId?: string;
  createdAt: number;
}

