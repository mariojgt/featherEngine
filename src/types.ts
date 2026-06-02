import type { Edge, Node } from '@xyflow/react';

export type Vector3Tuple = [number, number, number];

export type SceneObjectKind = 'empty' | 'cube' | 'sphere' | 'capsule' | 'plane' | 'light' | 'camera';

export type RigidBodyType = 'dynamic' | 'fixed' | 'kinematic';

// 'mesh' = exact triangle mesh (trimesh; best for static geometry), 'convex' = convex hull
// of the model's vertices (cheaper, valid for dynamic bodies). Both require an imported model.
export type ColliderType = 'box' | 'sphere' | 'capsule' | 'mesh' | 'convex';

export type AssetType = 'model' | 'image' | 'audio' | 'unknown';

export type GraphValueType = 'number' | 'string' | 'boolean' | 'vector3';

export type GraphValue = number | string | boolean | Vector3Tuple;

export type CompareOperator = '==' | '!=' | '>' | '>=' | '<' | '<=';

export type GraphNodeCategory =
  | 'Events'
  | 'Logic'
  | 'Math'
  | 'Runtime'
  | 'Physics'
  | 'Audio'
  | 'Values'
  | 'Variables'
  | 'Data'
  | 'Persistence'
  | 'Material'
  | 'UI';

export type GraphNodeTone =
  | 'event'
  | 'logic'
  | 'math'
  | 'runtime'
  | 'physics'
  | 'audio'
  | 'value'
  | 'variable'
  | 'data'
  | 'persistence'
  | 'material'
  | 'ui';

export type GraphNodeKind =
  | 'event.start'
  | 'event.update'
  | 'event.keyDown'
  | 'event.keyUp'
  | 'event.custom'
  | 'event.collisionEnter'
  | 'event.triggerEnter'
  | 'event.triggerExit'
  | 'event.interact'
  | 'logic.branch'
  | 'logic.compare'
  | 'logic.and'
  | 'logic.or'
  | 'math.add'
  | 'math.clamp'
  | 'math.lerp'
  | 'value.number'
  | 'value.string'
  | 'value.boolean'
  | 'value.vector3'
  | 'variable.get'
  | 'variable.set'
  | 'data.tableGet'
  | 'action.translate'
  | 'action.rotate'
  | 'action.applyForce'
  | 'action.fireEvent'
  | 'action.spawnObject'
  | 'action.destroyObject'
  | 'action.playSound'
  | 'action.setMaterialColor'
  | 'action.setMaterialProperty'
  | 'action.getMaterialColor'
  | 'action.getMaterialProperty'
  | 'animator.setFloat'
  | 'animator.setBool'
  | 'animator.setTrigger'
  | 'animator.getParam'
  | 'animator.getState'
  | 'input.move'
  | 'query.grounded'
  | 'action.move'
  | 'action.jump'
  | 'action.setCamera'
  | 'action.setRagdoll'
  | 'action.spawnProjectile'
  | 'action.setVisible'
  | 'action.spawnAttached'
  | 'action.playAnimation'
  | 'action.setMovementMode'
  | 'action.facePlayer'
  | 'ai.distanceToPlayer'
  | 'ai.directionToPlayer'
  | 'logic.cooldown'
  | 'material.output'
  | 'material.color'
  | 'material.scalar'
  | 'material.texture'
  | 'material.mix'
  | 'material.multiply'
  | 'material.add'
  | 'material.clamp'
  | 'save.write'
  | 'save.load'
  | 'save.clear'
  | 'action.print'
  | 'ui.show'
  | 'ui.hide'
  | 'ui.setText'
  | 'variable.getObject'
  | 'variable.setObject';

