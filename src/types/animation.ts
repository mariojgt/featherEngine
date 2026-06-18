import type { CompareOperator, Vector3Tuple } from './common';
import type { SkeletonSocket } from './environment';

/**
 * Plays skeletal animation on an object that renders an imported skinned glTF/GLB model.
 *
 * Phase 0 (spike): plays a single named clip from the model assigned in the object's
 * `renderer.modelAssetId`. Later phases replace `clip` with a `controllerId` (a reusable
 * Animator Controller state machine) and a `skeletalMeshId` decoupled from the renderer.
 */
export interface AnimatorComponent {
  enabled: boolean;
  /**
   * Animator Controller (state machine) that decides which clip plays based on parameters. When set
   * it takes priority over `animationId`/`clip` — those remain the "play one clip" fallback.
   */
  controllerId?: string;
  /**
   * Animation asset (in `project.animations`) to play. It may live in a different GLB than the
   * rendered mesh — the clip is rebound to the mesh's bones by name, which is how a skeleton's
   * clips are reused across compatible meshes.
   */
  animationId?: string;
  /** Skeletal Mesh asset to render. Falls back to the renderer's `modelAssetId` GLB when unset. */
  skeletalMeshId?: string;
  /** Legacy/fallback: raw clip name played from the renderer's GLB when no Animation asset is set. */
  clip?: string;
  /** Playback speed multiplier (1 = authored speed). */
  speed: number;
  /** Loop the clip, or play once and hold the final frame. */
  loop: boolean;
}

/**
 * A reusable skeleton identity (Unreal-style). Two rigs whose bone hierarchy matches share the same
 * `signature`, so the importer reuses one Skeleton asset for both — and every Animation targeting that
 * skeleton becomes playable on every Skeletal Mesh bound to it.
 */
export interface SkeletonAsset {
  id: string;
  name: string;
  /** GLB asset id the skeleton was first derived from. */
  sourceAssetId: string;
  /** Bone node names in hierarchy order. */
  boneNames: string[];
  /** Stable hash of the bone hierarchy — the compatibility key. */
  signature: string;
  rootBone: string;
  /** Reusable named sockets placed on this skeleton (Unreal-style), referenced by attachments. */
  sockets?: SkeletonSocket[];
  /** Physics-ragdoll tuning for this skeleton (global multipliers). Defaults applied when absent. */
  ragdoll?: RagdollSettings;
  /** Containing folder id, or undefined for the project root. */
  folderId?: string;
  createdAt: number;
}

/** Collision primitive used for a ragdoll bone body (Unreal PhAT-style). */
export type RagdollBodyShape = 'capsule' | 'box' | 'sphere';

/**
 * Per-bone physics body override (Unreal "Physics Asset" / PhAT style). Every field is optional and
 * falls back to the skeleton's global `RagdollSettings` defaults (or auto-sizing from the bone length).
 * Keyed by `boneName`. Set `enabled: false` to exclude a specific bone from the simulation.
 */
export interface RagdollBodyDef {
  /** Bone this body is attached to (matches a name in SkeletonAsset.boneNames). */
  boneName: string;
  /** Simulate this bone? Defaults to true. False removes its body + joint. */
  enabled?: boolean;
  /** Collision shape. Defaults to 'capsule'. */
  shape?: RagdollBodyShape;
  /** Capsule/sphere radius (world units). Falls back to the global capsuleRadius. */
  radius?: number;
  /** Capsule half-length override; 0/undefined = auto from the distance to the child bone. */
  length?: number;
  /** Box half-extents [x,y,z] when shape is 'box'. */
  halfExtents?: Vector3Tuple;
  /** Mass density override. Falls back to the global density. */
  density?: number;
  /** Linear damping override. Falls back to the global linearDamping. */
  linearDamping?: number;
  /** Angular damping override — acts as this joint's stiffness (higher = stiffer). Falls back to global. */
  angularDamping?: number;
}

