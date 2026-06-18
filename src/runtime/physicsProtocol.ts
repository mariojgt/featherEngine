import type { SceneObject, Vector3Tuple } from '../types';
import type { PhysicsFrameResult, VehicleInput } from './physicsWorld';

/**
 * Wire protocol between the main thread and the off-thread physics worker (see docs/PHYSICS_WORKER.md).
 *
 * STAGE 1 (this file): the contract only. The worker ({@link ./physicsWorker}) and the client
 * ({@link ./physicsWorkerClient}) are skeletons that speak this protocol; tickRuntime is NOT wired to
 * them yet and the {@link ./physicsWorkerFlag feature flag} defaults OFF, so the synchronous in-process
 * physics path ([physicsWorld.ts] via getActivePhysics) remains the only code that runs until later stages.
 *
 * Why these exact shapes: the frame inputs mirror physics.frame(...)'s positional arguments 1:1, and the
 * frame output IS PhysicsFrameResult. Every field here is structured-cloneable (plain objects, arrays,
 * and Maps of tuples), so postMessage can carry them without hand-serialization in stage 1. A later stage
 * replaces the per-body transform Maps with a transferable Float32Array + a stable id manifest to drop the
 * clone cost (see the doc's "Transfer" section); the message *kinds* below stay the same.
 */

/** Discriminator tags for messages flowing main → worker. */
export type PhysicsRequestKind = 'init' | 'frame' | 'query' | 'dispose';
/** Discriminator tags for messages flowing worker → main. */
export type PhysicsResponseKind = 'ready' | 'frameResult' | 'queryResult' | 'error';

/** Boot the worker's Rapier world. Sent once after the worker spawns. */
export interface PhysicsInitRequest {
  kind: 'init';
  /** Fixed simulation timestep in seconds (the world steps at this rate; default 1/60). */
  fixedStep: number;
}

/**
 * One simulation frame's inputs — a structured-clone-friendly mirror of physics.frame(...)'s arguments.
 * `requestId` lets the client correlate the pipelined `frameResult` that comes back (the worker processes
 * frames in order, but the pipeline is 1 frame deep, so the id also guards against a late/dropped reply).
 */
export interface PhysicsFrameRequest {
  kind: 'frame';
  requestId: number;
  /** The objects to simulate this frame (already filtered to physics/impulse-receiving objects by the tick). */
  objects: SceneObject[];
  /** Start-of-tick transforms, keyed by object id — the diff vs. post-script transforms = scripted motion. */
  prevTransforms: Map<string, { position: Vector3Tuple; rotation: Vector3Tuple }>;
  /** Linear impulses requested this frame (action.applyImpulse/applyForce), keyed by object id. */
  impulses: Record<string, Vector3Tuple>;
  /** Angular impulses (torque kicks) requested this frame, keyed by object id. */
  angularImpulses: Record<string, Vector3Tuple>;
  /** Hard linear-velocity sets requested this frame (dynamic bodies), keyed by object id. */
  setVelocities: Record<string, Vector3Tuple>;
  /** Scaled frame delta in seconds (already multiplied by runtimeTimeScale; <= 0 means "don't advance"). */
  delta: number;
  /** Global scene wind vector + turbulence (drives wind influence on dynamic bodies + cloth/cable). */
  wind: Vector3Tuple;
  windTurbulence: number;
  /** Per-frame raycast-sim vehicle driver input, keyed by chassis object id. */
  vehicleInputs: Record<string, VehicleInput>;
}

/**
 * A synchronous-style spatial query (raycast / sphere overlap). Sent for the LATER stage in which the tick
 * pre-collects queries; in the interim the main-thread query world answers these in-process (see the doc).
 * `requestId` correlates the `queryResult`.
 */
export interface PhysicsQueryRequest {
  kind: 'query';
  requestId: number;
  query:
    | { type: 'ray'; origin: Vector3Tuple; dir: Vector3Tuple; maxDistance: number; exclude: string[] }
    | { type: 'sphere'; center: Vector3Tuple; radius: number; exclude: string[] };
}

/** Tear the worker's world down (Stop / unmount). */
export interface PhysicsDisposeRequest {
  kind: 'dispose';
}

export type PhysicsWorkerRequest =
  | PhysicsInitRequest
  | PhysicsFrameRequest
  | PhysicsQueryRequest
  | PhysicsDisposeRequest;

/** Worker → main: Rapier WASM finished initializing and the world is live. */
export interface PhysicsReadyResponse {
  kind: 'ready';
}

/** Worker → main: the result of one simulated frame. `requestId` echoes the originating PhysicsFrameRequest. */
export interface PhysicsFrameResponse {
  kind: 'frameResult';
  requestId: number;
  result: PhysicsFrameResult;
}

/** Worker → main: the result of one spatial query. `requestId` echoes the originating PhysicsQueryRequest. */
export interface PhysicsQueryResponse {
  kind: 'queryResult';
  requestId: number;
  hit: { objectId: string; distance: number; point: Vector3Tuple } | null;
  /** Overlap queries additionally report every object id inside the sphere. */
  overlap?: string[];
}

/** Worker → main: an exception escaped the worker (logged on the main thread; the tick falls back in-process). */
export interface PhysicsErrorResponse {
  kind: 'error';
  message: string;
}

export type PhysicsWorkerResponse =
  | PhysicsReadyResponse
  | PhysicsFrameResponse
  | PhysicsQueryResponse
  | PhysicsErrorResponse;
