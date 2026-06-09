// Headless Rapier physics runtime.
//
// Rendering in this engine is fully decoupled from simulation: meshes just read
// `object.transform` out of the store, and `tickRuntime` is the single place that
// advances the world each frame. So rather than mounting react-three/rapier's
// <Physics> component (which would fight the store for ownership of transforms),
// we run a real Rapier `World` *headlessly* inside the runtime tick: feed it the
// scene objects, step it, and copy the results back into the store. This gives us
// proper object-to-object collisions (stacking, blocking, pushing) and collision
// events without touching the Viewport / player rendering at all.

import RAPIER from '@dimforge/rapier3d-compat';
import type {
  Collider,
  DynamicRayCastVehicleController,
  ImpulseJoint,
  KinematicCharacterController,
  RigidBody,
  World,
} from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { SceneObject, Vector3Tuple } from '../types';
import { clearRagdolls } from './ragdollState';
import {
  capsuleParams,
  colliderKindFor,
  halfScale,
  sphereRadius,
} from './colliderShape';
import { getModelGeometry } from './meshGeometryCache';
import {
  buildTerrainChunkTrimesh,
  terrainChunkKeysAroundWorld,
  withTerrainDefaults,
} from '../terrain/terrain';
import { worldMatrixOf } from '../utils/transformHierarchy';

let ready = false;
let initPromise: Promise<void> | null = null;

/** Kick off (and await) the WASM init. Safe to call repeatedly. */
export function initRapier(): Promise<void> {
  if (ready) return Promise.resolve();
  if (!initPromise) initPromise = RAPIER.init().then(() => void (ready = true));
  return initPromise;
}

// Begin initializing immediately on import so the world is ready before the user
// ever clicks Play (the compat build inlines its WASM, so this is just CPU work).
void initRapier();

const EPSILON = 1e-5;
const DEFAULT_COLLISION_MASK = 0xffff;

const reuseEuler = new THREE.Euler();
const reuseQuat = new THREE.Quaternion();

function quatFromEuler(rotation: Vector3Tuple) {
  reuseEuler.set(rotation[0], rotation[1], rotation[2], 'XYZ');
  reuseQuat.setFromEuler(reuseEuler);
  return { x: reuseQuat.x, y: reuseQuat.y, z: reuseQuat.z, w: reuseQuat.w };
}

// --- Parent-aware world transforms ---------------------------------------------------------------
// Physics bodies live in WORLD space, but an object's stored `transform` is LOCAL (relative to its
// parent). For a root object local == world, so these only do real work for parented objects — e.g.
// a trigger volume nested INSIDE a solid sphere. Without this a child body would be spawned at its
// local coordinates (near the origin) instead of where its parent actually is, so it never overlaps
// anything ("triggers inside don't fire").
const wtPos = new THREE.Vector3();
const wtQuat = new THREE.Quaternion();
const wtScale = new THREE.Vector3();
const wtEuler = new THREE.Euler();
// Separate scratch for composing an INPUT world matrix (can't share the wt* output temps: we compose
// the input, then decompose the result back into wt*, so input and output must not alias).
const wlMat = new THREE.Matrix4();
const wlPos = new THREE.Vector3();
const wlQuat = new THREE.Quaternion();
const wlScale = new THREE.Vector3(1, 1, 1);
const wlEuler = new THREE.Euler();

type PosRot = { position: Vector3Tuple; rotation: Vector3Tuple };

/** World transform (position + Euler rotation) of `id`, composing the full parent chain. */
function worldPosRot(byId: Map<string, SceneObject>, id: string): PosRot {
  worldMatrixOf(byId, id).decompose(wtPos, wtQuat, wtScale);
  wtEuler.setFromQuaternion(wtQuat, 'XYZ');
  return { position: [wtPos.x, wtPos.y, wtPos.z], rotation: [wtEuler.x, wtEuler.y, wtEuler.z] };
}

/** Convert a world position/rotation into the LOCAL transform under `parentId`. */
function worldToLocalUnder(
  byId: Map<string, SceneObject>,
  parentId: string,
  position: Vector3Tuple,
  rotation: Vector3Tuple,
): PosRot {
  const world = wlMat.compose(
    wlPos.set(position[0], position[1], position[2]),
    wlQuat.setFromEuler(wlEuler.set(rotation[0], rotation[1], rotation[2], 'XYZ')),
    wlScale.set(1, 1, 1),
  );
  const local = worldMatrixOf(byId, parentId).invert().multiply(world);
  local.decompose(wtPos, wtQuat, wtScale);
  wtEuler.setFromQuaternion(wtQuat, 'XYZ');
  return { position: [wtPos.x, wtPos.y, wtPos.z], rotation: [wtEuler.x, wtEuler.y, wtEuler.z] };
}

function clampCollisionLayer(layer: number | undefined): number {
  return Math.min(Math.max(Math.trunc(layer ?? 0), 0), 15);
}

function collisionGroups(layer: number | undefined, mask: number | undefined): number {
  const membership = 1 << clampCollisionLayer(layer);
  return ((membership & 0xffff) << 16) | ((mask ?? DEFAULT_COLLISION_MASK) & DEFAULT_COLLISION_MASK);
}

/** Cached model vertices (local space) baked to the object's scale, for mesh/convex colliders. */
function scaledMeshVertices(object: SceneObject) {
  const geo = getModelGeometry(object.renderer?.modelAssetId);
  if (!geo) return null;
  const [sx, sy, sz] = halfScale(object);
  const out = new Float32Array(geo.vertices.length);
  for (let i = 0; i < geo.vertices.length; i += 3) {
    out[i] = geo.vertices[i] * sx;
    out[i + 1] = geo.vertices[i + 1] * sy;
    out[i + 2] = geo.vertices[i + 2] * sz;
  }
  return { vertices: out, indices: geo.indices };
}

function colliderDescFor(object: SceneObject) {
  const [sx, sy, sz] = halfScale(object);
  const kind = colliderKindFor(object);
  // Falls back to a box when the kind needs model geometry that hasn't loaded yet
  // (or a degenerate convex hull) — bodySignature tracks geometry so it rebuilds later.
  const boxDesc = () => RAPIER.ColliderDesc.cuboid(0.5 * sx, 0.5 * sy, 0.5 * sz);
  let desc;
  if (kind === 'plane') {
    // planeGeometry is a unit quad in local XY; give it a thin depth so it acts as a surface.
    desc = RAPIER.ColliderDesc.cuboid(0.5 * sx, 0.5 * sy, 0.02);
  } else if (kind === 'sphere') {
    desc = RAPIER.ColliderDesc.ball(sphereRadius(object));
  } else if (kind === 'capsule') {
    const { halfHeight, radius } = capsuleParams(object);
    desc = RAPIER.ColliderDesc.capsule(halfHeight, radius);
  } else if (kind === 'trimesh') {
    const mesh = scaledMeshVertices(object);
    desc = mesh ? RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices) : boxDesc();
  } else if (kind === 'convex') {
    const mesh = scaledMeshVertices(object);
    desc = (mesh && RAPIER.ColliderDesc.convexHull(mesh.vertices)) || boxDesc();
  } else {
    desc = boxDesc();
  }
  const physics = object.physics;
  desc.setFriction(physics?.friction ?? 0.5);
  desc.setRestitution(physics?.restitution ?? 0.05);
  desc.setMass(Math.max(physics?.mass ?? 1, 0.001));
  desc.setSensor(Boolean(physics?.isTrigger));
  const groups = collisionGroups(physics?.collisionLayer, physics?.collisionMask);
  desc.setCollisionGroups(groups);
  desc.setSolverGroups(groups);
  desc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
  // Generate contact/intersection events for EVERY body-type pairing. Rapier's default only reports pairs
  // that involve a DYNAMIC body, so a FIXED trigger (e.g. a collectible/checkpoint) would never fire against
  // the KINEMATIC player character — the cause of "walk onto the pickup, nothing happens". ALL fixes that.
  desc.setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);
  return desc;
}