/**
 * Ragdoll definition saved on a SkeletonAsset and shared by every mesh/character using it. The top-level
 * fields are GLOBAL DEFAULTS applied to every simulated bone; `bodies` holds optional Unreal-PhAT-style
 * per-bone overrides. RagdollRig builds one rigid body per bone (capsule/box/sphere) linked by spherical
 * joints at runtime from this definition.
 */
export interface RagdollSettings {
  /** Default capsule radius (world units) for each bone body — fatter = more stable, less floppy. */
  capsuleRadius: number;
  /** Default mass density of the bone bodies — higher = heavier, swings slower. */
  density: number;
  /** Default linear damping — higher = bodies lose travel speed faster (less sliding). */
  linearDamping: number;
  /** Default angular damping — higher = joints stop spinning sooner (stiffer-looking). */
  angularDamping: number;
  /** Floor height the ragdoll piles up on (world Y). */
  groundY: number;
  /** Case-insensitive regex source: bone names matching this are NOT simulated (fingers, hair, etc.). */
  excludePattern: string;
  /** Per-bone overrides (Unreal PhAT-style). Bones without an entry use the defaults above. */
  bodies?: RagdollBodyDef[];
}

/** A skinned mesh bound to a Skeleton. The geometry lives in `sourceAssetId`'s GLB. */
export interface SkeletalMeshAsset {
  id: string;
  name: string;
  sourceAssetId: string;
  skeletonId: string;
  folderId?: string;
  createdAt: number;
}

/** A single animation clip targeting a Skeleton (Unreal "Animation Sequence"). */
export interface AnimationAsset {
  id: string;
  name: string;
  /** GLB asset id the clip lives in. */
  sourceAssetId: string;
  /** Clip name within that GLB. */
  clipName: string;
  skeletonId: string;
  duration: number;
  /** Default loop hint (true for clips authored to loop, e.g. names ending in "_Loop"). */
  loop: boolean;
  folderId?: string;
  createdAt: number;
}

export type AnimatorParamType = 'float' | 'bool' | 'trigger';

/**
 * Where a parameter's value comes from each frame:
 * - `manual`: set by scripts (animator.setX nodes) or the AI — the engine never touches it.
 * - `speed`: the object's horizontal movement speed (units/sec) this frame.
 * - `verticalSpeed`: the object's vertical velocity (units/sec) — use for jump/fall states.
 * - `moving`: boolean, true when horizontal speed exceeds a small threshold.
 * - `variable`: mirrors a project variable (`variableId`), so existing scripts drive animation for free.
 */
export type AnimatorParamSource =
  | 'manual'
  | 'speed'
  | 'verticalSpeed'
  | 'moving'
  | 'crouching'
  | 'grounded'
  | 'rolling'
  | 'attacking'
  | 'weaponEquipped'
  | 'aiming'
  | 'reloading'
  | 'interacting'
  | 'emoting'
  | 'crawling'
  | 'swimming'
  | 'climbing'
  | 'mantling'
  | 'turning'
  | 'moveX'
  | 'moveY'
  | 'sliding'
  | 'landing'
  | 'rollX'
  | 'variable';

export interface AnimatorParameter {
  id: string;
  name: string;
  type: AnimatorParamType;
  defaultValue: number | boolean;
  source: AnimatorParamSource;
  /** For `source: 'variable'` — the project variable whose value this parameter tracks. */
  variableId?: string;
}

/** One condition guarding a transition: a parameter compared against a constant. */
export interface AnimatorCondition {
  parameterId: string;
  op: CompareOperator;
  value: number | boolean;
}

