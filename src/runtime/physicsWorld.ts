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

type ColliderKind = 'box' | 'sphere' | 'capsule' | 'plane';

function colliderKindFor(object: SceneObject): ColliderKind {
  // A plane is always a thin slab oriented by the object's rotation (matches the
  // flat ground / wall the mesh draws), regardless of the configured collider.
  if (object.renderer?.mesh === 'plane') return 'plane';
  const configured = object.physics?.collider;
  if (configured === 'sphere' || configured === 'capsule' || configured === 'box') return configured;
  if (object.renderer?.mesh === 'sphere') return 'sphere';
  if (object.renderer?.mesh === 'capsule') return 'capsule';
  return 'box';
}

function halfScale(object: SceneObject): [number, number, number] {
  const s = object.transform.scale;
  return [
    Math.max(Math.abs(s[0]), 0.01),
    Math.max(Math.abs(s[1]), 0.01),
    Math.max(Math.abs(s[2]), 0.01),
  ];
}

function clampCollisionLayer(layer: number | undefined): number {
  return Math.min(Math.max(Math.trunc(layer ?? 0), 0), 15);
}

function collisionGroups(layer: number | undefined, mask: number | undefined): number {
  const membership = 1 << clampCollisionLayer(layer);
  return ((membership & 0xffff) << 16) | ((mask ?? DEFAULT_COLLISION_MASK) & DEFAULT_COLLISION_MASK);
}

function colliderDescFor(object: SceneObject) {
  const [sx, sy, sz] = halfScale(object);
  const kind = colliderKindFor(object);
  let desc;
  if (kind === 'plane') {
    // planeGeometry is a unit quad in local XY; give it a thin depth so it acts as a surface.
    desc = RAPIER.ColliderDesc.cuboid(0.5 * sx, 0.5 * sy, 0.02);
  } else if (kind === 'sphere') {
    desc = RAPIER.ColliderDesc.ball(0.55 * Math.max(sx, sy, sz));
  } else if (kind === 'capsule') {
    // capsuleGeometry(radius 0.34, length 0.82): half cylinder segment = 0.41.
    desc = RAPIER.ColliderDesc.capsule(0.41 * sy, 0.34 * Math.max(sx, sz));
  } else {
    desc = RAPIER.ColliderDesc.cuboid(0.5 * sx, 0.5 * sy, 0.5 * sz);
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
  return [
    p?.bodyType,
    colliderKindFor(object),
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
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
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

    return { transforms, collisions, triggers, triggersExit, grounded: [...grounded] };
  }

  dispose() {
    this.events.free();
    this.world.free();
    this.entries.clear();
    this.charEntries.clear();
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
