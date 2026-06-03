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
import type { Collider, KinematicCharacterController, RigidBody, World } from '@dimforge/rapier3d-compat';
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
  buildTerrainHeightfield,
  terrainChunkKeysAroundWorld,
  withTerrainDefaults,
} from '../terrain/terrain';

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

const RESTITUTION = 0;
const EPSILON = 1e-5;
const DEFAULT_COLLISION_MASK = 0xffff;

const reuseEuler = new THREE.Euler();
const reuseQuat = new THREE.Quaternion();

function quatFromEuler(rotation: Vector3Tuple) {
  reuseEuler.set(rotation[0], rotation[1], rotation[2], 'XYZ');
  reuseQuat.setFromEuler(reuseEuler);
  return { x: reuseQuat.x, y: reuseQuat.y, z: reuseQuat.z, w: reuseQuat.w };
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
  desc.setRestitution(RESTITUTION);
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
  /** Character-controller object ids that are standing on the ground this frame. */
  grounded: string[];
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

class PhysicsRuntime {
  private world: World;
  private events = new RAPIER.EventQueue(true);
  private entries = new Map<string, BodyEntry>();
  private handleToId = new Map<number, string>();
  private handleToTrigger = new Map<number, boolean>();
  private charEntries = new Map<string, CharacterEntry>();
  private terrainEntries = new Map<string, TerrainEntry>();

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
  }

  private createBody(object: SceneObject) {
    const p = object.transform.position;
    const desc = bodyDescFor(object)
      .setTranslation(p[0], p[1], p[2])
      .setRotation(quatFromEuler(object.transform.rotation))
      .setLinearDamping(object.physics?.linearDamping ?? 0)
      .setAngularDamping(object.physics?.angularDamping ?? 0.05);
    const body = this.world.createRigidBody(desc);
    body.setGravityScale(object.physics?.gravityScale ?? 1, false);
    const collider = this.world.createCollider(colliderDescFor(object), body);
    this.entries.set(object.id, { body, collider, signature: bodySignature(object) });
    this.handleToId.set(collider.handle, object.id);
    this.handleToTrigger.set(collider.handle, Boolean(object.physics?.isTrigger));
  }

  private removeBody(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.handleToId.delete(entry.collider.handle);
    this.handleToTrigger.delete(entry.collider.handle);
    this.world.removeRigidBody(entry.body); // also removes attached colliders
    this.entries.delete(id);
  }

  private createTerrainChunk(object: SceneObject, chunkX: number, chunkZ: number, key: string, signature: string) {
    if (!object.terrain) return;
    const terrain = withTerrainDefaults(object.terrain);
    const heightfield = buildTerrainHeightfield(terrain, chunkX, chunkZ);
    const rotation = quatFromEuler(object.transform.rotation);
    const center = new THREE.Vector3(
      heightfield.center[0] * object.transform.scale[0],
      0,
      heightfield.center[2] * object.transform.scale[2],
    ).applyQuaternion(reuseQuat);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(
          object.transform.position[0] + center.x,
          object.transform.position[1] + center.y,
          object.transform.position[2] + center.z,
        )
        .setRotation(rotation),
    );
    const groups = collisionGroups(object.physics?.collisionLayer, object.physics?.collisionMask);
    // Rapier's heightfield takes the number of SUBDIVISIONS (nrows/ncols) and expects exactly
    // (nrows+1)*(ncols+1) height samples. buildTerrainHeightfield reports nrows/ncols as the SAMPLE
    // count (segments+1), so subtract one here — otherwise Rapier panics ("unreachable") on the
    // mismatched matrix size.
    const hfRows = Math.max(1, heightfield.nrows - 1);
    const hfCols = Math.max(1, heightfield.ncols - 1);
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.heightfield(
        hfRows,
        hfCols,
        heightfield.heights,
        {
          x: heightfield.scale.x * Math.abs(object.transform.scale[0] || 1),
          y: Math.abs(object.transform.scale[1] || 1),
          z: heightfield.scale.z * Math.abs(object.transform.scale[2] || 1),
        },
      )
        .setFriction(object.physics?.friction ?? 0.85)
        .setRestitution(RESTITUTION)
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

  /** Create/rebuild/drop bodies so the world matches the current physics-enabled objects. */
  private syncBodies(objects: SceneObject[]) {
    const present = new Set<string>();
    for (const object of objects) {
      if (object.terrain?.enabled) continue;
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
  ): PhysicsFrameResult {
    const dt = Math.min(Math.max(delta, 1 / 240), 1 / 20);
    this.world.timestep = dt;
    this.syncTerrainChunks(objects);
    this.syncBodies(objects);
    this.syncCharacters(objects);

    for (const object of objects) {
      if (!object.physics?.enabled) continue;
      const entry = this.entries.get(object.id);
      if (!entry) continue;
      const body = entry.body;
      const cur = object.transform.position;
      const curRot = object.transform.rotation;
      const prev = prevTransforms.get(object.id);
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
      } else if (type === 'kinematic') {
        body.setNextKinematicTranslation({ x: cur[0], y: cur[1], z: cur[2] });
        body.setNextKinematicRotation(quatFromEuler(curRot));
      } else {
        // fixed — only respond to an explicit scripted teleport.
        if (Math.abs(dp[0]) > EPSILON || Math.abs(dp[1]) > EPSILON || Math.abs(dp[2]) > EPSILON) {
          body.setTranslation({ x: cur[0], y: cur[1], z: cur[2] }, true);
        }
        if (movedRotation) body.setRotation(quatFromEuler(curRot), true);
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

    this.world.step(this.events);

    const collisions: PhysicsContactEvent[] = [];
    const triggers: PhysicsContactEvent[] = [];
    const triggersExit: PhysicsContactEvent[] = [];
    this.events.drainCollisionEvents((h1, h2, started) => {
      const a = this.handleToId.get(h1);
      const b = this.handleToId.get(h2);
      if (!a || !b) return;
      const isTrigger = this.handleToTrigger.get(h1) || this.handleToTrigger.get(h2);
      // Exit events (started=false) feed event.triggerExit for proximity prompts; we only track sensor exits.
      if (!started) {
        if (isTrigger) triggersExit.push({ objectId: a, otherObjectId: b }, { objectId: b, otherObjectId: a });
        return;
      }
      const list = isTrigger ? triggers : collisions;
      list.push({ objectId: a, otherObjectId: b }, { objectId: b, otherObjectId: a });
    });

    const transforms = new Map<string, { position: Vector3Tuple; rotation: Vector3Tuple }>();
    for (const [id, entry] of this.entries) {
      const t = entry.body.translation();
      const q = entry.body.rotation();
      reuseQuat.set(q.x, q.y, q.z, q.w);
      reuseEuler.setFromQuaternion(reuseQuat, 'XYZ');
      transforms.set(id, {
        position: [t.x, t.y, t.z],
        rotation: [reuseEuler.x, reuseEuler.y, reuseEuler.z],
      });
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

    return { transforms, collisions, triggers, triggersExit, grounded: [...grounded] };
  }

  dispose() {
    this.events.free();
    this.world.free();
    this.entries.clear();
    this.charEntries.clear();
    this.terrainEntries.clear();
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