/** A car running the real Rapier raycast-vehicle sim (vs the arcade tire model in editorStore). */
function isRaycastVehicle(object: SceneObject): boolean {
  return Boolean(object.vehicle?.enabled && object.vehicle.physicsModel === 'raycast');
}

function bodyDescFor(object: SceneObject) {
  const type = object.physics?.bodyType ?? 'dynamic';
  if (type === 'fixed') return RAPIER.RigidBodyDesc.fixed();
  if (type === 'kinematic') return RAPIER.RigidBodyDesc.kinematicPositionBased();
  return RAPIER.RigidBodyDesc.dynamic();
}

/** Anything that would require rebuilding the body/collider rather than just nudging it. */
function bodySignature(object: SceneObject): string {
  const p = object.physics;
  const [sx, sy, sz] = halfScale(object);
  const kind = colliderKindFor(object);
  // Mesh/convex colliders depend on loaded model geometry — fold the source model and
  // whether its geometry is available yet into the signature so the box-fallback collider
  // gets rebuilt into the real mesh the moment the model finishes loading.
  const meshToken =
    kind === 'trimesh' || kind === 'convex'
      ? `${object.renderer?.modelAssetId ?? ''}:${getModelGeometry(object.renderer?.modelAssetId) ? 'y' : 'n'}`
      : '';
  return [
    p?.bodyType,
    kind,
    meshToken,
    sx.toFixed(3),
    sy.toFixed(3),
    sz.toFixed(3),
    p?.friction,
    p?.restitution,
    p?.mass,
    p?.linearDamping,
    p?.angularDamping,
    p?.gravityScale,
    p?.isTrigger,
    p?.collisionLayer,
    p?.collisionMask,
  ].join('|');
}

interface BodyEntry {
  body: RigidBody;
  collider: Collider;
  signature: string;
}

interface TerrainEntry extends BodyEntry {
  terrainId: string;
}

export interface PhysicsFrameResult {
  /** Post-step world transforms for every physics body, keyed by object id. */
  transforms: Map<string, { position: Vector3Tuple; rotation: Vector3Tuple }>;
  /** Solid-contact pairs that started this step (drives event.collisionEnter). */
  collisions: PhysicsContactEvent[];
  /** Sensor/trigger pairs that started this step (drives event.triggerEnter). */
  triggers: PhysicsContactEvent[];
  /** Sensor/trigger pairs that ENDED this step (drives event.triggerExit — proximity prompts). */
  triggersExit: PhysicsContactEvent[];
  /** Solid-contact pairs that ENDED this step (drives event.collisionExit). */
  collisionsExit: PhysicsContactEvent[];
  /** Character-controller object ids that are standing on the ground this frame. */
  grounded: string[];
  /** Post-step linear velocity of each DYNAMIC body, keyed by object id (drives the Get Velocity node). */
  velocities: Map<string, Vector3Tuple>;
  /** Post-step state of each raycast-sim vehicle, keyed by chassis object id (drives the sim-car writeback). */
  vehicles: Map<string, VehicleFrameState>;
}

/** Per-frame driver input for one raycast-sim vehicle, supplied by the tick (keys or the Drive node). */
export interface VehicleInput {
  /** Throttle, -1 (full reverse) .. +1 (full throttle). */
  throttle: number;
  /** Steering, -1 (full left) .. +1 (full right). Scaled by the component's steerAngle. */
  steer: number;
  /** Handbrake held this frame (locks the rear wheels). */
  handbrake: boolean;
  /** Runtime multiplier on engine force (the in-game speed menu drives this). Default 1. */
  engineScale?: number;
}

/** Per-wheel + chassis readback for one raycast-sim vehicle after a physics step. */
export interface VehicleFrameState {
  /** Chassis world transform straight from the dynamic body. */
  chassis: { position: Vector3Tuple; rotation: Vector3Tuple };
  /** Signed forward speed (units/sec) — engine pitch / HUD. */
  speed: number;
  /** Sideways velocity component (units/sec) — how much the car is actually SLIDING (drift/skid detection). */
  lateralSpeed: number;
  /** Per wheel, IN THE SAME ORDER as the vehicle's `wheelObjectIds`. */
  wheels: VehicleWheelState[];
}

export interface VehicleWheelState {
  /** This wheel's object id (matches a `wheelObjectIds` entry). */
  objectId: string;
  /** Steering angle applied this frame (radians). */
  steer: number;
  /** Accumulated spin angle (radians) — for rolling the wheel mesh. */
  rotation: number;
  /** Current suspension length (world units) — drives visible per-wheel bob. */
  suspension: number;
  /** Suspension connection point local Y on the chassis — visual wheel local Y = connectionY − suspension. */
  connectionY: number;
  /** Whether the wheel's ray found ground this frame. */
  inContact: boolean;
  /** Lateral (side) impulse magnitude — proxy for tire slip → skid audio / marks. */
  sideImpulse: number;
}

export interface PhysicsContactEvent {
  objectId: string;
  otherObjectId: string;
}

/** A capsule sized to a (feet-origin) humanoid, scaled by the object. */
function characterCapsule(object: SceneObject) {
  const s = object.transform.scale;
  const radius = 0.3 * Math.max(Math.abs(s[0]), Math.abs(s[2]), 0.1);
  const halfHeight = 0.6 * Math.max(Math.abs(s[1]), 0.1);
  const centerY = halfHeight + radius; // origin at the feet → capsule centered above it
  return { radius, halfHeight, centerY };
}

interface CharacterEntry {
  body: RigidBody;
  collider: Collider;
  controller: KinematicCharacterController;
  signature: string;
}

interface JointEntry {
  joint: ImpulseJoint;
  /** Synthetic fixed body created for a world-anchored joint (else null). Freed with the joint. */
  anchorBody: RigidBody | null;
  /** The OTHER body this joint links to (empty for a world anchor) — so a body rebuild can drop it. */
  connectedObjectId: string;
  signature: string;
}

/** Everything that, if changed, requires tearing down and rebuilding the joint. */
function jointSignature(object: SceneObject, body1Present: boolean, body2Present: boolean): string {
  const j = object.joint;
  return [
    j?.type,
    j?.connectedObjectId ?? '',
    body1Present,
    body2Present,
    j?.localAnchor?.join(','),
    j?.connectedAnchor?.join(','),
    j?.axis?.join(','),
    j?.limitsEnabled,
    j?.limitMin,
    j?.limitMax,
    j?.motorTargetVelocity,
    j?.motorMaxForce,
    j?.stiffness,
    j?.damping,
    j?.restLength,
    j?.maxLength,
    j?.collideConnected,
  ].join('|');
}

interface VehicleEntry {
  body: RigidBody;
  collider: Collider;
  controller: DynamicRayCastVehicleController;
  /** Wheel object ids, in addWheel order (= the component's `wheelObjectIds` order). */
  wheelIds: string[];
  /** Each wheel's suspension connection point local Y (so the visual wheel = connectionY − suspensionLength). */
  connectionY: number[];
  /** Whether each wheel steers (resolved at build: the wheel — or its anchor parent — is in steeredWheelIds). */
  steered: boolean[];
  signature: string;
}

