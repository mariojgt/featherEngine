/**
 * A tiny pub/sub channel that lets the runtime (editorStore.tickRuntime) drive authored particle
 * emitters without round-tripping through React/Zustand state every frame. Each mounted
 * ParticleSystem renderer subscribes by its owning object id; Blueprint nodes (Burst Particles,
 * Set Particles Emitting) and game logic push commands to it.
 */
export type ParticleCommand =
  | { type: 'burst'; count?: number }
  | { type: 'emit'; on: boolean };

type Listener = (command: ParticleCommand) => void;

const listeners = new Map<string, Set<Listener>>();

/** A renderer registers to receive commands for its object. Returns an unsubscribe fn. */
export function subscribeParticles(objectId: string, listener: Listener): () => void {
  let set = listeners.get(objectId);
  if (!set) {
    set = new Set();
    listeners.set(objectId, set);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(objectId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(objectId);
  };
}

/** Send a command to every emitter mounted for `objectId` (no-op if none is mounted). */
export function sendParticleCommand(objectId: string, command: ParticleCommand): void {
  const set = listeners.get(objectId);
  if (!set) return;
  set.forEach((listener) => listener(command));
}
