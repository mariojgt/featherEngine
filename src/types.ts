import type { Edge, Node } from '@xyflow/react';

export type Vector3Tuple = [number, number, number];

/** A one-shot sound queued during a runtime tick. `position` (world space) makes it spatial; omit for 2D
 *  (UI/menu) sounds. Drained + cleared each frame by the audio runtime. */
export type RuntimeSoundEvent = { assetId: string; position?: Vector3Tuple; volume?: number };

export type SceneObjectKind = 'empty' | 'cube' | 'sphere' | 'capsule' | 'plane' | 'terrain' | 'light' | 'camera';

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
  | 'event.collisionExit'
  | 'event.triggerEnter'
  | 'event.triggerExit'
  | 'event.interact'
  | 'event.receiveDamage'
  | 'event.timer'
  | 'logic.branch'
  | 'logic.compare'
  | 'logic.and'
  | 'logic.or'
  | 'logic.cast'
  | 'logic.forLoop'
  | 'logic.forEachActor'
  | 'logic.not'
  | 'logic.doOnce'
  | 'logic.delay'
  | 'event.functionEntry'
  | 'logic.callFunction'
  | 'logic.functionReturn'
  | 'logic.switch'
  | 'logic.sequence'
  | 'logic.flipFlop'
  | 'logic.select'
  | 'comment.note'
  | 'math.abs'
  | 'math.min'
  | 'math.max'
  | 'math.round'
  | 'math.power'
  | 'math.sin'
  | 'math.cos'
  | 'string.append'
  | 'math.add'
  | 'math.subtract'
  | 'math.multiply'
  | 'math.divide'
  | 'math.modulo'
  | 'math.clamp'
  | 'math.lerp'
  | 'math.distance'
  | 'math.vectorAdd'
  | 'math.vectorSubtract'
  | 'math.vectorScale'
  | 'math.normalize'
  | 'math.makeVector'
  | 'value.number'
  | 'value.random'
  | 'value.string'
  | 'value.boolean'
  | 'value.vector3'
  | 'variable.get'
  | 'variable.set'
  | 'data.tableGet'
  | 'action.translate'
  | 'action.rotate'
  | 'action.applyForce'
  | 'action.applyImpulse'
  | 'action.applyTorque'
  | 'action.setPhysics'
  | 'action.setVelocity'
  | 'query.velocity'
  | 'action.fireEvent'
  | 'action.spawnObject'
  | 'action.spawnPrefab'
  | 'action.destroyObject'
  | 'action.playSound'
  | 'action.setMaterialColor'
  | 'action.setMaterialProperty'
  | 'action.getMaterialColor'
  | 'action.getMaterialProperty'
  | 'action.getPosition'
  | 'action.getRotation'
  | 'action.getScale'
  | 'action.setPosition'
  | 'action.setRotation'
  | 'action.setScale'
  | 'action.tweenProperty'
  | 'action.lookAt'
  | 'animator.setFloat'
  | 'animator.setBool'
  | 'animator.setTrigger'
  | 'animator.getParam'
  | 'animator.getState'
  | 'input.move'
  | 'input.driveInput'
  | 'query.grounded'
  | 'query.vehicleSpeed'
  | 'query.findActorByBlueprint'
  | 'query.findActorByTag'
  | 'query.raycast'
  | 'action.move'
  | 'action.drive'
  | 'action.jump'
  | 'action.setCamera'
  | 'action.setRagdoll'
  | 'action.spawnProjectile'
  | 'action.setVisible'
  | 'action.setActive'
  | 'action.spawnAttached'
  | 'action.playAnimation'
  | 'action.playCinematic'
  | 'action.setMovementMode'
  | 'action.facePlayer'
  | 'ai.distanceToPlayer'
  | 'ai.directionToPlayer'
  | 'ai.playerLocation'
  | 'ai.hasLineOfSight'
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
  | 'variable.setObject'
  | 'action.burstParticles'
  | 'action.setParticlesEmitting'
  | 'action.spawnParticleSystem'
  | 'action.loadScene'
  | 'action.cameraShake'
  | 'action.explode'
  | 'action.moveTo'
  | 'action.fractureObject'
  | 'action.applyDamage'
  | 'action.enterVehicle'
  | 'action.exitVehicle'
  | 'action.setQuality'
  | 'action.setEnvironment';

