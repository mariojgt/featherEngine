import { useMemo } from 'react';
import type { Scene, SceneObject } from '../types';
import { selectActiveObjects, useEditorStore } from './editorStore';

type EditorState = ReturnType<typeof useEditorStore.getState>;

/**
 * Structurally-stable store subscriptions for UI panels.
 *
 * During Play, `tickRuntime` replaces the active scene's objects array (and the scene + scenes array
 * wrapping it) EVERY frame, even when only transforms moved. Panels that subscribed to those references
 * directly re-rendered 60×/s — the profiler showed the Scripting/Animator/Inspector panels burning more
 * main-thread time than the entire simulation + WebGL render combined (the "Play-mode re-render storm").
 *
 * These hooks subscribe to a cheap STRUCTURAL SIGNATURE instead and re-derive the data only when it
 * actually changes:
 *  - While PLAYING, a new object reference whose only difference is `transform` keeps its token, so
 *    motion never re-renders a panel (movement reaches the viewport through the transform buffer).
 *  - While NOT playing, any new reference bumps the token, so every edit (including gizmo transform
 *    drags) refreshes panels exactly as before. Edit-mode behavior is unchanged.
 *
 * The signature is a join of small integer tokens — no per-object field strings are built per frame,
 * and unchanged consecutive frames return the SAME string instance (so Zustand's equality check passes).
 */

/** Reference-compare every own field of two objects except `excludeKey` (both directions). */
function equalExcept<T extends object>(a: T, b: T, excludeKey: string): boolean {
  if (a === b) return true;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  for (const key in rb) {
    if (key === excludeKey) continue;
    if (ra[key] !== rb[key]) return false;
  }
  for (const key in ra) {
    if (key === excludeKey) continue;
    if (!(key in rb)) return false;
  }
  return true;
}

interface TokenEntry<T> {
  value: T;
  token: number;
}

let nextToken = 1;

const objectTokens = new Map<string, TokenEntry<SceneObject>>();

/** Stable integer identity for an object's NON-TRANSFORM content (transform ignored only during Play). */
function objectStructuralToken(object: SceneObject, playing: boolean): number {
  const entry = objectTokens.get(object.id);
  if (entry) {
    if (entry.value === object) return entry.token;
    if (playing && equalExcept(entry.value, object, 'transform')) {
      entry.value = object; // adopt the newest reference so later compares stay single-step
      return entry.token;
    }
    entry.value = object;
    entry.token = nextToken++;
    return entry.token;
  }
  const created = { value: object, token: nextToken++ };
  objectTokens.set(object.id, created);
  return created.token;
}

/**
 * Public token for ONE object: stable across Play-mode transform updates, bumped by any other
 * change (and by every change while not playing). Embed in a string-returning selector to
 * subscribe to an object "structurally".
 */
export const objectToken = (object: SceneObject, playing: boolean): number =>
  objectStructuralToken(object, playing);

let prevObjectTokens: number[] = [];
let prevObjectsSig = '';

/** Selector: structural signature of the active scene's objects (see module docs). */
export const structuralObjectsSignature = (state: EditorState): string => {
  const objects = selectActiveObjects(state);
  const playing = state.isPlaying;
  let changed = objects.length !== prevObjectTokens.length;
  const tokens: number[] = new Array(objects.length);
  for (let i = 0; i < objects.length; i += 1) {
    const token = objectStructuralToken(objects[i], playing);
    tokens[i] = token;
    if (!changed && prevObjectTokens[i] !== token) changed = true;
  }
  if (changed) {
    prevObjectTokens = tokens;
    prevObjectsSig = tokens.join(',');
    // Drop tokens of long-gone objects so the map doesn't grow across scene switches/sessions.
    if (objectTokens.size > objects.length * 2 + 256) {
      const live = new Set(objects.map((object) => object.id));
      for (const id of objectTokens.keys()) if (!live.has(id)) objectTokens.delete(id);
    }
  }
  return prevObjectsSig;
};

