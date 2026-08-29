import type { Node } from '@xyflow/react';
import type { ColliderType, CompareOperator, GraphValueType, RigidBodyType, SceneObjectKind, Vector3Tuple } from './common';
import type { PhysicsMaterialPresetId } from './physics';
import type { QualityLevel } from './environment';

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
  | 'event.collisionStay'
  | 'event.triggerEnter'
  | 'event.triggerExit'
  | 'event.triggerStay'
  | 'event.interact'
  | 'event.receiveDamage'
  | 'event.land'
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
  | 'math.mapRange'
  | 'math.floor'
  | 'math.vectorLength'
  | 'math.dot'
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
  | 'action.applyForceAtPoint'
  | 'action.applyTorque'
  | 'action.setPhysics'
  | 'action.setVelocity'
  | 'query.velocity'
  | 'query.getSpeed'
  | 'action.setAngularVelocity'
  | 'query.angularVelocity'
  | 'action.setGravity'
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
  | 'action.timelineControl'
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
  | 'query.overlapSphere'
  | 'query.sphereCast'
  | 'action.setJointMotor'
  | 'query.cableTension'
  | 'action.cutCable'
  | 'action.setCableLength'
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
  | 'save.has'
  | 'action.print'
  | 'ui.show'
  | 'ui.hide'
  | 'ui.toggle'
  | 'ui.setText'
  | 'ui.setVisible'
  | 'variable.getObject'
  | 'variable.setObject'
  | 'action.burstParticles'
  | 'action.setParticlesEmitting'
  | 'action.spawnParticleSystem'
  | 'action.loadScene'
  | 'action.cameraShake'
  | 'action.screenFlash'
  | 'action.spawnDecal'
  | 'action.explode'
  | 'action.moveTo'
  | 'action.fractureObject'
  | 'action.applyDamage'
  | 'action.enterVehicle'
  | 'action.exitVehicle'
  | 'action.setQuality'
  | 'action.setTimeScale'
  | 'action.setEnvironment'
  | 'action.setTimeOfDay'
  | 'query.getTimeOfDay'
  | 'action.startReplay'
  | 'action.screenFade';

/** Interpolation used by one segment of a gameplay Timeline curve. */
export type TimelineCurveInterpolation = 'hold' | 'linear' | 'cubic';

/**
 * One editable key on a Timeline's normalized 0..1 value curve.
 * Tangents are slopes in value-per-normalized-time and are used by cubic Hermite segments.
 */
export interface TimelineCurveKey {
  id: string;
  time: number;
  value: number;
  interpolation: TimelineCurveInterpolation;
  inTangent?: number;
  outTangent?: number;
}

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
  /** action.applyImpulse / applyForceAtPoint: whether axis/vector values are interpreted in world axes or the target actor's local axes. */
  space?: 'world' | 'local';
  amount?: number;
  /** action.applyForceAtPoint: the LOCAL point on the target where the impulse is applied, relative to the body origin. */
  localPoint?: Vector3Tuple;
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
  /** action.tweenProperty / Timeline: editable normalized value curve. Missing = legacy easing. */
  tweenCurve?: TimelineCurveKey[];
  /** Timeline transform coordinates. Local is the authored parent space; world is converted through parents. */
  tweenSpace?: 'local' | 'world';
  /** Absolute targets a transform value; relative offsets the transform captured when playback starts. */
  tweenValueMode?: 'absolute' | 'relative';
  /** Repeat instead of firing Finished at the end. */
  tweenLoop?: boolean;
  /** When looping, reverse at each end rather than wrapping back to the start. */
  tweenPingPong?: boolean;
  /** Timeline: stable graph-scoped identity used by Timeline Control nodes and FeatherScript. */
  timelineId?: string;
  /** Timeline: editable display name; identity remains timelineId when this changes. */
  timelineName?: string;
  /** action.timelineControl: stable identity of the Timeline definition to command. */
  timelineRefId?: string;
  /** action.timelineControl: playback operation applied to the referenced Timeline instance. */
  timelineCommand?: 'play' | 'restart' | 'reverse' | 'stop';
  /** action.playSound: id of the audio asset to play. */
  assetId?: string;
  /** action.playSound: loudness 0..1 (overridable via Volume value input). */
  soundVolume?: number;
  /** action.playSound: playback rate (1 = normal; overridable via Pitch value input). */
  soundPitch?: number;
  /** action.playSound: randomize pitch each play by ± this fraction (0 = none, 0.15 = slight variation). */
  pitchJitter?: number;
  /** action.screenFade: target overlay opacity 0..1 (1 = fully covered). */
  fadeTo?: number;
  /** action.screenFade: starting opacity; undefined = current fade opacity. */
  fadeFrom?: number;
  /** action.screenFade: overlay tint (hex). */
  fadeColor?: string;
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
  /** ui.show/hide/toggle/setText/setVisible: id of the UI document to drive. */
  documentId?: string;
  /** ui.setText/setVisible: id of the element within the document to override. */
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
  /** action.screenFlash: peak opacity (0..1) of a full-screen color pop that fades in ~0.3s — muzzle/
   *  explosion bloom, hit blink, ability flash. Explosions already add a flash automatically. */
  flashAmount?: number;
  /** action.screenFlash: the flash tint (hex). Default white; use a hot orange for blasts, red for damage. */
  flashColor?: string;
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
    dayCycleEnabled: boolean;
    dayCycleDuration: number;
    dayCycleTime: number;
  }>;
  /** action.setTimeOfDay: normalized time of day in [0, 1). */
  timeOfDay?: number;
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
  /** action.spawnDecal: stamps a bullet-hole/blood/scorch mark on a surface. Wire Location + Normal (e.g.
   *  from a Raycast/Sphere Cast hit) or it uses the owner's position + up. size = half-width in world units;
   *  life = seconds before it fades (0 = permanent, recycled by the pool); color = optional hex tint. */
  decalKind?: 'bullet' | 'blood' | 'scorch';
  decalSize?: number;
  decalLife?: number;
  decalColor?: string;
  /** event.receiveDamage: optional starting HP for the owning object. 0/undefined = react-only (the object
   *  is notified by damage but never dies); > 0 = give it that HP pool so it loses health and dies at 0,
   *  without having to hand-add a `health` instance variable. */
  startingHealth?: number;
  hasInput?: boolean;
  hasOutput?: boolean;
}

export type NodeForgeNode = Node<NodeForgeNodeData, 'nodeforge'>;