export interface NodeForgeNodeData extends Record<string, unknown> {
  label: string;
  nodeKind: GraphNodeKind;
  category: GraphNodeCategory;
  description: string;
  tone: GraphNodeTone;
  eventName?: string;
  /** event.functionEntry / logic.callFunction: name binding a Call Function to its Function entry. */
  functionName?: string;
  keyCode?: string;
  axis?: 'x' | 'y' | 'z';
  /** action.applyImpulse: whether axis/vector values are interpreted in world axes or the target actor's local axes. */
  space?: 'world' | 'local';
  amount?: number;
  /** action.setPhysics: enables/disables/configures the target object's runtime physics body. */
  physicsEnabled?: boolean;
  physicsBodyType?: RigidBodyType;
  physicsCollider?: ColliderType;
  physicsMaterialPreset?: PhysicsMaterialPresetId;
  physicsIsTrigger?: boolean;
  physicsMass?: number;
  physicsGravityScale?: number;
  physicsFriction?: number;
  physicsRestitution?: number;
  physicsLinearDamping?: number;
  physicsAngularDamping?: number;
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
  /** action.tweenProperty: which transform property to animate over time. */
  tweenProperty?: 'position' | 'rotation' | 'scale';
  /** action.tweenProperty: easing curve shaping the animation (defaults to easeInOut). */
  easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
  /** action.playSound: id of the audio asset to play. */
  assetId?: string;
  /** action.spawnObject: kind of object to spawn at runtime. */
  spawnKind?: SceneObjectKind;
  /** action.spawnPrefab: id of the prefab (captured object tree) to instantiate at runtime. */
  prefabId?: string;
  /** action.print: message to log to the runtime console. comment.note: the comment text. */
  message?: string;
  /** comment.note: accent color of the comment frame (defaults to a neutral slate). */
  commentColor?: string;
  /** logic.switch: the case labels — the wired value is stringified and matched against these; each
   *  case gets its own exec output pin, with the default exec-out as the no-match path. */
  switchCases?: string[];
  /** math.round: which rounding to apply. */
  roundMode?: 'round' | 'floor' | 'ceil';
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
  /** logic.cast / query.findActorByBlueprint: the blueprint id the target must be running. */
  castBlueprintId?: string;
  /** query.findActorByBlueprint/findActorByTag: which match wins — the FIRST in scene order (cheap,
   *  deterministic, for the single boss/objective) or the NEAREST to the owner (the AI case). */
  findMode?: 'first' | 'nearest';
  /** action.applyDamage: how much `health` to subtract from the target (overridable via the Amount value input). */
  damageAmount?: number;
  /** action.spawnProjectile: muzzle speed (units/sec) and hit damage. */
  projectileSpeed?: number;
  projectileDamage?: number;
  /** action.spawnProjectile setup: appearance + flight of the spawned projectile. */
  projectileSize?: number;
  projectileColor?: string;
  projectileLife?: number;
  projectileGravity?: number;
  /** action.spawnProjectile: how hard a hit shoves a DYNAMIC prop along the shot (0 = no knockback). The
   *  applied impulse scales with the projectile's speed; this is the multiplier. Defaults to a light shove. */
  projectileKnockback?: number;
  /** action.spawnProjectile: when true, the projectile DETONATES on impact (and on lifetime expiry) — a fiery
   *  blast + area damage to every health object in projectileBlastRadius — instead of a plain hit. For
   *  grenades/rockets. projectileBlastDamage (default 60) + projectileBlastRadius (default 4.5) tune the blast;
   *  projectileBlastSound is an audio asset id played on detonation. Pair with projectileGravity for an arc. */
  projectileExplosive?: boolean;
  projectileBlastRadius?: number;
  projectileBlastDamage?: number;
  projectileBlastSound?: string;
  /** action.spawnProjectile: id of a scene object to CLONE as the projectile (mesh/model/scale/color). */
  projectileTemplateId?: string;
  /** action.spawnProjectile: muzzle spawn offset in CAMERA space [right, up, forward] (first-person) —
   *  e.g. [0.28, -0.26, 0.6] = down-right of the eye where a held gun's barrel sits. The shot still
   *  converges on the crosshair so it hits where you aim. */
  projectileMuzzle?: Vector3Tuple;
  /** action.spawnProjectile: when true, log each spawn + hit to the runtime console. */
  projectileDebug?: boolean;
  /** action.spawnProjectile: random firing-cone half-angle in degrees (0 = pin-accurate). Each shot's
   *  direction is jittered within this cone — bloom/recoil inaccuracy for automatic fire. */
  projectileSpread?: number;
  /** action.cameraShake: trauma to add (0..1). The runtime decays it; the follow camera turns it into a
   *  positional + rotational jitter. The player firing/being hurt and explosions also add trauma. */
  shakeAmount?: number;
  /** action.setEnvironment: a partial patch over the active scene's environment. Any field present here
   *  overwrites the same field on the live scene (sky colors, fog, sun, environmentIntensity) — undefined
   *  fields are left alone. Use it to crossfade atmospheres on a trigger (day → toxic green → dawn). */
  envPatch?: Partial<{
    skyTopColor: string;
    skyHorizonColor: string;
    skyGroundColor: string;
    fogEnabled: boolean;
    fogColor: string;
    fogNear: number;
    fogFar: number;
    sunColor: string;
    sunIntensity: number;
    sunAzimuth: number;
    sunElevation: number;
    environmentIntensity: number;
    /** Global wind force [x,y,z] — drives cloth + wind-affected dynamic bodies. Change it live to gust/storm. */
    wind: Vector3Tuple;
    windTurbulence: number;
  }>;
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
  /** action.playCinematic: id of the Film Mode cinematic sequence to play. */
  cinematicId?: string;
  /** action.spawnParticleSystem: id of the reusable particle-system asset to spawn. */
  particleSystemId?: string;
  /** action.spawnParticleSystem: attach the spawned emitter to the Target (rides it) instead of spawning at its position. */
  particleAttach?: boolean;
  /** action.playAnimation: playback speed multiplier for the montage (default 1). */
  animationSpeed?: number;
  /** value.random: inclusive range for the random number (min/max can also be wired). `randomInteger`
   *  rounds to a whole number with `max` inclusive (great for dice / picking an index 0..n). */
  randomMin?: number;
  randomMax?: number;
  randomInteger?: boolean;
  /** logic.forLoop: how many times to fire the "Body" output (also wireable via the Count input).
   *  The loop index (0-based) is available on the node's value-out. Capped at 10000 for safety. */
  loopCount?: number;
  /** action.loadScene: id of the Scene to switch to during Play — project variables persist across the
   *  load (run state like score/floor), the leaving scene reverts to pristine, and physics rebuilds. */
  targetSceneId?: string;
  /** action.setMovementMode: how the target character moves until changed — 'walking' (normal gravity),
   *  'swimming' (buoyant float; jump=up, crouch=down), 'climbing' (XZ locked, fwd/back = up/down), or
   *  'flying' (no gravity, free 3D; jump=up, crouch=down). Drives the swimming/climbing animator sources. */
  movementMode?: 'walking' | 'swimming' | 'climbing' | 'flying';
  /** action.setQuality: scalability preset this node applies at runtime (Low/Medium/High/Epic). */
  qualityLevel?: QualityLevel;
  /** action.explode: blast radius (world units), outward physics force, and radial damage. */
  explodeRadius?: number;
  explodeForce?: number;
  explodeDamage?: number;
  /** event.receiveDamage: optional starting HP for the owning object. 0/undefined = react-only (the object
   *  is notified by damage but never dies); > 0 = give it that HP pool so it loses health and dies at 0,
   *  without having to hand-add a `health` instance variable. */
  startingHealth?: number;
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
  mesh: Exclude<SceneObjectKind, 'empty' | 'terrain' | 'light' | 'camera'>;
  color: string;
  metalness: number;
  roughness: number;
  /** Surface opacity 0–1 (1 = fully opaque, the default). Below 1 renders the mesh translucent — used for
   *  water/glass volumes. Applies to built-in meshes; models honor it when `overrideMaterial` is on. */
  opacity?: number;
  /** Hide this object's renderer while Play/runtime is running. Editor view still shows it for authoring. */
  hideInPlay?: boolean;
  /** When set, render this imported glTF/GLB model asset instead of the built-in `mesh`. */
  modelAssetId?: string;
  /** Image asset used as the base-color (albedo) map — applies to built-in meshes and models. */
  textureAssetId?: string;
  /** For model assets: when true, the color/metalness/roughness below override the model's baked materials. */
  overrideMaterial?: boolean;
  /** When set, a reusable MaterialDefinition supplies this object's surface (overrides the inline props above and a model's baked materials). */
  materialId?: string;
  /** Per-slot material overrides for an imported model, indexed by the model's material-slot order (the
   *  same order `inspectModel` reports). Each entry is a MaterialDefinition id, or undefined to keep that
   *  slot's baked material. Takes precedence over `materialId` (which acts as a whole-model fallback). */
  materialSlots?: (string | undefined)[];
  /** Per-object tweaks applied on top of the assigned material — written by runtime "Set Material" nodes, never mutating the shared definition. */
  materialOverrides?: MaterialOverrides;
  /** Runtime-only: a key into the raw-geometry cache for a spawned fracture shard — the renderer draws
   *  this raw mesh instead of a built-in primitive or model. Never serialized (shards are transient). */
  fragmentKey?: string;
}