export interface NodeForgeNodeData extends Record<string, unknown> {
  label: string;
  nodeKind: GraphNodeKind;
  category: GraphNodeCategory;
  description: string;
  tone: GraphNodeTone;
  eventName?: string;
  keyCode?: string;
  axis?: 'x' | 'y' | 'z';
  amount?: number;
  valueType?: GraphValueType;
  numberValue?: number;
  stringValue?: string;
  booleanValue?: boolean;
  vectorValue?: Vector3Tuple;
  variableId?: string;
  tableId?: string;
  rowKey?: string;
  columnId?: string;
  compareOp?: CompareOperator;
  saveSlot?: string;
  /** action.setMaterialColor: hex color to apply to the owner's material at runtime. */
  materialColor?: string;
  /** action.setMaterialColor: which color channel to write (base color vs emissive). Defaults to base. */
  materialColorTarget?: 'base' | 'emissive';
  /** action.set/getMaterialProperty: which numeric material property to read/write. */
  materialProperty?: 'metalness' | 'roughness' | 'emissiveIntensity';
  /** action.playSound: id of the audio asset to play. */
  assetId?: string;
  /** action.spawnObject: kind of object to spawn at runtime. */
  spawnKind?: SceneObjectKind;
  /** action.print: message to log to the runtime console. */
  message?: string;
  /** animator.setFloat/setBool/setTrigger/getParam/getState: name of the animator parameter. */
  paramName?: string;
  /** animator.* / action.destroyObject / action.setRagdoll: target object. Empty = the owning object (self). */
  targetObjectId?: string;
  /** event.collisionEnter/event.triggerEnter: optional filter for the other object that caused the event. */
  otherObjectId?: string;
  /** ui.show/hide/setText: id of the UI document to drive. */
  documentId?: string;
  /** ui.setText: id of the element within the document whose text to override. */
  elementId?: string;
  /** variable.getObject/setObject: key on the owning object's instance variables. */
  objectKey?: string;
  /** action.spawnProjectile: muzzle speed (units/sec) and hit damage. */
  projectileSpeed?: number;
  projectileDamage?: number;
  /** action.spawnProjectile setup: appearance + flight of the spawned projectile. */
  projectileSize?: number;
  projectileColor?: string;
  projectileLife?: number;
  projectileGravity?: number;
  /** action.spawnProjectile: id of a scene object to CLONE as the projectile (mesh/model/scale/color). */
  projectileTemplateId?: string;
  /** action.spawnProjectile: muzzle spawn offset in CAMERA space [right, up, forward] (first-person) —
   *  e.g. [0.28, -0.26, 0.6] = down-right of the eye where a held gun's barrel sits. The shot still
   *  converges on the crosshair so it hits where you aim. */
  projectileMuzzle?: Vector3Tuple;
  /** action.spawnProjectile: when true, log each spawn + hit to the runtime console. */
  projectileDebug?: boolean;
  /** action.setVisible: whether the target object is shown (false hides it during Play). */
  visible?: boolean;
  /** action.spawnAttached: weapon model asset to spawn + which bone/socket on the owner to attach it to,
   *  and the local grip offset. Replaces any weapon already attached to that socket. */
  attachBoneName?: string;
  attachSocketName?: string;
  attachOffsetPosition?: Vector3Tuple;
  attachOffsetRotation?: Vector3Tuple;
  attachOffsetScale?: Vector3Tuple;
  /** action.playAnimation: id of the Animation asset to play as a one-shot montage on the target's animator. */
  animationId?: string;
  /** action.playAnimation: playback speed multiplier for the montage (default 1). */
  animationSpeed?: number;
  /** action.setMovementMode: how the target character moves until changed — 'walking' (normal gravity),
   *  'swimming' (buoyant float; jump=up, crouch=down), 'climbing' (XZ locked, fwd/back = up/down), or
   *  'flying' (no gravity, free 3D; jump=up, crouch=down). Drives the swimming/climbing animator sources. */
  movementMode?: 'walking' | 'swimming' | 'climbing' | 'flying';
  hasInput?: boolean;
  hasOutput?: boolean;
}

export type NodeForgeNode = Node<NodeForgeNodeData, 'nodeforge'>;

export interface TransformComponent {
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: Vector3Tuple;
}