/** A node in the state machine — plays one animation while active. */
export interface AnimatorState {
  id: string;
  name: string;
  /** Animation asset to play (AnimationAsset id). Ignored when this is a blend space (see below). */
  animationId?: string;
  speed: number;
  loop: boolean;
  /** Position in the node-graph editor canvas. */
  position?: { x: number; y: number };
  /** BLEND SPACE (Unreal-style): when set, this state blends `blendSamples` continuously by the value of
   *  `blendParameterId` (1D, e.g. Speed → idle/walk/jog/sprint) — and, when `blendParameterIdY` is also set,
   *  by a second axis too (2D, e.g. moveX × moveY → directional strafe), instead of playing one clip. */
  blendParameterId?: string;
  blendParameterIdY?: string;
  blendSamples?: AnimatorBlendSample[];
}

/** One sample of a blend space: an animation placed at `value` on the X axis (and `y` on the Y axis for 2D). */
export interface AnimatorBlendSample {
  animationId: string;
  value: number;
  y?: number;
}

/** A directed edge between states; taken when all conditions pass. */
export interface AnimatorTransition {
  id: string;
  /** Source state id, or 'any' to allow leaving from any state. */
  from: string | 'any';
  to: string;
  conditions: AnimatorCondition[];
  /** Crossfade duration in seconds. */
  duration: number;
  /** Only leave after the current state's clip has played to `exitTime` — for one-shots (Jump Start/Land). */
  hasExitTime?: boolean;
  /** Fraction (0–1) of the clip that must elapse before the transition can fire. Defaults to 1 (clip end). */
  exitTime?: number;
}

/** A reusable animation state machine (Unreal Animation Blueprint / Unity Animator Controller). */
export interface AnimatorController {
  id: string;
  name: string;
  /** Skeleton this controller is authored against; its states' animations should target it. */
  skeletonId?: string;
  parameters: AnimatorParameter[];
  states: AnimatorState[];
  defaultStateId?: string;
  transitions: AnimatorTransition[];
  folderId?: string;
  createdAt: number;
}

/**
 * A built-in third-person character controller. During Play it reads WASD/arrows (Shift = sprint,
 * Space = jump), moves the object on the ground plane, applies gravity/jump, and yaws the mesh toward
 * its movement. The motion it produces is what feeds an Animator's `speed`/`verticalSpeed`/`moving`
 * parameters — so a locomotion controller animates with no extra wiring. An optional follow camera
 * trails the character in the game view / exported game.
 */