export type TerrainFoliageMode = 'grass' | 'trees' | 'mixed';
export type TerrainGrassMeshStyle = 'blade' | 'cross' | 'tuft';
export type TerrainTreeMeshStyle = 'cone' | 'round';
/** Where a foliage instance's mesh comes from: engine primitive, a 2D image billboard, or a 3D model asset. */
export type TerrainFoliageSource = 'builtin' | 'image' | 'model';

export interface TerrainMaterialLayer {
  id: string;
  name: string;
  color: string;
  textureAssetId?: string;
  normalMapAssetId?: string;
}

export type TerrainSculptOperation = 'raise' | 'lower' | 'flatten' | 'smooth';
export type TerrainBrushMode = 'sculpt' | 'paint' | 'foliage';

export interface TerrainBrushSettings {
  enabled: boolean;
  objectId?: string;
  mode: TerrainBrushMode;
  operation: TerrainSculptOperation;
  radius: number;
  strength: number;
  targetLayerId?: string;
  flattenHeight: number;
  /** Foliage brush: paint density 0..1 written into the foliage mask (the brushed area's grass amount). */
  foliageDensity?: number;
  /** Foliage brush: erase painted foliage instead of adding it. */
  foliageErase?: boolean;
}

/** Procedural foliage scattered on terrain chunks. MVP intentionally uses built-in instanced shapes. */
export interface TerrainFoliageComponent {
  enabled: boolean;
  mode: TerrainFoliageMode;
  /** Relative density 0..1. Grass/shrub instances per chunk scale from this value. */
  density: number;
  /** Relative density 0..1 for sparse tree instances. */
  treeDensity: number;
  minScale: number;
  maxScale: number;
  /** Minimum terrain normal Y allowed for placement. Higher avoids steep slopes. */
  slopeLimit: number;
  grassMesh: TerrainGrassMeshStyle;
  treeMesh: TerrainTreeMeshStyle;
  /** Mesh source for grass: 'builtin' high-quality wind-animated blades, 'image' 2D billboard, or 'model'. */
  grassSource?: TerrainFoliageSource;
  /** Mesh source for trees: 'builtin', 'image' 2D billboard, or 'model'. */
  treeSource?: TerrainFoliageSource;
  /** Optional model assets override the built-in foliage mesh for previewable custom vegetation. */
  grassModelAssetId?: string;
  treeModelAssetId?: string;
  /** Image (texture) assets for the 'image' 2D-billboard source (alpha-cutout cross quads). */
  grassImageAssetId?: string;
  treeImageAssetId?: string;
  grassColor: string;
  trunkColor: string;
  treeColor: string;
  /** Multiplier on the global scene wind for foliage sway (0 = stiff/no sway, the blades just stand). */
  windStrength?: number;
  /**
   * When true, grass/trees scatter ONLY where painted (the terrain's foliageOverrides mask) instead of
   * uniformly by density — the Unreal-style hand-painted foliage workflow. The foliage paint brush flips
   * this on the first stroke; turn it off to go back to uniform `density` coverage everywhere.
   */
  usePaintMask?: boolean;
}

/**
 * A procedural, chunk-streamed terrain surface. Stored as compact settings rather than a huge
 * height array so projects/export bundles stay small and the same world can be rebuilt deterministically.
 */
export interface TerrainComponent {
  enabled: boolean;
  /** Total authored terrain width/depth in world units. */
  size: number;
  /** Width/depth of one streamed render/physics chunk. */
  chunkSize: number;
  /** Segments per chunk edge. Higher = more detail and more vertices/collider samples. */
  resolution: number;
  /** Render chunks around the camera/player in this many chunk rings. */
  streamRadius: number;
  /** Physics chunks around active characters/dynamic bodies in this many chunk rings. */
  physicsRadius: number;
  /** Deterministic seed for height/noise/foliage scatter. */
  seed: number;
  heightScale: number;
  frequency: number;
  octaves: number;
  persistence: number;
  lacunarity: number;
  /** World-space distance between persistent sculpt/paint samples. */
  editSpacing: number;
  lowColor: string;
  midColor: string;
  highColor: string;
  /** Paintable terrain material layers. The first three backfill low/mid/high terrain colors. */
  materialLayers: TerrainMaterialLayer[];
  /** Sparse absolute height overrides keyed as "gridX:gridZ". */
  heightOverrides: Record<string, number>;
  /** Sparse material-layer paint overrides keyed as "gridX:gridZ", value = TerrainMaterialLayer.id. */
  paintOverrides: Record<string, string>;
  /** Sparse hand-painted foliage density mask keyed as "gridX:gridZ", value 0..1 (used when foliage.usePaintMask). */
  foliageOverrides?: Record<string, number>;
  foliage: TerrainFoliageComponent;
  /**
   * Bumped on every terrain edit (sculpt/paint/settings/foliage). The viewport's structural signature
   * watches this so live edits re-render immediately — without it, edits only showed after toggling the
   * terrain off/on (the signature couldn't see value-level changes inside the sparse override maps).
   */
  editVersion?: number;
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
  /** The model asset this material was extracted from on import (lets a placed model auto-link it). */
  sourceAssetId?: string;
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
  | 'mantling'
  | 'turning'
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
  /** GTA-style minimap/radar overlay (src/ui/MiniMap.tsx). When on, a circular radar draws the player at
   *  center, building footprints (objects with a `minimapShape` instance var) and colored blips (objects
   *  with a `minimapBlip` color var), plus health/armor arcs + a money readout from the player's vars. */
  minimapEnabled?: boolean;
  /** Rotate the radar with the player's heading (GTA-style). False = north-up. */
  minimapRotate?: boolean;
  /** World-units half-extent the radar shows around the player (default ~60). */
  minimapRange?: number;
  /** Unreal-style scalability preset (Low/Medium/High/Epic). Drives render resolution (DPR), shadow
   *  count + map size, post-FX MSAA, and bloom mip blur via the profiles in `src/three/quality.ts`.
   *  Changeable on the viewport, by the AI, and from the "Set Quality" Blueprint node. */
  quality?: QualityLevel;
  /** When on (default), sustained low framerate during Play auto-steps `quality` down (and back up as
   *  headroom returns) — never above the user's chosen preset; the editor restores it on Stop. */
  autoQuality?: boolean;
  /** When on (default), imported model textures are transcoded to GPU-compressed KTX2 on import —
   *  cuts VRAM ~6–8× and shrinks the exported game. Turn off to keep textures byte-for-byte
   *  (lossless) at the cost of more GPU memory. See `src/three/compressTextures.ts`. */
  compressTextures?: boolean;
  /** Optional project-wide color grade applied in the normal game/editor render, separate from cinematic looks. */
  colorGrade?: CinematicLook;
}