export interface MeshRendererComponent {
  enabled: boolean;
  mesh: Exclude<SceneObjectKind, 'empty' | 'light' | 'camera'>;
  color: string;
  metalness: number;
  roughness: number;
  /** Surface opacity 0–1 (1 = fully opaque, the default). Below 1 renders the mesh translucent — used for
   *  water/glass volumes. Applies to built-in meshes; models honor it when `overrideMaterial` is on. */
  opacity?: number;
  /** When set, render this imported glTF/GLB model asset instead of the built-in `mesh`. */
  modelAssetId?: string;
  /** Image asset used as the base-color (albedo) map — applies to built-in meshes and models. */
  textureAssetId?: string;
  /** For model assets: when true, the color/metalness/roughness below override the model's baked materials. */
  overrideMaterial?: boolean;
  /** When set, a reusable MaterialDefinition supplies this object's surface (overrides the inline props above and a model's baked materials). */
  materialId?: string;
  /** Per-object tweaks applied on top of the assigned material — written by runtime "Set Material" nodes, never mutating the shared definition. */
  materialOverrides?: MaterialOverrides;
}

/** Per-object overrides layered over an assigned MaterialDefinition (Unreal "dynamic material instance" style). */
export interface MaterialOverrides {
  color?: string;
  metalness?: number;
  roughness?: number;
  emissiveColor?: string;
  emissiveIntensity?: number;
}

/** A reusable material asset authored once and assigned to many objects. */
export interface MaterialDefinition {
  id: string;
  name: string;
  description: string;
  color: string;
  metalness: number;
  roughness: number;
  emissiveColor: string;
  emissiveIntensity: number;
  /** Base-color (albedo) map — an "image"-type asset id. */
  textureAssetId?: string;
  /** Normal map — an "image"-type asset id. */
  normalMapAssetId?: string;
  /** Optional node graph (in `graphs`) whose Material Output pins override the flat fields above. */
  graphId?: string;
  /** Containing folder id, or undefined for the project root. */
  folderId?: string;
  createdAt: number;
}

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
  | 'moveX'
  | 'moveY'
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
  /** How fast (radians/sec) the mesh turns to face its movement direction. */
  turnSpeed: number;
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

export interface PhysicsComponent {
  enabled: boolean;
  bodyType: RigidBodyType;
  collider: ColliderType;
  /** When true, the collider is a sensor/trigger: it fires trigger events but does not block or push. */
  isTrigger: boolean;
  /** Collision layer index, 0-15. */
  collisionLayer: number;
  /** Bit mask of layers this collider interacts with. */
  collisionMask: number;
  mass: number;
  gravityScale: number;
  friction: number;
  linearDamping: number;
  angularDamping: number;
}

export interface ScriptGraphComponent {
  blueprintId: string;
  graphId: string;
  enabled: boolean;
}

/**
 * Attaches this object to a bone "socket" of another object's animated skeleton (Unreal-style).
 * The object's own `transform` becomes the local offset from the bone, so it follows the bone as
 * the character animates — e.g. a sword in the right-hand bone. Target must render a skinned model.
 */
export interface AttachmentComponent {
  /** Object id of the skinned character to attach to. */
  targetObjectId: string;
  /** Bone name on the target's skeleton (the socket). */
  boneName: string;
  /** Optional named socket (on the target's Skeleton asset) — its offset is applied before this object's. */
  socketName?: string;
  /** Explicit local attach offset from the bone/socket — used to seat the weapon in the hand. When set it
   *  OVERRIDES the object's own transform as the offset, so a runtime-spawned weapon carries its grip
   *  alignment with it. Rotation is radians (XYZ). */
  offsetPosition?: Vector3Tuple;
  offsetRotation?: Vector3Tuple;
  offsetScale?: Vector3Tuple;
}

