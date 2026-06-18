import type {
  PhysicsFrameRequest,
  PhysicsQueryRequest,
  PhysicsQueryResponse,
  PhysicsWorkerResponse,
} from './physicsProtocol';
import type { PhysicsFrameResult } from './physicsWorld';

/**
 * Main-thread handle to the off-thread physics worker — STAGE 1 (see docs/PHYSICS_WORKER.md).
 *
 * Owns the Worker lifecycle and the protocol plumbing: an init-handshake promise, frame request/response
 * correlation (the pipeline is 1 frame deep, so at most one frame is in flight), batched spatial queries,
 * and teardown. It is NOT yet called by tickRuntime — that wiring is a later stage, gated behind
 * {@link ./physicsWorkerFlag}. Constructing this with the flag off never happens, so it is inert today.
 *
 * Returned frame/query promises REJECT if the worker posts an `error` (e.g. the stage-1 skeleton's
 * not-implemented seams). Callers are expected to catch that and fall back to the in-process world, so the
 * worker can be incrementally filled in without ever breaking the running engine.
 */
export interface PhysicsWorkerClient {
  /** Resolves once the worker's Rapier WASM is initialized and its world is live. */
  ready: Promise<void>;
  /** Submit one frame's inputs; resolves with that frame's result (rejects on worker error). */
  step(request: Omit<PhysicsFrameRequest, 'kind' | 'requestId'>): Promise<PhysicsFrameResult>;
  /** Submit one spatial query (batched-query path; rejects on worker error). */
  query(query: PhysicsQueryRequest['query']): Promise<PhysicsQueryResponse>;
  /** Terminate the worker and reject any in-flight promises. */
  dispose(): void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

export function createPhysicsWorkerClient(fixedStep = 1 / 60): PhysicsWorkerClient {
  const worker = new Worker(new URL('./physicsWorker.ts', import.meta.url), { type: 'module' });

  let nextRequestId = 1;
  const pending = new Map<number, Pending>();
  let resolveReady!: () => void;
  let rejectReady!: (reason: Error) => void;
  const ready = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });

  worker.onmessage = (event: MessageEvent<PhysicsWorkerResponse>) => {
    const msg = event.data;
    switch (msg.kind) {
      case 'ready':
        resolveReady();
        break;
      case 'frameResult': {
        const p = pending.get(msg.requestId);
        if (p) {
          pending.delete(msg.requestId);
          p.resolve(msg.result);
        }
        break;
      }
      case 'queryResult': {
        const p = pending.get(msg.requestId);
        if (p) {
          pending.delete(msg.requestId);
          p.resolve(msg);
        }
        break;
      }
      case 'error': {
        // No requestId on errors: fail the oldest in-flight request so a caller can fall back in-process.
        const oldest = pending.keys().next().value;
        if (oldest !== undefined) {
          const p = pending.get(oldest)!;
          pending.delete(oldest);
          p.reject(new Error(msg.message));
        }
        break;
      }
    }
  };

  worker.onerror = (event) => {
    const err = new Error(`physics worker crashed: ${event.message}`);
    rejectReady(err);
    for (const [, p] of pending) p.reject(err);
    pending.clear();
  };

  worker.postMessage({ kind: 'init', fixedStep });

  const send = <T>(request: PhysicsFrameRequest | PhysicsQueryRequest): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      pending.set(request.requestId, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage(request);
    });

  return {
    ready,
    step: (request) =>
      send<PhysicsFrameResult>({ kind: 'frame', requestId: nextRequestId++, ...request }),
    query: (query) => send<PhysicsQueryResponse>({ kind: 'query', requestId: nextRequestId++, query }),
    dispose: () => {
      worker.postMessage({ kind: 'dispose' });
      worker.terminate();
      const err = new Error('physics worker disposed');
      for (const [, p] of pending) p.reject(err);
      pending.clear();
    },
  };
}