/** Game quality / scalability preset, Low → Epic (the project-wide rendering budget). */
export type QualityLevel = 'Low' | 'Medium' | 'High' | 'Epic';

export type SkyMode = 'color' | 'procedural' | 'image';

/**
 * Scene-level sky, fog and base lighting. This is the lightweight "world settings" layer:
 * procedural/color sky works without external files, while image mode can use an imported panorama.
 */
export interface SceneEnvironmentSettings {
  skyMode: SkyMode;
  /** Fallback / flat sky color. Also clears the renderer behind procedural/image sky domes. */
  backgroundColor: string;
  /** Procedural sky upper hemisphere. */
  skyTopColor: string;
  /** Procedural sky horizon band. */
  skyHorizonColor: string;
  /** Procedural sky lower hemisphere / ground bounce tint. */
  skyGroundColor: string;
  /** Equirectangular panorama image asset used when skyMode is "image". */
  skyTextureAssetId?: string;
  /**
   * Optional equirectangular image asset used as the image-based lighting (IBL) source — real
   * reflections + ambient light sampled from a panorama/HDRI. When set it replaces the built-in
   * studio Lightformer rig. Independent of `skyMode`, so the visible sky and the lighting source can
   * differ (e.g. procedural sky on screen, HDRI driving reflections). Cleared = studio default.
   */
  environmentMapAssetId?: string;
  /** Sky dome yaw in degrees. */
  skyRotation: number;
  /** Strength of the built-in ambient/environment light rig. */
  environmentIntensity: number;
  /** Directional sun color. */
  sunColor: string;
  /** Directional sun strength. */
  sunIntensity: number;
  /** Sun compass angle in degrees. */
  sunAzimuth: number;
  /** Sun height in degrees. */
  sunElevation: number;
  fogEnabled: boolean;
  fogColor: string;
  fogNear: number;
  fogFar: number;
  /**
   * Unreal-style raymarched volumetric fog (src/three/VolumetricFog.tsx), layered on top of (and
   * replacing) the flat linear `fog*` haze. A depth-buffer post pass that adds height-based density,
   * sun in-scattering (the bright "glow" toward the sun) and — on Epic — god-ray light shafts where
   * geometry occludes the sun. Disabled on the Low quality preset regardless of this flag.
   */
  volumetricFogEnabled?: boolean;
  /** Overall fog extinction/density (per world unit). Higher = thicker. */
  volumetricFogDensity?: number;
  /** Scattering/fog tint (ambient color of the medium). */
  volumetricFogColor?: string;
  /** World Y where density starts falling off. */
  volumetricFogHeight?: number;
  /** Exponential height falloff rate above `volumetricFogHeight` (0 = uniform with height). */
  volumetricFogFalloff?: number;
  /** Henyey–Greenstein anisotropy g (−1..1). Positive forward-scatters toward the sun (stronger glow). */
  volumetricScattering?: number;
  /** Strength of sun in-scattering / light shafts. */
  volumetricSunStrength?: number;
  /** Raymarch far clamp in world units (caps cost + keeps distant fog bounded). */
  volumetricMaxDistance?: number;
  /**
   * Global wind as a world-space force vector. Drives every cloth sheet (added on top of each cloth's
   * own wind) and pushes DYNAMIC physics bodies scaled by their `physics.windInfluence`. [0,0,0] = calm.
   */
  wind?: Vector3Tuple;
  /** Random gust turbulence layered on the global wind, 0–1. */
  windTurbulence?: number;
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
  /**
   * Diegetic mode (requires the document's `renderMode: 'webgl'`): instead of a floating widget,
   * render the UI onto a flat in-world surface (a monitor/terminal/screen) via render-to-texture,
   * lit and oriented by the host object's transform. `surfaceWidth`/`surfaceHeight` are the panel's
   * size in world units (default 1.6 × 0.9).
   */
  diegetic?: boolean;
  surfaceWidth?: number;
  surfaceHeight?: number;
}

/**
 * Renders this object as a first-person camera-space view model for its owner.
 * The object's transform is interpreted as local camera offset/rotation/scale, not world transform.
 */
export interface ViewModelComponent {
  ownerObjectId: string;
}

/**
 * A built-in arcade VEHICLE (car) controller — the driving peer of {@link CharacterControllerComponent}.
 * During Play the runtime's vehicle pass reads WASD (W throttle / S brake+reverse / A,D steer, Space
 * handbrake), integrates a signed forward speed, steers the yaw (scaled by speed), and drives the body's
 * horizontal motion; VERTICAL motion is left to the Rapier dynamic body so the car rides terrain, climbs
 * ramps and bumps props for free. The handling model keeps forward speed, lateral slip, load transfer,
 * traction control and optional aero downforce separate so cars slide/recover believably without needing a
 * full soft-body vehicle solver. Suspension "feel" is visual: the chassis squats/dives (bodyPitch) and
 * leans into turns (bodyRoll), and the wheel child objects spin (∝ speed) + the front pair steers. A
 * follow camera (shared with the character follow camera) trails the car with mouse orbit.
 */
/** One explicit wheel reference on a vehicle (Unreal-style wheel setup): the wheel object plus its ROLE,
 *  so the physics never has to infer front/rear/left/right from array position. */
export interface VehicleWheelSetup {
  /** The spinning wheel mesh object (a child of the car, or of a steering-anchor empty under the car). */
  objectId: string;
  /** Which end of the car — drives the drivetrain split (fwd/rwd), brake bias, and anti-roll pairing. */
  axle: 'front' | 'rear';
  /** Which side — drives auto-fit placement and anti-roll left↔right pairing. */
  side: 'left' | 'right';
  /** Whether this wheel turns with steering input. Defaults to true on the front axle. */
  steered?: boolean;
}