/** Configurable light on a `kind: 'light'` object. Defaults (no component) render as a directional light. */
export interface LightComponent {
  type: 'directional' | 'point' | 'spot';
  color: string;
  intensity: number;
  /** point/spot falloff distance in world units (0 = no falloff limit). */
  distance: number;
  /** spot cone half-angle in radians (ignored for point/directional). */
  angle: number;
  castShadow: boolean;
}

/**
 * Project-wide rendering / post-processing settings (bloom, vignette). Serialized in the manifest and
 * editable in the editor; the AI can tune them too. Read by the GameView + editor viewport post-FX pass.
 */
export interface RenderSettings {
  bloomEnabled: boolean;
  /** Bloom strength (0–3+). */
  bloomIntensity: number;
  /** Luminance threshold above which pixels bloom (0–1). Lower = more glows. */
  bloomThreshold: number;
  /** Bloom smoothing/spread (0–1). */
  bloomRadius: number;
  vignetteEnabled: boolean;
}

/** A reusable named attach point on a skeleton (Unreal socket): a bone + a local offset. */
export interface SkeletonSocket {
  id: string;
  name: string;
  boneName: string;
  position: Vector3Tuple;
  rotation: Vector3Tuple;
}

/** Anchors a world-space UI document above/around an object (Unreal widget-component style). */
export interface UIComponent {
  /** Id of the `surface: 'world'` UI document to render at this object. */
  documentId: string;
  /** Local offset from the object's origin, in world units. */
  offset: Vector3Tuple;
  /** Uniform scale of the rendered widget. */
  scale: number;
  /** When true the widget always faces the camera. */
  billboard: boolean;
}

/**
 * Renders this object as a first-person camera-space view model for its owner.
 * The object's transform is interpreted as local camera offset/rotation/scale, not world transform.
 */
export interface ViewModelComponent {
  ownerObjectId: string;
}

export interface SceneObject {
  id: string;
  name: string;
  kind: SceneObjectKind;
  parentId?: string;
  transform: TransformComponent;
  renderer?: MeshRendererComponent;
  physics?: PhysicsComponent;
  script?: ScriptGraphComponent;
  animator?: AnimatorComponent;
  character?: CharacterControllerComponent;
  attachment?: AttachmentComponent;
  viewModel?: ViewModelComponent;
  ui?: UIComponent;
  /** Per-instance data (e.g. this enemy's `health`), read/written by scripts and world UI bindings via `self.*`. */
  variables?: Record<string, GraphValue>;
  /** Present on runtime-spawned projectiles (action.spawnProjectile): flies forward, damages on hit, despawns. */
  projectile?: ProjectileComponent;
  /** Present on a runtime-spawned particle burst (e.g. a bullet impact): a short-lived THREE.Points effect. */
  effect?: EffectComponent;
  /** Lighting for a `kind: 'light'` object — configurable point / spot / directional light. */
  light?: LightComponent;
  /** Weapon/item inventory — drives the on-screen slot bar and click-to-equip (spawn attached + montage). */
  inventory?: InventoryComponent;
  /** Set on the ROOT of an object stamped from a prefab — the source prefab's id. Lets the editor
   * find all instances of a prefab. Instances are independent copies; this is just provenance. */
  prefabSourceId?: string;
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
  /** When true, the runtime logs this projectile's spawn + hits to the runtime console. */
  debug?: boolean;
}

