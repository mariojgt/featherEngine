import RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorkerRequest, PhysicsWorkerResponse } from './physicsProtocol';

/**
 * Off-thread physics worker — STAGE 1 SKELETON (see docs/PHYSICS_WORKER.md).
 *
 * What's real here now: the message loop, the Rapier WASM init handshake, and dispose. What's a stage-2
 * seam: the actual world ownership + `frame`/`query` handling, which migrates out of [physicsWorld.ts] once
 * its world-owning core is extracted from its main-thread-only glue. Until then the worker answers `frame`
 * and `query` with an `error` response, and the client treats that as "fall back to the in-process world."
 *
 * This file is bundled (Vite resolves the `new URL('./physicsWorker.ts', import.meta.url)` reference in the
 * client) but, because the feature flag defaults OFF, it is never actually spawned at runtime yet.
 */

// Minimal local typing for the dedicated-worker global, so this compiles without the WebWorker lib in tsconfig.
interface WorkerScope {
  postMessage(message: PhysicsWorkerResponse): void;
  addEventListener(type: 'message', listener: (event: { data: PhysicsWorkerRequest }) => void): void;
}
const ctx = self as unknown as WorkerScope;

const post = (message: PhysicsWorkerResponse) => ctx.postMessage(message);

let initialized = false;

ctx.addEventListener('message', (event) => {
  const msg = event.data;
  try {
    switch (msg.kind) {
      case 'init': {
        // Rapier's compat build initializes its WASM here, inside the worker thread, so the heavy solver
        // never touches the main thread once stage 2 wires the world up.
        if (initialized) {
          post({ kind: 'ready' });
          break;
        }
        void RAPIER.init().then(() => {
          initialized = true;
          // STAGE 2: construct the World + the body registry here, sized by msg.fixedStep.
          post({ kind: 'ready' });
        });
        break;
      }
      case 'frame': {
        // STAGE 2: run the migrated physics.frame() against the worker-owned world and post a frameResult.
        post({ kind: 'error', message: 'physics worker frame() not implemented (stage 2)' });
        break;
      }
      case 'query': {
        // Note: synchronous queries are answered by the MAIN-THREAD query world (see the doc); this branch
        // exists for the later batched-query path only.
        post({ kind: 'error', message: 'physics worker query() not implemented (stage 2)' });
        break;
      }
      case 'dispose': {
        initialized = false;
        // STAGE 2: free the World + colliders here.
        break;
      }
    }
  } catch (err) {
    post({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
});