export interface VehicleComponent {
  enabled: boolean;
  /** Which simulation drives the car. `'arcade'` (default/absent) = the hand-rolled tire model below.
   *  `'raycast'` = a real Rapier `DynamicRayCastVehicleController` (per-wheel ray-cast suspension, weight
   *  transfer, tire friction, genuine rollovers) — see the "--- Raycast sim ---" fields. */
  physicsModel?: 'arcade' | 'raycast';
  // --- Drivetrain ---
  /** Top forward speed (units/sec). */
  maxSpeed: number;
  /** Top reverse speed (units/sec). */
  maxReverseSpeed: number;
  /** Throttle acceleration (units/sec²). */
  acceleration: number;
  /** Brake deceleration (units/sec²) when reversing input fights forward motion. */
  braking: number;
  /** Coasting deceleration (units/sec²) when no throttle/brake is held. */
  drag: number;
  // --- Steering ---
  /** Max visual front-wheel steer angle (radians). */
  steerAngle: number;
  /** Yaw turn rate (radians/sec) at full lock and full speed. */
  turnRate: number;
  /** How fast the steering reads in/out (0..1 smoothing per frame). */
  steerReturnSpeed: number;
  /** Lateral grip 0..1 — drives how hard the chassis leans into a turn (visual). */
  gripFactor: number;
  /** Grip while the handbrake is held (lower = looser, for drift feel). */
  handbrakeGrip: number;
  /** How much accel/brake/cornering load temporarily reduces tire grip (0 = flat arcade, 1 = weighty). */
  weightTransfer: number;
  /** How strongly throttle is cut when the tires are already slipping (0 = off, 1 = strong assist). */
  tractionControl: number;
  /** Speed-squared grip/downward force for planted high-speed handling. 0 = none. */
  downforce: number;
  // --- Suspension / feel (visual) ---
  /** Wheel suspension travel (world units) — reserved for ride-height bob. */
  suspensionTravel: number;
  /** Suspension stiffness 0..1 — how quickly chassis lean/squat settles. */
  suspensionStiffness: number;
  /** Chassis lean into turns (radians per unit of lateral load). */
  bodyRoll: number;
  /** Chassis squat/dive under accel/brake (radians per unit of longitudinal load). */
  bodyPitch: number;
  // --- Crash / damage feel ---
  /** When true, hard impacts add damage, angular impulses, wheel damage, and let physics roll the car. */
  crashDamageEnabled?: boolean;
  /** Impact speed below this is treated as a normal bump. */
  crashDamageThreshold?: number;
  /** Impact speed that starts a rollover/tumble response. */
  crashRolloverThreshold?: number;
  /** Angular impulse multiplier applied on hard impacts. */
  crashRolloverStrength?: number;
  /** Runtime visual crush amount 0..1 driven by accumulated crash damage. */
  crashDeformation?: number;
  /** Accumulated damage at which individual wheels start hanging crooked. */
  crashWheelBreakThreshold?: number;
  /** Spawn small dynamic debris chunks on heavy impacts. */
  crashDebris?: boolean;
  /** Wheel radius (world units) — sets how fast wheels spin for a given speed. */
  wheelRadius: number;
  /** Distance from the car body's origin down to the wheel-contact (ground) plane. The kinematic body's
   *  Y is set to groundHeight + rideHeight so the wheels rest on the terrain. Usually -(body bbox min Y). */
  rideHeight: number;
  /** Authored local Y of the wheel centers — the suspension bobs each wheel around this rest height. */
  wheelRestY: number;
  // --- Wiring (child object ids) ---
  /** The 4 wheel child objects, conventionally [frontLeft, frontRight, rearLeft, rearRight]. */
  wheelObjectIds: string[];
  /** Which of the wheels steer (the front pair). */
  steeredWheelIds: string[];
  /** Optional world-space particle emitters enabled by tire slip / handbrake for dust or fading tire marks. */
  tireMarkIds: string[];
  /** Optional particle emitters (exhaust flames) switched ON while the "Nitro" var is active (boost VFX). */
  boostFlameIds?: string[];
  /** In-game GARAGE: ordered list of body model asset ids. A "CarBody" project var picks which one the chassis
   *  shows at runtime (the runtime swaps renderer.modelAssetId → the raycast chassis re-sizes to it). */
  garageBodyIds?: string[];
  /** Explicit wheel rig (PREFERRED, Unreal-style): each wheel object referenced WITH its role, so nothing
   *  depends on array order. When present this wins over the legacy positional convention
   *  (wheelObjectIds in [FL,FR,RL,RR] order + steeredWheelIds). */
  wheels?: VehicleWheelSetup[];
  /** Soft-body crash damage: when true, the body MESH plastically dents/crumples on hard impacts during Play
   *  (the runtime records dents from collision direction + force; the model renderer displaces the vertices). */
  deformable?: boolean;
  /** Headlight child objects (kind 'light') — informational; lit via the light component. */
  headlightIds: string[];
  /** Brake-light child objects — their emissive intensity is raised while braking/reversing. */
  brakeLightIds: string[];
  /** Brake DISC child objects — their emissive glows with accumulated brake HEAT (sustained hard braking
   *  from speed heats them orange; they cool back down when released). Raycast sim only. */
  brakeDiscIds?: string[];
  /** LOOSE cosmetic child parts (bumpers / spoiler / side skirts): on a hard enough impact, the part
   *  facing the hit TEARS OFF — it becomes a real dynamic prop that tumbles away with the car's momentum.
   *  R-respawn (repair) bolts everything back on. Raycast sim only. */
  loosePartIds?: string[];
  /** Onboard camera positions (car-local [side, up, forward]); the Play camera cycles chase → hood →
   *  cockpit on the C key. Defaults fit a typical sedan when absent. */
  hoodCameraOffset?: Vector3Tuple;
  cockpitCameraOffset?: Vector3Tuple;
  // --- Input bindings (KeyboardEvent.code) ---
  keyThrottle: string;
  keyReverse: string;
  keyLeft: string;
  keyRight: string;
  keyHandbrake: string;
  /** Sound the horn (one-shot, debounced). */
  keyHorn: string;
  // --- Camera (shared shape with the character follow camera) ---
  /** Use this car's follow camera in game view / export. */
  cameraFollow: boolean;
  /** Resting camera offset [side, up, back]; negative back sits behind a +Z-forward car. */
  cameraOffset: Vector3Tuple;
  cameraPitch: number;
  cameraMinPitch: number;
  cameraMaxPitch: number;
  /** Orbit the follow camera with the mouse. */
  mouseLook: boolean;
  mouseSensitivity: number;
  /** Audio asset id looped as the engine sound while driving (its playback rate rises with speed). */
  engineSoundId?: string;
  /** Audio asset id looped (volume rises with slip) while the tires skid — handbrake drift / hard cornering. */
  skidSoundId?: string;
  /** One-shot brake squeal fired when the car decelerates hard from speed. */
  brakeSoundId?: string;
  /** One-shot horn fired on the horn key. */
  hornSoundId?: string;
  /** One-shot impact fired when the car collides with something while moving. */
  collisionSoundId?: string;
  // --- Raycast sim (physicsModel === 'raycast' only) ---
  // These map ~1:1 onto Rapier's DynamicRayCastVehicleController. Ignored in arcade mode. All optional so
  // existing saved cars (no sim block) load unchanged; defaultVehicle() supplies tuned values.
  /** Max engine force (newtons) applied at full throttle, split across the driven wheels. */
  engineForce?: number;
  /** Max braking force (newtons) at full brake, split across all wheels (biased by brakeBias). */
  brakeForce?: number;
  /** Extra braking force (newtons) the handbrake adds to the rear wheels (for handbrake turns). */
  handbrakeForce?: number;
  /** Which wheels receive engine force: front / rear / all-wheel drive. */
  drivetrain?: 'fwd' | 'rwd' | 'awd';
  /** Brake distribution, 0..1: 0 = all rear, 0.5 = even, 1 = all front. */
  brakeBias?: number;
  /** Chassis mass (kg) — heavier = more planted, slower to change direction. */
  chassisMass?: number;
  /** Center-of-mass offset on local Y (world units). Negative drops it below the chassis origin → far less
   *  prone to rolling over (the single biggest stability lever for a sim car). */
  centerOfMassY?: number;
  /** Chassis linear damping (air/rolling drag). */
  linearDamping?: number;
  /** Chassis angular damping (settles spin/wobble). */
  angularDamping?: number;
  /** Tire longitudinal/forward friction coefficient — higher = more grip, less wheelspin. */
  wheelFrictionSlip?: number;
  /** Lateral grip stiffness — how hard tires resist sliding sideways (cornering bite). */
  sideFrictionStiffness?: number;
  /** Suspension rest length (world units) — natural extension of the spring with no load. */
  suspensionRestLength?: number;
  /** Suspension spring stiffness (real Rapier units; distinct from the arcade visual `suspensionStiffness`). */
  suspensionStiffnessSim?: number;
  /** Suspension damping while compressing. */
  suspensionCompression?: number;
  /** Suspension damping while relaxing/extending. */
  suspensionRelaxation?: number;
  /** Clamp on suspension force (newtons) so a hard landing can't fling the chassis. */
  maxSuspensionForce?: number;
  /** Max suspension travel (world units) before it bottoms out. */
  maxSuspensionTravelSim?: number;
  // --- Raycast sim: drivetrain simulation (engine + gearbox) ---
  /** 'auto' shifts itself on RPM thresholds; 'manual' shifts only on keyShiftUp/keyShiftDown. */
  transmission?: 'auto' | 'manual';
  /** Forward gear ratios, 1st → top (e.g. [3.1, 2.05, 1.55, 1.2, 0.97, 0.8]). Reverse reuses 1st. */
  gearRatios?: number[];
  /** Final-drive (differential) ratio multiplied into every gear. */
  finalDrive?: number;
  /** Engine idle RPM (the tachometer floor). */
  idleRpm?: number;
  /** Redline RPM — the rev limiter cuts engine force just past this. */
  maxRpm?: number;
  /** Auto gearbox: upshift when engine RPM exceeds this (under throttle). */
  shiftUpRpm?: number;
  /** Auto gearbox: downshift when engine RPM falls below this. */
  shiftDownRpm?: number;
  /** Seconds of torque cut while a shift completes (the "shift kick" feel). */
  shiftTime?: number;
  /** Manual transmission: shift up / shift down key codes (gamepad Y/LB hit these via the default aliases). */
  keyShiftUp?: string;
  keyShiftDown?: string;
  // --- Raycast sim: aero + anti-roll + assists + surfaces ---
  /** Quadratic air drag coefficient — shapes top speed (force = aeroDrag · speed², against travel). */
  aeroDrag?: number;
  /** Downforce coefficient (speed² downward push while grounded). Replaces the old hardcoded 1.1. */
  downforceSim?: number;
  /** Front/rear anti-roll bar stiffness (N per metre of left↔right suspension difference). Less body roll,
   *  flatter cornering; a stiffer REAR bar adds oversteer, stiffer FRONT adds understeer (real tuning lever). */
  antiRollFront?: number;
  antiRollRear?: number;
  /** ABS assist: while braking hard the brakes ease off enough to keep the front tires steering. */
  absEnabled?: boolean;
  /** Traction control assist: cuts engine power during wheelspin launches and power-oversteer slides. */
  tcsEnabled?: boolean;
  /** Per-wheel surface grip: each wheel reads the `surface` instance variable of whatever it's rolling on
   *  (tarmac/curb/dirt/grass/gravel/sand/mud/snow/ice) and scales its grip — going wide costs lap time. */
  surfaceGripEnabled?: boolean;
  // --- AI rival driver (works for both arcade and raycast cars) ---
  /** This car drives ITSELF around the scene's "Checkpoint <n>" gates (the same objects the lap system
   *  reads) — no blueprint needed. It steers toward the next gate, slows for corners, reverses out when
   *  stuck, and waits for the green light when a "Driving" var gates the race start. */
  aiDriver?: boolean;
  /** Rival pace, 0..1: corner speed, straight-line commitment and steering aggression (default 0.7). */
  aiSkill?: number;
  /** Rubber-banding, 0..1: rivals quietly slow when ahead of the player and push when behind, keeping the
   *  race close (default 0.5; 0 = honest pace). */
  aiRubberBand?: number;
}

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