/** A runtime-spawned, self-despawning particle burst (bullet impacts, muzzle flashes). THREE.Points + a flash light. */
export interface EffectComponent {
  /** 'impact' = omni spark burst; 'muzzle' = brief forward flash; 'splash' = water droplets; 'damage' = a
   *  floating combat damage number (uses `value`). */
  kind: 'impact' | 'muzzle' | 'splash' | 'damage';
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

/** A single scene within a project. Also the content of a `scenes/<id>.scene.json` file. */
export interface Scene {
  id: string;
  name: string;
  objects: SceneObject[];
  /** Audio asset id looped quietly as the ambient bed (wind/room tone) while this scene plays. */
  ambientSoundId?: string;
  /** Audio asset id looped as background music while this scene plays. */
  musicSoundId?: string;
}

/**
 * The id of the transient scene used while editing a prefab. Opening a prefab swaps the active
 * scene to this one (populated with a clone of the prefab's objects) so the whole editor — viewport,
 * hierarchy, inspector, gizmos — can edit it like any scene. It is NEVER serialized or shown in the
 * scene switcher; see `editingPrefabId`/`closePrefabEditor` in the store.
 */
export const PREFAB_EDIT_SCENE_ID = '__prefab_edit__';

/**
 * A reusable object template ("prefab"): a captured object subtree — a root plus all its
 * descendants — with every component (transform, renderer, physics, script, animator, children…)
 * baked in. Instantiating one stamps an independent copy into a scene; it is a one-time stamp, not
 * a live link, so later edits to the prefab don't touch already-placed instances. Lives in the
 * project browser alongside blueprints/materials and is editable in its own viewport.
 */
export interface Prefab {
  id: string;
  name: string;
  /** Containing folder id, or undefined for the project root. */
  folderId?: string;
  /** The captured tree. Ids are prefab-local; `instantiatePrefab` re-ids them on stamp. */
  objects: SceneObject[];
  /** Id (within `objects`) of the root object — the one with no parent inside the prefab. */
  rootId: string;
  /** Small PNG data-URL preview rendered from the prefab's contents, shown in the Project browser. */
  thumbnail?: string;
  createdAt: number;
}

/** A folder in the project browser. Folders can hold assets, blueprints and other folders. */
export interface ProjectFolder {
  id: string;
  name: string;
  parentId?: string;
}

export interface AssetItem {
  id: string;
  name: string;
  type: AssetType;
  size: number;
  /** Containing folder id, or undefined for the project root. */
  folderId?: string;
  /** Relative path inside the project folder, e.g. "assets/hero.glb". Serialized. */
  path?: string;
  /** Runtime-only URL for rendering (blob: on web, asset:// on desktop). NOT serialized. */
  url?: string;
  /** Embedded data URL of the asset's bytes. Present only in exported game bundles (self-contained). */
  data?: string;
  /** True when the asset was loaded from a project that had no bytes on disk (e.g. migrated). */
  unresolved?: boolean;
  createdAt: number;
}

export interface ProjectVariable {
  id: string;
  name: string;
  type: GraphValueType;
  defaultValue: GraphValue;
  /** Saved by Save Game nodes and restored by Load Game nodes. */
  persistent: boolean;
  createdAt: number;
}

export interface DataAssetColumn {
  id: string;
  name: string;
  type: GraphValueType;
}

export interface DataAssetRow {
  id: string;
  key: string;
  values: Record<string, GraphValue>;
}

export interface DataAsset {
  id: string;
  name: string;
  /** Containing folder id, or undefined for the project root. */
  folderId?: string;
  columns: DataAssetColumn[];
  rows: DataAssetRow[];
  createdAt: number;
}

export interface ScriptBlueprint {
  id: string;
  name: string;
  description: string;
  graphId: string;
  color: string;
  /** Containing folder id, or undefined for the project root. */
  folderId?: string;
  createdAt: number;
}

export interface ProjectGraph {
  id: string;
  name: string;
  nodes: NodeForgeNode[];
  edges: Edge[];
}

/** Kinds of UI element a document can contain. */
export type UIElementKind = 'panel' | 'text' | 'image' | 'bar' | 'button';

/** Whether a UI document draws on the player's screen (HUD) or anchored in the 3D world. */
export type UISurface = 'screen' | 'world';

/** CSS-like style, flat and serializable. The inspector edits these; `custom` is the raw escape hatch. */
export interface UIStyle {
  width?: string;
  height?: string;
  padding?: string;
  margin?: string;
  display?: 'flex' | 'block' | 'none';
  flexDirection?: 'row' | 'column';
  alignItems?: string;
  justifyContent?: string;
  gap?: string;
  background?: string;
  color?: string;
  opacity?: number;
  border?: string;
  borderRadius?: string;
  fontSize?: string;
  fontWeight?: string;
  fontFamily?: string;
  textAlign?: 'left' | 'center' | 'right';
  /** Free placement within the parent — set when an element is dragged on the design canvas. */
  position?: 'absolute' | 'relative';
  left?: string;
  top?: string;
  /** Arbitrary CSS properties the inspector doesn't surface (camelCase keys). */
  custom?: Record<string, string>;
}

/** One-click widget templates inserted by the UI editor / AI (addUIPreset). */
export type UIPresetKind = 'panel' | 'label' | 'healthBar' | 'button' | 'counter' | 'image';

/** Screen-space placement (Unity-style 9-slice anchor + pixel offset). */
export interface UIAnchor {
  h: 'left' | 'center' | 'right' | 'stretch';
  v: 'top' | 'middle' | 'bottom' | 'stretch';
  offsetX: number;
  offsetY: number;
}

/** Drives one element property from a runtime expression (e.g. `health / maxHealth`). */
export interface UIBinding {
  target: 'text' | 'fill' | 'visible' | 'color' | 'background' | 'width';
  expression: string;
}

export interface UIElement {
  id: string;
  kind: UIElementKind;
  name: string;
  /** Class for raw-CSS targeting. */
  className?: string;
  /** Static label for text/button elements. */
  text?: string;
  /** Image source asset id. */
  assetId?: string;
  style: UIStyle;
  /** Screen surface only — placement of this element's subtree. */
  anchor?: UIAnchor;
  bindings: UIBinding[];
  /** Button only — fires this custom runtime event on click (consumed by event.custom nodes). */
  onClickEvent?: string;
  children: UIElement[];
}

/** A reusable UI tree — a project asset like a material. Edited in the UI panel. */
export interface UIDocument {
  id: string;
  name: string;
  surface: UISurface;
  /** Always a 'panel' element. */
  root: UIElement;
  /** Raw CSS escape hatch, scoped to this document. */
  css?: string;
  /** Screen docs shown automatically when Play starts. */
  visibleOnStart: boolean;
  /** Blueprint holding this UI's behaviour nodes (run by an auto-created "UI Logic" object). */
  logicBlueprintId?: string;
  folderId?: string;
  createdAt: number;
}

/** Current project file format version. */
export const PROJECT_VERSION = '0.7.0';

/** Scene entry in the project manifest (project.json), pointing at its scene file. */
export interface SceneRef {
  id: string;
  name: string;
  file: string;
}

/**
 * The canonical, fully-loaded project bundle.
 * - Web export writes this as a single JSON file.
 * - Desktop writes it split into `project.json` (manifest) + `scenes/<id>.scene.json`.
 * Both read back into this shape.
 */
export interface NodeForgeProject {
  version: string;
  name: string;
  savedAt?: string;
  activeSceneId: string;
  scenes: Scene[];
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
  uiDocuments: UIDocument[];
  /** Reusable object templates. See `Prefab`. */
  prefabs: Prefab[];
  /** Project-wide render / post-processing settings (bloom, vignette). */
  renderSettings?: RenderSettings;
}

/** Contents of `project.json` — everything except scene objects (which live in scene files). */
export interface ProjectManifest {
  version: string;
  name: string;
  savedAt?: string;
  activeSceneId: string;
  scenes: SceneRef[];
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
  uiDocuments: UIDocument[];
  /** Reusable object templates. See `Prefab`. */
  prefabs: Prefab[];
  /** Project-wide render / post-processing settings (bloom, vignette). */
  renderSettings?: RenderSettings;
}

/** The legacy single-scene format (v0.1.0) — migrated on load. */
export interface LegacyNodeForgeProject {
  version: string;
  savedAt?: string;
  scene: { objects: SceneObject[] };
  assets: AssetItem[];
  blueprints: ScriptBlueprint[];
  graphs: ProjectGraph[];
}
