// Soft-body crash damage bus.
//
// A tiny module-level store of plastic "dents" per vehicle, mirroring particleBus: the runtime tick pushes
// dents on hard impacts, and the deformable model renderer (ModelAsset with a deformObjectId) reads them in
// useFrame and crumples the mesh. Kept OUT of the Zustand store so the per-frame impact path stays allocation
// /subscription-free; the renderer polls getDents() and re-deforms only when `version` changes.

import type { Vector3Tuple } from '../types';

/** One plastic dent: a unit impact DIRECTION in the car's local space + how deep it has crushed (world units). */
export interface Dent {
  dir: Vector3Tuple;
  depth: number;
}

interface DentState {
  /** Bumped whenever the dent set changes so the renderer knows to re-deform. */
  version: number;
  dents: Dent[];
}

const byId = new Map<string, DentState>();

const MAX_DENTS = 10;
const MERGE_DOT = 0.82; // impacts within this cone deepen the same dent instead of adding a new one
const MAX_DEPTH = 0.55; // per-dent crush cap (world units), so a wall-spammed car doesn't implode

/** Current dents for a vehicle (or undefined). The renderer reads `version` to decide when to re-deform. */
export function getVehicleDents(id: string): DentState | undefined {
  return byId.get(id);
}

/** Register a hard impact from a (local-space) direction with a crush amount; merges into a nearby dent. */
export function addVehicleDent(id: string, dir: Vector3Tuple, depth: number): void {
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  if (!(len > 1e-4) || !(depth > 0)) return;
  const d: Vector3Tuple = [dir[0] / len, dir[1] / len, dir[2] / len];
  const state = byId.get(id) ?? { version: 0, dents: [] };
  const existing = state.dents.find((dent) => dent.dir[0] * d[0] + dent.dir[1] * d[1] + dent.dir[2] * d[2] > MERGE_DOT);
  if (existing) {
    existing.depth = Math.min(MAX_DEPTH, existing.depth + depth);
  } else if (state.dents.length < MAX_DENTS) {
    state.dents.push({ dir: d, depth: Math.min(MAX_DEPTH, depth) });
  } else {
    return; // full + no nearby dent — ignore (already a wreck)
  }
  state.version += 1;
  byId.set(id, state);
}

/** Wipe all damage (called when Play starts/stops so each run begins with a pristine car). */
export function clearVehicleDents(): void {
  byId.clear();
}