export type CinematicActionType = 'camera' | 'transform' | 'visibility' | 'spawn' | 'animation' | 'sound' | 'event' | 'fade' | 'material' | 'timeDilation' | 'subsequence' | 'text';

/** On-screen placement for a `type: 'text'` overlay beat (title card / subtitle / lower-third / credit). */
export type CinematicTextStyle = 'subtitle' | 'title' | 'lowerThird' | 'credit';

/**
 * Interpolation curve applied to a beat's progress (and to camera shot-to-shot blends).
 * `smooth` (ease-in-out) is the cinematic default; `linear` is a constant-speed move;
 * `in`/`out` accelerate/decelerate at one end.
 */
export type CinematicEase = 'linear' | 'smooth' | 'in' | 'out';

/** Interpolation mode for keyframed camera/object/material tracks. */
export type CinematicInterpolation = 'smooth' | 'linear' | 'hold';

/**
 * One keyframe on a camera beat's animated track: the camera's framing at an absolute time
 * (seconds from the cinematic start). A camera beat with two or more keyframes smoothly flies
 * through all of them (Catmull-Rom spline through positions/look-ats, eased FOV). This is the
 * "keyframe the camera" workflow — scrub the playhead, frame the viewport, capture a keyframe.
 */
export interface CinematicCameraKeyframe {
  /** Absolute time in seconds from the cinematic start. */
  time: number;
  position: Vector3Tuple;
  lookAt: Vector3Tuple;
  fov: number;
  /** Depth-of-field focus distance in world units ahead of the camera (along the look direction).
   *  Splined across keyframes for rack-focus pulls. Requires `aperture > 0` to take visible effect. */
  focusDistance?: number;
  /** Depth-of-field blur strength (bokeh scale). 0 (or omitted) = no DoF / everything sharp. */
  aperture?: number;
}

/**
 * One keyframe on a transform beat's animated track: an object's full transform at an absolute
 * time. A transform beat with ≥2 keyframes smoothly drives the object through them (Catmull-Rom
 * spline). This is the Unreal-Sequencer-style "keyframe the object" workflow — scrub, pose, key.
 */
export interface CinematicTransformKeyframe {
  /** Absolute time in seconds from the cinematic start. */
  time: number;
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: Vector3Tuple;
}

/** One keyframe on a material/property track. Missing fields hold/interpolate from neighbouring keys. */
export interface CinematicMaterialKeyframe {
  /** Absolute time in seconds from the cinematic start. */
  time: number;
  color?: string;
  metalness?: number;
  roughness?: number;
  emissiveColor?: string;
  emissiveIntensity?: number;
}

