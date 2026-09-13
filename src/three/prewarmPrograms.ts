import type { Camera, Material, Object3D, WebGLRenderer } from 'three';

/** Three r171 compileAsync polls currentProgram without checking disposal and cannot be cancelled.
 * A scene reset/fracture can remove a material between polls, throwing from its setTimeout outside
 * the returned Promise. Start the same parallel compilation, but own the wait and its lifetime.
 * Missing programs are left to normal lazy rendering; prewarming must never interrupt Play.
 */
export function prewarmPrograms(renderer: WebGLRenderer, scene: Object3D, camera: Camera, complete: () => void): () => void {
  const pending = new Set<Material>();
  const listeners = new Map<Material, () => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const cancel = () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    for (const [material, listener] of listeners) material.removeEventListener('dispose', listener);
    listeners.clear(); pending.clear();
  };
  const finish = () => { if (!stopped) { cancel(); complete(); } };
  try {
    for (const material of renderer.compile(scene, camera)) {
      pending.add(material);
      const listener = () => { pending.delete(material); };
      material.addEventListener('dispose', listener);
      listeners.set(material, listener);
    }
  } catch {
    finish();
    return cancel;
  }
  const poll = () => {
    if (stopped) return;
    try {
      for (const material of pending) {
        const properties = renderer.properties.get(material) as { currentProgram?: { isReady: () => boolean } };
        const program = properties.currentProgram;
        if (!program || program.isReady()) pending.delete(material);
      }
    } catch {
      finish();
      return;
    }
    if (pending.size === 0) finish();
    else timer = setTimeout(poll, 10);
  };
  timer = setTimeout(poll, 10);
  return cancel;
}