/**
 * The active scene's objects as a reference that's stable across Play-mode ticks. Re-renders the
 * consumer only on structural change (spawn/destroy/rename/reparent/component edits) — never on
 * pure motion. Use in panels/pickers; NOT for anything that must track live transforms per frame
 * (read those via `readTransform` in a useFrame, or `useEditorStore.getState()` on demand).
 */
export function useStableActiveObjects(): SceneObject[] {
  const sig = useEditorStore(structuralObjectsSignature);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => selectActiveObjects(useEditorStore.getState()), [sig]);
}

let throttledSig = '';
let throttledSigBlockedUntil = 0;

/**
 * Like `structuralObjectsSignature`, but capped at ~4Hz during Play. Gameplay constantly spawns and
 * despawns REAL scene objects (drift puffs, muzzle flashes, projectiles, explosions), and each one is
 * a structural change — so a panel on the plain structural signature still re-rendered its whole tree
 * on every VFX spawn (effectively per-frame in combat/driving). For display-only trees that don't
 * need frame-exact membership (the Hierarchy), batching those updates to 250ms keeps the panel live
 * while cutting the re-render storm. Edit mode is untouched (updates stay immediate).
 */
export const throttledObjectsSignature = (state: EditorState): string => {
  const sig = structuralObjectsSignature(state);
  if (!state.isPlaying) {
    throttledSig = sig;
    throttledSigBlockedUntil = 0;
    return sig;
  }
  if (sig !== throttledSig && performance.now() >= throttledSigBlockedUntil) {
    throttledSig = sig;
    throttledSigBlockedUntil = performance.now() + 250;
  }
  return throttledSig;
};

/** `useStableActiveObjects`, throttled to ~4Hz during Play — for display-only panels (Hierarchy). */
export function useThrottledActiveObjects(): SceneObject[] {
  const sig = useEditorStore(throttledObjectsSignature);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => selectActiveObjects(useEditorStore.getState()), [sig]);
}

const sceneTokens = new Map<string, TokenEntry<Scene>>();
let prevSceneSig = '';
let prevSceneSigParts = '';

/** Selector: signature of the active scene EXCLUDING its objects array (covered separately above). */
export const stableActiveSceneSignature = (state: EditorState): string => {
  const scene = state.scenes.find((item) => item.id === state.activeSceneId);
  if (!scene) {
    prevSceneSigParts = '';
    prevSceneSig = '';
    return prevSceneSig;
  }
  const entry = sceneTokens.get(scene.id);
  let token: number;
  if (entry) {
    if (entry.value === scene || equalExcept(entry.value, scene, 'objects')) {
      entry.value = scene;
      token = entry.token;
    } else {
      entry.value = scene;
      entry.token = nextToken++;
      token = entry.token;
    }
  } else {
    token = nextToken++;
    sceneTokens.set(scene.id, { value: scene, token });
  }
  const parts = `${scene.id}:${token}`;
  if (parts !== prevSceneSigParts) {
    prevSceneSigParts = parts;
    prevSceneSig = parts;
  }
  return prevSceneSig;
};

/**
 * The active scene, stable across Play-mode ticks: re-renders only when a scene field OTHER than
 * the objects array changes (environment, cinematics, name, …) or the active scene switches.
 * Pair with `useStableActiveObjects()` when the consumer also needs the object list.
 */
export function useStableActiveScene(): Scene | undefined {
  const sig = useEditorStore(stableActiveSceneSignature);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => {
    const state = useEditorStore.getState();
    return state.scenes.find((item) => item.id === state.activeSceneId);
  }, [sig]);
}

/**
 * The scene list reduced to what pickers show (id + name per scene), stable across Play ticks.
 * Subscribing to `state.scenes` directly churns every frame during Play (the array is replaced
 * when the active scene's objects are).
 */
export function useSceneOptions(): Array<{ id: string; name: string }> {
  const sig = useEditorStore((state) => state.scenes.map((scene) => `${scene.id}:${scene.name}`).join('|'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(
    () => useEditorStore.getState().scenes.map((scene) => ({ id: scene.id, name: scene.name })),
    [sig],
  );
}