export interface CinematicMarker {
  id: string;
  time: number;
  label: string;
  color?: string;
  /** Runtime evaluators can split work at this marker when deterministic sampling matters. */
  determinismFence?: boolean;
}

export interface CinematicAction {
  id: string;
  type: CinematicActionType;
  time: number;
  duration?: number;
  label?: string;
  /** Easing curve for this beat's from→to interpolation (camera/transform/fade). Defaults to `smooth`. */
  ease?: CinematicEase;
  /** Keyframe interpolation mode for animated tracks. Defaults to `smooth`. */
  interpolation?: CinematicInterpolation;
  /**
   * Camera beats only: seconds to glide from the previous camera shot's framing into this one.
   * `0` (or omitted) is a hard cut; any positive value produces a smooth dolly/blend between shots.
   */
  blend?: number;
  /**
   * Camera beats only: an animated camera track. With ≥2 keyframes the camera smoothly flies
   * through them over the cinematic timeline (overrides position/lookAt/fov on this beat).
   */
  keyframes?: CinematicCameraKeyframe[];
  /**
   * Transform beats only: an animated transform track for `objectId`. With ≥2 keyframes the object
   * smoothly flies through them over the timeline (overrides the from/to fields on this beat).
   */
  transformKeyframes?: CinematicTransformKeyframe[];
  /** Material/property keyframes for `type: 'material'` tracks. */
  materialKeyframes?: CinematicMaterialKeyframe[];
  objectId?: string;
  /** Subsequence id for `type: 'subsequence'` actions. */
  cinematicId?: string;
  prefabId?: string;
  spawnKind?: SceneObjectKind;
  name?: string;
  fromPosition?: Vector3Tuple;
  toPosition?: Vector3Tuple;
  fromRotation?: Vector3Tuple;
  toRotation?: Vector3Tuple;
  fromScale?: Vector3Tuple;
  toScale?: Vector3Tuple;
  position?: Vector3Tuple;
  rotation?: Vector3Tuple;
  scale?: Vector3Tuple;
  lookAt?: Vector3Tuple;
  fov?: number;
  visible?: boolean;
  animationId?: string;
  animationSpeed?: number;
  soundId?: string;
  eventName?: string;
  fadeFrom?: number;
  fadeTo?: number;
  fadeColor?: string;
  /** `type: 'fade'`: dip transition — ramp fadeFrom→fadeTo over the first half, then back over the second
   *  half (a "dip to colour and back" between two shots), instead of ramping once and holding. */
  fadeDip?: boolean;
  /** `type: 'fade'`: render the fade as a directional WIPE (a colour edge sweeping across the frame in
   *  this direction) instead of a uniform opacity. Pairs with fadeDip for a wipe-on/wipe-off transition. */
  fadeWipe?: 'left' | 'right' | 'up' | 'down';
  /** `type: 'material'`: start/end material overrides for color/metal/rough/glow tracks. */
  fromMaterial?: MaterialOverrides;
  toMaterial?: MaterialOverrides;
  /** `type: 'timeDilation'`: playback speed multiplier, or from/to for a speed ramp. */
  timeScale?: number;
  fromTimeScale?: number;
  toTimeScale?: number;
  /** Camera beats only: depth-of-field focus distance in world units ahead of the camera. Used when
   *  the beat has no keyframe track. Splines/blends with the next shot. Needs `aperture > 0` to show. */
  focusDistance?: number;
  /** Camera beats only: depth-of-field blur strength (bokeh scale). 0/omitted = sharp (no DoF). */
  aperture?: number;
  /** Camera beats only: when set, depth-of-field focus continuously tracks this object's distance from
   *  the camera each frame (auto rack-focus), overriding `focusDistance`. Needs `aperture > 0` to show. */
  focusObjectId?: string;
  /** Camera beats only (single-shot, no keyframe track): live-aim the camera at this object's position
   *  every frame, overriding `lookAt`/`rotation`. The classic "tracking shot" that follows a mover. */
  lookAtObjectId?: string;
  /** Camera beats only (single-shot, no keyframe track): ride this object — the camera sits at the
   *  followed object's position plus `followOffset` (world units) every frame, so it trails a mover.
   *  When set without an explicit `lookAt`/`lookAtObjectId`, the camera also looks at the followed object. */
  followObjectId?: string;
  /** Camera beats only: world-space offset from `followObjectId` for the follow rig (e.g. [0, 2, -6]
   *  to sit above and behind). Defaults to the beat's `position`, else [0, 0, 0]. */
  followOffset?: Vector3Tuple;
  /** Camera beats only: handheld/shake amount 0–1 layered on the final framing (deterministic noise of
   *  time, so exports are reproducible). 0/omitted = a locked-off tripod shot. */
  shake?: number;
  /** Camera beats only: handheld shake frequency (Hz-ish). Higher = jittery/nervous, lower = a slow
   *  drift/breathing camera. Defaults to ~7. */
  shakeFrequency?: number;
  /** `type: 'text'`: the on-screen copy (title card / subtitle / lower-third / credit). Fades in over the
   *  first/last ~0.4s of the beat's `duration` and holds in between. */
  text?: string;
  /** `type: 'text'`: on-screen placement/typography preset. Defaults to 'subtitle'. */
  textStyle?: CinematicTextStyle;
  /** `type: 'text'`: text color (hex). Defaults to white. */
  textColor?: string;
}

/** A film color-grade preset. `custom` = driven purely by the manual grade params below. */
export type CinematicGrade = 'none' | 'warm' | 'teal-orange' | 'noir' | 'cool' | 'sepia' | 'custom';

/**
 * The "film look" of a cinematic — applied while it plays (and while scrubbing its preview):
 * letterbox bars + film grain + vignette as a DOM layer, and a real **color grade** rendered as a
 * post-processing shader on the cinematic camera. The grade is a preset (which seeds the params
 * below) plus optional manual overrides — exposure / contrast / saturation / temperature / a custom
 * tint — scaled by `gradeIntensity`. This is what makes a starter cinematic read as a *film*.
 */