export interface CharacterControllerComponent {
  enabled: boolean;
  /** Ground move speed (units/sec). */
  moveSpeed: number;
  /** Speed multiplier while the sprint key (Shift) is held. */
  sprintMultiplier: number;
  /** Speed multiplier while the crouch key is held (also drives a "crouching" animator parameter). */
  crouchMultiplier: number;
  /** Speed multiplier while the crawl key is held (drives a "crawling" animator parameter). */
  crawlMultiplier?: number;
  /**
   * Strafe mode: the character faces the CAMERA (instead of turning to face movement) and moves in all 8
   * directions — pairs with a 2D directional blend space via the "moveX"/"moveY" parameter sources.
   */
  strafe?: boolean;
  /** Initial upward velocity of a jump (units/sec). */
  jumpStrength: number;
  /** Downward acceleration (units/sec²). */
  gravity: number;
  /**
   * Gravity multiplier applied while DESCENDING (vertical velocity < 0). >1 makes the fall snappier than
   * the rise — the classic fix for "floaty" jumps. Default 1.9. (Rising uses plain `gravity`.)
   */
  fallMultiplier?: number;
  /**
   * Variable jump height: the fraction of upward velocity KEPT when the jump key is released while still
   * rising (a tap = short hop, a hold = full jump). 0 = hard cut, 1 = no cut. Default 0.45.
   */
  jumpCutMultiplier?: number;
  /** Grace window (seconds) after walking off a ledge during which a jump still registers. Default 0.12. */
  coyoteTime?: number;
  /**
   * Jump buffering: a jump pressed up to this many seconds BEFORE landing is remembered and fires on
   * touchdown (the twin of coyoteTime — together they make jumping feel reliable). Default 0.15. 0 disables.
   */
  jumpBufferTime?: number;
  /**
   * Landing recovery (0..1): a hard touchdown briefly saps move speed and dips the camera, scaled by
   * impact velocity — gives jumps consequence and weight. Drives the "landing" animator source.
   * Default 0.4. 0 disables.
   */
  landingRecovery?: number;
  /**
   * Gravity multiplier near the jump apex (while |vertical velocity| is small): <1 adds a brief "hang"
   * at the top of the arc so jumps feel controllable, while fallMultiplier keeps the descent snappy.
   * Default 0.65. 1 disables.
   */
  apexHang?: number;
  /**
   * Turn-rate multiplier at full sprint speed — turning eases from full rate at a standstill down to
   * this at sprint, so sprint arcs feel weighty instead of pivoting on a dime. Default 0.55. 1 disables.
   */
  sprintTurnFactor?: number;
  /**
   * Sprint-slide: tapping crouch at sprint speed drops into a momentum slide (steerable, decaying,
   * jump-cancellable) that drives the "sliding" animator source. Default true.
   */
  slideEnabled?: boolean;
  /** Max slide duration (seconds). Default 0.9. */
  slideDuration?: number;
  /** Slide entry speed = current speed × this (the little surge that sells the slide). Default 1.2. */
  slideSpeedBoost?: number;
  /**
   * Ground acceleration (units/sec²) ramping horizontal speed UP toward the target. Higher = snappier
   * starts; lower = weightier. `undefined` keeps the legacy instant-velocity behavior. Default 60.
   */
  acceleration?: number;
  /** Ground deceleration (units/sec²) easing horizontal speed DOWN to a stop (slide-to-stop). Default 70. */
  deceleration?: number;
  /** Multiplier (0..1) on accel/decel while airborne — lower = less air steering. Default 0.35. */
  airControl?: number;
  /** How fast (radians/sec) the mesh turns to face its movement direction. */
  turnSpeed: number;
  /** Rotate the idle third-person body toward the mouse-look camera so starting/stopping feels authored. */
  turnInPlace?: boolean;
  /** Yaw difference (radians) before idle turn-in-place starts. Default 0.45. */
  turnInPlaceThreshold?: number;
  /** Turn-in-place rotation speed (radians/sec). Defaults to turnSpeed. */
  turnInPlaceSpeed?: number;
  /** Enable Space-to-vault/mantle against tagged obstacles (`vaultable` / `mantleable`). */
  mantleEnabled?: boolean;
  /** Optional dedicated mantle key. If omitted, jump starts a mantle/vault when a tagged obstacle is ahead. */
  keyMantle?: string;
  /** How far ahead the controller searches for a mantle/vault target. Default 1.35. */
  mantleRange?: number;
  /** Tallest obstacle top the controller can mantle onto. Default 1.45. */
  mantleMaxHeight?: number;
  /** Low obstacles at or below this height are treated as vaults. Default 0.9. */
  vaultMaxHeight?: number;
  /** Seconds for the authored mantle/vault arc. Default 0.38. */
  mantleDuration?: number;
  /**
   * Extra yaw (radians) added when facing movement, to match the model's authored forward axis.
   * 0 for models whose forward is +Z (e.g. Quaternius); Math.PI for -Z-forward models.
   */
  modelYawOffset: number;
  /** Y the character's origin rests at when grounded. */
  groundLevel: number;
  // --- Input bindings (KeyboardEvent.code). Used by auto-mode and the Get Move Input node. ---
  keyForward: string;
  keyBackward: string;
  keyLeft: string;
  keyRight: string;
  keyJump: string;
  keySprint: string;
  keyCrouch: string;
  /** Crawl key — slows movement (crawlMultiplier) + drives the "crawling" animator parameter. */
  keyCrawl?: string;
  keyRoll: string;
  /** Forward dash speed (units/sec) during a roll/dodge. */
  rollSpeed: number;
  /** How long a roll lasts (seconds) — set to the roll clip's length by the pawn builder. */
  rollDuration: number;
  /** Attack key — fires the "attacking" animator parameter (punch unarmed, weapon attack when equipped). */
  keyAttack: string;
  /** Melee hit: damage dealt to objects with `health` in a front cone when attacking WITHOUT a ranged weapon
   *  (sword swing / punch). Default 34. */
  meleeDamage?: number;
  /** Melee hit reach (world units) for the front-cone damage check. Default 2.4. */
  meleeRange?: number;
  /** Aim key (held) — drives the "aiming" parameter (ranged-weapon aim pose). */
  keyAim: string;
  /** Reload key — pulses the "reloading" parameter (ranged-weapon reload). */
  keyReload: string;
  /** Interact key — pulses the "interacting" parameter (use/pick-up) AND fires the focused interactable's
   *  Interact event (Unreal-style). */
  keyInteract: string;
  /** Max distance (world units) to focus an interactable object in front of the character. Default 3. */
  interactRange?: number;
  /** Emote key (held) — drives the "emoting" parameter (dance/wave). */
  keyEmote: string;
  // --- Lock-on targeting (Z-targeting) ---
  /**
   * Enable lock-on targeting: the lock-on key toggles a lock onto the nearest living target (an object
   * with a `health` instance variable > 0 or an `enemy` tag) in range. While locked the character strafes
   * facing the target and the follow camera steers to keep both in frame. The lock breaks when the target
   * dies, is destroyed, or moves past `lockOnBreakDistance`.
   */
  lockOnEnabled?: boolean;
  /** Lock-on toggle key. Default "KeyT". */
  keyLockOn?: string;
  /** Max distance (world units) to acquire a lock-on target. Default 16. */
  lockOnRange?: number;
  /** Distance at which an existing lock breaks. Default 22. */
  lockOnBreakDistance?: number;
  /** Test key that toggles the physics ragdoll on this character during Play. */
  keyRagdoll: string;
  // --- Player sound effects (audio asset ids; played automatically by the runtime on the matching event). ---
  /** Played on a stride cadence while this character moves on the ground (footsteps). */
  footstepSoundId?: string;
  /** Played when the character launches a jump. */
  jumpSoundId?: string;
  /** Played when the character touches down after being airborne. */
  landSoundId?: string;
  /** Played (as a splash) when the character first enters a water volume. */
  swimSoundId?: string;
  /** Played when the character starts an attack (punch / weapon swing). */
  attackSoundId?: string;
  /** Played when the character's `health` variable drops (took damage). */
  hurtSoundId?: string;
  // --- Camera ---
  /** Follow style used by the runtime camera. */
  cameraMode: 'thirdPerson' | 'firstPerson';
  /** Use this character's runtime camera in game view / export. */
  cameraFollow: boolean;
  /**
   * Resting camera position relative to the character, as a local offset [side, up, back].
   * Negative Z sits behind a +Z-forward model. Positioned with the on-screen camera gizmo.
   */
  cameraOffset: Vector3Tuple;
  /**
   * Shoulder-swap key (third person): tapping it mirrors the camera's side offset to the other shoulder,
   * smoothly sweeping across the character's back. Also flips the aim-down-sights shoulder shift, so it
   * matters even with a centred camera. Default "KeyV".
   */
  keySwapShoulder?: string;
  /** Orbit the follow camera with the mouse (click the view to capture the pointer). */
  mouseLook: boolean;
  /** Radians of camera rotation per pixel of mouse movement. */
  mouseSensitivity: number;
  /** Base camera elevation (radians) before mouse pitch is added. */
  cameraPitch: number;
  /** Pitch clamps (radians). */
  cameraMinPitch: number;
  cameraMaxPitch: number;
  /** Move relative to where the camera faces (third-person feel) vs. fixed world axes. */
  cameraRelativeMovement: boolean;
}