/** Everything that, if changed, requires rebuilding the chassis body + wheels. */
function vehicleSignature(object: SceneObject): string {
  const v = object.vehicle;
  const [sx, sy, sz] = halfScale(object);
  // Fold in the chassis model + whether its geometry has loaded, so the chassis box (sized from the model's
  // bounds) rebuilds the moment the GLB finishes loading instead of staying a unit-cube fallback.
  const modelToken = `${object.renderer?.modelAssetId ?? ''}:${getModelGeometry(object.renderer?.modelAssetId) ? 'y' : 'n'}`;
  return [
    v?.physicsModel,
    (v?.wheelObjectIds ?? []).join(','),
    (v?.steeredWheelIds ?? []).join(','),
    v?.wheelRadius,
    v?.chassisMass,
    v?.centerOfMassY,
    v?.suspensionRestLength,
    modelToken,
    sx.toFixed(3),
    sy.toFixed(3),
    sz.toFixed(3),
  ].join('|');
}

class PhysicsRuntime {
  private world: World;
  private events = new RAPIER.EventQueue(true);
  private entries = new Map<string, BodyEntry>();
  private handleToId = new Map<number, string>();
  private handleToTrigger = new Map<number, boolean>();
  private charEntries = new Map<string, CharacterEntry>();
  private terrainEntries = new Map<string, TerrainEntry>();
  private jointEntries = new Map<string, JointEntry>();
  private vehicleEntries = new Map<string, VehicleEntry>();
  /** All active objects this frame, keyed by id — lets body creation resolve parent-chain world transforms. */
  private frameById = new Map<string, SceneObject>();
  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
  }

  private createBody(object: SceneObject) {
    // Spawn at the object's WORLD transform so a parented body (e.g. a trigger nested inside another
    // object) lands where it actually is, not at its local-to-parent coordinates.
    const world = object.parentId ? worldPosRot(this.frameById, object.id) : object.transform;
    const p = world.position;
    const desc = bodyDescFor(object)
      .setTranslation(p[0], p[1], p[2])
      .setRotation(quatFromEuler(world.rotation))
      .setLinearDamping(object.physics?.linearDamping ?? 0)
      .setAngularDamping(object.physics?.angularDamping ?? 0.05);
    const body = this.world.createRigidBody(desc);
    // A trigger/sensor is a marker volume, not a falling object — never let gravity pull it out of place
    // (e.g. a trigger nested inside a sphere). It still follows a moving parent via the per-frame body loop.
    body.setGravityScale(object.physics?.isTrigger ? 0 : (object.physics?.gravityScale ?? 1), false);
    // Bullets are small and fast — without continuous collision detection they tunnel straight through a
    // thin wall in a single step and strike whatever is behind it. CCD makes a projectile sweep its motion
    // each step so it stops at the first surface it crosses (cover blocks the shot, as expected).
    if (object.projectile) body.enableCcd(true);
    const collider = this.world.createCollider(colliderDescFor(object), body);
    this.entries.set(object.id, { body, collider, signature: bodySignature(object) });
    this.handleToId.set(collider.handle, object.id);
    this.handleToTrigger.set(collider.handle, Boolean(object.physics?.isTrigger));
  }

  private removeBody(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    // Removing the body auto-detaches its impulse joints in Rapier; forget our stale joint entries first
    // (and free their world-anchor bodies) so syncJoints rebuilds them cleanly against the new body.
    this.dropJointsReferencing(id);
    this.handleToId.delete(entry.collider.handle);
    this.handleToTrigger.delete(entry.collider.handle);
    this.world.removeRigidBody(entry.body); // also removes attached colliders
    this.entries.delete(id);
  }

  private createTerrainChunk(object: SceneObject, chunkX: number, chunkZ: number, key: string, signature: string) {
    if (!object.terrain) return;
    const terrain = withTerrainDefaults(object.terrain);
    // TRIMESH collider built from the SAME local vertices as the visual chunk mesh, with the object's scale
    // baked in and the body placed at the object's world transform. This makes the collision surface match
    // the rendered terrain EXACTLY — including sculpted hills — instead of a separate heightfield that could
    // (and did) drift in shape/scale so dropped bodies fell through edited terrain.
    const mesh = buildTerrainChunkTrimesh(terrain, chunkX, chunkZ);
    const [sx, sy, sz] = object.transform.scale;
    const scaled = new Float32Array(mesh.vertices.length);
    for (let i = 0; i < mesh.vertices.length; i += 3) {
      scaled[i] = mesh.vertices[i] * sx;
      scaled[i + 1] = mesh.vertices[i + 1] * sy;
      scaled[i + 2] = mesh.vertices[i + 2] * sz;
    }
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(object.transform.position[0], object.transform.position[1], object.transform.position[2])
        .setRotation(quatFromEuler(object.transform.rotation)),
    );
    const groups = collisionGroups(object.physics?.collisionLayer, object.physics?.collisionMask);
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(scaled, mesh.indices)
        .setFriction(object.physics?.friction ?? 0.85)
        .setRestitution(object.physics?.restitution ?? 0.02)
        .setCollisionGroups(groups)
        .setSolverGroups(groups)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    this.terrainEntries.set(key, { terrainId: object.id, body, collider, signature });
    this.handleToId.set(collider.handle, object.id);
    this.handleToTrigger.set(collider.handle, false);
  }

  private removeTerrainChunk(key: string) {
    const entry = this.terrainEntries.get(key);
    if (!entry) return;
    this.handleToId.delete(entry.collider.handle);
    this.handleToTrigger.delete(entry.collider.handle);
    this.world.removeRigidBody(entry.body);
    this.terrainEntries.delete(key);
  }

  private characterSignature(object: SceneObject): string {
    const { radius, halfHeight } = characterCapsule(object);
    return `${radius.toFixed(3)}|${halfHeight.toFixed(3)}`;
  }

  private createCharacter(object: SceneObject) {
    const p = object.transform.position;
    const { radius, halfHeight, centerY } = characterCapsule(object);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p[0], p[1], p[2]));
    const groups = collisionGroups(0, DEFAULT_COLLISION_MASK);
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, radius)
        .setTranslation(0, centerY, 0)
        .setCollisionGroups(groups)
        .setSolverGroups(groups)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
        // The player capsule is a KINEMATIC body — without ALL it wouldn't raise trigger events against
        // FIXED sensors (collectibles, checkpoints, doors), so walking onto a fixed pickup did nothing.
        .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL),
      body,
    );
    // offset keeps the capsule from jittering against surfaces; slide + autostep + ground snap.
    const controller = this.world.createCharacterController(0.02);
    controller.enableAutostep(0.4, 0.2, true);
    controller.enableSnapToGround(0.4);
    controller.setApplyImpulsesToDynamicBodies(true);
    controller.setSlideEnabled(true);
    this.charEntries.set(object.id, { body, collider, controller, signature: this.characterSignature(object) });
    this.handleToId.set(collider.handle, object.id);
    this.handleToTrigger.set(collider.handle, false);
  }

  private removeCharacter(id: string) {
    const entry = this.charEntries.get(id);
    if (!entry) return;
    this.handleToId.delete(entry.collider.handle);
    this.handleToTrigger.delete(entry.collider.handle);
    this.world.removeCharacterController(entry.controller);
    this.world.removeRigidBody(entry.body);
    this.charEntries.delete(id);
  }

  private syncCharacters(objects: SceneObject[]) {
    const present = new Set<string>();
    for (const object of objects) {
      if (!object.character?.enabled) continue;
      present.add(object.id);
      const entry = this.charEntries.get(object.id);
      if (!entry) this.createCharacter(object);
      else if (entry.signature !== this.characterSignature(object)) {
        this.removeCharacter(object.id);
        this.createCharacter(object);
      }
    }
    for (const id of [...this.charEntries.keys()]) {
      if (!present.has(id)) this.removeCharacter(id);
    }
  }

  private createVehicle(object: SceneObject) {
    const v = object.vehicle;
    if (!v) return;
    const world = object.parentId ? worldPosRot(this.frameById, object.id) : object.transform;
    const p = world.position;
    // Chassis box: derive it from the car MODEL's bounding box when the object renders a GLB (so the collision
    // hull actually matches the imported car, not a unit cube), else fall back to the object's scale box.
    let hx: number;
    let hy: number;
    let hz: number;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    const mesh = scaledMeshVertices(object);
    if (mesh && mesh.vertices.length >= 3) {
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < mesh.vertices.length; i += 3) {
        minX = Math.min(minX, mesh.vertices[i]); maxX = Math.max(maxX, mesh.vertices[i]);
        minY = Math.min(minY, mesh.vertices[i + 1]); maxY = Math.max(maxY, mesh.vertices[i + 1]);
        minZ = Math.min(minZ, mesh.vertices[i + 2]); maxZ = Math.max(maxZ, mesh.vertices[i + 2]);
      }
      hx = Math.max((maxX - minX) / 2, 0.05);
      hy = Math.max((maxY - minY) / 2, 0.05);
      hz = Math.max((maxZ - minZ) / 2, 0.05);
      cx = (maxX + minX) / 2; cy = (maxY + minY) / 2; cz = (maxZ + minZ) / 2;
    } else {
      const [sx, sy, sz] = halfScale(object);
      hx = 0.5 * sx; hy = 0.5 * sy; hz = 0.5 * sz;
    }
    const mass = Math.max(v.chassisMass ?? 1100, 1);
    // Box inertia about each axis (m/12·(a²+b²)); low center of mass keeps the car from tipping easily.
    const fx = 2 * hx;
    const fy = 2 * hy;
    const fz = 2 * hz;
    const ix = (mass / 12) * (fy * fy + fz * fz);
    const iy = (mass / 12) * (fx * fx + fz * fz);
    const iz = (mass / 12) * (fx * fx + fy * fy);
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(p[0], p[1], p[2])
      .setRotation(quatFromEuler(world.rotation))
      .setLinearDamping(v.linearDamping ?? 0.15)
      .setAngularDamping(v.angularDamping ?? 0.6)
      .setAdditionalMassProperties(
        mass,
        // CoM at the body's center, dropped by centerOfMassY for anti-rollover stability.
        { x: cx, y: cy + (v.centerOfMassY ?? -0.4), z: cz },
        { x: ix, y: iy, z: iz },
        { x: 0, y: 0, z: 0, w: 1 },
      )
      // Sweep the chassis so a fast car can't tunnel through a wall/barrier in one step.
      .setCcdEnabled(true);
    const body = this.world.createRigidBody(desc);
    const groups = collisionGroups(object.physics?.collisionLayer, object.physics?.collisionMask);
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        // Offset so the box wraps the model (whose origin is usually at the wheels, not the body center).
        .setTranslation(cx, cy, cz)
        .setFriction(object.physics?.friction ?? 0.5)
        .setRestitution(object.physics?.restitution ?? 0.05)
        .setCollisionGroups(groups)
        .setSolverGroups(groups)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
        .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL),
      body,
    );

    const controller = this.world.createVehicleController(body);
    controller.indexUpAxis = 1; // +Y up
    controller.setIndexForwardAxis = 2; // +Z forward (engine convention: car faces +Z)

    const restLength = v.suspensionRestLength ?? 0.35;
    const radius = Math.max(v.wheelRadius ?? 0.4, 0.05);
    const wheelIds = v.wheelObjectIds ?? [];
    const steeredSet = new Set(v.steeredWheelIds ?? []);
    const connectionY: number[] = [];
    const steered: boolean[] = [];
    wheelIds.forEach((wid) => {
      const wheel = this.frameById.get(wid);
      // The suspension CONNECTION point must be the wheel's position in CHASSIS-local space. Wheels are
      // authored under a steering ANCHOR (anchor = child of car, wheel mesh = child of anchor at [0,0,0]); the
      // anchor holds the corner position. So the connection = the anchor's position (+ the mesh's local offset).
      // Falls back to the wheel's own position for a direct-child (no-anchor) setup.
      const anchor = wheel?.parentId && wheel.parentId !== object.id ? this.frameById.get(wheel.parentId) : undefined;
      const ap = anchor?.transform.position ?? [0, 0, 0];
      const lp = wheel?.transform.position ?? [0, 0, 0];
      const cxw = (anchor ? ap[0] : 0) + lp[0];
      const cyw = (anchor ? ap[1] : 0) + lp[1];
      const czw = (anchor ? ap[2] : 0) + lp[2];
      // The connection sits restLength ABOVE the rest wheel center so the ray casts down through it to ground.
      const connY = cyw + restLength;
      connectionY.push(connY);
      // Steered if the wheel id OR its anchor's id is listed in steeredWheelIds.
      steered.push(steeredSet.has(wid) || (anchor ? steeredSet.has(anchor.id) : false));
      controller.addWheel({ x: cxw, y: connY, z: czw }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, restLength, radius);
    });
    for (let i = 0; i < wheelIds.length; i++) {
      controller.setWheelSuspensionRestLength(i, restLength);
      controller.setWheelSuspensionStiffness(i, v.suspensionStiffnessSim ?? 24);
      controller.setWheelSuspensionCompression(i, v.suspensionCompression ?? 0.82);
      controller.setWheelSuspensionRelaxation(i, v.suspensionRelaxation ?? 0.88);
      controller.setWheelMaxSuspensionForce(i, v.maxSuspensionForce ?? 30000);
      controller.setWheelMaxSuspensionTravel(i, v.maxSuspensionTravelSim ?? 0.3);
      controller.setWheelFrictionSlip(i, v.wheelFrictionSlip ?? 1.4);
      controller.setWheelSideFrictionStiffness(i, v.sideFrictionStiffness ?? 0.9);
      controller.setWheelRadius(i, radius);
    }

    this.vehicleEntries.set(object.id, {
      body,
      collider,
      controller,
      wheelIds: [...wheelIds],
      connectionY,
      steered,
      signature: vehicleSignature(object),
    });
    this.handleToId.set(collider.handle, object.id);
    this.handleToTrigger.set(collider.handle, false);
  }

  private removeVehicle(id: string) {
    const entry = this.vehicleEntries.get(id);
    if (!entry) return;
    this.handleToId.delete(entry.collider.handle);
    this.handleToTrigger.delete(entry.collider.handle);
    this.world.removeVehicleController(entry.controller);
    this.world.removeRigidBody(entry.body); // also removes the attached chassis collider
    this.vehicleEntries.delete(id);
  }

  /** Build/rebuild/drop the Rapier raycast vehicles (physicsModel === 'raycast'). */
  private syncVehicles(objects: SceneObject[]) {
    const present = new Set<string>();
    for (const object of objects) {
      if (!isRaycastVehicle(object)) continue;
      // Rebuilds need the wheel children resolvable; if a wheel isn't in the world yet, retry next frame.
      const wheelsReady = (object.vehicle?.wheelObjectIds ?? []).every((wid) => this.frameById.has(wid));
      // If the chassis renders a GLB, wait for its geometry to load before building — otherwise we'd build a
      // unit-cube fallback now and REBUILD when the model loads, and that rebuild would read the wheel positions
      // the per-frame suspension writeback has since moved (drift). Build ONCE, from the authored wheel rest poses.
      const modelId = object.renderer?.modelAssetId;
      const modelReady = !modelId || Boolean(getModelGeometry(modelId));
      if (!wheelsReady || !modelReady) continue;
      present.add(object.id);
      const entry = this.vehicleEntries.get(object.id);
      if (!entry) this.createVehicle(object);
      else if (entry.signature !== vehicleSignature(object)) {
        this.removeVehicle(object.id);
        this.createVehicle(object);
      }
    }
    for (const id of [...this.vehicleEntries.keys()]) {
      if (!present.has(id)) this.removeVehicle(id);
    }
  }

  /** Create/rebuild/drop bodies so the world matches the current physics-enabled objects. */
  private syncBodies(objects: SceneObject[]) {
    const present = new Set<string>();
    for (const object of objects) {
      if (object.terrain?.enabled) continue;
      // Raycast-sim cars own a dedicated dynamic chassis built by syncVehicles — never double-create here.
      if (isRaycastVehicle(object)) continue;
      if (!object.physics?.enabled) continue;
      present.add(object.id);
      const entry = this.entries.get(object.id);
      if (!entry) {
        this.createBody(object);
      } else if (entry.signature !== bodySignature(object)) {
        // Scale / body-type / material change: cheapest correct path is a rebuild.
        this.removeBody(object.id);
        this.createBody(object);
      }
    }
    for (const id of [...this.entries.keys()]) {
      if (!present.has(id)) this.removeBody(id);
    }
  }

  private createJoint(object: SceneObject, signature: string) {
    const j = object.joint;
    if (!j) return;
    const body2 = this.entries.get(object.id)?.body;
    if (!body2) return;

    // body1 is either the connected object's body, or a synthetic FIXED anchor pinned at body2's
    // current position (a "world anchor" — the joint then holds body2 in place / lets it swing).
    let body1: RigidBody | undefined;
    let anchorBody: RigidBody | null = null;
    if (j.connectedObjectId) {
      body1 = this.entries.get(j.connectedObjectId)?.body;
      if (!body1) return; // connected body not built yet — retry next frame (signature unchanged).
    } else {
      const t = body2.translation();
      anchorBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(t.x, t.y, t.z));
      body1 = anchorBody;
    }

    const a1 = { x: j.connectedAnchor[0], y: j.connectedAnchor[1], z: j.connectedAnchor[2] };
    // For a world anchor the anchor body sits at body2's origin, so reuse body2's local anchor on it.
    const a1Eff = j.connectedObjectId ? a1 : { x: j.localAnchor[0], y: j.localAnchor[1], z: j.localAnchor[2] };
    const a2 = { x: j.localAnchor[0], y: j.localAnchor[1], z: j.localAnchor[2] };
    const axisLen = Math.hypot(j.axis[0], j.axis[1], j.axis[2]) || 1;
    const axis = { x: j.axis[0] / axisLen, y: j.axis[1] / axisLen, z: j.axis[2] / axisLen };

    let params;
    switch (j.type) {
      case 'fixed':
        params = RAPIER.JointData.fixed(a1Eff, { x: 0, y: 0, z: 0, w: 1 }, a2, { x: 0, y: 0, z: 0, w: 1 });
        break;
      case 'spherical':
        params = RAPIER.JointData.spherical(a1Eff, a2);
        break;
      case 'hinge':
        params = RAPIER.JointData.revolute(a1Eff, a2, axis);
        break;
      case 'slider':
        params = RAPIER.JointData.prismatic(a1Eff, a2, axis);
        break;
      case 'spring':
        params = RAPIER.JointData.spring(j.restLength ?? 1, j.stiffness ?? 40, j.damping ?? 4, a1Eff, a2);
        break;
      case 'rope':
        params = RAPIER.JointData.rope(j.maxLength ?? 2, a1Eff, a2);
        break;
      default:
        params = RAPIER.JointData.spherical(a1Eff, a2);
    }

    const joint = this.world.createImpulseJoint(params, body1, body2, true);
    // Configuration that Rapier exposes on the created joint. Guarded so an API shape mismatch in a
    // given build degrades to a plain joint instead of throwing and killing the whole physics step.
    try {
      const anyJoint = joint as unknown as {
        setContactsEnabled?: (enabled: boolean) => void;
        setLimits?: (min: number, max: number) => void;
        configureMotorVelocity?: (targetVel: number, factor: number) => void;
      };
      anyJoint.setContactsEnabled?.(Boolean(j.collideConnected));
      if ((j.type === 'hinge' || j.type === 'slider') && j.limitsEnabled) {
        anyJoint.setLimits?.(j.limitMin ?? -Math.PI, j.limitMax ?? Math.PI);
      }
      if ((j.type === 'hinge' || j.type === 'slider') && (j.motorTargetVelocity ?? 0) !== 0) {
        anyJoint.configureMotorVelocity?.(j.motorTargetVelocity ?? 0, Math.max(j.motorMaxForce ?? 1, 0.01));
      }
    } catch (error) {
      console.warn('Joint config failed (using defaults):', error);
    }

    this.jointEntries.set(object.id, { joint, anchorBody, connectedObjectId: j.connectedObjectId ?? '', signature });
  }

  private removeJoint(id: string) {
    const entry = this.jointEntries.get(id);
    if (!entry) return;
    this.world.removeImpulseJoint(entry.joint, true);
    if (entry.anchorBody) this.world.removeRigidBody(entry.anchorBody);
    this.jointEntries.delete(id);
  }

  /**
   * Drop any joint touching `id` because its rigid body is being removed/rebuilt. Rapier already detaches
   * impulse joints when a parent body is removed, so we must NOT call removeImpulseJoint again (the handle
   * is dead) — just free our synthetic anchor body and forget the entry so syncJoints rebuilds it live.
   */
  private dropJointsReferencing(id: string) {
    for (const [owner, entry] of [...this.jointEntries]) {
      if (owner !== id && entry.connectedObjectId !== id) continue;
      if (entry.anchorBody) this.world.removeRigidBody(entry.anchorBody);
      this.jointEntries.delete(owner);
    }
  }

  /** Build/rebuild/drop joints so the world matches the current jointed objects. */
  private syncJoints(objects: SceneObject[]) {
    const present = new Set<string>();
    for (const object of objects) {
      if (!object.joint?.enabled || !object.physics?.enabled) continue;
      const body2Present = this.entries.has(object.id);
      const body1Present = object.joint.connectedObjectId
        ? this.entries.has(object.joint.connectedObjectId)
        : true;
      // Can't link until both ends exist; skip without marking present so it builds once they do.
      if (!body2Present || !body1Present) continue;
      present.add(object.id);
      const signature = jointSignature(object, body1Present, body2Present);
      const entry = this.jointEntries.get(object.id);
      if (!entry) this.createJoint(object, signature);
      else if (entry.signature !== signature) {
        this.removeJoint(object.id);
        this.createJoint(object, signature);
      }
    }
    for (const id of [...this.jointEntries.keys()]) {
      if (!present.has(id)) this.removeJoint(id);
    }
  }

  private terrainSignature(object: SceneObject, chunkX: number, chunkZ: number): string {
    const terrain = withTerrainDefaults(object.terrain);
    return [
      object.id,
      chunkX,
      chunkZ,
      object.transform.position.map((v) => v.toFixed(3)).join(','),
      object.transform.scale.map((v) => v.toFixed(3)).join(','),
      terrain.size,
      terrain.chunkSize,
      terrain.resolution,
      terrain.seed,
      terrain.heightScale,
      terrain.frequency,
      terrain.octaves,
      terrain.persistence,
      terrain.lacunarity,
      // Edit counter: bumped on every sculpt/paint so the heightfield COLLIDER rebuilds to match the new
      // shape. Without it the signature ignored heightOverrides, so after sculpting a hill the physics
      // surface stayed flat/stale and dropped bodies rested on the old height (or fell through).
      terrain.editVersion ?? 0,
      object.physics?.enabled,
      object.physics?.friction,
      object.physics?.collisionLayer,
      object.physics?.collisionMask,
    ].join('|');
  }

  private syncTerrainChunks(objects: SceneObject[]) {
    const terrains = objects.filter((object) => object.terrain?.enabled && object.physics?.enabled !== false);
    const focus = objects
      .filter((object) => object.character?.enabled || (object.physics?.enabled && object.physics.bodyType === 'dynamic'))
      .map((object) => object.transform.position);
    if (focus.length === 0) focus.push([0, 0, 0]);

    const desired = new Map<string, { object: SceneObject; chunkX: number; chunkZ: number; signature: string }>();
    for (const terrainObject of terrains) {
      const terrain = withTerrainDefaults(terrainObject.terrain);
      for (const point of focus) {
        for (const chunk of terrainChunkKeysAroundWorld(terrainObject, point, terrain.physicsRadius)) {
          const key = `${terrainObject.id}:${chunk.id}`;
          desired.set(key, {
            object: terrainObject,
            chunkX: chunk.x,
            chunkZ: chunk.z,
            signature: this.terrainSignature(terrainObject, chunk.x, chunk.z),
          });
        }
      }
    }

    for (const [key, entry] of [...this.terrainEntries]) {
      const next = desired.get(key);
      if (!next || next.signature !== entry.signature) this.removeTerrainChunk(key);
    }
    for (const [key, next] of desired) {
      if (!this.terrainEntries.has(key)) this.createTerrainChunk(next.object, next.chunkX, next.chunkZ, key, next.signature);
    }
  }

  /**
   * Advance one frame. `objects` are the post-script transforms; `prevTransforms`
   * are the transforms at the start of the tick — the difference is the motion a
   * script applied this frame, which we translate into body inputs.
   */
  frame(
    objects: SceneObject[],
    prevTransforms: Map<string, { position: Vector3Tuple; rotation: Vector3Tuple }>,
    impulses: Record<string, Vector3Tuple>,
    delta: number,
    setVelocities: Record<string, Vector3Tuple> = {},
    angularImpulses: Record<string, Vector3Tuple> = {},
    wind: Vector3Tuple = [0, 0, 0],
    windTurbulence = 0,
    vehicleInputs: Record<string, VehicleInput> = {},
  ): PhysicsFrameResult {
    const dt = Math.min(Math.max(delta, 1 / 240), 1 / 20);
    // Per-frame gust factor for wind (shared by every wind-affected body this step).
    const hasWind = wind[0] !== 0 || wind[1] !== 0 || wind[2] !== 0;
    const gust = 1 + (Math.random() - 0.5) * 2 * Math.min(Math.max(windTurbulence, 0), 1);
    // NOTE: world.timestep is set per-substep below (fixed-timestep substepping). A long frame is advanced in
    // <=1/60 chunks instead of one giant step, so a fast body (e.g. a speeding car) can't lurch on a hitch —
    // which previously read as a camera freeze/stutter at speed.
    // Resolve parent chains in WORLD space: bodies are simulated in world coordinates, but objects
    // store LOCAL transforms. `byId` powers world-transform composition for parented bodies; `prevById`
    // does the same for last frame's transforms so the scripted-motion delta is also world-space.
    const byId = new Map(objects.map((object) => [object.id, object]));
    this.frameById = byId;
    const prevById = new Map(
      objects.map((object) => {
        const pt = prevTransforms.get(object.id);
        return [
          object.id,
          pt ? { ...object, transform: { ...object.transform, position: pt.position, rotation: pt.rotation } } : object,
        ] as const;
      }),
    );
    // World transform (this frame / last frame) for an object — local for roots, composed for children.
    const curWorld = (object: SceneObject): PosRot =>
      object.parentId ? worldPosRot(byId, object.id) : object.transform;
    const prevWorld = (object: SceneObject): PosRot | undefined => {
      if (!object.parentId) return prevTransforms.get(object.id);
      return worldPosRot(prevById, object.id);
    };
    this.syncTerrainChunks(objects);
    this.syncBodies(objects);
    this.syncCharacters(objects);
    this.syncVehicles(objects);
    this.syncJoints(objects);

    const movedFixedBodies = new Set<string>();
    for (const object of objects) {
      if (!object.physics?.enabled) continue;
      const entry = this.entries.get(object.id);
      if (!entry) continue;
      const body = entry.body;
      const world = curWorld(object);
      const cur = world.position;
      const curRot = world.rotation;
      const prev = prevWorld(object);
      const dp: Vector3Tuple = prev
        ? [cur[0] - prev.position[0], cur[1] - prev.position[1], cur[2] - prev.position[2]]
        : [0, 0, 0];
      const movedRotation = prev
        ? Math.abs(curRot[0] - prev.rotation[0]) +
            Math.abs(curRot[1] - prev.rotation[1]) +
            Math.abs(curRot[2] - prev.rotation[2]) >
          EPSILON
        : false;
      const type = object.physics.bodyType;

      if (type === 'dynamic') {
        // Per-axis: an axis a script touched becomes velocity-controlled this frame;
        // untouched axes keep their simulated velocity (gravity, momentum, knockback).
        const v = body.linvel();
        const moved = dp.map((d) => Math.abs(d) > EPSILON);
        if (moved[0] || moved[1] || moved[2]) {
          body.setLinvel(
            {
              x: moved[0] ? dp[0] / dt : v.x,
              y: moved[1] ? dp[1] / dt : v.y,
              z: moved[2] ? dp[2] / dt : v.z,
            },
            true,
          );
        }
        if (movedRotation) body.setRotation(quatFromEuler(curRot), true);
        const impulse = impulses[object.id];
        if (impulse) body.applyImpulse({ x: impulse[0], y: impulse[1], z: impulse[2] }, true);
        // Global wind: a continuous FORCE on bodies that opt in via windInfluence (0 = ignore). Wind is a
        // roughly constant push (like pressure on a sail), so we apply force×dt WITHOUT a mass term — Rapier
        // then divides by mass, giving acceleration = force/mass. That makes LIGHT props blow around while
        // HEAVY ones barely budge (mass-based, as expected). windInfluence is the per-object "sail" factor;
        // the shared per-frame `gust` adds turbulence. This is what drifts/tumbles loose blocks, debris, etc.
        const windInfluence = object.physics.windInfluence ?? 0;
        if (hasWind && windInfluence > 0) {
          const k = windInfluence * gust * dt;
          body.applyImpulse({ x: wind[0] * k, y: wind[1] * k, z: wind[2] * k }, true);
        }
        // Apply Torque node: an angular impulse (kicks the body's spin). Used for physics-driven steering /
        // tip-over forces — pair it with applyImpulse for thrust to drive a car purely from physics.
        const torque = angularImpulses[object.id];
        if (torque) body.applyTorqueImpulse({ x: torque[0], y: torque[1], z: torque[2] }, true);
        // Set Velocity node: hard-set the body's linear velocity (overrides the transform-derived velocity).
        const sv = setVelocities[object.id];
        if (sv) body.setLinvel({ x: sv[0], y: sv[1], z: sv[2] }, true);
      } else if (type === 'kinematic') {
        body.setNextKinematicTranslation({ x: cur[0], y: cur[1], z: cur[2] });
        body.setNextKinematicRotation(quatFromEuler(curRot));
      } else {
        // fixed — only respond to an explicit scripted teleport.
        if (Math.abs(dp[0]) > EPSILON || Math.abs(dp[1]) > EPSILON || Math.abs(dp[2]) > EPSILON) {
          body.setTranslation({ x: cur[0], y: cur[1], z: cur[2] }, true);
          movedFixedBodies.add(object.id);
        }
        if (movedRotation) {
          body.setRotation(quatFromEuler(curRot), true);
          movedFixedBodies.add(object.id);
        }
      }
    }

    // Character controllers: turn each character's desired motion (the delta the controller pass
    // produced) into a collide-and-slide movement against the rest of the world.
    const grounded = new Set<string>();
    for (const object of objects) {
      if (!object.character?.enabled) continue;
      const entry = this.charEntries.get(object.id);
      if (!entry) continue;
      const cur = object.transform.position;
      const prev = prevTransforms.get(object.id);
      const desired = prev
        ? { x: cur[0] - prev.position[0], y: cur[1] - prev.position[1], z: cur[2] - prev.position[2] }
        : { x: 0, y: 0, z: 0 };
      // Release snap-to-ground while rising, or jumps get snapped straight back to the floor.
      if (desired.y > 0.001) entry.controller.disableSnapToGround();
      else entry.controller.enableSnapToGround(0.3);
      entry.controller.computeColliderMovement(
        entry.collider,
        desired,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        collisionGroups(0, DEFAULT_COLLISION_MASK),
      );
      if (entry.controller.computedGrounded()) grounded.add(object.id);
      const move = entry.controller.computedMovement();
      const base = prev ? prev.position : cur;
      entry.body.setNextKinematicTranslation({ x: base[0] + move.x, y: base[1] + move.y, z: base[2] + move.z });
    }

    // Raycast vehicles: translate driver input into per-wheel engine force / brake / steering, then let the
    // controller update the chassis velocity. MUST run before world.step (it writes the chassis velocity that
    // the step then integrates). Order: set wheels → updateVehicle(dt) → step.
    for (const [id, entry] of this.vehicleEntries) {
      const object = byId.get(id);
      const v = object?.vehicle;
      if (!v) continue;
      const input = vehicleInputs[id] ?? { throttle: 0, steer: 0, handbrake: false };
      const n = entry.wheelIds.length;
      const half = n / 2;
      const engineForce = (v.engineForce ?? 1800) * (input.engineScale ?? 1);
      const brakeForce = v.brakeForce ?? 2200;
      const handbrakeForce = v.handbrakeForce ?? 1400;
      const drivetrain = v.drivetrain ?? 'rwd';
      const brakeBias = Math.min(Math.max(v.brakeBias ?? 0.55, 0), 1);
      const steerAngle = v.steerAngle ?? 0.6;
      // Throttle drives forward; braking input (negative throttle while rolling forward) becomes brake, not reverse,
      // so a sim car decelerates with the brakes. A near-stopped car uses reverse engine force to back up.
      const speed = entry.controller.currentVehicleSpeed();
      const braking = input.throttle < -0.01 && speed > 1;
      for (let i = 0; i < n; i++) {
        const isFront = i < half;
        const driven = drivetrain === 'awd' || (drivetrain === 'fwd' ? isFront : !isFront);
        const drivenCount = drivetrain === 'awd' ? n : Math.max(1, n - half);
        // Engine force only when not using the brakes; split across driven wheels.
        const engine = !braking && driven ? (input.throttle * engineForce) / drivenCount : 0;
        entry.controller.setWheelEngineForce(i, engine);
        // Brake = service brake (biased front/rear) + handbrake on the rear wheels.
        let brake = 0;
        if (braking) brake += brakeForce * (isFront ? brakeBias : 1 - brakeBias);
        if (input.handbrake && !isFront) brake += handbrakeForce;
        entry.controller.setWheelBrake(i, brake);
        entry.controller.setWheelSteering(i, entry.steered[i] ? input.steer * steerAngle : 0);
      }
    }

    // Fixed-timestep substepping: advance the full frame time `dt` in chunks of at most 1/60s. Wheel forces
    // were set once above (they persist on the controller); each substep re-runs the vehicle raycast update
    // then steps the world. Capped at 6 substeps to avoid a spiral of death on a very long hitch.
    const FIXED_STEP = 1 / 60;
    let remaining = dt;
    let substeps = 0;
    do {
      const h = Math.min(FIXED_STEP, remaining);
      this.world.timestep = h;
      for (const [, entry] of this.vehicleEntries) {
        // Exclude sensors + the chassis's own collider from the wheel suspension rays (else a wheel ray can hit
        // the chassis box and the suspension never finds the ground).
        entry.controller.updateVehicle(h, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, (collider) => collider.handle !== entry.collider.handle);
      }
      this.world.step(this.events);
      remaining -= h;
      substeps++;
    } while (remaining > 1e-4 && substeps < 6);

    const collisions: PhysicsContactEvent[] = [];
    const triggers: PhysicsContactEvent[] = [];
    const triggersExit: PhysicsContactEvent[] = [];
    const collisionsExit: PhysicsContactEvent[] = [];
    this.events.drainCollisionEvents((h1, h2, started) => {
      const a = this.handleToId.get(h1);
      const b = this.handleToId.get(h2);
      if (!a || !b) return;
      const isTrigger = this.handleToTrigger.get(h1) || this.handleToTrigger.get(h2);
      // Exit events (started=false): sensors feed event.triggerExit (proximity prompts), solid contacts
      // feed event.collisionExit (e.g. left the ground / stopped touching a wall).
      if (!started) {
        const exitList = isTrigger ? triggersExit : collisionsExit;
        exitList.push({ objectId: a, otherObjectId: b }, { objectId: b, otherObjectId: a });
        return;
      }
      const list = isTrigger ? triggers : collisions;
      list.push({ objectId: a, otherObjectId: b }, { objectId: b, otherObjectId: a });
    });

    const transforms = new Map<string, { position: Vector3Tuple; rotation: Vector3Tuple }>();
    const velocities = new Map<string, Vector3Tuple>();
    for (const [id, entry] of this.entries) {
      const object = byId.get(id);
      if (entry.body.isDynamic()) {
        if (entry.body.isSleeping()) {
          velocities.set(id, [0, 0, 0]);
          continue;
        }
        const lv = entry.body.linvel();
        velocities.set(id, [lv.x, lv.y, lv.z]);
      } else if (object?.physics?.bodyType === 'fixed' && !movedFixedBodies.has(id)) {
        // Static scenery still collides, but its authored transform is already correct.
        // Avoid per-frame Rapier readback and store churn for floors, walls, and cover.
        continue;
      }
      const t = entry.body.translation();
      const q = entry.body.rotation();
      reuseQuat.set(q.x, q.y, q.z, q.w);
      reuseEuler.setFromQuaternion(reuseQuat, 'XYZ');
      const position: Vector3Tuple = [t.x, t.y, t.z];
      const rotation: Vector3Tuple = [reuseEuler.x, reuseEuler.y, reuseEuler.z];
      // The body simulates in WORLD space; convert back to LOCAL so a parented body's stored transform
      // stays relative to its parent (root objects: world == local, so this is a no-op).
      transforms.set(id, object?.parentId ? worldToLocalUnder(byId, object.parentId, position, rotation) : { position, rotation });
    }
    // Characters: collision resolves position; facing (rotation) stays whatever the controller set.
    for (const object of objects) {
      const entry = object.character?.enabled ? this.charEntries.get(object.id) : undefined;
      if (!entry) continue;
      const t = entry.body.translation();
      transforms.set(object.id, { position: [t.x, t.y, t.z], rotation: object.transform.rotation });
    }
    // Kinematic bodies are script-driven: keep the EULER rotation the script set, instead of the
    // quaternion→Euler readback — that round-trip hits gimbal lock when yaw passes ±90° and would
    // explode pitch/roll, flipping a script-steered car. (Position still comes from the body.)
    for (const object of objects) {
      if (object.physics?.bodyType !== 'kinematic') continue;
      const t = transforms.get(object.id);
      if (t) t.rotation = object.transform.rotation;
    }

    // Raycast vehicles: read the chassis transform + per-wheel state straight from the controller. The chassis
    // is a dynamic body, so its post-step transform is authoritative (no scripted writeback fights it).
    const vehicles = new Map<string, VehicleFrameState>();
    for (const [id, entry] of this.vehicleEntries) {
      const object = byId.get(id);
      const t = entry.body.translation();
      const q = entry.body.rotation();
      reuseQuat.set(q.x, q.y, q.z, q.w);
      reuseEuler.setFromQuaternion(reuseQuat, 'XYZ');
      const position: Vector3Tuple = [t.x, t.y, t.z];
      const rotation: Vector3Tuple = [reuseEuler.x, reuseEuler.y, reuseEuler.z];
      const chassis = object?.parentId ? worldToLocalUnder(byId, object.parentId, position, rotation) : { position, rotation };
      const wheels: VehicleWheelState[] = entry.wheelIds.map((wid, i) => ({
        objectId: wid,
        steer: entry.controller.wheelSteering(i) ?? 0,
        // Rapier maintains the accumulated wheel spin angle from wheel angular velocity.
        rotation: entry.controller.wheelRotation(i) ?? 0,
        suspension: entry.controller.wheelSuspensionLength(i) ?? (object?.vehicle?.suspensionRestLength ?? 0.35),
        connectionY: entry.connectionY[i] ?? 0,
        inContact: entry.controller.wheelIsInContact(i),
        sideImpulse: Math.abs(entry.controller.wheelSideImpulse(i) ?? 0),
      }));
      // Sideways slide speed: project the chassis velocity onto its local right axis (from yaw).
      const lv = entry.body.linvel();
      const yaw = rotation[1];
      const lateralSpeed = lv.x * Math.cos(yaw) - lv.z * Math.sin(yaw);
      vehicles.set(id, { chassis, speed: entry.controller.currentVehicleSpeed(), lateralSpeed, wheels });
    }

    return { transforms, collisions, triggers, triggersExit, collisionsExit, grounded: [...grounded], velocities, vehicles };
  }

  /**
   * Cast a ray and return the nearest solid (non-sensor) collider it hits, or null. The combat pass
   * uses this for shot-blocking / line-of-sight so attacks can't pass through walls: a bullet stops
   * at the first wall it crosses, and a melee/contact hit is dropped when geometry sits between the
   * attacker and the target. `exclude` holds object ids to skip (the attacker, the projectile itself,
   * other projectiles, corpses); colliders with no known object are skipped too. `dir` need not be
   * normalized; the returned `distance` is along it in world units.
   */
  castRay(
    origin: Vector3Tuple,
    dir: Vector3Tuple,
    maxDistance: number,
    exclude?: Set<string>,
  ): { objectId: string; distance: number } | null {
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    if (!(len > 1e-6) || !(maxDistance > 0)) return null;
    const ray = new RAPIER.Ray(
      { x: origin[0], y: origin[1], z: origin[2] },
      { x: dir[0] / len, y: dir[1] / len, z: dir[2] / len },
    );
    const hit = this.world.castRay(
      ray,
      maxDistance,
      true, // count the inside of a shape as solid, so a ray starting inside cover still blocks
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      undefined,
      (collider) => {
        const id = this.handleToId.get(collider.handle);
        return id !== undefined && !exclude?.has(id);
      },
    );
    if (!hit) return null;
    const id = this.handleToId.get(hit.collider.handle);
    return id ? { objectId: id, distance: hit.timeOfImpact } : null;
  }

  /**
   * Apply a one-shot linear impulse to a DYNAMIC body (and wake it). Used for projectile knockback: a fast
   * CCD bullet is removed the moment it reports a hit, so it can't reliably transfer momentum through the
   * solver — instead the hit pass calls this so the struck prop visibly gets shoved along the shot. No-op
   * for fixed/kinematic bodies or unknown ids.
   */
  applyImpulse(objectId: string, impulse: Vector3Tuple) {
    const entry = this.entries.get(objectId);
    if (!entry || entry.body.bodyType() !== RAPIER.RigidBodyType.Dynamic) return;
    entry.body.applyImpulse({ x: impulse[0], y: impulse[1], z: impulse[2] }, true);
  }

  /**
   * Explosion blast: shove every DYNAMIC body within `radius` of `center` outward (impulse falls off with
   * distance) plus an upward kick and a little random spin so props/debris/ragdoll-less chunks fly and
   * tumble — the satisfying part of an explosion that pure damage doesn't give. Mass-independent direction;
   * heavier bodies still move less (Rapier divides the impulse by mass).
   */
  applyRadialImpulse(center: Vector3Tuple, radius: number, strength: number, up = 0.4) {
    if (!(radius > 0) || !(strength > 0)) return;
    for (const [, entry] of this.entries) {
      const body = entry.body;
      if (body.bodyType() !== RAPIER.RigidBodyType.Dynamic) continue;
      const t = body.translation();
      const dx = t.x - center[0];
      const dy = t.y - center[1];
      const dz = t.z - center[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > radius) continue;
      const falloff = 1 - d / radius; // linear falloff to the blast edge
      const k = strength * falloff;
      const inv = d > 1e-3 ? 1 / d : 0;
      body.applyImpulse(
        { x: dx * inv * k, y: (d > 1e-3 ? dy * inv : 1) * k + k * up, z: dz * inv * k },
        true,
      );
      const spin = k * 0.18;
      body.applyTorqueImpulse(
        { x: (Math.random() - 0.5) * spin, y: (Math.random() - 0.5) * spin, z: (Math.random() - 0.5) * spin },
        true,
      );
    }
  }

  /** Live body counts for the profiler. `sleeping` bodies are at rest (Rapier deactivates them — near-zero CPU). */
  getStats(): { bodies: number; sleeping: number; characters: number; terrain: number; joints: number } {
    let sleeping = 0;
    for (const entry of this.entries.values()) if (entry.body.isSleeping()) sleeping += 1;
    return {
      bodies: this.entries.size,
      sleeping,
      characters: this.charEntries.size,
      terrain: this.terrainEntries.size,
      joints: this.jointEntries.size,
    };
  }

  dispose() {
    this.events.free();
    this.world.free();
    this.entries.clear();
    this.charEntries.clear();
    this.terrainEntries.clear();
    this.jointEntries.clear();
    this.handleToId.clear();
    this.handleToTrigger.clear();
  }
}

let runtime: PhysicsRuntime | null = null;
let active = false;

/** Called when Play starts; spins up a fresh world once the WASM is ready. */
export function startPhysics() {
  active = true;
  if (runtime) {
    runtime.dispose();
    runtime = null;
  }
  void initRapier().then(() => {
    if (active && !runtime) runtime = new PhysicsRuntime();
  });
}

/** Called when Play stops; tears the world down. */
export function stopPhysics() {
  active = false;
  if (runtime) {
    runtime.dispose();
    runtime = null;
  }
  clearRagdolls();
}

/** The live world if Play is active and Rapier finished initializing, else null. */
export function getActivePhysics(): PhysicsRuntime | null {
  return active && runtime ? runtime : null;
}