export interface CinematicLook {
  /** Letterbox target aspect ratio (e.g. 2.35 for scope, 1.85 for flat). 0/omitted = no bars. */
  letterbox?: number;
  /** Color grade preset (seeds the params below). `none`/omitted = ungraded; `custom` = params only. */
  grade?: CinematicGrade;
  /** Overall grade strength, 0–1 (mix between the original and graded image). Default 1. */
  gradeIntensity?: number;
  /** Exposure offset in stops, ~−1..1. 0 = unchanged. Overrides the preset when set. */
  exposure?: number;
  /** Contrast, ~−1..1. 0 = unchanged. Overrides the preset when set. */
  contrast?: number;
  /** Saturation, −1 (grayscale) .. 1 (boosted). 0 = unchanged. Overrides the preset when set. */
  saturation?: number;
  /** Color temperature, −1 (cool/blue) .. 1 (warm/orange). 0 = neutral. Overrides the preset when set. */
  temperature?: number;
  /** Custom tint color (hex) multiplied into the image by `tintAmount`. Overrides the preset when set. */
  tint?: string;
  /** Strength of the custom `tint`, 0–1. 0/omitted = no tint. */
  tintAmount?: number;
  /** Film-grain strength, 0–1. 0/omitted = clean. */
  grain?: number;
  /** Extra darkened-edge vignette, 0–1, on top of any project vignette. 0/omitted = none. */
  vignette?: number;
  /** Camera motion blur (shutter) strength, 0–1. Reprojects the depth buffer against the previous
   *  frame's camera to blur along screen-space camera motion — pans/dollies smear like real film.
   *  0/omitted = no blur. Applied as a post pass on the cinematic camera. */
  motionBlur?: number;
  /** Chromatic aberration, 0–1: RGB channel separation toward the frame edges (lens fringing / sci-fi
   *  look). 0/omitted = none. Post pass on the cinematic camera. */
  chromaticAberration?: number;
  /** Anamorphic bloom streak, 0–1: bright highlights smear into a horizontal lens flare streak (the
   *  signature neon-cinema look), tinted faintly blue. 0/omitted = none. Post pass. */
  anamorphic?: number;
  /** Light-leak / film-burn overlay, 0–1: warm drifting streaks of light bleeding across the frame
   *  (analog projector feel). 0/omitted = none. Rendered as a DOM overlay over the frame. */
  lightLeak?: number;
  /** Lens dirt, 0–1: procedural smudges/specks on the "lens" that light up where bright neon/highlights
   *  hit them (grime catching the bloom). 0/omitted = clean. Post pass on the cinematic camera. */
  lensDirt?: number;
}

export interface CinematicSequence {
  id: string;
  name: string;
  duration: number;
  /** Timeline display/evaluation frame rate for snapping and frame stepping. Defaults to 24. */
  frameRate?: number;
  /** Folder/path label in the Cinematics panel, e.g. "Intros/Boss". */
  folder?: string;
  /** Source sequence id when this is a duplicated take. */
  takeOf?: string;
  /** Human take number; duplicate-take creation increments it. */
  takeNumber?: number;
  autoplay?: boolean;
  skippable?: boolean;
  markers?: CinematicMarker[];
  /** The film look (letterbox / grade / grain / vignette) layered over the frame while this plays. */
  look?: CinematicLook;
  actions: CinematicAction[];
  createdAt: number;
}

export interface RuntimeCinematicCamera {
  position: Vector3Tuple;
  lookAt: Vector3Tuple;
  fov: number;
  /** Live depth-of-field focus distance (world units ahead of camera). Drives the DoF post effect. */
  focusDistance?: number;
  /** Live depth-of-field bokeh scale. 0/omitted = no DoF this frame. */
  aperture?: number;
}

export interface RuntimeCinematicFade {
  opacity: number;
  color: string;
  /** When set, render the fade as a directional wipe (colour edge sweeping in) rather than uniform opacity;
   *  `opacity` is then the wipe coverage (0 = uncovered, 1 = fully covered). */
  wipe?: 'left' | 'right' | 'up' | 'down';
}

/** A text overlay (title/subtitle/lower-third/credit) currently on screen, with its faded-in opacity. */
export interface RuntimeCinematicText {
  id: string;
  text: string;
  style: CinematicTextStyle;
  color: string;
  opacity: number;
}

export interface RuntimeCinematicState {
  sequenceId: string;
  time: number;
  firedActionIds: string[];
  spawnedObjectIds: string[];
}

/** A single scene within a project. Also the content of a `scenes/<id>.scene.json` file. */
export interface Scene {
  id: string;
  name: string;
  objects: SceneObject[];
  /** World sky/fog/base lighting for this scene. */
  environment?: SceneEnvironmentSettings;
  /** Audio asset id looped quietly as the ambient bed (wind/room tone) while this scene plays. */
  ambientSoundId?: string;
  /** Audio asset id looped as background music while this scene plays. */
  musicSoundId?: string;
  /** Timeline-driven scene control: camera cuts, transforms, temporary spawns, sounds, fades, and events. */
  cinematics?: CinematicSequence[];
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

/**
 * A typed variable DECLARED on a blueprint (Unreal-style "class variable"). Every object instance that runs
 * the blueprint gets its OWN copy, seeded from `defaultValue` into the object's per-instance `variables` (keyed
 * by `name`). This is the per-instance scope — distinct from global/shared ProjectVariables. Read/write at
 * runtime with the Get/Set Object Var nodes (objectKey = the variable name), optionally on another actor via a
 * target / Cast.
 */
export interface BlueprintVariable {
  id: string;
  name: string;
  type: GraphValueType;
  defaultValue: GraphValue;
}

export interface ScriptBlueprint {
  id: string;
  name: string;
  description: string;
  graphId: string;
  color: string;
  /** Containing folder id, or undefined for the project root. */
  folderId?: string;
  /** Typed per-instance variables this blueprint declares (each object running it gets its own copy). */
  variables?: BlueprintVariable[];
  createdAt: number;
}

export interface ProjectGraph {
  id: string;
  name: string;
  nodes: NodeForgeNode[];
  edges: Edge[];
}

/** Kinds of UI element a document can contain. */
export type UIElementKind = 'panel' | 'text' | 'image' | 'bar' | 'button' | 'scroll';

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
  /**
   * WebGL-backend visual effect (only honoured when the document's `renderMode` is `'webgl'`).
   * `'glow'` adds emissive bloom (pairs with the HUD bloom pass), `'holographic'` an animated
   * flicker/tint, `'scanline'` a CRT line overlay. Ignored by the DOM backend.
   */
  fx?: 'glow' | 'holographic' | 'scanline';
  children: UIElement[];
}

/** A reusable UI tree — a project asset like a material. Edited in the UI panel. */
export interface UIDocument {
  id: string;
  name: string;
  surface: UISurface;
  /**
   * Rendering backend. `'dom'` (default) draws HTML/CSS as a screen overlay or drei `<Html>`.
   * `'webgl'` renders the same element tree inside the 3D canvas via @react-three/uikit, so it
   * picks up post-processing (bloom/glitch), is depth-correct in world space, and can be mapped
   * onto in-world surfaces (diegetic UI). Bindings, text overrides and click events are identical.
   */
  renderMode?: 'dom' | 'webgl';
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
  /** Reusable particle-system assets (Unreal-style). Referenced by objects via `systemId`. */
  particleSystems: ParticleSystemDefinition[];
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
  /** Reusable particle-system assets (Unreal-style). Referenced by objects via `systemId`. */
  particleSystems: ParticleSystemDefinition[];
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
