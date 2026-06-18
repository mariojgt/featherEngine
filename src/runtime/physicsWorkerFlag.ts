import { useSyncExternalStore } from 'react';

/**
 * Runtime toggle for the off-thread physics worker (see docs/PHYSICS_WORKER.md).
 *
 * DEFAULT OFF, and it stays off until the staged migration is complete and live-verified: while off, the
 * synchronous in-process Rapier world ([physicsWorld.ts] via getActivePhysics) is the only physics that
 * runs, exactly as before — so this flag existing can never regress the current engine. The F8 perf overlay
 * will gain a toggle (like GPU instancing) once the worker path is correct, letting you A/B the two.
 *
 * Mirrors the module-singleton + useSyncExternalStore pattern of {@link ../three/modelInstancing}.
 */

let enabled = false;
const listeners = new Set<() => void>();

export const getPhysicsWorkerEnabled = (): boolean => enabled;
export const setPhysicsWorkerEnabled = (value: boolean): void => {
  if (value === enabled) return;
  enabled = value;
  listeners.forEach((l) => l());
};
export const togglePhysicsWorker = (): void => setPhysicsWorkerEnabled(!enabled);

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** React hook: re-renders when the physics-worker toggle flips. */
export function usePhysicsWorkerEnabled(): boolean {
  return useSyncExternalStore(subscribe, getPhysicsWorkerEnabled, getPhysicsWorkerEnabled);
}
